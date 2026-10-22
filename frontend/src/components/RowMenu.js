import { Box, IconButton, Stack, Typography, Tooltip } from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import AddCircleIcon from '@mui/icons-material/AddCircle'

const RowMenu = ({ rows, onChange, onDelete, onAdd, onSelect, selectedRowId, renderRowTemplate, headers, gridTemplateColumns }) => {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      {/* Table/List Headers */}
      {headers && headers.length > 0 && (
        <Box 
          display="grid" 
          gridTemplateColumns={gridTemplateColumns || `repeat(${headers.length}, 1fr)`} 
          gap={2} 
          sx={{ 
            mb: 1,
            pr: '52px' // Adjusted to line up perfectly over the custom scroll window room
          }} 
        >
          {headers.map((header, idx) => (
            <Typography 
              key={idx} 
              variant="subtitle2" 
              color="text.secondary" 
              sx={{ fontWeight: 'bold' }}
            >
              {header}
            </Typography>
          ))}
        </Box>
      )}

      {/* Fixed Height Scroll Window Container */}
      <Box
        sx={{
          height: '200px',    // Forces the viewport to ALWAYS be exactly 320px tall
          overflowY: 'auto',  // Still handles the scrollbar automatically when rows overflow
          pr: 0.5,            
          bgcolor: 'action.hover', // Gives it a subtle, dark/tinted backing surface
          border: '1px solid',
          borderColor: 'divider',   // Puts a crisp, clean border around the container boundary
          borderRadius: 1,          // Matches the curves of your row designs
          p: 1,
          // Keep the clean scrollbar styling
          '&::-webkit-scrollbar': {
            width: '6px'
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent'
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: 'action.disabled',
            borderRadius: '4px'
          }
        }}
      >
        <Stack spacing={1} sx={{ width: '100%' }}>
          {rows.map((row, index) => {
            const isSelected = row.id === selectedRowId
            return (
              <Box 
                key={row.id}
                display='flex'
                flexDirection="row"
                alignItems="center"
                onClick={() => onSelect?.(row.id)}
                sx={{
                  position: 'relative',
                  borderRadius: 1,
                  border: '2px solid',
                  borderColor: isSelected ? 'primary.main' : 'transparent',
                  bgcolor: isSelected ? 'action.selected' : 'action.hover',
                  cursor: 'pointer',
                  px: 1,
                  py: 0.5,
                  transition: 'border-color 0.15s, background-color 0.15s',
                  '&:hover': {
                    borderColor: isSelected ? 'primary.main' : 'primary.light',
                    bgcolor: isSelected ? 'action.selected' : 'action.hover',
                  }
                }}
              >
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  {renderRowTemplate(row, index, (fieldName, value) => onChange(index, fieldName, value))}
                </Box>

                {onDelete && <IconButton
                  color="error" 
                  onClick={(e) => {
                    e.stopPropagation() 
                    onDelete(index)
                  }}
                >
                  <DeleteIcon />
                </IconButton>}
              </Box>
            )
          })}
        </Stack>
      </Box>

      {/* Minimalistic Plus Icon Button to Add Row */}
      {onAdd && <Box display="flex" justifyContent="flex-start">
        <Tooltip title="Add New Item" arrow placement="right">
          <IconButton 
            color="primary" 
            onClick={onAdd}
            size="large"
            sx={{ p: 1, mb: 1 }}
          >
            <AddCircleIcon fontSize="medium" />
          </IconButton>
        </Tooltip>
      </Box>}
    </Box>
  )
}

export default RowMenu