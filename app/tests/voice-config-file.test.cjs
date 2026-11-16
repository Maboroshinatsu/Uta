'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/main/voice-config-file.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
).outputText
const mod = { exports: {} }
vm.runInNewContext(code, {
  module: mod,
  exports: mod.exports,
  require,
  process,
  Buffer,
  console,
}, { filename: 'voice-config-file.ts' })
const {
  readVoiceConfigFile,
  writeVoiceConfigFile,
  shouldBlockVoiceConfigWrite,
  shouldPreserveEncryptedApiKey,
} = mod.exports

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-voice-config-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('missing, corrupt and unreadable config files are distinguishable', (t) => {
  const dir = tempDir(t)
  const file = path.join(dir, 'tts-cloud.json')
  assert.equal(readVoiceConfigFile(file).kind, 'missing')

  fs.writeFileSync(file, '{not-json', 'utf8')
  assert.equal(readVoiceConfigFile(file).kind, 'corrupt')

  const directory = path.join(dir, 'config-as-directory')
  fs.mkdirSync(directory)
  assert.equal(readVoiceConfigFile(directory).kind, 'unreadable')
})

test('writes replace the file atomically and keep a valid old document as backup', (t) => {
  const dir = tempDir(t)
  const file = path.join(dir, 'tts-cloud.json')
  writeVoiceConfigFile(file, { endpoint: 'one', encryptedApiKey: 'cipher-one' })
  const firstRaw = fs.readFileSync(file, 'utf8')
  const first = readVoiceConfigFile(file)
  assert.equal(first.kind, 'ok')
  assert.equal(first.record.endpoint, 'one')
  assert.equal(first.encryptedApiKey, 'cipher-one')

  writeVoiceConfigFile(file, { endpoint: 'two', encryptedApiKey: 'cipher-two' }, { previousRaw: firstRaw })
  const second = readVoiceConfigFile(file)
  assert.equal(second.kind, 'ok')
  assert.equal(second.record.endpoint, 'two')
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), firstRaw)

  const secondRaw = fs.readFileSync(file, 'utf8')
  writeVoiceConfigFile(file, { endpoint: 'three' }, { previousRaw: secondRaw })
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), secondRaw)
  assert.equal(readVoiceConfigFile(file).record.endpoint, 'three')
  assert.equal(fs.readdirSync(dir).filter(name => name.includes('.tmp.')).length, 0)
})

test('a corrupt current file does not overwrite an existing valid backup', (t) => {
  const dir = tempDir(t)
  const file = path.join(dir, 'stt.json')
  const goodBackup = '{"endpoint":"last-good"}\n'
  fs.writeFileSync(`${file}.bak`, goodBackup, 'utf8')
  fs.writeFileSync(file, '{broken', 'utf8')
  assert.equal(readVoiceConfigFile(file).kind, 'corrupt')

  writeVoiceConfigFile(file, { endpoint: 'new' })
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), goodBackup)
  assert.equal(readVoiceConfigFile(file).record.endpoint, 'new')
})

test('write blocking and encrypted-key preservation are explicit decisions', () => {
  assert.equal(shouldBlockVoiceConfigWrite('config-unreadable'), true)
  assert.equal(shouldBlockVoiceConfigWrite('config-corrupt'), true)
  assert.equal(shouldBlockVoiceConfigWrite('decrypt-failed'), false)
  assert.equal(shouldBlockVoiceConfigWrite(undefined), false)

  assert.equal(shouldPreserveEncryptedApiKey('decrypt-failed', false, true), true)
  assert.equal(shouldPreserveEncryptedApiKey('decrypt-failed', true, true), false)
  assert.equal(shouldPreserveEncryptedApiKey('decrypt-failed', false, false), false)
  assert.equal(shouldPreserveEncryptedApiKey(undefined, false, true), false)
})
