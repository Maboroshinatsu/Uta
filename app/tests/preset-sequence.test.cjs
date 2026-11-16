'use strict'
// 预设序列的纯调度规则：步骤时间线兜底、收尾方式判定与回退延迟。
// 只转译 services/preset-sequence.ts（仅有 type import），不依赖 Vue / Live2D。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/services/preset-sequence.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const loaded = { exports: {} }
vm.runInNewContext(code, { module: loaded, exports: loaded.exports, require: () => ({}) })
const {
  PRESET_TRANSITION_MS,
  PRESET_REVERT_HOLD_MS,
  resolvePresetStepTiming,
  resolvePresetFinishAction,
  resolvePresetRevertDelayMs,
  resolveHoldPresetId,
} = loaded.exports

/** 跨 realm 的对象原型不同，摊平成当前 realm 的普通对象再比较 */
function plain(value) {
  return { ...value }
}

test('缺少步骤时用 600ms 过渡、0ms 保持', () => {
  assert.deepEqual(plain(resolvePresetStepTiming(undefined)), {
    transitionMs: PRESET_TRANSITION_MS,
    holdMs: 0,
    delayMs: PRESET_TRANSITION_MS,
  })
})

test('步骤时长 + 保持时长决定下一步延迟', () => {
  assert.deepEqual(plain(resolvePresetStepTiming({ durationMs: 240, holdMs: 1200 })), {
    transitionMs: 240,
    holdMs: 1200,
    delayMs: 1440,
  })
})

test('收尾方式：多步才循环，编辑锁定时绝不自动回退', () => {
  assert.equal(resolvePresetFinishAction('loop', 3, false), 'loop')
  assert.equal(resolvePresetFinishAction('loop', 1, false), 'settle')
  assert.equal(resolvePresetFinishAction('revert', 2, false), 'revert')
  assert.equal(resolvePresetFinishAction('revert', 2, true), 'settle')
  assert.equal(resolvePresetFinishAction('hold', 2, false), 'settle')
  assert.equal(resolvePresetFinishAction('hold', 2, true), 'settle')
})

test('revert 保持时长缺省 1600ms，显式值优先', () => {
  assert.equal(resolvePresetRevertDelayMs({}), PRESET_REVERT_HOLD_MS)
  assert.equal(resolvePresetRevertDelayMs({ revertHoldMs: 3200 }), 3200)
})

test('没有手动钉选时常驻基准就是日常待机', () => {
  assert.equal(resolveHoldPresetId(''), 'neutral')
  assert.equal(resolveHoldPresetId(null), 'neutral')
  assert.equal(resolveHoldPresetId(undefined), 'neutral')
  assert.equal(resolveHoldPresetId('neutral'), 'neutral')
  assert.equal(resolveHoldPresetId('happy-body-led'), 'happy-body-led')
})
