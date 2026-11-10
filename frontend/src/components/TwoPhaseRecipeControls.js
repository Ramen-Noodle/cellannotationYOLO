import { useEffect, useState } from 'react'
import { Alert, Button, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'

export default function TwoPhaseRecipeControls({ apiUrl, imageId, recipe, onLoad, onApplied, onBusy }) {
  const [recipes, setRecipes] = useState([])
  const [recipeId, setRecipeId] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    fetch(`${apiUrl}/merge-recipes`, { credentials: 'include', signal: controller.signal })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not load recipes.')
        setRecipes(data)
      }).catch(error => { if (error.name !== 'AbortError') setError(error.message) })
    return () => controller.abort()
  }, [apiUrl])

  const load = async id => {
    setError(''); setMessage('')
    const record = recipes.find(record => record.id === id)
    if (record) { setBusy(true); onBusy(true) }
    try {
      if (record) await onLoad(record.recipe)
      setRecipeId(id)
      setName(record?.name || '')
    } catch (error) { setError(error.message) }
    finally { if (record) { setBusy(false); onBusy(false) } }
  }
  const submit = async apply => {
    setBusy(true); onBusy(true); setError(''); setMessage('')
    try {
      const url = apply ? '/combine/apply' : recipeId ? `/merge-recipes/${recipeId}` : '/merge-recipes'
      const body = apply ? { recipe, image_ids: [imageId] } : {
        name: name.trim(), recipe,
        source_classes: recipe.inputs.map(source => ({ channel: source.channel, class_name: source.class_name, label: source.sublabel })),
      }
      const response = await fetch(`${apiUrl}${url}`, {
        method: !apply && recipeId ? 'PUT' : 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not save the merge.')
      if (apply) {
        onApplied(data.results[0])
        setMessage('Merged annotations saved to this image.')
      } else {
        setRecipes(previous => [...previous.filter(record => record.id !== data.id), data].sort((a, b) => a.name.localeCompare(b.name)))
        setRecipeId(data.id)
        setMessage('Recipe saved.')
      }
    } catch (error) { setError(error.message) }
    finally { setBusy(false); onBusy(false) }
  }
  return <Stack spacing={1.5}>
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
      <FormControl size="small" sx={{ minWidth: 240 }} disabled={busy}>
        <InputLabel>Saved recipe</InputLabel>
        <Select label="Saved recipe" value={recipeId} onChange={event => load(event.target.value)}>
          <MenuItem value="">New recipe</MenuItem>
          {recipes.map(record => <MenuItem key={record.id} value={record.id}>{record.name}</MenuItem>)}
        </Select>
      </FormControl>
      <TextField size="small" label="Recipe name" value={name} disabled={busy} inputProps={{ maxLength: 255 }} onChange={event => setName(event.target.value)} />
      <Button disabled={busy || !recipe || !name.trim()} onClick={() => submit(false)}>{recipeId ? 'Update recipe' : 'Save recipe'}</Button>
      <Button variant="outlined" disabled={busy || !recipe} onClick={() => submit(true)}>{busy ? 'Working…' : 'Apply to image'}</Button>
    </Stack>
    <Typography variant="caption" color="text.secondary">Preview the current graph to enable saving. Apply replaces this image’s merged annotation layer.</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {message && <Alert severity="success">{message}</Alert>}
  </Stack>
}
