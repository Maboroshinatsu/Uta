'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')
const Vue = require('vue')
const ts = require('typescript')
const createLoader = require('./support/settings-loader.cjs')

const flow = createLoader()('renderer/settings-window/onboarding/onboarding-flow')
const onboardingDir = path.join(__dirname, '../src/renderer/settings-window/onboarding')
const read = name => fs.readFileSync(path.join(onboardingDir, name), 'utf8')

function host(overrides = {}) {
  return {
    id: 'codex',
    name: 'Codex',
    description: '把 Codex 里的工作进度同步到桌面。',
    installed: true,
    executable: 'C:/bin/codex',
    configPath: 'C:/config',
    autoInstall: true,
    pluginInstalled: true,
    pluginVersion: '1.2.0',
    stages: [],
    notes: [],
    manualSteps: [],
    ...overrides,
  }
}

const verifiedStages = () => flow.ONBOARDING_STAGE_ORDER.map(id => ({
  id,
  state: 'verified',
  detail: `${id} 已验证`,
}))

/**
 * Mount the real OnboardingFlow script + template with mocked IPC, store and
 * child components. This catches wiring mistakes the pure helper tests cannot.
 */
function mountFlow({ detection, install = null, models = [], reentry = false } = {}) {
  const filename = path.join(onboardingDir, 'OnboardingFlow.vue')
  const { descriptor } = parse(read('OnboardingFlow.vue'), { filename })
  const script = compileScript(descriptor, { id: 'onboarding-flow-mount', inlineTemplate: true }).content
  const code = ts.transpileModule(script, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText

  const calls = []
  const events = []
  const store = Vue.reactive({
    modelUrl: models[0]?.url ?? '',
    modelLoaded: true,
    requestModelSwitch: async url => {
      calls.push(['switch', url])
      store.modelUrl = url
    },
  })
  const windowMock = {
    utaAPI: {
      detectOnboardingHosts: async () => {
        calls.push(['detect'])
        return detection
      },
      installOnboardingHost: async id => {
        calls.push(['install', id])
        if (install instanceof Error) throw install
        return install
      },
    },
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  }

  const HostStub = {
    props: [
      'host', 'mode', 'placeholder', 'selected', 'runtime',
      'detectionState', 'install', 'installBusy', 'installError',
    ],
    emits: ['select', 'install'],
    render() {
      return Vue.h('div', { class: 'stub-host' }, [
        Vue.h('button', { onClick: () => this.$emit('select', this.host.id) }, `select-${this.host.id}`),
        Vue.h('button', { onClick: () => this.$emit('install') }, `install-${this.host.id}`),
        this.installError ? Vue.h('span', { class: 'stub-error' }, this.installError) : null,
      ])
    },
  }
  const GlyphStub = { props: ['name', 'size'], render() { return null } }
  // Bypass Transition's DOM hooks; the template's v-if chain is what we test.
  const TransitionStub = {
    name: 'Transition',
    props: ['name', 'css', 'mode', 'appear'],
    setup(_props, { slots }) { return () => slots.default?.() },
  }
  const vueModule = { ...Vue, Transition: TransitionStub }

  const imports = {
    vue: vueModule,
    '@/stores/deskpet': { useDeskpetStore: () => store },
    '@/services/live2d/model-discovery': {
      listAvailableModels: async () => {
        calls.push(['models'])
        return models
      },
      getStoredModelPath: () => '',
    },
    '@/services/model-config': { MODEL_PATH: models[0]?.url ?? '' },
    './onboarding-flow': flow,
    './HostStageCard.vue': HostStub,
    './OnboardingGlyph.vue': GlyphStub,
  }

  const module = { exports: {} }
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: name => {
      if (!(name in imports)) throw new Error(`Unexpected import ${name}`)
      return imports[name]
    },
    window: windowMock,
    console,
    Promise, Object, Array, String, Number, Boolean,
    Error, TypeError, Map, Set, JSON, setTimeout, clearTimeout, queueMicrotask,
  }, { filename })

  const element = type => ({ type, text: '', props: {}, children: [], parent: null })
  const insert = (node, parent, anchor) => {
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
  }
  const remove = node => {
    if (node.parent) {
      const index = node.parent.children.indexOf(node)
      if (index >= 0) node.parent.children.splice(index, 1)
    }
    node.parent = null
  }
  const renderer = Vue.createRenderer({
    createElement: element,
    createText: text => ({ ...element('#text'), text }),
    createComment: () => element('#comment'),
    insert,
    remove,
    patchProp: (node, key, _old, value) => { node.props[key] = value },
    setText: (node, text) => { node.text = text },
    setElementText: (node, text) => { node.text = text; node.children = [] },
    parentNode: node => node.parent,
    nextSibling: node => node.parent
      ? node.parent.children[node.parent.children.indexOf(node) + 1] || null
      : null,
    insertStaticContent: (text, parent, anchor) => {
      const node = { ...element('#static'), text }
      insert(node, parent, anchor)
      return [node, node]
    },
  })

  const root = element('root')
  const draft = Vue.reactive({ ttsEnabled: false, themeMode: 'light' })
  const app = renderer.createApp(module.exports.default, {
    draft,
    reentry,
    onUpdate: patch => {
      events.push(['update', patch])
      Object.assign(draft, patch)
    },
    onFinish: value => events.push(['finish', value]),
    onClose: () => events.push(['close']),
    onOpenSettings: (...args) => events.push(['open-settings', ...args]),
  })
  const errors = []
  app.config.errorHandler = error => errors.push(error)
  app.mount(root)

  const settle = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
    await Vue.nextTick()
    await Vue.nextTick()
  }
  const text = node => [String(node.text || ''), ...node.children.map(text)].join(' ')
  const find = (predicate, node = root) => predicate(node)
    ? node
    : node.children.map(child => find(predicate, child)).find(Boolean)
  return {
    app,
    root,
    draft,
    calls,
    events,
    errors,
    settle,
    text: () => text(root),
    find,
    button: label => find(node => node.type === 'button' && text(node).includes(label)),
  }
}

