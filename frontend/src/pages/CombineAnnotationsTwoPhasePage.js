import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, FormControl, FormControlLabel, InputLabel,
  MenuItem, Select, Stack, Table, TableBody, TableCell, TableHead,
  TableRow, TextField, Typography,
} from '@mui/material'

const API_BASE_URL = 'http://10.80.24.12:5002'
const CHANNEL_COLORS = ['#ff4d4d', '#4dff88', '#5c8dff', '#ffe04d', '#ff63d8', '#4de8ff']
const PAGE_SIZE = 40

const channelName = channel => `C${(channel.order_index ?? 0) + 1}`
const bounds = box => [box.x, box.y, box.x + box.w, box.y + box.h]

function overlap(first, second) {
  const [ax1, ay1, ax2, ay2] = bounds(first)
  const [bx1, by1, bx2, by2] = bounds(second)
  const intersection = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1)) * Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1))
  const areaA = Math.max(0, first.w * first.h)
  const areaB = Math.max(0, second.w * second.h)
  const union = areaA + areaB - intersection
  return { iou: union ? intersection / union : 0, containment: Math.min(areaA, areaB) ? intersection / Math.min(areaA, areaB) : 0 }
}

function labelFor(annotation, classIndex) {
  return annotation.labels?.labels?.[classIndex]?.name || `Class ${classIndex}`
}

function flattenCells(channels, annotations) {
  const byId = new Map(channels.map(channel => [channel.id, channel]))
  const cells = []
  annotations.forEach(annotation => {
    const channel = byId.get(annotation.channel_id)
    if (!channel) return
    const channelId = channelName(channel)
    const append = (box, source) => {
      const originalLabel = labelFor(annotation, Number(box.class))
      cells.push({ ...box, source, channel: channelId, originalLabel, label: originalLabel, supports: [box] })
    }
    ;(annotation.annotations_detected || []).forEach(box => append(box, 'detected'))
    ;(annotation.annotations_drawn || []).forEach(box => append(box, 'drawn'))
  })
  return cells
}

function mergeGroup(group, label) {
  const representative = group.slice().sort((a, b) => (b.w * b.h) - (a.w * a.h))[0]
  return { ...representative, name: label, label, originalLabel: label, members: group }
}

function applyWithinRules(cells, rules) {
  let active = cells.map(cell => ({ ...cell }))
  rules.forEach(rule => {
    const candidates = active.map((cell, index) => ({ cell, index })).filter(item => item.cell.channel === rule.channel && rule.inputs.includes(item.cell.originalLabel))
    const consumed = new Set()
    const produced = []
    candidates.forEach(seed => {
      if (consumed.has(seed.index)) return
      const group = [seed]
      candidates.forEach(candidate => {
        if (candidate.index === seed.index || consumed.has(candidate.index) || group.some(item => item.index === candidate.index)) return
        const score = overlap(seed.cell, candidate.cell)
        if (score.iou >= rule.iou || score.containment >= rule.containment) group.push(candidate)
      })
      const present = new Set(group.map(item => item.cell.originalLabel))
      if (group.length < 2 || rule.inputs.some(input => !present.has(input))) return
      group.forEach(item => consumed.add(item.index))
      const sourceBoxes = group.map(item => item.cell)
      const representative = rule.strategy === 'dominance'
        ? sourceBoxes.find(cell => cell.originalLabel === rule.inputs[0]) || sourceBoxes[0]
        : sourceBoxes.slice().sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0]
      produced.push({ ...mergeGroup(sourceBoxes, rule.label), ...representative, name: rule.label, label: rule.label, originalLabel: rule.label, members: sourceBoxes, supports: sourceBoxes.flatMap(cell => cell.supports || [cell]) })
    })
    active = active.filter((_, index) => !consumed.has(index)).concat(produced)
  })
  return active
}

