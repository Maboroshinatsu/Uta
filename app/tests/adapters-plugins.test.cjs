'use strict'
// 声明式 HTTP 适配器插件：清单校验、通用执行器、设置存储与旧地址迁移。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { createServer } = require('node:http')
const { once } = require('node:events')

const { loadHostModule } = require('./helpers/host-loader.cjs')
const { NO_CAPABILITIES } = loadHostModule('contracts')

function compile(rel) {
  return ts.transpileModule(
    fs.readFileSync(path.resolve(__dirname, rel), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText
}

function runModule(code, filename, requireShim, extraGlobals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      require: requireShim,
      console,
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
      Date,
      crypto: require('node:crypto').webcrypto,
      Set,
      URL,
      AbortController,
      __filename: filename,
      ...extraGlobals,
    },
    { filename },
  )
  return module.exports
}

const manifestModule = runModule(
  compile('../src/renderer/services/adapters/plugin-manifest.ts'),
  'plugin-manifest.ts',
  (spec) => {
    if (spec.includes('contracts')) return { NO_CAPABILITIES }
    throw new Error(`Unexpected import: ${spec}`)
  },
)
const { validateAdapterManifest } = manifestModule

const companionContract = runModule(compile('../src/shared/companion-http-contract.ts'), 'companion-http-contract.ts', require)
const builtinModule = runModule(
  compile('../src/renderer/services/adapters/builtin-plugin-manifests.ts'),
  'builtin-plugin-manifests.ts',
  (spec) => {
    if (spec.includes('contracts')) return { NO_CAPABILITIES }
    if (spec.endsWith('/companion-http-contract')) return companionContract
    throw new Error(`Unexpected import: ${spec}`)
  },
)
const { BUILTIN_PLUGIN_MANIFESTS } = builtinModule

function createSettingsModule(storage = {}) {
  const localStorage = {
    getItem: (key) => (key in storage ? storage[key] : null),
    setItem: (key, value) => {
      storage[key] = String(value)
    },
  }
  return runModule(
    compile('../src/renderer/services/adapters/adapter-plugin-settings.ts'),
    'adapter-plugin-settings.ts',
    (spec) => {
      if (spec.includes('plugin-manifest')) return {}
      throw new Error(`Unexpected import: ${spec}`)
    },
    { localStorage },
  )
}

function createHttpModule(settingsModule, storage = {}, extraGlobals = {}) {
  const localStorage = {
    getItem: (key) => (key in storage ? storage[key] : null),
    setItem: (key, value) => {
      storage[key] = String(value)
    },
  }
  return runModule(
    compile('../src/renderer/services/adapters/plugin-http.ts'),
    'plugin-http.ts',
    (spec) => {
      if (spec.includes('contracts')) return { NO_CAPABILITIES }
      if (spec.includes('adapter-plugin-settings')) return settingsModule
      if (spec.endsWith('/companion-http-contract')) return companionContract
      throw new Error(`Unexpected import: ${spec}`)
    },
    { localStorage, Response, ...extraGlobals },
  )
}

function manifestById(id) {
  const manifest = BUILTIN_PLUGIN_MANIFESTS.find((item) => item.id === id)
  assert.ok(manifest, `missing builtin manifest: ${id}`)
  return manifest
}

function callsRecorder() {
  const calls = []
  const fetchFn = async (url, opts = {}) => {
    calls.push({
      url,
      method: opts.method || 'GET',
      body: opts.body ? JSON.parse(opts.body) : null,
    })
    return { ok: true, json: async () => ({ ok: true }) }
  }
  return { calls, fetchFn }
}

test('内置 HTTP 适配器清单全部通过校验', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(BUILTIN_PLUGIN_MANIFESTS.map((item) => item.id))),
    ['maibot', 'astrbot'],
  )
  for (const manifest of BUILTIN_PLUGIN_MANIFESTS) {
    const result = validateAdapterManifest(manifest)
    assert.equal(result.ok, true, result.ok ? '' : result.error)
    assert.equal(result.value.category, 'adapter')
    assert.equal(result.value.capabilities.sendInput, true)
    assert.equal(result.value.capabilities.characterTools, true)
    assert.ok(result.value.routes.health)
    assert.ok(result.value.routes.text)
  }
})

