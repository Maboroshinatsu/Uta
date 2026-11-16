'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const code = ts.transpileModule(
  fs.readFileSync(
    path.join(__dirname, '../src/renderer/services/live2d/preset-motion-options.ts'),
    'utf8',
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const mod = { exports: {} }
vm.runInNewContext(code, { module: mod, exports: mod.exports, require: () => ({}) })
const { listPresetMotionOptions, listNativeMotionLibrary } = mod.exports

test('all scene motion groups remain discoverable and carry a scene annotation', () => {
  const groups = {
    idle: 1,
    aidale: 1,
    selfie: 1,
    selfieQuick: 1,
    ketchup: 1,
    openLid: 1,
    bubble: 1,
    splash: 1,
  }
  const options = listPresetMotionOptions(groups)
  assert.equal(options.map((option) => option.group).join(','), Object.keys(groups).join(','))
  assert.ok(options.filter(option => option.safe).every(option => ['idle', 'aidale'].includes(option.group)))
  assert.ok(options.filter(option => !option.safe).every(option => option.label.includes('场景动作')))
})

test('safe multi-index groups expose every index', () => {
  const options = listPresetMotionOptions({ Idle: 1, TapBody: 2 })
  assert.equal(options.map((option) => `${option.group}:${option.index}`).join(','), 'Idle:0,TapBody:0,TapBody:1')
  assert.equal(options.map((option) => option.label).join(','), 'Idle,TapBody · 1/2,TapBody · 2/2')
})

test('an existing unsafe binding stays visible so saving does not drop it', () => {
  const options = listPresetMotionOptions({ idle: 1, selfie: 1 }, { group: 'selfie', index: 0 })
  assert.equal(options.find(option => option.group === 'selfie').safe, false)
  assert.match(options.find(option => option.group === 'selfie').label, /场景动作/)
  assert.equal(options.filter((option) => option.group === 'selfie').length, 1)
})

test('an existing safe binding is not duplicated', () => {
  const options = listPresetMotionOptions({ idle: 1 }, { group: 'idle', index: 0 })
  assert.equal(options.length, 1)
  assert.equal(options[0].group, 'idle')
})

test('empty, missing, or invalid group counts produce no options', () => {
  assert.equal(listPresetMotionOptions(null).length, 0)
  assert.equal(listPresetMotionOptions({}).length, 0)
  assert.equal(listPresetMotionOptions({ idle: 0, aidale: -1, Invalid: 1.5 }).length, 0)
})

test('listNativeMotionLibrary lists all native motions with group, index, label', () => {
  const groups = { IDLE: 1, Tap: 2 }
  const motions = listNativeMotionLibrary(groups)
  assert.equal(motions.length, 3)
  assert.equal(motions[0].group, 'IDLE')
  assert.equal(motions[0].index, 0)
  assert.equal(motions[0].label, 'IDLE')
  assert.equal(motions[1].group, 'Tap')
  assert.equal(motions[1].index, 0)
  assert.equal(motions[1].label, 'Tap · 1/2')
  assert.equal(motions[2].group, 'Tap')
  assert.equal(motions[2].index, 1)
  assert.equal(motions[2].label, 'Tap · 2/2')
})

test('listNativeMotionLibrary attaches durationMs and loop only when present', () => {
  const groups = { IDLE: 1, Wave: 1 }
  const details = { 'IDLE#0': { durationMs: 5983, loop: true } }
  const motions = listNativeMotionLibrary(groups, details)
  assert.equal(motions[0].durationMs, 5983)
  assert.equal(motions[0].loop, true)
  assert.equal(motions[1].durationMs, undefined)
  assert.equal(motions[1].loop, undefined)
})

test('listNativeMotionLibrary handles empty or invalid motionGroups', () => {
  assert.equal(listNativeMotionLibrary(null).length, 0)
  assert.equal(listNativeMotionLibrary({}).length, 0)
  assert.equal(listNativeMotionLibrary({ IDLE: 0, Bad: -1 }).length, 0)
})

test('unnamed motion groups use resource labels and keep exact group/index identity in every list', () => {
  const details = { '#0': { label: 'idle', durationMs: 18567 }, '#1': { label: 'idle2', durationMs: 1133 } }
  for (const list of [listNativeMotionLibrary({ '': 2 }, details), listPresetMotionOptions({ '': 2 }, null, details)]) {
    assert.deepEqual(Array.from(list, motion => [motion.group, motion.index, motion.label]), [['', 0, 'idle'], ['', 1, 'idle2']])
  }
  assert.match(listNativeMotionLibrary({ '': 1 })[0].label, /未命名动作/)
})
