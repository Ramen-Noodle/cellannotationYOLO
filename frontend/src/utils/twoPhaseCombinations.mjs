/* global BigInt */
export function channelGraphIncoming(classes, graph) {
  const sources = new Set(classes.map(entry => entry.id))
  const nodes = graph.created || []
  const targets = new Set(nodes.map(node => node.id))
  nodes.filter(node => node.type === 'rule').forEach(node => sources.add(node.id))
  const incoming = new Map()
  for (const { source, target } of graph.edges || []) {
    if (!sources.has(source) || !targets.has(target)) continue
    if (!incoming.has(target)) incoming.set(target, new Set())
    incoming.get(target).add(source)
  }
  return incoming
}

export function terminalChannelClasses(channels, classes, graphs) {
  return channels.flatMap(channel => {
    const graph = graphs[channel.id] || {}
    const channelClasses = classes.filter(entry => entry.channelId === channel.id)
    const inputs = new Set(channelClasses.map(entry => entry.id))
    const created = graph.created || []
    const incoming = channelGraphIncoming(channelClasses, graph)
    const hasInput = (id, visited = new Set()) => {
      if (inputs.has(id)) return true
      if (visited.has(id)) return false
      visited.add(id)
      return [...(incoming.get(id) || [])].some(source => hasInput(source, visited))
    }
    const namedOutputs = created.filter(node => node.type === 'output' && node.name?.trim() && hasInput(node.id))
      .map(node => ({ id: node.id, channelId: channel.id, name: node.name.trim() }))
    const connectedSources = new Set([...incoming.values()].flatMap(sources => [...sources]))
    const directOutputs = channelClasses.filter(input => !connectedSources.has(input.id)).map(input => ({
      id: input.id,
      channelId: channel.id,
      name: input.sublabel ? `${input.name} · ${input.sublabel}` : input.name,
    }))
    return [...namedOutputs, ...directOutputs]
  })
}

export const combinationKey = states => JSON.stringify(states.map(output => output?.id ?? null))
export const outputAssignmentKey = ids => JSON.stringify([...ids].sort())

// Enumerate category possibilities without generating an exponential array.
export function combinationCatalog(channels, outputs) {
  const options = channels.map(channel => ({
    channel: `C${(channel.order_index ?? 0) + 1}`,
    values: [null, ...outputs.filter(entry => entry.channelId === channel.id)].sort((a, b) => {
      if (a === null) return -1
      if (b === null) return 1
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    }),
  }))
  const total = options.reduce((count, entry) => count * BigInt(entry.values.length), 1n) - 1n
  const rowAt = index => {
    let remaining = index + 1n // zero is the excluded all-negative combination
    const states = Array(options.length)
    for (let position = options.length - 1; position >= 0; position -= 1) {
      const radix = BigInt(options[position].values.length)
      states[position] = options[position].values[Number(remaining % radix)]
      remaining /= radix
    }
    return states
  }
  return { options, total, rowAt }
}
