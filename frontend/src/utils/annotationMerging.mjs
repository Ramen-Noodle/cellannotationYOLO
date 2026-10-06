// Recipe inputs use channel positions and names, never model-local numeric class IDs.
export const inputKey = (channel, name) => JSON.stringify([channel, name])
const area = b => Number(b.w ?? b.width) * Number(b.h ?? b.height)
export function overlap(a, b) {
  const intersection = Math.max(0, Math.min(a.x + Number(a.w ?? a.width), b.x + Number(b.w ?? b.width)) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + Number(a.h ?? a.height), b.y + Number(b.h ?? b.height)) - Math.max(a.y, b.y))
  return { iou: intersection / (area(a) + area(b) - intersection) || 0,
    containment: intersection / Math.min(area(a), area(b)) || 0 }
}
export function runMergeRecipe(boxes, rules, channels, declaredInputs = []) {
  const channelNames = new Map(channels.map(c => [c.id, `C${c.orderIndex + 1}`]))
  let active = boxes.map((b, i) => ({ ...b, channel_ids: [b.channel_id],
    mergeKey: inputKey(channelNames.get(b.channel_id), b.name), sources: [i], supports: [b] }))
  const available = new Map(declaredInputs.map(key => [key, new Set([JSON.parse(key)[0]])]))
  active.forEach(b => available.set(b.mergeKey, new Set([channelNames.get(b.channel_id)])))
  const audit = []
  rules.forEach((rule, index) => {
    const fail = message => { throw new Error(`Rule ${index + 1}: ${message}`) }
    if (!['within', 'across', 'rename'].includes(rule.scope)) fail('Choose a rule type.')
    const left = available.get(rule.sourceClass), right = available.get(rule.conditionClass)
    if (!left || (rule.scope !== 'rename' && !right)) fail('Choose available classes or an earlier rule output.')
    if (!rule.outputName?.trim()) fail('Enter an output class name.')
    if (available.has(`output:${rule.id}`)) fail('Rule IDs must be unique.')
    if (rule.scope === 'within' && (left.size !== 1 || right.size !== 1 || [...left][0] !== [...right][0])) fail('Within-channel inputs must share one channel.')
    if (rule.scope === 'across' && [...left].some(c => right.has(c))) fail('Across-channel inputs must use distinct channels.')
    if (!['larger', 'source', 'condition'].includes(rule.geometry)) fail('Choose which box to keep.')
    if (!['either', 'iou', 'containment'].includes(rule.relationship)) fail('Choose an overlap condition.')
    for (const value of [rule.iou, rule.containment]) {
      if (value === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1) fail('Thresholds must be between 0 and 1.')
    }
    const resultKey = `output:${rule.id}`
    available.set(resultKey, new Set([...left, ...(rule.scope === 'rename' ? [] : right)]))
    const matches = (a, b) => {
      const score = overlap(a, b)
      return (rule.relationship !== 'containment' && score.iou > Number(rule.iou)) ||
        (rule.relationship !== 'iou' && score.containment > Number(rule.containment))
    }
    const current = active
    const consumed = new Set(), output = []
    const candidates = current.map((b, i) => i).sort((a, b) => area(current[b]) - area(current[a]) || a - b)
    let removed = 0, renamed = 0
    for (const i of candidates) {
      const seed = current[i]
      if (consumed.has(i) || seed.mergeKey !== rule.sourceClass) continue
      const group = [i]
      if (rule.scope !== 'rename') {
        const eligible = candidates.filter(j => j !== i && !consumed.has(j) && current[j].mergeKey === rule.conditionClass)
          .sort((a, b) => overlap(seed, current[b]).iou - overlap(seed, current[a]).iou || a - b)
        for (const j of eligible) {
          const cell = current[j]
          // Require direct agreement with every member; never collapse an overlap chain.
          const compatible = group.every(k => rule.scope === 'across'
            ? current[k].supports.every(a => cell.supports.every(b => matches(a, b)))
            : matches(current[k], cell))
          if (!compatible) continue
          group.push(j)
          if (rule.scope === 'across') break // one cell per input population
        }
        if (group.length === 1) continue
      }
      group.forEach(k => consumed.add(k))
      const members = group.map(k => current[k])
      const representative = rule.geometry === 'source' ? seed : rule.geometry === 'condition' ? members[members.length - 1]
        : members.reduce((a, b) => area(a) >= area(b) ? a : b)
      output.push({ ...representative, name: rule.outputName.trim(), color: rule.outputColor || '#ffff00',
        class: resultKey, mergeKey: resultKey, channel_ids: [...new Set(members.flatMap(b => b.channel_ids))],
        sources: members.flatMap(b => b.sources), supports: members.flatMap(b => b.supports) })
      removed += members.length - 1
      renamed++
    }
    active = [...active.filter((b, i) => !consumed.has(i)), ...output]
    audit.push({ rule: rule.id, outputName: rule.outputName, removed, outputs: renamed })
  })
  return { boxes: active, audit }
}
export function exportMergedText(boxes, channels, size) {
  if (!(size.width > 0 && size.height > 0)) throw new Error('Load an image before exporting.')
  const names = new Map(channels.map(c => [c.id, `C${c.orderIndex + 1}`]))
  return boxes.map(b => {
    const w = Number(b.w ?? b.width), h = Number(b.h ?? b.height)
    const label = b.name.trim().replace(/\s+/g, '_')
    return `${b.channel_ids.map(id => names.get(id)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).join('+')} ${label} ${[(b.x + w / 2) / size.width, (b.y + h / 2) / size.height, w / size.width, h / size.height].join(' ')}`
  }).join('\n')
}
