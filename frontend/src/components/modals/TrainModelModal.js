import { Modal, Box, Typography, IconButton, Divider, Button } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import TextField from '@mui/material/TextField'

export default function TrainModelModal({
  trainModelModalOpen,
  handleCloseTrainModelModal,
  models,
  trainModelWeightsId,
  setTrainModelWeightsId,
  imageSets,
  trainModelImageSetId,
  setTrainModelImageSetId,
  trainModelLabel,
  setTrainModelLabel,
  numPretrainImages,
  setNumPretrainImages,
  epochs,
  setEpochs,
  handleTrainModel,
}) {
  return (
    <Modal
      open={trainModelModalOpen}
      onClose={handleCloseTrainModelModal}
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 500,
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
            Train Model
          </Typography>
          <IconButton onClick={handleCloseTrainModelModal} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
    
        <Divider sx={{ mb: 2 }} />
    
        {/* Model Picker */}
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
          Model
        </Typography>
        {models.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            No models available.
          </Typography>
        ) : (
          <Box sx={{ mb: 3 }}>
            {models.map((model) => {
              const isSelected = trainModelWeightsId === model.id
              return (
                <Box
                  key={model.id}
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
                  onClick={() => setTrainModelWeightsId(model.id)}
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
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {model.name}
                  </Typography>
                </Box>
              )
            })}
          </Box>
        )}
    
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
              const isSelected = trainModelImageSetId === set.id
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
                  onClick={() => setTrainModelImageSetId(set.id)}
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
    
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
          Label
        </Typography>
        <TextField
          size="small"
          fullWidth
          value={trainModelLabel}
          onChange={(e) => setTrainModelLabel(e.target.value)}
          placeholder="finetuned"
          helperText={`Saved as "${(models.find(m => m.id === trainModelWeightsId)?.name) || '<model>'}_${trainModelLabel.trim() || 'finetuned'}". Overwrites a non-default model with the same name.`}
          sx={{ mb: 2 }}
        />
    
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
          Pretrain Images
        </Typography>
        <TextField
          size="small"
          type="number"
          fullWidth
          value={numPretrainImages}
          onChange={(e) => setNumPretrainImages(parseInt(e.target.value, 10) || 0)}
          helperText="Number of curated pretrain images to include from this model's pretrain set."
          sx={{ mb: 2 }}
        />
    
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
          Epochs
        </Typography>
        <TextField
          size="small"
          type="number"
          fullWidth
          value={epochs}
          onChange={(e) => setEpochs(parseInt(e.target.value, 10) || '')}
          sx={{ mb: 2 }}
        />
    
        <Divider sx={{ mb: 2 }} />
    
        {/* Footer */}
        <Box display="flex" justifyContent="flex-end" gap={1.5}>
          <Button variant="outlined" onClick={handleCloseTrainModelModal}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!trainModelWeightsId || !trainModelImageSetId}
            onClick={handleTrainModel}
          >
            Train
          </Button>
        </Box>
      </Box>
    </Modal>
  )
}
