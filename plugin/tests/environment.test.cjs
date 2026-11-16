const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { resolveRuntimePaths, resolveAppEnvironment } = require('../shared/uta-environment.mjs')

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-env-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('packaged default preserves stable data; source directories get distinct profiles', (t) => {
  const appData = fixture(t)
  const a = resolveAppEnvironment({}, { appData, sourceDir: path.join(appData, 'one'), isPackaged: false })
  const b = resolveAppEnvironment({}, { appData, sourceDir: path.join(appData, 'two'), isPackaged: false })
  const stable = resolveAppEnvironment({}, { appData, sourceDir: path.join(appData, 'release'), isPackaged: true })
  assert.equal(stable.userData, path.join(appData, 'uta'))
  assert.equal(stable.isStable, true)
  assert.notEqual(a.userData, b.userData)
  assert.notEqual(a.endpointFile, stable.endpointFile)
  assert.equal(a.isStable, false)
  assert.deepEqual(a, resolveAppEnvironment({}, { appData, sourceDir: path.join(appData, 'one'), isPackaged: false }))
  const explicitRuntime = resolveAppEnvironment({ UTA_RUNTIME_DIR: path.join(appData, 'test-runtime') }, {
    appData, sourceDir: appData, isPackaged: true,
  })
  assert.notEqual(explicitRuntime.userData, stable.userData)
  assert.equal(explicitRuntime.isStable, false)
})

test('explicit missing or malformed pairing never falls back to stable or legacy', (t) => {
  const dir = fixture(t)
  const client = require('../shared/uta-runtime-client.mjs')
  for (const app of ['uta', 'MaiBot Deskpet', 'maibot-deskpet']) {
    fs.mkdirSync(path.join(dir, app), { recursive: true })
    fs.writeFileSync(path.join(dir, app, 'runtime-endpoint.json'), JSON.stringify({ port: 1234, token: 'stable-secret' }))
  }
  const endpoint = path.join(dir, 'test', 'runtime-endpoint.json')
  const env = { APPDATA: dir, UTA_ENDPOINT_FILE: endpoint }
  assert.deepEqual(client.endpointCandidates(env), [endpoint])
  assert.equal(client.readEndpoint(env), null)
  fs.mkdirSync(path.dirname(endpoint), { recursive: true })
  fs.writeFileSync(endpoint, 'broken')
  assert.equal(client.readEndpoint(env), null)
  assert.equal(client.readEndpoint({ APPDATA: dir }).port, 1234)
  assert.equal(client.readEndpoint({ APPDATA: dir, UTA_PROFILE: 'test' }), null)
})

test('a bound platform reads its host-specific endpoint before legacy paths', (t) => {
  const dir = fixture(t)
  const client = require('../shared/uta-runtime-client.mjs')
  const hostFile = path.join(dir, 'uta', 'host-pets', 'codex', 'runtime-endpoint.json')
  fs.mkdirSync(path.dirname(hostFile), { recursive: true })
  fs.writeFileSync(hostFile, JSON.stringify({ port: 4321, token: 'host-token' }))
  const env = { APPDATA: dir, UTA_HOST: 'codex' }
  assert.equal(client.endpointCandidates(env)[0], hostFile)
  assert.equal(client.readEndpoint(env).port, 4321)
  fs.writeFileSync(path.join(dir, 'uta', 'runtime-endpoint.json'), JSON.stringify({ port: 1111, token: 'stable-token' }))
  assert.equal(client.readEndpoint(env).port, 4321, 'host-specific endpoint wins')
  assert.equal(client.readEndpoint({ ...env, UTA_ENDPOINT_FILE: path.join(dir, 'explicit.json') }), null)

  fs.writeFileSync(hostFile, JSON.stringify({ port: 4321, token: 'host-token', pid: 999999 }))
  fs.rmSync(path.join(dir, 'uta', 'runtime-endpoint.json'), { force: true })
  assert.equal(client.readEndpoint({ APPDATA: dir, UTA_HOST: 'codex' }), null, 'a dead pet endpoint is skipped')
})

