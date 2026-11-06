/* global BigInt */
import { useEffect, useMemo, useState } from 'react'
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { combinationCatalog, combinationKey, outputAssignmentKey } from '../utils/twoPhaseCombinations.mjs'

const PAGE_SIZE = 50n
export default function TwoPhaseCombinationsTable({ channels, outputs, preview, assignments, onAssign, editingDisabled, previewOutdated }) {
  const [page, setPage] = useState(0n)
  const [observedOnly, setObservedOnly] = useState(false)
  const [newClassRow, setNewClassRow] = useState(null)
  const [newClassName, setNewClassName] = useState('')
  const classNames = useMemo(() => [...new Set(Object.values(assignments))].sort((a, b) => a.localeCompare(b)), [assignments])
  const catalog = useMemo(() => combinationCatalog(channels, outputs), [channels, outputs])
  const observed = useMemo(() => new Map(preview?.combinations.map(row => [row.key, row])), [preview])
  useEffect(() => { setPage(0n) }, [catalog, preview])
  const showingObserved = observedOnly && Boolean(preview)
  const total = showingObserved ? BigInt(observed.size) : catalog.total
  const pages = total === 0n ? 1n : (total + PAGE_SIZE - 1n) / PAGE_SIZE
  const currentPage = page < pages ? page : pages - 1n
  const start = currentPage * PAGE_SIZE
  const end = start + PAGE_SIZE < total ? start + PAGE_SIZE : total
  const rows = showingObserved ? preview.combinations.slice(Number(start), Number(end)) : []
  if (!showingObserved) {
    for (let index = start; index < end; index += 1n) {
      const states = catalog.rowAt(index)
      const key = combinationKey(states)
      const name = states.flatMap((value, position) => value ? [`${catalog.options[position].channel}: ${value.name}`] : []).join(' + ')
      rows.push(observed.get(key) || { key, states, name, count: 0 })
    }
  }

  return <Stack spacing={1.5}>
    <Box>
      <Typography variant="h6">Cross-channel combinations</Typography>
      <Typography variant="body2" color="text.secondary">
        {catalog.total.toLocaleString()} possible combinations from the channel graph outputs.
        {preview ? ` ${observed.size.toLocaleString()} combinations have detections.` : ' Run the preview to see detection counts.'}
      </Typography>
      <Typography variant="body2" color="text.secondary">No change keeps each Phase 1 box and its class.</Typography>
      {previewOutdated && <Typography variant="body2" color="text.secondary">Preview again to see your output class changes.</Typography>}
      <FormControlLabel label="Only rows with detections" control={<Checkbox size="small" disabled={!preview}
        checked={showingObserved} onChange={event => { setObservedOnly(event.target.checked); setPage(0n) }} />} />
    </Box>
    <Box sx={{ overflowX: 'auto', maxHeight: 520, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Table size="small" stickyHeader aria-label="Possible cross-channel class combinations">
        <TableHead><TableRow><TableCell>Combination</TableCell>{catalog.options.map(option => <TableCell key={option.channel}>{option.channel}</TableCell>)}
          <TableCell align="right">Groups</TableCell><TableCell>Output class</TableCell></TableRow></TableHead>
        <TableBody>
          {rows.map(row => {
            const assignmentKey = outputAssignmentKey(row.states.filter(Boolean).map(output => output.id))
            const assignedName = assignments[assignmentKey]
            return <TableRow key={row.key}>
              <TableCell><Stack direction="row" spacing={1} alignItems="center">
                {row.color && !previewOutdated && <Box aria-hidden="true" sx={{ bgcolor: row.color, width: 10, height: 10, borderRadius: '50%', flexShrink: 0 }} />}
                <span>{row.name}</span>
              </Stack></TableCell>
              {row.states.map((value, index) => <TableCell key={catalog.options[index].channel} sx={{ minWidth: 150 }}>
                {value === null ? <Typography variant="body2" color="text.secondary">No match</Typography> : `${value.name} positive`}
              </TableCell>)}
              <TableCell align="right">{preview ? row.count.toLocaleString() : '—'}</TableCell>
              <TableCell sx={{ minWidth: 220 }}>
                <Select fullWidth size="small" displayEmpty disabled={editingDisabled}
                  inputProps={{ 'aria-label': `Output class for ${row.name}` }}
                  value={assignedName ? JSON.stringify(assignedName) : ''}
                  onChange={event => {
                    const value = event.target.value
                    if (value === 'new') {
                      setNewClassRow(assignmentKey)
                      setNewClassName('')
                    } else {
                      onAssign(assignmentKey, value ? JSON.parse(value) : '')
                    }
                  }}>
                  <MenuItem value="">No change</MenuItem>
                  {classNames.map(name => <MenuItem key={name} value={JSON.stringify(name)}>{name}</MenuItem>)}
                  <MenuItem value="new">New output class…</MenuItem>
                </Select>
              </TableCell>
            </TableRow>
          })}
          {!rows.length && <TableRow><TableCell colSpan={catalog.options.length + 3}>
            {showingObserved ? 'The preview found no detections.' : 'Combinations appear for unconnected input classes and connected output tables.'}
          </TableCell></TableRow>}
        </TableBody>
      </Table>
    </Box>
    <Stack direction="row" spacing={1} alignItems="center">
      <Button disabled={currentPage === 0n} onClick={() => setPage(currentPage - 1n)}>Previous</Button>
      <Typography variant="body2">Page {(currentPage + 1n).toLocaleString()} of {pages.toLocaleString()}</Typography>
      <Button disabled={currentPage + 1n >= pages} onClick={() => setPage(currentPage + 1n)}>Next</Button>
    </Stack>
    <Dialog open={newClassRow !== null} onClose={() => setNewClassRow(null)} fullWidth maxWidth="xs">
      <Box component="form" onSubmit={event => {
        event.preventDefault()
        const name = newClassName.trim()
        if (!name || editingDisabled) return
        onAssign(newClassRow, name)
        setNewClassRow(null)
      }}>
        <DialogTitle>New output class</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth margin="dense" label="Class name" value={newClassName}
            inputProps={{ maxLength: 255 }} onChange={event => setNewClassName(event.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewClassRow(null)}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={!newClassName.trim() || editingDisabled}>Assign class</Button>
        </DialogActions>
      </Box>
    </Dialog>
  </Stack>
}
