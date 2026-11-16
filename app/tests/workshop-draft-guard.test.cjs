'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const Vue = require('vue')
const ts = require('typescript')
const { parse, compileScript } = require('@vue/compiler-sfc')
const createLoader = require('./support/settings-loader.cjs')

const load = createLoader()
const clone = (value) => JSON.parse(JSON.stringify(value))

function setupComponent(relativePath, imports, props) {
  const file = path.resolve(__dirname, '../src', relativePath)
  const { descriptor } = parse(fs.readFileSync(file, 'utf8'), { filename: file })
  const script = compileScript(descriptor, { id: 'draft-guard-test' })
  const code = ts.transpileModule(script.content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const mod = { exports: {} }
  const localVue = { ...Vue, onMounted() {}, onUnmounted() {}, provide() {} }
  vm.runInNewContext(
    code,
    {
      module: mod,
      exports: mod.exports,
      require: (id) => (id === 'vue' ? localVue : (Object.hasOwn(imports, id) ? imports[id] : {})),
      console,
      process,
      Buffer,
      URL,
      setTimeout: () => 0,
      clearTimeout() {},
      setInterval: () => 0,
      clearInterval() {},
      requestAnimationFrame: () => 0,
      cancelAnimationFrame() {},
      window: {
        utaAPI: {},
        matchMedia: () => ({ matches: true }),
        addEventListener() {},
        removeEventListener() {},
      },
      localStorage: { getItem: () => null },
    },
    { filename: file },
  )
  const scope = Vue.effectScope()
  const state = scope.run(() =>
    mod.exports.default.setup(props, { expose() {}, emit() {} }),
  )
  return { state, stop: () => scope.stop() }
}

function neutralPreset(id = 'neutral', label = '日常待机') {
  return {
    id,
    label,
    group: '日常待机',
    emotion: 'neutral',
    finishMode: 'hold',
    controls: [],
    parameters: {},
    steps: [{ label: '步骤 1', durationMs: 600, holdMs: 0, controls: [], parameters: {} }],
  }
}

function createHarness() {
  const neutral = neutralPreset()
  const other = neutralPreset('happy', '另一个预设')
  const savedPushes = []
  const store = Vue.reactive({
    modelUrl: 'test.model3.json',
    modelLoaded: true,
    modelCapabilities: {
      parameters: [
        { id: 'ParamEyeLOpen', min: 0, max: 1, default: 1 },
        { id: 'ParamEyeROpen', min: 0, max: 1, default: 1 },
        { id: 'ParamAngleY', min: -30, max: 30, default: 0 },
        { id: 'ParamAngleZ', min: -30, max: 30, default: 0 },
        { id: 'ParamMouthOpenY', min: 0, max: 1, default: 0 },
      ],
      motionGroups: {},
      expressions: [],
    },
    modelControls: [],
    modelSliders: [],
    modelEmotions: [],
    statePresets: [neutral, other],
    currentEmotion: 'neutral',
    emotionPulse: 0,
    activeHoldPresetId: '',
    presetEditingLocked: false,
    presetPreviewActive: false,
    presetSaveStatus: 'idle',
    presetSaveMessage: '',
    endPresetPreview() {},
    releaseModelWorkshop: async () => ({ ok: true }),
    requestModelAction: async () => ({ ok: true }),
    saveCustomPreset(name, _id, _unused, emotion, options) {
      const saved = {
        ...neutralPreset('saved', name),
        emotion,
        steps: clone(options.steps),
        finishMode: options.finishMode,
      }
      savedPushes.push(saved)
      store.statePresets.push(saved)
      return saved
    },
  })
  const panel = setupComponent(
    'renderer/components/SettingsPanel.vue',
    {
      '@/stores/deskpet': { useDeskpetStore: () => store },
      '@/services/live2d/model-discovery': {
        kindOfModelUrl: () => 'live2d',
        getStoredModelPath: () => '',
      },
      '@/services/live2d/emotion-adapter': load('renderer/services/live2d/emotion-adapter'),
      '@/services/live2d/preset-motion-options': load('renderer/services/live2d/preset-motion-options'),
      '@/services/preset-snippets': load('renderer/services/preset-snippets'),
      '@/services/workshop-history': load('renderer/services/workshop-history'),
      '@/services/unsaved-drafts': { registerUnsavedDraft: () => () => {} },
      '@/services/workshop-draft-signal': { setWorkshopDraftSignal() {} },
    },
    { open: true, active: true, embedded: true, initialTab: 'studio' },
  )
  return { panel, store, neutral, other, savedPushes }
}

function makeDraft(h) {
  h.panel.state.loadPresetIntoEditor(h.neutral)
  h.panel.state.customPresetName.value = '尚未保存的测试动作'
  h.panel.state.currentEditingStep.value.parameters.ParamAngleX = 12
  h.panel.state.commitWorkshopHistory()
  assert.equal(h.panel.state.workshopDirty.value, true)
  assert.equal(h.panel.state.canUndoWorkshop.value, true)
}

test('switching presets stops at a save/discard/continue guard', () => {
  const h = createHarness()
  makeDraft(h)
  const before = {
    name: h.panel.state.customPresetName.value,
    steps: clone(h.panel.state.editingSteps.value),
    dirty: h.panel.state.workshopDirty.value,
    canUndo: h.panel.state.canUndoWorkshop.value,
  }

  h.panel.state.workshop.applyStatePreset(h.other, 0)
  assert.equal(h.panel.state.presetDraftGuardOpen.value, true)
  assert.equal(h.panel.state.activePresetId.value, h.neutral.id)
  assert.deepEqual(clone(h.panel.state.editingSteps.value), before.steps)
  assert.equal(h.panel.state.workshopDirty.value, true)
  assert.equal(h.panel.state.canUndoWorkshop.value, true)

  h.panel.state.continuePresetDraftEditing()
  assert.equal(h.panel.state.presetDraftGuardOpen.value, false)
  assert.equal(h.panel.state.workshopDirty.value, true)
  assert.equal(h.panel.state.canUndoWorkshop.value, true)
  assert.equal(h.panel.state.customPresetName.value, before.name)

  h.panel.state.workshop.applyStatePreset(h.other, 0)
  h.panel.state.discardPresetDraftAndContinue()
  assert.equal(h.panel.state.presetDraftGuardOpen.value, false)
  assert.equal(h.panel.state.activePresetId.value, h.other.id)
  assert.equal(h.panel.state.customPresetName.value, h.other.label)
  h.panel.stop()
})

test('save-and-continue persists the draft before switching', async () => {
  const h = createHarness()
  makeDraft(h)

  h.panel.state.workshop.applyStatePreset(h.other, 0)
  await h.panel.state.savePresetDraftAndContinue()

  assert.equal(h.panel.state.presetDraftGuardOpen.value, false)
  assert.equal(h.savedPushes.length, 1)
  assert.equal(h.savedPushes[0].label, '尚未保存的测试动作')
  assert.equal(h.savedPushes[0].steps[0].parameters.ParamAngleX, 12)
  assert.equal(h.panel.state.activePresetId.value, h.other.id)
  h.panel.stop()
})

test('new-preset and pin actions use the same guard; pinning the same preset keeps the draft', () => {
  const h = createHarness()
  makeDraft(h)

  h.panel.state.workshop.startNewPreset()
  assert.equal(h.panel.state.presetDraftGuardOpen.value, true)
  assert.equal(h.panel.state.isCreatingNewPreset.value, false)
  h.panel.state.continuePresetDraftEditing()

  h.panel.state.workshop.togglePinPreset(h.other, 0)
  assert.equal(h.panel.state.presetDraftGuardOpen.value, true)
  assert.equal(h.store.activeHoldPresetId, '')
  h.panel.state.continuePresetDraftEditing()

  h.panel.state.workshop.applyStatePreset(h.neutral, 0)
  assert.equal(h.panel.state.presetDraftGuardOpen.value, false, 'pinning/playing the active preset must not prompt')
  assert.equal(h.panel.state.workshopDirty.value, true)
  assert.equal(h.panel.state.customPresetName.value, '尚未保存的测试动作')
  h.panel.stop()
})

test('quick snippets append real capability-backed keyframes', () => {
  const h = createHarness()
  h.panel.state.loadPresetIntoEditor(h.neutral)
  h.panel.state.currentEditingStep.value.controls = ['hat']
  const beforeCount = h.panel.state.editingSteps.value.length

  assert.equal(h.panel.state.workshop.canUseQuickSnippet('blink'), true)
  assert.equal(h.panel.state.workshop.addQuickSnippet('blink'), true)
  const steps = h.panel.state.editingSteps.value.slice(beforeCount)
  assert.equal(steps.length, 2)
  assert.deepEqual(steps.map((step) => step.label), ['眨眼·闭', '眨眼·睁'])
  assert.equal(steps[0].parameters.ParamEyeLOpen, 0)
  assert.equal(steps[1].parameters.ParamEyeLOpen, 1)
  assert.deepEqual(Array.from(steps[0].controls), ['hat'])

  h.store.modelCapabilities.parameters = h.store.modelCapabilities.parameters.filter(
    (parameter) => !parameter.id.startsWith('ParamEye'),
  )
  assert.equal(h.panel.state.workshop.canUseQuickSnippet('blink'), false)
  assert.equal(h.panel.state.workshop.addQuickSnippet('blink'), false)
  h.panel.stop()
})
