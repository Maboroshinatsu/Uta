'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const createLoader = require('./support/settings-loader.cjs')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const request = () => ({ provider: 'http', text: '你好，Uta。', endpoint: 'http://127.0.0.1:9881/tts', speed: 1 })
const response = () => ({ ok: true, audioBase64: 'YWJj', mime: 'audio/wav' })
const next = async () => { for (let index = 0; index < 8; index++) await Promise.resolve() }

function playerHarness(synthesize = async () => response()) {
  const players = [], states = [], revoked = [], timers = new Map()
  let timerId = 0
  class Audio {
    constructor(src) { this.src = src; this.duration = 2; this.currentTime = 0; this.ended = false; this.paused = false; players.push(this) }
    play() { this.onplaying?.(); return Promise.resolve() }
    pause() { this.paused = true; this.onpause?.() }
    removeAttribute(name) { delete this[name] }
    load() {}
  }
  const load = createLoader({}, { Audio, Blob, atob, performance,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: value => revoked.push(value) },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId }, clearTimeout: id => timers.delete(id),
  })
  const preview = load('renderer/services/voice-preview').createVoicePreview({ synthesize, update: (state, message) => states.push({ state, message }) })
  return { preview, players, states, revoked, timers }
}
test('settings-only synthesis gate rejects unauthorized callers without invoking a provider', async () => {
  let calls = 0
  const handler = createLoader()('main/settings-ipc/voice-preview').createVoicePreviewHandler({ isAllowedSender: () => false, synthesize: async () => { calls++; return response() } })
  assert.equal((await handler({ sender: {} }, request())).error, 'unauthorized')
  assert.equal(calls, 0)
})
test('preview accepts only bounded local/cloud requests and rejects arbitrary URLs or extra privilege fields', async () => {
  let calls = 0
  const handler = createLoader()('main/settings-ipc/voice-preview').createVoicePreviewHandler({ isAllowedSender: () => true, synthesize: async () => { calls++; return response() } })
  const event = { sender: {} }
  for (const changes of [{ provider: 'system' }, { text: 'x'.repeat(121) }, { speed: NaN }, { speed: 5 }, { endpoint: 'https://example.com/tts' }, { endpoint: 'file:///a' }, { endpoint: 'http://user:pass@localhost/tts' }, { targetSession: 'other' }]) {
    assert.equal((await handler(event, { ...request(), ...changes })).error, 'invalid-request')
  }
  assert.equal(calls, 0)
  assert.equal((await handler(event, request())).ok, true)
  assert.equal(calls, 1)
})
test('one synthesis per settings window; provider errors are sanitized and a retry is allowed', async () => {
  const pending = deferred()
  let calls = 0
  const handler = createLoader()('main/settings-ipc/voice-preview').createVoicePreviewHandler({ isAllowedSender: () => true, synthesize: () => { calls++; return pending.promise } })
  const event = { sender: {} }
  const first = handler(event, request())
  assert.equal((await handler(event, request())).error, 'busy')
  pending.resolve(response())
  assert.equal((await first).ok, true)
  assert.equal((await handler(event, request())).ok, true)
  assert.equal(calls, 2)
  const failing = createLoader()('main/settings-ipc/voice-preview').createVoicePreviewHandler({ isAllowedSender: () => true, synthesize: async () => { throw Error('secret-token-and-private-path') } })
  assert.equal((await failing(event, request())).error, 'synthesis-failed')
})
test('missing credentials and invalid audio responses never become a successful receipt', async () => {
  for (const [value, error] of [[null, 'not-configured'], [{ audioBase64: '', mime: 'audio/wav' }, 'synthesis-failed'], [{ audioBase64: 'x', mime: 'text/html' }, 'synthesis-failed']]) {
    const handler = createLoader()('main/settings-ipc/voice-preview').createVoicePreviewHandler({ isAllowedSender: () => true, synthesize: async () => value })
    assert.equal((await handler({ sender: {} }, { ...request(), provider: 'cloud' })).error, error)
  }
})
test('changing cloud backend does not forward the old key; same-backend saves preserve it', () => {
  const { normalizeCloudConfig, mergeCloudTtsConfig } = createLoader()('main/tts-cloud')
  const existing = normalizeCloudConfig({ backend: 'siliconflow', apiKey: 'test-key-first-service' })
  assert.equal(mergeCloudTtsConfig(existing, { voice: 'new-voice' }).apiKey, 'test-key-first-service')
  assert.equal(mergeCloudTtsConfig(existing, { backend: 'openai' }).apiKey, '')
  assert.equal(mergeCloudTtsConfig(existing, { backend: 'openai', apiKey: 'test-key-second-service' }).apiKey, 'test-key-second-service')
  assert.equal(mergeCloudTtsConfig(existing, { clearKey: true }).apiKey, '')
  assert.throws(() => mergeCloudTtsConfig(existing, { backend: 'unknown' }))
})
test('the actual audio player reports completion only after ended and uses the requested volume', async () => {
  const h = playerHarness()
  const work = h.preview.play(request(), .35)
  await next()
  assert.equal(h.players.length, 1)
  assert.equal(h.players[0].volume, .35)
  assert.equal(h.states.at(-1).state, 'playing')
  h.players[0].ended = true; h.players[0].onended()
  await work
  assert.equal(h.states.at(-1).state, 'success')
  assert.deepEqual(h.revoked, ['blob:test'])
  assert.equal(h.timers.size, 0)
})
test('natural pause-before-ended is not treated as an audio interruption', async () => {
  const h = playerHarness()
  const work = h.preview.play(request(), .5); await next()
  h.players[0].currentTime = 1.99; h.players[0].onpause()
  h.players[0].onended(); await work
  assert.equal(h.states.at(-1).state, 'success')
})
test('cancel during synthesis suppresses late audio and duplicate clicks cannot overlap', async () => {
  const pending = deferred(); let calls = 0
  const h = playerHarness(() => { calls++; return pending.promise })
  const work = h.preview.play(request(), .5)
  await h.preview.play(request(), .5)
  h.preview.cancel()
  assert.equal(h.preview.busy, true)
  pending.resolve(response()); await work
  assert.equal(calls, 1); assert.equal(h.players.length, 0)
  assert.equal(h.states.at(-1).state, 'cancelled')
  assert.equal(h.preview.busy, false)
})
test('stop while playing pauses audio, releases the object URL and never emits success', async () => {
  const h = playerHarness()
  const work = h.preview.play(request(), .5); await next()
  h.preview.cancel(); await work
  assert.equal(h.players[0].paused, true)
  assert.equal(h.states.some(s => s.state === 'success'), false)
  assert.equal(h.states.at(-1).state, 'cancelled')
  assert.deepEqual(h.revoked, ['blob:test'])
})
test('provider failure is visible and creates no player; retry can play normally', async () => {
  let fail = true
  const h = playerHarness(async () => fail ? { ok: false, error: 'synthesis-failed' } : response())
  await h.preview.play(request(), .5)
  assert.equal(h.states.at(-1).state, 'error'); assert.equal(h.players.length, 0)
  fail = false
  const work = h.preview.play(request(), .5); await next()
  h.players[0].onended(); await work
  assert.equal(h.states.at(-1).state, 'success')
})
test('unexpected IPC errors never expose backend bodies, paths or credentials in the UI', async () => {
  const h = playerHarness(async () => { throw Error('secret-credential and private filesystem path') })
  await h.preview.play(request(), .5)
  assert.equal(h.states.at(-1).state, 'error')
  assert.doesNotMatch(h.states.at(-1).message, /secret|private/)
})
test('unmount disposes playback and ignores a late synthesis reply', async () => {
  const pending = deferred(), h = playerHarness(() => pending.promise)
  const work = h.preview.play(request(), .5)
  h.preview.dispose(); const count = h.states.length
  pending.resolve(response()); await work
  assert.equal(h.players.length, 0); assert.equal(h.states.length, count)
})
test('a stuck audio element has a bounded playback timeout and frees its resources', async () => {
  const h = playerHarness()
  const work = h.preview.play(request(), .5); await next()
  const expire = [...h.timers.values()][0]; expire(); await work
  assert.equal(h.states.at(-1).state, 'error')
  assert.deepEqual(h.revoked, ['blob:test'])
  assert.equal(h.players[0].paused, true)
})
