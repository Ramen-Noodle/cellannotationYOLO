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
      cells.push({ ...box, source, channel: channelId, originalLabel, label: originalLabel })
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
      produced.push({ ...mergeGroup(sourceBoxes, rule.label), ...representative, name: rule.label, label: rule.label, originalLabel: rule.label, members: sourceBoxes })
    })
    active = active.filter((_, index) => !consumed.has(index)).concat(produced)
  })
  return active
}

function buildCrossChannelGroups(channels, cells, iou, containment) {
  const groups = cells.map(cell => ({ members: [cell] }))
  const pairs = []
  for (let first = 0; first < groups.length; first += 1) for (let second = first + 1; second < groups.length; second += 1) {
    const left = groups[first].members[0]
    const right = groups[second].members[0]
    if (left.channel === right.channel) continue
    const score = overlap(left, right)
    if (score.iou >= iou || score.containment >= containment) pairs.push({ first, second, score: Math.max(score.iou, score.containment) })
  }
  pairs.sort((a, b) => b.score - a.score)
  const used = new Set()
  pairs.forEach(pair => {
    if (used.has(pair.first) || used.has(pair.second)) return
    const first = groups[pair.first]
    const second = groups[pair.second]
    const channelsInGroup = new Set([...first.members, ...second.members].map(member => member.channel))
    if (channelsInGroup.size !== first.members.length + second.members.length) return
    first.members.push(...second.members)
    used.add(pair.second)
  })
  return groups.filter((_, index) => !used.has(index)).map(group => {
    const states = Object.fromEntries(channels.map(channel => [channelName(channel), null]))
    group.members.forEach(member => { states[member.channel] = member.label })
    return { key: channels.map(channel => `${channelName(channel)}=${states[channelName(channel)] || 'negative'}`).join('|'), states, members: group.members, count: group.members.length }
  })
}

