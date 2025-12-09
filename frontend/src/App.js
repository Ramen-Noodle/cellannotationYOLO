import { useState, Fragment } from 'react'
import { Box, Button, Typography } from '@mui/material'
import PopupState, { bindTrigger, bindMenu } from 'material-ui-popup-state';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import SideMenu from './components/SideMenu'
import ImageCanvas from './components/ImageCanvas'
import TabMenu from './components/TabMenu'
import ColorMenu from './components/ColorMenu';

function App() {
  const [imageURL, setImageURL] = useState('')
  const [imageName, setImageName] = useState('')
  const [imageSize, setImageSize] = useState({width: 0, height: 0})
  const [annotations, setAnnotations] = useState([])
  const [isCropping, setIsCropping] = useState(false)
  const [classes, setClasses] = useState([
    { name: 'SGN', color: '#c600b9ff' },
    { name: 'Yellow Neuron', color: '#FFC300' },
    { name: 'Yellow Astrocyte', color: '#767600ff' },
    { name: 'Green Neuron', color: '#2ECC71' },
    { name: 'Green Astrocyte', color: '#003b1936' },
    { name: 'Red Neuron', color: '#C0392B' },
    { name: 'Red Astrocyte', color: '#4c0800ff' },
    { name: 'CD3', color: '#600089ff' },
  ]);
  const [currentClass, setCurrentClass] = useState(0)

  // *----------* Image Operations *----------* \\

  async function handleUpload(e) {
    const file = e.target.files[0]
    e.target.value = null;
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
        
    } catch(e) {
      alert('Crop failed: ' + (e.response?.data?.error || e.message));
    }

    setIsCropping(false)
  }

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
      const updated = [...prevClasses];
      updated[index] = { ...updated[index], color: newColor };
      return updated;
    });
  };

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
        
      return `${ann.class} ${centerX.toFixed(6)} ${centerY.toFixed(6)} ${width.toFixed(6)} ${height.toFixed(6)}`;
    }).join('\n');

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
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        return response.blob(); // Convert the response stream to a Blob
      })
      .then((blob) => {
        // Ensure the blob has the correct type
        const zipBlob = new Blob([blob], { type: 'application/zip' });
        
        // Create download link
        const downloadUrl = window.URL.createObjectURL(zipBlob);
        const link = document.createElement('a');

        link.href = downloadUrl;
        link.setAttribute('download', `${imageName}_export.zip`);
        document.body.appendChild(link);
        link.click();

        // Cleanup
        window.URL.revokeObjectURL(downloadUrl);
        link.remove();
      })
      .catch((error) => {
        console.error('Export error:', error);
        alert(`Export failed: ${error.message}`);
      });
  }

  function importAnnotations(e) {
    const file = e.target.files[0]
    e.target.value = null;
    console.log(file)
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.txt')) {
      alert('Only .txt files are accepted.')
      e.target.value = ''
      return
    }

    const reader = new FileReader();
    
    reader.onload = e => {

      const yoloData = e.target.result;
      const lines = yoloData.split('\n');

      setAnnotations([])
      let importedCount = 0;
      const imageWidth = imageSize.width;
      const imageHeight = imageSize.height;

      lines.forEach(line => {
        if (!line.trim()) return;
        const parts = line.trim().split(/\s+/);
        
        // Handle both formats: with and without confidence score
        if (parts.length !== 5 && parts.length !== 6) return;
        
        const classId = parseInt(parts[0]);
        const centerX = parseFloat(parts[1]) * imageWidth;
        const centerY = parseFloat(parts[2]) * imageHeight;
        const width = parseFloat(parts[3]) * imageWidth;
        const height = parseFloat(parts[4]) * imageHeight;
        
        // Convert to top-left coordinates
        const x = centerX - width / 2;
        const y = centerY - height / 2;

        handleAddBox({x: x, y: y, w: width, h: height, class: classId}) //TODO add isDetected

        importedCount++;
      });

      alert(`Imported ${importedCount} annotations!`);
    }

    reader.readAsText(file);
  }

  // *----------* Detection Operations *----------* \\

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
        });

        alert(`Detected ${importedCount} MADM objects!`);
      } catch (e) {
        alert('Detection failed: ' + (e.response?.data?.error || e.message));
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
          currentClass={currentClass} classes={classes} imageSize={imageSize}/>
      </Box>
    </Box>
  )
}

export default App
