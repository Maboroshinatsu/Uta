'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(
  path.join(__dirname, '../src/renderer/components/quick-settings.ts'),
  'utf8',
)
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
vm.runInNewContext(code, { module: mod, exports: mod.exports }, { console })
const { quickModelsForKind, quickModelDisplayName, quickDisplayMode, quickModelLabels } = mod.exports

const models = [
  { name: 'DS鼠控版', url: 'uta://models/DS鼠控版/c_0120.model3.json', kind: 'live2d' },
  { name: 'Hiyori', url: './models/hiyori/hiyori.model3.json', kind: 'live2d' },
  { name: '静态立绘', url: './models/sheet/deskpet-images.json', kind: 'image-set' },
]

test('quick model list keeps the selected display kind and its order', () => {
  assert.deepEqual(
    quickModelsForKind(models, 'live2d').map((model) => model.name),
    ['DS鼠控版', 'Hiyori'],
  )
  assert.deepEqual(
    quickModelsForKind(models, 'image-set').map((model) => model.name),
    ['静态立绘'],
  )
})

test('quick panel shows the discovered name, then a readable path tail', () => {
  assert.equal(quickModelDisplayName(models[0].url, models), 'DS鼠控版')
  assert.equal(
    quickModelDisplayName('uta://models/%E6%96%B0%E8%A7%92%E8%89%B2/renamed.model3.json', models),
    'renamed',
  )
  assert.equal(quickModelDisplayName('', models), '正在读取角色…')
})

test('quick display mode follows the live model and falls back before discovery finishes', () => {
  assert.equal(quickDisplayMode(models[0].url, models), 'live2d')
  assert.equal(quickDisplayMode(models[2].url, models), 'image-set')
  assert.equal(quickDisplayMode('./models/sheet/deskpet-images.json', [], 'image-set'), 'image-set')
  assert.equal(quickDisplayMode('', []), 'live2d')
})

test('quick header uses the readable model name and decodes stale path tails', () => {
  const labeled = [
    { name: 'model-variant-a / c_0120', displayName: '团子', url: 'uta://models/a/one.model3.json', kind: 'live2d' },
    { name: 'model-variant-b / c_0120', displayName: '团子', url: 'uta://models/b/two.model3.json', kind: 'live2d' },
  ]
  assert.equal(quickModelDisplayName(labeled[0].url, labeled), 'model-variant-a / c_0120')
  assert.equal(
    quickModelDisplayName('uta://models/%E6%96%B0%E8%A7%92%E8%89%B2/%E5%9B%A2%E5%AD%90.model3.json', labeled),
    '团子',
  )
  const single = [{ name: 'sample_static', displayName: '示例立绘·团子', url: 'uta://models/sheet/deskpet-images.json', kind: 'image-set' }]
  assert.equal(quickModelDisplayName(single[0].url, single), '示例立绘·团子')
})

test('quick model list prefers readable names but falls back to paths when names collide', () => {
  const options = [
    { name: '示例立绘·团子', displayName: '团子', url: 'uta://models/a/one.model3.json', kind: 'live2d' },
    { name: '示例立绘·团子', displayName: '团子', url: 'uta://models/b/two.model3.json', kind: 'live2d' },
    { name: 'Hiyori Pro', displayName: 'Hiyori', url: 'uta://models/hiyori/hiyori.model3.json', kind: 'live2d' },
  ]
  const labels = quickModelLabels(options)
  assert.equal(labels.get(options[0].url), '示例立绘·团子')
  assert.equal(labels.get(options[1].url), '示例立绘·团子')
  assert.equal(labels.get(options[2].url), 'Hiyori')
})

test('quick panel reuses the existing store and model discovery instead of a second settings path', () => {
  const panel = fs.readFileSync(
    path.join(__dirname, '../src/renderer/components/QuickSettingsPanel.vue'),
    'utf8',
  )
  for (const required of [
    'useDeskpetStore',
    'listAvailableModels',
    'requestModelSwitch',
    'getStoredModelForKind',
    'getAgentHosts',
    'getAdapterHosts',
    'switchPetHost',
    'boundHostLabel',
    'modelMenuOpen',
    'hostMenuOpen',
    'store.themeMode',
    'store.hoverFadeEnabled',
    'store.gazeFollowEnabled',
    'store.idleActionsEnabled',
    'store.toggleHeldControl',
    'setClickThroughLocked',
    "emit('open-full-settings')",
  ]) {
    assert.ok(panel.includes(required), `quick panel should use ${required}`)
  }
  assert.ok(!panel.includes('THEME_ACCENT_PRESETS'), 'accent swatches belong to full settings only')
  assert.ok(!panel.includes('store.accentColor'), 'quick panel should not carry a second accent entry')
  assert.ok(!panel.includes('settingsClient.patch'), 'quick panel should let the store persist changes')
})

