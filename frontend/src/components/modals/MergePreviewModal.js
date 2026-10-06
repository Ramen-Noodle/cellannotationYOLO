import { useEffect, useRef, useState } from 'react'
import { Box, Button, IconButton, Modal, Stack, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ImageCanvas from '../ImageCanvas'

export default function MergePreviewModal({ preview, onClose, onMerge, brightness, contrast, showLabels }) {
  const container = useRef(null)
  const [viewport, setViewport] = useState({ width: 1, height: 1 })
  const [zoom, setZoom] = useState(1)
  const [viewKey, setViewKey] = useState(0)
  useEffect(() => {
    if (!preview || !container.current) return
    setZoom(1)
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: Math.max(1, Math.floor(entry.contentRect.width)), height: Math.max(1, Math.floor(entry.contentRect.height)) })
    })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [preview])
  const fitScale = preview ? Math.min(viewport.width / preview.imageSize.width, viewport.height / preview.imageSize.height) : 1
  return <Modal open={!!preview} onClose={onClose} aria-labelledby="merge-preview-title"
    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
    <Box sx={{ width: '94vw', height: '90vh', bgcolor: 'background.paper', borderRadius: 2, p: 2, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
        <Typography id="merge-preview-title" variant="h6" sx={{ flexGrow: 1 }}>Merged annotations preview</Typography>
        <Typography variant="body2">{preview?.boxes.length ?? 0} cells</Typography>
        <Button onClick={() => { setZoom(1); setViewKey(k => k + 1) }}>Fit image</Button>
        <IconButton aria-label="Close merge preview" onClick={onClose}><CloseIcon /></IconButton>
      </Stack>
      <Box ref={container} sx={{ flex: 1, minHeight: 0, overflow: 'hidden', bgcolor: '#000' }}>
        {preview && viewport.width > 1 && <ImageCanvas key={`${preview.imageId}-${viewKey}`} readOnly
          layers={preview.layers} boxes={preview.boxes} imageSize={preview.imageSize} viewportSize={viewport}
          scale={fitScale * zoom} onScaleChange={value => setZoom(value / fitScale)}
          brightness={brightness} contrast={contrast} showLabels={showLabels} classes={[]} />}
      </Box>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1 }}>
        <Typography variant="body2" sx={{ flexGrow: 1 }}>All source channels combined. Scroll to zoom; right-drag to pan.</Typography>
        <Button onClick={onClose}>Back to rules</Button>
        <Button variant="contained" onClick={() => onMerge(preview)}>Merge</Button>
      </Stack>
    </Box>
  </Modal>
}
