"""Graph-based annotation recipe evaluation.

Recipes describe class nodes, rule nodes, and directed connections.  This
module deliberately has no Flask or database dependencies so the same
evaluator can be used by preview and future saved-recipe endpoints.
"""
from copy import deepcopy
from functools import lru_cache
import json
import numpy as np


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


def _overlaps_many(candidates, pairs):
    first = np.asarray([_bounds(candidates[index]) for index, _ in pairs], dtype=float)
    second = np.asarray([_bounds(candidates[index]) for _, index in pairs], dtype=float)
    intersection = np.maximum(0.0, np.minimum(first[:, 2], second[:, 2]) - np.maximum(first[:, 0], second[:, 0])) * np.maximum(0.0, np.minimum(first[:, 3], second[:, 3]) - np.maximum(first[:, 1], second[:, 1]))
    first_area = np.maximum(0.0, first[:, 2] - first[:, 0]) * np.maximum(0.0, first[:, 3] - first[:, 1])
    second_area = np.maximum(0.0, second[:, 2] - second[:, 0]) * np.maximum(0.0, second[:, 3] - second[:, 1])
    union = first_area + second_area - intersection
    iou = np.divide(intersection, union, out=np.zeros_like(intersection), where=union > 0)
    minimum = np.minimum(first_area, second_area)
    containment = np.divide(intersection, minimum, out=np.zeros_like(intersection), where=minimum > 0)
    return iou, containment


def _channels(cell):
    return set(cell.get('channel_ids') or [cell.get('channel')])


def _matches(first, second, rule):
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


def _input_node_id(cell, input_ids):
    node_id = cell.get('node_id')
    if node_id in input_ids:
        return node_id
    parent_id = cell.get('output_parent_id')
    if parent_id in input_ids:
        return parent_id
    return None


def _output_variant_id(node_id, mapping):
    key = mapping.get('class_id') or mapping.get('label')
    return f'{node_id}::class::{key}' if key else None


def _output_variant_ids(node_id, node):
    variants = []
    for mapping in node.get('output_mappings') or []:
        if mapping.get('exclude') is True:
            continue
        variant_id = _output_variant_id(node_id, mapping)
        if variant_id and variant_id not in variants:
            variants.append(variant_id)
    return variants


def _rule_input_ids(rule_id, nodes, incoming):
    input_ids = set()
    for source_id in incoming[rule_id]:
        source_node = nodes[source_id]
        if source_node.get('role') == 'output':
            input_ids.update(_output_variant_ids(source_id, source_node))
        else:
            input_ids.add(source_id)
    return input_ids


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


@lru_cache(maxsize=128)
def _validated_recipe(serialized_recipe):
    return _validate(json.loads(serialized_recipe))


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

    # Respect rule-node dependencies, but when multiple rules are ready to
    # run, evaluate the one covering the largest source set first. This lets a
    # broad rule claim a valid multi-channel group before fallback rules run.
    dependencies = {
        rule_id: {source for source in incoming[rule_id] if nodes[source]['type'] == 'rule'}
        for rule_id in rule_ids
    }
    remaining = set(rule_ids)
    ordered = []
    while remaining:
        ready = [rule_id for rule_id in remaining if not (dependencies[rule_id] & remaining)]
        if not ready:
            raise RecipeError('Recipe contains a cycle.')
        ready.sort(key=lambda node_id: (-len(leaves(node_id)), rule_ids.index(node_id)))
        chosen = ready[0]
        ordered.append(chosen)
        remaining.remove(chosen)
    return ordered


def _convert(active, source_id, target_id, target_node, audit):
    changed = 0
    for cell in active:
        if cell['node_id'] == source_id or cell.get('output_parent_id') == source_id:
            cell['node_id'] = target_id
            cell.pop('output_parent_id', None)
            cell['name'] = _node_label(target_node)
            cell['color'] = _node_color(target_node, cell.get('color', '#ffffff'))
            changed += 1
    if changed:
        audit.append({'operation': 'class conversion', 'source': source_id, 'target': target_id, 'count': changed})


