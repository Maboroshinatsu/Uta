'use strict'
// [B01: 修复模型迁移非原子导致永久丢失] 的回归测试。
// 全部在临时目录里跑真实文件系统，不碰任何真实模型数据。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const MAIN_ENTRY = path.join(__dirname, '../src/main/index.ts')

function loadMain() {
  const code = ts.transpileModule(fs.readFileSync(MAIN_ENTRY, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText

  const noop = () => {}
  const dependencies = {
    '../shared/settings-window-contracts': { SETTINGS_WINDOW_CHANNELS: {} },
    electron: {
      app: {
        getPath: () => path.join(os.tmpdir(), 'uta-migration-fake-appdata'),
        setPath: noop,
        getAppPath: () => __dirname,
        isPackaged: false,
        commandLine: { appendSwitch: noop },
        requestSingleInstanceLock: () => true,
        on: noop,
        // 永不 resolve：阻止 app.whenReady().then() 里的建窗/建托盘/起端口逻辑跑起来
        whenReady: () => new Promise(() => {}),
        quit: noop,
      },
      BrowserWindow: function () {},
      Tray: function () {},
      Menu: { buildFromTemplate: () => ({}) },
      nativeImage: { createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }) },
      ipcMain: { handle: noop, on: noop },
      screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
      globalShortcut: { register: () => true, unregisterAll: noop },
      protocol: { registerSchemesAsPrivileged: noop, handle: noop },
      net: { fetch: async () => new Response('') },
      shell: { openPath: async () => '' },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(String(value)),
        decryptString: (value) => Buffer.from(value).toString(),
      },
    },
    url: require('node:url'),
    './settings-store': { createSettingsStore: async () => { throw Error('not used by model migration') } },
    './settings-store/stable-migration': { inspectStableAuthority: async () => 'legacy', StableSettingsMigration: class {} },
    './settings-ipc': {
      isSettingsPage: () => false,
      isValidSettingsSender: () => false,
      SettingsWindowManager: class {
        getSettingsWindow() { return null }
        openSettingsWindow() { return null }
        closeSettingsWindow() {}
        destroySettingsWindow() {}
      },
    },
    './settings-ipc/lifecycle': { initializeSettingsIpc: async () => {}, createSettingsQuitGuard: () => noop },
    './settings-ipc/window-lifecycle': { registerSettingsWindowLifecycle: noop },
    './settings-ipc/pet-commands': { SettingsPetCommands: class { dispose() {} }, registerSettingsPetCommands: noop },
    './model-performance-assets': { readModelPerformanceAssets: () => null },
    './model-import': { createModelImporter: () => { throw Error('not used by model migration') } },
    './settings-ipc/voice-preview': { createVoicePreviewHandler: () => noop },
    './settings-ipc/import-preview': { createSettingsImportController: () => ({ preview: noop, apply: noop, cancel: noop, dispose: noop }) },
    './settings-ipc/recovery': { createSettingsRecoveryController: () => ({ preview: noop, restore: noop, retry: noop }) },
    './runtime-bridge': { startRuntimeBridge: async () => ({}), windowCommandSink: () => async () => true },
    './runtime-commands': { normalizeModelContext: (_raw, fallback) => fallback },
    './fullscreen-visibility': { FullscreenVisibility: class {} },
    './win-fullscreen-probe': { startWindowsFullscreenProbe: () => noop },
    './model-path-safety': {
      resolveContainedModelFile: () => null,
      isSafePresetTarget: () => true,
    },
    './media-permission': { shouldAllowMediaPermission: () => false },
    './host-paths': {
      resolveHostPaths: () => ({
        harnessExe: '', harnessCli: '', opencodeExe: '', zcodeCli: '',
        nodeExe: '', claudeExe: '', claudeJs: '', codexExe: '',
      }),
      writeHostPathOverride: () => 'harnessExe',
    },
    './host-session-preference': {
      readHostSessionPreference: () => null,
      writeHostSessionPreference: () => {},
    },
    './codex-sessions': {
      createCodexSessionStore: () => ({ list: () => [], observe() {} }),
    },
    './codex-session-titles': { readCodexSessionTitle: () => '' },
    '../shared/session-title': { cleanSessionTitle: () => '' },
    './tts': {
      synthesizeSpeech: async () => ({ audioBase64: '', mime: 'audio/wav' }),
    },
    './tts-cloud': {
      normalizeCloudConfig: (value) => value,
      normalizePublicCloudConfig: (value) => value,
      mergeCloudTtsConfig: (value) => value,
      sameCloudTtsOwner: () => false,
      synthesizeCloudSpeech: async () => ({ audioBase64: '', mime: 'audio/wav' }),
    },
    './voice-config-file': {
      readVoiceConfigFile: () => ({ kind: 'missing' }),
      writeVoiceConfigFile: () => {},
      shouldBlockVoiceConfigWrite: () => false,
      shouldPreserveEncryptedApiKey: () => false,
    },
    './host-bridge': {
      readHostSession: () => null,
      sendHostMessage: async () => ({ ok: false, code: 'unsupported', error: 'stub' }),
    },
    './todo-session': {
      completeTodoSession: (session) => session,
      todoProjectMatchesSession: () => false,
    },
    './todo-recovery': { createTodoRecovery: () => ({ preview: () => ({ ok: false }), apply: () => ({ ok: false }) }) },
    './chat-history': {
      createChatHistory: () => ({ read: () => ({ ok: true, entries: [] }), write: () => ({ ok: true }) }),
    },
    './model-calibration': { createModelCalibration: () => ({ get: () => [], write: () => true }) },
    '../../../plugin/shared/uta-environment.mjs': require('../../plugin/shared/uta-environment.mjs'),
    './stt': {
      normalizeSttConfig: (value) => value,
      normalizePublicSttConfig: (value) => value,
      mergeSttConfig: (value) => value,
      sameSttOwner: () => false,
      transcribeAudio: async () => '',
    },
    '../shared/settings-command-contracts': {
      normalizePetSettingsCommand: () => null,
    },
    './onboarding-state': {
      createOnboardingStateStore: () => ({
        read: () => null,
        shouldOpen: () => false,
        markPending: () => true,
        complete: () => true,
      }),
    },
    './host-onboarding': {
      createHostOnboarding: () => ({
        detect: async () => ({ hosts: [], runtime: { activeHostId: '', connected: false, sessions: [] }, checkedAt: '' }),
        install: async () => null,
      }),
    },
    './todo-store': {
      createTodoStore: () => ({
        state: () => ({
          projects: [],
          activeHostId: '',
          activeSessionId: '',
          activeCwd: '',
          activeProjectKey: 'unidentified:unknown',
          activeProjectLabel: '未识别项目',
          activeProjectIsUnidentified: true,
          hostPlan: null,
          hostPlanStale: false,
          projectsError: null,
        }),
        addItem: () => ({ ok: false, error: 'stub', state: null }),
        updateItem: () => ({ ok: false, error: 'stub', state: null }),
        deleteItem: () => ({ ok: false, error: 'stub', state: null }),
        clearCompleted: () => ({ ok: false, error: 'stub', state: null }),
        associateProject: () => ({ ok: false, error: 'stub', state: null }),
        applyHostSnapshot: () => false,
      }),
    },
    './daily-todo-store': {
      createDailyTodoStore: () => ({
        state: () => ({ items: [], reminderSound: false, error: null, unhandledIds: [] }),
        addItem: () => ({ ok: false, error: 'stub', state: { items: [], reminderSound: false, error: null, unhandledIds: [] } }),
        updateItem: () => ({ ok: false, error: 'stub', state: { items: [], reminderSound: false, error: null, unhandledIds: [] } }),
        deleteItem: () => ({ ok: false, error: 'stub', state: { items: [], reminderSound: false, error: null, unhandledIds: [] } }),
        clearCompleted: () => ({ ok: false, error: 'stub', state: { items: [], reminderSound: false, error: null, unhandledIds: [] } }),
        snoozeItem: () => ({ ok: false, error: 'stub', state: { items: [], reminderSound: false, error: null, unhandledIds: [] } }),
        applyDailyRecurrence: () => false,
        markReminded: () => true,
        setReminderSound: () => ({ ok: false, error: 'stub', state: { items: [], reminderSound: false, error: null, unhandledIds: [] } }),
      }),
      dueDailyReminders: () => [],
      currentOccurrence: () => null,
    },
    './daily-todo-send': {
      prepareDailySend: () => ({ ok: false, code: 'empty', error: 'stub' }),
      dispatchDailySend: async () => ({ ok: false, code: 'failed', error: 'stub' }),
    },
    './host-endpoint': {
      resolveHostEndpointFile: () => '',
    },
    '../shared/companion-http-contract': {
      COMPANION_HTTP_CHANNEL: 'companion-http-request',
      isCompanionHttpHost: (host) => host === 'maibot' || host === 'astrbot',
    },
    './companion-http': {
      requestCompanionHost: async () => 200,
    },
    './shortcut-scope': {
      findForeignLiveEndpoint: () => null,
    },
    './pet-binding': {
      createPetBindingStore: () => ({
        get: () => null,
        bind: () => ({ ok: false, error: 'invalid-host' }),
        rebind: () => ({ ok: false, error: 'invalid-host' }),
        clear: () => true,
      }),
      isPetHostId: () => false,
      isBindableHostId: () => false,
      canonicalPetHostId: (value) => (typeof value === 'string' ? value : ''),
    },
  }

  const module = { exports: {} }
  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      require: (spec) => {
        if (spec in dependencies) return dependencies[spec]
        if (spec.startsWith('node:')) return require(spec)
        return require(spec)
      },
      console: { log: noop, info: noop, warn: noop, error: noop },
      process: { ...process, env: { ...process.env } },
      Buffer,
      URL,
      Response,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      __dirname: path.dirname(MAIN_ENTRY),
    },
    { filename: MAIN_ENTRY },
  )
  return module.exports
}