test('清单校验拒绝坏 ID、缺失基础地址字段和路径逃逸', () => {
  const base = JSON.parse(JSON.stringify(manifestById('maibot')))

  const badId = { ...base, id: 'Bad ID' }
  assert.equal(validateAdapterManifest(badId).ok, false)

  const missingBase = { ...base, baseUrlSetting: 'missing' }
  assert.equal(validateAdapterManifest(missingBase).ok, false)

  const badPath = JSON.parse(JSON.stringify(base))
  badPath.routes.health.path = '/../secret'
  assert.equal(validateAdapterManifest(badPath).ok, false)

  const badCapabilities = { ...base, capabilities: { ...base.capabilities, sendInput: 'yes' } }
  assert.equal(validateAdapterManifest(badCapabilities).ok, false)

  const reserved = { ...base, id: 'fake' }
  assert.equal(validateAdapterManifest(reserved).ok, false)

  const encodedTraversal = JSON.parse(JSON.stringify(base))
  encodedTraversal.routes.health.path = '/%2e%2e/secret'
  assert.equal(validateAdapterManifest(encodedTraversal).ok, false)

  const getText = JSON.parse(JSON.stringify(base))
  getText.routes.text.method = 'GET'
  assert.equal(validateAdapterManifest(getText).ok, false)

  const missingTextToken = JSON.parse(JSON.stringify(base))
  missingTextToken.routes.text.body = { foo: 'bar' }
  assert.equal(validateAdapterManifest(missingTextToken).ok, false)

  const badHealthKey = { ...base, healthOkKey: 'bad key with spaces' }
  assert.equal(validateAdapterManifest(badHealthKey).ok, false)
})

test('MaiBot 通过主进程请求已认证的就绪检查和写入接口', async (t) => {
  const settings = createSettingsModule()
  const calls = []
  const { createHttpPluginAdapter } = createHttpModule(settings, {}, { window: { utaAPI: {
    requestCompanionHost: async (host, base, route, body) => {
      assert.equal(host, 'maibot')
      calls.push({ url: base + route, body: body ? JSON.parse(body) : null })
      return 200
    },
  } } })
  const manifest = manifestById('maibot')
  const adapter = createHttpPluginAdapter(manifest, {
    getBaseUrl: () => 'http://127.0.0.1:8524',
  })
  t.after(() => adapter.dispose())

  const states = []
  adapter.subscribe((event) => {
    if (event.kind === 'connection') states.push(event.state)
  })
  assert.equal(states[0], 'disconnected', '订阅时回放当前状态')
  states.length = 0
  adapter.connect()
  assert.equal(states[0], 'connecting')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(adapter.getConnectionState(), 'connected')
  assert.equal(calls[0].url, 'http://127.0.0.1:8524/v1/ready')
  assert.equal(calls[0].body, null)

  assert.equal(adapter.sendUserText('   '), false)
  assert.equal(adapter.sendUserText('指挥官，今天辛苦啦'), true)
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(calls[1].url, 'http://127.0.0.1:8524/v1/input/text')
  assert.equal(calls[1].body.text, '指挥官，今天辛苦啦')
  assert.match(calls[1].body.request_id, /^uta-[0-9a-f-]{36}$/)

  assert.equal(adapter.sendScreenshot(''), false)
  assert.equal(adapter.sendScreenshot('data:image/png;base64,mock'), true)
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(calls[2].url, 'http://127.0.0.1:8524/v1/input/screenshot')
  assert.equal(calls[2].body.image, 'data:image/png;base64,mock')

  assert.equal(adapter.sendModelEmotions(['happy', 'shy']), true)
  assert.equal(
    adapter.sendModelControls(
      [{ id: 'c1', name: '耳朵', category: 'part', active: false }],
      [{ id: 'p1', label: '开心', emotion: 'happy', controls: [] }],
    ),
    true,
  )
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(calls[3].url, 'http://127.0.0.1:8524/v1/sync/model')
  assert.deepEqual(calls[3].body.emotions, ['happy', 'shy'])
  assert.equal(calls[4].url, 'http://127.0.0.1:8524/v1/sync/model')
  assert.equal(calls[4].body.controls[0].name, '耳朵')

  adapter.dispose()
})

