'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const Vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')

const copy = value => JSON.parse(JSON.stringify(value))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function settle() {
  for (let i = 0; i < 8; i++) { await Promise.resolve(); await Vue.nextTick() }
}

// Compile the production SFC, composable, controls and SettingsClient. Only the
// Electron transport and unrelated legacy workspaces are replaced.
async function mountWindow(t, initial = {}, search = '?domain=appearance') {
  const cache = new Map()
  const errors = []
  const timers = new Map()
  let timerId = 0
  let client
  const closeListeners = new Set()
  const closeResponses = []
  let closeId = 0
  let closed = false
  const closeBridge = {
    ready: async () => true,
    onCloseRequested: listener => { closeListeners.add(listener); return () => closeListeners.delete(listener) },
    respond: async (id, decision) => {
      if (id !== closeId) return false
      closeResponses.push({ id, decision })
      if (decision === 'close') { closed = true; unmount() }
      return control.closeReply ? control.closeReply() : true
    },
  }
  const document = { activeElement: null, body: { offsetHeight: 0 }, documentElement: { setAttribute() {} } }
  const oldDocument = global.document
  const oldDocumentClass = global.Document
  const oldShadowRoot = global.ShadowRoot
  global.document = document
  global.Document = class TestDocument {}
  global.ShadowRoot = class TestShadowRoot {}
  if (!global.window) {
    global.window = global
  }
  if (!global.getComputedStyle) {
    global.getComputedStyle = () => ({ transitionDuration: '0s', transitionDelay: '0s', animationDuration: '0s', animationDelay: '0s' })
  }
  if (!global.requestAnimationFrame) {
    global.requestAnimationFrame = fn => setTimeout(fn, 0)
    global.cancelAnimationFrame = id => clearTimeout(id)
  }
  const legacy = new Set([
    'SettingsPanel.vue', 'RuntimeDiagnostics.vue', 'TtsSettingsSection.vue', 'SttSettingsSection.vue',
    'AdapterPluginSettings.vue', 'ConnectionsDomain.vue',
    'SettingsImportPanel.vue', 'SettingsTransferPanel.vue', 'ModelCalibrationPanel.vue', 'OnboardingFlow.vue',
  ])
  const clickThroughWrites = []
  const store = Vue.reactive({
    modelUrl: 'live2d/hiyori/hiyori.model3.json',
    modelLoaded: true,
    modelControls: [],
    modelSliders: [],
    modelEmotions: [],
    modelCapabilities: null,
    emotionAdapter: null,
    activeHoldPresetId: 'neutral',
    activeRunningPresetId: '',
    presetEditingLocked: false,
    modelActionStatus: 'idle',
    modelActionMessage: '',
    statePresets: [
      { id: 'neutral', label: '日常待机', emotion: 'neutral', controls: [], steps: [] },
      { id: 'happy', label: '开心', emotion: 'happy', controls: [], steps: [] },
    ],
    requestModelSwitch: async () => {},
  })
  const overrides = {
    '@/stores/deskpet': { useDeskpetStore: () => store },
    '@/services/live2d/model-discovery': {
      listAvailableModels: async () => [{ url: 'live2d/hiyori/hiyori.model3.json', name: 'Hiyori', kind: 'live2d' }],
      getStoredModelPath: () => 'live2d/hiyori/hiyori.model3.json',
      kindOfModelUrl: () => 'live2d',
    },
  }
  function load(file) {
    if (file.endsWith('.css')) return {}
    if (legacy.has(path.basename(file))) return { default: { render: () => Vue.h('div') } }
    if (cache.has(file)) return cache.get(file)
    let source = fs.readFileSync(file, 'utf8')
    if (file.endsWith('.vue')) {
      source = compileScript(parse(source, { filename: file }).descriptor, { id: path.basename(file), inlineTemplate: true }).content
    }
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const mod = { exports: {} }
    cache.set(file, mod.exports)
    vm.runInNewContext(code, {
      module: mod, exports: mod.exports, console, document,
      window: {
        location: { search }, innerWidth: 960,
        utaAPI: {
          settingsWindow: closeBridge,
          getUiState: async () => ({ clickThroughLocked: false, hoverFadeEnabled: false, voiceShortcut: 'Ctrl+Alt+V' }),
          setClickThroughLocked: async value => { clickThroughWrites.push(value) },
        },
      },
      URLSearchParams,
      HTMLElement: Object,
      setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id },
      clearTimeout: id => timers.delete(id),
      require: name => {
        if (name === 'vue') return Vue
        if (name === '../ModelImportPreview.vue') return {}
        if (Object.hasOwn(overrides, name)) return overrides[name]
        if (name === '../services/settings-client') return { settingsClient: client }
        if (name.startsWith('@/')) {
          let resolved = path.join(__dirname, '../src/renderer', name.slice(2))
          if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
            if (fs.existsSync(`${resolved}.ts`)) resolved = `${resolved}.ts`
            else if (fs.existsSync(path.join(resolved, 'index.ts'))) resolved = path.join(resolved, 'index.ts')
          }
          return load(resolved)
        }
        if (!name.startsWith('.')) throw new Error(`Unexpected import: ${name}`)
        let resolved = path.resolve(path.dirname(file), name)
        if (!fs.existsSync(resolved)) resolved += '.ts'
        return load(resolved)
      },
    })
    return mod.exports
  }
  const defaults = load(path.join(__dirname, '../src/shared/settings-contracts.ts')).PUBLIC_SETTINGS_DEFAULTS
  let stored = { schemaVersion: 1, revision: 0, values: { ...defaults, ...initial }, claimedKeys: [], imports: [], conflicts: [] }
  const listeners = new Set()
  const requests = []
  const control = { handler: null }
  function broadcast() { for (const listener of listeners) listener(copy(stored)) }
  function commit(request) {
    if (request.expectedRevision !== stored.revision) return { ok: false, code: 'revision-conflict', currentRevision: stored.revision }
    stored = { ...stored, revision: stored.revision + 1, values: { ...stored.values, ...request.changes } }
    broadcast()
    return { ok: true, changed: true, document: copy(stored) }
  }
  const bridge = {
    getMode: async () => 'canonical-dev',
    read: async () => ({ status: 'ready', document: copy(stored) }),
    onChanged: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    patch: async request => {
      requests.push(copy(request))
      return control.handler ? control.handler(copy(request)) : commit(request)
    },
  }
  const { SettingsClient } = load(path.join(__dirname, '../src/renderer/services/settings-client/client.ts'))
  client = new SettingsClient()
  assert.equal((await client.init(bridge)).ok, true)
  const element = type => {
    const classSet = new Set()
    return {
      type, tagName: type.toUpperCase(), text: '', props: {}, children: [], parent: null,
      ownerDocument: document,
      classList: {
        add(...names) { names.forEach(n => classSet.add(n)) },
        remove(...names) { names.forEach(n => classSet.delete(n)) },
        contains(name) { return classSet.has(name) },
      },
      value: '', addEventListener() {}, removeEventListener() {}, getRootNode: () => document,
      focus() { document.activeElement = this },
      querySelectorAll() {
        const walk = node => [node, ...node.children.flatMap(walk)]
        return walk(this).filter(node => node.type === 'button' && !node.props.disabled)
      },
    }
  }
  const remove = node => { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null }
  const insert = (node, parent, anchor) => {
    if (node.parent) remove(node)
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
  }
  const renderer = Vue.createRenderer({
    createElement: element, createText: text => ({ ...element('#text'), text }), createComment: () => element('#comment'),
    insert, remove, patchProp: (node, key, _old, value) => { node.props[key] = value; if (key === 'value') node.value = value },
    setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text; node.children = [] },
    parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
    insertStaticContent: (text, parent, anchor) => { const node = { ...element('#static'), text }; insert(node, parent, anchor); return [node, node] },
  })
  const root = element('root')
  const app = renderer.createApp(load(path.join(__dirname, '../src/renderer/settings-window/SettingsWindowApp.vue')).default)
  app.config.errorHandler = error => errors.push(error)
  app.mount(root)
  let mounted = true
  function unmount() { if (mounted) { app.unmount(); mounted = false } }
  t.after(() => {
    unmount(); client.dispose(); global.document = oldDocument
    global.Document = oldDocumentClass; global.ShadowRoot = oldShadowRoot
    assert.deepEqual(errors, [], 'production component must not report render/lifecycle errors')
    assert.equal(timers.size, 0, 'success timers must be cleared when the page closes')
  })
  const all = node => [node, ...node.children.flatMap(all)]
  const text = node => node.text + node.children.map(text).join('')
  const find = predicate => { const node = all(root).find(predicate); assert.ok(node, 'Expected rendered node'); return node }
  const button = label => find(node => node.type === 'button' && text(node).includes(label))
  const color = () => find(node => node.type === 'input' && node.props.id === 'accent-color-hex')
  await settle()
  return {
    root, requests, control, commit, unmount, button, find, store,
    text: () => text(root), color: () => color().value,
    moduleFor: suffix => {
      const entry = [...cache.entries()].find(([file]) => file.includes(suffix))
      return entry?.[1]
    },
    clickThroughWrites,
    closeResponses, isClosed: () => closed,
    focusedLabel: () => document.activeElement ? text(document.activeElement) : '',
    pressDialogKey: async (key, shiftKey = false) => {
      const dialog = find(node => node.props.role === 'alertdialog')
      const event = { key, shiftKey, preventDefault() {}, stopPropagation() {} }
      for (const listener of [dialog.props.onKeydown].flat()) listener(event)
      await settle()
    },
    requestClose: async (reason = 'window') => {
      const request = { id: ++closeId, reason }
      for (const listener of [...closeListeners]) listener(request)
      await settle()
    },
    editColor: async value => { color().props.onInput({ target: { value } }); await settle() },
    flushTimers: async () => {
      const pending = [...timers.entries()]
      for (const [id, fn] of pending) { timers.delete(id); fn() }
      await settle()
    },
    remote: async changes => { stored = { ...stored, revision: stored.revision + 1, values: { ...stored.values, ...changes } }; broadcast(); await settle() },
    stored: () => copy(stored),
  }
}

