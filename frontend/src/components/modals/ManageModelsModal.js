import { Modal, Box, Typography, IconButton, Divider, Button } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import Tooltip from '@mui/material/Tooltip'
import DeleteIcon from '@mui/icons-material/Delete'

export default function ManageModelsModal({
  manageModelsModalOpen,
  handleCloseManageModelsModal,
  models,
  DEFAULT_MODEL_NAMES,
  handleDeleteModel,
}) {
  return (
    <Modal
      open={manageModelsModalOpen}
      onClose={handleCloseManageModelsModal}
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 450,
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
            Manage Models
          </Typography>
          <IconButton onClick={handleCloseManageModelsModal} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
    
        <Divider sx={{ mb: 2 }} />
    
        {models.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            No models available.
          </Typography>
        ) : (
          <Box sx={{ mb: 2 }}>
            {models.map((model) => {
              const isDefault = DEFAULT_MODEL_NAMES.includes(model.name)
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
                    borderColor: 'divider',
                  }}
                >
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                      {model.name}
                    </Typography>
                    {isDefault && (
                      <Typography variant="caption" color="text.secondary">
                        Default model
                      </Typography>
                    )}
                  </Box>
                  <Tooltip title={isDefault ? "Default models can't be deleted" : "Delete model"} arrow>
                    <span>
                      <IconButton
                        size="small"
                        color="error"
                        disabled={isDefault}
                        onClick={() => handleDeleteModel(model)}
                        sx={{ flexShrink: 0 }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              )
            })}
          </Box>
        )}
    
        <Divider sx={{ mb: 2 }} />
    
        {/* Footer */}
        <Box display="flex" justifyContent="flex-end">
          <Button variant="outlined" onClick={handleCloseManageModelsModal}>
            Close
          </Button>
        </Box>
      </Box>
    </Modal>
  )
}