test('MaiBot 鉴权失败时不显示在线，缺少主进程接口时不改用直连', async (t) => {
  const settings = createSettingsModule()
  const window = {
    utaAPI: { requestCompanionHost: async () => 401 },
    fetch: async () => assert.fail('MaiBot must not fall back to renderer fetch'),
  }
  const { createHttpPluginAdapter } = createHttpModule(settings, {}, { window })
  const adapter = createHttpPluginAdapter(manifestById('maibot'))
  t.after(() => adapter.dispose())
  adapter.connect()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(adapter.getConnectionState(), 'disconnected')
  assert.match((await adapter.sendUserTextReceipt('hello')).message, /配对校验失败/)
  delete window.utaAPI.requestCompanionHost
  const noBridge = createHttpPluginAdapter(manifestById('maibot'))
  assert.equal((await noBridge.sendUserTextReceipt('hello')).ok, false)
})

test('companion transport loss reports uncertain delivery for both paired hosts', async t => {
  const { createHttpPluginAdapter } = createHttpModule(createSettingsModule(), {}, {
    window: { utaAPI: { requestCompanionHost: async () => null } },
  })
  for (const host of ['maibot', 'astrbot']) {
    const adapter = createHttpPluginAdapter(manifestById(host))
    t.after(() => adapter.dispose())
    const result = await adapter.sendUserTextReceipt('one submission')
    assert.equal(result.ok, false)
    assert.equal(result.delivery, 'unknown')
  }
})