test('chat display name autosaves, follows other-window changes and clears back to the host default', async t => {
  const view = await mountWindow(t, {}, '?domain=desktop')
  const field = () => view.find(node => node.type === 'input' && node.props.id === 'chat-display-name')
  assert.equal(field().value, '')
  field().props.onInput({ target: { value: '小鱼' } })
  await view.flushTimers()
  assert.equal(view.stored().values.chatDisplayName, '小鱼')
  await view.remote({ chatDisplayName: '另一称呼' })
  assert.equal(field().value, '另一称呼')
  field().props.onInput({ target: { value: '' } })
  await view.flushTimers()
  assert.equal(view.stored().values.chatDisplayName, '')
})

test('invalid settings domain keeps a usable default page and writes nothing on open', async t => {
  const view = await mountWindow(t, {}, '?domain=unknown-domain')
  assert.ok(view.text().includes('模型与动作'))
  assert.ok(view.text().includes('当前模型'))
  assert.ok(view.text().includes('改动会自动保存到本机'))
  assert.ok(!view.text().includes('保存更改'))
  assert.equal(view.requests.length, 0)
})

test('the settings centre opens on character and offers all seven destinations without mock leaks', async t => {
  const view = await mountWindow(t, {}, '')
  for (const label of ['模型与动作', '连接与会话', '待办', '语音', '桌面与交互', '外观与性能', '关于与诊断']) {
    assert.ok(view.button(label), `expected navigation destination ${label}`)
  }
  assert.ok(view.text().includes('动作库与预设工坊'))
  assert.ok(view.text().includes('日常待机'))
  assert.ok(view.find(node => node.type === 'svg'), 'navigation uses inline SVG icons')
  assert.ok(!view.text().includes('开发预览'))
  assert.ok(!view.text().includes('模拟数据'))
  assert.ok(!view.text().includes('示例云端服务'))
  assert.ok(!view.text().includes('rev.'), 'revision detail belongs to the about page')
})

