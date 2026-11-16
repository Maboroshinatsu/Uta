'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

const { dueUnhandledIds } = createLoader()('renderer/services/daily-due')

test('badges and the "到点" tag ignore items the user deferred', () => {
  const now = 1000
  const state = {
    items: [
      { id: 'due' },
      { id: 'snoozed', snoozedUntil: 2000 },
      { id: 'snooze-expired', snoozedUntil: 500 },
      { id: 'not-unhandled' },
    ],
    unhandledIds: ['due', 'snoozed', 'snooze-expired'],
    reminderSound: false,
    error: null,
  }
  assert.deepEqual(dueUnhandledIds(state, now).join('|'), 'due|snooze-expired')
  assert.deepEqual(dueUnhandledIds(null, now).join('|'), '')

  const list = fs.readFileSync(path.join(__dirname, '../src/renderer/components/DailyTodoList.vue'), 'utf8')
  assert.match(list, /dueUnhandledIds\(state\.value\)/)
  const stage = fs.readFileSync(path.join(__dirname, '../src/renderer/components/DeskpetStage.vue'), 'utf8')
  assert.match(stage, /dueUnhandledIds\(dailyState\.value\)/)
})