function automaticContainmentCleanup(cells, threshold = 0.95) {
  const active = []
  const byChannel = new Map()
  cells.forEach((cell, index) => {
    if (!['C1', 'C2'].includes(cell.channel)) {
      active.push({ ...cell, sourceIndex: index })
      return
    }
    const list = byChannel.get(cell.channel) || []
    list.push({ ...cell, sourceIndex: index })
    byChannel.set(cell.channel, list)
  })
  byChannel.forEach(channelCells => {
    const consumed = new Set()
    channelCells.slice().sort((a, b) => (b.w * b.h) - (a.w * a.h)).forEach(large => {
      if (consumed.has(large.sourceIndex)) return
      const duplicates = channelCells.filter(small => small.sourceIndex !== large.sourceIndex && !consumed.has(small.sourceIndex) && overlap(large, small).containment > threshold)
      duplicates.forEach(small => consumed.add(small.sourceIndex))
      active.push({ ...large, members: [large, ...duplicates] })
    })
  })
  return active.sort((a, b) => a.sourceIndex - b.sourceIndex).map(cell => { const { sourceIndex, ...rest } = cell; return rest })
}

function compatible(first, second, iou, containment) {
  const firstSupports = first.supports || [first]
  const secondSupports = second.supports || [second]
  return firstSupports.every(left => secondSupports.every(right => {
    const score = overlap(left, right)
    return score.iou > iou || score.containment > containment
  }))
}

function automaticIntersections(channels, cells, iou, containment) {
  const ordered = cells.map((cell, index) => ({ ...cell, sourceIndex: index }))
  const used = new Set()
  const groups = []
  const channelNames = channels.map(channelName)
  ordered.forEach(seed => {
    if (used.has(seed.sourceIndex)) return
    const group = [seed]
    for (const channel of channelNames) {
      if (channel === seed.channel) continue
      const candidates = ordered.filter(candidate => candidate.channel === channel && !used.has(candidate.sourceIndex) && !group.some(member => member.sourceIndex === candidate.sourceIndex) && group.every(member => compatible(member, candidate, iou, containment)))
      if (!candidates.length) continue
      candidates.sort((a, b) => {
        const aScore = Math.max(...group.map(member => { const score = overlap(member, a); return Math.max(score.iou, score.containment) }))
        const bScore = Math.max(...group.map(member => { const score = overlap(member, b); return Math.max(score.iou, score.containment) }))
        return bScore - aScore
      })
      group.push(candidates[0])
    }
    if (group.length > 1) group.forEach(member => used.add(member.sourceIndex))
    const states = Object.fromEntries(channelNames.map(channel => [channel, null]))
    group.forEach(member => { states[member.channel] = member.label })
    groups.push({ states, members: group })
  })
  return groups
}

function combinations(channels, cells) {
  const labels = Object.fromEntries(channels.map(channel => [channelName(channel), new Set()]))
  cells.forEach(group => group.members.forEach(member => labels[member.channel]?.add(member.label)))
  const options = channels.map(channel => [null, ...labels[channelName(channel)]])
  const rows = []
  const visit = (index, states) => {
    if (index === options.length) {
      if (states.every(value => value == null)) return
      const stateMap = Object.fromEntries(channels.map((channel, channelIndex) => [channelName(channel), states[channelIndex]]))
      const key = channels.map(channel => `${channelName(channel)}=${stateMap[channelName(channel)] || 'negative'}`).join('|')
      const members = cells.filter(group => channels.every(channel => group.states[channelName(channel)] === stateMap[channelName(channel)])).map(group => group.members)
      rows.push({ key, states: stateMap, members, count: members.length, output: '' })
      return
    }
    options[index].forEach(value => visit(index + 1, [...states, value]))
  }
  visit(0, [])
  return rows
}

function collapseBoxes(boxes, iou = 0.25, containment = 0.6) {
  const consumed = new Set()
  const result = []
  boxes.slice().sort((a, b) => (b.w * b.h) - (a.w * a.h)).forEach((box, index, ordered) => {
    if (consumed.has(index)) return
    result.push(box)
    ordered.forEach((candidate, candidateIndex) => {
      if (candidateIndex === index || consumed.has(candidateIndex)) return
      const score = overlap(box, candidate)
      if (score.iou > iou || score.containment > containment) consumed.add(candidateIndex)
    })
  })
  return result
}

