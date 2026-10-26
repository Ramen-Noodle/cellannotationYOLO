import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Stack } from '@mui/material'

export default function ApplyMergeRecipeModal({ open, onClose, recipes, imageList, imageSets, onApply, loading, error }) {
  const [recipeId, setRecipeId] = useState('')
  const [sourceType, setSourceType] = useState('image')
  const [sourceId, setSourceId] = useState('')
  const selectedSources = sourceType === 'image' ? imageList : imageSets

  const changeSourceType = value => {
    setSourceType(value)
    setSourceId('')
  }

  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
    <DialogTitle>Apply merge recipe</DialogTitle>
    <DialogContent>
      <Stack spacing={2} sx={{ pt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        <FormControl fullWidth size="small">
          <InputLabel id="apply-merge-recipe-label">Recipe</InputLabel>
          <Select labelId="apply-merge-recipe-label" label="Recipe" value={recipeId} onChange={event => setRecipeId(event.target.value)}>
            {recipes.map(recipe => <MenuItem key={recipe.id} value={recipe.id}>{recipe.name}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl fullWidth size="small">
          <InputLabel id="apply-merge-source-type-label">Source</InputLabel>
          <Select labelId="apply-merge-source-type-label" label="Source" value={sourceType} onChange={event => changeSourceType(event.target.value)}>
            <MenuItem value="image">Image</MenuItem>
            <MenuItem value="set">Image set</MenuItem>
          </Select>
        </FormControl>
        <FormControl fullWidth size="small">
          <InputLabel id="apply-merge-source-label">{sourceType === 'image' ? 'Image' : 'Image set'}</InputLabel>
          <Select labelId="apply-merge-source-label" label={sourceType === 'image' ? 'Image' : 'Image set'} value={sourceId} onChange={event => setSourceId(event.target.value)}>
            {selectedSources.map(source => <MenuItem key={source.id} value={source.id}>{source.name || source.id}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="contained" disabled={loading || !recipeId || !sourceId} onClick={() => onApply({ recipeId, sourceType, sourceId })}>
        {loading ? 'Applying…' : 'Apply'}
      </Button>
    </DialogActions>
  </Dialog>
}
