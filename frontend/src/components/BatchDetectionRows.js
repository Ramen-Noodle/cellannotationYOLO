import { Box, Button, Checkbox, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material'

export function batchRowError(row, models) {
  const model = models.find(m => m.id === row.selectedModelId)
  if (!model) return 'Select a model.'
  if (!row.selectedClasses?.length) return 'Select at least one class.'
  if (row.rowThreshold === '' || !Number.isFinite(Number(row.rowThreshold)) || row.rowThreshold < 0 || row.rowThreshold > 1) return 'Threshold must be between 0 and 1.'
  const diameters = model.name.toLowerCase().includes('stardist')
    ? [row.rowMinDiameter, row.rowMaxDiameter] : [row.rowDiameter]
  if (diameters.some(d => !Number.isFinite(Number(d)) || Number(d) <= 0)) return 'Diameters must be greater than zero.'
  if (diameters.length === 2 && Number(diameters[0]) > Number(diameters[1])) return 'Minimum diameter cannot exceed maximum diameter.'
  return ''
}

export default function BatchDetectionRows({ groups, rows, models, selectedIds, onToggle, onChange, onAdd, onRemove }) {
  return groups.map(group => (
    <Box key={group.order} component="section" aria-label={`Channel ${group.order + 1}`} sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Typography variant="subtitle1">Channel {group.order + 1}</Typography>
      <Typography variant="caption" color="text.secondary">Present in {group.count} of {group.total} images</Typography>
      {rows.filter(row => row.channelOrder === group.order).map((row, index) => {
        const model = models.find(m => m.id === row.selectedModelId)
        const labels = model?.label_set?.labels || []
        const stardist = model?.name?.toLowerCase().includes('stardist')
        const error = batchRowError(row, models)
        const update = (field, value) => onChange(row.id, field, value)
        return <Box key={row.id} sx={{ mt: 1.5, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <FormControlLabel control={<Checkbox checked={selectedIds.includes(row.id)} onChange={() => onToggle(row.id)} />} label={`Row ${index + 1}${row.batchDraft ? ' · Draft' : ''}`} />
            <Button size="small" onClick={() => onRemove(row.id)}>Remove row</Button>
          </Stack>
          <Stack spacing={1.5}>
            <TextField select size="small" label="Model" value={row.selectedModelId} onChange={e => update('selectedModelId', e.target.value)}>
              {models.map(m => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Classes" value={row.selectedClasses || []} SelectProps={{ multiple: true }} onChange={e => update('selectedClasses', e.target.value)}>
              {labels.map(l => <MenuItem key={l.name} value={l.name}>{l.name}</MenuItem>)}
            </TextField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField fullWidth size="small" type="number" label="Threshold" value={row.rowThreshold} inputProps={{ min: 0, max: 1, step: 0.05 }} onChange={e => update('rowThreshold', e.target.value)} />
              {(stardist ? [['rowMinDiameter', 'Min diameter (px)'], ['rowMaxDiameter', 'Max diameter (px)']] : [['rowDiameter', 'Cell diameter (px)']]).map(([field, label]) =>
                <TextField key={field} fullWidth size="small" type="number" label={label} value={row[field]} inputProps={{ min: 0.01, step: 'any' }} onChange={e => update(field, e.target.value)} />)}
            </Stack>
            <TextField size="small" label="Row label (optional)" value={row.rowSublabel} onChange={e => update('rowSublabel', e.target.value)} />
            {selectedIds.includes(row.id) && error && <Typography color="error" variant="caption">{error}</Typography>}
          </Stack>
        </Box>
      })}
      <Button sx={{ mt: 1 }} disabled={!models.length} onClick={() => onAdd(group.order)}>Add detection row</Button>
      {!models.length && <Typography variant="caption">Upload a model to add detection rows.</Typography>}
    </Box>
  ))
}
