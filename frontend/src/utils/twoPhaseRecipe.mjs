import { availableOutputMappings, channelGraphIncoming, outputAssignmentKey, outputTableInputs, terminalChannelClasses } from './twoPhaseCombinations.mjs'

const channelName = channel => `C${(channel.order_index ?? 0) + 1}`
const sourceKey = source => JSON.stringify([source.channel, source.detection_setting_id, source.class_name, source.sublabel || ''])

export function buildTwoPhaseRecipe(channels, classes, graphs, thresholds, outputAssignments) {
  for (const value of Object.values(thresholds)) {
    if (value === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1) throw new Error('Cross-channel thresholds must be between 0 and 1.')
  }
  const outputs = terminalChannelClasses(channels, classes, graphs)
  if (!outputs.length) throw new Error('Preview needs an unconnected input class or a connected output table.')
  const inputs = []
  const recipeChannels = channels.map(channel => {
    const graph = graphs[channel.id] || {}
    const channelClasses = classes.filter(source => source.channelId === channel.id)
    const incoming = channelGraphIncoming(channelClasses, graph)
    const used = new Set()
    const visit = id => {
      if (used.has(id)) return
      used.add(id)
      for (const source of incoming.get(id) || []) visit(source)
    }
    const tables = new Map()
    for (const node of graph.created || []) {
      if (node.type !== 'output') continue
      const tableInputs = outputTableInputs(channelClasses, incoming, node.id)
      if (!tableInputs.length) continue
      tables.set(node.id, availableOutputMappings(tableInputs, node.mappings))
      visit(node.id)
    }
    outputs.filter(output => output.channelId === channel.id).forEach(output => visit(output.id))
    inputs.push(...channelClasses.filter(source => used.has(source.id)).map(source => ({
      id: source.id, channel: channelName(channel), detection_setting_id: source.settingId,
      class_name: source.name, sublabel: source.sublabel,
    })))
    return {
      channel: channelName(channel),
      nodes: (graph.created || []).filter(node => used.has(node.id)).map(node => {
        if (node.type === 'output') return { id: node.id, type: 'output', mappings: tables.get(node.id) }
        if (node.threshold === '' || !Number.isFinite(Number(node.threshold))) throw new Error('Enter a valid overlap threshold.')
        return { id: node.id, type: 'rule', ruleType: node.ruleType, threshold: Number(node.threshold) }
      }),
      edges: (graph.edges || []).filter(edge => used.has(edge.source) && used.has(edge.target))
        .map(({ source, target }) => ({ source, target })),
    }
  })
  const outputIds = new Set(outputs.map(output => output.id))
  const output_assignments = Object.entries(outputAssignments).flatMap(([key, label]) => {
    const sources = JSON.parse(key)
    return sources.every(id => outputIds.has(id)) ? [{ sources, label }] : []
  })
  return {
    version: 3, inputs, channels: recipeChannels, output_assignments,
    cross_iou: Number(thresholds.iou), cross_containment: Number(thresholds.containment),
  }
}

export function restoreTwoPhaseRecipe(recipe, channels, classes) {
  if (recipe.version !== 3) throw new Error('This recipe uses an older format.')
  const byName = new Map(channels.map(channel => [channelName(channel), channel]))
  const sources = new Map(classes.map(source => [sourceKey({
    channel: channelName(channels.find(channel => channel.id === source.channelId)),
    detection_setting_id: source.settingId, class_name: source.name, sublabel: source.sublabel,
  }), source.id]))
  const sourceIds = new Map(recipe.inputs.map(source => {
    const id = sources.get(sourceKey(source))
    if (!id) throw new Error(`This image is missing ${source.channel} / ${source.class_name} from the recipe's detection setting.`)
    return [source.id, id]
  }))
  const remapInput = id => sourceIds.get(id) || id
  const graphs = Object.fromEntries(recipe.channels.map(graph => {
    const channel = byName.get(graph.channel)
    if (!channel) throw new Error(`This image is missing ${graph.channel}.`)
    return [channel.id, {
      created: graph.nodes.map((node, index) => {
        const layout = { color: '#cbd5e1', x: 280 + Math.floor(index / 4) * 230, y: 32 + (index % 4) * 108 }
        if (node.type !== 'output') return { ...node, ...layout, name: 'IoU node' }
        if (!Array.isArray(node.mappings)) throw new Error('Phase 1 output nodes must have combination tables.')
        return { id: node.id, type: 'output', name: 'Output table', ...layout,
          mappings: node.mappings.map(({ sources, target }) => ({
            sources: sources.map(remapInput), target: target === null ? null : remapInput(target),
          })),
        }
      }),
      edges: graph.edges.map(edge => {
        const source = sourceIds.get(edge.source) || edge.source
        return { id: `${source}->${edge.target}`, source, target: edge.target }
      }),
      positions: {}, zoom: 1,
    }]
  }))
  const outputAssignments = Object.fromEntries((recipe.output_assignments || []).map(({ sources, label }) => [
    outputAssignmentKey(sources.map(remapInput)), label,
  ]))
  return { graphs, outputAssignments }
}
