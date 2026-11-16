'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

const mod = createLoader()('main/daily-todo-store')
const { prepareDailySend, dispatchDailySend } = createLoader()('main/daily-todo-send')
const {
  createDailyTodoStore,
  dueDailyReminders,
  isDailyReminderDue,
  normalizeDailyAnchor,
  unhandledDailyReminderIds,
} = mod

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-daily-todo-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function at(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function makeStore(dir, start = at(2026, 10, 27, 9, 0)) {
  let now = start
  let tick = 0
  const store = createDailyTodoStore(dir, {
    now: () => now,
    randomId: () => `daily-${++tick}`,
  })
  return { store, setNow: value => { now = value } }
}

test('daily items keep reminders separate from the project todo list', t => {
  const dir = sandbox(t)
  const { store, setNow } = makeStore(dir)
  const added = store.addItem({ text: '  买菜  ' })
  assert.equal(added.ok, true)
  assert.equal(added.state.items[0].text, '买菜')
  assert.equal(added.state.items[0].repeat, 'none')
  assert.equal(added.state.items[0].remindAt, undefined)

  setNow(at(2026, 10, 27, 10, 0))
  const once = store.addItem({ text: '取快递', remindAt: at(2026, 10, 27, 18, 30) })
  assert.equal(once.ok, true)
  assert.equal(once.state.items.find(item => item.text === '取快递').remindAt, at(2026, 10, 27, 18, 30))

  const reloaded = makeStore(dir).store
  assert.equal(reloaded.state().items.length, 2)
})

test('daily repeats normalize to the next occurrence and require a time', t => {
  const dir = sandbox(t)
  const { store } = makeStore(dir, at(2026, 10, 27, 21, 0))
  const futureToday = store.addItem({
    text: '喝水',
    remindAt: at(2026, 10, 27, 22, 0),
    repeat: 'daily',
  })
  assert.equal(futureToday.ok, true)
  assert.equal(futureToday.state.items[0].remindAt, at(2026, 10, 27, 22, 0))

  const pastToday = store.addItem({
    text: '拉伸',
    remindAt: at(2026, 10, 27, 20, 0),
    repeat: 'daily',
  })
  assert.equal(pastToday.ok, true)
  assert.equal(pastToday.state.items.find(item => item.text === '拉伸').remindAt, at(2026, 10, 28, 20, 0))

  const missing = store.addItem({ text: '早睡', repeat: 'daily' })
  assert.equal(missing.ok, false)
  assert.match(missing.error, /提醒时间/)
})

test('due reminders fire once, repeat daily, and skip completed items', t => {
  const once = {
    id: 'once', text: '取快递', status: 'pending', createdAt: 1, updatedAt: 1,
    repeat: 'none', remindAt: at(2026, 10, 27, 18, 0),
  }
  const daily = {
    id: 'daily', text: '喝水', status: 'pending', createdAt: 1, updatedAt: 1,
    repeat: 'daily', remindAt: at(2026, 10, 27, 20, 0),
  }
  const done = {
    id: 'done', text: '已完成', status: 'completed', createdAt: 1, updatedAt: 1,
    repeat: 'none', remindAt: at(2026, 10, 27, 18, 0),
  }
  assert.deepEqual(
    dueDailyReminders([once, daily, done], at(2026, 10, 27, 18, 5)).map(item => item.id),
    ['once'],
  )
  const remindedOnce = { ...once, lastRemindedAt: at(2026, 10, 27, 18, 5) }
  assert.equal(isDailyReminderDue(remindedOnce, at(2026, 10, 27, 19, 0)), false)

  const firstDaily = dueDailyReminders([daily], at(2026, 10, 27, 20, 5))
  assert.deepEqual(firstDaily.map(item => item.id), ['daily'])
  const remindedDaily = { ...daily, lastRemindedAt: at(2026, 10, 27, 20, 5) }
  assert.equal(isDailyReminderDue(remindedDaily, at(2026, 10, 27, 23, 0)), false)
  assert.deepEqual(
    dueDailyReminders([remindedDaily], at(2026, 10, 28, 20, 1)).map(item => item.id),
    ['daily'],
  )
})

test('marking reminded and editing a reminder persists across reloads', t => {
  const dir = sandbox(t)
  const { store } = makeStore(dir)
  const added = store.addItem({ text: '吃药', remindAt: at(2026, 10, 27, 21, 0) })
  const id = added.state.items[0].id
  assert.equal(store.markReminded([id], at(2026, 10, 27, 21, 1)), true)
  const reloaded = makeStore(dir).store
  assert.equal(reloaded.state().items[0].lastRemindedAt, at(2026, 10, 27, 21, 1))

  const updated = reloaded.updateItem({ id, remindAt: at(2026, 10, 28, 8, 0), repeat: 'daily' })
  assert.equal(updated.ok, true)
  assert.equal(updated.state.items[0].lastRemindedAt, undefined)
  assert.equal(updated.state.items[0].repeat, 'daily')
  assert.equal(updated.state.items[0].remindAt, at(2026, 10, 28, 8, 0))

  const cleared = reloaded.updateItem({ id, remindAt: null, repeat: 'none' })
  assert.equal(cleared.ok, true)
  assert.equal(cleared.state.items[0].remindAt, undefined)
})

test('reminder sound is persisted and a damaged file stays read-only', t => {
  const dir = sandbox(t)
  const { store } = makeStore(dir)
  store.addItem({ text: '日常' })
  assert.equal(store.setReminderSound(true).ok, true)
  assert.equal(makeStore(dir).store.state().reminderSound, true)

  const broken = sandbox(t)
  const file = path.join(broken, 'daily-todos.v1.json')
  const original = JSON.stringify({ version: 99, items: [] })
  fs.writeFileSync(file, original)
  const damaged = makeStore(broken).store
  assert.equal(damaged.state().error, 'future-version')
  assert.equal(damaged.addItem({ text: '不能写' }).ok, false)
  assert.equal(fs.readFileSync(file, 'utf8'), original)
})

test('a daily reminder waits for its first scheduled occurrence even after editing text', t => {
  const dir = sandbox(t)
  const { store, setNow } = makeStore(dir, at(2026, 10, 27, 15, 0))
  const added = store.addItem({ text: '锻炼', remindAt: at(2026, 10, 27, 9, 0), repeat: 'daily' })
  const item = added.state.items[0]
  assert.equal(item.remindAt, at(2026, 10, 28, 9, 0))
  assert.equal(isDailyReminderDue(item, at(2026, 10, 27, 15, 0)), false)
  const edited = store.updateItem({ id: item.id, text: '晨练' }).state.items[0]
  assert.equal(edited.remindAt, item.remindAt)
  setNow(at(2026, 10, 28, 9, 0))
  assert.equal(isDailyReminderDue(store.state().items[0], at(2026, 10, 28, 9, 0)), true)
})

test('snoozing defers a reminder once, then clears itself and keeps the daily rhythm', t => {
  const dir = sandbox(t)
  const { store, setNow } = makeStore(dir, at(2026, 10, 27, 8, 0))
  const added = store.addItem({ text: '吃药', remindAt: at(2026, 10, 27, 9, 0), repeat: 'daily' })
  const id = added.state.items[0].id
  assert.equal(isDailyReminderDue(store.state().items[0], at(2026, 10, 27, 9, 1)), true)

  setNow(at(2026, 10, 27, 9, 1))
  const snoozed = store.snoozeItem({ id, minutes: 10 })
  assert.equal(snoozed.ok, true)
  assert.equal(snoozed.state.items[0].snoozedUntil, at(2026, 10, 27, 9, 11))
  assert.equal(isDailyReminderDue(snoozed.state.items[0], at(2026, 10, 27, 9, 6)), false)
  assert.equal(isDailyReminderDue(snoozed.state.items[0], at(2026, 10, 27, 9, 11)), true)

  assert.equal(store.markReminded([id], at(2026, 10, 27, 9, 11)), true)
  const after = store.state().items[0]
  assert.equal(after.snoozedUntil, undefined)
  assert.equal(isDailyReminderDue(after, at(2026, 10, 27, 9, 20)), false)
  assert.equal(isDailyReminderDue(after, at(2026, 10, 28, 9, 1)), true)
  assert.equal(store.snoozeItem({ id, minutes: 0 }).ok, false)
})

test('daily snooze survives midnight, reload, reminder delivery, completion and edits', t => {
  const dir = sandbox(t)
  const clock = makeStore(dir, at(2026, 10, 27, 23, 50))
  const id = clock.store.addItem({ text: '跨日', remindAt: at(2026, 10, 27, 23, 55), repeat: 'daily', resetDaily: true }).state.items[0].id
  clock.setNow(at(2026, 10, 27, 23, 55))
  clock.store.markReminded([id])
  clock.store.snoozeItem({ id, minutes: 10 })
  clock.setNow(at(2026, 10, 28, 0, 1))
  assert.equal(clock.store.state().unhandledIds.join('|'), id)
  assert.equal(dueDailyReminders(clock.store.state().items, at(2026, 10, 28, 0, 4)).length, 0)
  const loaded = makeStore(dir, at(2026, 10, 28, 0, 5)).store
  assert.equal(dueDailyReminders(loaded.state().items, at(2026, 10, 28, 0, 5)).map(item => item.id).join('|'), id)
  loaded.markReminded([id])
  assert.equal(loaded.state().items[0].snoozedUntil, undefined)
  assert.equal(loaded.state().unhandledIds.join('|'), id)
  assert.equal(isDailyReminderDue(loaded.state().items[0], at(2026, 10, 28, 23, 55)), true)
  loaded.updateItem({ id, status: 'completed' })
  assert.equal(loaded.state().unhandledIds.length, 0)
  const next = makeStore(dir, at(2026, 10, 29, 23, 55)).store
  assert.equal(next.applyDailyRecurrence(), true)
  assert.equal(isDailyReminderDue(next.state().items[0], at(2026, 10, 29, 23, 55)), true)
  next.snoozeItem({ id, minutes: 10 })
  const edited = next.updateItem({ id, remindAt: at(2026, 10, 30, 12, 0) }).state.items[0]
  assert.equal(edited.snoozedUntil, undefined)
  assert.equal(edited.lastRemindedAt, undefined)
})

test('snooze cannot trigger a daily item before its first scheduled time', t => {
  const { store } = makeStore(sandbox(t), at(2026, 10, 27, 8, 0))
  const id = store.addItem({ text: '未来', remindAt: at(2026, 10, 27, 9, 0), repeat: 'daily' }).state.items[0].id
  const item = store.snoozeItem({ id, minutes: 10 }).state.items[0]
  assert.equal(isDailyReminderDue(item, at(2026, 10, 27, 8, 10)), false)
  assert.equal(unhandledDailyReminderIds([item], at(2026, 10, 27, 8, 10)).length, 0)
})

test('long snooze remains pending past the next daily slot until its target', t => {
  const clock = makeStore(sandbox(t), at(2026, 10, 27, 23, 0))
  const id = clock.store.addItem({ text: '长时间推迟', remindAt: at(2026, 10, 27, 23, 5), repeat: 'daily' }).state.items[0].id
  clock.setNow(at(2026, 10, 27, 23, 10))
  clock.store.markReminded([id])
  clock.store.snoozeItem({ id, minutes: 1440 })
  clock.setNow(at(2026, 10, 28, 23, 5))
  assert.equal(clock.store.state().unhandledIds.join('|'), id)
  assert.equal(isDailyReminderDue(clock.store.state().items[0], at(2026, 10, 28, 23, 5)), false)
  assert.equal(isDailyReminderDue(clock.store.state().items[0], at(2026, 10, 28, 23, 10)), true)
})

test('only items with resetDaily come back the next day', t => {
  const dir = sandbox(t)
  const { store, setNow } = makeStore(dir, at(2026, 10, 27, 8, 0))
  const plain = store.addItem({ text: '只提醒', remindAt: at(2026, 10, 27, 9, 0), repeat: 'daily' })
  const recurring = store.addItem({
    text: '喝药',
    remindAt: at(2026, 10, 27, 9, 0),
    repeat: 'daily',
    resetDaily: true,
  })
  const plainId = plain.state.items.find(item => item.text === '只提醒').id
  const recurringId = recurring.state.items.find(item => item.text === '喝药').id
  assert.equal(recurring.state.items.find(item => item.id === recurringId).resetDaily, true)

  setNow(at(2026, 10, 27, 9, 5))
  store.updateItem({ id: plainId, status: 'completed' })
  store.updateItem({ id: recurringId, status: 'completed' })
  assert.equal(store.applyDailyRecurrence(), false, '当天完成不会立刻变回未完成')

  setNow(at(2026, 10, 28, 9, 0))
  assert.equal(store.applyDailyRecurrence(), true)
  const nextDay = store.state().items
  assert.equal(nextDay.find(item => item.id === plainId).status, 'completed')
  const back = nextDay.find(item => item.id === recurringId)
  assert.equal(back.status, 'pending')
  assert.equal(back.completedAt, undefined)
  assert.equal(isDailyReminderDue(back, at(2026, 10, 28, 9, 0)), true)

  const cleared = store.clearCompleted()
  assert.ok(cleared.state.items.some(item => item.id === recurringId), '每天重新出现的条目不能被一键清掉')
  assert.ok(!cleared.state.items.some(item => item.id === plainId))
})

test('completing a recurring item early in the day keeps it done for that day', t => {
  const dir = sandbox(t)
  const { store, setNow } = makeStore(dir, at(2026, 10, 28, 9, 30))
  const added = store.addItem({
    text: '拉伸',
    remindAt: at(2026, 10, 28, 10, 0),
    repeat: 'daily',
    resetDaily: true,
  })
  const id = added.state.items[0].id
  setNow(at(2026, 10, 28, 9, 40))
  store.updateItem({ id, status: 'completed' })
  setNow(at(2026, 10, 28, 10, 1))
  assert.equal(store.applyDailyRecurrence(), false)
  assert.equal(store.state().items[0].status, 'completed')
  setNow(at(2026, 10, 29, 10, 0))
  assert.equal(store.applyDailyRecurrence(), true)
  assert.equal(store.state().items[0].status, 'pending')
})

test('unhandled ids cover due pending items, including snoozed ones', t => {
  const now = at(2026, 10, 27, 12, 0)
  const base = { status: 'pending', createdAt: 1, updatedAt: 1, repeat: 'none' }
  const items = [
    { ...base, id: 'due', text: '到点', remindAt: at(2026, 10, 27, 11, 0) },
    { ...base, id: 'future', text: '未到', remindAt: at(2026, 10, 27, 13, 0) },
    { ...base, id: 'done', text: '完成', status: 'completed', remindAt: at(2026, 10, 27, 11, 0) },
    { ...base, id: 'snoozed', text: '推迟', remindAt: at(2026, 10, 27, 11, 0), snoozedUntil: at(2026, 10, 27, 12, 10) },
  ]
  assert.deepEqual(unhandledDailyReminderIds(items, now).join('|'), 'due|snoozed')

  const dir = sandbox(t)
  const { store } = makeStore(dir, now)
  const added = store.addItem({ text: '到点', remindAt: at(2026, 10, 27, 11, 30) })
  const id = added.state.items[0].id
  assert.deepEqual(store.state().unhandledIds.join('|'), id)
})

test('daily host send checks the selected items, preview text and bound host', t => {
  const { store } = makeStore(sandbox(t))
  const first = store.addItem({ text: '买菜' }).state.items[0]
  const second = store.addItem({ text: '复习' }).state.items.find(item => item.text === '复习')
  const payload = { hostId: 'codex', items: [{ id: second.id, text: second.text }] }
  const result = prepareDailySend(store.state(), 'codex', payload)
  assert.equal(result.ok, true)
  assert.match(result.text, /1\. 复习/)
  assert.doesNotMatch(result.text, /买菜/)
  assert.equal(prepareDailySend(store.state(), 'claude-code', payload).ok, false)
  assert.equal(prepareDailySend(store.state(), null, payload).ok, false)
  assert.equal(prepareDailySend(store.state(), 'codex', { ...payload, items: [] }).ok, false)
  assert.equal(prepareDailySend(store.state(), 'codex', { ...payload, items: [payload.items[0], payload.items[0]] }).ok, false)
  store.updateItem({ id: second.id, text: '新内容' })
  assert.equal(prepareDailySend(store.state(), 'codex', payload).ok, false)
  store.updateItem({ id: first.id, status: 'completed' })
  assert.equal(prepareDailySend(store.state(), 'codex', { hostId: 'codex', items: [{ id: first.id, text: first.text }] }).ok, false)
  assert.equal(prepareDailySend({ ...store.state(), error: 'unreadable' }, 'codex', payload).ok, false)
  const longItems = Array.from({ length: 6 }, (_, i) => ({ id: `long-${i}`, text: '字'.repeat(200), status: 'pending' }))
  assert.equal(prepareDailySend({ items: longItems, error: null }, 'codex', { hostId: 'codex', items: longItems }).ok, false)
})

test('daily host send only copies on unsupported and surfaces failures', async () => {
  const copies = []
  const send = result => async () => result
  const copy = text => copies.push(text)
  assert.equal((await dispatchDailySend('清单', send({ ok: true }), copy)).mode, 'sent')
  assert.equal((await dispatchDailySend('清单', send({ ok: false, code: 'no-session', error: '没有会话' }), copy)).error, '没有会话')
  assert.equal(copies.length, 0)
  assert.equal((await dispatchDailySend('清单', send({ ok: false, code: 'unsupported' }), copy)).mode, 'copied')
  assert.equal(copies.join('|'), '清单')
})
