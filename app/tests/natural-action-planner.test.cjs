'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const createLoader = require('./support/settings-loader.cjs')

const {
  parseNaturalActionPrompt,
  compileDirectorPlan,
  parseDirectorPlanJson,
} = createLoader()('renderer/services/live2d/natural-action-planner')

const mockContext = {
  parameters: [
    { id: 'ParamEyeBallX', min: -1, max: 1, default: 0 },
    { id: 'ParamEyeBallY', min: -1, max: 1, default: 0 },
    { id: 'AngleX', min: -30, max: 30, default: 0 },
    { id: 'AngleY', min: -30, max: 30, default: 0 },
    { id: 'AngleZ', min: -30, max: 30, default: 0 },
    { id: 'ParamEyeLOpen', min: 0, max: 2, default: 1 },
    { id: 'ParamEyeROpen', min: 0, max: 2, default: 1 },
    { id: 'ParamMouthForm', min: -1, max: 1, default: 0 },
    { id: 'ParamMouthOpenY', min: 0, max: 1, default: 0 },
  ],
  modelEmotions: ['neutral', 'happy', 'shy', 'angry', 'sad'],
}

const mockGestures = [
  {
    id: 'hand_on_chest',
    name: '抚胸手',
    label: '抚胸致意',
    enter: { group: '抚胸手打开', index: 0, durationMs: 1133 },
    exit: { group: '抚胸手关闭', index: 0, durationMs: 1017 },
    joints: [],
  },
  {
    id: 'point',
    name: '竖手指',
    label: '竖起食指',
    enter: { group: '竖手指打开', index: 0, durationMs: 1250 },
    exit: { group: '竖手指关闭', index: 0, durationMs: 1250 },
    joints: [],
  },
]

test('[FEAT-AI-DIRECTOR] parseNaturalActionPrompt splits sequence and recognizes semantic actions', () => {
  const plan = parseNaturalActionPrompt(
    '先看向左侧，再抚胸微笑，最后轻轻点头看回我',
    mockContext,
    mockGestures,
  )

  assert.equal(plan.version, 1)
  assert.ok(plan.actions.length >= 4)

  const kinds = plan.actions.map((a) => a.kind)
  assert.ok(kinds.includes('look'))
  assert.ok(kinds.includes('gesture'))
  assert.ok(kinds.includes('smile'))
  assert.ok(kinds.includes('nod'))

  const firstLook = plan.actions.find((a) => a.kind === 'look')
  assert.equal(firstLook.direction, 'left')

  const gesture = plan.actions.find((a) => a.kind === 'gesture')
  assert.equal(gesture.name, 'hand_on_chest')

  const lastLook = plan.actions.filter((a) => a.kind === 'look').pop()
  assert.equal(lastLook.direction, 'center')
})

test('[FEAT-AI-DIRECTOR] parseNaturalActionPrompt recognizes blink, tilt, shake head and gasp', () => {
  const plan1 = parseNaturalActionPrompt('眨眼两次，然后轻轻歪头', mockContext, mockGestures)
  const blink = plan1.actions.find((a) => a.kind === 'blink')
  assert.ok(blink)
  assert.equal(blink.count, 2)
  const tilt = plan1.actions.find((a) => a.kind === 'tilt')
  assert.ok(tilt)

  const plan2 = parseNaturalActionPrompt('惊讶地张嘴，然后摇头', mockContext, mockGestures)
  assert.ok(plan2.actions.some((a) => a.kind === 'gasp'))
  assert.ok(plan2.actions.some((a) => a.kind === 'shake_head'))
})

test('[FEAT-AI-DIRECTOR] compileDirectorPlan compiles semantic plan into valid PresetKeyframeStep list', () => {
  const plan = parseNaturalActionPrompt(
    '先看向右侧，再抚胸微笑，最后轻轻点头',
    mockContext,
    mockGestures,
  )
  const base = {
    controls: [],
    parameters: { AngleX: 0, AngleY: 0 },
  }

  const steps = compileDirectorPlan(plan, mockContext, mockGestures, base)
  assert.ok(steps.length >= 5)

  // Verify each step has valid durationMs and parameters
  for (const step of steps) {
    assert.ok(typeof step.durationMs === 'number' && step.durationMs > 0)
    assert.ok(typeof step.holdMs === 'number' && step.holdMs >= 0)
    assert.ok(typeof step.parameters === 'object')
  }

  // Verify parameters do not exceed min/max bounds
  for (const step of steps) {
    for (const [pid, val] of Object.entries(step.parameters)) {
      const meta = mockContext.parameters.find((p) => p.id === pid)
      if (meta) {
        assert.ok(val >= meta.min, `${pid} (${val}) below min ${meta.min}`)
        assert.ok(val <= meta.max, `${pid} (${val}) above max ${meta.max}`)
      }
    }
  }

  // Verify gesture steps included enter motion and exit motion
  const enterStep = steps.find((s) => s.motion && s.motion.group === '抚胸手打开')
  const exitStep = steps.find((s) => s.motion && s.motion.group === '抚胸手关闭')
  assert.ok(enterStep, 'Must include gesture enter step')
  assert.ok(exitStep, 'Must include gesture exit step')
})

test('[FEAT-AI-DIRECTOR] parseDirectorPlanJson parses valid LLM JSON and tolerates markdown formatting', () => {
  const jsonWithMd = '```json\n{\n  "version": 1,\n  "summary": "AI编排",\n  "actions": [\n    { "kind": "look", "direction": "left" },\n    { "kind": "smile" }\n  ]\n}\n```'
  const plan = parseDirectorPlanJson(jsonWithMd)
  assert.ok(plan)
  assert.equal(plan.version, 1)
  assert.equal(plan.actions.length, 2)
  assert.equal(plan.actions[0].kind, 'look')

  assert.equal(parseDirectorPlanJson('invalid json'), null)
  assert.equal(parseDirectorPlanJson('{"version": 2}'), null)
})