test('desktop interaction switches save immediately through the public settings store', async t => {
  const view = await mountWindow(t, {}, '?domain=desktop')
  const gaze = view.find(node => node.props['aria-label'] === '视线跟随光标')
  assert.equal(gaze.props['aria-checked'], true)
  gaze.props.onClick(); await settle()
  assert.deepEqual(view.requests[0].changes, { gazeFollowEnabled: false })
  assert.equal(view.stored().values.gazeFollowEnabled, false)
  assert.ok(view.text().includes('已自动保存'))
  assert.ok(!view.text().includes('保存更改'))
})

test('click-through mirrors and calls the real main-process bridge', async t => {
  const view = await mountWindow(t, {}, '?domain=desktop')
  const toggle = view.find(node => node.props['aria-label'] === '锁定鼠标穿透')
  assert.equal(toggle.props['aria-checked'], false)
  toggle.props.onClick(); await settle()
  assert.deepEqual(view.clickThroughWrites, [true])
})

test('theme and accent save on change, with a short debounce for colour input', async t => {
  const view = await mountWindow(t, {}, '?domain=appearance')
  view.button('安静、低亮').props.onClick(); await settle()
  assert.deepEqual(view.requests[0].changes, { themeMode: 'dark' })
  assert.equal(view.stored().values.themeMode, 'dark')
  await view.editColor('#123456')
  await view.flushTimers()
  assert.equal(view.requests.length, 2)
  assert.deepEqual(view.requests[1].changes, { accentColor: '#123456' })
  assert.equal(view.stored().values.accentColor, '#123456')
  assert.ok(view.text().includes('已自动保存'))
  assert.ok(!view.text().includes('保存更改'))
})

