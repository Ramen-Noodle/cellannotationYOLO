import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import MergePreviewModal from '../components/modals/MergePreviewModal'
import RowMenu from '../components/RowMenu'

const API_BASE_URL = 'http://10.80.24.12:5002'
// Keep the image-layer tint palette identical to the main canvas. These
// colors belong to channels; annotation/class colors are kept on boxes and
// graph nodes separately.
const CHANNEL_COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF']
const CLASS_NODE_DEFAULT_COLOR = '#cbd5e1'
const NEW_OUTPUT_CLASS = '__new_output_class__'
const NO_OUTPUT_CLASS = '__no_output_class__'

function channelName(channel) { return `C${(channel.order_index ?? 0) + 1}` }
function sourceNodeId(channel, annotation, className) {
  const settingId = annotation.detection_setting_id || annotation.id
  return `input:${channelName(channel)}:${settingId}:${className}`
}
function annotationCount(annotation, labelIndex) {
  return [...(annotation.annotations_detected || []), ...(annotation.annotations_drawn || [])]
    .filter(box => Number(box.class) === labelIndex).length
}

function annotationSublabels(annotation, labelIndex) {
  const configured = annotation.sublabel ? [annotation.sublabel] : []
  const perBox = [...(annotation.annotations_detected || []), ...(annotation.annotations_drawn || [])]
    .filter(box => Number(box.class) === labelIndex)
    .map(box => box.sublabel)
    .filter(Boolean)
  return [...new Set([...configured, ...perBox])]
}

