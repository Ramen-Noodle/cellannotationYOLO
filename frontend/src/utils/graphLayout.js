import ELK from 'elkjs/lib/elk.bundled.js'

export async function layoutGraph(nodeIds, edges, width, height) {
  if (!nodeIds.length) return {}
  const ids = new Set(nodeIds)
  const result = await new ELK().layout({
    id: 'combine-graph',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '36',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    children: nodeIds.map(id => ({ id, width, height })),
    edges: edges.filter(({ source, target }) => ids.has(source) && ids.has(target))
      .map(({ id, source, target }) => ({ id, sources: [source], targets: [target] })),
  })
  return Object.fromEntries((result.children || []).map(({ id, x, y }) => [
    id, { x: Math.max(8, (x || 0) + 24), y: Math.max(8, (y || 0) + 24) },
  ]))
}

export const PHASE_ONE_NODE_WIDTH = 196
export const PHASE_ONE_NODE_HEIGHT = 84

export function layoutPhaseOneGraph(classes, graph) {
  const nodeIds = [...classes, ...graph.created].map(node => node.id)
  return layoutGraph(nodeIds, graph.edges, PHASE_ONE_NODE_WIDTH, PHASE_ONE_NODE_HEIGHT)
}
