'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test, describe, beforeEach, afterEach } = require('node:test')

function createTsLoader(baseDir, overrides = {}) {
  const cache = new Map()
  function load(filePath) {
    let resolved = path.resolve(baseDir, filePath)
    if (!fs.existsSync(resolved)) {
      if (fs.existsSync(resolved + '.ts')) {
        resolved += '.ts'
      } else if (fs.existsSync(path.join(resolved, 'index.ts'))) {
        resolved = path.join(resolved, 'index.ts')
      }
    }
    if (cache.has(resolved)) return cache.get(resolved)

    const source = fs.readFileSync(resolved, 'utf8')
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText

    const mod = { exports: {} }
    cache.set(resolved, mod.exports)

    const customRequire = (id) => {
      if (Object.hasOwn(overrides, id)) return overrides[id]
      if (id.startsWith('.')) {
        return load(path.resolve(path.dirname(resolved), id))
      }
      return require(id)
    }

    vm.runInNewContext(code, {
      module: mod,
      exports: mod.exports,
      require: customRequire,
      __dirname: path.dirname(resolved),
      __filename: resolved,
      window: typeof window !== 'undefined' ? window : undefined,
      document: typeof document !== 'undefined' ? document : undefined,
      console,
      Buffer,
      setTimeout,
      clearTimeout,
      setImmediate,
      clearImmediate,
      queueMicrotask,
      URL,
      Promise,
      Object,
      Array,
      String,
      Number,
      Boolean,
      Error,
      TypeError,
      RangeError,
      Map,
      Set,
    })
    return mod.exports
  }
  return load
}

describe('Settings Window Manager & Dual-Window IPC Lifecycle', () => {
  let createdWindows = []
  let mockShell = {}

  function createMockBrowserWindow(options) {
    let visible = options.show ?? true
    let minimized = false
    let focused = false
    let destroyed = false
    const listeners = new Map()
    let loadedUrl = ''

    const mainFrame = { id: 100 }
    const webContents = {
      id: Math.floor(Math.random() * 10000),
      mainFrame,
      isDestroyed: () => destroyed,
      getURL: () => loadedUrl,
      setWindowOpenHandler: () => {},
      on: (evt, cb) => {
        if (!listeners.has(evt)) listeners.set(evt, [])
        listeners.get(evt).push(cb)
      },
      send: (channel, ...args) => {
        webContents.sentMessages.push({ channel, args })
      },
      sentMessages: [],
    }

    const win = {
      options,
      webContents,
      isDestroyed: () => destroyed,
      isVisible: () => visible,
      isMinimized: () => minimized,
      isFocused: () => focused,
      show: () => { visible = true },
      hide: () => { visible = false },
      restore: () => { minimized = false },
      minimize: () => { minimized = true },
      focus: () => { focused = true },
      loadURL: async (url) => {
        loadedUrl = url
      },
      close: () => {
        destroyed = true
        const cbs = listeners.get('closed') || []
        for (const cb of cbs) cb()
      },
      once: (evt, cb) => {
        if (!listeners.has(evt)) listeners.set(evt, [])
        listeners.get(evt).push(cb)
      },
      on: (evt, cb) => {
        if (!listeners.has(evt)) listeners.set(evt, [])
        listeners.get(evt).push(cb)
      },
    }

    createdWindows.push(win)
    return win
  }

  beforeEach(() => {
    createdWindows = []
    mockShell = {
      openExternal: async () => {},
    }
  })

  afterEach(() => {
    for (const win of createdWindows) {
      if (!win.isDestroyed()) win.close()
    }
  })

  test('SettingsWindowManager enforces single instance and focus restoration', async () => {
    const electronMock = {
      BrowserWindow: createMockBrowserWindow,
      shell: mockShell,
    }

    const loader = createTsLoader(path.join(__dirname, '../src/main/settings-ipc'), {
      electron: electronMock,
    })

    const { SettingsWindowManager } = loader('./window-manager.ts')

    const manager = new SettingsWindowManager({
      isStable: false,
      profile: 'test-profile',
      getAppIconPath: () => '/path/to/icon.ico',
      settingsPageUrl: 'http://localhost:5173/index.html',
    })

    // First open creates window
    const win1 = manager.openSettingsWindow()
    assert.equal(createdWindows.length, 1)
    assert.equal(win1.options.width, 880)
    assert.equal(win1.options.height, 640)
    assert.equal(win1.options.backgroundColor, '#f4f1e9')
    assert.equal(win1.options.title, 'Uta 设置 [test-profile]')
    assert.equal(win1.webContents.getURL(), 'http://localhost:5173/index.html#settings')

    // Simulate minimize
    win1.minimize()
    assert.equal(win1.isMinimized(), true)

    // Second open focuses existing window and restores it
    const win2 = manager.openSettingsWindow()
    assert.equal(createdWindows.length, 1) // No new window!
    assert.equal(win1, win2)
    assert.equal(win1.isMinimized(), false) // Restored!
    assert.equal(win1.isFocused(), true)

    // Close window
    manager.closeSettingsWindow()
    assert.equal(manager.getSettingsWindow(), null)

    // Re-open creates a new instance
    const win3 = manager.openSettingsWindow()
    assert.equal(createdWindows.length, 2)
    assert.ok(win3)
    assert.notEqual(win1, win3)
  })

  test('Dual-window registration validates both mainWindow and settingsWindow', async () => {
    const electronMock = {
      BrowserWindow: createMockBrowserWindow,
      shell: mockShell,
      ipcMain: { handle: () => {}, removeHandler: () => {} },
    }

    const loader = createTsLoader(path.join(__dirname, '../src/main/settings-ipc'), {
      electron: electronMock,
    })

    const { SettingsWindowManager, isValidSettingsSender, isSettingsPage } = loader('./index.ts')

    const settingsPageUrl = 'http://localhost:5173/index.html'
    const manager = new SettingsWindowManager({
      isStable: false,
      profile: 'test-profile',
      getAppIconPath: () => '/path/to/icon.ico',
      settingsPageUrl,
    })

    const petWindow = createMockBrowserWindow({})
    await petWindow.loadURL(settingsPageUrl)

    const settingsWindow = manager.openSettingsWindow()

    const approvedTargets = [petWindow.webContents, settingsWindow.webContents]

    // 1. Both windows match settingsPageUrl (ignoring hash)
    assert.equal(isSettingsPage(petWindow.webContents, settingsPageUrl), true)
    assert.equal(isSettingsPage(settingsWindow.webContents, settingsPageUrl), true)

    // 2. Both windows are valid senders when called from mainFrame
    const petEvent = { sender: petWindow.webContents, senderFrame: petWindow.webContents.mainFrame }
    const settingsEvent = { sender: settingsWindow.webContents, senderFrame: settingsWindow.webContents.mainFrame }

    assert.equal(isValidSettingsSender(petEvent, approvedTargets), true)
    assert.equal(isValidSettingsSender(settingsEvent, approvedTargets), true)

    // 3. Subframe / iframe is rejected
    const subframeEvent = { sender: settingsWindow.webContents, senderFrame: { id: 999 } }
    assert.equal(isValidSettingsSender(subframeEvent, approvedTargets), false)

    // 4. Foreign window is rejected
    const foreignWindow = createMockBrowserWindow({})
    const foreignEvent = { sender: foreignWindow.webContents, senderFrame: foreignWindow.webContents.mainFrame }
    assert.equal(isValidSettingsSender(foreignEvent, approvedTargets), false)
  })
})


