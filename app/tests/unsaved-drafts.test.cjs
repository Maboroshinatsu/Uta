'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Vue = require('vue')
const createLoader = require('./support/settings-loader.cjs')

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
  await Vue.nextTick()
}
const element = () => ({
  type: 'root', props: {}, children: [], parent: null,
  addEventListener() {}, removeEventListener() {}, getRootNode: () => null,
})

function mountClose(draft, bridge) {
  const load = createLoader()
  const { useSettingsClose } = load('renderer/settings-window/use-settings-close')
  const secrets = load('renderer/services/unsaved-drafts')
  const renderer = Vue.createRenderer({
    createElement: element, createText: element, createComment: element,
    insert() {}, remove() {}, patchProp() {}, setText() {}, setElementText() {},
    parentNode: () => null, nextSibling: () => null, insertStaticContent: () => [],
  })
  let exposed
  const root = element()
  const app = renderer.createApp(Vue.defineComponent({
    setup() {
      exposed = useSettingsClose(draft, bridge)
      return () => null
    },
  }))
  app.mount(root)
  return { exposed, secrets, unmount: () => app.unmount() }
}

function makeDraft(overrides = {}) {
  const draft = {
    saveStatus: Vue.ref('idle'),
    errorMessage: Vue.ref(''),
    hasPending: () => false,
    flushPending: async () => {},
    retryNow: async () => {},
    ...overrides,
  }
  return draft
}

function makeBridge() {
  const listeners = new Set()
  const responses = []
  let nextId = 0
  const bridge = {
    ready: async () => true,
    onCloseRequested: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    respond: async (id, decision) => { responses.push({ id, decision }); return true },
    close: async (reason = 'window') => {
      const request = { id: ++nextId, reason }
      for (const listener of [...listeners]) listener(request)
      await settle()
      return request
    },
    responses,
  }
  return bridge
}

test('a typed secret alone opens the close prompt and can be saved before closing', async t => {
  const draft = makeDraft()
  const bridge = makeBridge()
  const view = mountClose(draft, bridge)
  t.after(() => view.unmount())
  await settle()

  const key = Vue.ref('')
  let saved = 0
  const unregister = view.secrets.registerUnsavedDraft('tts-test', {
    kind: 'secret',
    label: '云端语音 API 密钥',
    isDirty: () => key.value.trim().length > 0,
    save: async () => { saved += 1; key.value = ''; return true },
  })
  t.after(unregister)
  key.value = 'sk-test'

  await bridge.close()
  assert.equal(view.exposed.promptOpen.value, true)
  assert.deepEqual([...view.exposed.draftLabels.value], ['云端语音 API 密钥'])

  await view.exposed.saveAndClose()
  await settle()
  assert.equal(saved, 1)
  assert.deepEqual(bridge.responses.map(r => r.decision), ['close'])
  assert.equal(view.exposed.promptOpen.value, false)
})

test('a failed secret save keeps the prompt open with the failing label', async t => {
  const draft = makeDraft()
  const bridge = makeBridge()
  const view = mountClose(draft, bridge)
  t.after(() => view.unmount())
  await settle()

  const key = Vue.ref('sk-failing')
  const unregister = view.secrets.registerUnsavedDraft('stt-test', {
    kind: 'secret',
    label: '云端识别 API 密钥',
    isDirty: () => key.value.trim().length > 0,
    save: async () => false,
  })
  t.after(unregister)

  await bridge.close()
  assert.equal(view.exposed.promptOpen.value, true)
  await view.exposed.saveAndClose()
  await settle()
  assert.equal(bridge.responses.length, 0)
  assert.match(view.exposed.closeError.value, /云端识别 API 密钥/)
  assert.equal(view.exposed.promptOpen.value, true)
})

test('without drafts the window closes without prompting, and unregister clears the reminder', async t => {
  const draft = makeDraft()
  const bridge = makeBridge()
  const view = mountClose(draft, bridge)
  t.after(() => view.unmount())
  await settle()

  await bridge.close()
  assert.equal(view.exposed.promptOpen.value, false)
  assert.deepEqual(bridge.responses.map(r => r.decision), ['close'])

  const secondBridge = makeBridge()
  const second = mountClose(draft, secondBridge)
  t.after(() => second.unmount())
  const key = Vue.ref('')
  const unregister = second.secrets.registerUnsavedDraft('tts-empty', {
    kind: 'secret',
    label: '云端语音 API 密钥',
    isDirty: () => key.value.trim().length > 0,
    save: async () => true,
  })
  key.value = 'sk-live'
  await settle()
  assert.deepEqual([...second.exposed.draftLabels.value], ['云端语音 API 密钥'])
  unregister()
  await settle()
  assert.deepEqual([...second.exposed.draftLabels.value], [])
})

test('secret saving only runs entries that are still dirty and reports each failure once', async () => {
  const load = createLoader()
  const { registerUnsavedDraft, saveUnsavedDrafts, hasUnsavedDraft } = load('renderer/services/unsaved-drafts')
  const clean = Vue.ref(false)
  const dirty = Vue.ref(true)
  const failing = Vue.ref(true)
  const calls = []
  const offA = registerUnsavedDraft('a', {
    kind: 'secret', label: 'A 密钥', isDirty: () => clean.value, save: async () => { calls.push('a'); return true },
  })
  const offB = registerUnsavedDraft('b', {
    kind: 'secret', label: 'B 密钥', isDirty: () => dirty.value, save: async () => { calls.push('b'); return true },
  })
  const offC = registerUnsavedDraft('c', {
    kind: 'secret', label: 'C 密钥', isDirty: () => failing.value, save: async () => { calls.push('c'); throw new Error('offline') },
  })
  assert.equal(hasUnsavedDraft.value, true)
  const result = await saveUnsavedDrafts()
  assert.deepEqual(calls, ['b', 'c'])
  assert.equal(result.ok, false)
  assert.deepEqual([...result.failed], ['C 密钥'])
  dirty.value = false
  failing.value = false
  assert.equal(hasUnsavedDraft.value, false)
  offA(); offB(); offC()
  assert.equal(hasUnsavedDraft.value, false)
})
