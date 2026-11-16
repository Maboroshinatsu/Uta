'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

const { canRunIdleActions } = createLoader()('renderer/services/idle-gate')

const allowed = {
  idleActionsEnabled: true,
  reducedMotion: false,
  documentVisible: true,
  agentWorkingState: 'idle',
  speaking: false,
  thinking: false,
  approvals: 0,
  editingLocked: false,
  previewActive: false,
  presetRunning: false,
  uiBlocked: false,
}

test('daily idle needs an enabled, visible, truly idle character', () => {
  assert.equal(canRunIdleActions(allowed), true)
  for (const patch of [
    { idleActionsEnabled: false },
    { reducedMotion: true },
    { documentVisible: false },
    { agentWorkingState: 'thinking' },
    { agentWorkingState: 'tool_running' },
    { agentWorkingState: 'streaming' },
    { speaking: true },
    { thinking: true },
    { approvals: 1 },
    { editingLocked: true },
    { previewActive: true },
    // 预设正在播放：空闲动作不得抢占，否则会 cancel 当前序列并触发回退清理、收掉预设临时部件
    { presetRunning: true },
    { uiBlocked: true },
  ]) {
    assert.equal(canRunIdleActions({ ...allowed, ...patch }), false, JSON.stringify(patch))
  }
})