test('conflicting endpoints, invalid profiles and stable-directory reuse are rejected', (t) => {
  const dir = fixture(t)
  assert.throws(() => resolveRuntimePaths({ UTA_PROFILE: '../stable' }), /UTA_PROFILE/)
  assert.throws(() => resolveRuntimePaths({ UTA_ENDPOINT_FILE: 'relative.json' }), /absolute/)
  assert.throws(() => resolveRuntimePaths({ UTA_ENDPOINT_FILE: path.join(dir, 'a'), DESKPET_ENDPOINT_FILE: path.join(dir, 'b') }), /different instances/)
  assert.throws(() => resolveRuntimePaths({ APPDATA: dir, UTA_PROFILE: 'test', UTA_USER_DATA_DIR: path.join(dir, 'uta') }), /stable Uta/)
  assert.throws(() => resolveRuntimePaths({ UTA_RUNTIME_DIR: path.join(dir, 'a'), UTA_ENDPOINT_FILE: path.join(dir, 'b', 'endpoint') }), /inside UTA_RUNTIME_DIR/)
})

test('development and split stable configurations cannot reach the same physical profile', (t) => {
  const dir = fixture(t)
  const stable = path.join(dir, 'uta')
  const alias = path.join(dir, 'profile-link')
  fs.mkdirSync(stable)
  fs.symlinkSync(stable, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const resolve = env => resolveRuntimePaths(env, { appData: dir })
  assert.throws(() => resolve({ UTA_PROFILE: 'test', UTA_USER_DATA_DIR: alias }), /stable Uta/)
  assert.throws(() => resolve({ UTA_PROFILE: 'test', UTA_RUNTIME_DIR: alias }), /stable Uta/)
  assert.throws(() => resolve({ UTA_PROFILE: 'stable', UTA_RUNTIME_DIR: path.join(dir, 'isolated') }), /used together/)
  if (process.platform === 'win32') {
    assert.throws(() => resolve({ UTA_PROFILE: 'test', UTA_USER_DATA_DIR: path.join(dir, 'UTA') }), /stable Uta/)
  }
})

test('Codex, Qoder and Antigravity hook state and speech markers stay within the selected runtime', (t) => {
  const dir = fixture(t)
  const env = { APPDATA: dir, UTA_PROFILE: 'test', UTA_RUNTIME_DIR: path.join(dir, 'runtime') }
  const hook = require('../shared/uta-host-hook.mjs')
  const qoder = require('../plugins/qoder/src/uta-hook.mjs')
  const antigravity = require('../plugins/antigravity/src/uta-antigravity-hook.mjs')
  const speech = require('../shared/uta-pet-speech.mjs')
  const host = hook.resolveHost(['--host=codex'], env)
  const hooksDir = path.join(env.UTA_RUNTIME_DIR, 'hooks')
  hook.reportHostSession(host, { session_id: 'test-session', cwd: dir }, env)
  hook.logPayloadShape('SessionStart', {}, host, env)
  qoder.logPayloadShape({ hook_event_name: 'SessionStart' }, env)
  antigravity.logPayloadShape('SessionStart', {}, env)
  speech.markPetSpoke('codex', 'test-session', 'deskpet_notify', env)
  assert.equal(JSON.parse(fs.readFileSync(path.join(hooksDir, 'codex-session.json'))).sessionId, 'test-session')
  const secondEnv = { ...env, UTA_RUNTIME_DIR: path.join(dir, 'second-runtime') }
  hook.reportHostSession(host, { session_id: 'test-session', cwd: dir }, secondEnv)
  assert.ok(fs.existsSync(path.join(secondEnv.UTA_RUNTIME_DIR, 'hooks', 'codex-session.json')))
  assert.ok(fs.existsSync(path.join(hooksDir, 'codex-events.jsonl')))
  assert.ok(fs.existsSync(path.join(hooksDir, 'qoder-events.jsonl')))
  assert.ok(fs.existsSync(path.join(hooksDir, 'antigravity-events.jsonl')))
  assert.equal(path.dirname(qoder.stopStateFile(env)), hooksDir)
  assert.equal(path.dirname(antigravity.pendingReplyFile('test-session', env)), hooksDir)
  assert.equal(speech.consumePetSpoke('codex', 'test-session', env), true)
  assert.equal(fs.existsSync(path.join(dir, 'uta')), false)
})

test('DeepSeek Harness explicit configuration uses strict endpoint and isolated hook log', (t) => {
  const dir = fixture(t)
  const dsh = require('../plugins/deepseek-harness/src/index.mjs')
  const endpoint = path.join(dir, 'dsh', 'runtime-endpoint.json')
  const env = { APPDATA: dir }
  assert.deepEqual(dsh.resolveEndpointCandidates({ endpointFile: endpoint }, env), [endpoint])
  dsh.apply({}, { env, endpointFile: endpoint })
  assert.ok(fs.existsSync(path.join(dir, 'dsh', 'hooks', 'deepseek-events.jsonl')))
  assert.equal(fs.existsSync(path.join(dir, 'uta')), false)
})