export default function CombineAnnotationsTwoPhasePage({ onApplyMergedLayer }) {
  const [images, setImages] = useState([])
  const [imageId, setImageId] = useState('')
  const [channels, setChannels] = useState([])
  const [annotations, setAnnotations] = useState([])
  const [withinRules, setWithinRules] = useState([])
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
      setWithinRules([]); setSelectedSources([]); setRows([]); setSelectedRows([]); setPhase(1)
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

  const createWithinRule = () => {
    if (selectedSources.length < 2) return
    const channel = selectedSources[0].split(':')[0]
    const inputs = selectedSources.map(source => source.slice(source.indexOf(':') + 1))
    setWithinRules(previous => [...previous, { id: `within-${Date.now()}`, channel, inputs, strategy: ruleStrategy, label: ruleLabel.trim() || inputs.join('+'), iou: Number(iouThreshold), containment: Number(containmentThreshold) }])
    setSelectedSources([]); setRuleLabel(''); setRuleDialogOpen(false)
  }

  const runPhaseTwo = () => {
    const cells = applyWithinRules(flattenCells(channels, annotations), withinRules)
    const groups = buildCrossChannelGroups(channels, cells, Number(iouThreshold), Number(containmentThreshold))
    setRows(groups.map(group => ({ ...group, output: '' })))
    setSelectedRows([]); setPage(0); setPhase(2)
  }

  const mergeSelectedRows = () => {
    if (selectedRows.length < 2 || !mergeLabel.trim()) return
    setRows(previous => previous.map(row => selectedRows.includes(row.key) ? { ...row, output: mergeLabel.trim() } : row))
    setSelectedRows([]); setMergeLabel(''); setMergeDialogOpen(false)
  }

  const resultBoxes = useMemo(() => rows.flatMap(row => row.members.length ? [mergeGroup(row.members, row.output || row.key)] : []), [rows])
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
        <Table size="small"><TableHead><TableRow><TableCell>Select</TableCell><TableCell>Channel</TableCell><TableCell>Class</TableCell><TableCell>Cells</TableCell></TableRow></TableHead><TableBody>{classRows.map(row => <TableRow key={row.key}><TableCell><Checkbox checked={selectedSources.includes(row.key)} onChange={() => setSelectedSources(previous => previous.includes(row.key) ? previous.filter(key => key !== row.key) : [...previous, row.key])} /></TableCell><TableCell sx={{ color: CHANNEL_COLORS[(Number(row.channel.slice(1)) - 1) % CHANNEL_COLORS.length] }}>{row.channel}</TableCell><TableCell>{row.name}</TableCell><TableCell>{row.count}</TableCell></TableRow>)}</TableBody></Table>
        <Stack spacing={1}><Button variant="outlined" disabled={selectedSources.length < 2 || new Set(selectedSources.map(source => source.split(':')[0])).size !== 1} onClick={() => setRuleDialogOpen(true)}>Create within-channel rule</Button>{withinRules.map(rule => <Typography key={rule.id} variant="body2" color="text.secondary">{rule.channel}: {rule.inputs.join(' + ')} → {rule.label} ({rule.strategy})</Typography>)}</Stack>
        <Stack direction="row" spacing={1} alignItems="center"><TextField size="small" type="number" label="IoU" value={iouThreshold} inputProps={{ min: 0, max: 1, step: 0.01 }} onChange={event => setIouThreshold(event.target.value)} /><TextField size="small" type="number" label="Containment" value={containmentThreshold} inputProps={{ min: 0, max: 1, step: 0.01 }} onChange={event => setContainmentThreshold(event.target.value)} /><Button variant="contained" onClick={runPhaseTwo}>Open cross-channel table</Button></Stack>
      </>}
      {phase === 2 && <><Typography variant="h6">Phase 2: cross-channel combinations</Typography><Stack direction="row" spacing={1} alignItems="center"><TextField size="small" label="Search" value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} /><FormControlLabel control={<Checkbox checked={observedOnly} onChange={event => { setObservedOnly(event.target.checked); setPage(0) }} />} label="Observed only" /><Typography variant="body2" color="text.secondary">{filteredRows.length.toLocaleString()} rows</Typography><Button variant="contained" disabled={selectedRows.length < 2} onClick={() => setMergeDialogOpen(true)}>Merge selected rows</Button><Button variant="outlined" disabled={!resultBoxes.length} onClick={applyResult}>Use merged layer in annotation tool</Button></Stack>
        <Table size="small" stickyHeader><TableHead><TableRow><TableCell>Select</TableCell><TableCell>Output</TableCell>{channels.map(channel => <TableCell key={channel.id}>{channelName(channel)}</TableCell>)}<TableCell>Cells</TableCell></TableRow></TableHead><TableBody>{pageRows.map(row => <TableRow key={row.key} selected={selectedRows.includes(row.key)}><TableCell><Checkbox checked={selectedRows.includes(row.key)} onChange={() => setSelectedRows(previous => previous.includes(row.key) ? previous.filter(key => key !== row.key) : [...previous, row.key])} /></TableCell><TableCell>{row.output || row.key}</TableCell>{channels.map(channel => <TableCell key={channel.id}>{row.states[channelName(channel)] || 'negative'}</TableCell>)}<TableCell>{row.count}</TableCell></TableRow>)}</TableBody></Table>
        <Stack direction="row" spacing={1} alignItems="center"><Button disabled={page === 0} onClick={() => setPage(previous => previous - 1)}>Previous</Button><Typography variant="body2">Page {page + 1} of {pageCount}</Typography><Button disabled={page >= pageCount - 1} onClick={() => setPage(previous => previous + 1)}>Next</Button><Button onClick={() => setPhase(1)}>Back to phase 1</Button></Stack>
      </>}
    </Stack>
    <Dialog open={ruleDialogOpen} onClose={() => setRuleDialogOpen(false)}><DialogTitle>Within-channel merge</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}><Typography variant="body2">{selectedSources.join(' + ')}</Typography><FormControl fullWidth size="small"><InputLabel id="within-strategy-label">Interaction</InputLabel><Select labelId="within-strategy-label" label="Interaction" value={ruleStrategy} onChange={event => setRuleStrategy(event.target.value)}><MenuItem value="neutral">No dominance</MenuItem><MenuItem value="dominance">Dominance</MenuItem></Select></FormControl><TextField label="Output class" value={ruleLabel} onChange={event => setRuleLabel(event.target.value)} autoFocus /></Stack></DialogContent><DialogActions><Button onClick={() => setRuleDialogOpen(false)}>Cancel</Button><Button variant="contained" onClick={createWithinRule}>Save rule</Button></DialogActions></Dialog>
    <Dialog open={mergeDialogOpen} onClose={() => setMergeDialogOpen(false)}><DialogTitle>Merge selected rows</DialogTitle><DialogContent><TextField label="Output class" value={mergeLabel} onChange={event => setMergeLabel(event.target.value)} autoFocus sx={{ mt: 1 }} /></DialogContent><DialogActions><Button onClick={() => setMergeDialogOpen(false)}>Cancel</Button><Button variant="contained" onClick={mergeSelectedRows}>Save</Button></DialogActions></Dialog>
  </Box>
}
