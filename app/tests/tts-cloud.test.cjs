'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/main/tts-cloud.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
).outputText
const mod = { exports: {} }
vm.runInNewContext(code, {
  module: mod,
  exports: mod.exports,
  require: (id) => require(id),
  URL,
  Buffer,
  console,
})
const {
  synthesizeCloudSpeech,
  normalizeCloudConfig,
  normalizePublicCloudConfig,
  mergeCloudTtsConfig,
  stripSensitiveRedirectHeaders,
  shouldBlockCredentialDowngrade,
} = mod.exports

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

test('cloud config normalizes backends and keeps public config free of keys', () => {
  const config = normalizePublicCloudConfig({
    backend: 'siliconflow',
    endpoint: 'https://example.com/tts',
    model: 'm',
    voice: 'v',
    apiKey: 'SECRET',
  })
  assert.equal(config.backend, 'siliconflow')
  assert.equal(config.endpoint, 'https://example.com/tts')
  assert.equal(config.hasApiKey, false)
  const fallback = normalizePublicCloudConfig({ backend: 'unknown', endpoint: 'file:///x' })
  assert.equal(fallback.backend, 'siliconflow')
  assert.match(fallback.endpoint, /^https:/)
})

test('a key is kept only for the same backend and endpoint origin', () => {
  const initial = normalizeCloudConfig({
    backend: 'openai',
    endpoint: 'https://one.invalid/v1/audio/speech',
    apiKey: 'owner-key',
  })
  assert.equal(
    mergeCloudTtsConfig(initial, { endpoint: 'https://one.invalid/other-path' }).apiKey,
    'owner-key',
  )
  assert.equal(
    mergeCloudTtsConfig(initial, { endpoint: 'https://two.invalid/v1/audio/speech' }).apiKey,
    '',
  )
  assert.equal(
    mergeCloudTtsConfig(initial, { endpoint: 'https://two.invalid/v1/audio/speech', apiKey: 'new-key' }).apiKey,
    'new-key',
  )
  assert.equal(mergeCloudTtsConfig(initial, { backend: 'siliconflow' }).apiKey, '')
  assert.equal(mergeCloudTtsConfig(initial, { clearKey: true }).apiKey, '')
})

test('redirect helpers strip all cloud auth headers and block credential downgrades', () => {
  assert.equal(
    JSON.stringify(stripSensitiveRedirectHeaders({
      Authorization: 'Bearer a',
      'api-key': 'b',
      api_token: 'c',
      Cookie: 'd',
      'Content-Type': 'application/json',
    })),
    JSON.stringify({ 'Content-Type': 'application/json' }),
  )
  assert.equal(
    shouldBlockCredentialDowngrade(
      'https://one.invalid/tts',
      'http://two.invalid/audio',
      { Authorization: 'Bearer a' },
    ),
    true,
  )
  assert.equal(
    shouldBlockCredentialDowngrade(
      'https://one.invalid/tts',
      'http://two.invalid/audio',
      { 'Content-Type': 'application/json' },
    ),
    false,
  )
  assert.equal(
    shouldBlockCredentialDowngrade(
      'http://one.invalid/tts',
      'http://two.invalid/audio',
      { Authorization: 'Bearer a' },
    ),
    false,
  )
})

test('cross-origin redirect does not forward the cloud API key', async (t) => {
  const wav = Buffer.from([0x52, 0x49, 0x46, 0x46, 9, 9, 9])
  let firstAuth = ''
  let secondAuth = ''
  const second = await startServer((req, res) => {
    secondAuth = String(req.headers.authorization || '')
    res.setHeader('Content-Type', 'audio/wav')
    res.end(wav)
  })
  const first = await startServer((req, res) => {
    firstAuth = String(req.headers.authorization || '')
    res.statusCode = 302
    res.setHeader('Location', `http://127.0.0.1:${second.port}/audio`)
    res.end()
  })
  t.after(async () => { await first.close(); await second.close() })
  const result = await synthesizeCloudSpeech({
    backend: 'openai',
    apiKey: 'owner-key',
    endpoint: `http://127.0.0.1:${first.port}/v1/audio/speech`,
    model: 'tts-1',
    voice: 'nova',
    style: '',
  }, 'hello')
  assert.equal(firstAuth, 'Bearer owner-key')
  assert.equal(secondAuth, '')
  assert.equal(result.audioBase64, wav.toString('base64'))
})

