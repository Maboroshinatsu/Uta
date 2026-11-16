'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Vue = require('vue'), Pinia = require('pinia')
const createLoader = require('./support/settings-loader.cjs')
const KEY = 'deskpet/state-presets-v3', MODEL = 'uta://models/shared/model.model3.json'
const plain = value => JSON.parse(JSON.stringify(value))
const headY = { id: 'ParamAngleY', label: '低头抬头', min: -2, max: 2, defaultValue: 0, value: 0 }
const preset = (label, id = label) => ({ id, label, emotion: 'neutral', group: '自定义', controls: [], parameters: { ParamAngleX: 4 }, steps: [{ controls: [], parameters: { ParamAngleX: 4 }, durationMs: 300, holdMs: 500 }], finishMode: 'hold', custom: true })
function fixture(t, initial = {}) {
  const memory = new Map(Object.entries(initial)), listeners = new Set(), diskWrites = []
  let fail = false
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { if (fail && key === KEY) throw Error('fixture quota'); memory.set(key, String(value)) } }
  const globals = { localStorage: storage, window: { location: { search: '', hash: '' }, matchMedia: () => ({ matches: false }),
    addEventListener: (type, fn) => { if (type === 'storage') listeners.add(fn) }, removeEventListener: (type, fn) => listeners.delete(fn),
    utaAPI: { saveModelPresets: (...args) => { diskWrites.push(args); return Promise.resolve(true) } },
  }, document: { documentElement: { setAttribute() {}, style: { setProperty() {}, removeProperty() {} } } } }
  const load = createLoader({ vue: Vue, pinia: Pinia }, globals), pinia = Pinia.createPinia()
  const store = load('renderer/stores/deskpet').useDeskpetStore(pinia)
  store.modelUrl = MODEL
  t.after(() => { store.$dispose(); pinia._e.stop() })
  return { store, load, memory, diskWrites, listeners, fail: value => { fail = value },
    publish: () => { for (const fn of [...listeners]) fn({ key: KEY, storageArea: storage }) },
  }
}
test('existing user presets win over different sidecars and do not automatically add deleted working groups', t => {
  const h = fixture(t, { [KEY]: JSON.stringify({ [MODEL]: [preset('user-edited')] }) })
  assert.equal(h.store.ensureModelPresetsSeeded([preset('old-disk')]), true)
  assert.deepEqual(h.store.statePresets.map(p => p.label), ['user-edited'])
  assert.equal(h.diskWrites.length, 0)
})
test('a user import can replace a preset twice without removing its default compile slot', t => {
  const h = fixture(t)
  const defaultPreset = { ...preset('默认开心', 'happy'), emotion: 'happy' }
  h.store.ensureModelPresetsSeeded([defaultPreset])
  const { buildPresetExport } = h.load('renderer/services/preset-transfer')
  for (const label of ['草稿一', '草稿二']) {
    const slot = h.store.defaultStatePresets.find(p => p.id === 'happy')
    assert.equal(slot.label, '开心')
    assert.equal(h.store.importUserPresets(buildPresetExport(MODEL, MODEL, [{ ...slot, label }])).replaced, 1)
    assert.equal(h.store.statePresets.find(p => p.id === 'happy').label, label)
  }
})
test('explicit empty user buckets survive seeding and actual store recreation', t => {
  const initial = { [KEY]: JSON.stringify({ [MODEL]: [] }) }, a = fixture(t, initial)
  assert.equal(a.store.ensureModelPresetsSeeded([preset('old-disk')]), true)
  assert.equal(a.store.statePresets.length, 0)
  const b = fixture(t, Object.fromEntries(a.memory))
  b.store.ensureModelPresetsSeeded([preset('old-disk')])
  assert.equal(b.store.statePresets.length, 0)
})
test('first-use old sidecars seed once; deleting a working preset does not bring it back on reload', t => {
  const a = fixture(t)
  a.store.modelSliders = [headY]
  a.store.ensureModelPresetsSeeded([preset('legacy')])
  assert.ok(a.store.statePresets.some(p => p.label === 'legacy'))
  const working = a.store.statePresets.find(p => p.group === '思考')
  assert.ok(working)
  assert.equal(a.store.deleteCustomPreset(working.id), true)
  const b = fixture(t, Object.fromEntries(a.memory))
  b.store.ensureModelPresetsSeeded([preset('different-sidecar')])
  assert.equal(b.store.statePresets.some(p => p.id === working.id), false)
  assert.ok(b.store.statePresets.some(p => p.label === 'legacy'))
  assert.equal(b.diskWrites.length + a.diskWrites.length, 0)
})
test('edited steps, finish mode and voice-independent user presets persist across recreation', t => {
  const a = fixture(t)
  a.store.ensureModelPresetsSeeded([])
  const saved = a.store.saveCustomPreset('my sequence', [], {}, 'happy', { steps: preset('input').steps, finishMode: 'loop', group: '自己的组' })
  assert.ok(saved)
  const b = fixture(t, Object.fromEntries(a.memory))
  b.store.ensureModelPresetsSeeded([preset('older')])
  assert.equal(b.store.statePresets.length, 1)
  assert.equal(b.store.statePresets[0].label, 'my sequence')
  assert.equal(b.store.statePresets[0].steps[0].parameters.ParamAngleX, 4)
  assert.equal(b.store.statePresets[0].finishMode, 'loop')
})
test('quota failure keeps prior list and disk record, reports failure, and retry commits exactly once', t => {
  const h = fixture(t, { [KEY]: JSON.stringify({ [MODEL]: [preset('original')] }) }), before = h.memory.get(KEY)
  h.fail(true)
  assert.equal(h.store.saveCustomPreset('new-name', [], {}), null)
  assert.equal(h.store.presetSaveStatus, 'error'); assert.match(h.store.presetSaveMessage, /未保存/)
  assert.equal(h.memory.get(KEY), before)
  assert.deepEqual(h.store.statePresets.map(p => p.label), ['original'])
  h.fail(false)
  assert.ok(h.store.saveCustomPreset('new-name', [], {}))
  assert.equal(h.store.statePresets.filter(p => p.label === 'new-name').length, 1)
  assert.equal(h.store.presetSaveStatus, 'success')
})
test('failed delete or restore leaves prior active hold and saved presets intact', t => {
  const h = fixture(t, { [KEY]: JSON.stringify({ [MODEL]: [preset('pinned')] }) }), before = h.memory.get(KEY)
  h.store.activeHoldPresetId = 'pinned'; h.fail(true)
  assert.equal(h.store.deleteCustomPreset('pinned'), false)
  assert.equal(h.store.restoreDefaultPresets(), null)
  assert.equal(h.store.activeHoldPresetId, 'pinned')
  assert.equal(h.memory.get(KEY), before)
})
test('malformed or unreadable storage is not replaced by seeds, edits, deletes or default restore', t => {
  for (const raw of ['{bad', '[]', JSON.stringify({ [MODEL]: null }), JSON.stringify({ [MODEL]: [{ id: 'missing-label' }] })]) {
    const h = fixture(t, { [KEY]: raw })
    assert.equal(h.store.ensureModelPresetsSeeded([preset('seed')]), false)
    assert.equal(h.store.saveCustomPreset('attempt'), null)
    assert.equal(h.store.deleteCustomPreset('seed'), false)
    assert.equal(h.store.restoreDefaultPresets(), null)
    assert.equal(h.memory.get(KEY), raw)
  }
})
test('saving one model merges the latest other model buckets instead of overwriting them from a stale window', t => {
  const h = fixture(t, { [KEY]: JSON.stringify({ [MODEL]: [preset('a')] }) })
  h.memory.set(KEY, JSON.stringify({ [MODEL]: [preset('a'), preset('from-other-window')], 'uta://models/second/model.model3.json': [preset('second-model')] }))
  assert.ok(h.store.saveCustomPreset('latest-local-edit'))
  const saved = JSON.parse(h.memory.get(KEY))
  assert.equal(saved[MODEL].length, 3)
  assert.equal(saved['uta://models/second/model.model3.json'][0].label, 'second-model')
})
test('storage events synchronize the actual pet store without writing or echoing model files; disposal removes listeners', t => {
  const h = fixture(t, { [KEY]: JSON.stringify({ [MODEL]: [preset('old')] }) })
  h.memory.set(KEY, JSON.stringify({ [MODEL]: [preset('new')] }))
  h.publish()
  assert.equal(h.store.statePresets[0].label, 'new')
  assert.equal(h.diskWrites.length, 0)
  assert.equal(h.listeners.size, 1)
  h.store.$dispose()
  assert.equal(h.listeners.size, 0)
})
test('separate profiles sharing a model URL retain independent presets and never invoke sidecar writing', t => {
  const a = fixture(t), b = fixture(t)
  a.store.ensureModelPresetsSeeded([]); b.store.ensureModelPresetsSeeded([])
  a.store.saveCustomPreset('profile-a'); b.store.saveCustomPreset('profile-b')
  assert.deepEqual(plain(a.store.statePresets.map(p => p.label)), ['profile-a'])
  assert.deepEqual(plain(b.store.statePresets.map(p => p.label)), ['profile-b'])
  assert.equal(a.diskWrites.length + b.diskWrites.length, 0)
})
test('explicit bridge reload refreshes preset data without echoing another save notification', t => {
  const h = fixture(t, { [KEY]: JSON.stringify({ [MODEL]: [preset('before')] }) })
  const before = h.memory.get(KEY)
  h.memory.set(KEY, JSON.stringify({ [MODEL]: [preset('after-bridge-save')] }))
  h.store.reloadPersistedUiState()
  assert.equal(h.store.statePresets[0].label, 'after-bridge-save')
  assert.notEqual(h.memory.get(KEY), before)
  assert.equal(h.diskWrites.length, 0)
})
test('persistence rejects reserved keys and oversized input without modifying prior storage', t => {
  const h = fixture(t)
  const service = h.load('renderer/services/preset-persistence').createPresetPersistence({ getItem: () => null, setItem: () => { throw Error('must not reach for invalid key') } }, x => x)
  assert.equal(service.writeBucket('__proto__', [preset('bad')]).ok, false)
  h.memory.set(KEY, ' '.repeat(4 * 1024 * 1024 + 1))
  assert.equal(h.store.saveCustomPreset('attempt'), null)
  assert.equal(h.memory.get(KEY).length, 4 * 1024 * 1024 + 1)
})

