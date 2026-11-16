'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript'), Vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
const createLoader = require('./support/settings-loader.cjs')
const tick = async () => { for (let i=0;i<16;i++) { await Promise.resolve(); await Vue.nextTick() } }
const main = createLoader()('main/stt')
const defaults = () => ({ ...main.DEFAULT_STT_CONFIG })
const publicView = value => ({ ...main.normalizePublicSttConfig(value), hasApiKey: !!value.apiKey })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function harness(t, hooks = {}) {
  let saved = defaults(), calls = [], gets = 0
  const api = { getSttConfig: async () => { gets++; return hooks.get ? hooks.get(saved, gets) : publicView(saved) },
    saveSttConfig: async payload => {
      calls.push(JSON.parse(JSON.stringify(payload)))
      if (hooks.save) return hooks.save(payload, calls.length)
      saved = main.mergeSttConfig(saved, payload)
      return { ok: true, config: publicView(saved) }
    },
  }
  const globals = { window: { utaAPI: api }, console, setTimeout, clearTimeout }
  const load = createLoader({ vue: Vue }, globals)
  const filename = path.resolve(__dirname, '../src/renderer/components/SttSettingsSection.vue')
  const source = compileScript(parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'stt-settings-test' }).content
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, ...globals, require: id => id === 'vue' ? Vue
      : id === '../services/stt-config-queue' ? load('renderer/services/stt-config-queue')
        : id === '../services/unsaved-drafts' ? { registerUnsavedDraft: () => () => {} }
          : require(id) })
  const component = module.exports.default; component.render = () => null
  const renderer = Vue.createRenderer({ createElement: tag => ({ tag }), createText: text => ({ text }), createComment: text => ({ text }), insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode() { return null }, nextSibling() { return null }, patchProp() {} })
  const apps=[]
  function mount() { const app=renderer.createApp(component); app.mount({}); apps.push(app); return { app, state: app._instance.setupState } }
  t.after(async () => { for (const app of apps) if (app._instance) app.unmount(); await tick() })
  return { ...mount(), mount, calls, get saved() { return saved } }
}
test('STT merge keeps a same-owner key but clears it on backend or endpoint-origin changes', () => {
  const original = { ...defaults(), apiKey: 'fixture-original' }
  assert.equal(main.mergeSttConfig(original, { model: 'new' }).apiKey, original.apiKey)
  assert.equal(main.mergeSttConfig(original, { backend: 'groq' }).apiKey, '')
  assert.equal(main.mergeSttConfig(original, { endpoint: 'https://another.invalid/stt' }).apiKey, '')
  assert.equal(main.mergeSttConfig(original, { endpoint: 'https://api.siliconflow.cn/other-path' }).apiKey, original.apiKey)
  assert.equal(main.mergeSttConfig(original, { backend: 'groq', apiKey: 'fixture-next' }).apiKey, 'fixture-next')
  assert.equal(main.mergeSttConfig(original, { clearKey: true, apiKey: 'ignored' }).apiKey, '')
})
test('actual STT component blocks writes after failed initialization and can retry reading', async t => {
  const h = harness(t, { get: (saved, count) => { if (count===1) throw Error('private initialization path'); return publicView(saved) } })
  await tick(); assert.equal(h.state.loaded, false)
  assert.match(h.state.message, /读取失败/)
  assert.equal(h.state.message.includes('private'), false)
  assert.equal(await h.state.saveNow(), false); assert.equal(h.calls.length, 0)
  await h.state.loadConfig(); assert.equal(h.state.loaded, true)
  assert.equal(h.state.enabled, false); assert.equal(h.state.form.autoSend, false)
})
test('STT component distinguishes undecryptable keys from an unreadable file', async t => {
  const decryptFailed = harness(t, {
    get: () => ({ ...publicView(defaults()), readError: 'decrypt-failed' }),
  })
  await tick()
  assert.equal(decryptFailed.state.loaded, true)
  assert.match(decryptFailed.state.message, /无法解密/)
  assert.equal(decryptFailed.state.hasApiKey, false)
  assert.equal(await decryptFailed.state.saveNow(), true)
  assert.equal(decryptFailed.calls.length, 1)
  assert.equal(decryptFailed.calls[0].apiKey, undefined)

  const unreadable = harness(t, {
    get: () => ({ ...publicView(defaults()), readError: 'config-unreadable' }),
  })
  await tick()
  assert.equal(unreadable.state.loaded, false)
  assert.match(unreadable.state.message, /读取失败/)
  assert.equal(await unreadable.state.saveNow(), false)
  assert.equal(unreadable.calls.length, 0)
})
test('explicit STT saves reject invalid or remote local addresses instead of replacing them with defaults', () => {
  const existing=defaults(),before=JSON.stringify(existing)
  for(const patch of [{endpoint:'broken-address'},{endpoint:'ftp://example.invalid/stt'},{localEndpoint:'https://outside.invalid/stt'},{endpoint:'https://user:password@example.invalid/stt'}]) {
    assert.throws(()=>main.mergeSttConfig(existing,patch))
    assert.equal(JSON.stringify(existing),before)
  }
  assert.equal(main.mergeSttConfig({...existing,backend:'custom',endpoint:''},{provider:'local',endpoint:''}).provider,'local')
})
test('slow saves retain newer form input and key; ordinary changes are queued without the unsubmitted key', async t => {
  const gate = deferred()
  const h = harness(t, { save: (payload, count) => count===1 ? gate.promise : { ok: true, config: publicView(main.mergeSttConfig(defaults(), payload)) } })
  await tick(); h.state.form.model='first-model'; h.state.apiKey='fixture-first-key'
  const first=h.state.saveNow(); await tick()
  h.state.form.model='newer-model';h.state.apiKey='fixture-newer-key'
  gate.resolve({ ok: true, config: publicView({ ...defaults(), model:'first-model', apiKey:'fixture-first-key' }) })
  await first;await tick()
  assert.equal(h.state.form.model,'newer-model');assert.equal(h.state.apiKey,'fixture-newer-key')
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].model,'newer-model')
  assert.equal(Object.hasOwn(h.calls[1],'apiKey'),false)
  assert.equal(h.calls[0].apiKey,'fixture-first-key')
})
test('autosave does not submit a typed key; explicit save submits and clears only that acknowledged key', async t => {
  const h=harness(t);await tick();h.state.apiKey='fixture-unsaved-key';h.state.form.model='typed-model'
  await h.state.saveNow(false)
  assert.equal(Object.hasOwn(h.calls[0],'apiKey'),false)
  assert.equal(h.state.apiKey,'fixture-unsaved-key')
  await h.state.saveNow()
  assert.equal(h.calls[1].apiKey,'fixture-unsaved-key');assert.equal(h.state.apiKey,'');assert.equal(h.state.hasApiKey,true)
})
test('backend switch during an older save preserves the new service and never submits its draft key automatically', async t => {
  const gate=deferred()
  const h=harness(t,{save:(payload,count)=>count===1?gate.promise:{ok:true,config:publicView(main.mergeSttConfig(defaults(),payload))}})
  await tick();h.state.apiKey='fixture-old-key';const first=h.state.saveNow();await tick()
  const switching=h.state.selectBackend('groq');h.state.apiKey='fixture-new-service-key'
  gate.resolve({ok:true,config:publicView({...defaults(),apiKey:'fixture-old-key'})})
  await first;await switching;await tick()
  assert.equal(h.state.form.backend,'groq');assert.equal(h.state.hasApiKey,false)
  assert.equal(h.state.apiKey,'fixture-new-service-key')
  assert.equal(h.calls[1].backend,'groq');assert.equal(Object.hasOwn(h.calls[1],'apiKey'),false)
})
test('failed saves and key-clear exceptions keep drafts and expose only fixed user-facing errors', async t => {
  let fail=true
  const h=harness(t,{save:payload=>{if(fail)throw Error('private path + credential fixture');return{ok:true,config:publicView(main.mergeSttConfig(defaults(),payload))}}})
  await tick();h.state.form.model='keep-model';h.state.apiKey='keep-key'
  assert.equal(await h.state.saveNow(),false)
  assert.equal(h.state.form.model,'keep-model');assert.equal(h.state.apiKey,'keep-key')
  assert.equal(h.state.saveStatus,'error');assert.equal(h.state.message.includes('private'),false)
  await h.state.clearKey();assert.equal(h.state.saving,false);assert.equal(h.state.apiKey,'keep-key')
  fail=false;assert.equal(await h.state.saveNow(),true);assert.equal(h.state.apiKey,'')
})
test('unmount drains only ordinary fields, ignores late replies, and a remount waits before reading', async t => {
  const gate=deferred();let saved=defaults()
  const h=harness(t,{get:()=>publicView(saved),save:async(payload,count)=>{if(count===1)await gate.promise;saved=main.mergeSttConfig(saved,payload);return{ok:true,config:publicView(saved)}}})
  await tick();h.state.form.model='first';const first=h.state.saveNow(false);await tick()
  h.state.form.model='last-before-close';h.state.apiKey='never-submit-on-close'
  h.app.unmount();const next=h.mount();await tick();assert.equal(next.state.loaded,false)
  gate.resolve();await first;await tick()
  assert.equal(next.state.loaded,true);assert.equal(next.state.form.model,'last-before-close')
  assert.equal(h.calls.length,2);assert.equal(Object.hasOwn(h.calls[1],'apiKey'),false)
  assert.equal(h.state.apiKey,'never-submit-on-close')
})
test('queued toggles during a slow save are persisted after its acknowledgment', async t => {
  const gate=deferred()
  const h=harness(t,{save:(payload,count)=>count===1?gate.promise:{ok:true,config:publicView(main.mergeSttConfig(defaults(),payload))}})
  await tick();const first=h.state.saveNow(false);await tick()
  const enabledToggle=h.state.toggleEnabled(); const autoToggle=h.state.toggleAutoSend()
  gate.resolve({ok:true,config:publicView(defaults())});await first;await enabledToggle;await autoToggle;await tick()
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].enabled,true);assert.equal(h.calls[1].autoSend,true)
  assert.equal(h.state.enabled,true);assert.equal(h.state.form.autoSend,true)
})
test('failed toggle saves restore the previous switch instead of claiming it is on', async t => {
  const h=harness(t,{save:()=>{throw Error('private path + credential fixture')}})
  await tick()
  await h.state.toggleEnabled()
  assert.equal(h.state.enabled,false)
  assert.equal(h.state.saveStatus,'error')
  assert.equal(h.state.message.includes('private'),false)
  await h.state.toggleAutoSend()
  assert.equal(h.state.form.autoSend,false)
})
test('a queued toggle reverts when the follow-up save fails', async t => {
  const gate=deferred()
  const h=harness(t,{save:(payload,count)=>count===1?gate.promise:{ok:false,error:'write-failed'}})
  await tick();const first=h.state.saveNow(false);await tick()
  const toggled=h.state.toggleEnabled()
  gate.resolve({ok:true,config:publicView(defaults())});await first
  await toggled;await tick()
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].enabled,true)
  assert.equal(h.state.enabled,false)
  assert.equal(h.state.saveStatus,'error')
})