test('same-origin redirect keeps auth and 307 preserves the POST body', async (t) => {
  const wav = Buffer.from([0x52, 0x49, 0x46, 0x46, 7, 7, 7])
  let secondMethod = ''
  let secondBody = ''
  let secondAuth = ''
  const server = await startServer((req, res) => {
    if (req.url === '/start') {
      res.statusCode = 307
      res.setHeader('Location', '/audio')
      res.end()
      return
    }
    secondMethod = String(req.method || '')
    secondAuth = String(req.headers.authorization || '')
    req.on('data', (chunk) => { secondBody += chunk })
    req.on('end', () => {
      res.setHeader('Content-Type', 'audio/wav')
      res.end(wav)
    })
  })
  t.after(() => server.close())
  const result = await synthesizeCloudSpeech({
    backend: 'openai',
    apiKey: 'same-origin-key',
    endpoint: `http://127.0.0.1:${server.port}/start`,
    model: 'tts-1',
    voice: 'nova',
    style: '',
  }, '你好')
  assert.equal(secondMethod, 'POST')
  assert.equal(secondAuth, 'Bearer same-origin-key')
  assert.match(secondBody, /"input":"你好"/)
  assert.equal(result.audioBase64, wav.toString('base64'))
})

test('301/302 redirects retry as GET without the original body', async (t) => {
  const wav = Buffer.from([0x52, 0x49, 0x46, 0x46, 5, 5, 5])
  let secondMethod = ''
  let secondBody = ''
  let secondAuth = ''
  const server = await startServer((req, res) => {
    if (req.url === '/start') {
      res.statusCode = 302
      res.setHeader('Location', '/audio')
      res.end()
      return
    }
    secondMethod = String(req.method || '')
    secondAuth = String(req.headers.authorization || '')
    req.on('data', (chunk) => { secondBody += chunk })
    req.on('end', () => {
      res.setHeader('Content-Type', 'audio/wav')
      res.end(wav)
    })
  })
  t.after(() => server.close())
  await synthesizeCloudSpeech({
    backend: 'openai',
    apiKey: 'same-origin-key',
    endpoint: `http://127.0.0.1:${server.port}/start`,
    model: 'tts-1',
    voice: 'nova',
    style: '',
  }, 'hello')
  assert.equal(secondMethod, 'GET')
  assert.equal(secondAuth, 'Bearer same-origin-key')
  assert.equal(secondBody, '')
})

test('OpenAI-compatible cloud request sends audio back as base64', async (t) => {
  const wav = Buffer.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3])
  const server = await startServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const parsed = JSON.parse(body)
      assert.equal(req.headers.authorization, 'Bearer test-key')
      assert.equal(parsed.input, '你好')
      assert.equal(parsed.voice, 'nova')
      assert.equal(parsed.model, 'tts-1')
      res.setHeader('Content-Type', 'audio/wav')
      res.end(wav)
    })
  })
  t.after(() => server.close())
  const result = await synthesizeCloudSpeech(
    {
      backend: 'openai',
      apiKey: 'test-key',
      endpoint: `http://127.0.0.1:${server.port}/v1/audio/speech`,
      model: 'tts-1',
      voice: 'nova',
      style: '',
    },
    '你好',
  )
  assert.equal(result.mime, 'audio/wav')
  assert.equal(result.audioBase64, wav.toString('base64'))
})

test('MiMo JSON base64 response is decoded', async (t) => {
  const audio = Buffer.from('mimo-audio')
  const server = await startServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const parsed = JSON.parse(body)
      assert.equal(req.headers['api-key'], 'mimo-key')
      assert.equal(parsed.messages[0].role, 'user')
      assert.equal(parsed.messages[1].content, '说话')
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { audio: { data: audio.toString('base64') } } }] }))
    })
  })
  t.after(() => server.close())
  const result = await synthesizeCloudSpeech(
    {
      backend: 'mimo',
      apiKey: 'mimo-key',
      endpoint: `http://127.0.0.1:${server.port}/v1/chat/completions`,
      model: 'mimo-v2.5-tts',
      voice: 'mimo_default',
      style: '温柔一点',
    },
    '说话',
  )
  assert.equal(result.audioBase64, audio.toString('base64'))
})

test('DeepSeek defaults use the tools endpoint without a model and never reuse another service key', () => {
  const config = normalizeCloudConfig({ backend: 'deepseek' })
  assert.equal(config.backend, 'deepseek')
  assert.equal(config.endpoint, 'https://api.deepseek.com/v1/tools/tts')
  assert.equal(config.model, '')
  assert.equal(config.voice, 'stella')
  const previous = normalizeCloudConfig({ backend: 'siliconflow', apiKey: 'other-service-key' })
  const switched = mergeCloudTtsConfig(previous, { ...config, apiKey: undefined })
  assert.equal(switched.apiKey, '')
  const saved = mergeCloudTtsConfig(switched, { apiKey: 'deepseek-key' })
  assert.equal(mergeCloudTtsConfig(saved, { voice: 'tide' }).apiKey, 'deepseek-key')
  assert.equal(Object.hasOwn(normalizePublicCloudConfig(saved), 'apiKey'), false)
})

