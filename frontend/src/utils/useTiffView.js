import { useEffect, useRef, useState } from 'react'
import { API_BASE_URL } from '../apiConfig'

export default function useTiffView(view, width, height, brightness, contrast) {
  const { channelId, revision, low, high } = view || {}
  const key = channelId && width > 0 && height > 0 ? `${revision}:${width}x${height}` : null
  const [source, setSource] = useState(null)
  const [rendered, setRendered] = useState(null)
  const raster = useRef(null)

  useEffect(() => {
    setSource(null)
    setRendered(null)
    raster.current = null
    if (!key) return
    const controller = new AbortController()
    fetch(`${API_BASE_URL}/tiff-view/${encodeURIComponent(channelId)}`, {
      credentials: 'include', signal: controller.signal,
    }).then(async response => {
      if (!response.ok) return
      const bits = Number(response.headers.get('X-Tiff-Bits'))
      const buffer = await response.arrayBuffer()
      if (controller.signal.aborted || buffer.byteLength !== width * height * 2 || ![8, 16].includes(bits)) return
      setSource({ key, pixels: new Uint16Array(buffer), bits })
    }).catch(() => {
      // Keep the existing PNG if the original cannot be loaded or decoded.
    })
    return () => controller.abort()
  }, [channelId, key, width, height])

  useEffect(() => {
    if (!key || source?.key !== key) return
    const frame = requestAnimationFrame(() => {
      if (!raster.current || raster.current.key !== key) {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        raster.current = { key, canvas, ctx, image: ctx.createImageData(width, height) }
      }
      const { canvas, ctx, image } = raster.current
      const hasBounds = Number.isFinite(low) && Number.isFinite(high) && high > low
      const min = hasBounds ? low : 0
      const max = hasBounds ? high : 2 ** source.bits - 1
      const range = max - min
      const center = (min + max) / 2 - range * (brightness / 200)
      const window = range / Math.max(0.01, 1 + contrast / 100)
      const black = center - window / 2
      const gain = 255 / window
      const rgba = image.data
      for (let i = 0, j = 0; i < source.pixels.length; i++, j += 4) {
        const value = (source.pixels[i] - black) * gain
        rgba[j] = rgba[j + 1] = rgba[j + 2] = value
        rgba[j + 3] = 255
      }
      ctx.putImageData(image, 0, 0)
      setRendered({ key, canvas })
    })
    return () => cancelAnimationFrame(frame)
  }, [key, source, low, high, brightness, contrast, width, height])

  return key && rendered?.key === key ? rendered : null
}