test('steps run welcome → host → character → voice → start and unknown input settles on welcome', () => {
  assert.deepEqual([...flow.ONBOARDING_STEPS], ['welcome', 'host', 'character', 'voice', 'start'])
  assert.equal(flow.nextOnboardingStep('welcome'), 'host')
  assert.equal(flow.nextOnboardingStep('host'), 'character')
  assert.equal(flow.nextOnboardingStep('start'), null)
  assert.equal(flow.previousOnboardingStep('welcome'), null)
  assert.equal(flow.previousOnboardingStep('start'), 'voice')
  assert.equal(flow.resolveOnboardingStep('nope'), 'welcome')
  assert.equal(flow.resolveOnboardingStep('voice'), 'voice')
  assert.equal(flow.stepNumber('welcome'), '01')
  assert.equal(flow.stepNumber('start'), '05')
  for (const step of flow.ONBOARDING_STEPS) {
    assert.ok(flow.STEP_LABELS[step], `${step} needs a label`)
    assert.ok(flow.STEP_HINTS[step], `${step} needs a hint`)
  }
})

test('host and character can only advance after a choice or an explicit skip', () => {
  const pending = { host: 'pending', character: 'pending' }
  assert.equal(flow.advanceFrom('welcome', pending), 'host')
  assert.equal(flow.advanceFrom('host', pending), null)
  assert.equal(flow.canAdvanceFrom('host', pending), false)
  assert.equal(flow.advanceFrom('host', { ...pending, host: 'skipped' }), 'character')
  assert.equal(flow.advanceFrom('host', { ...pending, host: 'done' }), 'character')
  assert.equal(flow.advanceFrom('character', { host: 'done', character: 'pending' }), null)
  assert.equal(flow.advanceFrom('character', { host: 'done', character: 'skipped' }), 'voice')
  assert.equal(flow.advanceFrom('voice', pending), 'start')
  assert.equal(flow.advanceFrom('start', pending), null)

  assert.equal(flow.canSkipStep('welcome'), false)
  assert.equal(flow.canSkipStep('host'), true)
  assert.equal(flow.canSkipStep('character'), true)
  assert.equal(flow.canSkipStep('voice'), true)
  assert.equal(flow.canSkipStep('start'), false)
  assert.equal(flow.skipActionLabel('welcome'), null)
  assert.ok(flow.skipActionLabel('host'))
})

test('the rail only reaches steps already visited, and back navigation is always ordered', () => {
  assert.equal(flow.canNavigateToStep('welcome', 'host'), true)
  assert.equal(flow.canNavigateToStep('host', 'host'), true)
  assert.equal(flow.canNavigateToStep('start', 'host'), false)
  assert.equal(flow.laterStep('host', 'character'), 'character')
  assert.equal(flow.laterStep('start', 'host'), 'start')
})

