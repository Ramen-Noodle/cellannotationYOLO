import { useEffect, useMemo, useState } from 'react'
import TwoPhaseWithinChannelGraph from '../components/TwoPhaseWithinChannelGraph'
import { evaluateWithinChannel } from '../utils/twoPhaseWithinChannel.mjs'
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

function combinations(channels, cells, terminalClasses) {
  const labels = Object.fromEntries(channels.map(channel => [channelName(channel), new Set()]))
  terminalClasses.forEach(entry => labels[entry.channel]?.add(entry.label))
  cells.forEach(group => group.members.forEach(member => labels[member.channel]?.add(member.label)))
  const options = channels.map(channel => [null, ...[...labels[channelName(channel)]].sort()])
  const size = options.reduce((product, entries) => product * entries.length, 1) - 1
  if (size > 10000) throw new Error(`${size.toLocaleString()} combinations exceed the 10,000-category limit. Merge more classes within channels first.`)
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
    let cancelled = false
    setLoading(true); setError('')
    setChannels([]); setAnnotations([])
    setWithinRules([]); setRows([]); setSelectedRows([]); setHistory([]); setPhase(1)
    Promise.all([
      fetch(`${API_BASE_URL}/load-channels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ image_id: imageId }) }),
      fetch(`${API_BASE_URL}/load-annotations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ image_id: imageId }) }),
    ]).then(async ([channelResponse, annotationResponse]) => {
      const loadedChannels = await channelResponse.json().catch(() => [])
      const loadedAnnotations = await annotationResponse.json().catch(() => ({}))
      if (cancelled) return
      if (!channelResponse.ok || !annotationResponse.ok) throw new Error(loadedChannels.error || loadedAnnotations.error || 'Could not load annotations.')
      setChannels(loadedChannels); setAnnotations(loadedAnnotations.annotations || [])
    }).catch(loadError => { if (!cancelled) setError(loadError.message) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [imageId])

  const classRows = useMemo(() => {
    // The standalone catalog has one node per channel/class, even when
    // several detector settings contribute detections to that class.
    const result = new Map()
    annotations.forEach(annotation => {
      const channel = channels.find(candidate => candidate.id === annotation.channel_id)
      if (!channel) return
      ;(annotation.labels?.labels || []).forEach((label, classIndex) => {
        const key = `${channelName(channel)}:${label.name}`
        const count = [...(annotation.annotations_detected || []), ...(annotation.annotations_drawn || [])].filter(box => Number(box.class) === classIndex).length
        const prior = result.get(key)
        result.set(key, { key, channelId: channel.id, channel: channelName(channel), name: label.name,
          color: label.color || '#cbd5e1', count: (prior?.count || 0) + count })
      })
    })
    return [...result.values()]
  }, [annotations, channels])

  const withinResult = useMemo(() => {
    try {
      return { ...evaluateWithinChannel(flattenCells(channels, annotations), withinRules, classRows), error: '' }
    } catch (evaluationError) {
      return { cells: [], terminal: [], audit: [], error: evaluationError.message }
    }
  }, [channels, annotations, withinRules, classRows])

  const changeWithinRules = next => {
    setWithinRules(next)
    setRows([]); setSelectedRows([]); setHistory([]); setPhase(1)
  }

  const runPhaseTwo = () => {
    if (withinResult.error) { setError(withinResult.error); return }
    const iou = Number(iouThreshold), containment = Number(containmentThreshold)
    if ([iouThreshold, containmentThreshold].some(value => String(value).trim() === '') || ![iou, containment].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
      setError('Cross-channel thresholds must be between 0 and 1.')
      return
    }
    setError('')
    try {
      const groups = automaticIntersections(channels, withinResult.cells, iou, containment)
      setRows(combinations(channels, groups, withinResult.terminal))
    } catch (combinationError) {
      setError(combinationError.message)
      return
    }
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
      {imageId && !loading && <Box sx={{ display: phase === 1 ? 'block' : 'none' }}>
        <Stack spacing={2}>
          <TwoPhaseWithinChannelGraph key={imageId} channels={channels} classes={classRows} rules={withinRules} onChange={changeWithinRules} audit={withinResult.audit} evaluationError={withinResult.error} />
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField size="small" type="number" label="Cross-channel IoU" value={iouThreshold} inputProps={{ min: 0, max: 1, step: 0.01 }} onChange={event => setIouThreshold(event.target.value)} />
            <TextField size="small" type="number" label="Cross-channel containment" value={containmentThreshold} inputProps={{ min: 0, max: 1, step: 0.01 }} onChange={event => setContainmentThreshold(event.target.value)} />
            <Button variant="contained" disabled={Boolean(withinResult.error)} onClick={runPhaseTwo}>Open cross-channel table</Button>
          </Stack>
        </Stack>
      </Box>}
      {phase === 2 && <><Typography variant="h6">Phase 2: cross-channel combinations</Typography><Typography variant="body2" color="text.secondary">Rows are the complete positive/negative combination catalog. Counts come from deterministic one-to-one cross-channel matching; zero-count rows remain available for naming.</Typography><Stack direction="row" spacing={1} alignItems="center"><TextField size="small" label="Search" value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} /><FormControlLabel control={<Checkbox checked={observedOnly} onChange={event => { setObservedOnly(event.target.checked); setPage(0) }} />} label="Only rows with detections" /><Typography variant="body2" color="text.secondary">{filteredRows.length.toLocaleString()} rows</Typography><Button variant="contained" disabled={!selectedRows.length} onClick={() => setMergeDialogOpen(true)}>{selectedRows.length > 1 ? 'Merge selected rows' : 'Rename selected row'}</Button><Button variant="outlined" disabled={!history.length} onClick={undoClassEdit}>Undo</Button><Button variant="outlined" disabled={!resultBoxes.length} onClick={applyResult}>Use merged layer in annotation tool</Button></Stack>
        <Table size="small" stickyHeader><TableHead><TableRow><TableCell>Select</TableCell><TableCell>Output</TableCell>{channels.map(channel => <TableCell key={channel.id}>{channelName(channel)}</TableCell>)}<TableCell>Cells</TableCell></TableRow></TableHead><TableBody>{pageRows.map(row => <TableRow key={row.key} selected={selectedRows.includes(row.key)}><TableCell><Checkbox checked={selectedRows.includes(row.key)} onChange={() => setSelectedRows(previous => previous.includes(row.key) ? previous.filter(key => key !== row.key) : [...previous, row.key])} /></TableCell><TableCell>{row.output || row.key}</TableCell>{channels.map(channel => <TableCell key={channel.id}>{row.states[channelName(channel)] || 'negative'}</TableCell>)}<TableCell>{row.count}</TableCell></TableRow>)}</TableBody></Table>
        <Stack direction="row" spacing={1} alignItems="center"><Button disabled={page === 0} onClick={() => setPage(previous => previous - 1)}>Previous</Button><Typography variant="body2">Page {page + 1} of {pageCount}</Typography><Button disabled={page >= pageCount - 1} onClick={() => setPage(previous => previous + 1)}>Next</Button><Button onClick={() => setPhase(1)}>Back to phase 1</Button></Stack>
      </>}
    </Stack>
    <Dialog open={mergeDialogOpen} onClose={() => setMergeDialogOpen(false)}><DialogTitle>Merge selected rows</DialogTitle><DialogContent><TextField label="Output class" value={mergeLabel} onChange={event => setMergeLabel(event.target.value)} autoFocus sx={{ mt: 1 }} /></DialogContent><DialogActions><Button onClick={() => setMergeDialogOpen(false)}>Cancel</Button><Button variant="contained" onClick={mergeSelectedRows}>Save</Button></DialogActions></Dialog>
  </Box>
}
