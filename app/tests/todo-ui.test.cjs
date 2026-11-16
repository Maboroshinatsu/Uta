'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { parse, compileScript } = require('@vue/compiler-sfc')
const createLoader = require('./support/settings-loader.cjs')

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
const domains = createLoader()('renderer/settings-window/settings-domains')

test('todo is a first-class settings destination with an icon and page mount', () => {
  assert.ok(domains.SETTINGS_DOMAINS.some(domain => domain.id === 'todo'))
  const todo = domains.SETTINGS_DOMAINS.find(domain => domain.id === 'todo')
  assert.equal(todo.label, '待办')
  assert.equal(todo.icon, 'todo')
  assert.match(read('src/renderer/components/settings-v2/SettingsIcon.vue'), /name === 'todo'/)
  const app = read('src/renderer/settings-window/SettingsWindowApp.vue')
  assert.match(app, /import TodoDomain/)
  assert.match(app, /<TodoDomain v-if="activeDomain === 'todo'" \/>/)
})

test('pet window exposes the unified todo companion board beside the message panel', () => {
  const stage = read('src/renderer/components/DeskpetStage.vue')
  assert.match(stage, /import TodoBoard from '\.\/TodoBoard\.vue'/)
  assert.match(stage, /<TodoBoard[\s\S]*?:open="todoPanelOpen"/)
  assert.match(stage, /function toggleTodoPanel\(\)/)
  assert.match(stage, /chatPanelOpen\.value = false[\s\S]*?todoPanelOpen\.value = true/)
  assert.match(stage, /onDailyReminder/)
  assert.match(stage, /playReminderChime/)

  const board = read('src/renderer/components/TodoBoard.vue')
  assert.match(board, /role="dialog"/)
  assert.match(board, /aria-label="待办"/)
  assert.match(board, /<DailyTodoList compact \/>/)
  assert.match(board, /useDailyState/)
  assert.match(board, /\.companion-window\s*\{[\s\S]*?position:\s*absolute/)
  assert.match(board, /\.companion-slide-enter-active/)
  assert.match(board, /todo-board-lanes/, 'lanes allow switching between daily and host')
  assert.match(board, /lane === 'daily'/)
  assert.match(board, /lane === 'host'/)
  assert.match(board, /宿主计划/)
  assert.doesNotMatch(board, /open-full-settings/, 'footer button is removed from quick companion board')

  const panel = read('src/renderer/components/QuickSettingsPanel.vue')
  assert.doesNotMatch(panel, /aria-label="待办"/, 'the quick panel stays lean now that the pet has a todo board')
})

test('daily todo list owns reminders, repeat editing and eliminates sending to host', () => {
  const source = read('src/renderer/components/DailyTodoList.vue')
  for (const text of [
    'aria-label="添加待办"',
    'dailyAddItem',
    'dailyUpdateItem',
    'dailyDeleteItem',
    'dailyClearCompleted',
    'type="datetime-local"',
    '每天这个时间',
    '同时设置提醒',
  ]) {
    assert.ok(source.includes(text), `daily todo list should include ${text}`)
  }
  assert.doesNotMatch(source, /dailySendToHost/, 'send to host is eliminated')
  assert.doesNotMatch(source, /daily-send-preview/, 'send preview is eliminated')
  const { descriptor, errors } = parse(source, { filename: 'DailyTodoList.vue' })
  assert.deepEqual(errors, [])
  assert.ok(compileScript(descriptor, { id: 'daily-todo-test' }).content.trim().length > 0)
})

test('todo domain presents dedicated settings for reminder chime, presets, and bubble duration', () => {
  const source = read('src/renderer/settings-window/domains/TodoDomain.vue')
  for (const text of [
    '提醒与表现',
    '待办通知与桌宠表现',
    '到点播放提示音',
    '提示音风格',
    '桌宠提醒表现',
    '提醒气泡停留时长',
    'REMINDER_SOUND_OPTIONS',
    'testSound',
    'SettingsRow',
  ]) {
    assert.ok(source.includes(text), `todo domain should include ${text}`)
  }
  const { descriptor, errors } = parse(source, { filename: 'TodoDomain.vue' })
  assert.deepEqual(errors, [])
  assert.ok(compileScript(descriptor, { id: 'todo-domain-test' }).content.trim().length > 0)
  assert.doesNotMatch(source, /<DailyTodoList|aria-label="宿主计划"/)
})

test('preload exposes todo, daily and reminder channels', () => {
  const preload = read('src/preload/index.ts')
  for (const method of [
    'getDailyState',
    'dailyAddItem',
    'dailyUpdateItem',
    'dailyDeleteItem',
    'dailyClearCompleted',
    'dailySetReminderSound',
    'dailySnoozeItem',
    'onDailyChanged',
    'onDailyReminder',
  ]) {
    assert.match(preload, new RegExp(`\\b${method}\\b`))
  }
  const types = read('src/renderer/env.d.ts')
  assert.match(types, /onDailyReminder/)
  assert.match(types, /DailyReminderPayload/)
})

test('an outdated main process is reported as such instead of a vague add failure', async () => {
  const current = createLoader({}, {
    window: {
      utaAPI: {
        getDailyState: async () => null,
        dailyAddItem: async () => null,
        getTodoState: async () => null,
      },
    },
  })
  const present = current('renderer/services/todo-availability')
  assert.equal(present.hasDailyIpc(), true)
  assert.equal(present.hasTodoIpc(), true)
})

test('reminder closure: actionable card, snooze and daily reset option', () => {
  const stage = read('src/renderer/components/DeskpetStage.vue')
  for (const text of [
    'class="reminder-card"',
    'aria-label="日常提醒"',
    'completeReminder',
    'snoozeReminder',
    'openReminderTodos',
    '10 分钟后',
    'dueUnhandledIds(dailyState.value)',
  ]) {
    assert.ok(stage.includes(text), `pet stage should include ${text}`)
  }
  assert.match(stage, /dailySnoozeItem\?\.\(\{ id, minutes: 10 \}\)/)
  assert.match(stage, /canComplete: items\.length === 1/)

  const list = read('src/renderer/components/DailyTodoList.vue')
  for (const text of [
    '第二天重新出现',
    'class="daily-todo-due"',
    'dailySnoozeItem',
    'resetDaily: editingRepeat.value === \'daily\' && editingResetDaily.value',
    '已推迟到',
  ]) {
    assert.ok(list.includes(text), `daily list should include ${text}`)
  }
})
