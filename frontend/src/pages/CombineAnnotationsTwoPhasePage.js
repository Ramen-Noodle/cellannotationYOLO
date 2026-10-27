import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'

const API_BASE_URL = 'http://10.80.24.12:5002'
const CHANNEL_COLORS = ['#ff4d4d', '#4dff88', '#5c8dff', '#ffe04d', '#ff63d8', '#4de8ff']
const PAGE_SIZE = 50

function channelLabel(channel) { return `C${(channel.order_index ?? 0) + 1}` }
function bounds(box) {
  return [box.x, box.y, box.x + box.w, box.y + box.h]
}
function overlap(a, b) {
  const [ax1, ay1, ax2, ay2] = bounds(a)
  const [bx1, by1, bx2, by2] = bounds(b)
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1))
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1))
  const intersection = ix * iy
  const areaA = Math.max(0, a.w * a.h)
  const areaB = Math.max(0, b.w * b.h)
  const union = areaA + areaB - intersection
  return {
    iou: union ? intersection / union : 0,
    containment: Math.min(areaA, areaB) ? intersection / Math.min(areaA, areaB) : 0,
  }
}
function findLabel(annotation, classIndex) {
  return annotation.labels?.labels?.[classIndex]?.name || `Class ${classIndex}`
}

function flattenCells(channels, annotations, mappings) {
  const channelById = new Map(channels.map(channel => [channel.id, channel]))
  const cells = []
  annotations.forEach(annotation => {
    const channel = channelById.get(annotation.channel_id)
    if (!channel) return
    const channelId = channelLabel(channel)
    const append = (box, source) => {
      const originalLabel = findLabel(annotation, Number(box.class))
      const key = `${channelId}:${originalLabel}`
      cells.push({
        ...box,
        source,
        channel: channelId,
        originalLabel,
        label: mappings[key] || originalLabel,
      })
    }
    ;(annotation.annotations_detected || []).forEach(box => append(box, 'detected'))
    ;(annotation.annotations_drawn || []).forEach(box => append(box, 'drawn'))
  })
  return cells
}

function applyWithinRules(cells, rules) {
  let active = cells.map(cell => ({ ...cell }))
  rules.forEach(rule => {
    const used = new Set()
    const produced = []
    const candidates = active.map((cell, index) => ({ cell, index })).filter(({ cell }) => rule.inputs.includes(`${cell.channel}:${cell.originalLabel || cell.label}`) || rule.inputs.includes(`${cell.channel}:${cell.label}`))
    for (const seed of candidates) {
      if (used.has(seed.index)) continue
      const group = [seed]
      for (const candidate of candidates) {
        if (candidate.index === seed.index || used.has(candidate.index) || group.some(item => item.index === candidate.index)) continue
        if (!rule.inputs.includes(`${candidate.cell.channel}:${candidate.cell.originalLabel || candidate.cell.label}`) && !rule.inputs.includes(`${candidate.cell.channel}:${candidate.cell.label}`)) continue
        const score = overlap(seed.cell, candidate.cell)
        if (score.iou >= rule.iou || score.containment >= rule.containment) group.push(candidate)
      }
      const distinctInputs = new Set(group.map(item => `${item.cell.channel}:${item.cell.originalLabel || item.cell.label}`))
      if (group.length < 2 || distinctInputs.size < rule.inputs.length) continue
      group.forEach(item => used.add(item.index))
      const representative = rule.strategy === 'dominance'
        ? group.find(item => `${item.cell.channel}:${item.cell.originalLabel || item.cell.label}` === rule.inputs[0]) || group[0]
        : group.slice().sort((a, b) => (b.cell.confidence || 0) - (a.cell.confidence || 0))[0]
      produced.push({ ...representative.cell, label: rule.label, originalLabel: rule.label })
    }
    active = active.filter((_, index) => !used.has(index)).concat(produced)
  })
  return active
}

