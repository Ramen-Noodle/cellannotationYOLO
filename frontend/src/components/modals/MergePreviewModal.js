import { useEffect, useState } from 'react'
import { Box, Button, IconButton, Modal, Stack, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ImageCanvas from '../ImageCanvas'

export default function MergePreviewModal({ preview, onClose, onMerge, brightness, contrast, showLabels }) {
  const [container, setContainer] = useState(null)
  const [viewport, setViewport] = useState({ width: 1, height: 1 })
  const [zoom, setZoom] = useState(1)
  const [viewKey, setViewKey] = useState(0)
  useEffect(() => {
    if (!preview || !container) return
    setZoom(1)
    const measure = () => setViewport({ width: Math.max(1, container.clientWidth), height: Math.max(1, container.clientHeight) })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [preview, container])
  const validSize = preview?.imageSize.width > 0 && preview?.imageSize.height > 0
  const fitScale = validSize ? Math.min(viewport.width / preview.imageSize.width, viewport.height / preview.imageSize.height) * 0.95 : 1
  const centeredOffset = validSize ? {
    x: (viewport.width - preview.imageSize.width * fitScale) / 2,
    y: (viewport.height - preview.imageSize.height * fitScale) / 2,
  } : { x: 0, y: 0 }
  return <Modal open={!!preview} onClose={onClose} aria-labelledby="merge-preview-title"
    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
    <Box sx={{ width: '94vw', height: '90vh', bgcolor: 'background.paper', borderRadius: 2, p: 2, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
        <Typography id="merge-preview-title" variant="h6" sx={{ flexGrow: 1 }}>Merged annotations preview</Typography>
        <Typography variant="body2">{preview?.boxes.length ?? 0} cells</Typography>
        <Button onClick={() => { setZoom(1); setViewKey(k => k + 1) }}>Fit image</Button>
        <IconButton aria-label="Close merge preview" onClick={onClose}><CloseIcon /></IconButton>
      </Stack>
      <Box ref={setContainer} onContextMenu={event => { event.preventDefault(); event.stopPropagation() }} sx={{ flex: 1, minHeight: 0, overflow: 'hidden', bgcolor: '#000' }}>
        {preview && validSize && viewport.width > 1 && viewport.height > 1 && <ImageCanvas key={`${preview.imageId}-${viewKey}`} readOnly
          layers={preview.layers} boxes={preview.boxes} imageSize={preview.imageSize} viewportSize={viewport} initialOffset={centeredOffset}
          scale={fitScale * zoom} onScaleChange={value => setZoom(value / fitScale)}
          brightness={brightness} contrast={contrast} showLabels={showLabels} classes={[]} />}
        {preview && !validSize && <Typography color="error">Image dimensions are unavailable. Reopen the image before previewing.</Typography>}
      </Box>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1 }}>
        <Typography variant="body2" sx={{ flexGrow: 1 }}>All source channels combined. Scroll to zoom; right-drag to pan.</Typography>
        <Button onClick={onClose}>Back to rules</Button>
        <Button variant="contained" onClick={() => onMerge(preview)}>Merge</Button>
      </Stack>
    </Box>
  </Modal>
}