test('MaiBot 传输只向固定本机路由发送派生令牌，拒绝重定向和旧路由', async (t) => {
  const { requestCompanionHost } = runModule(
    compile('../src/main/companion-http.ts'), 'companion-http.ts',
    spec => spec.endsWith('/companion-http-contract') ? companionContract : require(spec),
    { Buffer, AbortSignal, fetch },
  )
  const calls = []
  const server = createServer((req, res) => {
    calls.push({ method: req.method, url: req.url, authorization: req.headers.authorization })
    req.resume()
    if (req.url === '/v1/input/text') {
      res.writeHead(307, { Location: '/unexpected' }).end()
    } else {
      res.writeHead(200).end()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://localhost:${server.address().port}`
  assert.equal(await requestCompanionHost('maibot', 'test-token', base, '/v1/ready', undefined), 200)
  assert.deepEqual(calls[0], {
    method: 'GET', url: '/v1/ready',
    authorization: 'Bearer af1d38612b3bdbe5902e50c0bde3be55125d9195b2aeae3a168a52537cfeeebb',
  })
  assert.equal(await requestCompanionHost('maibot', 'test-token', base, '/v1/input/text', '{}'), null)
  assert.equal(calls[1].method, 'POST')
  assert.equal(calls[1].authorization, calls[0].authorization)
  assert.equal(await requestCompanionHost('maibot', 'test-token', base, '/input/text', '{}'), 400)
  assert.equal(await requestCompanionHost('maibot', 'test-token', 'http://192.0.2.1:8524', '/v1/ready', undefined), 400)
  assert.equal(await requestCompanionHost('astrbot', 'test-token', base, '/v1/ready', undefined), 200)
  assert.equal(calls[2].authorization, 'Bearer 3c3613f8811b76144455aa3a5822d768eb6b1b50f2269035a39c13ec68a19604')
  assert.equal(calls.length, 3)
})

test('HTTP adapter reports delivery receipts and does not claim success on failure', async () => {
  const settings = createSettingsModule()
  const { createHttpPluginAdapter } = createHttpModule(settings)
  const recorder = callsRecorder()
  const adapter = createHttpPluginAdapter(manifestById('maibot'), {
    fetchFn: recorder.fetchFn,
    getBaseUrl: () => 'http://127.0.0.1:8524',
  })
  const ok = await adapter.sendUserTextReceipt('receipt text')
  assert.equal(ok.ok, true)
  assert.equal(recorder.calls[0].url, 'http://127.0.0.1:8524/v1/input/text')
  adapter.dispose()

  const failing = createHttpPluginAdapter(manifestById('maibot'), {
    fetchFn: async () => ({ ok: false, status: 503 }),
    getBaseUrl: () => 'http://127.0.0.1:8524',
  })
  const failed = await failing.sendUserTextReceipt('receipt text')
  assert.equal(failed.ok, false)
  assert.equal(failed.error, 'failed')
  assert.match(failed.message, /503/)
  failing.dispose()

  const unconfigured = createHttpPluginAdapter(manifestById('maibot'), {
    fetchFn: recorder.fetchFn,
    getBaseUrl: () => '',
  })
  const missing = await unconfigured.sendUserTextReceipt('receipt text')
  assert.equal(missing.ok, false)
  assert.equal(missing.error, 'not-configured')
  unconfigured.dispose()
})

test('AstrBot 文本通过主进程使用已鉴权的私聊路由', async () => {
  const settings = createSettingsModule()
  const calls = []
  const { createHttpPluginAdapter } = createHttpModule(settings, {}, { window: { utaAPI: {
    requestCompanionHost: async (host, base, route, body) => {
      calls.push({ host, url: base + route, body: JSON.parse(body) })
      return 202
    },
  } } })
  const adapter = createHttpPluginAdapter(manifestById('astrbot'), {
    getBaseUrl: () => 'http://127.0.0.1:8526',
  })

  assert.equal((await adapter.sendUserTextReceipt('你好 AstrBot')).ok, true)
  assert.equal(calls[0].host, 'astrbot')
  assert.equal(calls[0].url, 'http://127.0.0.1:8526/v1/input/text')
  assert.equal(calls[0].body.text, '你好 AstrBot')
  assert.match(calls[0].body.request_id, /^uta-[0-9a-f-]{36}$/)

  adapter.dispose()
})

test('插件设置使用 manifest 默认地址并按类型归一化', () => {
  const settings = createSettingsModule({})
  const manifest = {
    ...manifestById('astrbot'),
    settings: [
      ...manifestById('astrbot').settings,
      { key: 'enabled', type: 'boolean', label: '启用', default: true },
      { key: 'retries', type: 'number', label: '重试', default: 2, min: 0, max: 5 },
      {
        key: 'mode',
        type: 'select',
        label: '模式',
        default: 'a',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
      },
    ],
  }

  const values = settings.getPluginSettings(manifest)
  assert.equal(values.baseUrl, 'http://127.0.0.1:8526')
  assert.equal(values.enabled, true)
  assert.equal(values.retries, 2)
  assert.equal(values.mode, 'a')

  settings.setPluginSetting(manifest, 'baseUrl', 'http://127.0.0.1:9998/other/')
  settings.setPluginSetting(manifest, 'retries', 99)
  settings.setPluginSetting(manifest, 'mode', 'c')
  const updated = settings.getPluginSettings(manifest)
  assert.equal(settings.getPluginBaseUrl(manifest), 'http://127.0.0.1:9998/other')
  assert.equal(updated.retries, 5)
  assert.equal(updated.mode, 'a')
  assert.equal(settings.isHttpBaseUrl('file:///etc/passwd'), false)
  assert.equal(settings.isHttpBaseUrl('http://127.0.0.1:9998'), true)
})