test('model choice is a dedicated block in the body, not a header brand', () => {
  const panel = fs.readFileSync(
    path.join(__dirname, '../src/renderer/components/QuickSettingsPanel.vue'),
    'utf8',
  )
  const header = panel.match(/<header class="qs-head">([\s\S]*?)<\/header>/)
  assert.ok(header, 'quick panel header should exist')
  assert.ok(!header[1].includes('currentModelName'), 'the model name must not read like a brand label')
  assert.match(panel, /<section class="qs-model-block" aria-label="模型">/)
  assert.match(panel, /class="qs-model-block-name"/)
  assert.ok(!panel.includes('aria-label="角色"'), 'the model section must be named 模型, not 角色')
  const styles = panel.match(/<style scoped>([\s\S]*?)<\/style>/)
  assert.ok(styles, 'quick panel styles should exist')
  assert.match(styles[1], /\.qs-head\s*\{[\s\S]*?border-bottom:/, 'header needs the separator line')
  assert.match(
    styles[1],
    /\.qs-model-block\s*\{[\s\S]*?border:[\s\S]*?border-radius:[\s\S]*?background:/,
    'the model block needs a card-like surface',
  )
})

test('host rows switch directly without window reload', () => {
  const panel = fs.readFileSync(
    path.join(__dirname, '../src/renderer/components/QuickSettingsPanel.vue'),
    'utf8',
  )
  assert.match(panel, /aria-label="宿主"/)
  assert.doesNotMatch(panel, /一次只连接一个平台/)
  assert.match(panel, /@click="switchHost\(host\.id\)"/)
  assert.doesNotMatch(panel, /qs-host-confirm/)
  assert.match(panel, /switchActiveHost/)
})

test('pet toolbar opens the quick panel; full settings stays an explicit action', () => {
  const stage = fs.readFileSync(
    path.join(__dirname, '../src/renderer/components/DeskpetStage.vue'),
    'utf8',
  )
  assert.match(stage, /<QuickSettingsPanel[\s\S]*?:open="showSettings"/)

  const toggle = stage.match(/function toggleSettings\(\) \{([\s\S]*?)\n\}/)
  assert.ok(toggle, 'toggleSettings should exist')
  assert.match(toggle[1], /showSettings\.value = !showSettings\.value/)
  assert.ok(!toggle[1].includes('openSettingsWindow'), 'the toolbar should not jump straight to full settings')

  const full = stage.match(/function openFullSettings\(domain\?: string\) \{([\s\S]*?)\n\}/)
  assert.ok(full, 'openFullSettings should exist')
  assert.match(full[1], /openSettingsWindow/)
})

test('single click reacts safely; right click triggers random preset and double click opens input', () => {
  const stage = fs.readFileSync(
    path.join(__dirname, '../src/renderer/components/DeskpetStage.vue'),
    'utf8',
  )
  const doubleClick = stage.match(/function onDoubleClick\(event: MouseEvent\) \{([\s\S]*?)\n\}/)
  assert.ok(doubleClick, 'onDoubleClick should exist')
  assert.match(doubleClick[1], /showInput\.value = true/)
  assert.match(doubleClick[1], /quick-settings/, 'double clicks inside the quick panel must be ignored')
  assert.ok(!doubleClick[1].includes('cycleEmotion'), 'double click must not also cycle emotion')

  const panel = fs.readFileSync(
    path.join(__dirname, '../src/renderer/components/QuickSettingsPanel.vue'),
    'utf8',
  )
  assert.match(panel, /@dblclick\.stop/, 'the quick panel must stop double-click bubbling to the stage')

  const rightClick = stage.match(/function onStageRightClick\(\) \{([\s\S]*?)\n\}/)
  assert.ok(rightClick, 'onStageRightClick should exist')
  assert.match(rightClick[1], /triggerRandomPreset\(\)/)

  const click = stage.match(/function onStageClick\(event: MouseEvent\): void \{([\s\S]*?)\n\}/)
  assert.ok(click, 'onStageClick should exist')
  assert.match(click[1], /showSettings\.value = false/)
  assert.ok(!click[1].includes('showInput.value = true'), 'single click must not open the input')
  assert.ok(!stage.includes('performTouchReaction'), 'the old touch reaction must not shadow the merged click')

  const send = stage.match(/async function sendText\(voiceSessionId\?: string \| null\) \{([\s\S]*?)\n\}/)
  assert.ok(send, 'sendText should exist')
  assert.match(
    send[1],
    /companion\.resetPerformanceScene\(\)[\s\S]*syncControlsToModelAndHost\(/,
    'sending a message must reapply the control layer so held parts survive',
  )
})

test('quick input keeps a single short placeholder instead of explanatory copy', () => {
  const input = fs.readFileSync(
    path.join(__dirname, '../src/renderer/components/QuickInput.vue'),
    'utf8',
  )
  assert.match(input, /placeholder="输入消息…"/)
  assert.match(input, /aria-label="输入消息"/)
})

test('the quick panel reports host connectivity and can reconnect', () => {
  const panel = fs.readFileSync(
    path.join(__dirname, '../src/renderer/components/QuickSettingsPanel.vue'),
    'utf8',
  )
  assert.match(panel, /onHostChanged/)
  assert.match(panel, /reconnectActiveHost/)
  assert.match(panel, /class="qs-conn-dot"/)
  assert.match(panel, /重新连接/)
  assert.match(panel, /function reconnectHost\(\)/)
})

test('the host list expands inside the panel instead of clipping a nested scroll row', () => {
  const panel = fs.readFileSync(
    path.join(__dirname, '../src/renderer/components/QuickSettingsPanel.vue'),
    'utf8',
  )
  const rule = /\.qs-host-list\s*\{[^}]*\}/.exec(panel)
  assert.ok(rule, 'host list styles should exist')
  assert.doesNotMatch(rule[0], /max-height:\s*\d+px/)
  assert.doesNotMatch(rule[0], /overflow-y:\s*auto/)
})

test('the quick model list expands inside the panel instead of clipping a nested scroll row', () => {
  const panel = fs.readFileSync(path.join(__dirname, '../src/renderer/components/QuickSettingsPanel.vue'), 'utf8')
  const rule = /\.qs-model-list\s*\{[^}]*\}/.exec(panel)
  assert.ok(rule, 'model list styles should exist')
  assert.doesNotMatch(rule[0], /max-height:\s*\d+px/)
  assert.doesNotMatch(rule[0], /overflow-y:\s*auto/)
})