test('voice page explains the two save scopes and contains no simulated preview controls', async t => {
  const view = await mountWindow(t, {}, '?domain=voice')
  assert.ok(view.text().includes('语音播报'))
  assert.ok(view.text().includes('语音输入'))
  assert.ok(view.text().includes('这里的保存规则'))
  assert.ok(view.text().includes('API 密钥在对应服务中单独保存'))
  assert.ok(!view.text().includes('模拟'))
  assert.ok(!view.text().includes('开发预览'))
})

test('remote changes land immediately when there is no local edit', async t => {
  const view = await mountWindow(t, { accentColor: '#123456', themeMode: 'dark' })
  assert.equal(view.color(), '#123456')
  await view.remote({ accentColor: '#654321' })
  assert.equal(view.color(), '#654321')
  assert.equal(view.requests.length, 0)
})

test('instant writes patch only changed fields and keep unrelated remote values', async t => {
  const view = await mountWindow(t, { ttsVolume: 0.5 })
  await view.editColor('#123456')
  await view.flushTimers()
  await view.remote({ ttsVolume: 0.35 })
  assert.equal(view.color(), '#123456')
  assert.equal(view.requests.length, 1)
  assert.deepEqual(view.requests[0].changes, { accentColor: '#123456' })
  assert.equal(view.stored().values.ttsVolume, 0.35)
})

test('a revision conflict retries the same instant write instead of dropping it', async t => {
  const view = await mountWindow(t, {}, '?domain=desktop')
  let conflicts = 1
  view.control.handler = request => {
    if (conflicts-- > 0) return { ok: false, code: 'revision-conflict', currentRevision: request.expectedRevision }
    return view.commit(request)
  }
  const gaze = view.find(node => node.props['aria-label'] === '视线跟随光标')
  gaze.props.onClick(); await settle(); await settle()
  assert.equal(view.requests.length, 2)
  assert.equal(view.stored().values.gazeFollowEnabled, false)
  assert.ok(view.text().includes('已自动保存'))
})

