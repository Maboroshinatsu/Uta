const { test } = require('node:test')
const assert = require('node:assert/strict')
const createLoader = require('./support/settings-loader.cjs')

test('quiet mode restores previous choices across windows and never defaults narration on', () => {
  const values = new Map()
  const localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) }
  const first = createLoader({}, { localStorage })('renderer/services/quiet-preferences')
  const second = createLoader({}, { localStorage })('renderer/services/quiet-preferences')
  for (const narration of [false, true]) {
    const original = { idleActionsEnabled: true, ttsSpeakNarration: narration }
    const quiet = first.toggleQuietPreferences(original, true)
    assert.equal(quiet.idleActionsEnabled, false)
    assert.equal(quiet.ttsSpeakNarration, false)
    first.toggleQuietPreferences(quiet, true)
    const restored = second.toggleQuietPreferences(quiet, false)
    assert.equal(restored.idleActionsEnabled, true)
    assert.equal(restored.ttsSpeakNarration, narration)
  }
  const fresh = createLoader({}, { localStorage })('renderer/services/quiet-preferences')
  assert.equal(fresh.toggleQuietPreferences({ idleActionsEnabled: false, ttsSpeakNarration: false }, false).ttsSpeakNarration, false)
})

test('quiet choices can still be restored in the same window when storage is unavailable', () => {
  const localStorage = { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') } }
  const { toggleQuietPreferences } = createLoader({}, { localStorage })('renderer/services/quiet-preferences')
  toggleQuietPreferences({ idleActionsEnabled: false, ttsSpeakNarration: true }, true)
  const restored = toggleQuietPreferences({ idleActionsEnabled: false, ttsSpeakNarration: false }, false)
  assert.equal(restored.idleActionsEnabled, false)
  assert.equal(restored.ttsSpeakNarration, true)
})
