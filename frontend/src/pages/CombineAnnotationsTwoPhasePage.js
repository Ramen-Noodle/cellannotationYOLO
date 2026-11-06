import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, CircularProgress, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import TwoPhaseChannelGraph from '../components/TwoPhaseChannelGraph'
import TwoPhaseCombinationsTable from '../components/TwoPhaseCombinationsTable'
import MergePreviewModal from '../components/modals/MergePreviewModal'
import TwoPhaseRecipeControls from '../components/TwoPhaseRecipeControls'
import { buildTwoPhaseRecipe, restoreTwoPhaseRecipe } from '../utils/twoPhaseRecipe.mjs'
import { terminalChannelClasses } from '../utils/twoPhaseCombinations.mjs'

const API_BASE_URL = 'http://10.80.24.12:5002'
const CHANNEL_COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF']
const channelName = channel => `C${(channel.order_index ?? 0) + 1}`

function imageClasses(channels, annotations) {
  const channelById = new Map(channels.map(channel => [channel.id, channel]))
  return annotations.flatMap(annotation => {
    const channel = channelById.get(annotation.channel_id)
    if (!channel) return []
    const boxes = [...(annotation.annotations_detected || []), ...(annotation.annotations_drawn || [])]
    const labels = annotation.labels?.labels || []
    const classIndices = [...new Set([...labels.map((_, index) => index), ...boxes.map(box => Number(box.class))])]
      .filter(Number.isInteger).sort((a, b) => a - b)
    return classIndices.flatMap(classIndex => {
      const name = labels[classIndex]?.name || `Class ${classIndex}`
      const classBoxes = boxes.filter(box => Number(box.class) === classIndex)
      const variants = annotation.sublabel
        ? [annotation.sublabel]
        : classBoxes.length ? [...new Set(classBoxes.map(box => box.sublabel || ''))] : ['']
      return variants.map(sublabel => {
        const sourceBoxes = classBoxes.filter(box => annotation.sublabel || (box.sublabel || '') === sublabel)
        return {
          id: `input:${channelName(channel)}:${annotation.detection_setting_id || annotation.id}:${classIndex}:${encodeURIComponent(sublabel)}`,
          channelId: channel.id, settingId: annotation.detection_setting_id || annotation.id, name, sublabel, count: sourceBoxes.length, boxes: sourceBoxes,
          color: labels[classIndex]?.color || '#cbd5e1',
        }
      })
    })
  })
}

