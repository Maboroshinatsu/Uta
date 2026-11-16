'use strict'
// [FIX-CODEX-GOAL-TRANSCRIPT-FALLBACK] Electron 的 Node 没有 node:sqlite，
// 目标改从 Codex 会话转录（thread_goal_updated 事件）读取，这里覆盖回落与缓存。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createLoader = require('./support/settings-loader.cjs')

const SESSION = '01a1a036-744e-7b83-adef-2d66b7321901'

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-codex-goals-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

function transcriptPath(home, sessionId = SESSION) {
  return path.join(home, '.codex', 'sessions', '2026', '11', '03', `rollout-2026-11-03T15-01-30-${sessionId}.jsonl`)
}

function writeTranscript(home, lines, sessionId = SESSION) {
  const file = transcriptPath(home, sessionId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, lines.map(line => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n', 'utf8')
  return file
}

function goalEvent(objective, options = {}) {
  const { status = 'active', updatedAt = 1793689642, threadId = SESSION, createdAt = 1793689601 } = options
  return {
    ordinal: 1,
    timestamp: '2026-11-03T15:07:22Z',
    type: 'event_msg',
    payload: {
      type: 'thread_goal_updated',
      goal: { objective, status, threadId, createdAt, updatedAt, timeUsedSeconds: 41, tokensUsed: 52211 },
    },
  }
}

function load(home, sqliteModule) {
  return createLoader({
    'node:os': { homedir: () => home },
    'node:sqlite': sqliteModule,
  })('main/codex-goals')
}

test('sqlite 缺失时从会话转录读出目标', t => {
  const home = fixture(t)
  writeTranscript(home, [
    { type: 'session_meta', payload: {} },
    goalEvent('完成 Uta 的 Codex 待办读取\n1. 修 sqlite\n2. 补测试', { status: 'active' }),
  ])

  const goal = load(home, {}).readCodexSessionGoal(SESSION)

  assert.ok(goal, '必须回落到转录而不是静默返回空')
  assert.match(goal.title, /完成 Uta 的 Codex 待办读取/)
  assert.equal(goal.status, 'active')
  assert.equal(goal.updatedAt, 1793689642 * 1000, '转录时间戳是秒，必须换算成毫秒')
  assert.equal(goal.items.length, 2)
  assert.equal(goal.items[0].status, 'in_progress', 'active 目标的第一项进行中')
})

test('多条目标事件取最新一条，且能跨读取块拼接', t => {
  const home = fixture(t)
  const filler = Array.from({ length: 4000 }, (_, i) => ({
    ordinal: i,
    type: 'event_msg',
    payload: { type: 'agent_message', message: `${'x'.repeat(120)}-${i}` },
  }))
  writeTranscript(home, [
    goalEvent('旧目标', { updatedAt: 1793689000 }),
    ...filler,
    goalEvent('新目标\n- [x] 已经做完\n- [ ] 还没做', { status: 'active', updatedAt: 1793689900 }),
  ])

  const goal = load(home, {}).readCodexSessionGoal(SESSION)

  assert.ok(goal)
  assert.match(goal.title, /新目标/)
  assert.equal(goal.updatedAt, 1793689900 * 1000)
  assert.deepEqual(
    Array.from(goal.items, item => item.status),
    ['completed', 'pending'],
  )
})

test('线程 id 不匹配的目标事件不会被误用', t => {
  const home = fixture(t)
  writeTranscript(home, [goalEvent('别人的目标', { threadId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' })])

  assert.equal(load(home, {}).readCodexSessionGoal(SESSION), null)
})

test('损坏的 JSON 行不会阻断扫描', t => {
  const home = fixture(t)
  writeTranscript(home, [
    '{ 这不是 JSON',
    goalEvent('有效目标'),
    '随机结尾',
  ])

  const goal = load(home, {}).readCodexSessionGoal(SESSION)
  assert.ok(goal)
  assert.match(goal.title, /有效目标/)
})

test('转录更新后缓存会失效并读到新目标', t => {
  const home = fixture(t)
  const file = writeTranscript(home, [goalEvent('第一版')])
  const api = load(home, {})
  assert.match(api.readCodexSessionGoal(SESSION).title, /第一版/)

  fs.appendFileSync(file, JSON.stringify(goalEvent('第二版', { updatedAt: 1793690000 })) + '\n', 'utf8')
  const goal = api.readCodexSessionGoal(SESSION)
  assert.match(goal.title, /第二版/)
  assert.equal(goal.updatedAt, 1793690000 * 1000)
})

test('sqlite 可用时优先使用数据库结果', t => {
  const home = fixture(t)
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
  fs.writeFileSync(path.join(home, '.codex', 'goals_1.sqlite'), '')
  writeTranscript(home, [goalEvent('转录里的旧目标')])
  class FakeDatabase {
    prepare() {
      return {
        all: () => [{ objective: '数据库目标\n- [x] 完成', status: 'completed', updated_at_ms: 1793689999000 }],
      }
    }
    close() {}
  }

  const goal = load(home, { DatabaseSync: FakeDatabase }).readCodexSessionGoal(SESSION)
  assert.match(goal.title, /数据库目标/)
  assert.equal(goal.updatedAt, 1793689999000)
})

test('没有数据库也没有转录时安静返回 null', t => {
  const home = fixture(t)
  assert.equal(load(home, {}).readCodexSessionGoal(SESSION), null)
})
