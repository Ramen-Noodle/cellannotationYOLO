import { Modal, Box, Typography, IconButton, Divider, Button } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import RowMenu from '../RowMenu'
import GalleryMenu from './GalleryMenu'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'

export default function ImageSetsModal({
  imageSetsMenuOpen,
  setImageSetsMenuOpen,
  imageSets,
  handleCreateImageSet,
  handleDeleteImageSet,
  handleSelectImageSet,
  setViewMenuOpen,
  setSetViewMenuOpen,
  activeImageSet,
  handleLoadImage,
  setAddImagesSelectionOpen,
  handleRemoveImageFromSet,
  addImagesSelectionOpen,
  imageList,
  handleAddImageToSet,
}) {
  return (
    <Modal
      open={imageSetsMenuOpen}
      onClose={() => setImageSetsMenuOpen(false)}
      aria-labelledby="image-sets-modal-title"
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          maxWidth: 550,
          bgcolor: 'background.paper',
          borderRadius: 2,
          boxShadow: 24,
          p: 3,
          outline: 'none',
          maxHeight: '85vh',
          overflowY: 'auto'
        }}
      >
        {/* Modal Header */}
        <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography id="image-sets-modal-title" variant="h6" sx={{ fontWeight: 'bold' }}>
            Manage Image Sets
          </Typography>
          <IconButton onClick={() => setImageSetsMenuOpen(false)} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
    
        <Divider sx={{ mb: 2 }} />
    
        {/* Content Window containing RowMenu */}
        <RowMenu 
          rows={imageSets}
          headers={["Set Name", "Total Images"]}
          gridTemplateColumns="3fr 1fr"
          onAdd={handleCreateImageSet}
          onDelete={handleDeleteImageSet}
          onChange={() => {}}
          onSelect={handleSelectImageSet}
          renderRowTemplate={(row) => (
            <Box display="grid" gridTemplateColumns="3fr 1fr" gap={2} alignItems="center">
              <Typography variant="body1" sx={{ fontWeight: 500, minWidth: 0, noWrap: true }}>
                {row.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {row.image_count} items
              </Typography>
            </Box>
          )}
        />
        
        <GalleryMenu 
          open={setViewMenuOpen}
          handleClose={() => setSetViewMenuOpen(false)}
          title={activeImageSet ? `Image Set: ${activeImageSet.name}` : 'Image Set Gallery'}
          images={activeImageSet?.images || []}
          onImageClick={handleLoadImage}
          
          renderHeaderActions={() => (
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setAddImagesSelectionOpen(true)}
            >
              Add Images
            </Button>
          )}
    
          renderActions={(img) => (
            <IconButton 
              size="small" 
              sx={{ color: '#F87171', '&:hover': { color: '#EF4444' } }}
              onClick={(e) => {
                e.stopPropagation() 
                handleRemoveImageFromSet(img.id)
              }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
        />
        
        <GalleryMenu
          open={addImagesSelectionOpen}
          handleClose={() => setAddImagesSelectionOpen(false)}
          title="Select Images to Add to Set"
          images={imageList}
          onImageClick={(img) => {
            handleAddImageToSet(img)
          }}
        
          renderActions={(img) => {
            const currentImages = activeImageSet?.images || []
            const isAlreadyInSet = currentImages.some(item => item.id === img.id)
            
            return isAlreadyInSet ? (
              <Typography variant="caption" sx={{ color: '#4ADE80', px: 1, fontWeight: 'bold' }}>
                Added
              </Typography>
            ) : (
              <IconButton 
                size="small" 
                sx={{ color: '#60A5FA', '&:hover': { color: '#3B82F6' } }}
                onClick={(e) => {
                  e.stopPropagation()
                  handleAddImageToSet(img)
                }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            )
          }}
        />
      </Box>
    </Modal>
  )
}