export default function CombineAnnotationsTwoPhasePage({ onApplyMergedLayer }) {
  const [images, setImages] = useState([])
  const [imageId, setImageId] = useState('')
  const [channels, setChannels] = useState([])
  const [annotations, setAnnotations] = useState([])
  const [activeChannelId, setActiveChannelId] = useState('')
  const [graphs, setGraphs] = useState({})
  const [loadingImages, setLoadingImages] = useState(true)
  const [loadingAnnotations, setLoadingAnnotations] = useState(false)
  const [error, setError] = useState('')
  const [previewRun, setPreviewRun] = useState(null)
  const [completedRun, setCompletedRun] = useState(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [crossThresholds, setCrossThresholds] = useState({ iou: 0.30, containment: 0.60 })

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE_URL}/user-images`, { credentials: 'include' }).then(async response => {
      const data = await response.json().catch(() => [])
      if (!response.ok) throw new Error(data.error || 'Could not load images.')
      if (!cancelled) setImages(data)
    }).catch(loadError => { if (!cancelled) setError(loadError.message) })
      .finally(() => { if (!cancelled) setLoadingImages(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!imageId) return
    let cancelled = false
    setChannels([]); setAnnotations([]); setActiveChannelId(''); setGraphs({}); setError(''); setLoadingAnnotations(true)
    setPreviewRun(null); setCompletedRun(null); setPreviewOpen(false)
    setCrossThresholds({ iou: 0.30, containment: 0.60 })
    Promise.all([
      fetch(`${API_BASE_URL}/load-channels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ image_id: imageId }) }),
      fetch(`${API_BASE_URL}/load-annotations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ image_id: imageId }) }),
    ]).then(async ([channelResponse, annotationResponse]) => {
      const loadedChannels = await channelResponse.json().catch(() => [])
      const loadedAnnotations = await annotationResponse.json().catch(() => ({}))
      if (!channelResponse.ok || !annotationResponse.ok) throw new Error(loadedChannels.error || loadedAnnotations.error || 'Could not load image classes.')
      if (cancelled) return
      const orderedChannels = [...loadedChannels].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
      setChannels(orderedChannels)
      setAnnotations(loadedAnnotations.annotations || [])
      setActiveChannelId(orderedChannels[0]?.id || '')
    }).catch(loadError => { if (!cancelled) setError(loadError.message) })
      .finally(() => { if (!cancelled) setLoadingAnnotations(false) })
    return () => { cancelled = true }
  }, [imageId])

  const classes = useMemo(() => imageClasses(channels, annotations), [channels, annotations])
  const outputs = useMemo(() => terminalChannelClasses(channels, classes, graphs), [channels, classes, graphs])
  const activeRun = previewRun && previewRun.imageId === imageId && previewRun.classes === classes && previewRun.crossThresholds === crossThresholds && channels.every(({ id }) =>
    graphs[id]?.created === previewRun.graphs[id]?.created && graphs[id]?.edges === previewRun.graphs[id]?.edges) ? previewRun : null
  const completed = activeRun && completedRun?.run === activeRun ? completedRun : null
  const preview = completed?.result
  const previewing = Boolean(activeRun && !completed)

  useEffect(() => {
    if (!activeRun) return undefined
    const controller = new AbortController()
    fetch(`${API_BASE_URL}/combine/preview`, {
      method: 'POST', credentials: 'include', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_id: activeRun.imageId, recipe: activeRun.recipe }),
    }).then(async response => {
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not preview the merge.')
      if (!controller.signal.aborted) setCompletedRun({ result, run: activeRun })
    }).catch(error => {
      if (!controller.signal.aborted) setCompletedRun({ error: error.message, run: activeRun })
    })
    return () => controller.abort()
  }, [activeRun])

  const selectedImage = images.find(image => image.id === imageId)
  const previewImage = useMemo(() => {
    if (!preview) return null
    const [width, height] = selectedImage?.dimensions || []
    return {
      imageId, imageSize: { width, height }, boxes: preview.boxes,
      layers: channels.flatMap((channel, index) => channel.url ? [{
        id: channel.id, src: new URL(channel.url, API_BASE_URL).href, color: CHANNEL_COLORS[index % CHANNEL_COLORS.length],
      }] : []),
    }
  }, [preview, selectedImage, imageId, channels])
  const openPreview = () => {
    setError('')
    try {
      if (!preview) {
        const recipe = buildTwoPhaseRecipe(channels, classes, graphs, crossThresholds)
        setPreviewRun({ imageId, channels, classes, graphs, crossThresholds, recipe })
      }
      setPreviewOpen(true)
    } catch (error) { setError(error.message) }
  }
  const loadRecipe = recipe => {
    const restored = restoreTwoPhaseRecipe(recipe, channels, classes)
    setGraphs(restored)
    setCrossThresholds({ iou: recipe.cross_iou, containment: recipe.cross_containment })
    setPreviewRun(null)
    setCompletedRun(null)
  }
  const applied = result => {
    onApplyMergedLayer?.({ ...result, imageId: result.image_id, id: `merged:${result.image_id}`,
      channelName: 'Merged annotations', visible: true })
  }
  const activeChannel = channels.find(channel => channel.id === activeChannelId)
  const activeClasses = classes.filter(entry => entry.channelId === activeChannelId)
  const changeGraph = updater => setGraphs(previous => {
    const current = previous[activeChannelId] || { created: [], edges: [], positions: {}, zoom: 1 }
    return { ...previous, [activeChannelId]: typeof updater === 'function' ? updater(current) : updater }
  })

  return <Box sx={{ height: '100%', overflow: 'auto', p: 3, boxSizing: 'border-box', bgcolor: 'background.default' }}>
    <Stack spacing={2} sx={{ maxWidth: 1500, mx: 'auto' }}>
      <Box><Typography variant="h5">Combine Annotations — Two Phase</Typography>
        <Typography variant="body2" color="text.secondary">Merge classes within each channel and review the cross-channel combinations. Unconnected classes pass through to Phase 2. Preview the results, save a recipe, or apply the merge to this image.</Typography></Box>
      {error && <Alert severity="error">{error}</Alert>}
      <FormControl size="small" sx={{ width: 320, maxWidth: '100%' }} disabled={loadingImages || saving}>
        <InputLabel id="two-phase-image-label">Image</InputLabel>
        <Select labelId="two-phase-image-label" label="Image" value={imageId} onChange={event => setImageId(event.target.value)}>
          {images.map(image => <MenuItem key={image.id} value={image.id}>{image.name}</MenuItem>)}
        </Select>
      </FormControl>
      {(loadingImages || loadingAnnotations) && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><Typography variant="body2">Loading image classes…</Typography></Stack>}
      {!imageId && !loadingImages && <Typography color="text.secondary">Select an image to begin.</Typography>}
      {imageId && !loadingAnnotations && channels.length > 0 && <>
        <TwoPhaseRecipeControls key={imageId} apiUrl={API_BASE_URL} imageId={imageId} recipe={preview?.recipe}
          onLoad={loadRecipe} onApplied={applied} onBusy={setSaving} />
        <Box component="fieldset" disabled={saving} sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap role="group" aria-label="Active channel">
          <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>Channel</Typography>
          {channels.map((channel, index) => <Button key={channel.id} size="small" variant={channel.id === activeChannelId ? 'contained' : 'outlined'}
            onClick={() => setActiveChannelId(channel.id)} sx={{ color: CHANNEL_COLORS[index % CHANNEL_COLORS.length] }}>
            {channelName(channel)}{channel.name ? ` · ${channel.name}` : ''}
          </Button>)}
        </Stack>
        {activeChannel && <TwoPhaseChannelGraph key={`${imageId}:${activeChannelId}`} channel={activeChannel} classes={activeClasses}
          graph={graphs[activeChannelId]} onChange={changeGraph} />}
        <Stack direction="row" spacing={2} alignItems="center">
          <Button variant="contained" disabled={!outputs.length || previewing} onClick={openPreview}>
            {previewing ? 'Running preview…' : preview ? 'View merge preview' : 'Preview merge'}
          </Button>
          {previewing && <CircularProgress size={18} />}
          {['iou', 'containment'].map(metric => <TextField key={metric} type="number" size="small"
            label={metric === 'iou' ? 'Cross-channel IoU >' : 'Cross-channel containment >'}
            value={crossThresholds[metric]} inputProps={{ min: 0, max: 1, step: 0.05 }}
            onChange={event => setCrossThresholds(previous => ({ ...previous, [metric]: event.target.value }))} />)}
        </Stack>
        </Box>
        {completed?.error && <Alert severity="error">{completed.error}</Alert>}
        {preview && <>
          <Alert severity={preview.boxes.length ? 'info' : 'warning'}>
            Phase 1 routed {preview.routedCount.toLocaleString()} of {preview.sourceCount.toLocaleString()} usable detections to outputs and produced {preview.channelOutputCount.toLocaleString()} boxes.
            {' '}Phase 2 produced {preview.boxes.length.toLocaleString()} boxes in {preview.combinations.length.toLocaleString()} observed combinations.
            {preview.invalidCount > 0 && ` Skipped ${preview.invalidCount.toLocaleString()} detections with invalid box coordinates.`}
          </Alert>
        </>}
        <TwoPhaseCombinationsTable key={imageId} channels={channels} outputs={outputs} preview={preview} />
      </>}
      {imageId && !loadingAnnotations && !error && channels.length === 0 && <Alert severity="info">This image has no channels.</Alert>}
      <MergePreviewModal preview={previewOpen ? previewImage : null} onClose={() => setPreviewOpen(false)} />
    </Stack>
  </Box>
}
