'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/services/mouth-motion.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const mod = { exports: {} }
vm.runInNewContext(code, { module: mod, exports: mod.exports, console, Math, Array, Float32Array })
const {
  TextSpeechClock,
  smoothMouth,
  buildAmplitudeEnvelope,
  TtsMouthTracker,
} = mod.exports

const CHAR_MS = 1000 / 9

test('text speech clock opens inside a character and pauses on punctuation', () => {
  const clock = new TextSpeechClock()
  clock.start(0)
  assert.equal(clock.level('', 0), 0)
  assert.equal(clock.level('你好', 0), 0)
  assert.ok(clock.level('你好', CHAR_MS * 0.5) > 0.2)

  const punctuation = new TextSpeechClock()
  punctuation.start(0)
  assert.equal(punctuation.level('你好，世界', CHAR_MS * 2 + 1), 0)

  const spaces = new TextSpeechClock()
  spaces.start(0)
  assert.equal(spaces.level('  ', CHAR_MS * 0.5), 0)
})

test('text speech clock waits at the end and resumes with newly arrived text', () => {
  const clock = new TextSpeechClock()
  clock.start(0)
  assert.equal(clock.level('你好', 5000), 0)
  assert.ok(clock.level('你好世界', 5050) > 0.2)
})

test('text speech clock resets when the message is replaced', () => {
  const clock = new TextSpeechClock()
  clock.start(0)
  clock.level('你好', 5000)
  clock.level('再见', 5050)
  assert.ok(clock.level('再见', 5050 + CHAR_MS * 0.5) > 0.2)
})

test('mouth smoothing attacks faster than it releases', () => {
  const opening = smoothMouth(0, 1, 16.7) - 0
  const closing = 1 - smoothMouth(1, 0, 16.7)
  assert.ok(opening > closing)
  assert.ok(opening > 0 && opening < 1)
  assert.equal(smoothMouth(0, 1, 0), 0)
  assert.equal(smoothMouth(Number.NaN, Number.NaN, 16), 0)
})

test('amplitude envelope normalizes PCM and gates silence', () => {
  const sampleRate = 8000
  const samples = new Float32Array(sampleRate)
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate)
  }
  const envelope = buildAmplitudeEnvelope(samples, sampleRate, 50)
  assert.equal(envelope.length, 20)
  assert.ok(Math.max(...envelope) > 0.8)
  assert.ok(Array.from(envelope).every((value) => value >= 0 && value <= 1))

  const silence = buildAmplitudeEnvelope(new Float32Array(sampleRate), sampleRate, 50)
  assert.ok(Array.from(silence).every((value) => value === 0))
  assert.equal(buildAmplitudeEnvelope(samples, 0).length, 0)
})

test('TTS mouth tracker samples the envelope at audio time and falls back to text', () => {
  const audio = { paused: false, currentTime: 0.1 }
  const tracker = new TtsMouthTracker()
  tracker.start('你好世界', audio, 1000)
  tracker.setEnvelope(Float32Array.from([0, 0.2, 0.8, 0.1]), audio)
  assert.ok(Math.abs(tracker.level(1000) - 0.8) < 1e-6)

  audio.paused = true
  assert.equal(tracker.level(1055), 0)

  const fallback = new TtsMouthTracker()
  fallback.start('你好世界', null, 1000)
  assert.ok(fallback.level(1055) > 0)

  tracker.clear()
  fallback.clear()
  assert.equal(tracker.level(1055), 0)
  assert.equal(fallback.level(1055), 0)
})

test('audio fallback closes during pause, end, seeking and buffering even before envelope decoding', () => {
  const audio = { paused: false, ended: false, seeking: false, readyState: 4, currentTime: 0.055 }
  const tracker = new TtsMouthTracker()
  tracker.start('你好世界', audio, 1000)
  assert.ok(tracker.level(1055) > 0)
  for (const [key, value] of [['paused',true],['ended',true],['seeking',true],['readyState',2]]) {
    const previous = audio[key]; audio[key] = value
    assert.equal(tracker.level(1060), 0, `audio state ${key} must close the mouth`)
    audio[key] = previous
  }
})

test('audio text fallback follows playback time rather than wall time and can rewind after seeking', () => {
  const audio={paused:false,currentTime:0.055,readyState:4}
  const tracker=new TtsMouthTracker();tracker.start('你好世界',audio,1000)
  const initial=tracker.level(1055)
  assert.ok(initial>0)
  assert.equal(tracker.level(50000),initial,'a stalled audio clock must not advance the fallback')
  audio.currentTime=20;assert.equal(tracker.level(50001),0)
  audio.currentTime=.055;assert.ok(Math.abs(tracker.level(50002)-initial)<1e-8)
})

test('envelope sampling closes for waiting/seeking/end and resumes at the audio offset without restarting', () => {
  const audio={paused:false,ended:false,seeking:false,readyState:4,currentTime:.1}
  const tracker=new TtsMouthTracker();tracker.start('你好世界',audio,1000)
  tracker.setEnvelope(Float32Array.from([0,.2,.8,.1]),audio)
  assert.ok(Math.abs(tracker.level(1055)-.8)<1e-6)
  for(const [key,value] of [['readyState',2],['seeking',true],['ended',true],['paused',true]]){
    const previous=audio[key];audio[key]=value;assert.equal(tracker.level(9999),0);audio[key]=previous
    assert.ok(Math.abs(tracker.level(9999)-.8)<1e-6)
  }
  audio.currentTime=.15;assert.ok(Math.abs(tracker.level(10000)-.1)<1e-6)
})

test('time zero is valid and invalid audio offsets/envelopes never leak nonfinite or unbounded levels', () => {
  const tracker=new TtsMouthTracker();tracker.start('你好世界',null,0)
  assert.ok(tracker.level(55)>0)
  assert.equal(tracker.level(NaN),0)
  const audio={paused:false,currentTime:0,readyState:4}
  tracker.start('你好世界',audio,0)
  tracker.setEnvelope(Float32Array.from([NaN,Infinity,-1,2]),audio)
  for(const offset of [NaN,Infinity,-1]){audio.currentTime=offset;assert.equal(tracker.level(1),0)}
  for(const [offset,expected] of [[0,0],[.05,0],[.1,0],[.15,1],[.2,0]]){audio.currentTime=offset;assert.equal(tracker.level(1),expected)}
})

test('a late envelope cannot revive a cleared tracker or replace the next audio owner', () => {
  const old={paused:false,currentTime:0,readyState:4},next={paused:false,currentTime:0,readyState:4}
  const tracker=new TtsMouthTracker();tracker.start('旧文本',old,1000);tracker.clear()
  tracker.setEnvelope(Float32Array.from([1]),old);assert.equal(tracker.level(1055),0)
  tracker.start('新文本',next,2000);tracker.setEnvelope(Float32Array.from([1]),old)
  assert.equal(tracker.level(2055),0,'the new audio is still at time zero, not the wall clock')
  tracker.setEnvelope(Float32Array.from([.3]),next);assert.ok(Math.abs(tracker.level(2055)-.3)<1e-6)
})