export default function CombineAnnotationsPage({ onApplyMergedLayer }) {
  const [images, setImages] = useState([])
  const [imageSets, setImageSets] = useState([])
  const [imageId, setImageId] = useState('')
  const [channels, setChannels] = useState([])
  const [annotations, setAnnotations] = useState([])
  const [nodes, setNodes] = useState([])
  const [createdNodes, setCreatedNodes] = useState([])
  const [connections, setConnections] = useState([])
  const [connectionDrag, setConnectionDrag] = useState(null)
  const [edgeDrag, setEdgeDrag] = useState(null)
  const [mergePreview, setMergePreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [loadingImages, setLoadingImages] = useState(true)
  const [loadingAnnotations, setLoadingAnnotations] = useState(false)
  const [error, setError] = useState('')
  const [graphZoom, setGraphZoom] = useState(1)
  const [graphPan, setGraphPan] = useState({ x: 0, y: 0 })
  const [outputTable, setOutputTable] = useState(null)
  const [outputClasses, setOutputClasses] = useState([])
  const dragRef = useRef(null)
  const panRef = useRef(null)
  const graphRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${API_BASE_URL}/user-images`, { credentials: 'include' }),
      fetch(`${API_BASE_URL}/user-image-sets`, { credentials: 'include' }),
    ])
      .then(async ([imagesResponse, setsResponse]) => {
        const data = await imagesResponse.json().catch(() => ({}))
        const sets = await setsResponse.json().catch(() => [])
        if (!imagesResponse.ok) throw new Error(data.error || 'Could not load images.')
        return { data, sets: setsResponse.ok ? sets : [] }
      })
      .then(({ data, sets }) => { if (!cancelled) { setImages(data); setImageSets(sets); if (data[0]) setImageId(data[0].id) } })
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
    setEdgeDrag(null)
    setMergePreview(null)
    setOutputTable(null)
    setOutputClasses([])
    setGraphZoom(1)
    setGraphPan({ x: 0, y: 0 })
  }, [imageId])

  const channelById = useMemo(() => new Map(channels.map(channel => [channel.id, channel])), [channels])

  useEffect(() => {
    const nextNodes = []
    channels.forEach((channel, channelIndex) => {
      let classIndex = 0
      annotations.filter(annotation => annotation.channel_id === channel.id).forEach(annotation => {
        ;(annotation.labels?.labels || []).forEach((label, labelIndex) => {
          const sublabels = annotationSublabels(annotation, labelIndex)
          const settingId = annotation.detection_setting_id || annotation.id
          nextNodes.push({
            id: sourceNodeId(channel, annotation, label.name), type: 'class', role: 'input', channel: channelName(channel), channelId: channel.id,
            detectionSettingId: settingId, channelIndex, name: label.name, sublabels, count: annotationCount(annotation, labelIndex),
            color: label.color || '#cbd5e1', x: 32 + channelIndex * 250, y: 32 + classIndex * 116,
          })
          classIndex += 1
        })
      })
    })
    setNodes(nextNodes)
  }, [annotations, channels])

  const displayNodes = useMemo(() => [...nodes, ...createdNodes], [nodes, createdNodes])
  const graphWidth = Math.max(760, channels.length * 250, ...displayNodes.map(node => node.x + 230))
  const graphHeight = Math.max(560, ...displayNodes.map(node => node.y + 150))

  const moveNode = (event, node) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { id: node.id, created: node.created, start: { x: event.clientX, y: event.clientY, nodeX: node.x, nodeY: node.y } }
  }
  const dragNode = event => {
    const drag = dragRef.current
    if (!drag) return
    const nextPosition = {
      x: Math.max(8, drag.start.nodeX + (event.clientX - drag.start.x) / graphZoom),
      y: Math.max(8, drag.start.nodeY + (event.clientY - drag.start.y) / graphZoom),
    }
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
  const beginGraphPan = event => {
    const isPanButton = event.button === 1 || event.button === 2 || (event.button === 0 && event.shiftKey)
    if (!isPanButton) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    panRef.current = { startX: event.clientX, startY: event.clientY, pan: graphPan }
  }
  const dragGraphPan = event => {
    if (!panRef.current) return
    setGraphPan({
      x: panRef.current.pan.x + event.clientX - panRef.current.startX,
      y: panRef.current.pan.y + event.clientY - panRef.current.startY,
    })
  }
  const finishGraphPan = event => {
    if (panRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    panRef.current = null
  }
  const graphPoint = event => {
    const bounds = graphRef.current?.getBoundingClientRect()
    if (!bounds) return { x: event.clientX, y: event.clientY }
    return {
      x: (event.clientX - bounds.left + (graphRef.current?.scrollLeft || 0) - graphPan.x) / graphZoom,
      y: (event.clientY - bounds.top + (graphRef.current?.scrollTop || 0) - graphPan.y) / graphZoom,
    }
  }
  const handleGraphWheel = event => {
    event.preventDefault()
    event.stopPropagation()
    const bounds = graphRef.current?.getBoundingClientRect()
    if (!bounds) return
    const cursorX = event.clientX - bounds.left
    const cursorY = event.clientY - bounds.top
    const nextZoom = Math.max(0.35, Math.min(2.5, graphZoom * (event.deltaY < 0 ? 1.1 : 0.9)))
    const graphX = (cursorX - graphPan.x) / graphZoom
    const graphY = (cursorY - graphPan.y) / graphZoom
    setGraphZoom(nextZoom)
    setGraphPan({ x: cursorX - graphX * nextZoom, y: cursorY - graphY * nextZoom })
  }
  const beginConnection = (event, node) => {
    event.preventDefault()
    event.stopPropagation()
    const point = graphPoint(event)
    setConnectionDrag({ sourceId: node.id, x: point.x, y: point.y })
  }
  const dragConnection = event => {
    if (!connectionDrag && !edgeDrag) return
    const point = graphPoint(event)
    setConnectionDrag(previous => previous ? { ...previous, x: point.x, y: point.y } : previous)
    if (edgeDrag) {
      const moved = Math.hypot(point.x - edgeDrag.startX, point.y - edgeDrag.startY) > 4
      if (moved && !edgeDrag.detached) {
        setConnections(previous => previous.filter(item => item.id !== edgeDrag.connectionId))
      }
      setEdgeDrag(previous => previous ? { ...previous, x: point.x, y: point.y, detached: previous.detached || moved } : previous)
    }
  }
  const completeConnection = (event, target) => {
    if (!connectionDrag && !edgeDrag) return
    event.preventDefault()
    event.stopPropagation()
    if (edgeDrag && !edgeDrag.detached) {
      setEdgeDrag(null)
      return
    }
    const sourceId = connectionDrag?.sourceId || edgeDrag?.sourceId
    if (sourceId !== target.id && target.created) {
      const id = `${sourceId}->${target.id}`
      setConnections(previous => previous.some(connection => connection.id === id)
        ? previous
        : [...previous, { id, source: sourceId, target: target.id }])
    }
    setConnectionDrag(null)
    setEdgeDrag(null)
  }
  const beginEdgeDrag = (event, connection) => {
    event.preventDefault()
    event.stopPropagation()
    const point = graphPoint(event)
    setEdgeDrag({ connectionId: connection.id, sourceId: connection.source, x: point.x, y: point.y, startX: point.x, startY: point.y, detached: false })
  }
  const cancelConnection = () => {
    setConnectionDrag(null)
    setEdgeDrag(null)
  }
  const removeNode = nodeId => {
    setCreatedNodes(previous => previous.filter(node => node.id !== nodeId))
    setConnections(previous => previous.filter(connection => connection.source !== nodeId && connection.target !== nodeId))
  }
  const outputSources = outputNodeId => {
    const visited = new Set()
    const visit = nodeId => {
      if (visited.has(nodeId)) return []
      visited.add(nodeId)
      const node = displayNodes.find(candidate => candidate.id === nodeId)
      if (!node || node.type !== 'rule') return [nodeId]
      return connections.filter(connection => connection.target === nodeId).flatMap(connection => visit(connection.source))
    }
    return [...new Set(connections.filter(connection => connection.target === outputNodeId).flatMap(connection => visit(connection.source)))]
  }
  const outputCombinations = sourceIds => {
    const combinations = []
    for (let mask = 1; mask < (1 << sourceIds.length); mask += 1) {
      combinations.push(sourceIds.filter((_, index) => mask & (1 << index)))
    }
    return combinations
  }
  const openOutputTable = node => {
    const sourceIds = outputSources(node.id)
    const existing = node.outputMappings || []
    const existingByKey = new Map(existing.map(mapping => [mapping.sources.slice().sort().join('|'), mapping]))
    const rows = outputCombinations(sourceIds).map(sources => {
      const key = sources.slice().sort().join('|')
      const prior = existingByKey.get(key)
      const outputClass = outputClasses.find(candidate => candidate.name === prior?.label)
      return { id: key, key, sources, classId: prior?.exclude ? NO_OUTPUT_CLASS : (outputClass?.id || NEW_OUTPUT_CLASS), label: outputClass?.name || prior?.label || '', color: outputClass?.color || prior?.color || CLASS_NODE_DEFAULT_COLOR }
    })
    setOutputTable({ nodeId: node.id, sourceIds, rows })
  }
  const updateOutputTableRow = (key, field, value) => {
    setOutputTable(previous => previous ? {
      ...previous,
      rows: previous.rows.map(row => row.key === key ? { ...row, [field]: value } : row),
    } : previous)
  }
  const saveOutputTable = () => {
    if (!outputTable) return
    const classById = new Map(outputClasses.map(outputClass => [outputClass.id, outputClass]))
    const nextClasses = [...outputClasses]
    const mappings = outputTable.rows.map(({ sources, classId, label, color }) => {
      if (classId === NO_OUTPUT_CLASS) return { sources, exclude: true }
      let outputClass = classById.get(classId)
      if (!outputClass && label.trim()) {
        outputClass = nextClasses.find(candidate => candidate.name === label.trim())
        if (!outputClass) {
          outputClass = { id: `output-class:${Date.now()}:${nextClasses.length}`, name: label.trim(), color }
          nextClasses.push(outputClass)
        }
      }
      if (outputClass) {
        classById.set(outputClass.id, outputClass)
        return { sources, class_id: outputClass.id, label: outputClass.name, color: outputClass.color }
      }
      return { sources, label: label.trim(), color }
    })
    setOutputClasses(nextClasses)
    setCreatedNodes(previous => previous.map(node => node.id === outputTable.nodeId
      ? { ...node, outputMappings: mappings }
      : node))
    setOutputTable(null)
  }
  const addNode = type => {
    setCreatedNodes(previous => {
      const index = previous.length
      const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${index}`
      const row = index % 3
      const column = Math.floor(index / 3)
      return [...previous, {
        id: `${type === 'rule' ? 'rule' : 'output'}:${id}`, created: true, type, role: type === 'rule' ? 'rule' : 'output', name: type === 'rule' ? 'IoU rule' : 'New class', count: 0,
        outputMappings: type === 'class' ? [] : undefined,
        ruleType: 'iou', participation: 'any', threshold: 0.25, color: CLASS_NODE_DEFAULT_COLOR, x: 32 + channels.length * 250 + column * 230, y: 32 + row * 116,
      }]
    })
  }
  const updateNodeName = (nodeId, name) => setCreatedNodes(previous => previous.map(node => node.id === nodeId ? { ...node, name } : node))
  const updateNodeRule = (nodeId, field, value) => {
    if (field === 'ruleType' || field === 'participation') {
      setCreatedNodes(previous => previous.map(node => node.id === nodeId ? { ...node, [field]: value } : node))
      return
    }
    const numericValue = Math.max(0, Math.min(1, Number(value)))
    setCreatedNodes(previous => previous.map(node => node.id === nodeId ? { ...node, threshold: Number.isFinite(numericValue) ? numericValue : 0 } : node))
  }
  const selectedImage = images.find(image => image.id === imageId)
  const sourceDisplayName = sourceId => {
    const source = displayNodes.find(node => node.id === sourceId)
    if (!source) return sourceId
    const label = source.sublabels?.length ? `${source.name} · ${source.sublabels.join(', ')}` : source.name
    return source.channel ? `${source.channel}: ${label}` : label
  }
  const draftOutputClasses = (outputTable?.rows || [])
    .filter(row => row.classId === NEW_OUTPUT_CLASS && row.label.trim())
    .map(row => ({ id: `draft:${row.key}`, name: row.label.trim(), color: row.color }))
  const selectableOutputClasses = [...outputClasses, ...draftOutputClasses.filter(draft => !outputClasses.some(outputClass => outputClass.name === draft.name))]
  const buildRecipe = () => ({
    version: 2,
    nodes: displayNodes.map(node => node.type === 'rule'
      ? { id: node.id, type: 'rule', rule_type: node.ruleType, threshold: node.threshold, apply_to_subsets: node.participation === 'any' }
      : { id: node.id, type: 'class', role: node.role, channel: node.channel, label: node.name, color: node.color, output_mappings: node.outputMappings || [] }),
    edges: connections.map(connection => ({ source: connection.source, target: connection.target })),
  })
  const formatPreview = data => {
    const layers = (data.layers || []).map((layer, index) => ({
      ...layer,
      color: CHANNEL_COLORS[index % CHANNEL_COLORS.length],
    }))
    return {
      ...data,
      layers,
      id: `merged:${data.image_id}`,
      imageId: data.image_id,
      channelName: 'Merged annotations',
      visible: true,
    }
  }
  const previewRecipeForImage = async targetImageId => {
    const response = await fetch(`${API_BASE_URL}/combine/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ image_id: targetImageId, recipe: buildRecipe() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not preview the recipe.')
      return formatPreview(data)
  }
  const previewMergedAnnotations = async () => {
    if (!imageId) return
    setPreviewLoading(true)
    setError('')
    try {
      setMergePreview(await previewRecipeForImage(imageId))
    } catch (previewError) {
      setError(previewError.message)
    } finally {
      setPreviewLoading(false)
    }
  }
  const applyRecipe = async target => {
    if (!imageId || !onApplyMergedLayer) return
    setPreviewLoading(true)
    setError('')
    try {
      const targetIds = target.type === 'set'
        ? (imageSets.find(imageSet => imageSet.id === target.imageSetId)?.images || []).map(image => image.id)
        : [imageId]
      if (!targetIds.length) throw new Error('The selected image set has no images.')
      const results = await Promise.all(targetIds.map(previewRecipeForImage))
      results.forEach(onApplyMergedLayer)
      const currentResult = results.find(result => result.imageId === imageId)
      if (currentResult) setMergePreview(currentResult)
    } catch (applyError) {
      setError(applyError.message)
    } finally {
      setPreviewLoading(false)
    }
  }

  return (
    <Box sx={{ height: '100%', p: 3, boxSizing: 'border-box', bgcolor: 'background.default', overflow: 'auto' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5">Combine Annotations</Typography>
          <Typography color="text.secondary" variant="body2">Connect loaded classes into user-created nodes to define merge relationships.</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Box component="button" type="button" onClick={() => addNode('class')} disabled={!imageId} sx={{ px: 1.5, py: 0.75, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', color: 'text.primary', cursor: imageId ? 'pointer' : 'not-allowed' }}>Add output</Box>
          <Box component="button" type="button" onClick={() => addNode('rule')} disabled={!imageId} sx={{ px: 1.5, py: 0.75, border: 1, borderColor: CLASS_NODE_DEFAULT_COLOR, borderRadius: 1, bgcolor: 'background.paper', color: 'text.primary', cursor: imageId ? 'pointer' : 'not-allowed' }}>Add rule</Box>
          <Button variant="outlined" size="small" onClick={previewMergedAnnotations} disabled={!imageId || loadingAnnotations || previewLoading}>{previewLoading ? 'Previewing…' : 'Preview'}</Button>
        </Stack>
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
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Connect classes directly to relabel them. Connect classes to a rule node to merge with IoU or containment, then choose whether any compatible subset or all inputs are required.</Typography>
      <Box ref={graphRef} onPointerDown={beginGraphPan} onPointerMove={event => { dragGraphPan(event); dragNode(event); dragConnection(event) }} onPointerUp={event => { finishGraphPan(event); finishDrag(event); cancelConnection() }} onPointerCancel={event => { finishGraphPan(event); finishDrag(event); cancelConnection() }} onWheel={handleGraphWheel} onContextMenu={event => event.preventDefault()}
        sx={{ position: 'relative', width: '100%', height: 560, bgcolor: '#10131b', border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', cursor: panRef.current ? 'grabbing' : 'default' }}>
        <Box sx={{ position: 'absolute', zIndex: 2, top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 0.5, p: 0.5, borderRadius: 1, bgcolor: 'rgba(16, 19, 27, 0.9)', border: 1, borderColor: 'divider' }} onPointerDown={event => event.stopPropagation()}>
          <Box component="button" type="button" aria-label="Zoom out" onClick={() => setGraphZoom(previous => Math.max(0.35, previous * 0.8))} sx={{ width: 28, height: 26, border: 0, borderRadius: 0.5, bgcolor: 'action.hover', color: 'text.primary', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>−</Box>
          <Typography variant="caption" sx={{ minWidth: 42, textAlign: 'center' }}>{Math.round(graphZoom * 100)}%</Typography>
          <Box component="button" type="button" aria-label="Zoom in" onClick={() => setGraphZoom(previous => Math.min(2.5, previous * 1.25))} sx={{ width: 28, height: 26, border: 0, borderRadius: 0.5, bgcolor: 'action.hover', color: 'text.primary', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>+</Box>
          <Box component="button" type="button" aria-label="Reset graph view" onClick={() => { setGraphZoom(1); setGraphPan({ x: 0, y: 0 }) }} sx={{ height: 26, px: 0.75, border: 0, borderRadius: 0.5, bgcolor: 'action.hover', color: 'text.primary', cursor: 'pointer', fontSize: 11 }}>Reset</Box>
        </Box>
        <Box sx={{ position: 'absolute', left: graphPan.x, top: graphPan.y, width: graphWidth, height: graphHeight, transform: `scale(${graphZoom})`, transformOrigin: '0 0' }}>
        {channels.map((channel, index) => <Typography key={channel.id} variant="caption" sx={{ position: 'absolute', top: 8, left: 32 + index * 250, color: CHANNEL_COLORS[index % CHANNEL_COLORS.length], fontWeight: 700 }}>{channelName(channel)}</Typography>)}
        <svg width={graphWidth} height={graphHeight} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
          <defs><marker id="combine-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" /></marker></defs>
          {connections.map(connection => {
            const source = displayNodes.find(node => node.id === connection.source)
            const target = displayNodes.find(node => node.id === connection.target)
            if (!source || !target) return null
            const x1 = source.x + 196
            const y1 = source.y + 24 + 37
            const x2 = target.x
            const y2 = target.y + 24 + 37
            return <line key={connection.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#94a3b8" strokeWidth="2" markerEnd="url(#combine-arrow)" pointerEvents="stroke" onPointerDown={event => beginEdgeDrag(event, connection)} />
          })}
          {(connectionDrag || edgeDrag) && <line x1={(displayNodes.find(node => node.id === (connectionDrag?.sourceId || edgeDrag?.sourceId))?.x || 0) + 196} y1={(displayNodes.find(node => node.id === (connectionDrag?.sourceId || edgeDrag?.sourceId))?.y || 0) + 61} x2={(connectionDrag || edgeDrag).x} y2={(connectionDrag || edgeDrag).y} stroke="#cbd5e1" strokeWidth="2" strokeDasharray="6 4" />}
        </svg>
        {displayNodes.map(node => <Box key={node.id} onPointerDown={event => moveNode(event, node)}
          sx={{ position: 'absolute', left: node.x, top: node.y + 24, width: 196, minHeight: 74, p: 1.25, boxSizing: 'border-box', border: `2px solid ${node.color}`, borderRadius: 1, bgcolor: 'rgba(25, 29, 40, 0.98)', cursor: 'grab', userSelect: 'none', '&:active': { cursor: 'grabbing' } }}>
          {node.created && <Box role="button" tabIndex={0} aria-label="Connect to node" onPointerUp={event => completeConnection(event, node)} sx={{ position: 'absolute', left: -7, top: 31, width: 12, height: 12, borderRadius: '50%', bgcolor: node.color, border: '2px solid #10131b', cursor: 'crosshair' }} />}
          <Box role="button" tabIndex={0} aria-label="Start connection" onPointerDown={event => beginConnection(event, node)} sx={{ position: 'absolute', right: -7, top: 31, width: 12, height: 12, borderRadius: '50%', bgcolor: node.color, border: '2px solid #10131b', cursor: 'crosshair' }} />
          {node.created && <Box component="button" type="button" aria-label={`Delete ${node.name}`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); removeNode(node.id) }} sx={{ position: 'absolute', right: 5, top: 4, width: 20, height: 20, p: 0, border: 0, bgcolor: 'transparent', color: 'text.secondary', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</Box>}
          {node.created
            ? <Box component="input" aria-label={node.type === 'rule' ? 'Rule output class name' : 'Class name'} value={node.name} onChange={event => updateNodeName(node.id, event.target.value)} onPointerDown={event => event.stopPropagation()} title={node.name} sx={{ display: 'block', width: '100%', p: 0, border: 0, outline: 0, bgcolor: 'transparent', color: node.color, font: 'inherit', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} />
            : <Typography variant="body2" title={node.sublabels?.length ? `${node.name} · ${node.sublabels.join(', ')}` : node.name} sx={{ color: node.color, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.sublabels?.length ? `${node.name} · ${node.sublabels.join(', ')}` : node.name}</Typography>}
          {node.created && node.role === 'output' && <Button size="small" variant="outlined" onClick={event => { event.stopPropagation(); openOutputTable(node) }} onPointerDown={event => event.stopPropagation()} sx={{ mt: 0.75 }}>Edit table</Button>}
          {node.created && node.type === 'rule'
            ? <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                <Stack direction="row" spacing={0.75}>
                  <FormControl size="small" sx={{ width: 112 }} onPointerDown={event => event.stopPropagation()}>
                    <InputLabel id={`rule-type-${node.id}`}>Rule</InputLabel>
                    <Select labelId={`rule-type-${node.id}`} label="Rule" value={node.ruleType} onChange={event => updateNodeRule(node.id, 'ruleType', event.target.value)} sx={{ color: 'text.primary', '& .MuiSelect-select': { py: 0.7, px: 0.75, fontSize: 12 } }}>
                      <MenuItem value="iou">IoU</MenuItem>
                      <MenuItem value="containment">Containment</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField size="small" type="number" label="Threshold" value={node.threshold} inputProps={{ min: 0, max: 1, step: 0.01 }} onChange={event => updateNodeRule(node.id, 'threshold', event.target.value)} onPointerDown={event => event.stopPropagation()} sx={{ width: 82, '& input': { py: 0.7, px: 0.5, color: 'text.primary', fontSize: 12 }, '& label': { fontSize: 10 } }} />
                </Stack>
                <FormControl size="small" fullWidth onPointerDown={event => event.stopPropagation()}>
                  <InputLabel id={`rule-participation-${node.id}`}>Inputs</InputLabel>
                  <Select labelId={`rule-participation-${node.id}`} label="Inputs" value={node.participation} onChange={event => updateNodeRule(node.id, 'participation', event.target.value)} sx={{ color: 'text.primary', '& .MuiSelect-select': { py: 0.7, px: 0.75, fontSize: 11 } }}>
                    <MenuItem value="any">Any compatible subset</MenuItem>
                    <MenuItem value="all">Require all inputs</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
            : !node.created && <Typography variant="caption" title={`${channelById.get(node.channelId)?.name || ''} · setting ${node.detectionSettingId}`} sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: CHANNEL_COLORS[node.channelIndex % CHANNEL_COLORS.length] }}>{`${channelName(channels[node.channelIndex])} · ${String(node.detectionSettingId).slice(0, 8)} · ${node.count} detections`}</Typography>}
        </Box>)}
        {!loadingAnnotations && imageId && displayNodes.length === 0 && <Typography color="text.secondary" sx={{ p: 3 }}>This image has no labeled annotation classes.</Typography>}
        {!imageId && !loadingImages && <Typography color="text.secondary" sx={{ p: 3 }}>Choose an image to begin.</Typography>}
        </Box>
      </Box>
      <Dialog open={Boolean(outputTable)} onClose={() => setOutputTable(null)} fullWidth maxWidth="md">
        <DialogTitle>{displayNodes.find(node => node.id === outputTable?.nodeId)?.name || ''}</DialogTitle>
        <DialogContent dividers>
          <RowMenu
            rows={outputTable?.rows || []}
            onChange={(index, field, value) => {
              const row = outputTable?.rows[index]
              if (!row) return
              if (field === 'classId') {
                const outputClass = selectableOutputClasses.find(candidate => candidate.id === value)
                setOutputTable(previous => previous ? { ...previous, rows: previous.rows.map((item, itemIndex) => itemIndex === index
                  ? { ...item, classId: value, label: outputClass?.name || '', color: outputClass?.color || CLASS_NODE_DEFAULT_COLOR }
                  : item) } : previous)
              } else updateOutputTableRow(row.key, field, value)
            }}
            headers={['Sources', 'Output class', 'Color']}
            gridTemplateColumns="minmax(0, 1fr) minmax(220px, 0.8fr) 44px"
            renderRowTemplate={(row, rowIndex, onChange) => {
              const isNew = row.classId === NEW_OUTPUT_CLASS
              return <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.sources.map(sourceDisplayName).join(' + ')}>
                  {row.sources.map(sourceDisplayName).join(' + ')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.75, minWidth: 220 }}>
                  <Select size="small" value={row.classId} onChange={event => {
                    onChange('classId', event.target.value)
                  }} sx={{ minWidth: 140, flex: 1 }}>
                    {selectableOutputClasses.map(outputClass => <MenuItem key={outputClass.id} value={outputClass.id}>{outputClass.name}</MenuItem>)}
                    <MenuItem value={NEW_OUTPUT_CLASS}>Define new class</MenuItem>
                    <MenuItem value={NO_OUTPUT_CLASS}>No output</MenuItem>
                  </Select>
                  {isNew && <TextField size="small" placeholder="Class name" value={row.label} onChange={event => updateOutputTableRow(row.key, 'label', event.target.value)} />}
                </Box>
                <Box component="input" type="color" aria-label="Output color" value={row.color} disabled={!isNew} onChange={event => onChange('color', event.target.value)} sx={{ width: 36, height: 32, p: 0, border: 0, bgcolor: 'transparent', cursor: isNew ? 'pointer' : 'default', opacity: isNew ? 1 : 0.55 }} />
              </Stack>
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOutputTable(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveOutputTable}>Save</Button>
        </DialogActions>
      </Dialog>
      {selectedImage && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{selectedImage.name} · {channels.length} channel{channels.length === 1 ? '' : 's'} · {displayNodes.length} node{displayNodes.length === 1 ? '' : 's'} · {connections.length} connection{connections.length === 1 ? '' : 's'}</Typography>}
      <MergePreviewModal
        preview={mergePreview}
        onClose={() => setMergePreview(null)}
        onApply={applyRecipe}
        applyTargets={{ sets: imageSets }}
      />
    </Box>
  )
}
