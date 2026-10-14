import { Box, Typography } from '@mui/material'

export default function CombineAnnotationsPage() {
  return (
    <Box sx={{ height: '100%', p: 4, boxSizing: 'border-box', bgcolor: 'background.default' }}>
      <Typography variant="h5" sx={{ mb: 1 }}>Combine Annotations</Typography>
      <Typography color="text.secondary">
        Annotation merging will be built here.
      </Typography>
    </Box>
  )
}
