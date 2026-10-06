import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Modal,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import RowMenu from './RowMenu'

const emptyRule = (id, options) => ({
  id,
  sourceClass: options[0]?.id || '',
  conditionType: 'contained_by',
  conditionClass: options[1]?.id || options[0]?.id || '',
  outputClass: options[0]?.id || '',
  overlapThreshold: 0.25,
})

const classMatches = (box, classOption) => Boolean(
  classOption && String(box.channel_id) === String(classOption.channelId) &&
  (box.name === classOption.name || Number(box.class) === Number(classOption.classIndex)),
)

const boundsFor = box => ({
  left: Number(box.x) || 0,
  top: Number(box.y) || 0,
  right: (Number(box.x) || 0) + (Number(box.w ?? box.width) || 0),
  bottom: (Number(box.y) || 0) + (Number(box.h ?? box.height) || 0),
})

const isContainedBy = (source, container) => {
  const a = boundsFor(source)
  const b = boundsFor(container)
  return a.left >= b.left && a.top >= b.top && a.right <= b.right && a.bottom <= b.bottom
}

const intersectionOverUnion = (first, second) => {
  const a = boundsFor(first)
  const b = boundsFor(second)
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  const intersection = width * height
  const firstArea = Math.max(0, a.right - a.left) * Math.max(0, a.bottom - a.top)
  const secondArea = Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top)
  const union = firstArea + secondArea - intersection
  return union > 0 ? intersection / union : 0
}

const applyRules = (boxes, rules, options) => rules.reduce((currentBoxes, rule) => {
  const sourceClass = options.find(item => item.id === rule.sourceClass)
  const conditionClass = options.find(item => item.id === rule.conditionClass)
  const outputClass = options.find(item => item.id === rule.outputClass)
  if (!sourceClass || !conditionClass || !outputClass) return currentBoxes

  const boxesToRemove = new Set()
  const updatedBoxes = currentBoxes.map(sourceBox => {
    if (!classMatches(sourceBox, sourceClass)) return sourceBox
    const matchingConditions = currentBoxes.filter(conditionBox => {
      if (conditionBox === sourceBox) return false
      if (!classMatches(conditionBox, conditionClass)) return false
      if (rule.conditionType === 'overlaps_with') {
        return intersectionOverUnion(sourceBox, conditionBox) >= Number(rule.overlapThreshold || 0)
      }
      return isContainedBy(sourceBox, conditionBox)
    })
    matchingConditions.forEach(conditionBox => boxesToRemove.add(conditionBox))
    return matchingConditions.length > 0
      ? { ...sourceBox, class: outputClass.classIndex ?? sourceBox.class, name: outputClass.name, color: outputClass.color }
      : sourceBox
  })
  return updatedBoxes.filter(box => !boxesToRemove.has(box))
}, boxes)

const countRuleMatches = (boxes, rules, options) => rules.reduce((count, rule) => {
  const sourceClass = options.find(item => item.id === rule.sourceClass)
  const conditionClass = options.find(item => item.id === rule.conditionClass)
  if (!sourceClass || !conditionClass) return count
  return count + boxes.filter(sourceBox => {
    if (!classMatches(sourceBox, sourceClass)) return false
    return boxes.some(conditionBox => {
      if (conditionBox === sourceBox || !classMatches(conditionBox, conditionClass)) return false
      return rule.conditionType === 'overlaps_with'
        ? intersectionOverUnion(sourceBox, conditionBox) >= Number(rule.overlapThreshold || 0)
        : isContainedBy(sourceBox, conditionBox)
    })
  }).length
}, 0)

