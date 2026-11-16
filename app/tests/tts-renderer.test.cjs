'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

function loadTsModule(relativePath) {
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, relativePath), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    console,
    performance,
  })
  return module.exports
}

const mouthMotion = loadTsModule('../src/renderer/services/mouth-motion.ts')
const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/services/tts.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const mod = { exports: {} }
vm.runInNewContext(code, {
  module: mod,
  exports: mod.exports,
  console,
  require: (id) => {
    if (id === './mouth-motion') return mouthMotion
    throw new Error(`unexpected require: ${id}`)
  },
})
const { prepareSpeechText, summarizeSpeechText, isNaturalAudioEnd } = mod.exports

async function playbackHarness(t, autoPlaying = true) {
  const createLoader=require('./support/settings-loader.cjs'),players=[],speaking=[],trackers=[]
  class Tracker extends mouthMotion.TtsMouthTracker {
    starts=0
    constructor(){super();trackers.push(this)}
    start(...args){this.starts++;return super.start(...args)}
  }
  class Audio {
    paused=true;ended=false;seeking=false;readyState=4;currentTime=.055;duration=2
    constructor(){players.push(this)}
    async play(){this.paused=false;if(autoPlaying)this.onplaying?.()}
    pause(){this.paused=true;this.onpause?.()}
  }
  const api={synthesizeSpeech:async()=>({ok:true,audioBase64:'AAA=',mime:'audio/wav'})}
  const load=createLoader({'./mouth-motion':{...mouthMotion,TtsMouthTracker:Tracker}},
    {performance:{now:()=>1000},window:{utaAPI:api,speechSynthesis:{cancel(){}}},Audio,Blob,atob,
      URL:{createObjectURL:()=> 'blob:owned-tts-test',revokeObjectURL(){}},AudioContext:class {decodeAudioData(_data,resolve){resolve({getChannelData:()=>Float32Array.from([.2,.2,.2,.2]),sampleRate:20})}}})
  const controller=load('renderer/services/tts').createTtsController(()=>({enabled:true,provider:'http',endpoint:'http://127.0.0.1/tts',rate:1,volume:0,speakNarration:true,speakReplies:true}),value=>speaking.push(value))
  const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();await new Promise(setImmediate)}
  t.after(()=>controller.dispose())
  controller.speak('你好，正在测试口型。',{kind:'reply'});await tick()
  assert.equal(players.length,1)
  return {controller,players,speaking,tracker:trackers[0],tick}
}

test('repeated actual TTS playing events do not restart the tracker or discard an existing envelope', async t=>{
  const h=await playbackHarness(t),audio=h.players[0]
  assert.equal(h.tracker.starts,1)
  h.tracker.setEnvelope(Float32Array.from([.6,.7,.8,.9]),audio)
  const before=h.controller.getLevel()
  assert.ok(before>.6)
  audio.onplaying();await h.tick()
  assert.equal(h.tracker.starts,1)
  assert.equal(h.controller.getLevel(),before)
  assert.deepEqual(h.speaking,[true])
  audio.currentTime=2;audio.ended=true;audio.paused=true;audio.onpause();audio.onended();await h.tick()
  assert.equal(h.controller.getLevel(),0)
  assert.equal(audio.onplaying,null);assert.equal(audio.onpause,null)
})

async function stalledPlaybackHarness(t) {
  const createLoader=require('./support/settings-loader.cjs'),players=[],speaking=[],timers=[]
  class Audio {
    paused=true;ended=false;seeking=false;readyState=4;currentTime=0;duration=2
    constructor(){players.push(this)}
    async play(){this.paused=false}
    pause(){this.paused=true;this.onpause?.()}
  }
  const api={synthesizeSpeech:async()=>({ok:true,audioBase64:'AAA=',mime:'audio/wav'})}
  const load=createLoader({'./mouth-motion':{...mouthMotion}}, {
    performance:{now:()=>1000},
    window:{utaAPI:api,speechSynthesis:{cancel(){}}},
    Audio,Blob,atob,
    URL:{createObjectURL:()=> 'blob:owned-stalled-test',revokeObjectURL(){}},
    AudioContext:class {decodeAudioData(_data,resolve){resolve({getChannelData:()=>Float32Array.from([.2,.2,.2,.2]),sampleRate:20})}},
    setTimeout:(fn,ms)=>{const entry={id:timers.length+1,fn,ms,cleared:false};timers.push(entry);return entry.id},
    clearTimeout:(id)=>{const entry=timers.find(item=>item.id===id);if(entry)entry.cleared=true},
  })
  const controller=load('renderer/services/tts').createTtsController(()=>({enabled:true,provider:'http',endpoint:'http://127.0.0.1/tts',rate:1,volume:0,speakNarration:true,speakReplies:true}),value=>speaking.push(value))
  const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();await new Promise(setImmediate)}
  t.after(()=>controller.dispose())
  return {controller,players,speaking,timers,tick}
}

test('stalled HTTP playback has a watchdog and lets the queue continue', async t=>{
  const h=await stalledPlaybackHarness(t)
  h.controller.speak('第一条测试播报内容，用来验证播放停滞。',{kind:'reply'})
  await h.tick()
  assert.equal(h.players.length,1)
  h.controller.speak('第二条完全不同的内容，应该在超时后继续。',{kind:'reply'})
  await h.tick()
  const watchdog=h.timers.find(entry=>!entry.cleared&&entry.ms>=15000)
  assert.ok(watchdog,'stalled playback must register a bounded watchdog')
  watchdog.fn()
  await h.tick()
  assert.equal(h.players.length,2,'the next queued utterance should start after the watchdog')
})