const main = loadMain()

function tmpRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-mig-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function writeLive2DModel(dir, name = 'mymodel') {
  const runtime = path.join(dir, 'runtime')
  fs.mkdirSync(runtime, { recursive: true })
  fs.writeFileSync(path.join(runtime, `${name}.model3.json`), '{"FileReferences":{}}')
  fs.writeFileSync(path.join(runtime, `${name}.moc3`), 'binary-ish')
  const tex = path.join(dir, `${name}.2048`)
  fs.mkdirSync(tex, { recursive: true })
  fs.writeFileSync(path.join(tex, 'texture_00.png'), 'x'.repeat(2048))
}

function writeImageSet(dir) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'deskpet-images.json'), '{"neutral":"neutral.png"}')
  fs.writeFileSync(path.join(dir, 'neutral.png'), 'y'.repeat(1024))
}

test('完整的 Live2D 模型目录被原子迁移到目标位置', (t) => {
  const root = tmpRoot(t)
  const src = path.join(root, 'src', 'ariu')
  writeLive2DModel(src)
  const dest = path.join(root, 'dest', 'ariu')

  assert.equal(main.migrateModelDir(src, dest, '测试'), true)
  assert.equal(main.hasModelManifest(dest), true, '目标应带可用清单')
  assert.equal(fs.existsSync(`${dest}.incoming`), false, '不应留下临时目录')
  assert.equal(fs.existsSync(src), true, '迁移是复制，源目录保留')
})

