'use strict'
const assert = require('node:assert')
const { test, describe } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

const load = createLoader()
const { normalizePetSettingsCommand } = load('shared/settings-command-contracts')

describe('settings window -> pet command contract', () => {
  test('calibration preview accepts only a signed known channel and bounded parameter', () => {
    const signature = 'uta-live2d-assets-v1:' + 'a'.repeat(64)
    const command = { type: 'preview-calibration', signature, channel: 'headX', parameterId: 'HeadCustom', direction: 'normal' }
    assert.equal(normalizePetSettingsCommand(command).parameterId, 'HeadCustom')
    assert.equal(normalizePetSettingsCommand({ ...command, channel: 'mouthOpen' }), null)
    assert.equal(normalizePetSettingsCommand({ ...command, signature: 'changed' }), null)
    assert.equal(normalizePetSettingsCommand({ ...command, parameterId: 'x'.repeat(201) }), null)
  })
  test('eye preview is an explicit payload-free command, never a parameter-write escape hatch', () => {
    assert.deepEqual(normalizePetSettingsCommand({ type: 'preview-eyes', parameters: { ParamHat: 999 } }), { type: 'preview-eyes' })
  })
  test('mouth preview strips arbitrary raw parameters and never accepts an external speech-state override', () => {
    assert.deepEqual(normalizePetSettingsCommand({ type: 'preview-mouth', parameters: { ParamMouthOpenY: 999 }, speechActive: false }), { type: 'preview-mouth' })
  })
  test('hold-preset sync accepts only a bounded string and allows clearing', () => {
    assert.deepEqual(normalizePetSettingsCommand({ type: 'set-hold-preset', presetId: 'thinking-1' }), {
      type: 'set-hold-preset', presetId: 'thinking-1',
    })
    assert.deepEqual(normalizePetSettingsCommand({ type: 'set-hold-preset', presetId: '' }), {
      type: 'set-hold-preset', presetId: '',
    })
    assert.equal(normalizePetSettingsCommand({ type: 'set-hold-preset' }), null)
    assert.equal(normalizePetSettingsCommand({ type: 'set-hold-preset', presetId: 3 }), null)
    assert.equal(normalizePetSettingsCommand({ type: 'set-hold-preset', presetId: 'x'.repeat(201) }), null)
  })
  test('static emotion commands are bounded and arbitrary extra fields are stripped', () => {
    assert.deepEqual(normalizePetSettingsCommand({ type: 'set-emotion', emotion: 'happy', url: 'ignored' }), { type: 'set-emotion', emotion: 'happy' })
    for (const emotion of ['', 7, 'x'.repeat(101), null]) {
      assert.equal(normalizePetSettingsCommand({ type: 'set-emotion', emotion }), null)
    }
  })
  test('ambient demo accepts only known states and strips arbitrary payloads', () => {
    assert.deepEqual(normalizePetSettingsCommand({ type: 'preview-ambient', state: 'thinking' }), {
      type: 'preview-ambient',
      state: 'thinking',
    })
    assert.deepEqual(normalizePetSettingsCommand({ type: 'preview-ambient', state: 'speaking', parameters: { ParamHat: 999 } }), {
      type: 'preview-ambient',
      state: 'speaking',
    })
    assert.equal(normalizePetSettingsCommand({ type: 'preview-ambient', state: 'angry' }), null)
    assert.equal(normalizePetSettingsCommand({ type: 'preview-ambient' }), null)
  })
  test('accepts the snapshot and reload commands without payloads', () => {
    assert.deepEqual(normalizePetSettingsCommand({ type: 'snapshot' }), { type: 'snapshot' })
    assert.deepEqual(normalizePetSettingsCommand({ type: 'reload-settings' }), { type: 'reload-settings' })
  })

  test('accepts a model switch url and rejects empty or oversized urls', () => {
    assert.deepEqual(normalizePetSettingsCommand({ type: 'switch-model', url: 'uta://models/a' }), {
      type: 'switch-model',
      url: 'uta://models/a',
    })
    assert.equal(normalizePetSettingsCommand({ type: 'switch-model', url: '' }), null)
    assert.equal(normalizePetSettingsCommand({ type: 'switch-model', url: 'x'.repeat(4097) }), null)
  })

  test('preview steps require an object step and an explicit gaze flag', () => {
    const step = { durationMs: 240, values: { mouthOpen: 0.4 } }
    assert.deepEqual(normalizePetSettingsCommand({ type: 'preview-step', step, gaze: true }), {
      type: 'preview-step',
      step,
      gaze: true,
    })
    assert.equal(normalizePetSettingsCommand({ type: 'preview-step', step: [], gaze: true }), null)
    assert.equal(normalizePetSettingsCommand({ type: 'preview-step', step, gaze: 'yes' }), null)
  })

  test('preset triggers carry either an id or the full edited preset', () => {
    assert.deepEqual(normalizePetSettingsCommand({ type: 'trigger-preset', preset: 'neutral' }), {
      type: 'trigger-preset',
      preset: 'neutral',
      mode: undefined,
    })
    const preset = { id: 'custom-1', name: '新预设', steps: [{ durationMs: 100 }] }
    assert.deepEqual(
      normalizePetSettingsCommand({ type: 'trigger-preset', preset, mode: 'revert' }),
      { type: 'trigger-preset', preset, mode: 'revert' },
    )
    assert.equal(normalizePetSettingsCommand({ type: 'trigger-preset', preset: [] }), null)
    assert.equal(normalizePetSettingsCommand({ type: 'trigger-preset', preset: '' }), null)
  })

  test('slider sync clamps transition time and rejects non-finite values', () => {
    assert.deepEqual(normalizePetSettingsCommand({ type: 'sync-sliders', transitionMs: -10 }), {
      type: 'sync-sliders',
      transitionMs: 0,
      sliders: undefined,
      controls: undefined,
    })
    assert.deepEqual(normalizePetSettingsCommand({ type: 'sync-sliders', transitionMs: 99999 }), {
      type: 'sync-sliders',
      transitionMs: 5000,
      sliders: undefined,
      controls: undefined,
    })
    assert.equal(normalizePetSettingsCommand({ type: 'sync-sliders', transitionMs: Infinity }), null)
  })

  test('slider sync carries edited slider and control snapshots', () => {
    const sliders = [{ id: 'ParamAngleX', value: 12 }]
    const controls = [{ id: 'point', active: true }]
    assert.deepEqual(
      normalizePetSettingsCommand({ type: 'sync-sliders', transitionMs: 240, sliders, controls }),
      { type: 'sync-sliders', transitionMs: 240, sliders, controls },
    )
    assert.equal(
      normalizePetSettingsCommand({ type: 'sync-sliders', transitionMs: 240, sliders: 'oops' }),
      null,
    )
  })

  test('control actions and edit locks validate their fields', () => {
    assert.deepEqual(
      normalizePetSettingsCommand({ type: 'control-action', control: '点菜按下', action: 'toggle' }),
      { type: 'control-action', control: '点菜按下', action: 'toggle' },
    )
    assert.deepEqual(
      normalizePetSettingsCommand({ type: 'set-edit-lock', locked: true }),
      { type: 'set-edit-lock', locked: true },
    )
    assert.equal(normalizePetSettingsCommand({ type: 'set-edit-lock', locked: 'yes' }), null)
  })

  test('host state and switching commands are bounded and payload-free', () => {
    assert.deepEqual(normalizePetSettingsCommand({ type: 'host-state' }), { type: 'host-state' })
    assert.deepEqual(normalizePetSettingsCommand({ type: 'reconnect-host' }), { type: 'reconnect-host' })
    assert.deepEqual(
      normalizePetSettingsCommand({ type: 'switch-host', preference: 'standalone' }),
      { type: 'switch-host', preference: 'standalone' },
    )
    assert.deepEqual(
      normalizePetSettingsCommand({ type: 'switch-host', preference: 'claude-code', extra: true }),
      { type: 'switch-host', preference: 'claude-code' },
    )
    assert.equal(normalizePetSettingsCommand({ type: 'switch-host', preference: '' }), null)
    assert.equal(normalizePetSettingsCommand({ type: 'switch-host', preference: 'bad host!' }), null)
    assert.equal(normalizePetSettingsCommand({ type: 'switch-host', preference: 'x'.repeat(121) }), null)
  })

  test('rejects unknown, malformed and array payloads', () => {
    assert.equal(normalizePetSettingsCommand(null), null)
    assert.equal(normalizePetSettingsCommand('snapshot'), null)
    assert.equal(normalizePetSettingsCommand([]), null)
    assert.equal(normalizePetSettingsCommand({ type: 'unknown' }), null)
    assert.equal(normalizePetSettingsCommand({ type: 42 }), null)
  })
})