test('cancelled TTS ignores an old playing callback and cannot restart its cleared mouth tracker', async t=>{
  const h=await playbackHarness(t,false),audio=h.players[0],late=audio.onplaying
  h.controller.cancel();await h.tick()
  late();await h.tick()
  assert.equal(h.tracker.starts,0)
  assert.equal(h.controller.getLevel(),0)
  assert.equal(h.speaking.at(-1),false)
  assert.equal(audio.onplaying,null)
})

test('TTS text strips code, markdown links and URLs', () => {
  const text = prepareSpeechText(
    '已经修好了 [文件](https://example.com/a) ```ts\nconst x = 1\n``` 你再看一下 `npm test`',
  )
  assert.ok(!text.includes('```'))
  assert.ok(!text.includes('https://'))
  assert.ok(!text.includes('const x'))
  assert.ok(text.includes('已经修好了'))
  assert.ok(text.includes('文件'))
})

test('natural audio end is not treated as an interruption', () => {
  assert.equal(isNaturalAudioEnd({ ended: true, currentTime: 1, duration: 2 }), true)
  assert.equal(isNaturalAudioEnd({ ended: false, currentTime: 1.96, duration: 2 }), true)
  assert.equal(isNaturalAudioEnd({ ended: false, currentTime: 0.8, duration: 2 }), false)
  assert.equal(isNaturalAudioEnd({ ended: false, currentTime: 0, duration: Number.NaN }), false)
})

test('TTS text truncates long replies without a completion-count tail', () => {
  const text = prepareSpeechText('x'.repeat(500), 60)
  assert.ok(text.length <= 60)
  assert.ok(!text.includes('完整内容请回'))
})

test('reply speech keeps one or two sentences instead of reading the whole reply', () => {
  const raw =
    '第一句话说明任务已经完成。\n\n第二段是对照说明。\n| 项 | 值 |\n|---|---|\n' +
    `[文档](https://example.com) 和 \`npm test\` 都看过了。${'补充说明。'.repeat(80)}`
  const text = summarizeSpeechText(raw, 60)
  assert.ok(!text.includes('https://'))
  assert.ok(!text.includes('`'))
  assert.ok(!text.includes('| 项 |'))
  assert.ok(text.startsWith('第一句话说明任务已经完成。'))
  assert.ok(text.length <= 61)
  assert.ok(text.endsWith('…'))
})

test('collapsed markdown tables never reach reply speech', () => {
  const text = summarizeSpeechText(
    '任务完成 已经把语音播报改好了。 | 项 | 状态 | --- | --- | 状态解说 | 默认关闭 | 宿主回复 | 只念摘要 | 详情见 https://example.com 的完整说明。',
    120,
  )
  assert.ok(!text.includes('状态解说'))
  assert.ok(!text.includes('只念摘要'))
  assert.ok(!text.includes('---'))
  assert.ok(!text.includes('https://'))
  assert.ok(text.startsWith('任务完成 已经把语音播报改好了。'))
})

test('reply speech drops commit hashes, paths and technical ids', () => {
  const commit = summarizeSpeechText('汇报链路修好了，提交在 cd7a09f。', 120)
  assert.ok(!commit.includes('cd7a09f'))
  assert.ok(commit.includes('已提交'))

  const path = summarizeSpeechText(
    '改好了 app/src/renderer/services/tts.ts，提交在 29da6a0。',
    120,
  )
  assert.ok(!path.includes('app/src'))
  assert.ok(!path.includes('29da6a0'))
  assert.ok(path.includes('改好了'))
  assert.equal(summarizeSpeechText('修好了，文件是 app/src/renderer/services/tts.ts。', 120), '修好了。')

  assert.equal(summarizeSpeechText('已处理 550e8400-e29b-41d4-a716-446655440000。', 120), '已处理。')
  assert.equal(summarizeSpeechText('cd7a09f'), '')
  assert.equal(summarizeSpeechText('✓'), '')

  // 纯数字/小数/版本不能被当成哈希
  assert.equal(summarizeSpeechText('圆周率是 3.14159265。', 120), '圆周率是 3.14159265。')
  assert.equal(summarizeSpeechText('版本 1.2345678 已发布。', 120), '版本 1.2345678 已发布。')
  assert.equal(summarizeSpeechText('电话 13800138000。', 120), '电话 13800138000。')

  // 带上下文的纯字母哈希仍然要处理
  assert.ok(!summarizeSpeechText('提交落在 deadbeef 上。', 120).includes('deadbeef'))
  assert.equal(summarizeSpeechText('The hash deadbeef is wrong.', 120), 'The hash is wrong.')
  assert.equal(summarizeSpeechText('好👍🏻 完成 1️⃣', 120), '好 完成')
  assert.equal(summarizeSpeechText('校验 sha256:abcdef1234567890', 120), '校验')
})

test('short host replies stay readable after summarization', () => {
  assert.equal(summarizeSpeechText('任务完成了，文件已经修好。'), '任务完成了，文件已经修好。')
  assert.equal(summarizeSpeechText('```ts\nconst x = 1\n```'), '')
})
