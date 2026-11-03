import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'

const NODE_WIDTH = 210
const NODE_HEIGHT = 142
const channelName = channel => `C${(channel.order_index ?? 0) + 1}`
const emptyGraph = { created: [], edges: [], positions: {}, zoom: 1 }

function reaches(start, goal, edges) {
  const pending = [start], seen = new Set()
  while (pending.length) {
    const current = pending.pop()
    if (current === goal) return true
    if (seen.has(current)) continue
    seen.add(current)
    edges.filter(edge => edge.source === current).forEach(edge => pending.push(edge.target))
  }
  return false
}

export default function TwoPhaseChannelGraph({ channel, classes, graph = emptyGraph, onChange }) {
  const [connecting, setConnecting] = useState(null)
  const [pointer, setPointer] = useState(null)
  const [error, setError] = useState('')
  const connectionRef = useRef(null)
  const dragRef = useRef(null)
  const viewportRef = useRef(null)
  const canvasRef = useRef(null)
  const zoom = graph.zoom || 1
  const nodes = useMemo(() => [
    ...classes.map((entry, index) => ({ ...entry, type: 'input', x: 32, y: 32 + index * (NODE_HEIGHT + 24) })),
    ...(graph.created || []).map(node => ({ ...node, x: node.x ?? 320, y: node.y ?? 32 })),
  ].map(node => ({ ...node, ...(graph.positions?.[node.id] || {}) })), [classes, graph.created, graph.positions])
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const edges = graph.edges || []
  const width = Math.max(760, ...nodes.map(node => node.x + NODE_WIDTH + 50))
  const height = Math.max(390, ...nodes.map(node => node.y + NODE_HEIGHT + 50))
  const activeColor = classes[0]?.color || '#cbd5e1'
  const update = change => onChange(previous => ({ ...emptyGraph, ...previous, ...change }))
  const clearConnection = () => { connectionRef.current = null; setConnecting(null); setPointer(null) }
  const connect = (source, target) => {
    clearConnection()
    if (!source || !target || source === target) return
    if (!nodeById.has(source) || !nodeById.has(target) || nodeById.get(target).type === 'input') {
      setError('Connect a class or result into a rule or output node.'); return
    }
    if (reaches(target, source, edges)) { setError('That connection would create a cycle.'); return }
    const id = `${source}->${target}`
    onChange(previous => previous.edges?.some(edge => edge.id === id) ? previous
      : { ...emptyGraph, ...previous, edges: [...(previous.edges || []), { id, source, target }] })
    setError('')
  }
  useEffect(() => {
    if (!connecting) return undefined
    const move = event => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect) setPointer({ x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom })
    }
    const up = event => {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-two-phase-input]')
      if (target && connectionRef.current) connect(connectionRef.current, target.dataset.twoPhaseInput)
      else setPointer(null)
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
  })
  const addNode = type => {
    const count = graph.created?.length || 0
    const id = `${type}:${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${count}`}`
    const node = { id, type, name: type === 'rule' ? 'IoU node' : 'Output', ruleType: 'iou', threshold: 0.25,
      x: 320 + Math.floor(count / 4) * 260, y: 32 + (count % 4) * (NODE_HEIGHT + 24), color: '#cbd5e1' }
    update({ created: [...(graph.created || []), node] })
  }
  const updateNode = (id, change) => onChange(previous => ({ ...previous,
    created: (previous.created || []).map(node => node.id === id ? { ...node, ...change } : node) }))
  const removeNode = id => onChange(previous => ({ ...previous,
    created: (previous.created || []).filter(node => node.id !== id),
    edges: (previous.edges || []).filter(edge => edge.source !== id && edge.target !== id),
    positions: Object.fromEntries(Object.entries(previous.positions || {}).filter(([key]) => key !== id)) }))
  const startDrag = (event, node) => {
    if (event.button !== 0 || event.target.closest('button, input, [role="combobox"]')) return
    dragRef.current = { id: node.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, nodeX: node.x, nodeY: node.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = event => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const x = Math.max(8, drag.nodeX + (event.clientX - drag.x) / zoom)
    const y = Math.max(8, drag.nodeY + (event.clientY - drag.y) / zoom)
    onChange(previous => ({ ...previous, positions: { ...previous.positions, [drag.id]: { x, y } } }))
  }
  const endDrag = event => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
  }
  const port = (node, direction) => <Box component="button" type="button"
    data-two-phase-input={direction === 'in' ? node.id : undefined}
    aria-label={`${direction === 'out' ? 'Connect from' : 'Connect into'} ${node.name}`}
    onPointerDown={event => { event.stopPropagation(); if (direction === 'out') { connectionRef.current = node.id; setConnecting(node.id) } }}
    onClick={event => { event.stopPropagation(); if (direction === 'out') { connectionRef.current = node.id; setConnecting(node.id) } else if (connectionRef.current) connect(connectionRef.current, node.id) }}
    sx={{ position: 'absolute', [direction === 'out' ? 'right' : 'left']: -8, top: NODE_HEIGHT / 2 - 8,
      width: 16, height: 16, p: 0, border: '2px solid #10131b', borderRadius: '50%',
      bgcolor: node.color || activeColor, cursor: 'crosshair' }} />

  return <Stack spacing={1.5}>
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
      <Typography variant="h6" sx={{ flexGrow: 1 }}>{channelName(channel)} graph</Typography>
      <Button variant="outlined" size="small" onClick={() => addNode('rule')}>Add rule</Button>
      <Button variant="outlined" size="small" onClick={() => addNode('output')}>Add output</Button>
      <Button size="small" aria-label="Zoom out" onClick={() => update({ zoom: Math.max(0.4, zoom - 0.1) })}>−</Button>
      <Typography variant="caption">{Math.round(zoom * 100)}%</Typography>
      <Button size="small" aria-label="Zoom in" onClick={() => update({ zoom: Math.min(1.5, zoom + 0.1) })}>+</Button>
      <Button size="small" onClick={() => { update({ zoom: Math.max(0.4, Math.min(1, (viewportRef.current?.clientWidth || 800) / width)) }); viewportRef.current?.scrollTo?.(0, 0) }}>Fit</Button>
      <Button size="small" onClick={() => update({ positions: {}, zoom: 1 })}>Arrange</Button>
    </Stack>
    <Typography variant="body2" color="text.secondary">Drag cards to arrange them. Connect a right dot to a rule or output node’s left dot. Connections are a visual draft for this channel.</Typography>
    {error && <Alert severity="warning">{error}</Alert>}
    <Box ref={viewportRef} sx={{ height: 500, overflow: 'auto', bgcolor: '#10131b', border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Box sx={{ width: width * zoom, height: height * zoom, minWidth: '100%' }}>
        <Box ref={canvasRef} sx={{ position: 'relative', width, height, transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
          <svg width={width} height={height} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <defs><marker id={`two-phase-arrow-${channel.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#94a3b8" /></marker></defs>
            {edges.map(edge => {
              const source = nodeById.get(edge.source), target = nodeById.get(edge.target)
              if (!source || !target) return null
              const x = source.x + NODE_WIDTH, y = source.y + NODE_HEIGHT / 2, tx = target.x, ty = target.y + NODE_HEIGHT / 2
              const d = `M${x} ${y} C${x + 60} ${y},${tx - 60} ${ty},${tx} ${ty}`
              return <g key={edge.id}><path d={d} fill="none" stroke="#94a3b8" strokeWidth="2" markerEnd={`url(#two-phase-arrow-${channel.id})`} />
                <path d={d} fill="none" stroke="transparent" strokeWidth="16" style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                  role="button" tabIndex={0} aria-label={`Remove connection from ${source.name} to ${target.name}`}
                  onClick={() => update({ edges: edges.filter(item => item.id !== edge.id) })}
                  onKeyDown={event => { if (event.key === 'Enter') update({ edges: edges.filter(item => item.id !== edge.id) }) }} /></g>
            })}
            {connecting && pointer && nodeById.get(connecting) && <path d={`M${nodeById.get(connecting).x + NODE_WIDTH} ${nodeById.get(connecting).y + NODE_HEIGHT / 2} L${pointer.x} ${pointer.y}`} fill="none" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="5 4" />}
          </svg>
          {nodes.map(node => <Box key={node.id} onPointerDown={event => startDrag(event, node)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
            sx={{ position: 'absolute', left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT, boxSizing: 'border-box', p: 1.25,
              border: `2px solid ${node.color || activeColor}`, borderRadius: 1, bgcolor: '#191d28', cursor: 'grab', userSelect: 'none', touchAction: 'none' }}>
            <Typography variant="caption" sx={{ color: node.color || activeColor }}>{node.type === 'input' ? 'CLASS' : node.type === 'rule' ? 'RULE' : 'OUTPUT'}</Typography>
            {node.type === 'input' ? <><Typography variant="body2" title={node.name} sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{node.name}</Typography>
              {node.sublabel && <Typography variant="caption" color="text.secondary">{node.sublabel}</Typography>}
              <Typography variant="caption" display="block" color="text.secondary">{node.count} detections</Typography></>
              : node.type === 'rule' ? <Stack spacing={0.75} sx={{ mt: 0.5 }}>
                <FormControl size="small" fullWidth onPointerDown={event => event.stopPropagation()}><InputLabel>Rule</InputLabel><Select label="Rule" value={node.ruleType} onChange={event => updateNode(node.id, { ruleType: event.target.value })}>
                  <MenuItem value="iou">IoU</MenuItem><MenuItem value="containment">Containment</MenuItem>
                </Select></FormControl>
                <TextField size="small" type="number" label="Threshold" value={node.threshold} inputProps={{ min: 0, max: 1, step: 0.05 }} onPointerDown={event => event.stopPropagation()}
                  onChange={event => updateNode(node.id, { threshold: event.target.value })} />
              </Stack> : <TextField size="small" label="Output name" value={node.name} onPointerDown={event => event.stopPropagation()}
                onChange={event => updateNode(node.id, { name: event.target.value })} sx={{ mt: 1, width: '100%' }} />}
            {node.type !== 'input' && <><Button size="small" aria-label={`Delete ${node.name}`} onPointerDown={event => event.stopPropagation()} onClick={() => removeNode(node.id)}
              sx={{ position: 'absolute', top: 1, right: 1, minWidth: 20, p: 0 }}>×</Button>{port(node, 'in')}</>}
            {port(node, 'out')}
          </Box>)}
          {!nodes.length && <Typography sx={{ p: 3 }} color="text.secondary">No classes are available in this channel.</Typography>}
        </Box>
      </Box>
    </Box>
    {connecting && <Stack direction="row" alignItems="center"><Typography variant="body2" sx={{ flexGrow: 1 }}>Connecting from {nodeById.get(connecting)?.name}. Select a left dot.</Typography><Button size="small" onClick={clearConnection}>Cancel</Button></Stack>}
  </Stack>
}