test('finish never reports a host that was skipped, and reentry returns instead of finishes', () => {
  assert.equal(flow.finishedHostId('codex', false), 'codex')
  assert.equal(flow.finishedHostId('  ', false), 'skipped')
  assert.equal(flow.finishedHostId(null, false), 'skipped')
  assert.equal(flow.finishedHostId('codex', true), 'skipped')

  assert.equal(flow.primaryActionLabel('start', true), '返回设置')
  assert.equal(flow.primaryActionLabel('start', false), '完成设置')
  assert.equal(flow.primaryActionLabel('welcome', true), '继续设置')
  assert.equal(flow.primaryActionLabel('welcome', false), '开始设置')
})

test('stage results always expose all six stages and missing ones are unavailable, not verified', () => {
  const partial = [{ id: 'plugin', state: 'verified', detail: '已写入插件' }]
  const ordered = flow.orderedStages(partial)
  assert.equal(ordered.length, 6)
  assert.deepEqual([...ordered.map(stage => stage.id)], [...flow.ONBOARDING_STAGE_ORDER])
  assert.equal(ordered.find(stage => stage.id === 'plugin').state, 'verified')
  for (const stage of ordered.filter(item => item.id !== 'plugin')) {
    assert.equal(stage.state, 'unavailable')
    assert.equal(stage.detail, flow.MISSING_STAGE_DETAIL)
  }

  const invalid = flow.orderedStages([{ id: 'plugin', state: 'looks-good', detail: '' }])
  const plugin = invalid.find(stage => stage.id === 'plugin')
  assert.equal(plugin.state, 'unavailable')
  assert.equal(plugin.detail, flow.EMPTY_STAGE_DETAIL)

  assert.equal(flow.isOnboardingStageId('response'), true)
  assert.equal(flow.isOnboardingStageId('done'), false)
  for (const id of flow.ONBOARDING_STAGE_ORDER) {
    assert.ok(flow.STAGE_LABELS[id], `${id} needs a label`)
  }
  for (const state of ['verified', 'pending', 'manual', 'failed', 'unavailable']) {
    assert.ok(flow.STAGE_STATE_LABELS[state], `${state} needs a label`)
  }
})

test('install stages override detection stages for the same id', () => {
  const merged = flow.mergeStageLists(
    [
      { id: 'detected', state: 'verified', detail: 'detected' },
      { id: 'plugin', state: 'pending', detail: 'pending' },
    ],
    [{ id: 'plugin', state: 'failed', detail: 'permission denied' }],
  )
  assert.equal(merged.length, 2)
  assert.equal(merged.find(stage => stage.id === 'detected').state, 'verified')
  assert.equal(merged.find(stage => stage.id === 'plugin').state, 'failed')
  assert.equal(merged.find(stage => stage.id === 'plugin').detail, 'permission denied')
})

test('summaries count what the backend said and never round pending work up to success', () => {
  const partial = flow.summarizeStages([
    { id: 'detected', state: 'verified', detail: 'ok' },
    { id: 'plugin', state: 'pending', detail: 'waiting' },
    { id: 'runtime', state: 'manual', detail: 'run manually' },
  ])
  assert.equal(partial.hasEvidence, true)
  assert.equal(partial.verified, 1)
  assert.equal(partial.pending, 1)
  assert.equal(partial.manual, 1)
  assert.equal(partial.unavailable, 3)
  assert.equal(partial.allVerified, false)
  assert.equal(partial.needsAttention, true)
  assert.ok(partial.headline.includes('1 个阶段已验证'))
  assert.ok(partial.headline.includes('1 个阶段需要手动完成'))

  const complete = flow.summarizeStages(verifiedStages())
  assert.equal(complete.allVerified, true)
  assert.equal(complete.headline, '全部阶段已验证')

  const empty = flow.summarizeStages([])
  assert.equal(empty.hasEvidence, false)
  assert.equal(empty.allVerified, false)
  assert.equal(empty.headline, '尚无阶段结果')
  assert.equal(empty.unavailable, 6)
})

