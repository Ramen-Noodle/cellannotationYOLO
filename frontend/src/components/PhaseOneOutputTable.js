/* global BigInt */
import { useMemo, useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { availableOutputMappings, inputClassName, outputAssignmentKey } from '../utils/twoPhaseCombinations.mjs'

const PAGE_SIZE = 50n

export default function PhaseOneOutputTable({ inputs, mappings, onChange, onClose }) {
  const [page, setPage] = useState(0n)
  const availableMappings = useMemo(() => availableOutputMappings(inputs, mappings), [inputs, mappings])
  const byCombination = new Map(availableMappings.map(row => [outputAssignmentKey(row.sources), row.target]))
  const total = (1n << BigInt(inputs.length)) - 1n
  const pageCount = total ? (total + PAGE_SIZE - 1n) / PAGE_SIZE : 1n
  const currentPage = page < pageCount ? page : pageCount - 1n
  const start = currentPage * PAGE_SIZE
  const rows = []
  for (let index = start; index < total && index < start + PAGE_SIZE; index++) {
    rows.push(inputs.filter((_, bit) => ((index + 1n) & (1n << BigInt(bit))) !== 0n))
  }

  return <Dialog open onClose={onClose} fullWidth maxWidth="md">
    <DialogTitle>Phase 1 output combinations</DialogTitle>
    <DialogContent dividers>
      <Typography variant="body2" color="text.secondary">
        Pick an input class for each combination. No change keeps each box and its original class.
      </Typography>
      {rows.length ? <Table size="small" aria-label="Phase 1 output combinations">
        <TableHead><TableRow><TableCell>Input combination</TableCell><TableCell>Output class</TableCell></TableRow></TableHead>
        <TableBody>{rows.map(row => {
          const sources = row.map(input => input.id)
          const key = outputAssignmentKey(sources)
          const label = row.map(inputClassName).join(' + ')
          const defaultTarget = sources.length === 1 ? sources[0] : null
          const selectedTarget = byCombination.has(key) ? byCombination.get(key) : defaultTarget
          return <TableRow key={key}>
            <TableCell>{label}</TableCell>
            <TableCell sx={{ width: '40%' }}>
              <Select fullWidth size="small" displayEmpty value={selectedTarget ?? ''}
                inputProps={{ 'aria-label': `Output class for ${label}` }}
                onChange={event => {
                  const target = event.target.value || null
                  const otherRows = availableMappings.filter(mapping => outputAssignmentKey(mapping.sources) !== key)
                  onChange(target === defaultTarget ? otherRows : [...otherRows, { sources, target }])
                }}>
                <MenuItem value="">No change</MenuItem>
                {inputs.map(input => <MenuItem key={input.id} value={input.id}>{inputClassName(input)}</MenuItem>)}
              </Select>
            </TableCell>
          </TableRow>
        })}</TableBody>
      </Table> : <Typography sx={{ mt: 2 }}>Connect input classes or a rule to this output node.</Typography>}
    </DialogContent>
    <DialogActions>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexGrow: 1 }}>
        <Button disabled={currentPage === 0n} onClick={() => setPage(currentPage - 1n)}>Previous</Button>
        <Typography variant="body2">Page {(currentPage + 1n).toLocaleString()} of {pageCount.toLocaleString()}</Typography>
        <Button disabled={currentPage + 1n >= pageCount} onClick={() => setPage(currentPage + 1n)}>Next</Button>
      </Stack>
      <Button onClick={onClose}>Done</Button>
    </DialogActions>
  </Dialog>
}