function generateRows(channels, cells, iouThreshold, containmentThreshold) {
  const parent = cells.map((_, index) => index)
  const groups = new Map(cells.map((_, index) => [index, new Set([index])]))
  const root = index => {
    let current = index
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]]
      current = parent[current]
    }
    return current
  }
  const pairs = []
  for (let first = 0; first < cells.length; first += 1) {
    for (let second = first + 1; second < cells.length; second += 1) {
      if (cells[first].channel === cells[second].channel) continue
      const score = overlap(cells[first], cells[second])
      if (score.iou >= iouThreshold || score.containment >= containmentThreshold) pairs.push({ first, second, score: Math.max(score.iou, score.containment) })
    }
  }
  pairs.sort((a, b) => b.score - a.score)
  pairs.forEach(({ first, second }) => {
    const firstRoot = root(first)
    const secondRoot = root(second)
    if (firstRoot === secondRoot) return
    const firstGroup = groups.get(firstRoot)
    const secondGroup = groups.get(secondRoot)
    const channelsInGroup = new Set([...firstGroup].map(index => cells[index].channel))
    if ([...secondGroup].some(index => channelsInGroup.has(cells[index].channel))) return
    parent[secondRoot] = firstRoot
    firstGroup.forEach(index => secondGroup.add(index))
    groups.delete(secondRoot)
  })

  const observed = new Map()
  groups.forEach(group => {
    const states = {}
    group.forEach(index => { states[cells[index].channel] = cells[index].label })
    const key = channels.map(channel => `${channelLabel(channel)}=${states[channelLabel(channel)] || ''}`).join('|')
    observed.set(key, (observed.get(key) || 0) + 1)
  })

  const options = channels.map(channel => [null, ...new Set(cells.filter(cell => cell.channel === channelLabel(channel)).map(cell => cell.label))])
  const rows = []
  const visit = (index, states) => {
    if (index === options.length) {
      if (states.every(value => value == null)) return
      const normalized = Object.fromEntries(channels.map((channel, channelIndex) => [channelLabel(channel), states[channelIndex]]))
      const key = channels.map(channel => `${channelLabel(channel)}=${normalized[channelLabel(channel)] || ''}`).join('|')
      rows.push({ key, states: normalized, count: observed.get(key) || 0, output: '' })
      return
    }
    options[index].forEach(value => visit(index + 1, [...states, value]))
  }
  visit(0, [])
  return rows
}

