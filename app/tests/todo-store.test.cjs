'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

const { createTodoStore } = createLoader()('main/todo-store')

test('Claude task deltas retain other tasks and are scoped and persisted per session', t => {
  const dir = sandbox(t)
  const store = makeStore(dir)
  const apply = (sessionId, action, id, extra = {}) => store.applyClaudeTaskDelta({ sessionId, action, id, cwd: 'D:/Work/Uta', ...extra })
  assert.equal(apply('session-a', 'create', '1', { text: '检查' }), true)
  assert.equal(apply('session-a', 'create', '2', { text: '测试' }), true)
  assert.equal(apply('session-b', 'create', '1', { text: '独立任务' }), true)
  assert.equal(apply('session-a', 'update', '1', { status: 'in_progress' }), true)
  let plan = store.state('claude-code', 'session-a', 'D:/Work/Uta').hostPlan
  assert.equal(plan.partial, true)
  assert.equal(plan.items.map(item => `${item.id}:${item.status}`).join('|'), '1:in_progress|2:pending')
  assert.equal(store.state('claude-code', 'session-b', 'D:/Work/Uta').hostPlan.items[0].text, '独立任务')
  assert.equal(apply('session-a', 'create', '1', { text: '重复' }), false)
  assert.equal(apply('session-a', 'update', '2', { status: 'deleted' }), true)
  plan = makeStore(dir).state('claude-code', 'session-a', 'D:/Work/Uta').hostPlan
  assert.equal(plan.partial, true)
  assert.equal(plan.items.map(item => item.id).join('|'), '1')
  assert.equal(plan.items[0].status, 'in_progress')
  assert.equal(apply('', 'create', '1', { text: '非法' }), false)
  assert.equal(apply('session-c', 'update', 'unknown', { status: 'completed' }), true)
  const incomplete = store.state('claude-code', 'session-c', 'D:/Work/Uta').hostPlan
  assert.equal(incomplete.partial, true)
  assert.equal(incomplete.items.length, 0, 'unknown updates must not invent a task')
})

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-todo-store-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function makeStore(dir) {
  let tick = 0
  return createTodoStore(dir, {
    now: () => 1_700_000_000_000 + (++tick),
  })
}

test('stored project todos still load and match the active workspace', t => {
  const dir = sandbox(t)
  const resolved = path.resolve('D:/Work/Uta')
  const key = `workspace:${resolved.replace(/\\/g, '/').toLowerCase()}`
  const item = (id, text) => ({ id, text, status: 'pending', createdAt: 1, updatedAt: 1 })
  fs.writeFileSync(path.join(dir, 'todo.v1.json'), JSON.stringify({
    version: 1,
    projects: [{
      key, path: resolved, label: 'Uta', unidentified: false,
      items: [item('a', '写协议'), item('b', '做 UI')], updatedAt: 1,
    }],
  }))

  const state = makeStore(dir).state('codex', 's1', 'd:/work/uta')
  assert.equal(state.projectsError, null)
  assert.equal(state.projects.length, 1)
  assert.deepEqual(state.projects[0].items.map(entry => entry.text), ['写协议', '做 UI'])
  assert.equal(state.activeProjectKey, key)
})

test('host snapshots are deduped, session-scoped and marked stale', t => {
  const dir = sandbox(t)
  const store = makeStore(dir)
  const items = [
    { text: '检查协议', status: 'completed' },
    { text: '写 UI', status: 'in_progress' },
    { text: '验收', status: 'pending' },
  ]
  assert.equal(store.applyHostSnapshot({
    hostId: 'codex', sessionId: 's1', cwd: 'D:/work', source: 'codex-plan', items,
  }), true)
  assert.equal(store.applyHostSnapshot({
    hostId: 'codex', sessionId: 's1', cwd: 'D:/work', source: 'codex-plan', items,
  }), false, 'an identical snapshot must not publish a second change')

  const current = store.state('codex', 's1', 'D:/work')
  assert.equal(current.hostPlan.items.length, 3)
  assert.equal(current.hostPlan.items[1].status, 'in_progress')
  assert.equal(current.hostPlanStale, false)

  const otherSession = store.state('codex', 's2', 'D:/work')
  assert.equal(otherSession.hostPlan.sessionId, 's1')
  assert.equal(otherSession.hostPlanStale, true)
  assert.equal(store.state('claude-code', 's1', 'D:/work').hostPlan, null)

  assert.equal(store.applyHostSnapshot({
    hostId: 'codex', sessionId: 's1', cwd: 'D:/work', source: 'codex-plan', items: [],
  }), true)
  assert.equal(store.state('codex', 's1', 'D:/work').hostPlan.items.length, 0)
})

