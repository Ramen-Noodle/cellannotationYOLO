"""Version 3 two-phase recipes. Evaluation uses database-independent pixel boxes."""
import json
import math
from collections import defaultdict
from annotation_merging import RecipeError, _overlap


def selector(source):
    return (source['channel'], source['detection_setting_id'], source['class_name'], source.get('sublabel', ''))


def phase_one_mapping_targets(mappings, inputs):
    if not isinstance(mappings, list):
        raise RecipeError('Phase 1 output mappings must be a list.')
    seen = set()
    redirects = defaultdict(int)
    targets = set()
    for row in mappings:
        if not isinstance(row, dict) or 'target' not in row:
            raise RecipeError('Each Phase 1 mapping needs source classes and a target.')
        ids, target = row.get('sources'), row['target']
        if (not isinstance(ids, list) or not ids or
                any(not isinstance(key, str) or key not in inputs for key in ids)):
            raise RecipeError('Phase 1 combinations must reference classes feeding the output table.')
        combination = frozenset(ids)
        if len(combination) != len(ids) or combination in seen:
            raise RecipeError('Phase 1 mappings must use unique input combinations.')
        seen.add(combination)
        if target is None:
            continue
        if not isinstance(target, str) or target not in inputs:
            raise RecipeError('Phase 1 outputs must use an existing class feeding the output table.')
        targets.add(target)
        for key in combination - {target}:
            redirects[key] += 1
    # An input survives if at least one row containing it uses its default or No change.
    combinations_per_input = 1 << (len(inputs) - 1)
    return targets | {key for key in inputs if redirects[key] < combinations_per_input}


