'use strict'
// STT 主进程模块：配置归一化、文本清理与本地桥请求。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const SRC = path.join(__dirname, '../src/main/stt.ts')
const code = ts.transpileModule(fs.readFileSync(SRC, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText

const adapterModule = { exports: {} }
vm.runInNewContext(
  code,
  {
    module: adapterModule,
    exports: adapterModule.exports,
    require: (name) => require(name),
    process,
    Buffer,
    console,
    setTimeout,
    clearTimeout,
    fetch,
    FormData,
    Blob,
    AbortSignal,
    URL,
  },
  { filename: SRC },
)
const {
  normalizeSttConfig,
  normalizePublicSttConfig,
  cleanTranscript,
  transcribeAudio,
} = adapterModule.exports

test('public STT config never exposes the API key', () => {
  const config = normalizeSttConfig({
    enabled: true,
    provider: 'cloud',
    backend: 'siliconflow',
    endpoint: 'https://api.siliconflow.cn/v1/audio/transcriptions',
    model: 'SenseVoice',
    apiKey: 'secret-key',
  })
  const publicConfig = normalizePublicSttConfig(config)
  assert.equal(publicConfig.hasApiKey, true)
  assert.equal('apiKey' in publicConfig, false)
  assert.equal(JSON.stringify(publicConfig).includes('secret-key'), false)
})

test('transcript cleanup removes labels and extra whitespace', () => {
  assert.equal(cleanTranscript('  识别结果：你好\n世界  '), '你好 世界')
  assert.equal(cleanTranscript(''), '')
})

test('local STT posts raw WAV and reads JSON text', async () => {
  let receivedType = ''
  let receivedBytes = 0
  const server = http.createServer((req, res) => {
    receivedType = String(req.headers['content-type'] || '')
    let size = 0
    req.on('data', (chunk) => (size += chunk.length))
    req.on('end', () => {
      receivedBytes = size
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ text: '你好，这是本地识别。' }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = server.address().port
    const text = await transcribeAudio(
      normalizeSttConfig({
        enabled: true,
        provider: 'local',
        localEndpoint: `http://127.0.0.1:${port}/stt`,
      }),
      Buffer.from('fake-wav-bytes').toString('base64'),
    )
    assert.equal(text, '你好，这是本地识别。')
    assert.match(receivedType, /application\/octet-stream/)
    assert.equal(receivedBytes, 14)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('STT is opt-in and rejects empty audio', async () => {
  await assert.rejects(
    transcribeAudio(normalizeSttConfig({ enabled: false }), Buffer.from('x').toString('base64')),
    /还没有开启/,
  )
  await assert.rejects(
    transcribeAudio(normalizeSttConfig({ enabled: true, provider: 'local' }), ''),
    /录音为空/,
  )
})

test('local STT rejects a redirect without replaying the audio body', async t => {
  let forwarded = 0
  const server = http.createServer((req, res) => {
    req.resume()
    if (req.url === '/stt') res.writeHead(307, { Location: '/redirected' }).end()
    else { forwarded++; res.end('unexpected') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const config = normalizeSttConfig({ enabled: true, provider: 'local', localEndpoint: `http://127.0.0.1:${server.address().port}/stt` })
  await assert.rejects(transcribeAudio(config, Buffer.from('fake-wav').toString('base64')))
  assert.equal(forwarded, 0)
})