test('[FEAT-DIRECTOR-MICRO-MOTION] parseNaturalActionPrompt parses Chinese emotion aliases and compound gaze shifting', () => {
  const plan = parseNaturalActionPrompt('尴尬然后左右移开视线', {
    parameters: mockContext.parameters,
    modelEmotions: ['happy', 'sad', 'angry', 'surprise', 'embarrassed'],
    modelControls: [{ id: '流冷汗', label: '流冷汗' }, { id: '脸红', label: '脸红' }],
  })

  assert.ok(plan)
  assert.equal(plan.actions.length, 5)
  assert.equal(plan.actions[0].kind, 'expression')
  assert.equal(plan.actions[0].name, 'embarrassed')
  assert.equal(plan.actions[1].kind, 'look')
  assert.equal(plan.actions[1].direction, 'left')
  assert.equal(plan.actions[2].kind, 'blink')
  assert.equal(plan.actions[3].kind, 'look')
  assert.equal(plan.actions[3].direction, 'right')
  assert.equal(plan.actions[4].kind, 'look')
  assert.equal(plan.actions[4].direction, 'center')

  // Compile with rich controls (e.g. dafish)
  const stepsRich = compileDirectorPlan(plan, {
    parameters: mockContext.parameters,
    modelEmotions: ['happy', 'embarrassed'],
    modelControls: [{ id: '流冷汗', label: '流冷汗' }, { id: '脸红', label: '脸红' }],
  }, null, { controls: [], parameters: {} })

  assert.ok(stepsRich.length >= 5)
  assert.ok(stepsRich[0].controls.includes('流冷汗'), 'Should activate cold sweat on model that has it')
  assert.ok(stepsRich[0].controls.includes('脸红'), 'Should activate blush on model that has it')
  assert.equal(stepsRich[0].parameters.ParamMouthForm, -0.3)

  // Compile with generic model without custom controls
  const stepsGeneric = compileDirectorPlan(plan, {
    parameters: mockContext.parameters,
    modelEmotions: ['happy', 'sad'],
    modelControls: [],
  }, null, { controls: [], parameters: {} })

  assert.equal(stepsGeneric[0].controls.length, 0, 'Generic model should have zero controls injected')
  assert.equal(stepsGeneric[0].parameters.ParamMouthForm, -0.3, 'Generic model preserves standard parameter adaptation')
})

test('compileDirectorPlan dynamically resolves ParamAngle* on standard models like Hiyori', () => {
  const hiyoriContext = {
    parameters: [
      { id: 'ParamAngleX', min: -30, max: 30, default: 0 },
      { id: 'ParamAngleY', min: -30, max: 30, default: 0 },
      { id: 'ParamAngleZ', min: -30, max: 30, default: 0 },
      { id: 'ParamEyeBallX', min: -1, max: 1, default: 0 },
      { id: 'ParamEyeBallY', min: -1, max: 1, default: 0 },
    ],
    modelEmotions: ['neutral', 'happy'],
  }

  const plan = {
    version: 1,
    actions: [
      { kind: 'nod', count: 1, strength: 0.85 },
      { kind: 'shake_head', count: 1, strength: 0.85 },
      { kind: 'tilt', direction: 'left', strength: 0.8 },
    ],
  }

  const steps = compileDirectorPlan(plan, hiyoriContext, null, { controls: [], parameters: {} })
  assert.ok(steps.length >= 5)

  // Nod steps must write ParamAngleY, not AngleY
  const nodStep = steps.find((s) => s.label.includes('点头·低'))
  assert.ok(nodStep)
  assert.ok(typeof nodStep.parameters.ParamAngleY === 'number', 'Must write ParamAngleY on Hiyori')
  assert.equal(nodStep.parameters.AngleY, undefined, 'Must not write AngleY when model uses ParamAngleY')

  // Shake head steps must write ParamAngleX
  const shakeStep = steps.find((s) => s.label.includes('摇头·侧'))
  assert.ok(shakeStep)
  assert.ok(typeof shakeStep.parameters.ParamAngleX === 'number', 'Must write ParamAngleX on Hiyori')
  assert.equal(shakeStep.parameters.AngleX, undefined)

  // Tilt step must write ParamAngleZ
  const tiltStep = steps.find((s) => s.label.includes('歪头'))
  assert.ok(tiltStep)
  assert.ok(typeof tiltStep.parameters.ParamAngleZ === 'number', 'Must write ParamAngleZ on Hiyori')
  assert.equal(tiltStep.parameters.AngleZ, undefined)
})

test('extractJsonFromHostReply cleans malformed null actions and rejects invalid plans', () => {
  const { extractJsonFromHostReply } = createLoader()('renderer/services/live2d/natural-action-planner')
  const malformed = '{"version":1,"actions":[null, {"kind":"nod"}]}'
  const cleaned = extractJsonFromHostReply(malformed)
  assert.ok(cleaned)
  assert.equal(cleaned.actions.length, 1)
  assert.equal(cleaned.actions[0].kind, 'nod')

  const onlyNulls = '{"version":1,"actions":[null, "invalid"]}'
  assert.equal(extractJsonFromHostReply(onlyNulls), null)

  const steps = compileDirectorPlan(cleaned, mockContext, null, { controls: [], parameters: {} })
  assert.ok(steps.length >= 2)
})