def validate_recipe(recipe):
    if not isinstance(recipe, dict) or recipe.get('version') != 3:
        raise RecipeError('A version 3 two-phase recipe is required.')
    if not isinstance(recipe.get('inputs'), list) or not isinstance(recipe.get('channels'), list):
        raise RecipeError('Recipe inputs and channels must be lists.')
    sources, selectors = {}, set()
    for source in recipe['inputs']:
        if not isinstance(source, dict) or any(not isinstance(source.get(key), str) or not source[key].strip()
                for key in ('id', 'channel', 'detection_setting_id', 'class_name')):
            raise RecipeError('Each input needs an ID, channel, detection setting, and class name.')
        if not isinstance(source.get('sublabel', ''), str):
            raise RecipeError('Input sublabels must be strings.')
        if source['id'] in sources or selector(source) in selectors:
            raise RecipeError('Recipe inputs must be unique.')
        sources[source['id']] = source
        selectors.add(selector(source))
    seen_channels, node_ids, output_channels = set(), set(sources), {}
    for graph in recipe['channels']:
        if not isinstance(graph, dict) or not isinstance(graph.get('channel'), str) or graph['channel'] in seen_channels:
            raise RecipeError('Each channel graph needs a unique channel.')
        channel = graph['channel']
        seen_channels.add(channel)
        if not isinstance(graph.get('nodes'), list) or not isinstance(graph.get('edges'), list):
            raise RecipeError('Channel graphs need nodes and edges.')
        nodes = {key: dict(value, type='input') for key, value in sources.items() if value['channel'] == channel}
        for node in graph['nodes']:
            if not isinstance(node, dict) or not isinstance(node.get('id'), str) or not node['id'] or node['id'] in node_ids:
                raise RecipeError('Graph nodes need unique IDs.')
            if node.get('type') not in ('rule', 'output'):
                raise RecipeError('Unknown graph node type.')
            if node['type'] == 'rule':
                if node.get('ruleType') not in ('iou', 'containment'):
                    raise RecipeError('Unknown overlap rule.')
                threshold(node.get('threshold'))
            node_ids.add(node['id'])
            nodes[node['id']] = node
        incoming, outgoing = defaultdict(list), {}
        for edge in graph['edges']:
            if (not isinstance(edge, dict) or not isinstance(edge.get('source'), str) or
                    not isinstance(edge.get('target'), str) or edge['source'] not in nodes or edge['target'] not in nodes):
                raise RecipeError('Connections must reference nodes in the same channel.')
            source, target = edge['source'], edge['target']
            if nodes[source]['type'] == 'output' or nodes[target]['type'] == 'input' or source in outgoing:
                raise RecipeError('Each class or rule result must feed one destination.')
            outgoing[source] = target
            incoming[target].append(source)
        output_channels.update({key: channel for key, node in nodes.items()
                                if node['type'] == 'input' and key not in outgoing})
        pending = set(nodes)
        input_ancestors = {}
        while pending:
            ready = {key for key in pending if not any(source in pending for source in incoming[key])}
            if not ready:
                raise RecipeError('Channel graph contains a cycle.')
            for key in ready:
                if nodes[key]['type'] == 'input':
                    input_ancestors[key] = {key}
                else:
                    input_ancestors[key] = set().union(*(input_ancestors[source] for source in incoming[key]))
            pending -= ready
        for node in graph['nodes']:
            if not input_ancestors[node['id']]:
                raise RecipeError('Every saved rule and output must have an input.')
            if node['type'] != 'output':
                continue
            targets = phase_one_mapping_targets(node.get('mappings'), input_ancestors[node['id']])
            output_channels.update({target: channel for target in targets})
    if any(source['channel'] not in seen_channels for source in sources.values()) or not output_channels:
        raise RecipeError('Recipe inputs must belong to a channel graph, and the recipe needs at least one output.')
    threshold(recipe.get('cross_iou'))
    threshold(recipe.get('cross_containment'))
    assignments = recipe.get('output_assignments', [])
    if not isinstance(assignments, list):
        raise RecipeError('Output assignments must be a list.')
    seen_combinations = set()
    for assignment in assignments:
        if not isinstance(assignment, dict):
            raise RecipeError('Each output assignment needs source outputs and a class name.')
        ids, label = assignment.get('sources'), assignment.get('label')
        if (not isinstance(ids, list) or not ids or
                any(not isinstance(key, str) or key not in output_channels for key in ids)):
            raise RecipeError('Output assignments must reference existing Phase 1 outputs.')
        if len({output_channels[key] for key in ids}) != len(ids):
            raise RecipeError('Each combination can contain only one output per channel.')
        if not isinstance(label, str) or not 1 <= len(label.strip()) <= 255:
            raise RecipeError('Output class names must contain between 1 and 255 characters.')
        combination = frozenset(ids)
        if combination in seen_combinations:
            raise RecipeError('Each combination can have only one output assignment.')
        seen_combinations.add(combination)
    return output_channels


def threshold(value):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not 0 <= value <= 1:
        raise RecipeError('Overlap thresholds must be numbers between 0 and 1.')
    return value


def representative(box):
    confidence = box.get('confidence')
    return (-(confidence if confidence is not None else -1), box['x'], box['y'], box['w'], box['h'], box['sourceIndex'])


