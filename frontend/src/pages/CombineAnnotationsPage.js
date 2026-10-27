import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import ELK from 'elkjs/lib/elk.bundled.js'
import MergePreviewModal from '../components/modals/MergePreviewModal'
import RowMenu from '../components/RowMenu'

const API_BASE_URL = 'http://10.80.24.12:5002'
// Keep the image-layer tint palette identical to the main canvas. These
// colors belong to channels; annotation/class colors are kept on boxes and
// graph nodes separately.
const CHANNEL_COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF']
const CLASS_NODE_DEFAULT_COLOR = '#cbd5e1'
const NEW_OUTPUT_CLASS = '__new_output_class__'
const NO_OUTPUT_CLASS = '__no_output_class__'
const NO_CHANGE_CLASS = '__no_change_class__'

function channelName(channel) { return `C${(channel.order_index ?? 0) + 1}` }
function sourceNodeId(channel, annotation, className) {
  const settingId = annotation.detection_setting_id || annotation.id
  return `input:${channelName(channel)}:${settingId}:${className}`
}
function annotationCount(annotation, labelIndex) {
  return [...(annotation.annotations_detected || []), ...(annotation.annotations_drawn || [])]
    .filter(box => Number(box.class) === labelIndex).length
}

function annotationSublabels(annotation, labelIndex) {
  const configured = annotation.sublabel ? [annotation.sublabel] : []
  const perBox = [...(annotation.annotations_detected || []), ...(annotation.annotations_drawn || [])]
    .filter(box => Number(box.class) === labelIndex)
    .map(box => box.sublabel)
    .filter(Boolean)
  return [...new Set([...configured, ...perBox])]
}

function outputVariantId(node, mapping) {
  return `${node.id}::class::${mapping.class_id || mapping.label}`
}

