"""Version 3 two-phase recipes. Evaluation uses database-independent pixel boxes."""
import json
import math
from collections import defaultdict
from annotation_merging import RecipeError, _overlap


def selector(source):
    return (source['channel'], source['detection_setting_id'], source['class_name'], source.get('sublabel', ''))


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
    seen_channels, node_ids, output_count = set(), set(sources), 0
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
            elif not isinstance(node.get('name'), str) or not node['name'].strip():
                raise RecipeError('Name every connected output.')
            else:
                output_count += 1
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
        pending = set(nodes)
        while pending:
            ready = {key for key in pending if not any(source in pending for source in incoming[key])}
            if not ready:
                raise RecipeError('Channel graph contains a cycle.')
            pending -= ready
        for node in graph['nodes']:
            if not incoming[node['id']]:
                raise RecipeError('Every saved rule and output must have an input.')
    if any(source['channel'] not in seen_channels for source in sources.values()) or not output_count:
        raise RecipeError('Recipe inputs must belong to a channel graph with named outputs.')
    threshold(recipe.get('cross_iou'))
    threshold(recipe.get('cross_containment'))


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


def evaluate_two_phase(cells, recipe, channels):
    validate_recipe(recipe)
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
            streams[sources[key]].append(dict(cell, confidence=confidence, sourceIndex=index))
    routed_count = sum(map(len, streams.values()))
    channel_boxes, outputs, audit = [], [], []
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
                        result.append(box)
                        consumed.update(other for other in query(box) if other > index and
                                        _overlap(box, ordered[other])[metric] > node['threshold'])
                    audit.append({'node': key, 'input_count': len(boxes), 'produced': len(result)})
                    streams[key] = result
                else:
                    output = {'id': key, 'channelId': channel_ids[graph['channel']], 'name': node['name'].strip()}
                    outputs.append(output)
                    streams[key] = [dict(box, output=output) for box in boxes]
                pending.remove(key)
        for node in graph['nodes']:
            if node['type'] == 'output':
                channel_boxes.extend(streams[node['id']])
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
    combinations, boxes = {}, []
    for group in groups.values():
        positives = {box['output']['channelId']: box['output'] for box in group}
        states = [positives.get(channel.id) for channel in channels]
        key = json.dumps([state['id'] if state else None for state in states], separators=(',', ':'), ensure_ascii=False)
        name = ' + '.join(f"C{(channel.order_index or 0) + 1}: {state['name']}" for channel, state in zip(channels, states) if state)
        if key not in combinations:
            combinations[key] = dict(key=key, states=states, name=name, color=color_for(key), count=0)
        combination = combinations[key]
        combination['count'] += 1
        best = min(group, key=representative)
        box = {field: best[field] for field in ('x', 'y', 'w', 'h', 'confidence')}
        box.update(name=name, color=combination['color'], output_node_id=key,
                   channel_ids=[f'C{(channel.order_index or 0) + 1}' for channel in channels if channel.id in positives])
        boxes.append(box)
    return dict(boxes=boxes, outputs=outputs, combinations=sorted(combinations.values(), key=lambda row: (-row['count'], row['name'])),
                sourceCount=valid_count, routedCount=routed_count, invalidCount=invalid_count,
                channelOutputCount=len(channel_boxes), audit=audit)
