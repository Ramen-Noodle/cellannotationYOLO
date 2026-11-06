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

export const inputClassName = input => input.sublabel ? `${input.name} · ${input.sublabel}` : input.name

export function outputTableInputs(classes, incoming, outputId) {
  const visited = new Set()
  const pending = [outputId]
  while (pending.length) {
    const id = pending.pop()
    if (visited.has(id)) continue
    visited.add(id)
    for (const source of incoming.get(id) || []) pending.push(source)
  }
  return classes.filter(input => visited.has(input.id))
}

export function availableOutputMappings(inputs, mappings = []) {
  const ids = new Set(inputs.map(input => input.id))
  return mappings.filter(({ sources, target }) => sources.length && sources.every(id => ids.has(id)) &&
    (target === null || ids.has(target)))
}

export function terminalChannelClasses(channels, classes, graphs) {
  return channels.flatMap(channel => {
    const graph = graphs[channel.id] || {}
    const channelClasses = classes.filter(entry => entry.channelId === channel.id)
    const incoming = channelGraphIncoming(channelClasses, graph)
    const connectedSources = new Set([...incoming.values()].flatMap(sources => [...sources]))
    const outputIds = new Set(channelClasses.filter(input => !connectedSources.has(input.id)).map(input => input.id))
    for (const node of graph.created || []) {
      if (node.type !== 'output') continue
      const inputs = outputTableInputs(channelClasses, incoming, node.id)
      if (!inputs.length) continue
      const mappings = availableOutputMappings(inputs, node.mappings)
      const combinationsPerInput = 1n << BigInt(inputs.length - 1)
      for (const input of inputs) {
        // By default every combination containing this input can emit it.
        const redirected = mappings.filter(row => row.target && row.target !== input.id && row.sources.includes(input.id)).length
        if (BigInt(redirected) < combinationsPerInput || mappings.some(row => row.target === input.id)) outputIds.add(input.id)
      }
    }
    return channelClasses.filter(input => outputIds.has(input.id)).map(input => ({
      id: input.id,
      channelId: channel.id,
      name: inputClassName(input),
    }))
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