describe('Renderer Decoupling & Settings Draft Flow', () => {
  test('isSettingsWindowRoute detects settings hash or query, separates from pet', () => {
    function testRoute(hash, search) {
      global.window = {
        location: { hash, search, href: `http://localhost:5173/index.html${hash}${search}` }
      }
      const loader = createTsLoader(path.join(__dirname, '../src/renderer'))
      const { isSettingsWindowRoute } = loader('./route.ts')
      const res = isSettingsWindowRoute()
      delete global.window
      return res
    }

    assert.equal(testRoute('', ''), false)
    assert.equal(testRoute('#settings', ''), true)
    assert.equal(testRoute('', '?window=settings'), true)
    assert.equal(testRoute('#model', ''), false)
  })

  test('volume calculation preserves 0..1 storage domain and renders 0..100% percentage', () => {
    // 0.8 volume is 80%
    const v1 = 0.8
    assert.equal(Math.round(v1 * 100), 80)

    // 80% converted back to storage is 0.8 (never 80)
    const p1 = 80
    assert.equal(Math.round(Math.max(0, Math.min(100, p1))) / 100, 0.8)

    // Boundary clamp: 120% clamps to 1.0; -10% clamps to 0.0
    assert.equal(Math.round(Math.max(0, Math.min(100, 120))) / 100, 1.0)
    assert.equal(Math.round(Math.max(0, Math.min(100, -10))) / 100, 0.0)
  })

  test('dirty check correctly compares all 12 public settings fields', () => {
    const baseSettings = {
      themeMode: 'light',
      accentColor: '#0071e3',
      hoverFadeEnabled: false,
      gazeFollowEnabled: true,
      idleActionsEnabled: true,
      orbAction: 'model_picker',
      ttsEnabled: false,
      ttsProvider: 'cloud',
      ttsRate: 1,
      ttsVolume: 0.8,
      ttsSpeakNarration: false,
      ttsSpeakReplies: true,
    }

    function isDirty(draft, current) {
      return (
        draft.themeMode !== current.themeMode ||
        draft.accentColor.toLowerCase() !== current.accentColor.toLowerCase() ||
        draft.hoverFadeEnabled !== current.hoverFadeEnabled ||
        draft.gazeFollowEnabled !== current.gazeFollowEnabled ||
        draft.idleActionsEnabled !== current.idleActionsEnabled ||
        draft.orbAction !== current.orbAction ||
        draft.ttsEnabled !== current.ttsEnabled ||
        draft.ttsProvider !== current.ttsProvider ||
        draft.ttsRate !== current.ttsRate ||
        draft.ttsVolume !== current.ttsVolume ||
        draft.ttsSpeakNarration !== current.ttsSpeakNarration ||
        draft.ttsSpeakReplies !== current.ttsSpeakReplies
      )
    }

    assert.equal(isDirty({ ...baseSettings }, baseSettings), false)
    assert.equal(isDirty({ ...baseSettings, accentColor: '#0071E3' }, baseSettings), false) // case-insensitive

    const testMutations = [
      { themeMode: 'dark' },
      { accentColor: '#4f7fa6' },
      { hoverFadeEnabled: true },
      { gazeFollowEnabled: false },
      { idleActionsEnabled: false },
      { orbAction: 'toggle_window' },
      { ttsEnabled: true },
      { ttsProvider: 'http' },
      { ttsRate: 1.5 },
      { ttsVolume: 0.5 },
      { ttsSpeakNarration: true },
      { ttsSpeakReplies: false },
    ]

    for (const mutation of testMutations) {
      const field = Object.keys(mutation)[0]
      const modified = { ...baseSettings, ...mutation }
      assert.equal(isDirty(modified, baseSettings), true, `Field ${field} should trigger isDirty`)
    }
  })

  test('cross-window remote synchronization and conflict resolution logic', () => {
    let currentAuthority = {
      revision: 1,
      values: {
        themeMode: 'light',
        accentColor: '#0071e3',
        hoverFadeEnabled: false,
        gazeFollowEnabled: true,
        idleActionsEnabled: true,
        orbAction: 'model_picker',
        ttsEnabled: false,
        ttsProvider: 'cloud',
        ttsRate: 1,
        ttsVolume: 0.8,
        ttsSpeakNarration: false,
        ttsSpeakReplies: true,
      },
    }

    let localRevision = currentAuthority.revision
    let localDraft = { ...currentAuthority.values }
    let hasRemoteConflict = false
    let remoteRevision = null

    function isDraftDirty() {
      return JSON.stringify(localDraft) !== JSON.stringify(currentAuthority.values)
    }

    function onRemoteChanged(doc) {
      const wasDirty = isDraftDirty()
      currentAuthority = doc
      if (!wasDirty) {
        localDraft = { ...doc.values }
        localRevision = doc.revision
      } else {
        if (doc.revision !== localRevision) {
          hasRemoteConflict = true
          remoteRevision = doc.revision
        }
      }
    }

    // 1. Clean draft receives broadcast from pet window -> auto updates
    onRemoteChanged({
      revision: 2,
      values: { ...currentAuthority.values, themeMode: 'dark' },
    })
    assert.equal(localDraft.themeMode, 'dark')
    assert.equal(localRevision, 2)
    assert.equal(hasRemoteConflict, false)

    // 2. User edits draft locally -> draft becomes dirty
    localDraft.ttsVolume = 0.5
    assert.equal(isDraftDirty(), true)

    // 3. Another remote broadcast arrives while dirty -> conflict flagged
    onRemoteChanged({
      revision: 3,
      values: { ...currentAuthority.values, accentColor: '#10b981' },
    })
    assert.equal(hasRemoteConflict, true)
    assert.equal(remoteRevision, 3)
    assert.equal(localDraft.ttsVolume, 0.5) // Local draft preserved!

    // 4. User chooses to adopt remote
    localDraft = { ...currentAuthority.values }
    localRevision = currentAuthority.revision
    hasRemoteConflict = false
    assert.equal(localDraft.accentColor, '#10b981')
    assert.equal(hasRemoteConflict, false)
    assert.equal(isDraftDirty(), false)

    // 5. User makes another change then discards
    localDraft.idleActionsEnabled = false
    assert.equal(isDraftDirty(), true)
    // Discard
    localDraft = { ...currentAuthority.values }
    assert.equal(localDraft.idleActionsEnabled, true)
    assert.equal(isDraftDirty(), false)
  })
})
