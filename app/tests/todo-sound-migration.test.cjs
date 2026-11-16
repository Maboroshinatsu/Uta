'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const createLoader = require('./support/settings-loader.cjs')

test('legacy mute is preserved through failed and successful migration without losing sound style', async () => {
  let raw = JSON.stringify({ soundEnabled: false, soundType: 'ding', bubbleDurationSec: 12 })
  const localStorage = { getItem: () => raw, setItem: (_, value) => { raw = value } }
  const settings = createLoader({}, { localStorage })('renderer/services/todo-settings')
  let enabled = true
  const api = {
    getDailyState: async () => ({ reminderSound: enabled, error: null }),
    dailySetReminderSound: async () => ({ ok: false }),
  }
  await settings.migrateLegacySoundSetting(api)
  assert.equal(settings.legacySoundDisabled(), true)
  api.dailySetReminderSound = async next => {
    enabled = next
    settings.saveTodoSettings({ soundType: 'drop' })
    return { ok: true }
  }
  await settings.migrateLegacySoundSetting(api)
  assert.equal(enabled, false)
  assert.deepEqual(JSON.parse(raw), { soundType: 'drop', bubbleDurationSec: 12 })
})
