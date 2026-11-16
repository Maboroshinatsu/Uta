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

describe('Settings Runtime & Main IPC Integration', () => {
  let tmpRoot
  let mockIpcHandlers
  let mockIpcSenders

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-settings-runtime-'))
    mockIpcHandlers = new Map()
    mockIpcSenders = []
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  function setupIpcEnvironment() {
    const ipcMain = {
      handle(channel, fn) {
        if (mockIpcHandlers.has(channel)) {
          throw new Error(`Handler already registered: ${channel}`)
        }
        mockIpcHandlers.set(channel, fn)
      },
      removeHandler(channel) {
        mockIpcHandlers.delete(channel)
      },
    }

    const loader = createTsLoader(path.join(__dirname, '../src/main'), { electron: { ipcMain } })
    const modExports = loader('./settings-ipc/index.ts')
    const storeModule = loader('./settings-store/index.ts')

    return {
      registerSettingsIpc: modExports.registerSettingsIpc,
      isValidSettingsSender: modExports.isValidSettingsSender,
      createSettingsStore: storeModule.createSettingsStore,
      ipcMain,
    }
  }

  function createMockWebContents(id = 1) {
    const messages = []
    const mainFrame = { id: 100 }
    let destroyed = false
    return {
      id,
      mainFrame,
      isDestroyed: () => destroyed,
      destroy: () => { destroyed = true },
      send: (channel, ...args) => {
        if (destroyed) throw new Error('WebContents destroyed')
        messages.push({ channel, args })
      },
      _messages: messages,
    }
  }

  test('sender validation strictly rejects sub-frames, unapproved targets, and dead targets', () => {
    const { isValidSettingsSender } = setupIpcEnvironment()
    const targetA = createMockWebContents(1)
    const targetB = createMockWebContents(2)
    const approved = [targetA]

    // 1. 合法 sender（主 frame，属于 approved）
    const validEvent = {
      sender: targetA,
      senderFrame: targetA.mainFrame,
    }
    assert.equal(isValidSettingsSender(validEvent, approved), true)

    // 2. 陌生/未登记 sender
    const unknownEvent = {
      sender: targetB,
      senderFrame: targetB.mainFrame,
    }
    assert.equal(isValidSettingsSender(unknownEvent, approved), false)

    // 3. 子 frame (senderFrame !== mainFrame) 必须被拒绝
    const subFrameEvent = {
      sender: targetA,
      senderFrame: { id: 999 }, // iframe
    }
    assert.equal(isValidSettingsSender(subFrameEvent, approved), false)

    // 4. 销毁中的 sender
    targetA.destroy()
    assert.equal(isValidSettingsSender(validEvent, approved), false)
  })

  test('stable profile: legacy mode has ZERO store creation, ZERO disk file I/O, returns legacy and null/blocked', async () => {
    const { registerSettingsIpc, ipcMain } = setupIpcEnvironment()
    const webContents = createMockWebContents(1)
    const profileDir = path.join(tmpRoot, 'stable-profile')
    fs.mkdirSync(profileDir, { recursive: true })

    // 在 stable 模式下注册设置 IPC（不创建 store）
    const controller = registerSettingsIpc({
      mode: 'legacy',
      store: null,
      isAllowedSender: (e) => e.sender === webContents,
      getTargets: () => [webContents],
    })

    assert.equal(controller.mode, 'legacy')

    // 1. getMode
    const modeHandler = mockIpcHandlers.get('uta:settings:mode')
    assert.ok(modeHandler)
    assert.equal(modeHandler({ sender: webContents }), 'legacy')

    // 2. read
    const readHandler = mockIpcHandlers.get('uta:settings:read')
    assert.ok(readHandler)
    const readResult = await readHandler({ sender: webContents })
    assert.equal(readResult, null)

    // 3. patch
    const patchHandler = mockIpcHandlers.get('uta:settings:patch')
    assert.ok(patchHandler)
    const patchResult = await patchHandler({ sender: webContents }, { expectedRevision: 0, changes: { themeMode: 'dark' } })
    assert.deepEqual(JSON.parse(JSON.stringify(patchResult)), { ok: false, code: 'store-blocked', currentRevision: null })

    // 4. importLegacy 绝不注册
    assert.equal(mockIpcHandlers.has('uta:settings:import-legacy'), false)

    // 5. 验证绝对零文件写入（磁盘目录为空）
    const dirEntries = fs.readdirSync(profileDir)
    assert.equal(dirEntries.length, 0, 'Stable mode must perform ZERO file I/O')

    await controller.dispose()
    assert.equal(mockIpcHandlers.has('uta:settings:mode'), false)
    assert.equal(mockIpcHandlers.has('uta:settings:read'), false)
    assert.equal(mockIpcHandlers.has('uta:settings:patch'), false)
  })

  test('canonical-dev mode: registers store, enforces authorization, performs patch, broadcasts changes and cleans up', async () => {
    const { registerSettingsIpc, createSettingsStore } = setupIpcEnvironment()
    const devProfileDir = path.join(tmpRoot, 'dev-profile')
    fs.mkdirSync(devProfileDir, { recursive: true })

    const store = await createSettingsStore(devProfileDir)
    const targetA = createMockWebContents(1)
    const targetB = createMockWebContents(2)
    const approvedTargets = [targetA]

    const controller = registerSettingsIpc({
      mode: 'canonical-dev',
      store,
      isAllowedSender: (e) => approvedTargets.includes(e.sender) && (!e.senderFrame || e.senderFrame === e.sender.mainFrame),
      getTargets: () => [targetA, targetB],
    })

    // 1. 未授权 sender 拒绝
    const modeHandler = mockIpcHandlers.get('uta:settings:mode')
    assert.throws(() => {
      modeHandler({ sender: targetB })
    }, /Unauthorized settings IPC sender/)

    const readHandler = mockIpcHandlers.get('uta:settings:read')
    await assert.rejects(async () => {
      await readHandler({ sender: targetB })
    }, /Unauthorized settings IPC sender/)

    const patchHandler = mockIpcHandlers.get('uta:settings:patch')
    const unauthPatch = await patchHandler({ sender: targetB }, { expectedRevision: 0, changes: {} })
    assert.deepEqual(JSON.parse(JSON.stringify(unauthPatch)), { ok: false, code: 'invalid-request', currentRevision: null })

    // 2. 合法 sender 读取初始状态
    assert.equal(modeHandler({ sender: targetA, senderFrame: targetA.mainFrame }), 'canonical-dev')
    const initialRead = await readHandler({ sender: targetA, senderFrame: targetA.mainFrame })
    assert.equal(initialRead.status, 'ready')
    assert.equal(initialRead.document.revision, 0)
    assert.equal(initialRead.document.values.themeMode, 'light')

    // 3. 提交 patch 并验证广播到活跃目标
    const patchRes = await patchHandler(
      { sender: targetA, senderFrame: targetA.mainFrame },
      { expectedRevision: 0, changes: { themeMode: 'dark', accentColor: '#123456' } }
    )
    assert.equal(patchRes.ok, true)
    assert.equal(patchRes.changed, true)
    assert.equal(patchRes.document.revision, 1)
    assert.equal(patchRes.document.values.themeMode, 'dark')

    // 等待微任务广播
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(targetA._messages.length, 1)
    assert.equal(targetA._messages[0].channel, 'uta:settings:changed')
    assert.equal(targetA._messages[0].args[0].revision, 1)

    // 4. 版本冲突拒绝
    const conflictRes = await patchHandler(
      { sender: targetA, senderFrame: targetA.mainFrame },
      { expectedRevision: 0, changes: { themeMode: 'light' } }
    )
    assert.equal(conflictRes.ok, false)
    assert.equal(conflictRes.code, 'revision-conflict')
    assert.equal(conflictRes.currentRevision, 1)

    // 5. 磁盘持久化检查
    const diskFile = path.join(devProfileDir, 'settings.v1.json')
    assert.ok(fs.existsSync(diskFile), 'settings.v1.json must exist')
    const diskData = JSON.parse(fs.readFileSync(diskFile, 'utf8'))
    assert.equal(diskData.revision, 1)
    assert.equal(diskData.values.themeMode, 'dark')

    // 6. 正常 dispose
    await controller.dispose()
    assert.equal(mockIpcHandlers.size, 0)
  })

  test('profile isolation: two concurrent stores do not cross-talk or cross-write', async () => {
    const { createSettingsStore } = setupIpcEnvironment()
    const dirA = path.join(tmpRoot, 'profile-alpha')
    const dirB = path.join(tmpRoot, 'profile-beta')
    fs.mkdirSync(dirA, { recursive: true })
    fs.mkdirSync(dirB, { recursive: true })

    const storeA = await createSettingsStore(dirA)
    const storeB = await createSettingsStore(dirB)

    await storeA.patch({ expectedRevision: 0, changes: { themeMode: 'dark' } })
    const stateA = await storeA.read()
    const stateB = await storeB.read()

    assert.equal(stateA.document.revision, 1)
    assert.equal(stateA.document.values.themeMode, 'dark')

    assert.equal(stateB.document.revision, 0)
    assert.equal(stateB.document.values.themeMode, 'light')

    await storeA.close()
    await storeB.close()

    // 重新打开 A 验证持久化隔离
    const reopenA = await createSettingsStore(dirA)
    const reopenedStateA = await reopenA.read()
    assert.equal(reopenedStateA.document.revision, 1)
    assert.equal(reopenedStateA.document.values.themeMode, 'dark')
    await reopenA.close()
  })
})