test('saving multiple custom presets in a synchronous loop produces strictly unique IDs', t => {
  const h = fixture(t)
  const ids = []
  for (let i = 0; i < 24; i++) {
    const p = h.store.saveCustomPreset(`动作 ${i}`, [], {}, 'neutral')
    assert.ok(p)
    ids.push(p.id)
  }
  const uniqueIds = new Set(ids)
  assert.equal(uniqueIds.size, 24, 'All 24 generated preset IDs must be unique')
})


test('fresh and restored model presets use only shared DaFish slots with model-local animation data', t => {
  const h = fixture(t)
  h.store.modelSliders = [headY]
  const { buildDafishNaturalPresets } = h.load('renderer/services/live2d/natural-presets')
  const slots = list => plain(list.map(({ label, group, emotion }) => ({ label, group, emotion })))
  const expected = slots(buildDafishNaturalPresets().filter(p => p.id !== 'well_actually'))
  assert.equal(expected.length, 8)
  assert.equal(h.store.ensureModelPresetsSeeded(), true)
  assert.deepEqual(slots(h.store.statePresets), expected)
  assert.deepEqual(slots(h.store.defaultStatePresets), expected)
  assert.equal(h.store.deleteCustomPreset('happy'), true)
  assert.deepEqual(slots(h.store.restoreDefaultPresets()), expected)
})

