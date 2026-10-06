import { useEffect, useMemo, useRef, useState } from 'react'
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
import RowMenu from '../RowMenu'

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
  box.name === classOption.name,
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

  const consumed = new Set(), replacements = new Map()
  const sameClass = sourceClass.id === conditionClass.id
  const acrossChannels = String(sourceClass.channelId) !== String(conditionClass.channelId)
  const area = box => Number(box.w ?? box.width) * Number(box.h ?? box.height)
  const indices = currentBoxes.map((box, index) => index).sort((a, b) => area(currentBoxes[b]) - area(currentBoxes[a]) || a - b)
  for (const index of indices) {
    const sourceBox = currentBoxes[index]
    if (consumed.has(index) || !classMatches(sourceBox, sourceClass)) continue
    const matches = indices.filter(i => {
      if (i === index || consumed.has(i)) return false
      const candidate = currentBoxes[i]
      if (!classMatches(candidate, conditionClass)) return false
      const sourceChannels = sourceBox.channel_ids || [sourceBox.channel_id]
      const candidateChannels = candidate.channel_ids || [candidate.channel_id]
      if (acrossChannels && sourceChannels.some(id => candidateChannels.includes(id))) return false
      const iou = intersectionOverUnion(sourceBox, candidate)
      if (iou <= 0) return false
      return rule.conditionType === 'overlaps_with'
        ? iou >= Number(rule.overlapThreshold)
        : isContainedBy(sourceBox, candidate) || (sameClass && isContainedBy(candidate, sourceBox))
    }).sort((a, b) => intersectionOverUnion(sourceBox, currentBoxes[b]) - intersectionOverUnion(sourceBox, currentBoxes[a]) || a - b)
    const selected = acrossChannels ? matches.slice(0, 1) : matches
    if (!selected.length) continue
    const group = [index, ...selected]
    group.forEach(i => consumed.add(i))
    replacements.set(index, { ...sourceBox, class: outputClass.id, name: outputClass.name, color: outputClass.color,
      channel_id: outputClass.channelId,
      channel_ids: [...new Set(group.flatMap(i => currentBoxes[i].channel_ids || [currentBoxes[i].channel_id]))] })
  }
  return currentBoxes.flatMap((box, index) => replacements.has(index) ? [replacements.get(index)] : consumed.has(index) ? [] : [box])
}, boxes)

export default function MergeAnnotationsModal({
  open,
  onClose,
  boxes = [],
  channels = [],
  annotations = [],
  onPreview,
  onMerge,
}) {
  const nextRuleId = useRef(2)
  const [rules, setRules] = useState([])
  const [selectedRuleId, setSelectedRuleId] = useState(null)
  const [changedCount, setChangedCount] = useState(null)
  const annotationOptions = useMemo(() => Array.from(new Map([
    ...annotations.flatMap(annotation => (annotation.labels?.labels || []).map(label => {
      const channel = channels.find(item => item.id === annotation.channel_id)
      const channelName = `C${(channel?.orderIndex ?? 0) + 1}`
      const id = JSON.stringify([String(annotation.channel_id), label.name])
      return [id, { id, channelId: annotation.channel_id, classIndex: annotation.labels.labels.indexOf(label), name: label.name, color: label.color, label: `${channelName} - ${label.name}` }]
    })),
    ...boxes.map(box => {
      const channel = channels.find(item => item.id === box.channel_id)
      const channelName = `C${(channel?.orderIndex ?? 0) + 1}`
      const id = JSON.stringify([String(box.channel_id), box.name])
      return [id, { id, channelId: box.channel_id, classIndex: box.class, name: box.name, color: box.color, label: `${channelName} - ${box.name}` }]
    }),
  ]).values()), [annotations, boxes, channels])

  useEffect(() => {
    if (!open || annotationOptions.length === 0) return
    setRules(previous => {
      if (previous.length > 0) return previous
      return [emptyRule(1, annotationOptions)]
    })
    setSelectedRuleId(previous => previous || 1)
  }, [open, annotationOptions])

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

  const rulesValid = rules.every(rule =>
    [rule.sourceClass, rule.conditionClass, rule.outputClass].every(id => annotationOptions.some(option => option.id === id)) &&
    [rule.sourceClass, rule.conditionClass].includes(rule.outputClass) &&
    (rule.conditionType !== 'overlaps_with' || (rule.overlapThreshold !== '' &&
      Number.isFinite(Number(rule.overlapThreshold)) && Number(rule.overlapThreshold) >= 0 && Number(rule.overlapThreshold) <= 1)))
  const mergedBoxes = useMemo(() => open && rulesValid ? applyRules(boxes, rules, annotationOptions) : boxes,
    [open, rulesValid, boxes, rules, annotationOptions])
  const removedCount = boxes.length - mergedBoxes.length
  const canMerge = rulesValid && boxes.length > 0 && rules.length > 0 && annotationOptions.length > 0
  const merge = (previewOnly) => {
    if (!canMerge) return
    if (previewOnly) onPreview?.(mergedBoxes)
    else onMerge?.(mergedBoxes)
    setChangedCount(removedCount)
  }

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
          Preview opens the merged result in a separate canvas. Merge creates a merged layer for this image and keeps your original annotations unchanged.
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
          Removed {changedCount} overlapping box{changedCount === 1 ? '' : 'es'}.
        </Typography>}
        {!rulesValid && <Typography variant="body2" color="error">Choose available input/output classes and an IoU threshold between 0 and 1.</Typography>}
        {rules.length > 0 && rulesValid && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Current rules remove {removedCount} overlapping box{removedCount === 1 ? '' : 'es'}.
        </Typography>}
        <Box display="flex" justifyContent="flex-end" gap={1} sx={{ mt: 1 }}>
          <Button variant="outlined" onClick={onClose}>Close</Button>
          <Button variant="outlined" onClick={() => merge(true)} disabled={!canMerge}>
            Preview
          </Button>
          <Button variant="contained" onClick={() => merge(false)} disabled={!canMerge}>
            Merge
          </Button>
        </Box>
      </Box>
    </Modal>
  )
}