test('a sessionless host plan cannot be attributed to the current or a previous chat', t => {
  const store = makeStore(sandbox(t))
  store.applyHostSnapshot({
    hostId: 'codex', sessionId: '', cwd: 'D:/work', source: 'codex-plan',
    items: [{ text: '保留未关联的计划', status: 'pending' }],
  })
  const state = store.state('codex', 'current-chat', 'D:/work')
  assert.equal(state.hostPlan.sessionId, '')
  assert.equal(state.hostPlanStale, false)
  assert.equal(state.activeSessionId, 'current-chat')
})

test('a damaged todo file is reported unreadable and is never overwritten', t => {
  const dir = sandbox(t)
  const file = path.join(dir, 'todo.v1.json')
  const original = JSON.stringify({ version: 99, projects: [] })
  fs.writeFileSync(file, original)

  const state = makeStore(dir).state('codex', 's1', 'D:/Work')
  assert.equal(state.projectsError, 'future-version')
  assert.equal(state.projects.length, 0)
  assert.equal(fs.readFileSync(file, 'utf8'), original)
})

test('a damaged host plan file does not block stored project data or later plans', t => {
  const dir = sandbox(t)
  fs.writeFileSync(path.join(dir, 'host-plans.v1.json'), '{"version":1,"plans":[{"bad":true}]}')
  fs.writeFileSync(path.join(dir, 'todo.v1.json'), JSON.stringify({
    version: 1,
    projects: [{
      key: 'workspace:d:/work', path: 'D:/Work', label: 'Work', unidentified: false,
      items: [{ id: 'a', text: '还能读', status: 'pending', createdAt: 1, updatedAt: 1 }], updatedAt: 1,
    }],
  }))
  const store = makeStore(dir)
  const state = store.state('codex', 's1', 'D:/Work')
  assert.equal(state.hostPlan, null)
  assert.equal(state.projects[0].items[0].text, '还能读')
  assert.equal(store.applyHostSnapshot({
    hostId: 'codex', sessionId: 's1', cwd: 'D:/Work', source: 'codex-plan',
    items: [{ text: '新计划', status: 'pending' }],
  }), true)
  assert.equal(store.state('codex', 's1', 'D:/Work').hostPlan.items[0].text, '新计划')
})

test('todo session directories are attributed and matched to the actual target', () => {
  const { completeTodoSession, todoProjectMatchesSession } = createLoader()('main/todo-session')
  const now = Date.now()
  const selected = { host: 'codex', sessionId: 'one', cwd: '', updatedAt: now }
  const other = { host: 'codex', sessionId: 'two', cwd: 'D:/other', updatedAt: now }
  assert.equal(completeTodoSession(selected, other, now).cwd, '')
  assert.equal(todoProjectMatchesSession('D:/other', selected), false)
  const correct = { ...other, sessionId: 'one', cwd: 'D:/project' }
  const completed = completeTodoSession(selected, correct, now)
  assert.equal(completed.cwd, 'D:/project')
  assert.equal(todoProjectMatchesSession('D:/project', completed), true)
  assert.equal(todoProjectMatchesSession('D:/other', completed), false)
  assert.equal(todoProjectMatchesSession('', completed), false)
  assert.equal(completeTodoSession(selected, { ...correct, updatedAt: now - 31 * 60_000 }, now).cwd, '')
})