test('legacy migration removes only retired built-ins and preserves overrides, deletions and other models', t => {
  const other = 'uta://models/second/model.model3.json'
  const otherBucket = [{ ...preset('第二个模型'), description: '' }]
  const current = [preset('旧待机', 'neutral'), preset('旧歪头笑', 'happy_tilt'), preset('旧等待', 'waiting'),
    { ...preset('我的开心', 'happy'), source: 'user' }, { ...preset('我改过的专注', 'focus'), source: 'user' },
    preset('旧版个人预设', 'preset_legacy'), preset('模型附带动作', 'model_gesture')]
  const h = fixture(t, { [KEY]: JSON.stringify({ [MODEL]: current, [other]: otherBucket }),
    [`deskpet/natural-presets-v3:${MODEL}`]: '1', [`deskpet/continuous-pack-v1:${MODEL}`]: '1' })
  h.store.modelSliders = [headY]
  h.fail(true)
  assert.equal(h.store.ensureModelPresetsSeeded(), false)
  assert.deepEqual(JSON.parse(h.memory.get(KEY))[MODEL], current)
  h.fail(false)
  assert.equal(h.store.ensureModelPresetsSeeded(), true)
  assert.deepEqual(plain(h.store.statePresets.map(p => p.label)),
    ['日常待机', '我的开心', '我改过的专注', '旧版个人预设', '模型附带动作'])
  assert.equal(h.store.defaultStatePresets.find(p => p.id === 'happy').label, '开心')
  assert.deepEqual(plain(h.store.statePresets.find(p => p.id === 'happy').steps), current[3].steps)
  assert.deepEqual(JSON.parse(h.memory.get(KEY))[other], otherBucket)
  assert.equal(h.store.deleteCustomPreset('happy'), true)
  const reloaded = fixture(t, Object.fromEntries(h.memory))
  reloaded.store.modelSliders = [headY]
  assert.equal(reloaded.store.ensureModelPresetsSeeded(), true)
  assert.ok(!reloaded.store.statePresets.some(p => p.id === 'happy'))
  assert.equal(h.diskWrites.length + reloaded.diskWrites.length, 0)
})

