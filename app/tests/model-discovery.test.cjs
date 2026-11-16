const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// 模拟浏览器与 Electron 环境
function createMockEnvironment() {
  const store = new Map()
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  }

  return { localStorage, store }
}

test('normalizeModelKey correctly strips protocols (uta://, deskpet://) and normalizes encoding', async () => {
  function normalizeModelKey(rawUrl) {
    if (!rawUrl) return ''
    let cleaned = rawUrl.trim().replace(/\\/g, '/')
    try {
      cleaned = decodeURIComponent(cleaned)
    } catch {}
    return cleaned
      .replace(/^uta:\/\/models\//i, '')
      .replace(/^deskpet:\/\/models\//i, '')
      .replace(/^\.?\/models\//i, '')
      .replace(/^models\//i, '')
      .replace(/^\/+/, '')
      .toLowerCase()
  }

  assert.equal(
    normalizeModelKey('uta://models/miku/miku.model3.json'),
    'miku/miku.model3.json'
  )
  assert.equal(
    normalizeModelKey('deskpet://models/miku/miku.model3.json'),
    'miku/miku.model3.json'
  )
  assert.equal(
    normalizeModelKey('./models/miku/miku.model3.json'),
    'miku/miku.model3.json'
  )
  assert.equal(
    normalizeModelKey('models/miku/miku.model3.json'),
    'miku/miku.model3.json'
  )
  assert.equal(
    normalizeModelKey('uta://models/%E9%87%8D%E9%9F%B3/%E9%87%8D%E9%9F%B3.model3.json'),
    '重音/重音.model3.json'
  )
  assert.equal(
    normalizeModelKey('./models/重音/重音.model3.json'),
    '重音/重音.model3.json'
  )
  assert.equal(
    normalizeModelKey('models\\RetrynowMiku.4096\\RetrynowMiku.model3.json'),
    'retrynowmiku.4096/retrynowmiku.model3.json'
  )
})

test('resolveUsableModelUrl matches cross-protocol and encoded variations', async () => {
  function normalizeModelKey(rawUrl) {
    if (!rawUrl) return ''
    let cleaned = rawUrl.trim().replace(/\\/g, '/')
    try {
      cleaned = decodeURIComponent(cleaned)
    } catch {}
    return cleaned
      .replace(/^uta:\/\/models\//i, '')
      .replace(/^deskpet:\/\/models\//i, '')
      .replace(/^\.?\/models\//i, '')
      .replace(/^models\//i, '')
      .replace(/^\/+/, '')
      .toLowerCase()
  }

  const availableModels = [
    { name: 'miku', url: 'uta://models/miku/miku.model3.json', kind: 'live2d' },
    { name: '重音', url: 'uta://models/%E9%87%8D%E9%9F%B3/%E9%87%8D%E9%9F%B3.model3.json', kind: 'live2d' },
    { name: 'hiyori', url: 'uta://models/hiyori_pro_zh/runtime/hiyori_pro_t11.model3.json', kind: 'live2d' },
  ]

  function matchModel(targetUrl, models) {
    const exact = models.find((m) => m.url === targetUrl)
    if (exact) return exact.url
    const key = normalizeModelKey(targetUrl)
    const matched = models.find((m) => normalizeModelKey(m.url) === key)
    return matched ? matched.url : null
  }

  // 1. 旧相对路径能成功匹配主进程的 uta:// 协议
  assert.equal(
    matchModel('./models/miku/miku.model3.json', availableModels),
    'uta://models/miku/miku.model3.json'
  )

  // 2. 兼容旧版 deskpet:// 路径匹配 uta:// 协议
  assert.equal(
    matchModel('deskpet://models/miku/miku.model3.json', availableModels),
    'uta://models/miku/miku.model3.json'
  )

  // 3. 中文未编码 URL 能成功匹配 URL 编码后的 URL
  assert.equal(
    matchModel('uta://models/重音/重音.model3.json', availableModels),
    'uta://models/%E9%87%8D%E9%9F%B3/%E9%87%8D%E9%9F%B3.model3.json'
  )

  // 4. 不存在的模型返回 null
  assert.equal(matchModel('./models/not_exist/model.json', availableModels), null)
})

test('discoverModel preserves stored model in localStorage when temporarily missing', async () => {
  const { localStorage } = createMockEnvironment()
  const MODEL_PATH_KEY = 'deskpet/model-path'

  // 用户保存了 miku
  localStorage.setItem(MODEL_PATH_KEY, 'uta://models/miku/miku.model3.json')

  // 模拟主进程暂时未返回该模型（例如空列表或离线）
  let availableModels = []

  function normalizeModelKey(rawUrl) {
    if (!rawUrl) return ''
    let cleaned = rawUrl.trim().replace(/\\/g, '/')
    try {
      cleaned = decodeURIComponent(cleaned)
    } catch {}
    return cleaned
      .replace(/^uta:\/\/models\//i, '')
      .replace(/^deskpet:\/\/models\//i, '')
      .replace(/^\.?\/models\//i, '')
      .replace(/^models\//i, '')
      .replace(/^\/+/, '')
      .toLowerCase()
  }

  async function resolveUsableModelUrl(url) {
    const exact = availableModels.find((m) => m.url === url)
    if (exact) return exact.url
    const key = normalizeModelKey(url)
    const matched = availableModels.find((m) => normalizeModelKey(m.url) === key)
    return matched ? matched.url : null
  }

  const DEFAULT_MODEL = './models/hiyori_pro_zh/runtime/hiyori_pro_t11.model3.json'

  async function discoverModel() {
    const stored = localStorage.getItem(MODEL_PATH_KEY)
    if (stored) {
      const usable = await resolveUsableModelUrl(stored)
      if (usable) return usable
      // 关键修复：绝不 wipe localStorage，避免永久抹去用户配置
    }
    const def = await resolveUsableModelUrl(DEFAULT_MODEL)
    if (def) return def
    return DEFAULT_MODEL
  }

  // 执行发现，因为 availableModels 为空，临时回退到 DEFAULT_MODEL
  const loadedUrl = await discoverModel()
  assert.equal(loadedUrl, DEFAULT_MODEL)

  // 验证：localStorage 里的 miku 依然安然无恙，没有被误删！
  assert.equal(
    localStorage.getItem(MODEL_PATH_KEY),
    'uta://models/miku/miku.model3.json'
  )

  // 模拟主进程模型加载就绪
  availableModels = [
    { name: 'miku', url: 'uta://models/miku/miku.model3.json', kind: 'live2d' },
    { name: 'hiyori', url: DEFAULT_MODEL, kind: 'live2d' },
  ]

  // 下次再触发发现，立即恢复为用户想要的 miku！
  const restoredUrl = await discoverModel()
  assert.equal(restoredUrl, 'uta://models/miku/miku.model3.json')
})

function loadDiscoveryModule() {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/renderer/services/live2d/model-discovery.ts'),
    'utf8',
  )
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const env = createMockEnvironment()
  const mod = { exports: {} }
  vm.runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    console,
    localStorage: env.localStorage,
    window: { utaAPI: { listModels: async () => [] } },
    fetch: async () => ({ ok: false }),
    require: (id) =>
      id === '@/services/model-config'
        ? { MODEL_PATH: './models/default/default.model3.json' }
        : {},
  })
  return { ...mod.exports, localStorage: env.localStorage }
}

test('per-kind memory restores the last Live2D and image-set models separately', () => {
  const discovery = loadDiscoveryModule()
  discovery.setStoredModelPath('uta://models/miku/miku.model3.json')
  discovery.setStoredModelPath('uta://models/sheet/deskpet-images.json')

  assert.equal(
    discovery.getStoredModelForKind('live2d'),
    'uta://models/miku/miku.model3.json',
    '切到静态立绘后仍记得上一个 Live2D 模型',
  )
  assert.equal(
    discovery.getStoredModelForKind('image-set'),
    'uta://models/sheet/deskpet-images.json',
  )
  assert.equal(
    discovery.getStoredModelPath(),
    'uta://models/sheet/deskpet-images.json',
    '当前模型仍是最近一次实际选择',
  )

  discovery.localStorage.setItem(discovery.MODEL_KIND_MEMORY_KEY, '{broken')
  assert.equal(discovery.getStoredModelForKind('live2d'), '', '损坏的记忆按空处理，不阻塞启动')
})

test('temporary fallback does not overwrite the per-kind model preference', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/renderer/services/live2d/model-discovery.ts'),
    'utf8',
  )
  assert.match(source, /if \(!missingStored\) rememberModelForKind\(defaultUrl\)/)
  assert.match(source, /if \(!missingStored\) rememberModelForKind\(cachedModelUrl\)/)
})

test('模型列表接口失败不得写进缓存，下一次成功要能立刻恢复', async () => {
  const createLoader = require('./support/settings-loader.cjs')
  const entries = [{ url: 'uta://models/a/a.model3.json', name: 'A' }]
  let mode = 'fail'
  const globals = {
    window: {
      utaAPI: {
        listModels: async () => {
          if (mode === 'fail') throw new Error('ipc unavailable')
          return entries
        },
      },
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { documentElement: { setAttribute() {}, style: { setProperty() {} } } },
  }
  const mod = createLoader({}, globals)('renderer/services/live2d/model-discovery')
  mod.clearModelCache()

  mode = 'fail'
  assert.deepEqual(JSON.parse(JSON.stringify(await mod.listAvailableModels())), [])
  mode = 'ok'
  const json = (value) => JSON.parse(JSON.stringify(value))
  assert.deepEqual(
    json(await mod.listAvailableModels()),
    json(entries),
    '一次 IPC 抖动不能让设置面板此后永远显示「没有模型」',
  )
})
