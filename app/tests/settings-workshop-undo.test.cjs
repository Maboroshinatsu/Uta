'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const Vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
const createLoader = require('./support/settings-loader.cjs')

const appRoot = path.join(__dirname, '..')
const load = createLoader()

function scriptSetup(relative, imports, globals = {}, props = {}) {
  const file = path.join(appRoot, 'src', relative)
  const { descriptor } = parse(fs.readFileSync(file, 'utf8'), { filename: file })
  const compiled = compileScript(descriptor, { id: 'workshop-undo-test' })
  const code = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  const localVue = { ...Vue, onMounted: () => {}, onUnmounted: () => {} }
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports,
    require: id => id === 'vue' ? localVue : (Object.hasOwn(imports, id) ? imports[id] : {}),
    console, process, Buffer, URL, setTimeout: () => 0, clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    ...globals,
  }, { filename: file })
  const scope = Vue.effectScope()
  const state = scope.run(() => mod.exports.default.setup(props, { expose: () => {}, emit: () => {} }))
  return { state, stop: () => scope.stop() }
}

function workshopHarness(props = { open: true, active: true, embedded: true, initialTab: 'studio' }) {
  const neutral = {
    id: 'neutral', label: '日常待机', group: '日常待机', emotion: 'neutral', finishMode: 'hold',
    controls: [], parameters: {}, steps: [{ label: '步骤 1', durationMs: 600, holdMs: 0, controls: [], parameters: {} }],
  }
  let releases = 0
  const actions = []
  const store = Vue.reactive({
    modelUrl: 'a.model3.json', modelLoaded: true, modelCapabilities: null,
    modelControls: [], modelSliders: [], modelEmotions: [], statePresets: [neutral],
    requestModelAction: async command => { actions.push(command); return { ok: true } }, activeHoldPresetId: '',
    presetEditingLocked: false, presetPreviewActive: false, endPresetPreview() {},
    releaseModelWorkshop: async () => { releases++; return { ok: true } },
  })
  const { state, stop } = scriptSetup(
    'renderer/components/SettingsPanel.vue',
    {
      '@/stores/deskpet': { useDeskpetStore: () => store },
      '@/services/live2d/model-discovery': { kindOfModelUrl: url => url === 'static' ? 'image-set' : 'live2d', getStoredModelPath: () => '' },
      '@/services/live2d/emotion-adapter': load('renderer/services/live2d/emotion-adapter'),
      '@/services/live2d/preset-motion-options': load('renderer/services/live2d/preset-motion-options'),
      '../../shared/native-motion': load('shared/native-motion'),
      '@/services/workshop-history': load('renderer/services/workshop-history'),
      '@/services/unsaved-drafts': { registerUnsavedDraft: () => () => {} },
      '@/services/workshop-draft-signal': { setWorkshopDraftSignal: () => {} },
    },
    {
      window: {
        utaAPI: {},
        matchMedia: () => ({ matches: true }),
        addEventListener: () => {},
        removeEventListener: () => {},
      },
      localStorage: { getItem: () => null },
    },
    props,
  )
  return { state, stop, store, actions, releases: () => releases }
}

test('workshop undo and redo preserve the loop finish mode', () => {
  const { state, stop } = workshopHarness()
  try {
    state.editingFinishMode.value = 'loop'
    state.customPresetName.value = 'loop draft'
    state.markWorkshopClean()
    state.customPresetName.value = 'edited loop draft'
    state.commitWorkshopHistory()
    state.undoWorkshop()
    assert.equal(state.customPresetName.value, 'loop draft')
    assert.equal(state.editingFinishMode.value, 'loop')
    state.redoWorkshop()
    assert.equal(state.customPresetName.value, 'edited loop draft')
    assert.equal(state.editingFinishMode.value, 'loop')
  } finally {
    stop()
  }
})

test('action-library playback honors the saved finish mode', () => {
  const h = workshopHarness()
  try {
    for (const mode of ['hold', 'loop', 'revert']) {
      const preset = { ...h.store.statePresets[0], id: 'saved', finishMode: mode }
      h.state.applyStatePresetNow(preset)
      assert.equal(h.actions.at(-1).type, 'trigger-preset')
      assert.equal(h.actions.at(-1).mode, mode)
    }
  } finally { h.stop() }
})

test('static action-library emotions go to the pet instead of only changing the settings mirror', async () => {
  const h = workshopHarness()
  try {
    h.store.modelUrl = 'static'
    h.state.applyStatePresetNow({ ...h.store.statePresets[0], emotion: 'happy' })
    await Vue.nextTick()
    assert.equal(h.actions.at(-1).type, 'set-emotion')
    assert.equal(h.actions.at(-1).emotion, 'happy')
  } finally { h.stop() }
})

test('whole-preset native motion is visible, removable, and prevents incomplete motion3 export', async () => {
  const h = workshopHarness()
  try {
    h.state.loadPresetIntoEditor({ ...h.store.statePresets[0], motion: { group: 'NativeWhole', index: 0 } })
    assert.equal(h.state.wholeMotionLabel.value, 'NativeWhole')
    assert.equal(await h.state.exportEditingSequenceToMotion3(), false)
    assert.match(h.store.presetSaveMessage, /NativeWhole/)
    assert.match(h.store.presetSaveMessage, /用户预设/)
    h.state.clearWholeMotion()
    assert.equal(h.state.wholeMotionLabel.value, '')
    assert.equal(h.state.editingMotion.value, 'none')
    h.store.modelCapabilities = { motionGroups: { '': 2 }, motionDetails: { '#1': { label: 'idle2' } } }
    h.state.loadPresetIntoEditor({ ...h.store.statePresets[0], motion: { group: '', index: 1 } })
    assert.equal(h.state.wholeMotionLabel.value, 'idle2')
    assert.equal(await h.state.exportEditingSequenceToMotion3(), false)
    assert.match(h.store.presetSaveMessage, /idle2/)
    h.store.modelCapabilities = { motionGroups: { Tap: 1 } }
    h.state.editingMotion.value = undefined
    h.state.editingEmotion.value = 'happy'
    assert.equal(h.state.wholeMotionLabel.value, 'Tap', 'automatically resolved native dependencies are also visible')
    assert.equal(await h.state.exportEditingSequenceToMotion3(), false)
  } finally { h.stop() }
})

test('the outer action-library tab releases workshop ownership while preserving its unsaved draft', async () => {
  const props = Vue.reactive({ open: true, active: true, embedded: true, initialTab: 'studio', tab: 'studio' })
  const h = workshopHarness(props)
  try {
    h.state.customPresetName.value = '仍未保存的动作'
    h.state.editingSteps.value[0].parameters = { ParamAngleX: 12 }
    h.state.commitWorkshopHistory()
    h.store.presetEditingLocked = true
    const before = JSON.stringify(h.state.editingSteps.value)
    props.tab = 'states'
    await Vue.nextTick()
    assert.equal(h.state.activeTab.value, 'states')
    assert.equal(h.store.presetEditingLocked, false)
    assert.equal(h.releases(), 1, 'release the real pet window, not only the settings mirror')
    assert.equal(h.state.customPresetName.value, '仍未保存的动作')
    assert.equal(JSON.stringify(h.state.editingSteps.value), before)
    props.tab = 'studio'
    await Vue.nextTick()
    assert.equal(h.releases(), 1, 'entering the editor does not release again')
    h.store.presetEditingLocked = true
    h.state.switchTab('states')
    await Vue.nextTick()
    assert.equal(h.releases(), 2, 'both navigation paths have the same lifecycle')
  } finally { h.stop() }
})
