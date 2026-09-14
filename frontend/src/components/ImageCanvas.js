import { rgbToHex } from '@mui/material'
import { useRef, useState, useEffect } from 'react'

const TILE_SIZE = 2048
const LARGE_IMAGE_THRESHOLD = 16000
const MAX_VISIBLE_TILES = 36

export default function ImageCanvas({ src, boxes, onAddBox, onRemoveBox, isCropping,
    onCrop, currentClass, classes, imageSize, brightness, contrast, scale, onScaleChange, showLabels = true, currentSet }) {
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const tilesRef = useRef({})

  // pan + zoom state
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [lastPan, setLastPan] = useState({ x: 0, y: 0 })

  const [boundaries, setboundaries] = useState({
    xMin: 0,
    xMax: 0,
    yMin: 0,
    yMax: 0
  })

  const [isNewImage, setIsNewImage] = useState(true)
  const [imageLoaded, setImageLoaded] = useState(false)

  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight
  })

  // box drawing state
  const [currentBox, setCurrentBox] = useState(null)
  const [canDraw, setCanDraw] = useState(false)
  const [tileVersion, setTileVersion] = useState(0)

  const isTiled = imageSize && (imageSize.width > LARGE_IMAGE_THRESHOLD || imageSize.height > LARGE_IMAGE_THRESHOLD)

  // load image
  useEffect(() => {
    tilesRef.current = {}
    imgRef.current = null
    setImageLoaded(false)

    if (!src) return

    if (isTiled) {
      if (isNewImage) {
        setboundaries({ xMin: 0, xMax: imageSize.width, yMin: 0, yMax: imageSize.height })
      }
      setIsNewImage(true)
      setImageLoaded(true)
      return
    }

    const img = new Image()
    img.onload = () => {
      console.log('naturalWidth:', img.naturalWidth)
      console.log('naturalHeight:', img.naturalHeight)
      console.log('complete:', img.complete)
      imgRef.current = img
      if (isNewImage) {
        setboundaries({xMin: 0, xMax: img.width, yMin: 0, yMax: img.height})
      }
      setIsNewImage(true)
      setImageLoaded(true)
    }

    img.onerror = () => {
      console.error('Failed to load image:', src)
      alert('Image failed to load. The file may be too large for the browser to render.')
    }

    img.src = src
  }, [src])

  // Track window size for rendering
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight
      })
    }
    
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // draw loop
  useEffect(() => {
    draw()
  }, [scale, offset, boxes, currentBox, classes, brightness, contrast, windowSize, imageLoaded, tileVersion, showLabels])

  const getLabelTextColor = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return luminance > 160 ? 'black' : 'white'
  }

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // apply pan + zoom
    ctx.save()
    ctx.translate(offset.x, offset.y)
    ctx.scale(scale, scale)

    // apply filters
    ctx.filter = `brightness(${100 + +brightness}%) contrast(${100 + +contrast}%)`

    if (isTiled) {
      const visX0 = Math.max(0, -offset.x / scale)
      const visY0 = Math.max(0, -offset.y / scale)
      const visX1 = Math.min(imageSize.width, (canvas.width - offset.x) / scale)
      const visY1 = Math.min(imageSize.height, (canvas.height - offset.y) / scale)

      const txMin = Math.floor(visX0 / TILE_SIZE)
      const txMax = Math.ceil(visX1 / TILE_SIZE)
      const tyMin = Math.floor(visY0 / TILE_SIZE)
      const tyMax = Math.ceil(visY1 / TILE_SIZE)
      const tileCount = (txMax - txMin) * (tyMax - tyMin)

      if (tileCount > MAX_VISIBLE_TILES) {
        ctx.restore()
        ctx.fillStyle = 'white'
        ctx.font = '20px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('Zoom in to view image', canvas.width / 2, canvas.height / 2)
        return
      }

      const filename = src.split('/').pop()

      for (let ty = tyMin; ty < tyMax; ty++) {
        for (let tx = txMin; tx < txMax; tx++) {
          const key = `${tx}_${ty}`
          const cached = tilesRef.current[key]
          if (!cached) {
            tilesRef.current[key] = 'loading'
            const img = new Image()
            img.onload = () => {
              tilesRef.current[key] = img
              setTileVersion(v => v + 1)
            }
            img.onerror = () => { tilesRef.current[key] = 'error' }
            const baseURL = src ? new URL(src).origin : ''
            img.src = `${baseURL}/tile/${filename}/${tx}/${ty}/${TILE_SIZE}`
          } else if (cached !== 'loading' && cached !== 'error') {
            ctx.drawImage(cached, tx * TILE_SIZE, ty * TILE_SIZE)
          }
        }
      }
    } else {
      if (!imgRef.current) {
        ctx.restore()
        return
      }
      ctx.drawImage(imgRef.current, 0, 0)
    }

    ctx.filter = 'none'
    // draw existing boxes
    ctx.lineWidth = 2 / scale // scale-independent line width

    const fontSize = 11 / scale
    ctx.font = `${fontSize}px sans-serif`
    boxes.forEach((box) => {
      const style = box.renderStyle || 'solid'

      if (style === 'invisible') {
        return
      }
      // Configure canvas dash line definitions
      if (style === 'dashed') {
        // Line length of 6 pixels, gap of 4 pixels (scaled dynamically)
        ctx.setLineDash([6 / scale, 4 / scale])
      } else if (style === 'dotted') {
        // Line length of 2 pixels, gap of 2 pixels (scaled dynamically)
        ctx.setLineDash([2 / scale, 2 / scale])
      } else {
        // 'solid' style resets configuration back to a default unbroken line
        ctx.setLineDash([])
      }

      const color = box.color
      ctx.strokeStyle = color
      ctx.strokeRect(box.x, box.y, box.w, box.h)

      ctx.setLineDash([])

      if (showLabels) {
        const label = box.confidence != null
          ? `${box.name} ${(box.confidence * 100).toFixed(0)}%${box.sublabel ? ` - ${box.sublabel}` : ''}`
          : `${box.name}${box.sublabel ? ` - ${box.sublabel}` : ''}`
        const padding = 2 / scale
        const textWidth = ctx.measureText(label).width
        const labelH = fontSize + padding * 2
        const labelY = box.y - labelH > 0 ? box.y - labelH : box.y

        ctx.fillStyle = color
        ctx.fillRect(box.x, labelY, textWidth + padding * 2, labelH)
        ctx.fillStyle = getLabelTextColor(color)
        ctx.fillText(label, box.x + padding, labelY + fontSize)
      }
    })

    ctx.setLineDash([])
    
    // draw box while dragging
    if (currentBox) {
      ctx.strokeStyle = classes[currentSet][currentClass].color
      ctx.strokeRect(currentBox.x, currentBox.y, currentBox.w, currentBox.h)
    }

    ctx.restore()
  }

  // convert screen coords → image coords
  const screenToImage = (x, y) => {
    return {
      x: (x - offset.x) / scale,
      y: (y - offset.y) / scale,
    }
  }

  const handleMouseDown = (e) => {
    if (e.button === 1 || e.button === 2) {
      // middle or right-click → pan
      setIsPanning(true)
      setLastPan({ x: e.clientX, y: e.clientY })
      return
    }

    // left click → draw box
    const rect = canvasRef.current.getBoundingClientRect()
    const { x, y } = screenToImage(
      e.clientX - rect.left,
      e.clientY - rect.top
    )

    if (!canDraw) return

		if (e.shiftKey) {
			const hit = boxes.find(b =>
   			x >= b.x &&
				x <= b.x + b.w &&
				y >= b.y &&
				y <= b.y + b.h
			)
			if (hit) {
				onRemoveBox(hit)
			}

			return
		}

    setCurrentBox({ x, y, w: 0, h: 0 })
  }

  const handleMouseMove = (e) => {
    if (isPanning) {
      const dx = e.clientX - lastPan.x
      const dy = e.clientY - lastPan.y

      setOffset((o) => ({ x: o.x + dx, y: o.y + dy }))
      setLastPan({ x: e.clientX, y: e.clientY })
      return
    }

    const rect = canvasRef.current.getBoundingClientRect()
    let x, y
    ({ x, y } = screenToImage(
      e.clientX - rect.left,
      e.clientY - rect.top
    ));

    if (x < boundaries.xMin || x > boundaries.xMax || y < boundaries.yMin || y > boundaries.yMax) {
      setCanDraw(false)
    } else {
      setCanDraw(true)
    }

    if (currentBox) {
      // Don't allow user to draw outside of the image
      if (x < boundaries.xMin) {
        x = boundaries.xMin
      } else if (x > boundaries.xMax) {
        x = boundaries.xMax
      }

      if (y < boundaries.yMin) {
        y = boundaries.yMin
      } else if (y > boundaries.yMax) {
        y = boundaries.yMax
      }

      setCurrentBox((b) => ({
        ...b,
        w: x - b.x,
        h: y - b.y,
      }))
    }
  }

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false)
      return
    }
    if (currentBox) {
      if (currentBox.w < 0) {
        currentBox.w = currentBox.w * -1
        currentBox.x = currentBox.x - currentBox.w
      }
      if (currentBox.h < 0) {
        currentBox.h = currentBox.h * -1
        currentBox.y = currentBox.y - currentBox.h
      }
      currentBox.class = currentClass
      if (isCropping) {
        onCrop(currentBox)
        setboundaries({
          xMin: currentBox.x,
          xMax: currentBox.x + currentBox.w,
          yMin: currentBox.y,
          yMax: currentBox.y + currentBox.h
        })
        setIsNewImage(false)

        // Re-center/fit the view on the cropped region so it stays on screen
        // regardless of whatever pan/zoom state the user was in while drawing it.
        const canvas = canvasRef.current
        if (canvas && currentBox.w > 0 && currentBox.h > 0) {
          const margin = 0.9
          const fitScale = Math.min(
            (canvas.width / currentBox.w) * margin,
            (canvas.height / currentBox.h) * margin
          )
          const centerX = currentBox.x + currentBox.w / 2
          const centerY = currentBox.y + currentBox.h / 2
          onScaleChange(fitScale)
          setOffset({
            x: canvas.width / 2 - centerX * fitScale,
            y: canvas.height / 2 - centerY * fitScale
          })
        }

        setCurrentBox(null)
        return
      }
      currentBox.isDetected = false
      onAddBox(currentBox)
      setCurrentBox(null)
    }
  }

  const handleWheel = (e) => {
    //e.preventDefault()
    
    const delta = e.deltaY < 0 ? 1.1 : 0.9

    const rect = canvasRef.current.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const newScale = scale * delta;

    const newOffsetX = mouseX - (mouseX - offset.x) * delta
    const newOffsetY = mouseY - (mouseY - offset.y) * delta

    onScaleChange(newScale)
    setOffset({ x: newOffsetX, y: newOffsetY })
  }

  return (
    <canvas
      ref={canvasRef}
      width={window.innerWidth}
      height={window.innerHeight}
      style={{
        cursor: isPanning ? 'grabbing': canDraw ? 'crosshair': 'not-allowed',
        background: 'rgba(0, 0, 0, 1)',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
			onContextMenu={(e) => e.preventDefault()}
    />
  )
}