def candidate_index(boxes):
    sizes = sorted(max(box['w'], box['h']) for box in boxes)
    size = max(1, sizes[len(sizes) // 2] if sizes else 1)
    buckets, oversized = defaultdict(list), []
    def keys(box):
        x1, x2 = math.floor(box['x'] / size), math.floor((box['x'] + box['w']) / size)
        y1, y2 = math.floor(box['y'] / size), math.floor((box['y'] + box['h']) / size)
        if (x2 - x1 + 1) * (y2 - y1 + 1) > 256:
            return None
        return [(x, y) for x in range(x1, x2 + 1) for y in range(y1, y2 + 1)]
    for index, box in enumerate(boxes):
        locations = keys(box)
        if locations is None:
            oversized.append(index)
        else:
            for key in locations:
                buckets[key].append(index)
    def query(box):
        locations = keys(box)
        if locations is None:
            return range(len(boxes))
        return set(oversized).union(*(buckets[key] for key in locations))
    return query


def color_for(key):
    value = 0
    for character in key:
        value = (value * 31 + ord(character)) & 0xffffffff
    return '#' + ''.join(f'{80 + ((value >> shift) & 255) % 176:02x}' for shift in (0, 8, 16))


def merged_annotation(box, *, name, color, output_id, channel_ids, channel_inputs):
    return {
        'x': box['x'], 'y': box['y'], 'w': box['w'], 'h': box['h'],
        'confidence': box['confidence'], 'name': name, 'color': color,
        'output_node_id': output_id, 'channel_ids': channel_ids, **channel_inputs,
    }


def phase_one_members(candidate):
    return candidate.get('members') or [candidate]


def apply_phase_one_table(boxes, mappings, input_outputs, input_colors):
    targets = {frozenset(row['sources']): row['target'] for row in mappings}
    for candidate in boxes:
        members = phase_one_members(candidate)
        combination = frozenset(member['input_id'] for member in members)
        default = next(iter(combination)) if len(combination) == 1 else None
        target = targets.get(combination, default)
        if target is None:
            for member in members:
                yield dict(member, output=input_outputs[member['input_id']])
        else:
            yield dict(candidate, output=input_outputs[target], color=input_colors.get(target) or color_for(target))


def evaluate_two_phase(cells, recipe, channels):
    output_channels = validate_recipe(recipe)
    channel_ids = {f'C{(channel.order_index or 0) + 1}': channel.id for channel in channels}
    if any(graph['channel'] not in channel_ids for graph in recipe['channels']):
        raise RecipeError('This image is missing a channel required by the recipe.')
    sources = {selector(source): source['id'] for source in recipe['inputs']}
    streams = defaultdict(list)
    valid_count = invalid_count = 0
    for index, cell in enumerate(cells):
        if not all(math.isfinite(cell[key]) for key in ('x', 'y', 'w', 'h')) or cell['w'] <= 0 or cell['h'] <= 0:
            invalid_count += 1
            continue
        valid_count += 1
        key = (cell['channel'], cell['detection_setting_id'], cell['name'], cell.get('sublabel') or '')
        if key in sources:
            confidence = cell.get('confidence')
            try:
                confidence = float(confidence) if confidence is not None else None
            except (TypeError, ValueError):
                confidence = None
            if confidence is not None and not math.isfinite(confidence):
                confidence = None
            input_id = sources[key]
            streams[input_id].append(dict(cell, confidence=confidence, sourceIndex=index, input_id=input_id))
    routed_count = sum(map(len, streams.values()))
    input_outputs = {}
    for source in recipe['inputs']:
        name = source['class_name']
        if source.get('sublabel'):
            name = f"{name} · {source['sublabel']}"
        input_outputs[source['id']] = {'id': source['id'], 'channelId': channel_ids[source['channel']], 'name': name}
    input_colors = {key: boxes[0].get('color') for key, boxes in streams.items()}
    outputs = [output for key, output in input_outputs.items() if key in output_channels]
    channel_boxes, audit = [], []
    for graph in recipe['channels']:
        nodes = {node['id']: node for node in graph['nodes']}
        incoming = defaultdict(list)
        for edge in graph['edges']:
            incoming[edge['target']].append(edge['source'])
        pending = list(nodes)
        while pending:
            ready = [key for key in pending if all(source not in pending for source in incoming[key])]
            for key in ready:
                node = nodes[key]
                boxes = [box for source in incoming[key] for box in streams[source]]
                if node['type'] == 'rule':
                    ordered = sorted(boxes, key=representative)
                    query = candidate_index(ordered)
                    consumed, result = set(), []
                    metric = 1 if node['ruleType'] == 'containment' else 0
                    for index, box in enumerate(ordered):
                        if index in consumed:
                            continue
                        matches = sorted(other for other in query(box) if other > index and other not in consumed and
                                         _overlap(box, ordered[other])[metric] > node['threshold'])
                        if matches:
                            members = [member for position in [index, *matches]
                                       for member in phase_one_members(ordered[position])]
                            result.append(dict(box, members=members))
                        else:
                            result.append(box)
                        consumed.update(matches)
                    audit.append({'node': key, 'input_count': len(boxes), 'produced': len(result)})
                    streams[key] = result
                else:
                    streams[key] = list(apply_phase_one_table(boxes, node['mappings'], input_outputs, input_colors))
                pending.remove(key)
        for node in graph['nodes']:
            if node['type'] == 'output':
                channel_boxes.extend(streams[node['id']])
        connected_sources = {edge['source'] for edge in graph['edges']}
        for source in recipe['inputs']:
            if source['channel'] != graph['channel'] or source['id'] in connected_sources:
                continue
            channel_boxes.extend(dict(box, output=input_outputs[source['id']]) for box in streams[source['id']])
    query = candidate_index(channel_boxes)
    def compatible(a, b):
        iou, containment = _overlap(a, b)
        return iou > recipe['cross_iou'] or containment > recipe['cross_containment']
    edges = []
    for index, box in enumerate(channel_boxes):
        for other in query(box):
            target = channel_boxes[other]
            if other <= index or box['output']['channelId'] == target['output']['channelId']:
                continue
            iou, containment = _overlap(box, target)
            if compatible(box, target):
                edges.append((-iou, -containment, index, other))
    parent = list(range(len(channel_boxes)))
    groups = {index: [box] for index, box in enumerate(channel_boxes)}
    def root(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index
    for _, __, index, other in sorted(edges):
        first, second = root(index), root(other)
        if first == second:
            continue
        if all(a['output']['channelId'] != b['output']['channelId'] and compatible(a, b)
               for a in groups[first] for b in groups[second]):
            parent[second] = first
            groups[first].extend(groups.pop(second))
    assignments = {frozenset(row['sources']): row['label'].strip() for row in recipe.get('output_assignments', [])}
    combinations, boxes = {}, []
    for group in groups.values():
        positives = {box['output']['channelId']: box['output'] for box in group}
        states = [positives.get(channel.id) for channel in channels]
        key = json.dumps([state['id'] if state else None for state in states], separators=(',', ':'), ensure_ascii=False)
        name = ' + '.join(f"C{(channel.order_index or 0) + 1}: {state['name']}" for channel, state in zip(channels, states) if state)
        label = assignments.get(frozenset(state['id'] for state in positives.values()))
        if key not in combinations:
            color = color_for(f'output-class:{label}') if label else None
            combinations[key] = dict(key=key, states=states, name=name, color=color, count=0)
        combination = combinations[key]
        combination['count'] += 1
        if not label:
            for member in group:
                output = member['output']
                boxes.append(merged_annotation(
                    member, name=output['name'], color=member.get('color') or color_for(output['id']),
                    output_id=output['id'], channel_ids=[member['channel']],
                    channel_inputs={channel: output['name'] if channel == member['channel'] else ''
                                    for channel in channel_ids},
                ))
            continue
        best = min(group, key=representative)
        channel_inputs = {channel: positives[channel_id]['name'] if channel_id in positives else ''
                          for channel, channel_id in channel_ids.items()}
        boxes.append(merged_annotation(
            best, name=label, color=combination['color'], output_id=f'output-class:{label}',
            channel_ids=[channel for channel, channel_id in channel_ids.items() if channel_id in positives],
            channel_inputs=channel_inputs,
        ))
    return dict(boxes=boxes, outputs=outputs, combinations=sorted(combinations.values(), key=lambda row: (-row['count'], row['name'])),
                sourceCount=valid_count, routedCount=routed_count, invalidCount=invalid_count,
                channelOutputCount=len(channel_boxes), audit=audit)