test('host cards always start with Codex, then DeepSeek Harness, then other detected hosts', () => {
  const cards = flow.buildHostCards([
    host({ id: 'qoder', name: 'Qoder' }),
    host({ id: 'codex' }),
  ])
  assert.deepEqual([...cards.map(card => card.host.id)], ['codex', 'deepseek-harness', 'qoder'])
  assert.equal(cards[0].placeholder, false)
  assert.equal(cards[0].host.name, 'Codex')
  assert.equal(cards[1].placeholder, true)
  assert.equal(cards[1].host.name, 'DeepSeek Harness')
  assert.equal(cards[2].placeholder, false)

  const fallback = flow.buildHostCards(null)
  assert.deepEqual([...fallback.map(card => card.host.id)], ['codex', 'deepseek-harness'])
  assert.equal(fallback.every(card => card.placeholder), true)
  assert.equal(fallback[0].host.autoInstall, false)
  assert.equal(fallback[1].host.manualSteps.length, 0)
})

test('host modes distinguish automatic, manual and compatibility-only hosts', () => {
  assert.equal(flow.hostMode(host()), 'auto')
  assert.equal(flow.hostMode(host({ id: 'deepseek-harness', name: 'DeepSeek Harness' })), 'auto')
  assert.equal(flow.hostMode(host({ id: 'qoder', name: 'Qoder' })), 'compatible')
  assert.equal(flow.hostMode(host({ autoInstall: false })), 'manual')
  assert.equal(flow.hostModeLabel('auto'), '自动安装')
  assert.equal(flow.hostModeLabel('manual'), '手动配置')
  assert.equal(flow.hostModeLabel('compatible'), '兼容接入')
})

test('host badges only repeat what detection reported and stop claiming when detection failed', () => {
  const runtime = { activeHostId: 'codex', connected: true, sessions: [] }
  const ready = flow.hostBadges(host(), runtime, 'ready', false)
  const labels = ready.map(badge => badge.label)
  assert.ok(labels.includes('已安装'))
  assert.ok(labels.includes('插件已安装 v1.2.0'))
  assert.ok(labels.includes('运行时已连接'))

  const disconnected = flow.hostBadges(
    host(),
    { ...runtime, connected: false },
    'ready',
    false,
  )
  assert.ok(!disconnected.some(badge => badge.label === '运行时已连接'))
  assert.ok(disconnected.some(badge => badge.label === '运行时未连接'))

  const otherHost = flow.hostBadges(host(), { ...runtime, activeHostId: 'qoder' }, 'ready', false)
  assert.ok(!otherHost.some(badge => badge.id === 'runtime'))

  const unavailable = flow.hostBadges(host(), runtime, 'unavailable', false)
  assert.deepEqual([...unavailable.map(badge => badge.id)], ['detection'])
  assert.ok(unavailable[0].label.includes('检测暂不可用'))

  const placeholder = flow.hostBadges(flow.placeholderHost('codex'), null, 'ready', true)
  assert.ok(placeholder.some(badge => badge.label === '本次检测未出现'))
  assert.ok(!placeholder.some(badge => badge.label === '已安装'))

  const unsupported = flow.hostBadges(host({
    id: 'qoder',
    name: 'Qoder',
    installed: false,
    executable: '',
    autoInstall: false,
    pluginInstalled: false,
    pluginVersion: '',
    stages: [{
      id: 'detected',
      state: 'unavailable',
      detail: '本版暂不支持自动检测，请按下方手动步骤确认。',
    }],
  }), runtime, 'ready', false)
  const unsupportedLabels = unsupported.map(badge => badge.label)
  assert.ok(unsupportedLabels.includes('暂不支持自动检测'))
  assert.ok(unsupportedLabels.includes('插件状态未知'))
  assert.ok(!unsupportedLabels.includes('未检测到安装'))
})

test('runtime summary prefers the selected session and falls back to the new-session copy', () => {
  const detection = {
    hosts: [],
    runtime: {
      activeHostId: 'deepseek-harness',
      connected: true,
      sessions: [
        { sessionId: 's1', label: '旧会话', selected: false },
        { sessionId: 's2', label: '当前会话', selected: true },
      ],
    },
  }
  const info = flow.runtimeSummary(detection)
  assert.equal(info.connected, true)
  assert.equal(info.hostName, 'DeepSeek Harness')
  assert.equal(info.sessionLabel, '当前会话')
  assert.equal(info.sessionId, 's2')
  assert.equal(info.sessionBound, true)
  assert.equal(flow.sessionSummaryText(info), '当前会话 · s2')

  const fresh = flow.runtimeSummary({
    hosts: [],
    runtime: { activeHostId: '', connected: false, sessions: [] },
  })
  assert.equal(fresh.connected, false)
  assert.equal(fresh.hostName, '尚未检测到运行时')
  assert.equal(fresh.sessionLabel, flow.NEW_SESSION_LABEL)
  assert.equal(fresh.sessionBound, false)
  assert.equal(flow.sessionSummaryText(fresh), '新会话启动后绑定')

  const missing = flow.runtimeSummary(null)
  assert.equal(missing.connected, false)
  assert.equal(missing.sessionBound, false)
})

