import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, CircularProgress, FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material'

const API_BASE_URL = 'http://10.80.24.12:5001'
const CHANNEL_COLORS = ['#38bdf8', '#f97316', '#a78bfa', '#34d399', '#f472b6', '#facc15']

function channelName(channel) { return `C${(channel.order_index ?? 0) + 1}` }
function annotationCount(annotation, labelIndex) {
  return [...(annotation.annotations_detected || []), ...(annotation.annotations_drawn || [])]
    .filter(box => Number(box.class) === labelIndex).length
}

export default function CombineAnnotationsPage() {
  const [images, setImages] = useState([])
  const [imageId, setImageId] = useState('')
  const [channels, setChannels] = useState([])
  const [annotations, setAnnotations] = useState([])
  const [nodes, setNodes] = useState([])
  const [createdNodes, setCreatedNodes] = useState([])
  const [connections, setConnections] = useState([])
  const [connectionDrag, setConnectionDrag] = useState(null)
  const [loadingImages, setLoadingImages] = useState(true)
  const [loadingAnnotations, setLoadingAnnotations] = useState(false)
  const [error, setError] = useState('')
  const dragRef = useRef(null)
  const graphRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE_URL}/user-images`, { credentials: 'include' })
      .then(async response => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'Could not load images.')
        return data
      })
      .then(data => { if (!cancelled) { setImages(data); if (data[0]) setImageId(data[0].id) } })
      .catch(loadError => { if (!cancelled) setError(loadError.message) })
      .finally(() => { if (!cancelled) setLoadingImages(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!imageId) return
    let cancelled = false
    setLoadingAnnotations(true)
    setError('')
    Promise.all([
      fetch(`${API_BASE_URL}/load-channels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ image_id: imageId }) }),
      fetch(`${API_BASE_URL}/load-annotations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ image_id: imageId }) }),
    ])
      .then(async ([channelsResponse, annotationsResponse]) => {
        const channelData = await channelsResponse.json().catch(() => [])
        const annotationData = await annotationsResponse.json().catch(() => ({}))
        if (!channelsResponse.ok) throw new Error(channelData.error || 'Could not load channels.')
        if (!annotationsResponse.ok) throw new Error(annotationData.error || 'Could not load annotations.')
        return { channelData, annotationData }
      })
      .then(({ channelData, annotationData }) => { if (!cancelled) { setChannels(channelData); setAnnotations(annotationData.annotations || []) } })
      .catch(loadError => { if (!cancelled) setError(loadError.message) })
      .finally(() => { if (!cancelled) setLoadingAnnotations(false) })
    return () => { cancelled = true }
  }, [imageId])

  useEffect(() => {
    setCreatedNodes([])
    setConnections([])
    setConnectionDrag(null)
  }, [imageId])

  const channelById = useMemo(() => new Map(channels.map(channel => [channel.id, channel])), [channels])

  useEffect(() => {
    const nextNodes = []
    channels.forEach((channel, channelIndex) => {
      const labels = new Map()
      annotations.filter(annotation => annotation.channel_id === channel.id).forEach(annotation => {
        ;(annotation.labels?.labels || []).forEach((label, labelIndex) => {
          if (!labels.has(label.name)) labels.set(label.name, { count: 0 })
          labels.get(label.name).count += annotationCount(annotation, labelIndex)
        })
      })
      ;[...labels.entries()].forEach(([name, entry], classIndex) => nextNodes.push({
        id: `${channel.id}:${name}`, channelId: channel.id, channelIndex, name, count: entry.count,
        color: CHANNEL_COLORS[channelIndex % CHANNEL_COLORS.length], x: 32 + channelIndex * 250, y: 32 + classIndex * 116,
      }))
    })
    setNodes(nextNodes)
  }, [annotations, channels])

  const displayNodes = useMemo(() => [...nodes, ...createdNodes], [nodes, createdNodes])
  const graphWidth = Math.max(760, channels.length * 250, ...displayNodes.map(node => node.x + 230))
  const graphHeight = Math.max(560, ...displayNodes.map(node => node.y + 150))

  const moveNode = (event, node) => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { id: node.id, created: node.created, start: { x: event.clientX, y: event.clientY, nodeX: node.x, nodeY: node.y } }
  }
  const dragNode = event => {
    const drag = dragRef.current
    if (!drag) return
    const nextPosition = { x: Math.max(8, drag.start.nodeX + event.clientX - drag.start.x), y: Math.max(8, drag.start.nodeY + event.clientY - drag.start.y) }
    if (drag.created) {
      setCreatedNodes(previous => previous.map(node => node.id === drag.id ? { ...node, ...nextPosition } : node))
    } else {
      setNodes(previous => previous.map(node => node.id === drag.id ? { ...node, ...nextPosition } : node))
    }
  }
  const finishDrag = event => {
    if (dragRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
  }
  const graphPoint = event => {
    const bounds = graphRef.current?.getBoundingClientRect()
    if (!bounds) return { x: event.clientX, y: event.clientY }
    return { x: event.clientX - bounds.left + (graphRef.current?.scrollLeft || 0), y: event.clientY - bounds.top + (graphRef.current?.scrollTop || 0) }
  }
  const beginConnection = (event, node) => {
    event.preventDefault()
    event.stopPropagation()
    const point = graphPoint(event)
    setConnectionDrag({ sourceId: node.id, x: point.x, y: point.y })
  }
  const dragConnection = event => {
    if (!connectionDrag) return
    const point = graphPoint(event)
    setConnectionDrag(previous => previous ? { ...previous, x: point.x, y: point.y } : previous)
  }
  const completeConnection = (event, target) => {
    if (!connectionDrag) return
    event.preventDefault()
    event.stopPropagation()
    const sourceId = connectionDrag.sourceId
    if (sourceId !== target.id && target.created) {
      setConnections(previous => previous.some(connection => connection.source === sourceId && connection.target === target.id)
        ? previous
        : [...previous, { id: `${sourceId}->${target.id}`, source: sourceId, target: target.id }])
    }
    setConnectionDrag(null)
  }
  const cancelConnection = () => setConnectionDrag(null)
  const addNode = () => {
    const index = createdNodes.length
    setCreatedNodes(previous => [...previous, {
      id: `created-${Date.now()}-${index}`, created: true, name: 'New node', count: 0,
      color: '#cbd5e1', x: 32 + channels.length * 250, y: 32 + index * 116,
    }])
  }
  const selectedImage = images.find(image => image.id === imageId)

  return (
    <Box sx={{ height: '100%', p: 3, boxSizing: 'border-box', bgcolor: 'background.default', overflow: 'auto' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5">Combine Annotations</Typography>
          <Typography color="text.secondary" variant="body2">Connect loaded classes into user-created nodes to define merge relationships.</Typography>
        </Box>
        <Box component="button" type="button" onClick={addNode} disabled={!imageId} sx={{ px: 1.5, py: 0.75, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', color: 'text.primary', cursor: imageId ? 'pointer' : 'not-allowed' }}>Add node</Box>
        <FormControl size="small" sx={{ minWidth: 280 }} disabled={loadingImages || images.length === 0}>
          <InputLabel id="combine-image-label">Image</InputLabel>
          <Select labelId="combine-image-label" label="Image" value={imageId} onChange={event => setImageId(event.target.value)}>
            {images.map(image => <MenuItem key={image.id} value={image.id}>{image.name || image.id}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>
      {loadingImages && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><Typography>Loading images…</Typography></Stack>}
      {error && <Alert severity="info" sx={{ mb: 2 }}>{error}</Alert>}
      {!loadingImages && images.length === 0 && !error && <Alert severity="info">No images are available yet.</Alert>}
      {loadingAnnotations && <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}><CircularProgress size={18} /><Typography>Loading channel annotations…</Typography></Stack>}
      <Box ref={graphRef} onPointerMove={event => { dragNode(event); dragConnection(event) }} onPointerUp={event => { finishDrag(event); cancelConnection() }} onPointerCancel={event => { finishDrag(event); cancelConnection() }} onContextMenu={event => event.preventDefault()}
        sx={{ position: 'relative', minHeight: 560, minWidth: graphWidth, bgcolor: '#10131b', border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'auto' }}>
        {channels.map((channel, index) => <Typography key={channel.id} variant="caption" sx={{ position: 'absolute', top: 8, left: 32 + index * 250, color: CHANNEL_COLORS[index % CHANNEL_COLORS.length], fontWeight: 700 }}>{channelName(channel)}</Typography>)}
        <svg width={graphWidth} height={graphHeight} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
          <defs><marker id="combine-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" /></marker></defs>
          {connections.map(connection => {
            const source = displayNodes.find(node => node.id === connection.source)
            const target = displayNodes.find(node => node.id === connection.target)
            if (!source || !target) return null
            return <line key={connection.id} x1={source.x + 196} y1={source.y + 24 + 37} x2={target.x} y2={target.y + 24 + 37} stroke="#94a3b8" strokeWidth="2" markerEnd="url(#combine-arrow)" />
          })}
          {connectionDrag && <line x1={(displayNodes.find(node => node.id === connectionDrag.sourceId)?.x || 0) + 196} y1={(displayNodes.find(node => node.id === connectionDrag.sourceId)?.y || 0) + 61} x2={connectionDrag.x} y2={connectionDrag.y} stroke="#cbd5e1" strokeWidth="2" strokeDasharray="6 4" />}
        </svg>
        {displayNodes.map(node => <Box key={node.id} onPointerDown={event => moveNode(event, node)}
          sx={{ position: 'absolute', left: node.x, top: node.y + 24, width: 196, minHeight: 74, p: 1.25, boxSizing: 'border-box', border: `2px solid ${node.color}`, borderRadius: 1, bgcolor: 'rgba(25, 29, 40, 0.98)', cursor: 'grab', userSelect: 'none', '&:active': { cursor: 'grabbing' } }}>
          {node.created && <Box role="button" tabIndex={0} aria-label="Connect to node" onPointerUp={event => completeConnection(event, node)} sx={{ position: 'absolute', left: -7, top: 31, width: 12, height: 12, borderRadius: '50%', bgcolor: node.color, border: '2px solid #10131b', cursor: 'crosshair' }} />}
          <Box role="button" tabIndex={0} aria-label="Start connection" onPointerDown={event => beginConnection(event, node)} sx={{ position: 'absolute', right: -7, top: 31, width: 12, height: 12, borderRadius: '50%', bgcolor: node.color, border: '2px solid #10131b', cursor: 'crosshair' }} />
          <Typography variant="body2" title={node.name} sx={{ color: node.color, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</Typography>
          <Typography variant="caption" color="text.secondary" title={node.created ? 'User-created merge node' : channelById.get(node.channelId)?.name || ''} sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.created ? 'Merge node' : `${channelName(channels[node.channelIndex])} · ${node.count} detections`}</Typography>
        </Box>)}
        {!loadingAnnotations && imageId && displayNodes.length === 0 && <Typography color="text.secondary" sx={{ p: 3 }}>This image has no labeled annotation classes.</Typography>}
        {!imageId && !loadingImages && <Typography color="text.secondary" sx={{ p: 3 }}>Choose an image to begin.</Typography>}
      </Box>
      {selectedImage && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{selectedImage.name} · {channels.length} channel{channels.length === 1 ? '' : 's'} · {displayNodes.length} node{displayNodes.length === 1 ? '' : 's'} · {connections.length} connection{connections.length === 1 ? '' : 's'}</Typography>}
    </Box>
  )
}
