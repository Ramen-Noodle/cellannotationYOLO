// Within-channel semantics from Combine_annotations/merge_rule_engine.py.
// CAT supplies pixel-space top-left boxes instead of normalized center boxes.
const area = box => box.w * box.h
const score = cell => Number.isFinite(cell.confidence) && cell.confidence >= 0 && cell.confidence <= 1 ? cell.confidence : -1
const coordinates = box => [box.x + box.w / 2, box.y + box.h / 2, box.w, box.h]
const geometry = box => ({ x: box.x, y: box.y, w: box.w, h: box.h })
const compareArrays = (a, b) => {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}
const compareCells = (a, b) => score(b) - score(a) || compareArrays(coordinates(a), coordinates(b)) || compareArrays(a.sources, b.sources)

function overlap(a, b) {
  const intersection = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return [intersection / (area(a) + area(b) - intersection), intersection / Math.min(area(a), area(b))]
}

function boxIndex(cells) {
  const dimensions = cells.map(cell => Math.max(cell.w, cell.h)).sort((a, b) => a - b)
  const size = Math.max(1, dimensions[Math.floor(dimensions.length / 2)] || 32)
  const buckets = new Map()
  const large = []
  const keys = cell => {
    const left = Math.floor(cell.x / size), right = Math.floor((cell.x + cell.w) / size)
    const top = Math.floor(cell.y / size), bottom = Math.floor((cell.y + cell.h) / size)
    if ((right - left + 1) * (bottom - top + 1) > 4096) return null
    const result = []
    for (let x = left; x <= right; x += 1) for (let y = top; y <= bottom; y += 1) result.push(`${x}:${y}`)
    return result
  }
  cells.forEach((cell, index) => {
    const covered = keys(cell)
    if (!covered) { large.push(index); return }
    covered.forEach(key => {
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push(index)
    })
  })
  return cell => {
    const covered = keys(cell)
    if (!covered) return cells.map((_, index) => index)
    return [...new Set([...large, ...covered.flatMap(key => buckets.get(key) || [])])].sort((a, b) => a - b)
  }
}

export function evaluateWithinChannel(cells, rules, catalog) {
  let active = cells.map((cell, index) => ({ ...cell, confidence: score(cell) < 0 ? null : cell.confidence, node: `${cell.channel}:${cell.label}`, sources: [index], supports: [geometry(cell)] }))
  if (active.some(cell => ![cell.x, cell.y, cell.w, cell.h].every(Number.isFinite) || cell.w <= 0 || cell.h <= 0)) {
    throw new Error('Annotations contain invalid bounding boxes.')
  }
  const audit = []
  for (const channel of ['C1', 'C2']) {
    const selected = active.filter(cell => cell.channel === channel)
    const query = boxIndex(selected)
    const order = selected.map((_, index) => index).sort((a, b) => area(selected[b]) - area(selected[a]) || compareCells(selected[a], selected[b]))
    const consumed = new Set()
    const merged = []
    for (const index of order) {
      if (consumed.has(index)) continue
      const group = [index, ...query(selected[index]).filter(other => other !== index && !consumed.has(other) && overlap(selected[index], selected[other])[1] > 0.95)]
      group.forEach(other => consumed.add(other))
      merged.push({ position: Math.min(...group), cell: { ...selected[index], sources: group.flatMap(other => selected[other].sources).sort((a, b) => a - b), supports: [geometry(selected[index])] } })
    }
    merged.sort((a, b) => a.position - b.position)
    let cursor = 0
    active = active.flatMap(cell => cell.channel === channel ? (cursor < merged.length ? [merged[cursor++].cell] : []) : [cell])
    audit.push({ label: `${channel} containment cleanup`, input: selected.length, output: merged.length, removed: selected.length - merged.length })
  }
  const available = new Map(catalog.map(entry => [entry.key, entry.channel]))
  const terminal = new Map(catalog.map(entry => [entry.key, { channel: entry.channel, label: entry.name }]))
  for (const rule of rules) {
    if (!rule.inputs.length || new Set(rule.inputs).size !== rule.inputs.length || rule.inputs.some(input => available.get(input) !== rule.channel)) throw new Error('Within-channel rules must reference classes or earlier results from the same channel.')
    if (available.has(rule.id)) throw new Error('Merge rules must have unique IDs.')
    if (!rule.label.trim() || /\s/.test(rule.label)) throw new Error('Result names must have no spaces. Use underscores between words.')
    if (![rule.iou, rule.containment].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('Overlap thresholds must be between 0 and 1.')
    if (!['neutral', 'dominance'].includes(rule.strategy)) throw new Error('Unknown merge strategy.')
    const rank = cell => rule.strategy === 'neutral' ? 0 : rule.inputs.indexOf(cell.node)
    const chosen = active.filter(cell => rule.inputs.includes(cell.node)).sort((a, b) => rank(a) - rank(b) || compareCells(a, b))
    const query = boxIndex(chosen)
    const consumed = new Set()
    const produced = []
    chosen.forEach((seed, index) => {
      if (consumed.has(index)) return
      const group = [index, ...query(seed).filter(other => {
        if (other === index || consumed.has(other)) return false
        const [iou, containment] = overlap(seed, chosen[other])
        return iou > rule.iou || containment > rule.containment
      })]
      group.forEach(other => consumed.add(other))
      // Every selected detection becomes the result class, including singletons.
      // Sorting picks the dominant input first, or highest confidence for neutral.
      produced.push({ ...seed, node: rule.id, label: rule.label, name: rule.label, originalLabel: rule.label,
        supports: [geometry(seed)], sources: group.flatMap(other => chosen[other].sources).sort((a, b) => a - b) })
    })
    const consumedCells = new Set([...consumed].map(index => chosen[index]))
    active = active.filter(cell => !consumedCells.has(cell)).concat(produced)
    available.set(rule.id, rule.channel)
    rule.inputs.forEach(input => terminal.delete(input))
    terminal.set(rule.id, { channel: rule.channel, label: rule.label })
    audit.push({ label: rule.label, input: chosen.length, output: produced.length, removed: chosen.length - produced.length })
  }
  return { cells: active, terminal: [...terminal.values()], audit }
}
