import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, CircularProgress, FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material'
import TwoPhaseChannelGraph from '../components/TwoPhaseChannelGraph'
import TwoPhaseCombinationsTable from '../components/TwoPhaseCombinationsTable'

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
      const name = labels[classIndex]?.name || `class${classIndex}`
      const classBoxes = boxes.filter(box => Number(box.class) === classIndex)
      const variants = annotation.sublabel
        ? [annotation.sublabel]
        : classBoxes.length ? [...new Set(classBoxes.map(box => box.sublabel || ''))] : ['']
      return variants.map(sublabel => ({
        id: `input:${channelName(channel)}:${annotation.detection_setting_id || annotation.id}:${classIndex}:${encodeURIComponent(sublabel)}`,
        channelId: channel.id, name, sublabel, tableName: sublabel ? `${name}_${sublabel}` : name,
        count: classBoxes.filter(box => annotation.sublabel || (box.sublabel || '') === sublabel).length,
        color: labels[classIndex]?.color || '#cbd5e1',
      }))
    })
  })
}

export default function CombineAnnotationsTwoPhasePage() {
  const [images, setImages] = useState([])
  const [imageId, setImageId] = useState('')
  const [channels, setChannels] = useState([])
  const [annotations, setAnnotations] = useState([])
  const [activeChannelId, setActiveChannelId] = useState('')
  const [graphs, setGraphs] = useState({})
  const [loadingImages, setLoadingImages] = useState(true)
  const [loadingAnnotations, setLoadingAnnotations] = useState(false)
  const [error, setError] = useState('')

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
  const activeChannel = channels.find(channel => channel.id === activeChannelId)
  const activeClasses = classes.filter(entry => entry.channelId === activeChannelId)
  const changeGraph = updater => setGraphs(previous => {
    const current = previous[activeChannelId] || { created: [], edges: [], positions: {}, zoom: 1 }
    return { ...previous, [activeChannelId]: typeof updater === 'function' ? updater(current) : updater }
  })

  return <Box sx={{ height: '100%', overflow: 'auto', p: 3, boxSizing: 'border-box', bgcolor: 'background.default' }}>
    <Stack spacing={2} sx={{ maxWidth: 1500, mx: 'auto' }}>
      <Box><Typography variant="h5">Combine Annotations — Two Phase</Typography>
        <Typography variant="body2" color="text.secondary">Draft within-channel graphs and review every cross-channel class combination. This page keeps its changes in memory.</Typography></Box>
      {error && <Alert severity="error">{error}</Alert>}
      <FormControl size="small" sx={{ width: 320, maxWidth: '100%' }} disabled={loadingImages}>
        <InputLabel id="two-phase-image-label">Image</InputLabel>
        <Select labelId="two-phase-image-label" label="Image" value={imageId} onChange={event => setImageId(event.target.value)}>
          {images.map(image => <MenuItem key={image.id} value={image.id}>{image.name}</MenuItem>)}
        </Select>
      </FormControl>
      {(loadingImages || loadingAnnotations) && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><Typography variant="body2">Loading image classes…</Typography></Stack>}
      {!imageId && !loadingImages && <Typography color="text.secondary">Select an image to begin.</Typography>}
      {imageId && !loadingAnnotations && channels.length > 0 && <>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap role="group" aria-label="Active channel">
          <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>Channel</Typography>
          {channels.map((channel, index) => <Button key={channel.id} size="small" variant={channel.id === activeChannelId ? 'contained' : 'outlined'}
            onClick={() => setActiveChannelId(channel.id)} sx={{ color: CHANNEL_COLORS[index % CHANNEL_COLORS.length] }}>
            {channelName(channel)}{channel.name ? ` · ${channel.name}` : ''}
          </Button>)}
        </Stack>
        {activeChannel && <TwoPhaseChannelGraph key={`${imageId}:${activeChannelId}`} channel={activeChannel} classes={activeClasses}
          graph={graphs[activeChannelId]} onChange={changeGraph} />}
        <TwoPhaseCombinationsTable key={imageId} channels={channels} classes={classes} />
      </>}
      {imageId && !loadingAnnotations && !error && channels.length === 0 && <Alert severity="info">This image has no channels.</Alert>}
    </Stack>
  </Box>
}