test('立绘包用 deskpet-images.json 也算可用清单', (t) => {
  const root = tmpRoot(t)
  const src = path.join(root, 'src', 'sample_static')
  writeImageSet(src)
  const dest = path.join(root, 'dest', 'sample_static')

  assert.equal(main.migrateModelDir(src, dest, '测试'), true)
  assert.equal(main.hasModelManifest(dest), true)
})

test('只有贴图、没有模型本体的目录不会被复制过来（正是 Miku 那种情况）', (t) => {
  const root = tmpRoot(t)
  const src = path.join(root, 'src', 'RetrynowMiku.4096')
  fs.mkdirSync(src, { recursive: true })
  for (let i = 0; i < 17; i++) fs.writeFileSync(path.join(src, `texture_${i}.png`), 'x')
  const dest = path.join(root, 'dest', 'RetrynowMiku.4096')

  assert.equal(main.migrateModelDir(src, dest, '测试'), false)
  assert.equal(fs.existsSync(dest), false, '不该造出一个永远加载不了的模型目录')
  assert.equal(fs.existsSync(`${dest}.incoming`), false, '失败后不留临时目录')
})

test('空壳目录不会被复制（正是 haru_cubism4 那种情况）', (t) => {
  const root = tmpRoot(t)
  const src = path.join(root, 'src', 'haru_cubism4')
  fs.mkdirSync(src, { recursive: true })
  const dest = path.join(root, 'dest', 'haru_cubism4')

  assert.equal(main.migrateModelDir(src, dest, '测试'), false)
  assert.equal(fs.existsSync(dest), false)
})