test('model helpers resolve names, defaults and path tails without inventing a model', () => {
  const models = [
    { name: 'Hiyori', url: './models/hiyori/hiyori.model3.json', kind: 'live2d' },
    { name: '静态立绘', url: './models/sheet/deskpet-images.json', kind: 'image-set' },
  ]
  assert.equal(flow.modelDisplayName(models, models[0].url), 'Hiyori')
  assert.equal(
    flow.modelDisplayName(models, 'uta://models/other/renamed.model3.json'),
    'renamed',
  )
  assert.equal(flow.modelDisplayName(models, ''), '正在读取当前角色…')
  assert.equal(
    flow.defaultModelUrl(models, './models/hiyori/hiyori.model3.json'),
    models[0].url,
  )
  assert.equal(
    flow.defaultModelUrl(models, './models/moved/elsewhere.model3.json'),
    models[0].url,
  )
  assert.equal(flow.defaultModelUrl([], './models/gone.model3.json'), '')
  assert.equal(
    flow.isDefaultModel(models[0].url, models, './models/hiyori/hiyori.model3.json'),
    true,
  )
  assert.equal(flow.isDefaultModel(models[1].url, models, './models/hiyori/hiyori.model3.json'), false)
  assert.equal(flow.modelKindLabel('image-set'), '静态立绘')
  assert.equal(flow.modelKindLabel('live2d'), 'Live2D')
})

test('errors are shown verbatim and voice stays explicitly opt-in', () => {
  assert.equal(flow.describeError(new Error('spawn ENOENT')), 'spawn ENOENT')
  assert.equal(flow.describeError('  permission denied  '), 'permission denied')
  assert.ok(flow.describeError(null).length > 0)
  assert.equal(flow.voiceStateLabel(false), '保持关闭（默认）')
  assert.equal(flow.voiceStateLabel(true), '已开启')
})

