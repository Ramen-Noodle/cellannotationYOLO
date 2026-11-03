/* global BigInt */
import { useEffect, useMemo, useState } from 'react'
import { Box, Button, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { combinationCatalog } from '../utils/twoPhaseCombinations.mjs'

const PAGE_SIZE = 50n

export default function TwoPhaseCombinationsTable({ channels, classes }) {
  const [page, setPage] = useState(0n)
  const catalog = useMemo(() => combinationCatalog(channels, classes), [channels, classes])
  useEffect(() => { setPage(0n) }, [channels, classes])
  const pages = catalog.total === 0n ? 1n : (catalog.total + PAGE_SIZE - 1n) / PAGE_SIZE
  const currentPage = page < pages ? page : pages - 1n
  const start = currentPage * PAGE_SIZE
  const end = start + PAGE_SIZE < catalog.total ? start + PAGE_SIZE : catalog.total
  const rows = []
  for (let index = start; index < end; index += 1n) rows.push({ id: index.toString(), states: catalog.rowAt(index) })

  return <Stack spacing={1.5}>
    <Box>
      <Typography variant="h6">Cross-channel combinations</Typography>
      <Typography variant="body2" color="text.secondary">
        {catalog.total.toLocaleString()} possible categories from the image’s classes. Each channel is either negative or positive for one class; the all-negative category is excluded. The graph does not change this table yet.
      </Typography>
    </Box>
    <Box sx={{ overflowX: 'auto', maxHeight: 520, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Table size="small" stickyHeader aria-label="Possible cross-channel class combinations">
        <TableHead><TableRow><TableCell>Combination</TableCell>{catalog.options.map(option => <TableCell key={option.channel}>{option.channel}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          {rows.map(row => <TableRow key={row.id}>
            <TableCell>{(BigInt(row.id) + 1n).toLocaleString()}</TableCell>
            {row.states.map((value, index) => <TableCell key={catalog.options[index].channel} sx={{ minWidth: 150 }}>
              {value === null ? <Typography variant="body2" color="text.secondary">negative</Typography> : `${value} positive`}
            </TableCell>)}
          </TableRow>)}
          {!rows.length && <TableRow><TableCell colSpan={catalog.options.length + 1}>No class combinations are available for this image.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Box>
    <Stack direction="row" spacing={1} alignItems="center">
      <Button disabled={currentPage === 0n} onClick={() => setPage(currentPage - 1n)}>Previous</Button>
      <Typography variant="body2">Page {(currentPage + 1n).toLocaleString()} of {pages.toLocaleString()}</Typography>
      <Button disabled={currentPage + 1n >= pages} onClick={() => setPage(currentPage + 1n)}>Next</Button>
    </Stack>
  </Stack>
}