test('已存在的目标目录一律不动，程序不替用户改名或删除', (t) => {
  const root = tmpRoot(t)
  const src = path.join(root, 'src', 'ariu')
  writeLive2DModel(src)
  const dest = path.join(root, 'dest', 'ariu')
  fs.mkdirSync(dest, { recursive: true })
  fs.writeFileSync(path.join(dest, '用户自己的文件.txt'), 'keep me')

  assert.equal(main.migrateModelDir(src, dest, '测试'), false)
  assert.equal(fs.readFileSync(path.join(dest, '用户自己的文件.txt'), 'utf8'), 'keep me')
})

test('目标已存在但缺清单时同样不动，避免误伤用户手放的内容', (t) => {
  const root = tmpRoot(t)
  const src = path.join(root, 'src', 'ariu')
  writeLive2DModel(src)
  const dest = path.join(root, 'dest', 'ariu')
  fs.mkdirSync(dest, { recursive: true })
  fs.writeFileSync(path.join(dest, 'notes.md'), 'half-copied or user-made')

  assert.equal(main.migrateModelDir(src, dest, '测试'), false)
  assert.equal(fs.existsSync(path.join(dest, 'notes.md')), true)
})

test('复制不完整则整次作废，下次启动可重试', (t) => {
  const root = tmpRoot(t)
  const src = path.join(root, 'src', 'ariu')
  writeLive2DModel(src)
  const dest = path.join(root, 'dest', 'ariu')

  // 让复制结果少一个文件，模拟半途中断
  const originalCp = fs.cpSync
  fs.cpSync = (s, d, o) => {
    originalCp(s, d, o)
    const victim = path.join(d, 'mymodel.2048', 'texture_00.png')
    if (!fs.existsSync(victim)) throw new Error(`测试前置条件失效：${victim} 不存在`)
    fs.rmSync(victim)
  }
  try {
    assert.equal(main.migrateModelDir(src, dest, '测试'), false)
  } finally {
    fs.cpSync = originalCp
  }
  assert.equal(fs.existsSync(dest), false, '不完整复制不该落地')
  assert.equal(fs.existsSync(`${dest}.incoming`), false, '作废的临时目录要清掉')
})

test('the model picker shows the adapter display name and keeps the raw path as tooltip', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main/index.ts'), 'utf8')
  assert.match(main, /function readJsonDisplayName\(/)
  assert.match(main, /'deskpet-adapter\.json'/)
  assert.match(main, /readJsonDisplayName\(full\)/)
  assert.match(main, /\.\.\.\(displayName \? \{ displayName \} : \{\}\)/)
  const domain = fs.readFileSync(path.join(__dirname, '../src/renderer/settings-window/domains/CharacterDomain.vue'), 'utf8')
  assert.match(domain, /\{\{ modelDisplayLabel\(model\) \}\}/)
  assert.match(domain, /:title="model\.name"/)
})

test('startup model directory warnings use a bounded scan', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main/index.ts'), 'utf8')
  assert.match(main, /function countFilesQuick\(/)
  assert.match(main, /visited > maxEntries \|\| Date\.now\(\) - startedAt > maxMs/)
  assert.match(main, /至少 \$\{counted\.files\} 个文件/)
  assert.doesNotMatch(main, /const files = measureDir\(full\)\.files/)
})

test('the current-character card prefers the readable model name', () => {
  const domain = fs.readFileSync(path.join(__dirname, '../src/renderer/settings-window/domains/CharacterDomain.vue'), 'utf8')
  assert.match(domain, /if \(matched\) return matched\.displayName \|\| matched\.name/)
})

test('duplicate readable model names fall back to the raw path for disambiguation', () => {
  const domain = fs.readFileSync(path.join(__dirname, '../src/renderer/settings-window/domains/CharacterDomain.vue'), 'utf8')
  assert.match(domain, /const ambiguousModelNames = computed/)
  assert.match(domain, /return ambiguousModelNames\.value\.has\(label\) \? model\.name : label/)
  const quick = fs.readFileSync(path.join(__dirname, '../src/renderer/components/QuickSettingsPanel.vue'), 'utf8')
  assert.match(quick, /quickModelLabels/)
  assert.match(quick, /\{\{ modelDisplayLabel\(model\) \}\}/)
})
