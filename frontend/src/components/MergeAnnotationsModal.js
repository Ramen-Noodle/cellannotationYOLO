import { useRef, useState } from 'react'
import { Box, Button, IconButton, Modal, TextField, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import RowMenu from './RowMenu'

export default function MergeAnnotationsModal({ open, onClose }) {
  const nextRuleId = useRef(2)
  const [rules, setRules] = useState([{ id: 1, name: 'Merge rule 1' }])
  const [selectedRuleId, setSelectedRuleId] = useState(1)

  const addRule = () => {
    const id = nextRuleId.current++
    setRules(prev => [...prev, { id, name: `Merge rule ${id}` }])
    setSelectedRuleId(id)
  }

  const removeRule = index => {
    const remaining = rules.filter((_, i) => i !== index)
    setRules(remaining)
    if (rules[index].id === selectedRuleId) {
      setSelectedRuleId(remaining[Math.min(index, remaining.length - 1)]?.id ?? null)
    }
  }

  return (
    <Modal open={open} onClose={onClose}
      aria-labelledby="merge-annotations-title"
      aria-describedby="merge-annotations-description"
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Box role="dialog" aria-modal="true" aria-labelledby="merge-annotations-title"
        sx={{ width: '100%', maxWidth: 600, maxHeight: '85vh', overflowY: 'auto',
          bgcolor: 'background.paper', borderRadius: 2, boxShadow: 24, p: 3, outline: 'none' }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography id="merge-annotations-title" variant="h6">Merge Annotations</Typography>
          <IconButton aria-label="Close merge annotations" onClick={onClose} size="small"><CloseIcon /></IconButton>
        </Box>
        <Typography id="merge-annotations-description" variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Each row represents a merge rule. Add and name rules here; merging is not available yet.
        </Typography>
        {rules.length === 0 && <Typography variant="body2" sx={{ mb: 1 }}>Add a rule using the plus button below.</Typography>}
        <RowMenu rows={rules} selectedRowId={selectedRuleId} onSelect={setSelectedRuleId}
          onAdd={addRule} onDelete={removeRule}
          onChange={(index, field, value) => setRules(prev => prev.map((rule, i) =>
            i === index ? { ...rule, [field]: value } : rule))}
          renderRowTemplate={(rule, index, onChange) => (
            <TextField fullWidth size="small" label={`Rule ${index + 1} name`} value={rule.name}
              onFocus={() => setSelectedRuleId(rule.id)}
              onChange={event => onChange('name', event.target.value)} />
          )} />
        <Box display="flex" justifyContent="flex-end" sx={{ mt: 1 }}>
          <Button variant="outlined" onClick={onClose}>Close</Button>
        </Box>
      </Box>
    </Modal>
  )
}
