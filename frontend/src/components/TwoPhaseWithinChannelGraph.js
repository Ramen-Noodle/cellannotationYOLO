import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'

const COLORS = ['#ff4d4d', '#4dff88', '#5c8dff', '#ffe04d', '#ff63d8', '#4de8ff']
const WIDTH = 248
const HEIGHT = 156
const channelName = channel => `C${(channel.order_index ?? 0) + 1}`
const collisionAt = (placed, x, y) => placed.find(p => x < p.x + WIDTH + 24 && x + WIDTH + 24 > p.x && y < p.y + HEIGHT + 24 && y + HEIGHT + 24 > p.y)

function layout(nodes, manual) {
  const positions = {}
  const placed = []
  let nextY = 32
  for (const node of nodes) {
    const parents = (node.rule?.inputs || []).map(id => positions[id]).filter(Boolean)
    let x = parents.length ? Math.max(...parents.map(p => p.x + WIDTH)) + 70 : 28
    let y = parents.length ? Math.max(28, (Math.min(...parents.map(p => p.y)) + Math.max(...parents.map(p => p.y + HEIGHT)) - HEIGHT) / 2) : nextY
    if (!parents.length) nextY += HEIGHT + 40
    if (manual[node.id]) ({ x, y } = manual[node.id])
    else {
      let collision
      do {
        collision = collisionAt(placed, x, y)
        if (collision) y = collision.y + HEIGHT + 28
      } while (collision)
    }
    positions[node.id] = { x, y }
    placed.push({ x, y })
  }
  return positions
}

