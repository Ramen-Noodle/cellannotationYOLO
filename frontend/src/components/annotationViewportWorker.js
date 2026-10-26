/* eslint-disable no-restricted-globals */
// Keep viewport filtering off the UI thread for images with many annotations.
self.onmessage = ({ data }) => {
  const { requestId, boxes, left, top, right, bottom } = data
  const visible = boxes.filter(box => {
    const boxLeft = Math.min(box.x, box.x + box.w)
    const boxRight = Math.max(box.x, box.x + box.w)
    const boxTop = Math.min(box.y, box.y + box.h)
    const boxBottom = Math.max(box.y, box.y + box.h)
    return !(boxRight < left || boxLeft > right || boxBottom < top || boxTop > bottom)
  })
  self.postMessage({ requestId, boxes: visible })
}
