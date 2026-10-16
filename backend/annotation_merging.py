"""Graph-based annotation recipe evaluation.

Recipes describe class nodes, rule nodes, and directed connections.  This
module deliberately has no Flask or database dependencies so the same
evaluator can be used by preview and future saved-recipe endpoints.
"""
from copy import deepcopy


class RecipeError(ValueError):
    """Raised when a graph recipe cannot be evaluated safely."""


def _area(box):
    return max(0.0, float(box.get('w', 0))) * max(0.0, float(box.get('h', 0)))


def _bounds(box):
    return (float(box.get('x', 0)), float(box.get('y', 0)),
            float(box.get('x', 0)) + float(box.get('w', 0)),
            float(box.get('y', 0)) + float(box.get('h', 0)))


def _overlap(first, second):
    ax1, ay1, ax2, ay2 = _bounds(first)
    bx1, by1, bx2, by2 = _bounds(second)
    intersection = max(0.0, min(ax2, bx2) - max(ax1, bx1)) * max(0.0, min(ay2, by2) - max(ay1, by1))
    first_area, second_area = _area(first), _area(second)
    union = first_area + second_area - intersection
    iou = intersection / union if union > 0 else 0.0
    containment = intersection / min(first_area, second_area) if min(first_area, second_area) > 0 else 0.0
    return iou, containment


def _channels(cell):
    return set(cell.get('channel_ids') or [cell.get('channel')])


def _matches(first, second, rule):
    if _channels(first) & _channels(second):
        return False
    iou, containment = _overlap(first, second)
    threshold = float(rule.get('threshold', 0.25))
    if rule.get('rule_type', 'iou') == 'containment':
        return containment >= threshold
    return iou >= threshold


def _node_label(node):
    return str(node.get('label') or node.get('name') or node.get('id'))


def _node_color(node, fallback='#ffffff'):
    color = node.get('color') if isinstance(node, dict) else None
    return color if isinstance(color, str) and color.strip() else fallback


def _validate(recipe):
    if not isinstance(recipe, dict) or recipe.get('version') != 2:
        raise RecipeError('Recipe version 2 is required.')
    nodes = recipe.get('nodes')
    edges = recipe.get('edges')
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise RecipeError('A recipe must contain nodes and edges.')
    by_id = {}
    for node in nodes:
        if not isinstance(node, dict) or not node.get('id') or node.get('type') not in ('class', 'rule'):
            raise RecipeError('Every node needs an id and a class or rule type.')
        if node['id'] in by_id:
            raise RecipeError(f"Duplicate node id: {node['id']}")
        by_id[node['id']] = node
        if node['type'] == 'rule':
            if node.get('rule_type', 'iou') not in ('iou', 'containment'):
                raise RecipeError(f"Unknown rule type for {node['id']}.")
            threshold = float(node.get('threshold', 0.25))
            if not 0 <= threshold <= 1:
                raise RecipeError(f"Rule threshold must be between 0 and 1: {node['id']}.")
    incoming = {node_id: [] for node_id in by_id}
    outgoing = {node_id: [] for node_id in by_id}
    for edge in edges:
        if not isinstance(edge, dict) or edge.get('source') not in by_id or edge.get('target') not in by_id:
            raise RecipeError('Every edge must reference existing nodes.')
        source, target = edge['source'], edge['target']
        if source == target:
            raise RecipeError('Recipes cannot contain self-connections.')
        if target in outgoing[source]:
            raise RecipeError(f'Duplicate connection: {source} -> {target}')
        outgoing[source].append(target)
        incoming[target].append(source)
    return by_id, incoming, outgoing


def _rule_order(rule_ids, nodes, incoming):
    memo = {}

    def leaves(node_id, visiting=None):
        if node_id in memo:
            return memo[node_id]
        visiting = set(visiting or ())
        if node_id in visiting:
            raise RecipeError('Recipe contains a cycle.')
        visiting.add(node_id)
        sources = incoming[node_id]
        if nodes[node_id]['type'] == 'class':
            result = {node_id}
        else:
            result = set()
            for source in sources:
                result.update(leaves(source, visiting))
        memo[node_id] = result
        return result

    for rule_id in rule_ids:
        leaves(rule_id)
    return sorted(rule_ids, key=lambda node_id: (len(leaves(node_id)), rule_ids.index(node_id)))


def _convert(active, source_id, target_id, target_node, audit):
    changed = 0
    for cell in active:
        if cell['node_id'] == source_id:
            cell['node_id'] = target_id
            cell['name'] = _node_label(target_node)
            cell['color'] = _node_color(target_node, cell.get('color', '#ffffff'))
            changed += 1
    if changed:
        audit.append({'operation': 'class conversion', 'source': source_id, 'target': target_id, 'count': changed})