def _compatible_groups(candidates, rule_node, input_ids):
    """Return all mutually compatible multi-source groups for one rule."""
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
    threshold = float(rule_node.get('threshold', 0.25))
    if threshold <= 0:
        pair_candidates = [(index, other) for index in range(len(candidates)) for other in range(index + 1, len(candidates))]
    else:
        cell_size = max(1.0, float(np.median([max(float(cell.get('w', 0)), float(cell.get('h', 0))) for cell in candidates] or [1.0])))
        buckets = {}
        for index, cell in enumerate(candidates):
            x1, y1, x2, y2 = _bounds(cell)
            for grid_x in range(int(x1 // cell_size), int(x2 // cell_size) + 1):
                for grid_y in range(int(y1 // cell_size), int(y2 // cell_size) + 1):
                    buckets.setdefault((grid_x, grid_y), []).append(index)
        pair_candidates = sorted({tuple(sorted((first, second))) for bucket in buckets.values() for first in bucket for second in bucket if first < second})
    overlap_iou, overlap_containment = _overlaps_many(candidates, pair_candidates) if pair_candidates else (np.array([]), np.array([]))
    for pair_index, (index, other) in enumerate(pair_candidates):
        first, second = candidates[index], candidates[other]
        if _input_node_id(first, input_ids) == _input_node_id(second, input_ids):
            continue
        iou, containment = overlap_iou[pair_index], overlap_containment[pair_index]
        matched = containment >= threshold if rule_node.get('rule_type', 'iou') == 'containment' else iou >= threshold
        if matched:
            pairs.append((-max(iou, containment), index, other))
    for _, first_index, second_index in sorted(pairs):
        first_root, second_root = root(first_index), root(second_index)
        if first_root == second_root:
            continue
        first_group, second_group = groups[first_root], groups[second_root]
        first_cells = [candidates[index] for index in first_group]
        second_cells = [candidates[index] for index in second_group]
        if not all(_matches(first, second, rule_node) for first in first_cells for second in second_cells):
            continue
        parent[second_root] = first_root
        groups[first_root] |= groups.pop(second_root)

    valid_groups = []
    for group_indices in groups.values():
        group = [candidates[index] for index in sorted(group_indices)]
        input_members = {_input_node_id(cell, input_ids) for cell in group}
        valid_groups.append(group)
    return valid_groups


def _explicit_subset_reservations(active, input_ids, rule_node, rule_nodes, nodes, incoming):
    """Find boxes reserved by explicit smaller class-only rules.

    A broad rule may cover any compatible subset, but a compatible group that
    belongs to a separately defined smaller rule must be left for that rule.
    Direct class conversions are intentionally excluded here so they remain
    fallback behavior after multi-source merges.
    """
    reserved = set()
    current_inputs = set(input_ids)
    for other_id, other_node in rule_nodes.items():
        other_inputs = _rule_input_ids(other_id, nodes, incoming)
        if other_node is rule_node or not other_inputs < current_inputs:
            continue
        if any(source_node in rule_nodes for source_node in other_inputs):
            continue
        candidates = [cell for cell in active if _input_node_id(cell, other_inputs) is not None]
        for group in _compatible_groups(candidates, other_node, other_inputs):
            reserved.update(cell['source_index'] for cell in group)
    return reserved


def _apply_rule(active, rule_id, rule_node, input_ids, output_id, output_node, audit, reserved_source_indices=None):
    reserved_source_indices = reserved_source_indices or set()
    candidates = [cell for cell in active
                  if _input_node_id(cell, input_ids) is not None
                  and cell['source_index'] not in reserved_source_indices]
    valid_groups = _compatible_groups(candidates, rule_node, input_ids)
    consumed = set()
    produced = []
    for group in valid_groups:
        group_input_ids = sorted({_input_node_id(item, input_ids) for item in group})
        mapping = None
        if output_node and output_node.get('output_mappings'):
            mapping = next((candidate for candidate in output_node['output_mappings']
                            if set(candidate.get('sources') or []) == set(group_input_ids)), None)
        if mapping and mapping.get('pass_through') is True:
            produced.extend(deepcopy(item) for item in group)
            continue
        consumed.update(item['source_index'] for item in group)
        representative = max(group, key=lambda item: (_area(item), -(item.get('confidence') or -1)))
        merged = deepcopy(representative)
        if mapping and mapping.get('exclude') is True:
            continue
        merged['name'] = (mapping.get('label') if mapping and mapping.get('label') else _node_label(output_node)) if output_node else _node_label(rule_node)
        if output_node:
            merged['color'] = _node_color(mapping, _node_color(output_node, merged.get('color', '#ffffff'))) if mapping else _node_color(output_node, merged.get('color', '#ffffff'))
            if output_node.get('role') == 'output':
                variant_id = _output_variant_id(output_id, mapping) if mapping else None
                merged['node_id'] = variant_id or f"{output_id}::{ '|'.join(group_input_ids) }"
                merged['output_parent_id'] = output_id
                merged['output_sources'] = group_input_ids
            else:
                merged['node_id'] = output_id
        else:
            merged['node_id'] = output_id
        merged['channel_ids'] = sorted(set().union(*(_channels(item) for item in group)))
        merged['members'] = [item['source_index'] for item in group]
        produced.append(merged)
    if consumed:
        active[:] = [cell for cell in active if cell['source_index'] not in consumed]
        active.extend(produced)
    audit.append({'operation': 'rule', 'rule': rule_id, 'inputs': sorted(input_ids), 'produced': len(produced), 'consumed': len(consumed), 'reserved': len(reserved_source_indices)})


def _evaluate_recipe_once(cells, recipe, include_members=False):
    """Evaluate a recipe over one complete set of candidate boxes."""
    serialized_recipe = json.dumps(recipe, sort_keys=True, separators=(',', ':'))
    nodes, incoming, outgoing = _validated_recipe(serialized_recipe)
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
    ordered_rules = _rule_order(rule_ids, nodes, incoming)
    for rule_id in ordered_rules:
        rule_node = nodes[rule_id]
        input_ids = _rule_input_ids(rule_id, nodes, incoming)
        if len(input_ids) < 2:
            raise RecipeError(f'Rule {rule_id} needs at least two inputs.')
        output_classes = [target for target in outgoing[rule_id] if nodes[target]['type'] == 'class']
        if len(output_classes) > 1:
            raise RecipeError(f'Rule {rule_id} has multiple output classes.')
        # Keep the rule id as the internal result id so a later rule can take
        # this result as an input.  Apply the output class label immediately,
        # while delaying the class conversion until the result is terminal.
        output_node = nodes.get(output_classes[0]) if output_classes else rule_node
        reserved = _explicit_subset_reservations(
            active, input_ids, rule_node,
            {candidate_id: nodes[candidate_id] for candidate_id in rule_ids},
            nodes,
            incoming,
        )
        result_id = output_classes[0] if output_node and output_node.get('role') == 'output' else rule_id
        _apply_rule(active, rule_id, rule_node, input_ids, result_id, output_node, audit, reserved)
    direct_edges.extend((source, target) for source, targets in outgoing.items() for target in targets
                        if nodes[source]['type'] == 'rule' and nodes[target]['type'] == 'class')
    for source, target in direct_edges:
        _convert(active, source, target, nodes[target], audit)

    for cell in active:
        cell['output_node_id'] = cell['node_id']
        if include_members:
            cell['members'] = cell.get('members') or [cell['source_index']]
        cell.pop('source_index', None)
        cell.pop('node_id', None)
    return {'boxes': active, 'audit': audit}


def evaluate_recipe(cells, recipe, image_size=None, tile_size=1024):
    """Evaluate a recipe, tiling large images while preserving boundary matches."""
    if not image_size or max(image_size) <= tile_size:
        return _evaluate_recipe_once(cells, recipe)

    indexed_cells = [deepcopy(cell) for cell in cells]
    for index, cell in enumerate(indexed_cells):
        cell.setdefault('source_index', index)
    max_dimension = max([max(float(cell.get('w', 0)), float(cell.get('h', 0))) for cell in indexed_cells] or [0])
    overlap = max(64.0, max_dimension)
    width, height = image_size
    boxes = []
    audits = []
    seen = set()
    for top in range(0, int(height), tile_size):
        for left in range(0, int(width), tile_size):
            right, bottom = min(width, left + tile_size), min(height, top + tile_size)
            expanded_left, expanded_top = max(0, left - overlap), max(0, top - overlap)
            expanded_right, expanded_bottom = min(width, right + overlap), min(height, bottom + overlap)
            tile_cells = []
            for cell in indexed_cells:
                x1, y1, x2, y2 = _bounds(cell)
                if x2 >= expanded_left and x1 <= expanded_right and y2 >= expanded_top and y1 <= expanded_bottom:
                    tile_cells.append(deepcopy(cell))
            if not tile_cells:
                continue
            result = _evaluate_recipe_once(tile_cells, recipe, include_members=True)
            audits.extend(result['audit'])
            for box in result['boxes']:
                members = tuple(sorted(box.get('members') or []))
                key = (members, box.get('output_node_id'), box.get('name'), box.get('color'))
                if key in seen:
                    continue
                seen.add(key)
                box.pop('members', None)
                boxes.append(box)
    return {'boxes': boxes, 'audit': audits}