test('version-three migration removes the generic performance while retaining a user override of the same ID', t => {
  const builtIn = preset('well actually......', 'well_actually')
  for (const performance of [builtIn, { ...builtIn, label: '我的表演', source: 'user' }]) {
    const h = fixture(t, { [KEY]: JSON.stringify({ [MODEL]: [preset('旧待机', 'neutral'), performance] }),
      [`deskpet/default-preset-slots-v2:${MODEL}`]: '1' })
    h.store.modelSliders = [headY]
    assert.equal(h.store.ensureModelPresetsSeeded(), true)
    assert.deepEqual(plain(h.store.statePresets.map(p => p.label)),
      performance.source === 'user' ? ['日常待机', '我的表演'] : ['日常待机'])
    assert.ok(!h.store.defaultStatePresets.some(p => p.id === 'well_actually'))
    assert.equal(JSON.parse(h.memory.get(KEY))[MODEL].some(p => p.id === 'well_actually'), performance.source === 'user')
  }
})

test('DaFish legacy upgrade preserves a user override even if the old bucket also had its built-in copy', t => {
  const id = 'dafish_body_led_happy_v4'
  const current = [preset('旧开心', 'dafish_happy_v2'), preset('内置开心', id),
    { ...preset('我的大肥鱼开心', id), source: 'user' }]
  const h = fixture(t, { [KEY]: JSON.stringify({ [MODEL]: current }) })
  h.store.modelControls = [{ id: '狗尾草' }, { id: '抚胸' }]
  h.store.modelCapabilities = { motionGroups: { [h.load('renderer/services/live2d/dafish-body-led-happy').DAFISH_BODY_LED_HAPPY_MOTION]: 1 } }
  assert.equal(h.store.ensureModelPresetsSeeded(), true)
  assert.equal(h.store.statePresets.length, 9)
  assert.equal(h.store.statePresets.find(p => p.id === 'well_actually').motion.group, '趣味·Well actually')
  assert.deepEqual(plain(h.store.statePresets.filter(p => p.id === id).map(p => p.label)), ['我的大肥鱼开心'])
  assert.equal(h.store.defaultStatePresets.find(p => p.id === id).label, '开心')
})

