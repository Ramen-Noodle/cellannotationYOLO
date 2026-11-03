/* global BigInt */
// Enumerate category possibilities without generating an exponential array.
export function combinationCatalog(channels, classes) {
  const options = channels.map(channel => ({
    channel: `C${(channel.order_index ?? 0) + 1}`,
    values: [null, ...new Set(classes.filter(entry => entry.channelId === channel.id).map(entry => entry.tableName))].sort((a, b) => {
      if (a === null) return -1
      if (b === null) return 1
      return a.localeCompare(b)
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
