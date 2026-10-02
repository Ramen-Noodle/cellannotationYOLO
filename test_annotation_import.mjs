import test from 'node:test'
import assert from 'node:assert/strict'
import { parseChannelAnnotations, visibleImportedBoxes } from './frontend/src/pages/annotationImport.mjs'
const size = { width: 1000, height: 500 }
const channels = [0, 1, 2].map(i => ({ id: `id${i}`, orderIndex: i, channelColor: '#00ff00' }))

test('imports named/numeric classes, channel order, confidence and pixel coordinates', () => {
  const boxes = parseChannelAnnotations('C1 neuron 0.12 0.48 0.04 0.16 0.75\nC3 2 0.5 0.5 0.1 0.1 null', size, channels)
  assert.equal(boxes[0].channel_id, 'id0')
  assert.ok(Math.abs(boxes[0].x - 100) < 1e-9)
  assert.ok(Math.abs(boxes[0].y - 200) < 1e-9)
  assert.equal(boxes[0].confidence, .75)
  assert.equal(boxes[1].channel_id, 'id2')
  assert.equal(boxes[1].confidence, null)
})
test('a merged cell is one box visible in either participating channel', () => {
  const boxes = parseChannelAnnotations('C1+C2 astrocyte 0.5 0.5 0.1 0.1', size, channels)
  assert.equal(boxes.length, 1)
  assert.equal(visibleImportedBoxes(boxes, false, new Set(), 'id1').length, 1)
  assert.equal(visibleImportedBoxes(boxes, false, new Set(), 'id2').length, 0)
  assert.equal(visibleImportedBoxes(boxes, true, new Set(['id0', 'id1']), null).length, 1)
})
test('invalid lines are rejected with a line number', () => {
  for (const line of ['C4 neuron .5 .5 .1 .1', 'C1+C1 neuron .5 .5 .1 .1',
    'C1 neuron 500 100 20 20', 'C1 neuron NaN .5 .1 .1', 'C1 neuron .5 .5 .1 .1 100',
    'C1 neuron .01 .5 .2 .1', 'C1 neuron .5 .5 0 .1']) {
    assert.throws(() => parseChannelAnnotations(line, size, channels), /Line 1:/)
  }
})
test('blank files and comments represent an empty result', () => {
  assert.deepEqual(parseChannelAnnotations('# no cells\n', size, channels), [])
})