test('a single custom head channel is enough for seven distinguishable reactions', t => {
  const h = fixture(t)
  h.store.modelSliders = [{ ...headY, id: 'pitch_input', min: -10, max: 2, defaultValue: -2, value: -2 },
    { ...headY, id: 'ParamBodyAngleY' }]
  h.store.modelCapabilities = {
    parameters: [{ id: 'ParamBodyAngleY', isPhysicsOutput: true }], motionGroups: {},
    vtubeFocusBindings: [{ input: 'FaceAngleY', output: 'pitch_input', lower: 2, upper: -10 }],
  }
  assert.equal(h.store.ensureModelPresetsSeeded(), true)
  const animated = h.store.statePresets.filter(p => p.id !== 'neutral')
  assert.equal(animated.length, 7)
  const traces = animated.map(p => p.steps.map(step => {
    assert.deepEqual(Object.keys(step.parameters), ['pitch_input'])
    assert.ok(step.parameters.pitch_input >= -10 && step.parameters.pitch_input <= 2)
    return [step.durationMs, step.parameters.pitch_input]
  }))
  assert.equal(new Set(traces.map(trace => JSON.stringify(trace))).size, 7)
  assert.ok(animated.find(p => p.id === 'happy').steps[0].parameters.pitch_input < -2, 'reversed binding makes the up pose use lower values')
  assert.ok(animated.find(p => p.id === 'sad').steps[0].parameters.pitch_input > -2)
})

test('a motion-only model exposes its named action and keeps unsupported default slots for authoring', t => {
  const h = fixture(t)
  h.store.modelCapabilities = { parameters: [], motionGroups: { happy: 1, Tap: 1 }, motionDetails: { 'happy#0': { durationMs: 5600 } } }
  assert.equal(h.store.ensureModelPresetsSeeded(), true)
  assert.deepEqual(plain(h.store.statePresets.map(p => p.id)), ['neutral', 'happy'])
  const happy = h.store.statePresets[1]
  assert.deepEqual(plain(happy.motion), { group: 'happy', index: 0 })
  assert.equal(happy.steps[0].durationMs + happy.steps[0].holdMs, 5600)
  assert.equal(h.store.defaultStatePresets.length, 8)
})

test('version-two migration updates the old pose data and leaves deleted version-one slots deleted', t => {
  const h = fixture(t, { [KEY]: JSON.stringify({ [MODEL]: [preset('旧开心', 'happy')] }),
    [`deskpet/default-preset-slots-v1:${MODEL}`]: '1' })
  h.store.modelSliders = [headY]
  assert.equal(h.store.ensureModelPresetsSeeded(), true)
  assert.deepEqual(plain(h.store.statePresets.map(p => p.label)), ['开心'])
  assert.ok(h.store.statePresets[0].steps[0].parameters.ParamAngleY > 0)
})

test('similar accessory names do not select DaFish actions when its native performance is unavailable', t => {
  const id = 'dafish_body_led_happy_v4'
  const current = [preset('旧错配开心', id), { ...preset('我的部件动作', 'dafish_body_led_sad'), source: 'user' }]
  const h = fixture(t, { [KEY]: JSON.stringify({ [MODEL]: current }), [`deskpet/dafish-purged-legacy-v9:${MODEL}`]: '1' })
  h.store.modelControls = [{ id: '长短裙' }, { id: '爱心眼' }]
  h.store.modelSliders = [headY]
  h.store.modelCapabilities = { parameters: [], motionGroups: {} }
  assert.equal(h.store.ensureModelPresetsSeeded(), true)
  assert.equal(h.store.statePresets.length, 9)
  assert.equal(h.store.statePresets.find(p => p.id === 'happy').motion, 'none')
  assert.equal(h.store.statePresets.find(p => p.id === 'dafish_body_led_sad').label, '我的部件动作')
  assert.ok(!h.store.statePresets.some(p => p.id === id))
})