export default function CombineAnnotationsPage() {
  const [images, setImages] = useState([])
  const [imageSets, setImageSets] = useState([])
  const [recipes, setRecipes] = useState([])
  const [recipeId, setRecipeId] = useState('')
  const [editingRecipe, setEditingRecipe] = useState(null)
  const [pendingRecipe, setPendingRecipe] = useState(null)
  const [recipeModalOpen, setRecipeModalOpen] = useState(false)
  const [recipeName, setRecipeName] = useState('')
  const [recipeSourceType, setRecipeSourceType] = useState('image')
  const [recipeSourceId, setRecipeSourceId] = useState('')
  const [imageId, setImageId] = useState('')
  const [annotationReloadKey, setAnnotationReloadKey] = useState(0)
  const [channels, setChannels] = useState([])
  const [annotations, setAnnotations] = useState([])
  const [nodes, setNodes] = useState([])
  const [createdNodes, setCreatedNodes] = useState([])
  const [connections, setConnections] = useState([])
  const [connectionDrag, setConnectionDrag] = useState(null)
  const [edgeDrag, setEdgeDrag] = useState(null)
  const [mergePreview, setMergePreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [loadingImages, setLoadingImages] = useState(true)
  const [loadingAnnotations, setLoadingAnnotations] = useState(false)
  const [error, setError] = useState('')
  const [graphZoom, setGraphZoom] = useState(1)
  const [graphPan, setGraphPan] = useState({ x: 0, y: 0 })
  const [outputTable, setOutputTable] = useState(null)
  const dragRef = useRef(null)
  const panRef = useRef(null)
  const graphRef = useRef(null)
  const loadedAnnotationsImageRef = useRef('')
  const layoutRequestedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${API_BASE_URL}/user-images`, { credentials: 'include' }),
      fetch(`${API_BASE_URL}/user-image-sets`, { credentials: 'include' }),
      fetch(`${API_BASE_URL}/merge-recipes`, { credentials: 'include' }),
    ])
      .then(async ([imagesResponse, setsResponse, recipesResponse]) => {
        const data = await imagesResponse.json().catch(() => ({}))
        const sets = await setsResponse.json().catch(() => [])
        const savedRecipes = await recipesResponse.json().catch(() => [])
        if (!imagesResponse.ok) throw new Error(data.error || 'Could not load images.')
        if (!recipesResponse.ok) throw new Error(savedRecipes.error || 'Could not load recipes.')
        return { data, sets: setsResponse.ok ? sets : [], savedRecipes }
      })
      .then(({ data, sets, savedRecipes }) => { if (!cancelled) { setImages(data); setImageSets(sets); setRecipes(savedRecipes); } })
      .catch(loadError => { if (!cancelled) setError(loadError.message) })
      .finally(() => { if (!cancelled) setLoadingImages(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!imageId) return
    let cancelled = false
    loadedAnnotationsImageRef.current = ''
    setLoadingAnnotations(true)
    setError('')
    Promise.all([
      fetch(`${API_BASE_URL}/load-channels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ image_id: imageId }) }),
      fetch(`${API_BASE_URL}/load-annotations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ image_id: imageId }) }),
    ])
      .then(async ([channelsResponse, annotationsResponse]) => {
        const channelData = await channelsResponse.json().catch(() => [])
        const annotationData = await annotationsResponse.json().catch(() => ({}))
        if (!channelsResponse.ok) throw new Error(channelData.error || 'Could not load channels.')
        if (!annotationsResponse.ok) throw new Error(annotationData.error || 'Could not load annotations.')
        return { channelData, annotationData }
      })
      .then(({ channelData, annotationData }) => { if (!cancelled) { layoutRequestedRef.current = true; setChannels(channelData); setAnnotations(annotationData.annotations || []); loadedAnnotationsImageRef.current = imageId } })
      .catch(loadError => { if (!cancelled) setError(loadError.message) })
      .finally(() => { if (!cancelled) setLoadingAnnotations(false) })
    return () => { cancelled = true }
  }, [imageId, annotationReloadKey])

  useEffect(() => {
    if (!pendingRecipe || loadingAnnotations || !imageId || loadedAnnotationsImageRef.current !== imageId) return
    const savedNodes = pendingRecipe.recipe?.nodes || []
    const created = savedNodes.filter(node => node.role !== 'input').map((node, index) => ({
      ...node,
      created: true,
      x: node.x ?? 32 + channels.length * 250 + Math.floor(index / 3) * 230,
      y: node.y ?? 32 + (index % 3) * 116,
      ruleType: node.rule_type || node.ruleType || 'iou',
      threshold: node.threshold ?? 0.25,
      outputMappings: node.output_mappings || node.outputMappings || [],
    }))
    setCreatedNodes(created)
    setConnections((pendingRecipe.recipe?.edges || []).map(edge => ({
      id: `${edge.source}->${edge.target}`,
      source: edge.source,
      target: edge.target,
    })))
    layoutRequestedRef.current = true
    setPendingRecipe(null)
  }, [pendingRecipe, loadingAnnotations, imageId, channels.length])

  useEffect(() => {
    setCreatedNodes([])
    setConnections([])
    setConnectionDrag(null)
    setEdgeDrag(null)
    setMergePreview(null)
    setOutputTable(null)
    setGraphZoom(1)
    setGraphPan({ x: 0, y: 0 })
  }, [imageId])

  const channelById = useMemo(() => new Map(channels.map(channel => [channel.id, channel])), [channels])

  useEffect(() => {
    const nextNodes = []
    channels.forEach((channel, channelIndex) => {
      let classIndex = 0
      annotations.filter(annotation => annotation.channel_id === channel.id).forEach(annotation => {
        ;(annotation.labels?.labels || []).forEach((label, labelIndex) => {
          const sublabels = annotationSublabels(annotation, labelIndex)
          const settingId = annotation.detection_setting_id || annotation.id
          nextNodes.push({
            id: sourceNodeId(channel, annotation, label.name), type: 'class', role: 'input', channel: channelName(channel), channelId: channel.id,
            detectionSettingId: settingId, channelIndex, name: label.name, sublabels, count: annotationCount(annotation, labelIndex),
            color: label.color || '#cbd5e1', x: 32 + channelIndex * 250, y: 32 + classIndex * 116,
          })
          classIndex += 1
        })
      })
    })
    setNodes(nextNodes)
  }, [annotations, channels])

  const displayNodes = useMemo(() => [...nodes, ...createdNodes], [nodes, createdNodes])
  useEffect(() => {
    if (!layoutRequestedRef.current) return
    if (!displayNodes.length) {
      layoutRequestedRef.current = false
      return
    }
    layoutRequestedRef.current = false
    let cancelled = false
    const elk = new ELK()
    elk.layout({
      id: 'combine-graph',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '36',
        'elk.layered.spacing.nodeNodeBetweenLayers': '90',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      },
      children: displayNodes.map(node => ({ id: node.id, width: 196, height: 74 })),
      edges: connections.map(connection => ({ id: connection.id, sources: [connection.source], targets: [connection.target] })),
    }).then(result => {
      if (cancelled || !result.children) return
      const positions = new Map(result.children.map(node => [node.id, { x: Math.max(8, (node.x || 0) + 24), y: Math.max(8, (node.y || 0) + 24) }]))
      setNodes(previous => previous.map(node => positions.has(node.id) ? { ...node, ...positions.get(node.id) } : node))
      setCreatedNodes(previous => previous.map(node => positions.has(node.id) ? { ...node, ...positions.get(node.id) } : node))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [displayNodes, connections])
  const graphWidth = Math.max(760, channels.length * 250, ...displayNodes.map(node => node.x + 230))
  const graphHeight = Math.max(560, ...displayNodes.map(node => node.y + 150))

  const moveNode = (event, node) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { id: node.id, created: node.created, start: { x: event.clientX, y: event.clientY, nodeX: node.x, nodeY: node.y } }
  }
  const dragNode = event => {
    const drag = dragRef.current
    if (!drag) return
    const nextPosition = {
      x: Math.max(8, drag.start.nodeX + (event.clientX - drag.start.x) / graphZoom),
      y: Math.max(8, drag.start.nodeY + (event.clientY - drag.start.y) / graphZoom),
    }
    if (drag.created) {
      setCreatedNodes(previous => previous.map(node => node.id === drag.id ? { ...node, ...nextPosition } : node))
    } else {
      setNodes(previous => previous.map(node => node.id === drag.id ? { ...node, ...nextPosition } : node))
    }
  }
  const finishDrag = event => {
    if (dragRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
  }
  const beginGraphPan = event => {
    const isPanButton = event.button === 1 || event.button === 2 || (event.button === 0 && event.shiftKey)
    if (!isPanButton) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    panRef.current = { startX: event.clientX, startY: event.clientY, pan: graphPan }
  }
  const dragGraphPan = event => {
    if (!panRef.current) return
    setGraphPan({
      x: panRef.current.pan.x + event.clientX - panRef.current.startX,
      y: panRef.current.pan.y + event.clientY - panRef.current.startY,
    })
  }
  const finishGraphPan = event => {
    if (panRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    panRef.current = null
  }
  const graphPoint = event => {
    const bounds = graphRef.current?.getBoundingClientRect()
    if (!bounds) return { x: event.clientX, y: event.clientY }
    return {
      x: (event.clientX - bounds.left + (graphRef.current?.scrollLeft || 0) - graphPan.x) / graphZoom,
      y: (event.clientY - bounds.top + (graphRef.current?.scrollTop || 0) - graphPan.y) / graphZoom,
    }
  }
  const handleGraphWheel = event => {
    event.preventDefault()
    event.stopPropagation()
    const bounds = graphRef.current?.getBoundingClientRect()
    if (!bounds) return
    const cursorX = event.clientX - bounds.left
    const cursorY = event.clientY - bounds.top
    const nextZoom = Math.max(0.35, Math.min(2.5, graphZoom * (event.deltaY < 0 ? 1.1 : 0.9)))
    const graphX = (cursorX - graphPan.x) / graphZoom
    const graphY = (cursorY - graphPan.y) / graphZoom
    setGraphZoom(nextZoom)
    setGraphPan({ x: cursorX - graphX * nextZoom, y: cursorY - graphY * nextZoom })
  }
  const beginConnection = (event, node) => {
    event.preventDefault()
    event.stopPropagation()
    const point = graphPoint(event)
    setConnectionDrag({ sourceId: node.id, x: point.x, y: point.y })
  }
  const dragConnection = event => {
    if (!connectionDrag && !edgeDrag) return
    const point = graphPoint(event)
    setConnectionDrag(previous => previous ? { ...previous, x: point.x, y: point.y } : previous)
    if (edgeDrag) {
      const moved = Math.hypot(point.x - edgeDrag.startX, point.y - edgeDrag.startY) > 4
      if (moved && !edgeDrag.detached) {
        setConnections(previous => previous.filter(item => item.id !== edgeDrag.connectionId))
      }
      setEdgeDrag(previous => previous ? { ...previous, x: point.x, y: point.y, detached: previous.detached || moved } : previous)
    }
  }
  const completeConnection = (event, target) => {
    if (!connectionDrag && !edgeDrag) return
    event.preventDefault()
    event.stopPropagation()
    if (edgeDrag && !edgeDrag.detached) {
      setEdgeDrag(null)
      return
    }
    const sourceId = connectionDrag?.sourceId || edgeDrag?.sourceId
    if (sourceId !== target.id && target.created) {
      const id = `${sourceId}->${target.id}`
      setConnections(previous => previous.some(connection => connection.id === id)
        ? previous
        : [...previous, { id, source: sourceId, target: target.id }])
    }
    setConnectionDrag(null)
    setEdgeDrag(null)
  }
  const beginEdgeDrag = (event, connection) => {
    event.preventDefault()
    event.stopPropagation()
    const point = graphPoint(event)
    setEdgeDrag({ connectionId: connection.id, sourceId: connection.source, x: point.x, y: point.y, startX: point.x, startY: point.y, detached: false })
  }
  const cancelConnection = () => {
    setConnectionDrag(null)
    setEdgeDrag(null)
  }
  const removeNode = nodeId => {
    setCreatedNodes(previous => previous.filter(node => node.id !== nodeId))
    setConnections(previous => previous.filter(connection => connection.source !== nodeId && connection.target !== nodeId))
  }
  const outputSources = outputNodeId => {
    const visited = new Set()
    const visit = nodeId => {
      if (visited.has(nodeId)) return []
      visited.add(nodeId)
      const node = displayNodes.find(candidate => candidate.id === nodeId)
      if (node?.role === 'output') {
        return (node.outputMappings || []).filter(mapping => !mapping.exclude).map(mapping => outputVariantId(node, mapping))
      }
      if (!node || node.type !== 'rule') return [nodeId]
      return connections.filter(connection => connection.target === nodeId).flatMap(connection => visit(connection.source))
    }
    return [...new Set(connections.filter(connection => connection.target === outputNodeId).flatMap(connection => visit(connection.source)))]
  }
  const outputCombinations = sourceIds => {
    const combinations = []
    for (let mask = 1; mask < (1 << sourceIds.length); mask += 1) {
      combinations.push(sourceIds.filter((_, index) => mask & (1 << index)))
    }
    return combinations
  }
  const openOutputTable = node => {
    const sourceIds = outputSources(node.id)
    const existing = node.outputMappings || []
    const existingByKey = new Map(existing.map(mapping => [mapping.sources.slice().sort().join('|'), mapping]))
    const classes = existing.filter(mapping => mapping.label).reduce((result, mapping) => {
      if (!result.some(outputClass => outputClass.name === mapping.label)) result.push({ id: mapping.class_id || `output-class:${node.id}:${mapping.label}`, name: mapping.label, color: mapping.color || CLASS_NODE_DEFAULT_COLOR })
      return result
    }, [])
    const rows = outputCombinations(sourceIds).map(sources => {
      const key = sources.slice().sort().join('|')
      const prior = existingByKey.get(key)
      const outputClass = classes.find(candidate => candidate.name === prior?.label)
      return { id: key, key, sources, classId: prior?.exclude ? NO_OUTPUT_CLASS : (prior?.pass_through ? NO_CHANGE_CLASS : (outputClass?.id || NEW_OUTPUT_CLASS)), label: outputClass?.name || prior?.label || '', color: outputClass?.color || prior?.color || CLASS_NODE_DEFAULT_COLOR }
    })
    setOutputTable({ nodeId: node.id, sourceIds, rows, classes })
  }
  const updateOutputTableRow = (key, field, value) => {
    setOutputTable(previous => previous ? {
      ...previous,
      rows: previous.rows.map(row => {
        if (row.key === key) return { ...row, [field]: value }
        const changedRow = previous.rows.find(candidate => candidate.key === key)
        return field === 'color' && changedRow && changedRow.classId === row.classId && row.classId !== NEW_OUTPUT_CLASS && row.classId !== NO_OUTPUT_CLASS
          ? { ...row, color: value }
          : row
      }),
    } : previous)
  }
  const saveOutputTable = () => {
    if (!outputTable) return
    const classById = new Map((outputTable.classes || []).map(outputClass => [outputClass.id, outputClass]))
    const nextClasses = [...(outputTable.classes || [])]
    const mappings = outputTable.rows.map(({ sources, classId, label, color }) => {
      if (classId === NO_OUTPUT_CLASS) return { sources, exclude: true }
      if (classId === NO_CHANGE_CLASS) return { sources, pass_through: true }
      let outputClass = classById.get(classId)
      if (!outputClass && label.trim()) {
        outputClass = nextClasses.find(candidate => candidate.name === label.trim())
        if (!outputClass) {
          outputClass = { id: `output-class:${Date.now()}:${nextClasses.length}`, name: label.trim(), color }
          nextClasses.push(outputClass)
        }
      }
      if (outputClass) {
        outputClass = { ...outputClass, color }
        classById.set(outputClass.id, outputClass)
        return { sources, class_id: outputClass.id, label: outputClass.name, color: outputClass.color }
      }
      return { sources, label: label.trim(), color }
    })
    setCreatedNodes(previous => previous.map(node => node.id === outputTable.nodeId
      ? { ...node, outputMappings: mappings }
      : node))
    setOutputTable(null)
  }
  const addNode = type => {
    setCreatedNodes(previous => {
      const index = previous.length
      const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${index}`
      const row = index % 3
      const column = Math.floor(index / 3)
      return [...previous, {
        id: `${type === 'rule' ? 'rule' : 'output'}:${id}`, created: true, type, role: type === 'rule' ? 'rule' : 'output', name: type === 'rule' ? 'IoU node' : 'Output', count: 0,
        outputMappings: type === 'class' ? [] : undefined,
        ruleType: 'iou', threshold: 0.25, color: CLASS_NODE_DEFAULT_COLOR, x: 32 + channels.length * 250 + column * 230, y: 32 + row * 116,
      }]
    })
  }
  const updateNodeRule = (nodeId, field, value) => {
    if (field === 'ruleType') {
      setCreatedNodes(previous => previous.map(node => node.id === nodeId ? { ...node, [field]: value } : node))
      return
    }
    const numericValue = Math.max(0, Math.min(1, Number(value)))
    setCreatedNodes(previous => previous.map(node => node.id === nodeId ? { ...node, threshold: Number.isFinite(numericValue) ? numericValue : 0 } : node))
  }
  const selectedImage = images.find(image => image.id === imageId)
  const nodeLabel = node => node.type === 'rule'
    ? `${node.ruleType === 'containment' ? 'Containment' : 'IoU'} node`
    : node.role === 'output' ? 'Output' : node.name
  const openNewRecipe = () => {
    setEditingRecipe(null)
    setRecipeId('')
    setRecipeName('')
    setRecipeSourceType('image')
    setRecipeSourceId(images[0]?.id || '')
    setRecipeModalOpen(true)
  }
  const chooseRecipe = value => {
    const recipe = recipes.find(candidate => candidate.id === value)
    if (!recipe) return
    loadedAnnotationsImageRef.current = ''
    setRecipeId(value)
    setEditingRecipe(recipe)
    setRecipeName(recipe.name)
    setPendingRecipe(recipe)
    setImageId(images[0]?.id || '')
    setAnnotationReloadKey(previous => previous + 1)
  }
  const startRecipe = () => {
    if (!recipeName.trim()) {
      setError('Enter a recipe name.')
      return
    }
    const targetImageId = recipeSourceType === 'set'
      ? imageSets.find(imageSet => imageSet.id === recipeSourceId)?.images?.[0]?.id
      : recipeSourceId
    if (!targetImageId) {
      setError('Choose an image or image set.')
      return
    }
    setError('')
    setEditingRecipe(null)
    setRecipeId('')
    setPendingRecipe(null)
    setCreatedNodes([])
    setConnections([])
    setMergePreview(null)
    setImageId(targetImageId)
    setRecipeModalOpen(false)
  }
  const sourceClassesForRecipe = () => displayNodes
    .filter(node => node.role === 'input')
    .flatMap(node => (node.sublabels?.length ? node.sublabels : ['']).map(label => ({
      channel: node.channel,
      class_name: node.name,
      label,
    })))
  const saveRecipe = async () => {
    if (!recipeName.trim() && !editingRecipe?.name) {
      setError('Enter a recipe name.')
      return
    }
    setPreviewLoading(true)
    setError('')
    const payload = {
      name: recipeName.trim() || editingRecipe.name,
      recipe: buildRecipe(),
      source_classes: sourceClassesForRecipe(),
    }
    try {
      const response = await fetch(editingRecipe ? `${API_BASE_URL}/merge-recipes/${editingRecipe.id}` : `${API_BASE_URL}/merge-recipes`, {
        method: editingRecipe ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not save recipe.')
      setRecipes(previous => editingRecipe ? previous.map(recipe => recipe.id === data.id ? data : recipe) : [...previous, data])
      setRecipeId(data.id)
      setEditingRecipe(data)
      setRecipeName(data.name)
      setMergePreview(null)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setPreviewLoading(false)
    }
  }
  const sourceDisplayName = sourceId => {
    const source = displayNodes.find(node => node.id === sourceId)
    if (!source) {
      for (const node of displayNodes.filter(candidate => candidate.role === 'output')) {
        const mapping = (node.outputMappings || []).find(candidate => outputVariantId(node, candidate) === sourceId)
        if (mapping) return `${nodeLabel(node)}: ${mapping.label}`
      }
      return sourceId
    }
    const label = source.sublabels?.length ? `${source.name} · ${source.sublabels.join(', ')}` : source.name
    return source.channel ? `${source.channel}: ${label}` : label
  }
  const draftOutputClasses = (outputTable?.rows || [])
    .filter(row => row.classId === NEW_OUTPUT_CLASS && row.label.trim())
    .map(row => ({ id: `draft:${row.key}`, name: row.label.trim(), color: row.color }))
  const selectableOutputClasses = [...(outputTable?.classes || []), ...draftOutputClasses.filter(draft => !(outputTable?.classes || []).some(outputClass => outputClass.name === draft.name))]
  const buildRecipe = () => ({
    version: 2,
    nodes: displayNodes.map(node => node.type === 'rule'
      ? { id: node.id, type: 'rule', rule_type: node.ruleType, threshold: node.threshold }
      : { id: node.id, type: 'class', role: node.role, channel: node.channel, label: nodeLabel(node), color: node.color, output_mappings: node.outputMappings || [] }),
    edges: connections.map(connection => ({ source: connection.source, target: connection.target })),
  })
  const formatPreview = data => {
    const layers = (data.layers || []).map((layer, index) => ({
      ...layer,
      color: CHANNEL_COLORS[index % CHANNEL_COLORS.length],
    }))
    return {
      ...data,
      layers,
      id: `merged:${data.image_id}`,
      imageId: data.image_id,
      channelName: 'Merged annotations',
      visible: true,
    }
  }
  const previewRecipeForImage = async targetImageId => {
    const response = await fetch(`${API_BASE_URL}/combine/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ image_id: targetImageId, recipe: buildRecipe() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not preview the recipe.')
      return formatPreview(data)
  }
  const previewMergedAnnotations = async () => {
    if (!imageId) return
    setPreviewLoading(true)
    setError('')
    try {
      setMergePreview(await previewRecipeForImage(imageId))
    } catch (previewError) {
      setError(previewError.message)
    } finally {
      setPreviewLoading(false)
    }
  }
  return (
    <Box sx={{ height: '100%', p: 3, boxSizing: 'border-box', bgcolor: 'background.default', overflow: 'auto' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5">Combine Annotations</Typography>
          <Typography color="text.secondary" variant="body2">Connect loaded classes into user-created nodes to define merge relationships.</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" size="small" onClick={openNewRecipe} disabled={loadingImages || images.length === 0}>New recipe</Button>
          <Box component="button" type="button" onClick={() => addNode('class')} disabled={!imageId} sx={{ px: 1.5, py: 0.75, border: 1, borderColor: CLASS_NODE_DEFAULT_COLOR, borderRadius: 1, bgcolor: 'background.paper', color: 'text.primary', cursor: imageId ? 'pointer' : 'not-allowed' }}>Add output</Box>
          <Box component="button" type="button" onClick={() => addNode('rule')} disabled={!imageId} sx={{ px: 1.5, py: 0.75, border: 1, borderColor: CLASS_NODE_DEFAULT_COLOR, borderRadius: 1, bgcolor: 'background.paper', color: 'text.primary', cursor: imageId ? 'pointer' : 'not-allowed' }}>Add rule</Box>
          <Button variant="outlined" size="small" onClick={previewMergedAnnotations} disabled={!imageId || loadingAnnotations || previewLoading}>{previewLoading ? 'Previewing…' : 'Preview'}</Button>
        </Stack>
        <FormControl size="small" sx={{ minWidth: 280 }} disabled={loadingImages || recipes.length === 0}>
          <InputLabel id="combine-recipe-label">Recipe</InputLabel>
          <Select labelId="combine-recipe-label" label="Recipe" value={recipeId} onChange={event => chooseRecipe(event.target.value)}>
            {recipes.map(recipe => <MenuItem key={recipe.id} value={recipe.id}>{recipe.name}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>
      {loadingImages && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><Typography>Loading images…</Typography></Stack>}
      {error && <Alert severity="info" sx={{ mb: 2 }}>{error}</Alert>}
      {!loadingImages && recipes.length === 0 && !error && <Alert severity="info">No recipes are available yet.</Alert>}
      {loadingAnnotations && <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}><CircularProgress size={18} /><Typography>Loading channel annotations…</Typography></Stack>}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Connect classes directly to relabel them. Connect classes to a rule node to merge with IoU or containment, then choose output classes in the output table.</Typography>
      <Box ref={graphRef} onPointerDown={beginGraphPan} onPointerMove={event => { dragGraphPan(event); dragNode(event); dragConnection(event) }} onPointerUp={event => { finishGraphPan(event); finishDrag(event); cancelConnection() }} onPointerCancel={event => { finishGraphPan(event); finishDrag(event); cancelConnection() }} onWheel={handleGraphWheel} onContextMenu={event => event.preventDefault()}
        sx={{ position: 'relative', width: '100%', height: 560, bgcolor: '#10131b', border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', cursor: panRef.current ? 'grabbing' : 'default' }}>
        <Box sx={{ position: 'absolute', zIndex: 2, top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 0.5, p: 0.5, borderRadius: 1, bgcolor: 'rgba(16, 19, 27, 0.9)', border: 1, borderColor: 'divider' }} onPointerDown={event => event.stopPropagation()}>
          <Box component="button" type="button" aria-label="Zoom out" onClick={() => setGraphZoom(previous => Math.max(0.35, previous * 0.8))} sx={{ width: 28, height: 26, border: 0, borderRadius: 0.5, bgcolor: 'action.hover', color: 'text.primary', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>−</Box>
          <Typography variant="caption" sx={{ minWidth: 42, textAlign: 'center' }}>{Math.round(graphZoom * 100)}%</Typography>
          <Box component="button" type="button" aria-label="Zoom in" onClick={() => setGraphZoom(previous => Math.min(2.5, previous * 1.25))} sx={{ width: 28, height: 26, border: 0, borderRadius: 0.5, bgcolor: 'action.hover', color: 'text.primary', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>+</Box>
          <Box component="button" type="button" aria-label="Reset graph view" onClick={() => { setGraphZoom(1); setGraphPan({ x: 0, y: 0 }) }} sx={{ height: 26, px: 0.75, border: 0, borderRadius: 0.5, bgcolor: 'action.hover', color: 'text.primary', cursor: 'pointer', fontSize: 11 }}>Reset</Box>
        </Box>
        <Box sx={{ position: 'absolute', left: graphPan.x, top: graphPan.y, width: graphWidth, height: graphHeight, transform: `scale(${graphZoom})`, transformOrigin: '0 0' }}>
        {channels.map((channel, index) => <Typography key={channel.id} variant="caption" sx={{ position: 'absolute', top: 8, left: 32 + index * 250, color: CHANNEL_COLORS[index % CHANNEL_COLORS.length], fontWeight: 700 }}>{channelName(channel)}</Typography>)}
        <svg width={graphWidth} height={graphHeight} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
          <defs><marker id="combine-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" /></marker></defs>
          {connections.map(connection => {
            const source = displayNodes.find(node => node.id === connection.source)
            const target = displayNodes.find(node => node.id === connection.target)
            if (!source || !target) return null
            const x1 = source.x + 196
            const y1 = source.y + 24 + 37
            const x2 = target.x
            const y2 = target.y + 24 + 37
            return <line key={connection.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#94a3b8" strokeWidth="2" markerEnd="url(#combine-arrow)" pointerEvents="stroke" onPointerDown={event => beginEdgeDrag(event, connection)} />
          })}
          {(connectionDrag || edgeDrag) && <line x1={(displayNodes.find(node => node.id === (connectionDrag?.sourceId || edgeDrag?.sourceId))?.x || 0) + 196} y1={(displayNodes.find(node => node.id === (connectionDrag?.sourceId || edgeDrag?.sourceId))?.y || 0) + 61} x2={(connectionDrag || edgeDrag).x} y2={(connectionDrag || edgeDrag).y} stroke="#cbd5e1" strokeWidth="2" strokeDasharray="6 4" />}
        </svg>
        {displayNodes.map(node => <Box key={node.id} onPointerDown={event => moveNode(event, node)}
          sx={{ position: 'absolute', left: node.x, top: node.y + 24, width: 196, minHeight: 74, p: 1.25, boxSizing: 'border-box', border: `2px solid ${node.color}`, borderRadius: 1, bgcolor: 'rgba(25, 29, 40, 0.98)', cursor: 'grab', userSelect: 'none', '&:active': { cursor: 'grabbing' } }}>
          {node.created && <Box role="button" tabIndex={0} aria-label="Connect to node" onPointerUp={event => completeConnection(event, node)} sx={{ position: 'absolute', left: -7, top: 31, width: 12, height: 12, borderRadius: '50%', bgcolor: node.color, border: '2px solid #10131b', cursor: 'crosshair' }} />}
          <Box role="button" tabIndex={0} aria-label="Start connection" onPointerDown={event => beginConnection(event, node)} sx={{ position: 'absolute', right: -7, top: 31, width: 12, height: 12, borderRadius: '50%', bgcolor: node.color, border: '2px solid #10131b', cursor: 'crosshair' }} />
          {node.created && <Box component="button" type="button" aria-label={`Delete ${nodeLabel(node)}`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); removeNode(node.id) }} sx={{ position: 'absolute', right: 5, top: 4, width: 20, height: 20, p: 0, border: 0, bgcolor: 'transparent', color: 'text.secondary', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</Box>}
          {node.created
            ? <Typography variant="body2" title={nodeLabel(node)} sx={{ color: node.color, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nodeLabel(node)}</Typography>
            : <Typography variant="body2" title={node.sublabels?.length ? `${node.name} · ${node.sublabels.join(', ')}` : node.name} sx={{ color: node.color, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.sublabels?.length ? `${node.name} · ${node.sublabels.join(', ')}` : node.name}</Typography>}
          {node.created && node.role === 'output' && <Button size="small" variant="outlined" onClick={event => { event.stopPropagation(); openOutputTable(node) }} onPointerDown={event => event.stopPropagation()} sx={{ mt: 0.75, width: '100%', justifyContent: 'flex-start', color: 'text.primary', borderColor: CLASS_NODE_DEFAULT_COLOR, fontSize: 12, py: 0.7, px: 0.75, '&:hover': { borderColor: '#ffffff' } }}>Edit table</Button>}
          {node.created && node.type === 'rule'
            ? <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                <Stack direction="row" spacing={0.75}>
                  <FormControl size="small" sx={{ width: 112 }} onPointerDown={event => event.stopPropagation()}>
                    <InputLabel id={`rule-type-${node.id}`}>Rule</InputLabel>
                    <Select labelId={`rule-type-${node.id}`} label="Rule" value={node.ruleType} onChange={event => updateNodeRule(node.id, 'ruleType', event.target.value)} sx={{ color: 'text.primary', '& .MuiSelect-select': { py: 0.7, px: 0.75, fontSize: 12 } }}>
                      <MenuItem value="iou">IoU</MenuItem>
                      <MenuItem value="containment">Containment</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField size="small" type="number" label="Threshold" value={node.threshold} inputProps={{ min: 0, max: 1, step: 0.01 }} onChange={event => updateNodeRule(node.id, 'threshold', event.target.value)} onPointerDown={event => event.stopPropagation()} sx={{ width: 82, '& input': { py: 0.7, px: 0.5, color: 'text.primary', fontSize: 12 }, '& label': { fontSize: 10 } }} />
                </Stack>
              </Stack>
            : !node.created && <Typography variant="caption" title={`${channelById.get(node.channelId)?.name || ''} · setting ${node.detectionSettingId}`} sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: CHANNEL_COLORS[node.channelIndex % CHANNEL_COLORS.length] }}>{`${channelName(channels[node.channelIndex])} · ${String(node.detectionSettingId).slice(0, 8)} · ${node.count} detections`}</Typography>}
        </Box>)}
        {!loadingAnnotations && imageId && displayNodes.length === 0 && <Typography color="text.secondary" sx={{ p: 3 }}>This image has no labeled annotation classes.</Typography>}
        {!imageId && !loadingImages && <Typography color="text.secondary" sx={{ p: 3 }}>Choose an image to begin.</Typography>}
        </Box>
      </Box>
      <Dialog open={Boolean(outputTable)} onClose={() => setOutputTable(null)} fullWidth maxWidth="md">
        <DialogTitle>{displayNodes.find(node => node.id === outputTable?.nodeId) ? nodeLabel(displayNodes.find(node => node.id === outputTable?.nodeId)) : ''}</DialogTitle>
        <DialogContent dividers>
          <RowMenu
            rows={outputTable?.rows || []}
            onChange={(index, field, value) => {
              const row = outputTable?.rows[index]
              if (!row) return
              if (field === 'classId') {
                const outputClass = selectableOutputClasses.find(candidate => candidate.id === value)
                setOutputTable(previous => previous ? { ...previous, rows: previous.rows.map((item, itemIndex) => itemIndex === index
                  ? { ...item, classId: value, label: outputClass?.name || '', color: outputClass?.color || CLASS_NODE_DEFAULT_COLOR }
                  : item) } : previous)
              } else updateOutputTableRow(row.key, field, value)
            }}
            headers={['Sources', 'Output class', 'Color']}
            gridTemplateColumns="minmax(0, 1fr) minmax(220px, 0.8fr) 44px"
            renderRowTemplate={(row, rowIndex, onChange) => {
              const isNew = row.classId === NEW_OUTPUT_CLASS
              return <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.sources.map(sourceDisplayName).join(' + ')}>
                  {row.sources.map(sourceDisplayName).join(' + ')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.75, minWidth: 220 }}>
                  <Select size="small" value={row.classId} onChange={event => {
                    onChange('classId', event.target.value)
                  }} sx={{ minWidth: 140, flex: 1 }}>
                    {selectableOutputClasses.map(outputClass => <MenuItem key={outputClass.id} value={outputClass.id}>{outputClass.name}</MenuItem>)}
                    <MenuItem value={NEW_OUTPUT_CLASS}>Define new class</MenuItem>
                    <MenuItem value={NO_OUTPUT_CLASS}>No output</MenuItem>
                    <MenuItem value={NO_CHANGE_CLASS}>Keep original</MenuItem>
                  </Select>
                  {isNew && <TextField size="small" placeholder="Class name" value={row.label} onChange={event => updateOutputTableRow(row.key, 'label', event.target.value)} />}
                </Box>
                <Box component="input" type="color" aria-label="Output color" value={row.color} onChange={event => onChange('color', event.target.value)} sx={{ width: 36, height: 32, p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }} />
              </Stack>
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOutputTable(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveOutputTable}>Save</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={recipeModalOpen} onClose={() => setRecipeModalOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New recipe</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Name" value={recipeName} onChange={event => setRecipeName(event.target.value)} autoFocus />
            <FormControl fullWidth size="small">
              <InputLabel id="recipe-source-type-label">Source</InputLabel>
              <Select labelId="recipe-source-type-label" label="Source" value={recipeSourceType} onChange={event => {
                const type = event.target.value
                setRecipeSourceType(type)
                setRecipeSourceId(type === 'image' ? (images[0]?.id || '') : (imageSets[0]?.id || ''))
              }}>
                <MenuItem value="image">Image</MenuItem>
                <MenuItem value="set">Image set</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel id="recipe-source-label">{recipeSourceType === 'image' ? 'Image' : 'Image set'}</InputLabel>
              <Select labelId="recipe-source-label" label={recipeSourceType === 'image' ? 'Image' : 'Image set'} value={recipeSourceId} onChange={event => setRecipeSourceId(event.target.value)}>
                {(recipeSourceType === 'image' ? images : imageSets).map(source => <MenuItem key={source.id} value={source.id}>{source.name || source.id}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRecipeModalOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={startRecipe}>Create</Button>
        </DialogActions>
      </Dialog>
      {selectedImage && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{selectedImage.name} · {channels.length} channel{channels.length === 1 ? '' : 's'} · {displayNodes.length} node{displayNodes.length === 1 ? '' : 's'} · {connections.length} connection{connections.length === 1 ? '' : 's'}</Typography>}
      <MergePreviewModal
        preview={mergePreview}
        onClose={() => setMergePreview(null)}
        onSave={saveRecipe}
      />
    </Box>
  )
}