export default function TwoPhaseWithinChannelGraph({ channels, classes, rules, onChange, audit = [], evaluationError = '' }) {
  const [channelId, setChannelId] = useState(channels[0]?.id || '')
  const [graphs, setGraphs] = useState({})
  const [connecting, setConnecting] = useState(null)
  const [pointer, setPointer] = useState(null)
  const [editor, setEditor] = useState(null)
  const [error, setError] = useState('')
  const viewport = useRef(null)
  const canvas = useRef(null)
  const drag = useRef(null)
  const connectionRef = useRef(null)
  const skipClick = useRef(false)
  const ruleSequence = useRef(0)
  const channel = channels.find(entry => entry.id === channelId)
  const name = channel ? channelName(channel) : ''
  const accent = COLORS[(channel?.order_index ?? 0) % COLORS.length]
  const graph = graphs[channelId] || {}
  const zoom = graph.zoom || 1
  const nodes = useMemo(() => [
    ...classes.filter(entry => entry.channelId === channelId).map(entry => ({ id: entry.key, label: entry.name, count: entry.count })),
    ...rules.filter(rule => rule.channelId === channelId).map(rule => ({ id: rule.id, label: rule.label, rule })),
  ], [classes, rules, channelId])
  const positions = useMemo(() => layout(nodes, graph.positions || {}), [nodes, graph.positions])
  const width = Math.max(760, ...Object.values(positions).map(p => p.x + WIDTH + 40))
  const height = Math.max(390, ...Object.values(positions).map(p => p.y + HEIGHT + 40))
  const labelOf = id => nodes.find(node => node.id === id)?.label || id
  const clearConnection = useCallback(() => {
    connectionRef.current = null
    setConnecting(null); setPointer(null)
  }, [])
  const updateGraph = change => setGraphs(previous => ({ ...previous, [channelId]: { ...previous[channelId], ...change } }))
  const setZoom = value => updateGraph({ zoom: Math.max(0.4, Math.min(1.4, value)) })
  const fit = () => {
    setZoom(Math.min(1, (viewport.current?.clientWidth || 800) / width))
    viewport.current?.scrollTo?.(0, 0)
  }
  const switchChannel = id => {
    setChannelId(id); clearConnection(); setEditor(null); setError(''); drag.current = null
  }
  const invalidate = next => { clearConnection(); onChange(next) }
  const openRule = (rule, inputs) => {
    setEditor({ id: rule?.id || null, channelId, inputs: [...(rule?.inputs || inputs)],
      label: rule?.label || (inputs?.length === 1 ? labelOf(inputs[0]) : ''),
      strategy: rule?.strategy || 'neutral', iou: rule?.iou ?? 0.25, containment: rule?.containment ?? 0.6, error: '' })
    clearConnection(); setError('')
  }
  const connect = useCallback((from, to) => {
    clearConnection()
    if (from === to) return
    if (![from, to].every(id => nodes.some(node => node.id === id))) { setError('Choose nodes from the same channel.'); return }
    if (rules.some(rule => rule.inputs.includes(from) || rule.inputs.includes(to))) {
      setError('That class already feeds a merge. Connect its result card to extend the tree.'); return
    }
    // The target is the default dominant input, as in the standalone editor.
    setEditor({ id: null, channelId, inputs: [to, from], label: '', strategy: 'neutral', iou: 0.25, containment: 0.6, error: '' })
    setError('')
  }, [nodes, rules, channelId, clearConnection])
  const startConnection = id => {
    connectionRef.current = id; setConnecting(id); setPointer(null); setError('')
  }

  useEffect(() => {
    if (!connecting) return undefined
    const move = event => {
      const rect = canvas.current?.getBoundingClientRect()
      if (rect) setPointer({ x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom })
    }
    const up = event => {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-within-input]')
      if (target && target.dataset.channelId === channelId && connectionRef.current) connect(connectionRef.current, target.dataset.withinInput)
    }
    const key = event => { if (event.key === 'Escape') clearConnection() }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', key)
    }
  }, [connecting, zoom, channelId, connect, clearConnection])

  const saveRule = event => {
    event.preventDefault()
    const label = editor.label.trim()
    const thresholds = [Number(editor.iou), Number(editor.containment)]
    const invalid = !label || /\s/.test(label) ? 'Use a nonempty result name without spaces; use underscores.'
      : [editor.iou, editor.containment].some(value => String(value).trim() === '') || !thresholds.every(value => Number.isFinite(value) && value >= 0 && value <= 1) ? 'Overlap thresholds must be between 0 and 1.' : ''
    if (invalid) { setEditor(previous => ({ ...previous, error: invalid })); return }
    if (editor.channelId !== channelId) return
    const ruleId = editor.id || `within:${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}:${ruleSequence.current++}`}`
    const rule = { id: ruleId, mode: 'within', channelId, channel: name,
      inputs: editor.inputs, strategy: editor.strategy, label, iou: thresholds[0], containment: thresholds[1] }
    invalidate(editor.id ? rules.map(previous => previous.id === editor.id ? rule : previous) : [...rules, rule])
    setEditor(null)
  }
  const deleteRule = id => {
    const dead = new Set([id])
    const next = rules.filter(rule => {
      if (dead.has(rule.id) || rule.inputs.some(input => dead.has(input))) { dead.add(rule.id); return false }
      return true
    })
    invalidate(next)
    setEditor(null)
  }
  const beginDrag = (event, node) => {
    if (event.button !== 0 || event.target.closest('button')) return
    skipClick.current = false
    drag.current = { id: node.id, channelId, pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: positions[node.id] }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = event => {
    const active = drag.current
    if (!active || active.channelId !== channelId) return
    if (Math.abs(event.clientX - active.x) + Math.abs(event.clientY - active.y) < 4 && !skipClick.current) return
    skipClick.current = true
    const position = { x: Math.max(20, active.origin.x + (event.clientX - active.x) / zoom), y: Math.max(25, active.origin.y + (event.clientY - active.y) / zoom) }
    setGraphs(previous => ({ ...previous, [channelId]: { ...previous[channelId], positions: { ...previous[channelId]?.positions, [active.id]: position } } }))
  }
  const endDrag = event => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    drag.current = null
  }
  const port = (node, direction) => <Box component="button" type="button" data-within-input={direction === 'in' ? node.id : undefined} data-channel-id={channelId}
    aria-label={`${direction === 'out' ? 'Connect from' : 'Connect into'} ${node.label} ${name}`}
    onPointerDown={event => { event.stopPropagation(); if (direction === 'out') startConnection(node.id) }}
    onClick={event => {
      event.stopPropagation()
      if (direction === 'out') { if (event.detail === 0) startConnection(node.id) }
      else if (connectionRef.current) connect(connectionRef.current, node.id)
    }}
    sx={{ position: 'absolute', [direction === 'out' ? 'right' : 'left']: -9, top: HEIGHT / 2 - 9, width: 18, height: 18, p: 0, borderRadius: '50%', border: '2px solid #10131b', bgcolor: direction === 'in' && connecting ? '#00e5ff' : accent, cursor: 'crosshair', '&:focus-visible': { outline: '2px solid white' } }} />

  return <Stack spacing={1.5}>
    <Typography variant="h6">Phase 1: merge within a channel</Typography>
    <Typography variant="body2" color="text.secondary">C1/C2 contained boxes are cleaned automatically: when over 95% of the smaller box lies inside a larger box, the larger box and class win. C3 stays separate until intersections.</Typography>
    <Stack direction="row" spacing={1} role="group" aria-label="Channels">{channels.map(entry => <Button key={entry.id} size="small" variant={channelId === entry.id ? 'contained' : 'outlined'} onClick={() => switchChannel(entry.id)} sx={{ color: COLORS[(entry.order_index ?? 0) % COLORS.length] }}>{channelName(entry)}</Button>)}</Stack>
    <Typography variant="body2" color="text.secondary">Drag right dot → left dot, or click the two dots. Choose No dominance or Dominance. Extend a tree by connecting its result to another class or result. Click a result or line to edit.</Typography>
    {(error || evaluationError) && <Alert severity="error">{error || evaluationError}</Alert>}
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography variant="caption" sx={{ flexGrow: 1, color: accent }}>{name} / INPUTS → MERGED GROUPS</Typography>
      <Button size="small" aria-label="Zoom out" onClick={() => setZoom(zoom - 0.1)}>−</Button>
      <Typography variant="caption">{Math.round(zoom * 100)}%</Typography>
      <Button size="small" aria-label="Zoom in" onClick={() => setZoom(zoom + 0.1)}>+</Button>
      <Button size="small" onClick={fit}>Fit</Button>
      <Button size="small" onClick={() => updateGraph({ positions: {}, zoom: 1 })}>Arrange</Button>
    </Stack>
    <Box key={channelId} ref={viewport} role="region" aria-label={`${name} within-channel graph`} sx={{ height: 540, overflow: 'auto', bgcolor: '#10131b', border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Box sx={{ width: width * zoom, height: height * zoom, minWidth: '100%' }}>
        <Box ref={canvas} sx={{ position: 'relative', width, height, transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
          <svg width={width} height={height} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <defs><marker id="within-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10Z" fill={accent} /></marker></defs>
            {nodes.filter(node => node.rule).flatMap(node => node.rule.inputs.map((input, index) => {
              const a = positions[input], b = positions[node.id]
              if (!a || !b) return null
              const x = a.x + WIDTH + 9, y = a.y + HEIGHT / 2, tx = b.x - 9, ty = b.y + HEIGHT / 2
              const d = `M${x} ${y} C${x + 70} ${y},${tx - 70} ${ty},${tx} ${ty}`
              return <g key={`${node.id}:${input}`}>
                <path d={d} stroke={accent} strokeWidth="2" fill="none" markerEnd="url(#within-arrow)" />
                <path d={d} stroke="transparent" strokeWidth="18" fill="none" style={{ pointerEvents: 'stroke', cursor: 'pointer' }} role="button" tabIndex={0} aria-label={`Edit ${node.label} connection from ${labelOf(input)}`}
                  onClick={() => openRule(node.rule)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openRule(node.rule) } }} />
                <text x={(x + tx) / 2} y={(y + ty) / 2 - 10} textAnchor="middle" fill={accent} fontSize="12">{node.rule.strategy === 'neutral' ? 'equal' : index === 0 ? 'dominant' : ''}</text>
              </g>
            }))}
            {connecting && pointer && positions[connecting] && <path d={`M${positions[connecting].x + WIDTH} ${positions[connecting].y + HEIGHT / 2} L${pointer.x} ${pointer.y}`} fill="none" stroke={accent} strokeWidth="2" strokeDasharray="5 4" />}
          </svg>
          {nodes.map(node => <Box key={node.id} tabIndex={0} aria-label={`${name} ${node.rule ? 'merge' : 'input'} ${node.label}`}
            onPointerDown={event => beginDrag(event, node)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={event => { skipClick.current = true; endDrag(event) }}
            onClick={event => { if (!event.target.closest('button') && !skipClick.current && node.rule) openRule(node.rule) }}
            onKeyDown={event => { if (event.target === event.currentTarget && node.rule && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openRule(node.rule) } }}
            sx={{ position: 'absolute', left: positions[node.id].x, top: positions[node.id].y, width: WIDTH, height: HEIGHT, boxSizing: 'border-box', p: 1.5, border: `2px solid ${accent}`, borderRadius: 1.5, bgcolor: node.rule ? '#211d2d' : '#191d28', cursor: 'grab', touchAction: 'none', userSelect: 'none', '&:focus-visible': { outline: '2px solid white' } }}>
            <Typography variant="caption" sx={{ color: accent }}>{node.rule ? 'MERGED GROUP' : `${name} · INPUT`}</Typography>
            <Typography variant="body2" title={node.label} sx={{ fontWeight: 700, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere' }}>{node.label.replaceAll('_', ' ')}</Typography>
            <Typography variant="caption" color="text.secondary">{node.rule ? node.rule.strategy === 'neutral' ? 'No dominance · click to edit' : `Dominant: ${labelOf(node.rule.inputs[0])}` : `${node.count.toLocaleString()} detections`}</Typography>
            {!node.rule && <Button size="small" aria-label={`Deduplicate ${node.label} ${name}`} onClick={event => { event.stopPropagation(); openRule(null, [node.id]) }} sx={{ display: 'block', mt: 0.5 }}>Deduplicate</Button>}
            {port(node, 'in')}{port(node, 'out')}
          </Box>)}
          {!nodes.length && <Typography color="text.secondary" sx={{ p: 3 }}>No detections in this channel.</Typography>}
        </Box>
      </Box>
    </Box>
    {connecting && <Stack direction="row" alignItems="center"><Typography variant="body2" sx={{ flex: 1 }}>Connecting from {labelOf(connecting)}. Select a left dot.</Typography><Button size="small" onClick={clearConnection}>Cancel connection</Button></Stack>}
    <Typography variant="caption" color="text.secondary">{rules.filter(rule => rule.channelId === channelId).length} within-channel rules · {audit.filter(entry => entry.label.endsWith('containment cleanup')).reduce((sum, entry) => sum + entry.removed, 0).toLocaleString()} contained C1/C2 duplicates removed</Typography>
    <Dialog open={Boolean(editor)} onClose={() => setEditor(null)} fullWidth maxWidth="sm">
      {editor && <Box component="form" onSubmit={saveRule}>
        <DialogTitle>{editor.id ? 'Edit rule' : editor.inputs.length === 1 ? 'Deduplicate class' : 'Merge these classes'}</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2">{editor.inputs.map(id => `${name}: ${labelOf(id)}`).join(' + ')}</Typography>
          <FormControl fullWidth size="small"><InputLabel id="within-strategy-label">Interaction</InputLabel><Select labelId="within-strategy-label" label="Interaction" value={editor.strategy} onChange={event => setEditor(previous => ({ ...previous, strategy: event.target.value, label: event.target.value === 'dominance' && !previous.label ? labelOf(previous.inputs[0]) : previous.label }))}>
            <MenuItem value="neutral">No dominance · name a new group</MenuItem><MenuItem value="dominance">Dominance · target class wins</MenuItem>
          </Select></FormControl>
          <Typography variant="body2" color="text.secondary">{editor.strategy === 'neutral' ? 'Both classes contribute equally. Confidence selects only the representative box.' : `${labelOf(editor.inputs[0])} dominates: its class and box take priority. You may rename the result.`}</Typography>
          <TextField label="Result name" autoFocus required value={editor.label} onChange={event => setEditor(previous => ({ ...previous, label: event.target.value }))} helperText="Use underscores between words." />
          <Box component="details"><Box component="summary" sx={{ cursor: 'pointer', mb: 1 }}>Overlap settings</Box><Stack direction="row" spacing={2}>
            <TextField fullWidth size="small" type="number" label="IoU greater than" value={editor.iou} inputProps={{ min: 0, max: 1, step: 0.05 }} onChange={event => setEditor(previous => ({ ...previous, iou: event.target.value }))} />
            <TextField fullWidth size="small" type="number" label="Containment greater than" value={editor.containment} inputProps={{ min: 0, max: 1, step: 0.05 }} onChange={event => setEditor(previous => ({ ...previous, containment: event.target.value }))} />
          </Stack><Typography variant="caption">Either threshold can match a pair. Separate detections keep their geometry and receive the result class.</Typography></Box>
          {editor.error && <Alert severity="error">{editor.error}</Alert>}
        </Stack></DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap' }}>
          {editor.id && <Button color="error" onClick={() => deleteRule(editor.id)}>Delete rule and dependents</Button>}
          {editor.strategy === 'dominance' && editor.inputs.length > 1 && <Button onClick={() => setEditor(previous => { const inputs = [...previous.inputs].reverse(); return { ...previous, inputs, label: labelOf(inputs[0]) } })}>Reverse priority</Button>}
          <Button onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" variant="contained">Save rule</Button>
        </DialogActions>
      </Box>}
    </Dialog>
  </Stack>
}
