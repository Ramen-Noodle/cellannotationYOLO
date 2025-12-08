import { useEffect, useState, Fragment } from 'react'
import { Box, Button, Typography } from '@mui/material'
import PopupState, { bindTrigger, bindMenu } from 'material-ui-popup-state';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import SideMenu from './components/SideMenu'
import ImageCanvas from './components/ImageCanvas'
import TabMenu from './components/TabMenu'

function App() {
  const [msg, setMsg] = useState('')
  const [imageURL, setImageURL] = useState('')
  const [imageName, setImageName] = useState('')
  const [boxes, setBoxes] = useState([])
  const [isCropping, setIsCropping] = useState(false)
  const [currentClass, setCurrentClass] = useState("SGN");

  useEffect(() => {
    fetch('/api/hello')
      .then(res => res.json())
      .then(data => setMsg(data.message))
  }, [])

  function showMeTheBoxes() {
    console.log(boxes)
  }

  // Image Operations

  async function handleUpload(e) {
    const file = e.target.files[0]
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
        setBoxes([])
    } catch(e) {
      alert('Upload failed: ' + (e.response?.data?.error || e.message));
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
        
    } catch {
      //TODO add error message
    }

    setIsCropping(false)
  }

  // Annotation Operations

  const handleAddBox = (box) => {
    if (imageURL) {
      setBoxes(prev => [...prev, box])
    }
  }

  const handleRemoveBox = (box) => {
    setBoxes(prev => prev.filter(b => b !== box))
  }

  // Detection Operations

  async function detectMADM() {
    const threshold = .5

    try {
        const res = await fetch('/detect-madm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ threshold }),
          credentials: 'include',
        })

        if (!res.ok) throw new Error('MADM detection failed')
        const data = await res.json()
        
        const yoloTxt = data.annotations
        const imgWidth = data.image_width
        const imgHeight = data.image_height

        setBoxes([])
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

            handleAddBox({x: x1, y: y1, w: w, h: h})

            // state.annotations.push({
            //     x: x1,
            //     y: y1,
            //     width: w,
            //     height: h,
            //     class: cls,
            //     isDetected: true
            // });
            importedCount++
        });
    } catch {

    }
  }

  // Tab Menu contents
  const tabs = [
		{
			label: "Annotate",
			content: (
        <Box>
          <PopupState variant="popover" popupId="demo-popup-menu">
            {(popupState) => (
              <Fragment>
                <Button variant="contained" {...bindTrigger(popupState)} endIcon={<KeyboardArrowDownIcon />}>
                  {currentClass}
                </Button>
                <Menu {...bindMenu(popupState)}>
                  <MenuItem onClick={() => {popupState.close(); setCurrentClass("SGN")}}>SGN</MenuItem>
                  <MenuItem onClick={() => {popupState.close(); setCurrentClass("Yellow Neuron")}}>Yellow Neuron</MenuItem>
                  <MenuItem onClick={() => {popupState.close(); setCurrentClass("Yellow Astrocyte")}}>Yellow Astrocyte</MenuItem>
                  <MenuItem onClick={() => {popupState.close(); setCurrentClass("Green Neuron")}}>Green Neuron</MenuItem>
                  <MenuItem onClick={() => {popupState.close(); setCurrentClass("Green Astrocyte")}}>Green Astrocyte</MenuItem>
                  <MenuItem onClick={() => {popupState.close(); setCurrentClass("Red Neuron")}}>Red Neuron</MenuItem>
                  <MenuItem onClick={() => {popupState.close(); setCurrentClass("Ren Astrocyte")}}>Red Astrocyte</MenuItem>
                  <MenuItem onClick={() => {popupState.close(); setCurrentClass("CD3")}}>CD3</MenuItem>
                </Menu>
              </Fragment>
            )}
          </PopupState>
          <PopupState variant="popover" popupId="demo-popup-menu">
            {(popupState) => (
              <Fragment>
                <Button variant="contained" {...bindTrigger(popupState)}>
                  Class Colors
                </Button>
                <Menu {...bindMenu(popupState)}>
                  <MenuItem onClick={popupState.close}>SGN</MenuItem>
                  <MenuItem onClick={popupState.close}>Yellow Neuron</MenuItem>
                  <MenuItem onClick={popupState.close}>Yellow Astrocyte</MenuItem>
                  <MenuItem onClick={popupState.close}>Green Neuron</MenuItem>
                  <MenuItem onClick={popupState.close}>Green Astrocyte</MenuItem>
                  <MenuItem onClick={popupState.close}>Red Neuron</MenuItem>
                  <MenuItem onClick={popupState.close}>Red Astrocyte</MenuItem>
                  <MenuItem onClick={popupState.close}>CD3</MenuItem>
                </Menu>
              </Fragment>
            )}
          </PopupState>
        </Box>
			),
		},
		{
			label: "Detect",
			content: (
        <Box>
          <Button variant='contained' component='label' onClick={detectMADM}>
            Detect
          </Button>
        </Box>
      )
		}
	];

  return (
    <Box sx={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <SideMenu>
        <Button variant='contained' component='label'>
          Load Image
          <input hidden type='file' accept='image/tiff' onChange={handleUpload} />
        </Button>
        <Button variant='contained' component='label' onClick={toggleCrop} color={isCropping ? 'secondary' : 'primary'}>
          Crop Image
        </Button>
        <Button variant='contained' component='label' onClick={showMeTheBoxes}>
          Show me the boxes
        </Button>
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
        <ImageCanvas src={imageURL} boxes={boxes} onAddBox={handleAddBox} 
          onRemoveBox={handleRemoveBox} isCropping={isCropping} onCrop={handleCrop}/>
      </Box>
    </Box>
  )
}

export default App
