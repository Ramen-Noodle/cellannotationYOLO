import { Modal, Box, Typography, IconButton, Divider, Button } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import BatchDetectionRows, { batchRowError } from '../BatchDetectionRows'

export default function BatchDetectionModal({
  batchDetectModalOpen,
  setBatchDetectModalOpen,
  imageSets,
  batchImageSetId,
  handleSelectBatchImageSet,
  batchLoadError,
  batchDetectionSettingsLoading,
  batchChannelGroups,
  batchDetectionSettings,
  models,
  batchSelectedRowIds,
  setBatchSelectedRowIds,
  updateBatchRow,
  addBatchRow,
  removeBatchRow,
  handleBatchDetect,
}) {
  return (
    <Modal
      open={batchDetectModalOpen}
      onClose={() => setBatchDetectModalOpen(false)}
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 760,
          bgcolor: 'background.paper',
          borderRadius: 2,
          boxShadow: 24,
          p: 3,
          outline: 'none',
          maxHeight: '85vh',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
            Batch Detection
          </Typography>
          <IconButton onClick={() => setBatchDetectModalOpen(false)} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
    
        <Divider sx={{ mb: 2 }} />
    
        {/* Image Set Picker */}
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
          Image Set
        </Typography>
        {imageSets.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            No image sets available. Create one from the image sets menu.
          </Typography>
        ) : (
          <Box sx={{ mb: 3 }}>
            {imageSets.map((set) => {
              const isSelected = batchImageSetId === set.id
              return (
                <Box
                  key={set.id}
                  display="flex"
                  alignItems="center"
                  sx={{
                    px: 1.5,
                    py: 1,
                    mb: 0.5,
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: isSelected ? 'primary.main' : 'divider',
                    bgcolor: isSelected ? 'primary.50' : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={() => handleSelectBatchImageSet(set.id)}
                >
                  <Box
                    sx={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      border: '2px solid',
                      borderColor: isSelected ? 'primary.main' : 'text.disabled',
                      bgcolor: isSelected ? 'primary.main' : 'transparent',
                      mr: 1.5,
                      flexShrink: 0,
                      transition: 'all 0.15s ease',
                    }}
                  />
                  <Box sx={{ flexGrow: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {set.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {set.image_count} image{set.image_count !== 1 ? 's' : ''}
                    </Typography>
                  </Box>
                </Box>
              )
            })}
          </Box>
        )}
    
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>Detection by channel</Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
          Channels match by position (C1 to C1, C2 to C2). Missing channels are skipped.
          Rows stay in this dialog until Run Batch. Changing the image set resets these drafts.
          Removed or unchecked rules are deleted from the image set when the batch succeeds.
        </Typography>
        {batchLoadError && <Typography role="alert" color="error">{batchLoadError}</Typography>}
        {batchDetectionSettingsLoading ? <Typography>Loading channels and settings...</Typography> :
          !batchImageSetId ? <Typography>Select an image set to configure detection.</Typography> :
          <BatchDetectionRows groups={batchChannelGroups} rows={batchDetectionSettings} models={models}
            selectedIds={batchSelectedRowIds}
            onToggle={id => setBatchSelectedRowIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id])}
            onChange={updateBatchRow} onAdd={addBatchRow} onRemove={removeBatchRow} />}
        {batchImageSetId && !batchDetectionSettingsLoading && !batchLoadError && !batchChannelGroups.length &&
          <Typography>This image set has no channels to detect.</Typography>}
    
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Running batch detection replaces all saved annotations for each successfully processed image.
          Only the checked rules remain. Unchecked rules, removed rules, and manually drawn annotations are deleted,
          including those on channels with no checked rules. Failed images keep their previous annotations.
        </Typography>
    
        <Divider sx={{ mb: 2 }} />
    
        {/* Footer */}
        <Box display="flex" justifyContent="flex-end" gap={1.5}>
          <Button variant="outlined" onClick={() => setBatchDetectModalOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={batchDetectionSettingsLoading || !batchImageSetId || batchSelectedRowIds.length === 0 || batchDetectionSettings.some(r => batchSelectedRowIds.includes(r.id) && (!Number.isInteger(r.channelOrder) || batchRowError(r, models)))}
            onClick={handleBatchDetect}
          >
            Run Batch ({batchSelectedRowIds.length} row{batchSelectedRowIds.length !== 1 ? 's' : ''})
          </Button>
        </Box>
      </Box>
    </Modal>
  )
}
