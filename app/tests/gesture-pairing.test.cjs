'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const createLoader = require('./support/settings-loader.cjs')

const {
  listPairedGestures,
  buildPairedGestureSteps,
  buildPairedGesturePreset,
} = createLoader()('renderer/services/live2d/gesture-pairing')

test('[FEAT-GESTURE-PAIR] listPairedGestures discovers DaFish known gestures with joint parameters', () => {
  const motionGroups = {
    IDLE: 1,
    '抚胸手打开': 1,
    '抚胸手关闭': 1,
    '竖手指打开': 1,
    '竖手指关闭': 1,
    '狗尾巴草打开': 1,
    '狗尾巴草关闭': 1,
    '脱捕': 1,
  }

  const motionDetails = {
    '抚胸手打开#0': { durationMs: 1133, loop: true },
    '抚胸手关闭#0': { durationMs: 1017, loop: true },
    '竖手指打开#0': { durationMs: 1250, loop: true },
    '竖手指关闭#0': { durationMs: 1250, loop: true },
    '狗尾巴草打开#0': { durationMs: 1233, loop: true },
    '狗尾巴草关闭#0': { durationMs: 1133, loop: true },
  }

  const modelParameters = [
    { id: 'Param62', name: '右上臂摆动', min: -30, max: 30, default: 0 },
    { id: 'Param59', name: '右手透视', min: -30, max: 30, default: 0 },
    { id: 'Param60', name: '右前臂', min: -30, max: 30, default: 0 },
    { id: 'Param61', name: '右手手腕', min: -30, max: 30, default: 0 },
    { id: 'Param36', name: '左上臂摆动', min: -30, max: 30, default: 0 },
    { id: 'Param39', name: '左手透视', min: -30, max: 30, default: 0 },
    { id: 'Param41', name: '左前臂', min: -30, max: 30, default: 0 },
    { id: 'Param42', name: '左手手腕', min: -30, max: 30, default: 0 },
    { id: 'Param43', name: '左手食指', min: -30, max: 30, default: 0 },
    { id: 'AngleX', name: '头部X', min: -30, max: 30, default: 0 },
  ]

  const pairs = listPairedGestures(motionGroups, motionDetails, modelParameters)
  assert.equal(pairs.length, 3)

  const chest = pairs.find((p) => p.id === 'hand_on_chest')
  assert.ok(chest)
  assert.equal(chest.label, '抚胸致意')
  assert.equal(chest.enter.group, '抚胸手打开')
  assert.equal(chest.enter.durationMs, 1133)
  assert.equal(chest.exit.group, '抚胸手关闭')
  assert.equal(chest.exit.durationMs, 1017)
  assert.equal(chest.joints.length, 4)
  assert.equal(chest.joints[0].id, 'Param62')

  const point = pairs.find((p) => p.id === 'point')
  assert.ok(point)
  assert.equal(point.enter.group, '竖手指打开')
  assert.equal(point.exit.group, '竖手指关闭')
  assert.equal(point.joints.length, 5)

  const grass = pairs.find((p) => p.id === 'grass')
  assert.ok(grass)
  assert.equal(grass.enter.group, '狗尾巴草打开')
  assert.equal(grass.exit.group, '狗尾巴草关闭')
})

test('[FEAT-GESTURE-PAIR] listPairedGestures matches generic open/close motions for unknown models', () => {
  const motionGroups = {
    '挥手_打开': 1,
    '挥手_关闭': 1,
  }
  const motionDetails = {
    '挥手_打开#0': { durationMs: 800 },
    '挥手_关闭#0': { durationMs: 750 },
  }
  const pairs = listPairedGestures(motionGroups, motionDetails, [])
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].enter.group, '挥手_打开')
  assert.equal(pairs[0].exit.group, '挥手_关闭')
  assert.equal(pairs[0].enter.durationMs, 800)
  assert.equal(pairs[0].exit.durationMs, 750)
})

test('[FEAT-GESTURE-PAIR] buildPairedGestureSteps builds 3 keyframe steps with correct motion bindings', () => {
  const gesture = {
    id: 'hand_on_chest',
    name: '抚胸手',
    label: '抚胸致意',
    enter: { group: '抚胸手打开', index: 0, durationMs: 1133 },
    exit: { group: '抚胸手关闭', index: 0, durationMs: 1017 },
    joints: [],
  }
  const base = {
    controls: ['ctrl_1'],
    parameters: { AngleX: 5 },
  }

  const steps = buildPairedGestureSteps(gesture, base, {
    holdDurationMs: 1500,
    jointOverrides: { Param62: 10 },
  })

  assert.equal(steps.length, 3)

  // Step 1: 起手
  assert.equal(steps[0].label, '抚胸手·起手')
  assert.equal(steps[0].durationMs, 1133)
  assert.equal(steps[0].motion.group, '抚胸手打开')
  assert.equal(steps[0].controls[0], 'ctrl_1')
  assert.equal(steps[0].parameters.AngleX, 5)

  // Step 2: 保持微调
  assert.equal(steps[1].label, '抚胸手·姿态微调')
  assert.equal(steps[1].durationMs, 1500)
  assert.equal(steps[1].parameters.Param62, 10)

  // Step 3: 收手回正
  assert.equal(steps[2].label, '抚胸手·收手回正')
  assert.equal(steps[2].durationMs, 1017)
  assert.equal(steps[2].motion.group, '抚胸手关闭')
  assert.equal(steps[2].parameters.Param62, undefined)
})

test('[FEAT-GESTURE-PAIR] buildPairedGesturePreset creates full ModelStatePreset in 动作库 group', () => {
  const gesture = {
    id: 'point',
    name: '竖手指',
    label: '竖起食指',
    enter: { group: '竖手指打开', index: 0, durationMs: 1250 },
    exit: { group: '竖手指关闭', index: 0, durationMs: 1250 },
    joints: [],
  }
  const preset = buildPairedGesturePreset(gesture, { controls: [], parameters: {} })
  assert.equal(preset.group, '动作库')
  assert.equal(preset.source, 'user')
  assert.equal(preset.custom, true)
  assert.equal(preset.finishMode, 'hold')
  assert.equal(preset.steps.length, 3)
})