test('todo recovery preserves original bytes, rejects stale previews and future data', t => {
  const dir = sandbox(t)
  const recovery = createLoader()('main/todo-recovery').createTodoRecovery(dir)
  const file = path.join(dir, 'todo.v1.json')
  const broken = Buffer.from([0xff, 0x00, 0x61])
  fs.writeFileSync(file, broken)
  const raw = recovery.readOriginal('project')
  assert.equal(raw.ok, true)
  assert.deepEqual(raw.bytes, broken)
  const data = JSON.stringify({ version: 1, projects: [] })
  const preview = recovery.preview('project', data)
  assert.equal(preview.ok, true)
  assert.equal(recovery.apply(preview.token).ok, true)
  assert.equal(fs.readFileSync(file, 'utf8'), data)
  const backupDir = path.join(dir, 'todo-recovery-backups')
  assert.deepEqual(fs.readFileSync(path.join(backupDir, fs.readdirSync(backupDir)[0])), broken)
  const stale = recovery.preview('project', data)
  fs.writeFileSync(file, '{"version":1,"projects":[]} ')
  assert.equal(recovery.apply(stale.token).ok, false)
  const future = '{"version":99,"projects":[]}'
  fs.writeFileSync(file, future)
  assert.equal(recovery.readOriginal('project').bytes.toString('utf8'), future)
  assert.equal(recovery.preview('project', data).ok, false)
  assert.equal(fs.readFileSync(file, 'utf8'), future)
  assert.equal(recovery.preview('daily', '{"version":1,"items":[{}]}').ok, false)
})

test('daily recovery reloads the live store and retains an oversized damaged original', t => {
  const dir = sandbox(t)
  const loader = createLoader()
  const { createDailyTodoStore } = loader('main/daily-todo-store')
  const recovery = loader('main/todo-recovery').createTodoRecovery(dir)
  const file = path.join(dir, 'daily-todos.v1.json')
  const broken = Buffer.alloc(1024 * 1024 + 1, 0xff)
  fs.writeFileSync(file, broken)
  const store = createDailyTodoStore(dir)
  assert.equal(store.state().error, 'invalid')
  const data = JSON.stringify({ version: 1, reminderSound: true, items: [] })
  const preview = recovery.preview('daily', data)
  assert.equal(preview.ok, true)
  assert.equal(recovery.apply(preview.token).ok, true)
  store.reload()
  assert.equal(store.state().error, null)
  assert.equal(store.state().reminderSound, true)
  const backupDir = path.join(dir, 'todo-recovery-backups')
  assert.deepEqual(fs.readFileSync(path.join(backupDir, fs.readdirSync(backupDir)[0])), broken)
})

test('a failed host plan write is reported instead of silently accepted', t => {
  const dir = sandbox(t)
  const store = makeStore(dir)
  const snapshot = (items) => store.applyHostSnapshot({ hostId: 'codex', sessionId: 's1', cwd: 'D:/work', source: 'codex-plan', items })
  assert.equal(snapshot([{ text: '第一条', status: 'pending' }]), true)
  const file = path.join(dir, 'host-plans.v1.json')
  fs.rmSync(file)
  fs.mkdirSync(file)
  assert.throws(() => snapshot([{ text: '第二条', status: 'pending' }]), /host plan save failed/)
})

test('a failed claude task plan write is also reported', t => {
  const dir = sandbox(t)
  const store = makeStore(dir)
  const apply = (id) => store.applyClaudeTaskDelta({ sessionId: 's1', action: 'create', id, text: `任务 ${id}`, cwd: 'D:/work' })
  assert.equal(apply('a'), true)
  const file = path.join(dir, 'host-plans.v1.json')
  fs.rmSync(file)
  fs.mkdirSync(file)
  assert.throws(() => apply('b'), /host plan save failed/)
})

test('reload recovers after a broken projects file is repaired', t => {
  const dir = sandbox(t)
  fs.writeFileSync(path.join(dir, 'todo.v1.json'), '{broken')
  const store = makeStore(dir)
  assert.equal(store.state('', '', '').projectsError, 'unreadable')
  fs.writeFileSync(path.join(dir, 'todo.v1.json'), JSON.stringify({
    version: 1,
    projects: [{ key: 'workspace-demo', path: 'D:/demo', label: 'demo', unidentified: false, items: [], updatedAt: 1 }],
  }))
  store.reload()
  const state = store.state('', '', 'D:/demo')
  assert.equal(state.projectsError, null)
  assert.equal(state.projects[0].label, 'demo')
})