export default function MergeAnnotationsModal({
  open,
  onClose,
  boxes = [],
  channels = [],
  annotations = [],
  onApply,
}) {
  const nextRuleId = useRef(2)
  const [rules, setRules] = useState([])
  const [selectedRuleId, setSelectedRuleId] = useState(null)
  const [changedCount, setChangedCount] = useState(null)
  const annotationOptions = Array.from(new Map([
    ...annotations.flatMap(annotation => (annotation.labels?.labels || []).map(label => {
      const channel = channels.find(item => item.id === annotation.channel_id)
      const channelName = `C${(channel?.orderIndex ?? 0) + 1}`
      const id = `${annotation.channel_id}|${label.name}|${label.color || ''}`
      return [id, { id, channelId: annotation.channel_id, classIndex: annotation.labels.labels.indexOf(label), name: label.name, color: label.color, label: `${channelName} - ${label.name}` }]
    })),
    ...boxes.map(box => {
      const channel = channels.find(item => item.id === box.channel_id)
      const channelName = `C${(channel?.orderIndex ?? 0) + 1}`
      const id = `${box.channel_id}|${box.name}|${box.color || ''}`
      return [id, { id, channelId: box.channel_id, classIndex: box.class, name: box.name, color: box.color, label: `${channelName} - ${box.name}` }]
    }),
  ]).values())

  useEffect(() => {
    if (!open || annotationOptions.length === 0) return
    setRules(previous => {
      if (previous.length > 0) return previous
      return [emptyRule(1, annotationOptions)]
    })
    setSelectedRuleId(previous => previous || 1)
  }, [open, annotationOptions.length])

  const addRule = () => {
    const id = nextRuleId.current++
    setRules(previous => [...previous, emptyRule(id, annotationOptions)])
    setSelectedRuleId(id)
  }

  const removeRule = index => {
    setRules(previous => {
      const remaining = previous.filter((_, itemIndex) => itemIndex !== index)
      setSelectedRuleId(current => current === previous[index]?.id
        ? remaining[Math.min(index, remaining.length - 1)]?.id || null
        : current)
      return remaining
    })
  }

  const updateRule = (index, field, value) => {
    setRules(previous => previous.map((rule, itemIndex) => (
      itemIndex === index
        ? {
            ...rule,
            [field]: value,
            ...(field === 'sourceClass' && rule.outputClass !== rule.conditionClass
              ? { outputClass: value } : {}),
            ...(field === 'conditionClass' && rule.outputClass !== rule.sourceClass
              ? { outputClass: value } : {}),
          }
        : rule
    )))
    setChangedCount(null)
  }

  const merge = () => {
    const mergedBoxes = applyRules(boxes, rules, annotationOptions)
    const changes = mergedBoxes.reduce((count, box, index) => (
      count + (box.name !== boxes[index]?.name || box.color !== boxes[index]?.color ? 1 : 0)
    ), 0)
    onApply?.(mergedBoxes)
    setChangedCount(changes)
  }

  const matchingCount = countRuleMatches(boxes, rules, annotationOptions)

  const classOptions = annotationOptions.map(item => (
    <MenuItem key={item.id} value={item.id}>{item.label}</MenuItem>
  ))

  return (
    <Modal open={open} onClose={onClose}
      aria-labelledby="merge-annotations-title"
      aria-describedby="merge-annotations-description"
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Box role="dialog" aria-modal="true" aria-labelledby="merge-annotations-title"
        sx={{ width: '100%', maxWidth: 900, maxHeight: '85vh', overflowY: 'auto',
          bgcolor: 'background.paper', borderRadius: 2, boxShadow: 24, p: 3, outline: 'none' }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography id="merge-annotations-title" variant="h6">Merge Annotations</Typography>
          <IconButton aria-label="Close merge annotations" onClick={onClose} size="small"><CloseIcon /></IconButton>
        </Box>
        <Typography id="merge-annotations-description" variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Rules apply to the current image as a local preview. The merged annotations are not uploaded to the server.
        </Typography>
        {boxes.length === 0 && <Typography variant="body2" sx={{ mb: 1 }}>There are no annotations on this image.</Typography>}
        {annotationOptions.length === 0 && <Typography variant="body2" sx={{ mb: 1 }}>No channel annotation classes are available.</Typography>}
        <RowMenu rows={rules} selectedRowId={selectedRuleId} onSelect={setSelectedRuleId}
          onAdd={addRule} onDelete={removeRule} onChange={updateRule}
          headers={['Replace', 'Relationship', 'With', 'Write class']}
          gridTemplateColumns="1.3fr 1.2fr 1.3fr 1.3fr"
          renderRowTemplate={(rule, index, onChange) => (
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ py: 0.5 }}>
              <TextField select fullWidth size="small" label="Replace" value={rule.sourceClass}
                onChange={event => onChange('sourceClass', event.target.value)}>{classOptions}</TextField>
              <TextField select fullWidth size="small" label="Condition" value={rule.conditionType}
                onChange={event => onChange('conditionType', event.target.value)}>
                <MenuItem value="contained_by">Contained by</MenuItem>
                <MenuItem value="overlaps_with">Overlaps with</MenuItem>
              </TextField>
              <TextField select fullWidth size="small" label="Compare with" value={rule.conditionClass}
                onChange={event => onChange('conditionClass', event.target.value)}>{classOptions}</TextField>
              <TextField select fullWidth size="small" label="Write class" value={rule.outputClass}
                onChange={event => onChange('outputClass', event.target.value)}>
                {annotationOptions.filter(option => option.id === rule.sourceClass || option.id === rule.conditionClass).map(option => (
                  <MenuItem key={option.id} value={option.id}>{option.label}</MenuItem>
                ))}
              </TextField>
              {rule.conditionType === 'overlaps_with' && (
                <TextField sx={{ minWidth: 110 }} size="small" type="number" label="IoU threshold" value={rule.overlapThreshold}
                  inputProps={{ min: 0, max: 1, step: 0.05 }}
                  onChange={event => onChange('overlapThreshold', event.target.value)} />
              )}
            </Stack>
          )} />
        {changedCount !== null && <Typography variant="body2" color="success.main" sx={{ mt: 1 }}>
          Updated {changedCount} annotation{changedCount === 1 ? '' : 's'} in this image preview.
        </Typography>}
        {rules.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Current rules match {matchingCount} source annotation{matchingCount === 1 ? '' : 's'}.
        </Typography>}
        <Box display="flex" justifyContent="flex-end" gap={1} sx={{ mt: 1 }}>
          <Button variant="outlined" onClick={onClose}>Close</Button>
          <Button variant="contained" onClick={merge} disabled={boxes.length === 0 || rules.length === 0 || annotationOptions.length === 0}>
            Apply merge preview
          </Button>
        </Box>
      </Box>
    </Modal>
  )
}
