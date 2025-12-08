import { useEffect, useState } from 'react'
import { Box, Button } from '@mui/material'
import SideMenu from './components/SideMenu'
import ImageCanvas from './components/ImageCanvas'

function App() {
  const [msg, setMsg] = useState('')
  const [imageURL, setImageURL] = useState('')
  const [imageName, setImageName] = useState('')
  const [boxes, setBoxes] = useState([])
  const [isCropping, setIsCropping] = useState(false)

  useEffect(() => {
    fetch('/api/hello')
      .then(res => res.json())
      .then(data => setMsg(data.message))
  }, [])

  function showMeTheBoxes() {
    console.log(boxes)
  }

  function toggleCrop() {
    if (isCropping) {
      setIsCropping(false)
    } else {
      setIsCropping(true)
    }
  }

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
    } catch {
      // TODO: Add catch error message
    }
  }

  const handleAddBox = (box) => {
    if (imageURL) {
      setBoxes(prev => [...prev, box])
    }
  }

  const handleRemoveBox = (box) => {
    setBoxes(prev => prev.filter(b => b !== box))
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

    }

    setIsCropping(false)
  }

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
