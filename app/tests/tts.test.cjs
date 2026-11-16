'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/main/tts.ts'), 'utf8'),
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
const { synthesizeSpeech, validateSpeechText, DEFAULT_TTS_ENDPOINT } = mod.exports

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

test('speech text is trimmed, bounded and rejects empty input', () => {
  assert.equal(validateSpeechText('  hello   world  '), 'hello world')
  assert.throws(() => validateSpeechText('   '), /empty/)
  assert.throws(() => validateSpeechText('x'.repeat(1001)), /exceeds/)
  assert.equal(DEFAULT_TTS_ENDPOINT, 'http://127.0.0.1:9881/tts')
})

test('non-loopback TTS endpoints are rejected before any request', async () => {
  await assert.rejects(
    synthesizeSpeech({ text: 'hello', endpoint: 'http://example.com/tts' }),
    /loopback/,
  )
  await assert.rejects(
    synthesizeSpeech({ text: 'hello', endpoint: 'file:///etc/passwd' }),
    /http or https/,
  )
})

test('binary audio responses are returned as base64 with mime', async (t) => {
  const wav = Buffer.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4])
  const server = await startServer((req, res) => {
    assert.equal(req.url, '/tts')
    assert.equal(req.headers['content-type'], 'application/json')
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const parsed = JSON.parse(body)
      assert.equal(parsed.text, '你好')
      assert.equal(parsed.style, 'cheerful')
      assert.equal(parsed.speed_factor, 0.9)
      res.setHeader('Content-Type', 'audio/wav')
      res.end(wav)
    })
  })
  t.after(() => server.close())

  const result = await synthesizeSpeech({
    text: '你好',
    style: 'cheerful',
    speed: 0.9,
    endpoint: `http://127.0.0.1:${server.port}/tts`,
  })
  assert.equal(result.mime, 'audio/wav')
  assert.equal(result.audioBase64, wav.toString('base64'))
})

test('JSON audio responses are supported', async (t) => {
  const server = await startServer((req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ audioBase64: Buffer.from('abc').toString('base64'), mime: 'audio/mpeg' }))
  })
  t.after(() => server.close())

  const result = await synthesizeSpeech({
    text: 'hello',
    endpoint: `http://127.0.0.1:${server.port}/tts`,
  })
  assert.equal(result.mime, 'audio/mpeg')
  assert.equal(Buffer.from(result.audioBase64, 'base64').toString(), 'abc')
})

test('TTS bridge HTTP errors are surfaced', async (t) => {
  const server = await startServer((req, res) => {
    res.statusCode = 502
    res.end('bad gateway')
  })
  t.after(() => server.close())
  await assert.rejects(
    synthesizeSpeech({ text: 'hello', endpoint: `http://127.0.0.1:${server.port}/tts` }),
    /HTTP 502/,
  )
})