test('rapid accent edits serialise and the last value wins', async t => {
  const view = await mountWindow(t)
  const response = deferred()
  let first = true
  view.control.handler = request => {
    if (first) { first = false; return response.promise }
    return view.commit(request)
  }
  await view.editColor('#123456')
  await view.flushTimers()
  await view.editColor('#654321')
  await view.flushTimers()
  response.resolve(view.commit(view.requests[0]))
  await settle()
  assert.equal(view.stored().values.accentColor, '#654321')
  assert.equal(view.color(), '#654321')
})

test('failed writes show a retryable error without leaking raw details', async t => {
  const view = await mountWindow(t, {}, '?domain=desktop')
  view.control.handler = () => { throw new Error('private-path-and-token') }
  const gaze = view.find(node => node.props['aria-label'] === '视线跟随光标')
  gaze.props.onClick(); await settle()
  assert.ok(view.text().includes('设置未能保存到本机'))
  assert.ok(!view.text().includes('private-path-and-token'))
  view.control.handler = null
  view.button('点击重试').props.onClick(); await settle()
  assert.equal(view.stored().values.gazeFollowEnabled, false)
  assert.ok(view.text().includes('已自动保存'))
})

test('a later field success does not hide an earlier failed autosave', async t => {
  const view = await mountWindow(t, {}, '?domain=desktop')
  let failFirst = true
  view.control.handler = request => {
    if (failFirst) { failFirst = false; throw new Error('disk-full') }
    return view.commit(request)
  }
  const gaze = view.find(node => node.props['aria-label'] === '视线跟随光标')
  gaze.props.onClick(); await settle()
  assert.equal(view.stored().values.gazeFollowEnabled, true)
  assert.ok(view.text().includes('设置未能保存到本机'))

  const idle = view.find(node => node.props['aria-label'] === '待机微动作')
  idle.props.onClick(); await settle()
  assert.equal(view.stored().values.idleActionsEnabled, false)
  assert.ok(view.text().includes('部分设置尚未保存'), 'the failed field must stay visible as an error')
  assert.ok(!view.text().includes('已自动保存'), 'a different field success must not mask the failure')

  await view.flushTimers()
  assert.equal(view.stored().values.gazeFollowEnabled, false, 'the retry must still write the failed field')
  assert.ok(view.text().includes('已自动保存'))
})

test('closing retries a failed autosave instead of dropping it', async t => {
  const view = await mountWindow(t, {}, '?domain=desktop')
  let failFirst = true
  view.control.handler = request => {
    if (failFirst) { failFirst = false; throw new Error('disk-full') }
    return view.commit(request)
  }
  view.find(node => node.props['aria-label'] === '视线跟随光标').props.onClick(); await settle()
  view.find(node => node.props['aria-label'] === '待机微动作').props.onClick(); await settle()
  assert.equal(view.stored().values.gazeFollowEnabled, true)

  await view.requestClose()
  assert.ok(view.text().includes('关闭设置前重试保存'))
  assert.equal(view.isClosed(), false)
  await view.button('重试并关闭').props.onClick(); await settle()
  assert.equal(view.stored().values.gazeFollowEnabled, false)
  assert.equal(view.isClosed(), true)
})

test('a closed page ignores a late write receipt', async t => {
  const view = await mountWindow(t)
  const response = deferred()
  view.control.handler = () => response.promise
  await view.editColor('#123456')
  await view.flushTimers()
  view.unmount()
  response.resolve(view.commit(view.requests[0])); await settle()
  assert.equal(view.root.children.length, 0)
})

test('a clean real settings page closes without showing the draft prompt', async t => {
  const view = await mountWindow(t)
  await view.requestClose()
  assert.equal(view.isClosed(), true)
  assert.equal(view.closeResponses[0].decision, 'close')
})

