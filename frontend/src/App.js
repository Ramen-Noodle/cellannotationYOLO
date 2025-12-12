import { useState, Fragment } from 'react'
import { Box, Button, Typography } from '@mui/material'
import PopupState, { bindTrigger, bindMenu } from 'material-ui-popup-state'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField';

import SideMenu from './components/SideMenu'
import ImageCanvas from './components/ImageCanvas'
import TabMenu from './components/TabMenu'
import ColorMenu from './components/ColorMenu'
import AdjustableSlider from './components/AdjustableSlider'

function App() {
  // State for image operations
  const [imageURL, setImageURL] = useState('')
  const [imageName, setImageName] = useState('')
  const [imageSize, setImageSize] = useState({width: 0, height: 0})
  const [isCropping, setIsCropping] = useState(false)
  const [brightness, setBrightness] = useState(0)
  const [bMin, setBMin] = useState(-100)
  const [bMax, setBMax] = useState(100)
  const [contrast, setContrast] = useState(0)
  const [cMin, setCMin] = useState(-100)
  const [cMax, setCMax] = useState(100)

  // Steate for annotations
  const [annotations, setAnnotations] = useState([])
  const [classes, setClasses] = useState([
    { name: 'SGN', color: '#c600b9ff' },
    { name: 'Yellow Neuron', color: '#FFC300' },
    { name: 'Yellow Astrocyte', color: '#767600ff' },
    { name: 'Green Neuron', color: '#2ECC71' },
    { name: 'Green Astrocyte', color: '#003b1936' },
    { name: 'Red Neuron', color: '#C0392B' },
    { name: 'Red Astrocyte', color: '#4c0800ff' },
    { name: 'CD3', color: '#600089ff' },
  ])
  const [currentClass, setCurrentClass] = useState(0)

  // State for model detection
  const [models, setModels] = useState(['SGN', 'CD3', 'MADM'])
  const [currentModel, setCurrentModel] = useState(0)
  const [threshold, setThreshold] = useState(.5)

  
  // *----------* Image Operations *----------* \\

  async function handleUpload(e) {
    const file = e.target.files[0]
    e.target.value = null
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.tiff') && !file.name.toLowerCase().endsWith('.tif')) {
        alert('Only .tiff and .tif files are accepted.')
        e.target.value = ''
        return
    }

    setImageName(file.name)

    const formData = new FormData()
    formData.append('file', file)

    try {
        const res = await fetch('/upload', {
          method: 'POST',
          body: formData,
        })

        if (!res.ok) throw new Error('Upload failed')
        const data = await res.json()
        setImageURL(data.converted_url)
        setImageSize({width: data.dimensions[0], height: data.dimensions[1]})
        setAnnotations([])
    } catch(e) {
      alert('Upload failed: ' + (e.response?.data?.error || e.message))
    }
  }

  function handleSave() {
    const img = new Image()
    img.src = imageURL

    img.onload = () => {
      const tempCanvas = document.createElement('canvas');
      const ctx = tempCanvas.getContext('2d');

      tempCanvas.width = imageSize.width
      tempCanvas.height = imageSize.height

      ctx.filter = `brightness(${100 + +brightness}%) contrast(${100 + +contrast}%)`

      ctx.drawImage(img, 0, 0)

      ctx.lineWidth = 2

      annotations.forEach((a) => {
        ctx.strokeStyle = classes[a.class].color
        ctx.strokeRect(a.x, a.y, a.w, a.h)
      })

      const link = document.createElement('a');
      link.download = `annotated_${imageName.substring(0, imageName.lastIndexOf('.')) || imageName}.png`;
      link.href = tempCanvas.toDataURL('image/png');
      link.click();
    }
  }

  function toggleCrop() {
    if (isCropping) {
      setIsCropping(false)
    } else {
      setIsCropping(true)
    }
  }

  async function handleCrop(box) {
    const formData = new FormData()
    formData.append('original_filename', `${imageName}`)
    formData.append('x', Math.round(box.x))
    formData.append('y', Math.round(box.y))
    formData.append('width', Math.round(box.w))
    formData.append('height', Math.round(box.h))

    try {
        const res = await fetch('/upload-cropped', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        })

        if (!res.ok) throw new Error('Crop failed')
        const data = await res.json()
        setImageURL(data.converted_url)
        
    } catch(e) {
      alert('Crop failed: ' + (e.response?.data?.error || e.message))
    }

    setIsCropping(false)
  }

  // const handleBrightnessChange = (event, newValue) => {
  //   setBrightness(newValue)
  // }

  // const handleContrastChange = (event, newValue) => {
  //   setContrast(newValue)
  // }

  // *----------* Annotation Operations *----------* \\

  const handleAddBox = (box) => {
    if (!box.class) {
      box.class = currentClass
    }
    if (imageURL) {
      setAnnotations(prev => [...prev, box])
    }
  }

  const handleRemoveBox = (box) => {
    setAnnotations(prev => prev.filter(b => b !== box))
  }

  const handleColorUpdate = (index, newColor) => {
    setClasses((prevClasses) => {
      // Create a copy of the array to maintain immutability
      const updated = [...prevClasses]
      updated[index] = { ...updated[index], color: newColor }
      return updated
    })
  }

  function clearAnnotations() {
    setAnnotations([])
  }

  async function exportAnnotations() {
    const filename = imageName
    const imageWidth = imageSize.width
    const imageHeight = imageSize.height
    const yoloData = annotations.map(ann => {
      // Convert to normalized center coordinates
      const centerX = (ann.x + ann.w / 2) / imageWidth
      const centerY = (ann.y + ann.h / 2) / imageHeight
      const width = ann.w / imageWidth
      const height = ann.h / imageHeight
        
      return `${ann.class} ${centerX.toFixed(6)} ${centerY.toFixed(6)} ${width.toFixed(6)} ${height.toFixed(6)}`
    }).join('\n')

    fetch('/export-annotations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // 'include' is the fetch equivalent of axios 'withCredentials: true'
      credentials: 'include', 
      body: JSON.stringify({
        yolo_data: yoloData,
        original_filename: filename,
      }),
    })
      .then(async (response) => {
        // Fetch does not throw on HTTP errors automatically
        if (!response.ok) {
          // Try to parse JSON error response, fallback to generic status text
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
        }
        return response.blob() // Convert the response stream to a Blob
      })
      .then((blob) => {
        // Ensure the blob has the correct type
        const zipBlob = new Blob([blob], { type: 'application/zip' })
        
        // Create download link
        const downloadUrl = window.URL.createObjectURL(zipBlob)
        const link = document.createElement('a')

        link.href = downloadUrl
        link.setAttribute('download', `${imageName}_export.zip`)
        document.body.appendChild(link)
        link.click()

        // Cleanup
        window.URL.revokeObjectURL(downloadUrl)
        link.remove()
      })
      .catch((error) => {
        console.error('Export error:', error)
        alert(`Export failed: ${error.message}`)
      })
  }

  function importAnnotations(e) {
    const file = e.target.files[0]
    e.target.value = null
    console.log(file)
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.txt')) {
      alert('Only .txt files are accepted.')
      e.target.value = ''
      return
    }

    const reader = new FileReader()
    
    reader.onload = e => {

      const yoloData = e.target.result
      const lines = yoloData.split('\n')

      setAnnotations([])
      let importedCount = 0
      const imageWidth = imageSize.width
      const imageHeight = imageSize.height

      lines.forEach(line => {
        if (!line.trim()) return
        const parts = line.trim().split(/\s+/)
        
        // Handle both formats: with and without confidence score
        if (parts.length !== 5 && parts.length !== 6) return
        
        const classId = parseInt(parts[0])
        const centerX = parseFloat(parts[1]) * imageWidth
        const centerY = parseFloat(parts[2]) * imageHeight
        const width = parseFloat(parts[3]) * imageWidth
        const height = parseFloat(parts[4]) * imageHeight
        
        // Convert to top-left coordinates
        const x = centerX - width / 2
        const y = centerY - height / 2

        handleAddBox({x: x, y: y, w: width, h: height, class: classId}) //TODO add isDetected

        importedCount++
      })

      alert(`Imported ${importedCount} annotations!`)
    }

    reader.readAsText(file)
  }

  // *----------* Detection Operations *----------* \\

  async function detect() {

    console.log(currentModel)

    let endpoint = ''

    if (currentModel === 0) {
      endpoint = '/detect-sgn'
    } else if (currentModel === 1) {
      endpoint = '/detect-cd3'
    } else if (currentModel === 2) {
      endpoint = '/detect-madm'
    } else {
      console.log('Invalid Model Selection')
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ threshold }),
        credentials: 'include',
      })

      if (!res.ok) throw new Error(`${models[currentModel]} detection failed`)
      const data = await res.json()
      
      const yoloTxt = data.annotations
      const imgWidth = data.image_width
      const imgHeight = data.image_height

      setAnnotations([])
      let importedCount = 0

      yoloTxt.split('\n').forEach(line => {
        if (!line.trim()) return
        const [clsStr, cxStr, cyStr, wStr, hStr] = line.trim().split(' ')
        const cls = parseInt(clsStr)
        const cx = parseFloat(cxStr) * imgWidth
        const cy = parseFloat(cyStr) * imgHeight
        const w = parseFloat(wStr) * imgWidth
        const h = parseFloat(hStr) * imgHeight
        const x1 = cx - w / 2
        const y1 = cy - h / 2

        handleAddBox({x: x1, y: y1, w: w, h: h, class: cls}) //TODO add isDetected

        importedCount++
      })

      alert(`Detected ${importedCount} ${models[currentModel]} objects!`)
    } catch (e) {
      alert('Detection failed: ' + (e.response?.data?.error || e.message))
    }
  }

  // Tab Menu contents
  const tabs = [
		{
			label: "Annotate",
			content: (
        <Box>
          <PopupState variant="popover" popupId="class-popup-menu">
            {(popupState) => (
              <Fragment>
                <Button variant="contained" {...bindTrigger(popupState)} endIcon={<KeyboardArrowDownIcon />}>
                  {classes[currentClass].name}
                </Button>
                <Menu {...bindMenu(popupState)}>
                  {classes.map((item, index) => (
                    <MenuItem 
                      key={index}
                      onClick={() => {setCurrentClass(index)}}
                    >
                        <Typography variant="body1">{item.name}</Typography>
                    </MenuItem>
                  ))}
                </Menu>
              </Fragment>
            )}
          </PopupState>
          <ColorMenu 
            items={classes} 
            onChange={handleColorUpdate} 
          />
          <Button variant='contained' component='label' onClick={clearAnnotations} color={'warning'}>
            Clear Annotations
          </Button>
          <Button variant='contained' component='label' onClick={exportAnnotations}>
            Export Annotations
          </Button>
          <Button variant='contained' component='label'>
            Import Annotations
            <input hidden type='file' accept='txt' onChange={importAnnotations} />
          </Button>
        </Box>
			),
		},
		{
			label: "Detect",
			content: (
        <Box>
          <PopupState variant="popover" popupId="model-popup-menu">
            {(popupState) => (
              <Fragment>
                <Button variant="contained" {...bindTrigger(popupState)} endIcon={<KeyboardArrowDownIcon />}>
                  {models[currentModel]}
                </Button>
                <Menu {...bindMenu(popupState)}>
                  {models.map((item, index) => (
                    <MenuItem 
                      key={index}
                      onClick={() => {setCurrentModel(index)}}
                    >
                        <Typography variant="body1">{item}</Typography>
                    </MenuItem>
                  ))}
                </Menu>
              </Fragment>
            )}
          </PopupState>
          <Button variant='contained' component='label' onClick={detect}>
            Detect
          </Button>
          <TextField
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            type="number"
            variant="outlined"
            size="small"
            slotProps={{ 
              htmlInput: {
                step: 0.1,
                min: 0,
                max: 1
              }
            }}
          />
        </Box>
      )
		}
	]

  return (
    <Box sx={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <SideMenu>
        <Button variant='contained' component='label'>
          Load Image
          <input hidden type='file' accept='image/tiff' onChange={handleUpload} />
        </Button>
        <Button variant='contained' component='label' onClick={handleSave}>
          Save Image
        </Button>
        <Button variant='contained' component='label' onClick={toggleCrop} color={isCropping ? 'secondary' : 'primary'}>
          Crop Image
        </Button>

        <Stack spacing={2} sx={{ width: '100%' }}>
          <AdjustableSlider
            label="Brightness"
            value={brightness}
            onChange={(e, val) => setBrightness(val)}
            min={bMin}
            setMin={setBMin}
            max={bMax}
            setMax={setBMax}
          />
          <AdjustableSlider
            label="Contrast"
            value={contrast}
            onChange={(e, val) => setContrast(val)}
            min={cMin}
            setMin={setCMin}
            max={cMax}
            setMax={setCMax}
          />
        </Stack>

        <TabMenu items={tabs}></TabMenu>
      </SideMenu>

      <Box
				sx={{
					flexGrow: 1,
					display: 'flex',
					justifyContent: 'center',
					bgcolor: '#111',
				}}
			>
        <ImageCanvas src={imageURL} boxes={annotations} onAddBox={handleAddBox} 
          onRemoveBox={handleRemoveBox} isCropping={isCropping} onCrop={handleCrop}
          currentClass={currentClass} classes={classes} imageSize={imageSize}
          brightness={brightness} contrast={contrast}/>
      </Box>
    </Box>
  )
}

export default App
