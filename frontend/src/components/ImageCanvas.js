import { useRef, useState, useEffect } from 'react'

export default function ImageCanvas({ src, boxes, onAddBox, onRemoveBox, isCropping,
    onCrop, currentClass, classes }) {
  const canvasRef = useRef(null)
  const imgRef = useRef(null)

  // pan + zoom state
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [lastPan, setLastPan] = useState({ x: 0, y: 0 })

  // box drawing state
  
  const [currentBox, setCurrentBox] = useState(null)

  // load image
  useEffect(() => {
    const img = new Image()
    img.src = src
    img.onload = () => {
      imgRef.current = img
      draw()
    }
  }, [src])

  // draw loop
  useEffect(() => {
    draw()
  }, [scale, offset, boxes, currentBox])

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas || !imgRef.current) return
    const ctx = canvas.getContext('2d')

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // apply pan + zoom
    ctx.save()
    ctx.translate(offset.x, offset.y)
    ctx.scale(scale, scale)

    // draw image
    ctx.drawImage(imgRef.current, 0, 0)

    // draw existing boxes
    ctx.lineWidth = 2 / scale // scale-independent line width

    boxes.forEach((b) => {
      ctx.strokeStyle = classes[b.class].color
      ctx.strokeRect(b.x, b.y, b.w, b.h)
    })

    // draw box while dragging
    if (currentBox) {
      ctx.strokeStyle = classes[currentClass].color
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

    if (currentBox) {
      const rect = canvasRef.current.getBoundingClientRect()
      const { x, y } = screenToImage(
        e.clientX - rect.left,
        e.clientY - rect.top
      )

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
        setCurrentBox(null)
        return
      }
      onAddBox(currentBox)
      setCurrentBox(null)
    }
  }

  const handleWheel = (e) => {
    
    const delta = e.deltaY < 0 ? 1.1 : 0.9

    const mouseX = e.clientX - canvasRef.current.getBoundingClientRect().left
    const mouseY = e.clientY - canvasRef.current.getBoundingClientRect().top

    const before = screenToImage(mouseX, mouseY)

    setScale((s) => s * delta)

    // adjust offset so zoom centers around cursor
    const after = screenToImage(mouseX, mouseY)

    setOffset((o) => ({
      x: o.x + (after.x - before.x) * scale,
      y: o.y + (after.y - before.y) * scale,
    }))
  }

  return (
    <canvas
      ref={canvasRef}
      width={window.innerWidth}
      height={window.innerHeight}
      style={{
        border: '1px solid #ccc',
        cursor: isPanning ? 'grabbing' : 'crosshair',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
			onContextMenu={(e) => e.preventDefault()}
    />
  )
}