test('native close only prompts for drafts that live outside instant preferences', async t => {
  const view = await mountWindow(t)
  await view.editColor('#123456')
  await view.flushTimers()
  const drafts = view.moduleFor('unsaved-drafts')
  drafts.registerUnsavedDraft('close-secret', {
    label: '云端语音 API 密钥',
    kind: 'secret',
    isDirty: () => true,
    save: async () => true,
  })
  await settle()
  await view.requestClose()
  assert.ok(view.text().includes('关闭设置前保存草稿'))
  assert.ok(view.text().includes('云端语音 API 密钥'))
  await view.button('继续编辑').props.onClick(); await settle()
  assert.equal(view.isClosed(), false)
  assert.equal(view.closeResponses[0].decision, 'cancel')
  await view.requestClose()
  await view.button('放弃并关闭').props.onClick(); await settle()
  assert.equal(view.isClosed(), true)
})

test('save and close persists registered drafts without re-saving instant preferences', async t => {
  const view = await mountWindow(t)
  await view.editColor('#123456')
  await view.flushTimers()
  const drafts = view.moduleFor('unsaved-drafts')
  let saves = 0
  const draftState = Vue.reactive({ dirty: true })
  drafts.registerUnsavedDraft('close-workshop', {
    label: '预设工坊草稿',
    kind: 'workshop',
    isDirty: () => draftState.dirty,
    save: async () => { saves += 1; draftState.dirty = false; return true },
  })
  await settle()
  await view.requestClose('quit')
  assert.ok(view.text().includes('退出 Uta 前保存草稿'))
  await view.button('保存草稿并关闭').props.onClick(); await settle()
  assert.equal(saves, 1)
  assert.equal(view.isClosed(), true)
  assert.equal(view.requests.length, 1, 'only the instant accent write')
})

test('close prompt keeps keyboard focus inside its choices and Escape continues editing', async t => {
  const view = await mountWindow(t)
  const drafts = view.moduleFor('unsaved-drafts')
  drafts.registerUnsavedDraft('focus-secret', {
    label: '云端识别 API 密钥',
    kind: 'secret',
    isDirty: () => true,
    save: async () => true,
  })
  await settle()
  await view.requestClose()
  assert.equal(view.focusedLabel(), '继续编辑')
  await view.pressDialogKey('Tab')
  assert.equal(view.focusedLabel(), '放弃并关闭')
  await view.pressDialogKey('Tab', true)
  assert.equal(view.focusedLabel(), '继续编辑')
  await view.pressDialogKey('Escape')
  assert.equal(view.isClosed(), false)
  assert.equal(view.closeResponses[0].decision, 'cancel')
})

test('discarding a registered draft closes without saving it', async t => {
  const view = await mountWindow(t)
  const drafts = view.moduleFor('unsaved-drafts')
  let saves = 0
  drafts.registerUnsavedDraft('discard-workshop', {
    label: '预设工坊草稿',
    kind: 'workshop',
    isDirty: () => true,
    save: async () => { saves += 1; return true },
  })
  await settle()
  await view.requestClose()
  await view.button('放弃并关闭').props.onClick(); await settle()
  assert.equal(saves, 0)
  assert.equal(view.isClosed(), true)
})

test('a failed draft save keeps the prompt open with the draft retained', async t => {
  const view = await mountWindow(t)
  const drafts = view.moduleFor('unsaved-drafts')
  drafts.registerUnsavedDraft('failing-workshop', {
    label: '预设工坊草稿',
    kind: 'workshop',
    isDirty: () => true,
    save: async () => false,
  })
  await settle()
  await view.requestClose()
  await view.button('保存草稿并关闭').props.onClick(); await settle()
  assert.equal(view.isClosed(), false)
  assert.ok(view.text().includes('未能保存预设工坊草稿'))
})

test('closing waits for an in-flight instant write instead of prompting', async t => {
  const view = await mountWindow(t)
  const response = deferred()
  view.control.handler = () => response.promise
  await view.editColor('#123456')
  await view.flushTimers()
  const closing = view.requestClose()
  await settle()
  assert.equal(view.text().includes('关闭设置前保存草稿'), false)
  response.resolve(view.commit(view.requests[0]))
  await closing; await settle()
  assert.equal(view.isClosed(), true)
  assert.equal(view.stored().values.accentColor, '#123456')
})