export default function CombineAnnotationsTwoPhasePage({ onApplyMergedLayer }) {
  const [images, setImages] = useState([])
  const [imageId, setImageId] = useState('')
  const [channels, setChannels] = useState([])
  const [annotations, setAnnotations] = useState([])
  const [withinRules, setWithinRules] = useState([])
  const [currentChannel, setCurrentChannel] = useState('')
  const [graphPositions, setGraphPositions] = useState({})
  const [connectionStart, setConnectionStart] = useState(null)
  const [draggingNode, setDraggingNode] = useState(null)
  const [selectedSources, setSelectedSources] = useState([])
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [ruleStrategy, setRuleStrategy] = useState('neutral')
  const [ruleLabel, setRuleLabel] = useState('')
  const [phase, setPhase] = useState(1)
  const [iouThreshold, setIouThreshold] = useState(0.3)
  const [containmentThreshold, setContainmentThreshold] = useState(0.6)
  const [rows, setRows] = useState([])
  const [selectedRows, setSelectedRows] = useState([])
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)
  const [mergeLabel, setMergeLabel] = useState('')
  const [history, setHistory] = useState([])
  const [search, setSearch] = useState('')
  const [observedOnly, setObservedOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API_BASE_URL}/user-images`, { credentials: 'include' })
      .then(async response => {
        const data = await response.json().catch(() => [])
        if (!response.ok) throw new Error(data.error || 'Could not load images.')
        setImages(data)
      }).catch(loadError => setError(loadError.message))
  }, [])

  useEffect(() => {
    if (!imageId) return
    setLoading(true); setError('')
    Promise.all([
      fetch(`${API_BASE_URL}/load-channels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ image_id: imageId }) }),
      fetch(`${API_BASE_URL}/load-annotations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ image_id: imageId }) }),
    ]).then(async ([channelResponse, annotationResponse]) => {
      const loadedChannels = await channelResponse.json().catch(() => [])
      const loadedAnnotations = await annotationResponse.json().catch(() => ({}))
      if (!channelResponse.ok || !annotationResponse.ok) throw new Error(loadedChannels.error || loadedAnnotations.error || 'Could not load annotations.')
      setChannels(loadedChannels); setAnnotations(loadedAnnotations.annotations || [])
      setWithinRules([]); setSelectedSources([]); setRows([]); setSelectedRows([]); setHistory([]); setCurrentChannel(''); setGraphPositions({}); setPhase(1)
    }).catch(loadError => setError(loadError.message)).finally(() => setLoading(false))
  }, [imageId])

  const classRows = useMemo(() => {
    const result = []
    annotations.forEach(annotation => {
      const channel = channels.find(candidate => candidate.id === annotation.channel_id)
      if (!channel) return
      ;(annotation.labels?.labels || []).forEach((label, classIndex) => result.push({
        key: `${channelName(channel)}:${label.name}`, channel: channelName(channel), name: label.name,
        color: label.color || '#cbd5e1', count: [...(annotation.annotations_detected || []), ...(annotation.annotations_drawn || [])].filter(box => Number(box.class) === classIndex).length,
      }))
    })
    return result
  }, [annotations, channels])

  useEffect(() => {
    if (!currentChannel && channels.length) setCurrentChannel(channelName(channels[0]))
  }, [channels, currentChannel])

  useEffect(() => {
    const sourceRows = classRows.filter(row => row.channel === currentChannel)
    setGraphPositions(previous => {
      const next = { ...previous }
      sourceRows.forEach((row, index) => {
        if (!next[`class:${row.key}`]) next[`class:${row.key}`] = { x: 24, y: 48 + index * 92 }
      })
      withinRules.filter(rule => rule.channel === currentChannel).forEach((rule, index) => {
        if (!next[`rule:${rule.id}`]) next[`rule:${rule.id}`] = { x: 390, y: 72 + index * 112 }
      })
      return next
    })
  }, [classRows, currentChannel, withinRules])

  const graphRows = classRows.filter(row => row.channel === currentChannel)
  const graphRules = withinRules.filter(rule => rule.channel === currentChannel)
  const graphWidth = Math.max(760, 680)
  const graphHeight = Math.max(360, 110 + Math.max(graphRows.length, graphRules.length) * 92)
  const graphNodeLabel = key => key.replace(`${currentChannel}:`, '')

  const beginConnection = key => setConnectionStart(key)
  const finishConnection = key => {
    if (!connectionStart || connectionStart === key) { setConnectionStart(null); return }
    const sourceIsRule = connectionStart.startsWith('rule:')
    const targetIsRule = key.startsWith('rule:')
    if (sourceIsRule || targetIsRule) {
      const ruleId = sourceIsRule ? connectionStart.slice(5) : key.slice(5)
      const classKey = sourceIsRule ? key : connectionStart
      const label = classKey.slice(classKey.indexOf(':') + 1)
      setWithinRules(previous => previous.map(rule => rule.id === ruleId && !rule.inputs.includes(label) ? { ...rule, inputs: [...rule.inputs, label] } : rule))
      setConnectionStart(null)
      return
    }
    setSelectedSources([connectionStart, key])
    setRuleLabel('')
    setRuleDialogOpen(true)
    setConnectionStart(null)
  }

  const moveGraphNode = (event, key) => {
    if (!draggingNode || draggingNode.key !== key) return
    setGraphPositions(previous => ({ ...previous, [key]: { x: Math.max(8, draggingNode.origin.x + event.clientX - draggingNode.startX), y: Math.max(28, draggingNode.origin.y + event.clientY - draggingNode.startY) } }))
  }

  const removeRule = ruleId => setWithinRules(previous => previous.filter(rule => rule.id !== ruleId))

  const createWithinRule = () => {
    if (selectedSources.length < 2) return
    const channel = selectedSources[0].split(':')[0]
    const inputs = selectedSources.map(source => source.slice(source.indexOf(':') + 1))
    setWithinRules(previous => [...previous, { id: `within-${Date.now()}`, channel, inputs, strategy: ruleStrategy, label: ruleLabel.trim() || inputs.join('+'), iou: Number(iouThreshold), containment: Number(containmentThreshold) }])
    setSelectedSources([]); setRuleLabel(''); setRuleDialogOpen(false)
  }

  const runPhaseTwo = () => {
    const cleaned = automaticContainmentCleanup(flattenCells(channels, annotations), 0.95)
    const cells = applyWithinRules(cleaned, withinRules)
    const groups = automaticIntersections(channels, cells, Number(iouThreshold), Number(containmentThreshold))
    setRows(combinations(channels, groups))
    setHistory([])
    setSelectedRows([]); setPage(0); setPhase(2)
  }

  const mergeSelectedRows = () => {
    if (selectedRows.length < 1 || !mergeLabel.trim()) return
    setHistory(previous => [...previous, rows])
    setRows(previous => previous.map(row => selectedRows.includes(row.key) ? { ...row, output: mergeLabel.trim() } : row))
    setSelectedRows([]); setMergeLabel(''); setMergeDialogOpen(false)
  }

  const undoClassEdit = () => {
    if (!history.length) return
    setRows(history[history.length - 1])
    setHistory(previous => previous.slice(0, -1))
    setSelectedRows([])
  }

  const resultBoxes = useMemo(() => {
    const byOutput = new Map()
    rows.forEach(row => row.members.forEach(memberGroup => {
      const label = row.output || row.key
      const list = byOutput.get(label) || []
      list.push(mergeGroup(memberGroup, label))
      byOutput.set(label, list)
    }))
    return [...byOutput.entries()].flatMap(([label, boxes]) => collapseBoxes(boxes, 0.25, 0.6).map(box => ({ ...box, name: label, label })))
  }, [rows])
  const filteredRows = rows.filter(row => (!observedOnly || row.count > 0) && (!search.trim() || `${row.key} ${row.output}`.toLowerCase().includes(search.trim().toLowerCase())))
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const pageRows = filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const selectedImage = images.find(image => image.id === imageId)

  const applyResult = () => {
    if (!selectedImage || !resultBoxes.length) return
    onApplyMergedLayer?.({ imageId, imageSize: { width: selectedImage.width, height: selectedImage.height }, boxes: resultBoxes, layers: channels.map((channel, index) => ({ id: channel.id, src: `${API_BASE_URL}/static/${channel.normalized_path}`, color: CHANNEL_COLORS[index % CHANNEL_COLORS.length] })), recipe: { type: 'two-phase-prototype', withinRules, thresholds: { iou: Number(iouThreshold), containment: Number(containmentThreshold) } } })
  }

  return <Box sx={{ height: '100%', overflow: 'auto', p: 3, bgcolor: '#101217' }}>
    <Stack spacing={2} sx={{ maxWidth: 1500, mx: 'auto' }}>
      <Box><Typography variant="h5">Combine annotations — two phase</Typography><Typography variant="body2" color="text.secondary">Prototype workflow: normalize classes within each channel, then group overlapping cross-channel cells. Changes are kept in memory only.</Typography></Box>
      {error && <Alert severity="error">{error}</Alert>}
      <FormControl size="small" sx={{ maxWidth: 420 }}><InputLabel id="two-phase-image-label">Image</InputLabel><Select labelId="two-phase-image-label" label="Image" value={imageId} onChange={event => setImageId(event.target.value)}>{images.map(image => <MenuItem key={image.id} value={image.id}>{image.name}</MenuItem>)}</Select></FormControl>
      {loading && <CircularProgress size={24} />}
      {imageId && !loading && <>
        <Typography variant="h6">Phase 1: within-channel merges</Typography>
        <Typography variant="body2" color="text.secondary">Select two or more classes from one channel. Matching boxes are collapsed into one class before cross-channel matching.</Typography>
        <Stack direction="row" spacing={1}>{channels.map((channel, index) => <Button key={channel.id} size="small" variant={currentChannel === channelName(channel) ? 'contained' : 'outlined'} onClick={() => { setCurrentChannel(channelName(channel)); setConnectionStart(null) }} sx={{ color: CHANNEL_COLORS[index % CHANNEL_COLORS.length] }}>{channelName(channel)}</Button>)}</Stack>
        <Typography variant="body2" color="text.secondary">Connect the right dot of one class to the left dot of another. Connect a rule output to another class to extend the merge tree. Drag cards to arrange the graph.</Typography>
        <Box onPointerMove={event => draggingNode && moveGraphNode(event, draggingNode.key)} onPointerUp={() => setDraggingNode(null)} onPointerLeave={() => setDraggingNode(null)} sx={{ position: 'relative', width: '100%', height: graphHeight, minHeight: 360, overflow: 'auto', bgcolor: '#10131b', border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Box sx={{ position: 'relative', width: graphWidth, height: graphHeight }}>
            <svg width={graphWidth} height={graphHeight} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              <defs><marker id="two-phase-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#00b7ce" /></marker></defs>
              {graphRules.flatMap(rule => rule.inputs.map(input => {
                const from = graphPositions[`class:${currentChannel}:${input}`]
                const to = graphPositions[`rule:${rule.id}`]
                if (!from || !to) return null
                return <line key={`${rule.id}-${input}`} x1={from.x + 204} y1={from.y + 37} x2={to.x} y2={to.y + 37} stroke="#00b7ce" strokeWidth="2" markerEnd="url(#two-phase-arrow)" />
              }))}
            </svg>
            {graphRows.map(row => { const key = `class:${row.key}`; const position = graphPositions[key] || { x: 24, y: 48 }; return <Box key={row.key} onPointerDown={event => { if (event.target.closest('button')) return; setDraggingNode({ key, startX: event.clientX, startY: event.clientY, origin: position }) }} sx={{ position: 'absolute', left: position.x, top: position.y, width: 204, minHeight: 74, p: 1.25, border: `2px solid ${CHANNEL_COLORS[(Number(currentChannel.slice(1)) - 1) % CHANNEL_COLORS.length]}`, borderRadius: 1, bgcolor: '#191d28', cursor: 'grab' }}><Typography variant="caption" sx={{ color: CHANNEL_COLORS[(Number(currentChannel.slice(1)) - 1) % CHANNEL_COLORS.length] }}>{currentChannel} · INPUT</Typography><Typography variant="body2" sx={{ fontWeight: 700 }}>{row.name}</Typography><Typography variant="caption" color="text.secondary">{row.count} detections</Typography><Box component="button" type="button" aria-label={`Connect into ${row.name}`} onClick={() => finishConnection(row.key)} sx={{ position: 'absolute', left: -8, top: 30, width: 16, height: 16, borderRadius: '50%', border: '2px solid #10131b', bgcolor: connectionStart ? '#00e5ff' : '#00b7ce', cursor: 'crosshair' }} /><Box component="button" type="button" aria-label={`Connect from ${row.name}`} onClick={() => beginConnection(row.key)} sx={{ position: 'absolute', right: -8, top: 30, width: 16, height: 16, borderRadius: '50%', border: '2px solid #10131b', bgcolor: '#00b7ce', cursor: 'crosshair' }} /></Box> })}
            {graphRules.map(rule => { const key = `rule:${rule.id}`; const position = graphPositions[key] || { x: 390, y: 72 }; return <Box key={rule.id} onPointerDown={event => { if (event.target.closest('button')) return; setDraggingNode({ key, startX: event.clientX, startY: event.clientY, origin: position }) }} sx={{ position: 'absolute', left: position.x, top: position.y, width: 230, minHeight: 88, p: 1.25, border: '2px solid #cf8af5', borderRadius: 1, bgcolor: '#211d2d', cursor: 'grab' }}><Typography variant="caption" sx={{ color: '#cf8af5' }}>MERGED GROUP · {rule.strategy === 'neutral' ? 'NO DOMINANCE' : 'DOMINANCE'}</Typography><Typography variant="body2" sx={{ fontWeight: 700 }}>{rule.label}</Typography><Typography variant="caption" color="text.secondary">{rule.inputs.join(' + ')}</Typography><Button size="small" onClick={() => removeRule(rule.id)} sx={{ position: 'absolute', right: 2, top: 0, minWidth: 22, p: 0, color: 'text.secondary' }}>×</Button><Box component="button" type="button" aria-label={`Extend ${rule.label}`} onClick={() => beginConnection(`rule:${rule.id}`)} sx={{ position: 'absolute', right: -8, top: 34, width: 16, height: 16, borderRadius: '50%', border: '2px solid #10131b', bgcolor: '#cf8af5', cursor: 'crosshair' }} /><Box component="button" type="button" aria-label={`Connect into ${rule.label}`} onClick={() => finishConnection(`rule:${rule.id}`)} sx={{ position: 'absolute', left: -8, top: 34, width: 16, height: 16, borderRadius: '50%', border: '2px solid #10131b', bgcolor: connectionStart ? '#00e5ff' : '#cf8af5', cursor: 'crosshair' }} /></Box> })}
            {connectionStart && <Typography sx={{ position: 'absolute', left: 24, bottom: 12, color: '#00e5ff' }}>Connecting from {graphNodeLabel(connectionStart.replace(/^(class:|rule:)/, ''))}. Select a target dot.</Typography>}
            {!graphRows.length && <Typography color="text.secondary" sx={{ p: 3 }}>No detections in this channel.</Typography>}
          </Box>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center"><TextField size="small" type="number" label="IoU" value={iouThreshold} inputProps={{ min: 0, max: 1, step: 0.01 }} onChange={event => setIouThreshold(event.target.value)} /><TextField size="small" type="number" label="Containment" value={containmentThreshold} inputProps={{ min: 0, max: 1, step: 0.01 }} onChange={event => setContainmentThreshold(event.target.value)} /><Button variant="contained" onClick={runPhaseTwo}>Open cross-channel table</Button></Stack>
      </>}
      {phase === 2 && <><Typography variant="h6">Phase 2: cross-channel combinations</Typography><Typography variant="body2" color="text.secondary">Rows are the complete positive/negative combination catalog. Counts come from deterministic one-to-one cross-channel matching; zero-count rows remain available for naming.</Typography><Stack direction="row" spacing={1} alignItems="center"><TextField size="small" label="Search" value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} /><FormControlLabel control={<Checkbox checked={observedOnly} onChange={event => { setObservedOnly(event.target.checked); setPage(0) }} />} label="Only rows with detections" /><Typography variant="body2" color="text.secondary">{filteredRows.length.toLocaleString()} rows</Typography><Button variant="contained" disabled={!selectedRows.length} onClick={() => setMergeDialogOpen(true)}>{selectedRows.length > 1 ? 'Merge selected rows' : 'Rename selected row'}</Button><Button variant="outlined" disabled={!history.length} onClick={undoClassEdit}>Undo</Button><Button variant="outlined" disabled={!resultBoxes.length} onClick={applyResult}>Use merged layer in annotation tool</Button></Stack>
        <Table size="small" stickyHeader><TableHead><TableRow><TableCell>Select</TableCell><TableCell>Output</TableCell>{channels.map(channel => <TableCell key={channel.id}>{channelName(channel)}</TableCell>)}<TableCell>Cells</TableCell></TableRow></TableHead><TableBody>{pageRows.map(row => <TableRow key={row.key} selected={selectedRows.includes(row.key)}><TableCell><Checkbox checked={selectedRows.includes(row.key)} onChange={() => setSelectedRows(previous => previous.includes(row.key) ? previous.filter(key => key !== row.key) : [...previous, row.key])} /></TableCell><TableCell>{row.output || row.key}</TableCell>{channels.map(channel => <TableCell key={channel.id}>{row.states[channelName(channel)] || 'negative'}</TableCell>)}<TableCell>{row.count}</TableCell></TableRow>)}</TableBody></Table>
        <Stack direction="row" spacing={1} alignItems="center"><Button disabled={page === 0} onClick={() => setPage(previous => previous - 1)}>Previous</Button><Typography variant="body2">Page {page + 1} of {pageCount}</Typography><Button disabled={page >= pageCount - 1} onClick={() => setPage(previous => previous + 1)}>Next</Button><Button onClick={() => setPhase(1)}>Back to phase 1</Button></Stack>
      </>}
    </Stack>
    <Dialog open={ruleDialogOpen} onClose={() => setRuleDialogOpen(false)}><DialogTitle>Within-channel merge</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}><Typography variant="body2">{selectedSources.join(' + ')}</Typography><FormControl fullWidth size="small"><InputLabel id="within-strategy-label">Interaction</InputLabel><Select labelId="within-strategy-label" label="Interaction" value={ruleStrategy} onChange={event => setRuleStrategy(event.target.value)}><MenuItem value="neutral">No dominance</MenuItem><MenuItem value="dominance">Dominance</MenuItem></Select></FormControl><TextField label="Output class" value={ruleLabel} onChange={event => setRuleLabel(event.target.value)} autoFocus /></Stack></DialogContent><DialogActions><Button onClick={() => setRuleDialogOpen(false)}>Cancel</Button><Button variant="contained" onClick={createWithinRule}>Save rule</Button></DialogActions></Dialog>
    <Dialog open={mergeDialogOpen} onClose={() => setMergeDialogOpen(false)}><DialogTitle>Merge selected rows</DialogTitle><DialogContent><TextField label="Output class" value={mergeLabel} onChange={event => setMergeLabel(event.target.value)} autoFocus sx={{ mt: 1 }} /></DialogContent><DialogActions><Button onClick={() => setMergeDialogOpen(false)}>Cancel</Button><Button variant="contained" onClick={mergeSelectedRows}>Save</Button></DialogActions></Dialog>
  </Box>
}
