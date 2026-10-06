import React from 'react'
import { 
  Dialog, 
  DialogContent, 
  Box, 
  ImageList, 
  ImageListItem, 
  DialogTitle,
  IconButton
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'

const GalleryMenu = ({ open, handleClose, images, onImageClick, renderActions, title, renderHeaderActions }) => {
  return (
    <Dialog 
      open={open} 
      onClose={handleClose} 
      fullWidth 
      maxWidth="md"
    >
      <DialogTitle sx={{ m: 0, p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box display="flex" alignItems="center" gap={2}>
          {title || "Select an Image"}
          {/* Inject extra header buttons here (like Add Images) */}
          {renderHeaderActions && renderHeaderActions()}
        </Box>
        <IconButton onClick={handleClose}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <ImageList cols={3} gap={12}>
          {images.map((img, index) => (
            <Box 
              key={img.id || index}
              sx={{ 
                position: 'relative',
                borderRadius: '4px',
                overflow: 'hidden',
                '&:hover .image-actions': {
                  opacity: 1,
                  visibility: 'visible'
                }
              }}
            >
              <ImageListItem 
                onClick={() => onImageClick(img)}
                sx={{ cursor: 'pointer', '&:hover': { opacity: 0.9 } }}
              >
                <img
                  src={img.url}
                  alt={img.name || `image-${index}`}
                  loading="lazy"
                  style={{ display: 'block', width: '100%', height: 'auto' }}
                />
              </ImageListItem>

              {/* Absolute Overlay Container for Actions */}
              {renderActions && (
                <Box
                  className="image-actions"
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    display: 'flex',
                    gap: 0.5,
                    opacity: 0,
                    visibility: 'hidden',
                    transition: 'all 0.2s ease-in-out',
                    zIndex: 2,
                    backgroundColor: 'rgba(0, 0, 0, 0.4)',
                    borderRadius: '20px',
                    p: 0.5
                  }}
                >
                  {renderActions(img)}
                </Box>
              )}
            </Box>
          ))}
        </ImageList>
      </DialogContent>
    </Dialog>
  )
}

export default GalleryMenu