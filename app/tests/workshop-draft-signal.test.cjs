'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

test('the workshop draft hint survives a cross-window read and expires when stale', () => {
  const storage = new Map()
  const load = createLoader({}, {
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
  })
  const signal = load('renderer/services/workshop-draft-signal')
  assert.equal(signal.isWorkshopDraftDirtyElsewhere(), false)
  signal.setWorkshopDraftSignal(true)
  assert.equal(signal.isWorkshopDraftDirtyElsewhere(), true)
  signal.setWorkshopDraftSignal(false)
  assert.equal(signal.isWorkshopDraftDirtyElsewhere(), false)

  storage.set('uta:workshop-draft-dirty', JSON.stringify({ dirty: true, at: Date.now() - 10 * 60_000 }))
  assert.equal(signal.isWorkshopDraftDirtyElsewhere(), false)
})

test('the quick panel refuses to switch while the settings window has an unsaved workshop draft', () => {
  const panel = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../src/renderer/components/QuickSettingsPanel.vue'),
    'utf8',
  )
  assert.match(panel, /isWorkshopDraftDirtyElsewhere/)
  const selectModel = panel.match(/async function selectModel\(url: string\): Promise<void> \{([\s\S]*?)\n\}/)
  assert.ok(selectModel)
  assert.ok(selectModel[1].indexOf('isWorkshopDraftDirtyElsewhere') < selectModel[1].indexOf('requestModelSwitch'))
})