for (const voice of ['stella', 'tide']) {
  test(`DeepSeek ${voice} sends the native request and collects the full chunked WAV`, async (t) => {
    const wav = Buffer.alloc(48)
    wav.write('RIFF'); wav.writeUInt32LE(40, 4); wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28)
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(4, 40)
    const requests = []
    const server = await startServer((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        requests.push({ method: req.method, path: req.url, auth: req.headers.authorization, body: JSON.parse(body) })
        res.setHeader('Content-Type', 'audio/wav')
        res.write(wav.subarray(0, 44))
        setImmediate(() => res.end(wav.subarray(44)))
      })
    })
    t.after(() => server.close())
    const result = await synthesizeCloudSpeech({
      backend: 'deepseek', endpoint: `http://127.0.0.1:${server.port}/v1/tools/tts`,
      apiKey: 'deepseek-test-key', voice, model: 'unused-model', style: 'unused-style',
    }, '**你好，Uta。**', 1.8)
    assert.deepEqual(requests, [{
      method: 'POST', path: '/v1/tools/tts', auth: 'Bearer deepseek-test-key',
      body: { text: '**你好，Uta。**', voice_id: voice, format: 'wav', filter_markdown: true },
    }])
    assert.equal(result.mime, 'audio/wav')
    assert.equal(result.audioBase64, wav.toString('base64'))
  })
}

test('DeepSeek rejects missing credentials, empty text and unknown voices before sending a request', async (t) => {
  let requests = 0
  const server = await startServer((_req, res) => { requests++; res.end() })
  t.after(() => server.close())
  const config = { backend: 'deepseek', endpoint: `http://127.0.0.1:${server.port}/tts` }
  await assert.rejects(synthesizeCloudSpeech(config, '你好'), /API Key/)
  await assert.rejects(synthesizeCloudSpeech({ ...config, apiKey: 'test-key' }, ' '), /文本为空/)
  await assert.rejects(synthesizeCloudSpeech({ ...config, apiKey: 'test-key', voice: 'nova' }, '你好'), /音色/)
  assert.equal(requests, 0)
})

test('DeepSeek HTTP errors expose only the status and are never retried automatically', async (t) => {
  let requests = 0
  const server = await startServer((_req, res) => {
    requests++
    res.writeHead(429, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: 'private-text deepseek-test-key' }))
  })
  t.after(() => server.close())
  await assert.rejects(synthesizeCloudSpeech({
    backend: 'deepseek', endpoint: `http://127.0.0.1:${server.port}/tts`, apiKey: 'deepseek-test-key',
  }, '你好'), error => {
    assert.equal(error.message, 'DeepSeek TTS 返回 HTTP 429')
    return true
  })
  assert.equal(requests, 1)
})

test('DeepSeek rejects empty audio, JSON errors and non-audio success bodies', async (t) => {
  const replies = [
    { mime: 'audio/wav', body: '', error: /空音频/ },
    { mime: 'application/json', body: '{}', error: /JSON/ },
    { mime: 'text/html', body: '<html>gateway error</html>', error: /WAV/ },
  ]
  const server = await startServer((req, res) => {
    const reply = replies[Number(req.url.slice(1))]
    res.setHeader('Content-Type', reply.mime)
    res.end(reply.body)
  })
  t.after(() => server.close())
  for (let index = 0; index < replies.length; index++) {
    await assert.rejects(synthesizeCloudSpeech({
      backend: 'deepseek', endpoint: `http://127.0.0.1:${server.port}/${index}`, apiKey: 'test-key',
    }, '你好'), replies[index].error)
  }
})

test('DeepSeek interrupted audio fails instead of returning partial WAV as success', { timeout: 5000 }, async (t) => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'audio/wav' })
    res.write(Buffer.from('RIFFpartial'))
    setImmediate(() => res.destroy())
  })
  t.after(() => server.close())
  await assert.rejects(synthesizeCloudSpeech({
    backend: 'deepseek', endpoint: `http://127.0.0.1:${server.port}/tts`, apiKey: 'test-key',
  }, '你好'), /aborted|reset|hang up/i)
})

test('cloud errors surface without leaking the API key', async (t) => {
  const server = await startServer((req, res) => {
    res.statusCode = 401
    res.end('unauthorized')
  })
  t.after(() => server.close())
  await assert.rejects(
    synthesizeCloudSpeech(
      {
        backend: 'siliconflow',
        apiKey: 'TOP-SECRET-KEY',
        endpoint: `http://127.0.0.1:${server.port}/tts`,
        model: 'm',
        voice: 'v',
        style: '',
      },
      'hello',
    ),
    (error) => {
      assert.match(error.message, /401/)
      assert.ok(!error.message.includes('TOP-SECRET-KEY'))
      return true
    },
  )
})