test('switching models offers save, discard or cancel for an unsaved workshop draft', async t => {
  const view = await mountWindow(t, {}, '')
  const drafts = view.moduleFor('unsaved-drafts')
  let saves = 0
  let switches = 0
  drafts.registerUnsavedDraft('workshop-test', {
    label: '预设工坊草稿',
    kind: 'workshop',
    isDirty: () => true,
    save: async () => { saves += 1; return true },
  })
  view.store.modelUrl = 'live2d/other/other.model3.json'
  view.store.requestModelSwitch = async url => { switches += 1; view.store.modelUrl = url }
  await settle()
  view.button('更换模型').props.onClick(); await settle()
  view.button('Hiyori').props.onClick(); await settle()
  assert.ok(view.text().includes('换模型前保存工坊草稿'))
  assert.equal(switches, 0)

  await view.button('继续编辑').props.onClick(); await settle()
  assert.equal(switches, 0, 'cancel must keep the current model and draft untouched')

  view.button('Hiyori').props.onClick(); await settle()
  await view.button('保存草稿并换模型').props.onClick(); await settle()
  assert.equal(saves, 1)
  assert.equal(switches, 1)
  assert.equal(view.store.modelUrl, 'live2d/hiyori/hiyori.model3.json')
})

test('discarding the workshop draft still lets the model switch proceed', async t => {
  const view = await mountWindow(t, {}, '')
  const drafts = view.moduleFor('unsaved-drafts')
  let saves = 0
  let switches = 0
  drafts.registerUnsavedDraft('workshop-test-discard', {
    label: '预设工坊草稿',
    kind: 'workshop',
    isDirty: () => true,
    save: async () => { saves += 1; return true },
  })
  view.store.modelUrl = 'live2d/other/other.model3.json'
  view.store.requestModelSwitch = async url => { switches += 1; view.store.modelUrl = url }
  await settle()
  view.button('更换模型').props.onClick(); await settle()
  view.button('Hiyori').props.onClick(); await settle()
  await view.button('放弃草稿并换模型').props.onClick(); await settle()
  assert.equal(saves, 0)
  assert.equal(switches, 1)
})

test('reopening onboarding guards unsaved drafts before unmounting the settings pages', async t => {
  const view = await mountWindow(t, {}, '?domain=about')
  const drafts = view.moduleFor('unsaved-drafts')
  let saves = 0
  drafts.registerUnsavedDraft('secret-test', {
    label: '云端语音 API 密钥',
    kind: 'secret',
    isDirty: () => true,
    save: async () => { saves += 1; return true },
  })
  await settle()
  await view.button('重新打开首次引导').props.onClick(); await settle()
  assert.ok(view.text().includes('进入首次引导前保存草稿'))
  assert.ok(view.text().includes('云端语音 API 密钥'))
  assert.equal(saves, 0)

  await view.button('继续编辑').props.onClick(); await settle()
  assert.ok(view.text().includes('重新打开首次引导'))

  await view.button('重新打开首次引导').props.onClick(); await settle()
  await view.button('放弃草稿并进入').props.onClick(); await settle()
  assert.equal(saves, 0)
  assert.equal(view.text().includes('重新打开首次引导'), false)
})

test('saving drafts before reopening onboarding persists the input first', async t => {
  const view = await mountWindow(t, {}, '?domain=about')
  const drafts = view.moduleFor('unsaved-drafts')
  let saves = 0
  drafts.registerUnsavedDraft('secret-save-test', {
    label: '云端识别 API 密钥',
    kind: 'secret',
    isDirty: () => true,
    save: async () => { saves += 1; return true },
  })
  await settle()
  await view.button('重新打开首次引导').props.onClick(); await settle()
  await view.button('保存草稿并进入').props.onClick(); await settle()
  assert.equal(saves, 1)
  assert.equal(view.text().includes('重新打开首次引导'), false)
})