export default function CombineAnnotationsTwoPhasePage() {
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
      })
      .catch(loadError => setError(loadError.message))
  }, [])

  useEffect(() => {
    if (!imageId) return
    setLoading(true)
    setError('')
    Promise.all([
      fetch(`${API_BASE_URL}/load-channels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ image_id: imageId }) }),
      fetch(`${API_BASE_URL}/load-annotations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ image_id: imageId }) }),
    ])
      .then(async ([channelsResponse, annotationsResponse]) => {
        const channelData = await channelsResponse.json().catch(() => [])
        const annotationData = await annotationsResponse.json().catch(() => ({}))
        if (!channelsResponse.ok || !annotationsResponse.ok) throw new Error(channelData.error || annotationData.error || 'Could not load annotations.')
        setChannels(channelData)
        setAnnotations(annotationData.annotations || [])
        setWithinRules([])
        setSelectedSources([])
        setRows([])
        setPhase(1)
      })
      .catch(loadError => setError(loadError.message))
      .finally(() => setLoading(false))
  }, [imageId])

  const classRows = useMemo(() => {
    const result = []
    annotations.forEach(annotation => {
      const channel = channels.find(candidate => candidate.id === annotation.channel_id)
      if (!channel) return
      ;(annotation.labels?.labels || []).forEach((label, classIndex) => {
        const source = `${channelLabel(channel)}:${label.name}`
        result.push({ key: source, channel: channelLabel(channel), name: label.name, color: label.color || '#cbd5e1', count: [...(annotation.annotations_detected || []), ...(annotation.annotations_drawn || [])].filter(box => Number(box.class) === classIndex).length })
      })
    })
    return result
  }, [annotations, channels])

  const runPhaseTwo = () => {
    const cells = applyWithinRules(flattenCells(channels, annotations, {}), withinRules)
    setRows(generateRows(channels, cells, Number(iouThreshold), Number(containmentThreshold)))
    setSelectedRows([])
    setPage(0)
    setPhase(2)
  }

  const filteredRows = useMemo(() => rows.filter(row => {
    if (observedOnly && row.count === 0) return false
    return !search.trim() || JSON.stringify(row).toLowerCase().includes(search.trim().toLowerCase())
  }), [rows, search, observedOnly])
  const pageRows = filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const classKey = row => `${row.channel}:${row.name}`
  const toggleSource = row => setSelectedSources(previous => previous.includes(classKey(row)) ? previous.filter(key => key !== classKey(row)) : [...previous, classKey(row)])
  const createWithinRule = () => {
    if (selectedSources.length < 2) return
    const channelsInRule = new Set(selectedSources.map(source => source.split(':')[0]))
    if (channelsInRule.size !== 1) { setError('Within-channel rules must use classes from one channel.'); return }
    setWithinRules(previous => [...previous, { id: `within-${Date.now()}`, inputs: selectedSources, strategy: ruleStrategy, label: ruleLabel.trim() || selectedSources.join('+'), iou: Number(iouThreshold), containment: Number(containmentThreshold) }])
    setSelectedSources([]); setRuleLabel(''); setRuleDialogOpen(false); setError('')
  }
  const mergeSelectedRows = () => {
    if (selectedRows.length < 2 || !mergeLabel.trim()) return
    setRows(previous => previous.map(row => selectedRows.includes(row.key) ? { ...row, output: mergeLabel.trim() } : row))
    setSelectedRows([]); setMergeLabel(''); setMergeDialogOpen(false)
  }

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 3, bgcolor: '#101217' }}>
      <Stack spacing={2} sx={{ maxWidth: 1500, mx: 'auto' }}>
        <Typography variant="h5">Combine annotations — two phase</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <FormControl size="small" sx={{ maxWidth: 420 }}>
          <InputLabel id="two-phase-image-label">Image</InputLabel>
          <Select labelId="two-phase-image-label" label="Image" value={imageId} onChange={event => setImageId(event.target.value)}>
            {images.map(image => <MenuItem key={image.id} value={image.id}>{image.name}</MenuItem>)}
          </Select>
        </FormControl>
        {loading && <CircularProgress size={24} />}
        {imageId && !loading && <>
          <Typography variant="h6">Phase 1: within-channel merges</Typography>
          <Typography variant="body2" color="text.secondary">Select classes from one channel, connect them into a rule, and choose the resulting class.</Typography>
          <Table size="small">
            <TableHead><TableRow><TableCell>Select</TableCell><TableCell>Channel</TableCell><TableCell>Class</TableCell><TableCell>Cells</TableCell></TableRow></TableHead>
            <TableBody>{classRows.map(row => <TableRow key={row.key}>
              <TableCell><Checkbox checked={selectedSources.includes(row.key)} onChange={() => toggleSource(row)} /></TableCell>
              <TableCell sx={{ color: CHANNEL_COLORS[(Number(row.channel.slice(1)) - 1) % CHANNEL_COLORS.length] }}>{row.channel}</TableCell>
              <TableCell>{row.name}</TableCell><TableCell>{row.count}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
          <Stack spacing={1}>
            <Button variant="outlined" disabled={selectedSources.length < 2} onClick={() => setRuleDialogOpen(true)}>Create within-channel rule</Button>
            {withinRules.map(rule => <Typography key={rule.id} variant="body2" color="text.secondary">{rule.inputs.join(' + ')} → {rule.label} ({rule.strategy})</Typography>)}
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField size="small" type="number" label="IoU" value={iouThreshold} inputProps={{ min: 0, max: 1, step: 0.01 }} onChange={event => setIouThreshold(event.target.value)} />
            <TextField size="small" type="number" label="Containment" value={containmentThreshold} inputProps={{ min: 0, max: 1, step: 0.01 }} onChange={event => setContainmentThreshold(event.target.value)} />
            <Button variant="contained" onClick={runPhaseTwo}>Open cross-channel table</Button>
          </Stack>
        </>}
        {phase === 2 && <>
          <Typography variant="h6">Phase 2: cross-channel combinations</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField size="small" label="Search" value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} />
            <FormControlLabel control={<Checkbox checked={observedOnly} onChange={event => { setObservedOnly(event.target.checked); setPage(0) }} />} label="Observed only" />
            <Typography variant="body2" color="text.secondary">{filteredRows.length.toLocaleString()} rows</Typography>
            <Button variant="contained" disabled={selectedRows.length < 2} onClick={() => setMergeDialogOpen(true)}>Merge selected rows</Button>
          </Stack>
          <Table size="small" stickyHeader>
            <TableHead><TableRow><TableCell>Output class</TableCell>{channels.map(channel => <TableCell key={channel.id}>{channelLabel(channel)}</TableCell>)}<TableCell>Cells</TableCell></TableRow></TableHead>
            <TableBody>{pageRows.map(row => <TableRow key={row.key} selected={selectedRows.includes(row.key)}>
              <TableCell><Checkbox checked={selectedRows.includes(row.key)} onChange={() => setSelectedRows(previous => previous.includes(row.key) ? previous.filter(key => key !== row.key) : [...previous, row.key])} />{row.output || row.key}</TableCell>
              {channels.map(channel => <TableCell key={channel.id}>{row.states[channelLabel(channel)] || 'negative'}</TableCell>)}
              <TableCell>{row.count}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button disabled={page === 0} onClick={() => setPage(previous => previous - 1)}>Previous</Button>
            <Typography variant="body2">Page {page + 1} of {pageCount}</Typography>
            <Button disabled={page >= pageCount - 1} onClick={() => setPage(previous => previous + 1)}>Next</Button>
            <Button onClick={() => setPhase(1)}>Back to phase 1</Button>
          </Stack>
        </>}
      </Stack>
      <Dialog open={ruleDialogOpen} onClose={() => setRuleDialogOpen(false)}>
        <DialogTitle>Within-channel merge</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2">{selectedSources.join(' + ')}</Typography>
          <FormControl fullWidth size="small"><InputLabel id="within-strategy-label">Interaction</InputLabel><Select labelId="within-strategy-label" label="Interaction" value={ruleStrategy} onChange={event => setRuleStrategy(event.target.value)}><MenuItem value="neutral">No dominance</MenuItem><MenuItem value="dominance">Dominance</MenuItem></Select></FormControl>
          <TextField label="Output class" value={ruleLabel} onChange={event => setRuleLabel(event.target.value)} autoFocus />
        </Stack></DialogContent>
        <DialogActions><Button onClick={() => setRuleDialogOpen(false)}>Cancel</Button><Button variant="contained" onClick={createWithinRule}>Save rule</Button></DialogActions>
      </Dialog>
      <Dialog open={mergeDialogOpen} onClose={() => setMergeDialogOpen(false)}>
        <DialogTitle>Merge selected rows</DialogTitle>
        <DialogContent><TextField label="Output class" value={mergeLabel} onChange={event => setMergeLabel(event.target.value)} autoFocus sx={{ mt: 1 }} /></DialogContent>
        <DialogActions><Button onClick={() => setMergeDialogOpen(false)}>Cancel</Button><Button variant="contained" onClick={mergeSelectedRows}>Save</Button></DialogActions>
      </Dialog>
    </Box>
  )
}
