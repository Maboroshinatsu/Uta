'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')

test('window dragging batches movement into animation frames', () => {
  const drag = read('src/renderer/composables/useWindowDrag.ts')
  assert.match(drag, /pendingX \+= dx/)
  assert.match(drag, /requestAnimationFrame\(flush\)/)
  assert.match(drag, /if \(pendingX \|\| pendingY\) flush\(\)/)
})

test('model position is persisted after the drag settles instead of every frame', () => {
  const store = read('src/renderer/stores/deskpet.ts')
  const persist = store.match(/watch\(\[modelZoom, modelOffsetX, modelOffsetY\][\s\S]{0,900}?\}\),?\s*\n/)?.[0] ?? ''
  assert.match(persist, /clearTimeout\(viewPersistTimer\)/)
  assert.match(persist, /\}, 240\)/)
  assert.match(persist, /localStorage\.setItem\(MODEL_VIEW_STATE_KEY/)
})