def _apply_rule(active, rule_id, rule_node, input_ids, output_id, output_node, audit):
    candidates = [cell for cell in active if cell['node_id'] in input_ids]
    candidates.sort(key=lambda cell: (-_area(cell), cell['source_index']))
    parent = list(range(len(candidates)))
    groups = {index: {index} for index in range(len(candidates))}

    def root(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    # Build all compatible groups before assigning outputs.  This prevents a
    # singleton fallback from consuming a box that belongs to a stronger
    # cross-channel overlap.
    pairs = []
    for index, first in enumerate(candidates):
        for other in range(index + 1, len(candidates)):
            second = candidates[other]
            if first['node_id'] == second['node_id'] or _channels(first) & _channels(second):
                continue
            if _matches(first, second, rule_node):
                iou, containment = _overlap(first, second)
                pairs.append((-max(iou, containment), index, other))
    for _, first_index, second_index in sorted(pairs):
        first_root, second_root = root(first_index), root(second_index)
        if first_root == second_root:
            continue
        first_group, second_group = groups[first_root], groups[second_root]
        first_cells = [candidates[index] for index in first_group]
        second_cells = [candidates[index] for index in second_group]
        if set().union(*(_channels(cell) for cell in first_cells)) & set().union(*(_channels(cell) for cell in second_cells)):
            continue
        if not all(_matches(first, second, rule_node) for first in first_cells for second in second_cells):
            continue
        parent[second_root] = first_root
        groups[first_root] |= groups.pop(second_root)

    consumed = set()
    produced = []
    require_all = rule_node.get('apply_to_subsets') is False
    for group_indices in groups.values():
        group = [candidates[index] for index in sorted(group_indices)]
        input_members = {cell['node_id'] for cell in group}
        if len(group) < 2 or (require_all and input_members != set(input_ids)):
            continue
        consumed.update(item['source_index'] for item in group)
        representative = max(group, key=lambda item: (_area(item), -(item.get('confidence') or -1)))
        merged = deepcopy(representative)
        merged['node_id'] = output_id
        merged['name'] = _node_label(output_node) if output_node else _node_label(rule_node)
        if output_node:
            merged['color'] = _node_color(output_node, merged.get('color', '#ffffff'))
        merged['channel_ids'] = sorted(set().union(*(_channels(item) for item in group)))
        merged['members'] = [item['source_index'] for item in group]
        produced.append(merged)
    if consumed:
        active[:] = [cell for cell in active if cell['source_index'] not in consumed]
        active.extend(produced)
    audit.append({'operation': 'rule', 'rule': rule_id, 'inputs': sorted(input_ids), 'produced': len(produced), 'consumed': len(consumed), 'apply_to_subsets': not require_all})


def evaluate_recipe(cells, recipe):
    """Evaluate a validated graph recipe over pixel-space annotation boxes."""
    nodes, incoming, outgoing = _validate(recipe)
    active = [deepcopy(cell) for cell in cells]
    for index, cell in enumerate(active):
        cell.setdefault('source_index', index)
    audit = []

    # Direct class-to-class edges are fallback conversions.  They run after
    # cross-channel grouping so they cannot consume a box before an overlap
    # rule gets a chance to match it.
    direct_edges = [(source, target) for source, targets in outgoing.items() for target in targets
                    if nodes[source]['type'] == 'class' and nodes[target]['type'] == 'class']

    rule_ids = [node_id for node_id, node in nodes.items() if node['type'] == 'rule']
    for rule_id in _rule_order(rule_ids, nodes, incoming):
        rule_node = nodes[rule_id]
        input_ids = set(incoming[rule_id])
        if len(input_ids) < 2:
            raise RecipeError(f'Rule {rule_id} needs at least two inputs.')
        output_classes = [target for target in outgoing[rule_id] if nodes[target]['type'] == 'class']
        if len(output_classes) > 1:
            raise RecipeError(f'Rule {rule_id} has multiple output classes.')
        # Keep the rule id as the internal result id so a later rule can take
        # this result as an input.  Apply the output class label immediately,
        # while delaying the class conversion until the result is terminal.
        output_node = nodes.get(output_classes[0]) if output_classes else rule_node
        _apply_rule(active, rule_id, rule_node, input_ids, rule_id, output_node, audit)
    direct_edges.extend((source, target) for source, targets in outgoing.items() for target in targets
                        if nodes[source]['type'] == 'rule' and nodes[target]['type'] == 'class')
    for source, target in direct_edges:
        _convert(active, source, target, nodes[target], audit)

    for cell in active:
        cell['output_node_id'] = cell['node_id']
        cell.pop('source_index', None)
        cell.pop('node_id', None)
    return {'boxes': active, 'audit': audit}
