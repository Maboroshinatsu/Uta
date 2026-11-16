'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { FullscreenVisibility } = require('./support/settings-loader.cjs')()('main/fullscreen-visibility')

function setup({ visible = false, minimized = false, onExit } = {}) {
  const pet = {
    visible, minimized, events: [],
    isVisible() { return this.visible },
    isMinimized() { return this.minimized },
    hide() { this.events.push('hide'); this.visible = false },
    showInactive() { this.events.push('showInactive'); this.visible = true },
  }
  return { pet, gate: new FullscreenVisibility(pet, onExit) }
}

test('startup waits for the first fullscreen probe and restores without taking focus', () => {
  const { pet, gate } = setup()
  gate.requestShow()
  gate.sample(true)
  assert.equal(gate.blocksReveal(), true)
  assert.deepEqual(pet.events, [])
  gate.sample(false)
  gate.sample(true)
  gate.sample(false)
  assert.equal(pet.visible, false)
  gate.sample(false)
  assert.equal(gate.blocksReveal(), false)
  assert.deepEqual(pet.events, ['showInactive'])
})

test('a visible pet hides once and remains hidden if the user cancels deferred showing', () => {
  const { pet, gate } = setup({ visible: true })
  gate.sample(false)
  gate.sample(true)
  gate.sample(true)
  gate.toggleDeferredShow()
  gate.sample(false)
  gate.sample(false)
  assert.deepEqual(pet.events, ['hide'])
})

test('exit from fullscreen does not reopen a manually hidden or minimized window', () => {
  for (const options of [{}, { visible: true, minimized: true }]) {
    const { pet, gate } = setup(options)
    gate.sample(false)
    gate.sample(true)
    gate.sample(false)
    gate.sample(false)
    assert.deepEqual(pet.events, [])
  }
})

test('probe failure releases the gate and restores a pet hidden by fullscreen', () => {
  const { pet, gate } = setup({ visible: true })
  gate.sample(true)
  gate.clearFullscreen()
  gate.clearFullscreen()
  assert.equal(gate.blocksReveal(), false)
  assert.deepEqual(pet.events, ['hide', 'showInactive'])
})

test('the deferred reminder check runs once, after the fullscreen gate opens', () => {
  const observed = []
  const { pet, gate } = setup({ visible: true, onExit: () => observed.push([gate.blocksReveal(), pet.visible]) })
  gate.sample(false)
  gate.sample(true)
  gate.sample(false)
  assert.deepEqual(observed, [])
  gate.sample(false)
  gate.sample(false)
  assert.deepEqual(observed, [[false, true]])
})
