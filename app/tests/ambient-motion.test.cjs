'use strict'
// 日常微动纯引擎：只验证可感知行为，不读模型、不写 Core。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const createLoader = require('./support/settings-loader.cjs')
const load = createLoader()
const { createAmbientMotion } = load('renderer/services/performance/ambient-motion')

const STATES = ['idle', 'thinking', 'working', 'speaking', 'waiting', 'error', 'completed']
const FIELDS = ['headX', 'headY', 'headZ', 'bodyX', 'bodyZ', 'gazeX', 'gazeY', 'eyeOpen', 'mouthForm', 'browLeft', 'browRight', 'accent']

function run(engine, from, to, step = 16, onFrame) {
  const frames = []
  for (let now = from; now <= to; now += step) {
    const frame = engine.step(now)
    frames.push(frame)
    onFrame?.(frame, now)
  }
  return frames
}

test('same seed and input produce identical frames', () => {
  const a = createAmbientMotion(12345)
  const b = createAmbientMotion(12345)
  const framesA = []
  const framesB = []
  a.setState('idle', 0)
  b.setState('idle', 0)
  for (let now = 0; now <= 30000; now += 16) {
    if (now === 5000) { a.setState('thinking', now); b.setState('thinking', now) }
    if (now === 9000) { a.setState('waiting', now); b.setState('waiting', now) }
    framesA.push(a.step(now))
    framesB.push(b.step(now))
  }
  assert.deepEqual(framesA, framesB)
})

test('ambient motion never invents a blink and stays inside safe bounds', () => {
  for (const state of STATES) {
    const engine = createAmbientMotion(7)
    engine.setState(state, 0)
    let minEye = Infinity
    for (let now = 0; now <= 40000; now += 16) {
      const frame = engine.step(now)
      minEye = Math.min(minEye, frame.eyeOpen)
      for (const field of FIELDS) {
        assert.ok(Number.isFinite(frame[field]), `${state}.${field} must be finite`)
      }
      assert.ok(frame.eyeOpen >= 0.72 && frame.eyeOpen <= 1.08, 'no full blink curve from ambient')
      assert.ok(Math.abs(frame.headX) <= 0.26 && Math.abs(frame.headY) <= 0.24 && Math.abs(frame.headZ) <= 0.22)
      assert.ok(Math.abs(frame.gazeX) <= 0.2 && Math.abs(frame.gazeY) <= 0.22)
      assert.ok(frame.mouthForm >= -0.34 && frame.mouthForm <= 0.36)
      assert.ok(Math.abs(frame.browLeft) <= 0.2 && Math.abs(frame.browRight) <= 0.2)
    }
    assert.ok(minEye > 0.72, `${state} keeps the native blink in charge`)
  }
})

test('state changes ease across frames and the same state never resets', () => {
  const engine = createAmbientMotion(99)
  engine.setState('idle', 0)
  const control = createAmbientMotion(99)
  control.setState('idle', 0)
  let previous = engine.step(0)
  for (let now = 16; now <= 3000; now += 16) {
    if (now % 200 === 0) engine.setState('idle', now)
    const frame = engine.step(now)
    const twin = control.step(now)
    assert.deepEqual(frame, twin, 're-setting the same state is idempotent')
    assert.ok(Math.abs(frame.headX - previous.headX) < 0.02, 'no head jump')
    assert.ok(Math.abs(frame.eyeOpen - previous.eyeOpen) < 0.01, 'no eyelid jump')
    previous = frame
  }

  let last = engine.step(3000)
  for (const state of [...STATES.slice(1), 'idle']) {
    engine.setState(state, 3016)
    const first = engine.step(3016)
    assert.ok(Math.abs(first.headX - last.headX) < 0.02, `${state} transition must not jump`)
    assert.ok(Math.abs(first.mouthForm - last.mouthForm) < 0.02, `${state} mouth transition must not jump`)
    last = run(engine, 3032, 5000).at(-1)
  }
})

test('head and gaze vary without a fixed repeating template', () => {
  const engine = createAmbientMotion(2026)
  engine.setState('idle', 0)
  const first = run(engine, 0, 9000).map(frame => frame.headX)
  const second = run(engine, 14000, 23000).map(frame => frame.headX)
  let difference = 0
  for (let i = 0; i < Math.min(first.length, second.length); i += 1) {
    difference += Math.abs(first[i] - second[i])
  }
  difference /= Math.min(first.length, second.length)
  assert.ok(difference > 0.005, 'two idle windows are not the same sampled template')
  assert.ok(Math.max(...first) - Math.min(...first) > 0.02, 'head micro-motion is visible')

  const gazeEngine = createAmbientMotion(2026)
  gazeEngine.setState('idle', 0)
  let gazeChanges = 0
  let inLook = false
  let previousGaze = 0
  for (let now = 0; now <= 22000; now += 16) {
    const frame = gazeEngine.step(now)
    const looking = Math.abs(frame.gazeX) > 0.02
    if (looking && !inLook) gazeChanges += 1
    inLook = looking
    assert.ok(Math.abs(frame.gazeX - previousGaze) < 0.02, 'gaze moves by saccade, not a jump')
    previousGaze = frame.gazeX
  }
  assert.ok(gazeChanges >= 1 && gazeChanges <= 6, 'gaze transfers are occasional, not constant')
})

test('nod and tilt accents are sparse, bounded, and cooldown-separated', () => {
  const engine = createAmbientMotion(31415)
  engine.setState('idle', 0)
  const starts = []
  let inAccent = false
  for (let now = 0; now <= 60000; now += 16) {
    const frame = engine.step(now)
    const active = Math.abs(frame.accent) > 0.004
    if (active && !inAccent) starts.push(now)
    inAccent = active
    assert.ok(Math.abs(frame.accent) <= 0.06)
  }
  assert.ok(starts.length >= 1 && starts.length <= 6, 'accents are occasional')
  for (let i = 1; i < starts.length; i += 1) {
    assert.ok(starts[i] - starts[i - 1] >= 3000, 'accents keep a cooldown')
  }
})

test('speech level only accents phrase starts and never opens the mouth', () => {
  const engine = createAmbientMotion(4242)
  engine.setState('speaking', 0)
  run(engine, 0, 800)
  engine.setSpeechLevel(0.8, 816)
  const starts = []
  let inAccent = false
  let maxAccent = 0
  for (let now = 832; now <= 4000; now += 16) {
    if (now % 400 === 0) engine.setSpeechLevel(now % 800 === 0 ? 0 : 0.75, now)
    const frame = engine.step(now)
    maxAccent = Math.max(maxAccent, Math.abs(frame.accent))
    const active = Math.abs(frame.accent) > 0.004
    if (active && !inAccent) starts.push(now)
    inAccent = active
    assert.ok(frame.mouthForm >= -0.34 && frame.mouthForm <= 0.36)
  }
  assert.ok(maxAccent > 0.005 && maxAccent <= 0.06, 'phrase accent is visible but bounded')
  assert.ok(starts.length <= 3, 'rapid level flapping does not nod on every syllable')
})

test('invalid clock and wild frame gaps never leak NaN', () => {
  const engine = createAmbientMotion(1)
  engine.setState('idle', 0)
  let now = 0
  for (let i = 0; i < 20000; i += 1) {
    now += i % 17 === 0 ? 900 : 16
    const frame = engine.step(i % 97 === 0 ? NaN : now)
    for (const field of FIELDS) assert.ok(Number.isFinite(frame[field]))
  }
})
