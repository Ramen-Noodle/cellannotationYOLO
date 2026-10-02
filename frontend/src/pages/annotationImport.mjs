// Channel-aware analysis annotations; no dependency on detector model class IDs.
export function parseChannelAnnotations(text, imageSize, channels) {
  const { width, height } = imageSize
  if (!(width > 0 && height > 0)) throw new Error('Open an image before importing annotations.')
  const byLabel = new Map(channels.map(c => [`C${c.orderIndex + 1}`, c]))
  const boxes = []
  text.split(/\r?\n/).forEach((line, index) => {
    line = line.trim()
    if (!line || line.startsWith('#')) return
    const fail = message => { throw new Error(`Line ${index + 1}: ${message}`) }
    const parts = line.split(/\s+/)
    if (parts.length !== 6 && parts.length !== 7) fail('Expected channel class x y width height [confidence].')
    if (!/^C[1-9]\d*(\+C[1-9]\d*)*$/.test(parts[0])) fail('Use C1, C2, etc., or C1+C2 for a merged cell.')
    const labels = parts[0].split('+')
    if (new Set(labels).size !== labels.length) fail('Repeated channel in merged cell.')
    const mapped = labels.map(label => {
      if (!byLabel.has(label)) fail(`Channel ${label} is not present in this image.`)
      return byLabel.get(label)
    })
    const [cx, cy, w, h] = parts.slice(2, 6).map(Number)
    if (![cx, cy, w, h].every(Number.isFinite) || cx < 0 || cx > 1 || cy < 0 || cy > 1 ||
        w <= 0 || w > 1 || h <= 0 || h > 1) fail('Invalid normalized box coordinates.')
    // Allow rounding at six-decimal YOLO precision, but reject wrong coordinate spaces.
    if (cx - w / 2 < -0.000002 || cy - h / 2 < -0.000002 ||
        cx + w / 2 > 1.000002 || cy + h / 2 > 1.000002) fail('Box extends beyond the image.')
    const confidence = parts.length === 6 || parts[6] === 'null' ? null : Number(parts[6])
    if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) fail('Confidence must be 0 to 1 or null.')
    boxes.push({ x: (cx - w / 2) * width, y: (cy - h / 2) * height,
      w: w * width, h: h * height, class: parts[1], confidence,
      channel_id: mapped[0].id, channel_ids: mapped.map(c => c.id),
      name: `${parts[0]} ${parts[1]}`, color: mapped.length === 1 ? mapped[0].channelColor || '#ffffff' : '#ffffff',
      renderStyle: 'solid', is_detected: false })
  })
  return boxes
}

export function visibleImportedBoxes(boxes, overlayChannels, visibleChannelIds, selectedChannelId) {
  return boxes.filter(box => box.channel_ids.some(id =>
    overlayChannels ? visibleChannelIds.has(id) : id === selectedChannelId))
}