test('an explicit key save queued behind a slow save sends the pressed key, not a newer draft', async t => {
  const gate=deferred()
  const h=harness(t,{save:(payload,count)=>count===1?gate.promise:{ok:true,config:publicView(main.mergeSttConfig(defaults(),payload))}})
  await tick()
  const first=h.state.saveNow(false);await tick()
  h.state.apiKey='fixture-pressed-key'
  const keySave=h.state.saveNow(true);await tick()
  h.state.apiKey='fixture-newer-key'
  gate.resolve({ok:true,config:publicView(defaults())})
  await first
  const keyOk=await keySave;await tick()
  assert.equal(h.calls.length,2)
  assert.equal(h.calls[1].apiKey,'fixture-pressed-key')
  assert.equal(keyOk,true)
  assert.equal(h.state.apiKey,'fixture-newer-key')
})

test('a toggle reverts when the save queued behind an earlier failure also fails', async t => {
  const gate=deferred()
  const h=harness(t,{save:(payload,count)=>count===1?gate.promise:{ok:false,error:'write-failed'}})
  await tick()
  const toggled=h.state.toggleEnabled();await tick()
  const queued=h.state.saveNow(false)
  gate.resolve({ok:false,error:'write-failed'})
  await toggled;await queued;await tick()
  assert.equal(h.calls.length,2)
  assert.equal(h.state.enabled,false)
  assert.equal(h.state.saveStatus,'error')
})
