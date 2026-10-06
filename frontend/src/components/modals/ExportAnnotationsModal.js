import { Modal, Box, Typography, IconButton, Divider, FormControl, RadioGroup, FormControlLabel, Radio, InputLabel, Select, Checkbox, Button } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import Stack from '@mui/material/Stack'
import MenuItem from '@mui/material/MenuItem'
import FileDownloadIcon from '@mui/icons-material/FileDownload'

export default function ExportAnnotationsModal({
  exportModalOpen,
  setExportModalOpen,
  exportImageSetId,
  setExportImageId,
  setExportImageSetId,
  imageID,
  imageSets,
  exportImageId,
  imageList,
  annotationsOnly,
  setAnnotationsOnly,
  exportLabelFormat,
  setExportLabelFormat,
  exportIncludeConfidence,
  setExportIncludeConfidence,
  exportAnnotations,
}) {
  return (
    <Modal
      open={exportModalOpen}
      onClose={() => setExportModalOpen(false)}
      aria-labelledby="export-modal-title"
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 400,
          bgcolor: 'background.paper',
          borderRadius: 2,
          boxShadow: 24,
          p: 3,
          outline: 'none'
        }}
      >
        <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography id="export-modal-title" variant="h6" sx={{ fontWeight: 'bold' }}>
            Export Options
          </Typography>
          <IconButton onClick={() => setExportModalOpen(false)} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
    
        <Divider sx={{ mb: 2 }} />
    
        <Stack spacing={2.5}>
          {/* Export target: exactly one of an image or an image set */}
          <FormControl>
            <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>
              Export
            </Typography>
            <RadioGroup
              row
              value={exportImageSetId !== null ? 'imageSet' : 'image'}
              onChange={(e) => {
                if (e.target.value === 'imageSet') {
                  setExportImageId(null)
                  setExportImageSetId('')
                } else {
                  setExportImageSetId(null)
                  setExportImageId(imageID)
                }
              }}
            >
              <FormControlLabel value="image" control={<Radio size="small" />} label="Image" />
              <FormControlLabel value="imageSet" control={<Radio size="small" />} label="Image Set" />
            </RadioGroup>
          </FormControl>
    
          {exportImageSetId !== null ? (
            <FormControl fullWidth size="small">
              <InputLabel id="export-image-set-label">Image Set</InputLabel>
              <Select
                labelId="export-image-set-label"
                label="Image Set"
                value={exportImageSetId}
                displayEmpty
                onChange={(e) => setExportImageSetId(e.target.value)}
              >
                {imageSets.length === 0 ? (
                  <MenuItem value="" disabled>No image sets available</MenuItem>
                ) : (
                  imageSets.map((set) => (
                    <MenuItem key={set.id} value={set.id}>{set.name}</MenuItem>
                  ))
                )}
              </Select>
            </FormControl>
          ) : (
            <FormControl fullWidth size="small">
              <InputLabel id="export-image-label">Image</InputLabel>
              <Select
                labelId="export-image-label"
                label="Image"
                value={exportImageId}
                displayEmpty
                onChange={(e) => setExportImageId(e.target.value)}
              >
                {imageList.length === 0 ? (
                  <MenuItem value="" disabled>No images available</MenuItem>
                ) : (
                  imageList.map((img) => (
                    <MenuItem key={img.id} value={img.id}>{img.name}</MenuItem>
                  ))
                )}
              </Select>
            </FormControl>
          )}
    
          <Divider />
    
          <FormControlLabel
            control={
              <Checkbox
                checked={annotationsOnly}
                onChange={(e) => setAnnotationsOnly(e.target.checked)}
              />
            }
            label={
              <Box>
                <Typography variant="body1" sx={{ fontWeight: 500 }}>Export annotations only</Typography>
                <Typography variant="caption" color="text.secondary">
                  Leaves behind the base normalized image file stream
                </Typography>
              </Box>
            }
          />
    
          <Divider />
    
          {/* Label format: class name (merged per image) vs class number (split per detection setting) */}
          <FormControl>
            <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>
              Label format
            </Typography>
            <RadioGroup
              row
              value={exportLabelFormat}
              onChange={(e) => setExportLabelFormat(e.target.value)}
            >
              <FormControlLabel value="name" control={<Radio size="small" />} label="Class name" />
              <FormControlLabel value="number" control={<Radio size="small" />} label="Class number" />
            </RadioGroup>
            <Typography variant="caption" color="text.secondary">
              {exportLabelFormat === 'name'
                ? 'One merged file per image, labeled by class name'
                : 'One file per detection setting, labeled by raw class index'}
            </Typography>
          </FormControl>
    
          <FormControlLabel
            control={
              <Checkbox
                checked={exportIncludeConfidence}
                onChange={(e) => setExportIncludeConfidence(e.target.checked)}
              />
            }
            label={
              <Box>
                <Typography variant="body1" sx={{ fontWeight: 500 }}>Include confidence</Typography>
                <Typography variant="caption" color="text.secondary">
                  Appends a confidence score to each line (null if unavailable)
                </Typography>
              </Box>
            }
          />
    
          {/* Action Buttons */}
          <Box display="flex" gap={1.5} justifyContent="flex-end" sx={{ mt: 1 }}>
            <Button 
              variant="outlined" 
              onClick={() => setExportModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              startIcon={<FileDownloadIcon />}
              disabled={exportImageSetId !== null ? !exportImageSetId : !exportImageId}
              onClick={() => {
                exportAnnotations()
                setExportModalOpen(false)
              }}
            >
              Download Package
            </Button>
          </Box>
        </Stack>
      </Box>
    </Modal>
  )
}