test('the real component wires the required APIs and never fakes playback or host messaging', () => {
  const main = read('OnboardingFlow.vue')
  for (const required of [
    'draft: PublicSettings',
    'reentry?: boolean',
    "event: 'update'",
    "event: 'finish'",
    "event: 'close'",
    "event: 'open-settings'",
    'detectOnboardingHosts',
    'installOnboardingHost',
    'unblockOnboardingHost',
    'unblockHost',
    'listAvailableModels',
    'requestModelSwitch',
    "emit('update', { ttsEnabled",
    "emit('open-settings', 'voice', finishedHostId",
    "emit('finish'",
    "emit('close'",
    '重新检测',
    'skipActionLabel',
    '前往语音设置',
    '暂时退出，先进入设置',
    'exitOnError',
  ]) {
    assert.ok(main.includes(required), `OnboardingFlow should include ${required}`)
  }
  assert.match(main, /if \(props\.reentry\) \{\s*emit\('close'\)/)
  assert.match(main, /selectedHostId\.value = hostId[\s\S]*?installingHostId\.value = hostId/)
  assert.match(main, /:disabled="actionsBusy \|\| !canNavigateToStep/)
  assert.match(main, /:disabled="actionsBusy"\s*@click="openVoiceSettings"/)

  const hostCard = read('HostStageCard.vue')
  for (const required of [
    'STAGE_LABELS',
    'STAGE_STATE_LABELS',
    'backupPath',
    'restartRequired',
    'sessionRequired',
    'manualSteps',
    'installError',
    'retryBlocked',
    "emit('unblock')",
  ]) {
    assert.ok(hostCard.includes(required), `HostStageCard should include ${required}`)
  }
  assert.ok(hostCard.includes('installBaseLabel'))
  assert.match(hostCard, /重试\$\{installBaseLabel\.value\}/)
  assert.ok(hostCard.includes('解除安装阻断'))
  assert.ok(hostCard.includes("emit('choose-path')"))
  assert.ok(hostCard.includes("emit('choose-home')"))

  for (const source of [main, hostCard]) {
    assert.ok(!/new Audio|\.play\(|speechSynthesis/i.test(source), 'onboarding must not play audio')
    assert.ok(!/sendMessage|send-command/i.test(source), 'onboarding must not send host messages')
    assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(source), 'use inline SVG, not emoji icons')
  }
})

test('the mounted flow detects hosts, shows the exact install error, follows the summary and finishes', async () => {
  const codex = host({
    notes: ['需要 Codex 保持登录'],
    manualSteps: ['打开 Codex', '安装插件'],
    stages: [
      { id: 'detected', state: 'verified', detail: '找到 Codex' },
      { id: 'plugin', state: 'pending', detail: '等待写入' },
    ],
  })
  const detection = {
    hosts: [codex],
    runtime: {
      activeHostId: 'codex',
      connected: true,
      sessions: [{ sessionId: 's-1', label: '主会话', selected: true }],
    },
    checkedAt: '2026-10-25T00:00:00.000Z',
  }
  const models = [
    { name: 'Hiyori', url: './models/hiyori/hiyori.model3.json', kind: 'live2d' },
    { name: '静态立绘', url: './models/sheet/deskpet-images.json', kind: 'image-set' },
  ]
  const h = mountFlow({
    detection,
    models,
    install: new Error('install-failed: plugin dir locked'),
  })
  await h.settle()
  assert.match(h.text(), /让 Uta 住进桌面/)

  await h.button('开始设置').props.onClick()
  await h.settle()
  assert.match(h.text(), /先让 Uta 找对你的宿主/)
  assert.ok(h.calls.some(call => call[0] === 'detect'), 'detection should run on mount')

  await h.button('select-codex').props.onClick()
  await h.settle()
  const hostNext = h.button('下一步：选择角色')
  assert.ok(hostNext, 'host next should exist')
  assert.equal(hostNext.props.disabled, false, 'selection unlocks the host step')

  await h.button('install-codex').props.onClick()
  await h.settle()
  assert.ok(h.text().includes('install-failed: plugin dir locked'), 'exact backend error must be shown')
  assert.ok(h.find(node => node.props?.class === 'stub-error'), 'install error renders in the card')

  await h.button('下一步：选择角色').props.onClick()
  await h.settle()
  assert.match(h.text(), /选一个愿意常驻桌面的样子/)
  assert.ok(h.text().includes('Hiyori'), 'discovered models are listed')

  await h.button('下一步：语音').props.onClick()
  await h.settle()
  assert.match(h.text(), /语音默认关闭/)
  const toggle = h.find(node => node.type === 'button' && node.props?.role === 'switch')
  assert.ok(toggle, 'voice switch should exist')
  await toggle.props.onClick()
  await h.settle()
  assert.equal(h.draft.ttsEnabled, true, 'voice toggle emits update(ttsEnabled)')
  assert.match(h.text(), /已开启/)

  await h.button('前往语音设置').props.onClick()
  await h.settle()
  assert.ok(h.events.some(event => event[0] === 'open-settings' && event[1] === 'voice' && event[2] === 'codex'))

  await h.button('下一步：确认').props.onClick()
  await h.settle()
  const summary = h.text()
  for (const expected of ['Codex', '主会话 · s-1', 'Hiyori', '已开启', '完成设置']) {
    assert.ok(summary.includes(expected), `summary should include ${expected}`)
  }

  await h.button('完成设置').props.onClick()
  await h.settle()
  const finish = h.events.find(event => event[0] === 'finish')
  assert.ok(finish, 'finish should be emitted')
  assert.deepEqual([...finish], ['finish', 'codex'])
  assert.equal(h.errors.length, 0)
  h.app.unmount()
})

test('onboarding hides undetected hosts and never recommends Codex', async () => {
  const codex = host({ stages: [] })
  const qoder = host({
    id: 'qoder',
    name: 'Qoder',
    installed: false,
    executable: '',
    autoInstall: false,
  })
  const antigravity = host({
    id: 'antigravity',
    name: 'Antigravity',
    installed: false,
    executable: '',
    autoInstall: false,
  })
  const h = mountFlow({
    detection: {
      hosts: [codex, qoder, antigravity],
      runtime: { activeHostId: '', connected: true, sessions: [] },
      checkedAt: '2026-10-27T00:00:00.000Z',
    },
  })
  await h.settle()
  await h.button('开始设置').props.onClick()
  await h.settle()
  assert.ok(h.button('select-codex'), 'installed hosts stay selectable')
  assert.equal(h.button('select-qoder'), undefined, 'undetected Qoder must not render')
  assert.equal(h.button('select-antigravity'), undefined, 'undetected Antigravity must not render')
  assert.ok(!h.text().includes('推荐'), 'onboarding must not recommend Codex')
  assert.ok(!h.text().includes('Codex 优先'))
  h.app.unmount()
})

test('all onboarding single-file components parse, compile and keep visible focus/reduced motion CSS', () => {
  for (const name of ['OnboardingFlow.vue', 'HostStageCard.vue', 'OnboardingGlyph.vue']) {
    const source = read(name)
    const { descriptor, errors } = parse(source, { filename: name })
    assert.deepEqual(errors, [], `${name} should parse`)
    const script = compileScript(descriptor, { id: name })
    assert.ok(script.content.trim().length > 0, `${name} should compile its script`)
    if (descriptor.template) {
      const template = compileTemplate({
        source: descriptor.template.content,
        filename: name,
        id: name,
      })
      assert.deepEqual(template.errors, [], `${name} should compile its template`)
    }
  }

  const css = read('onboarding.css')
  assert.ok(css.includes('.onb button:focus-visible'))
  assert.ok(css.includes('prefers-reduced-motion'))
  assert.ok(css.includes('@media (max-width: 560px)'))
  assert.match(css, /\.onb-step-enter-active[\s\S]*?opacity[\s\S]*?transform/)
  assert.ok(!/transition:[^;]*\b(?:width|height)\b/.test(css), 'step motion must not animate layout size')
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.onb-blob\s*\{\s*display: none/)
})

test('MaiBot adapter has a real onboarding card and a manual binding path', () => {
  assert.ok(flow.HOST_ORDER.includes('maibot'), 'MaiBot must be selectable in onboarding')
  const mai = host({
    id: 'maibot',
    name: 'MaiBot 适配器',
    description: '通过随包插件把 Uta 的私聊接入 MaiBot。',
    installed: false,
    executable: '',
    autoInstall: false,
    pluginInstalled: false,
    manualSteps: ['把 maibot-adapter 复制到 MaiBot 的 plugins 目录。'],
  })
  assert.equal(flow.hostMode(mai), 'compatible', 'MaiBot must not pretend Uta auto-installs it')
  assert.equal(
    flow.hostBadges(mai, null, 'ready', false).map(badge => badge.label).join('|'),
    '随包适配器|需放入 MaiBot',
  )
  assert.ok(
    flow.buildHostCards([mai]).some(card => card.host.id === 'maibot'),
    'detected MaiBot card must survive host ordering',
  )
  const source = fs.readFileSync(path.join(__dirname, '../src/main/host-onboarding.ts'), 'utf8')
  assert.match(source, /id: 'maibot'/, 'main-process detection must emit the MaiBot host')
  assert.match(source, /maibot-adapter/, 'manual steps must point at the bundled adapter')
  assert.match(source, /127\.0\.0\.1:8524/, 'manual steps must name the local bridge address')
})

test('MaiBot stages describe the bundled adapter instead of a missing install', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main/host-onboarding.ts'), 'utf8')
  assert.match(source, /随包提供，无需自动检测/)
  assert.match(source, /把 maibot-adapter 放入 MaiBot 的 plugins 目录/)
  assert.match(source, /本机 8524 端口可访问/)
})

test('the onboarding host list does not claim to hide undetected hosts', () => {
  const flow = fs.readFileSync(path.join(__dirname, '../src/renderer/settings-window/onboarding/OnboardingFlow.vue'), 'utf8')
  assert.doesNotMatch(flow, /列表只显示本机已安装的宿主/)
  assert.match(flow, /列表优先显示本机已安装的宿主/)
})

test('onboarding install messages avoid interface jargon', () => {
  const card = fs.readFileSync(path.join(__dirname, '../src/renderer/settings-window/onboarding/HostStageCard.vue'), 'utf8')
  const flow = fs.readFileSync(path.join(__dirname, '../src/renderer/settings-window/onboarding/OnboardingFlow.vue'), 'utf8')
  assert.doesNotMatch(card, /安装接口/)
  assert.doesNotMatch(flow, /安装接口/)
  assert.match(card, /安装流程已完成/)
})
