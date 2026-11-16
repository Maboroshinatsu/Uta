'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const createLoader = require('./support/settings-loader.cjs')

function setup(managerOptions = {}) {
  const handlers = new Map()
  class FakeWindow extends EventEmitter {
    constructor(options = {}) {
      super()
      this.destroyed = false
      this.url = ''
      this.bounds = { x: 0, y: 0, width: options.width ?? 880, height: options.height ?? 640 }
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: {}, sent: [], isDestroyed: () => this.destroyed,
        isLoading: () => false,
        getURL: () => this.url, setWindowOpenHandler() {},
        send: (channel, request) => this.webContents.sent.push({ channel, request: { ...request } }),
      })
    }
    loadURL(url) { this.url = url; return Promise.resolve() }
    isDestroyed() { return this.destroyed }
    isMinimized() { return false }
    getBounds() { return { ...this.bounds } }
    setBounds(next) { this.bounds = { ...next } }
    show() {}
    focus() {}
    close() {
      const event = { prevented: false, preventDefault() { this.prevented = true } }
      this.emit('close', event)
      if (!event.prevented) { this.destroyed = true; this.emit('closed') }
    }
  }
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    on: (channel, handler) => handlers.set(channel, handler),
  }
  const ipcRenderer = new EventEmitter()
  let api
  let sender
  ipcRenderer.invoke = (channel, ...args) => Promise.resolve(handlers.get(channel)(sender, ...args))
  const load = createLoader({ electron: {
    BrowserWindow: FakeWindow, shell: {}, ipcMain, ipcRenderer,
    contextBridge: { exposeInMainWorld: (_name, exposed) => { api = exposed } },
  } })
  const { SettingsWindowManager } = load('main/settings-ipc/window-manager')
  const { SETTINGS_WINDOW_CHANNELS: channels } = load('shared/settings-window-contracts')
  const manager = new SettingsWindowManager({ isStable: false, profile: 'test', getAppIconPath: () => '', settingsPageUrl: 'http://localhost:5173/', ...managerOptions })
  const win = manager.openSettingsWindow()
  sender = { sender: win.webContents, senderFrame: win.webContents.mainFrame }
  load('main/settings-ipc/window-lifecycle').registerSettingsWindowLifecycle(manager, event =>
    manager.isRegisteredTarget(event.sender) && !!event.senderFrame && event.senderFrame === event.sender.mainFrame)
  load('preload/index')
  return { manager, win, handlers, channels, api, ipcRenderer, sender, setSender: value => { sender = value } }
}

test('first-run onboarding is requested through the settings route query', () => {
  const h = setup()
  assert.doesNotMatch(h.win.url, /onboarding=1/)
  h.manager.closeSettingsWindow()
  const onboarding = h.manager.openSettingsWindow(true)
  assert.match(onboarding.url, /\?onboarding=1#settings$/)
  h.manager.closeSettingsWindow()
  const normal = h.manager.openSettingsWindow()
  assert.doesNotMatch(normal.url, /onboarding=1/)
  h.manager.closeSettingsWindow()
})

test('settings window fits a small work area and returns after a monitor change', () => {
  const h = setup({ getWorkArea: () => ({ x: 0, y: 0, width: 800, height: 500 }) })
  const win = h.manager.getSettingsWindow()
  assert.equal(win.bounds.width, 760)
  assert.equal(win.bounds.height, 460)
  win.bounds = { x: 720, y: 460, width: 600, height: 400 }
  h.manager.ensureOnScreen()
  assert.deepEqual(win.bounds, { x: 200, y: 100, width: 600, height: 400 })
  h.manager.closeSettingsWindow()
  assert.equal(win.isDestroyed(), true)
})

test('guarded native close retains the registered window until explicitly approved', () => {
  const { manager, win, channels } = setup()
  manager.enableCloseGuard()
  manager.closeSettingsWindow()
  assert.equal(manager.getSettingsWindow(), win)
  assert.equal(manager.openSettingsWindow(), win, 'vetoing close must not create a second settings window')
  const request = win.webContents.sent.at(-1)
  assert.equal(request.channel, channels.closeRequested)
  assert.equal(request.request.reason, 'window')
  assert.equal(manager.respondToClose(request.request.id, 'close'), true)
  assert.equal(manager.getSettingsWindow(), null)
})

test('cancel invalidates its request so a delayed approval cannot close a later prompt', () => {
  const { manager, win } = setup()
  manager.enableCloseGuard()
  win.close()
  const firstId = win.webContents.sent.at(-1).request.id
  assert.equal(manager.respondToClose(firstId, 'cancel'), true)
  win.close()
  const secondId = win.webContents.sent.at(-1).request.id
  assert.notEqual(firstId, secondId)
  assert.equal(manager.respondToClose(firstId, 'close'), false)
  assert.equal(win.isDestroyed(), false)
  assert.equal(manager.respondToClose(secondId, 'close'), true)
})

test('cancelling application quit keeps it running even when settings are closed later', async () => {
  const { manager, win } = setup()
  manager.enableCloseGuard()
  let resumed = 0
  assert.equal(manager.deferQuitUntilSettingsClosed(() => { resumed++ }), true)
  assert.equal(win.webContents.sent.at(-1).request.reason, 'quit')
  const id = win.webContents.sent.at(-1).request.id
  manager.respondToClose(id, 'cancel')
  win.close()
  assert.equal(win.webContents.sent.at(-1).request.reason, 'window')
  manager.respondToClose(win.webContents.sent.at(-1).request.id, 'close')
  await Promise.resolve()
  assert.equal(resumed, 0)
})

test('approved quit resumes once after settings close, not before the veto returns', async () => {
  const { manager, win } = setup()
  manager.enableCloseGuard()
  let resumed = 0
  manager.deferQuitUntilSettingsClosed(() => { resumed++ })
  manager.deferQuitUntilSettingsClosed(() => { resumed += 100 })
  assert.equal(resumed, 0)
  manager.respondToClose(win.webContents.sent.at(-1).request.id, 'close')
  assert.equal(resumed, 0)
  await Promise.resolve()
  assert.equal(resumed, 1)
  assert.equal(manager.deferQuitUntilSettingsClosed(() => {}), false)
})

test('an unmounted or crashed document does not retain another document close guard', () => {
  const { manager, win } = setup()
  manager.enableCloseGuard()
  win.close()
  const id = win.webContents.sent.at(-1).request.id
  win.webContents.emit('did-start-navigation', {}, 'http://localhost:5173/', false, true)
  assert.equal(manager.respondToClose(id, 'close'), false)
  win.close()
  assert.equal(manager.getSettingsWindow(), null)
  const next = manager.openSettingsWindow()
  manager.enableCloseGuard()
  win.webContents.emit('render-process-gone')
  next.close()
  assert.equal(next.isDestroyed(), false, 'a late event from the old process cannot disarm the new window')
})

test('close IPC rejects subframes, foreign windows, navigation and malformed decisions', async () => {
  const h = setup()
  const ready = h.handlers.get(h.channels.ready)
  const respond = h.handlers.get(h.channels.respond)
  assert.equal(ready({ sender: h.win.webContents }), false)
  assert.equal(ready({ sender: h.win.webContents, senderFrame: {} }), false)
  assert.equal(ready({ sender: { isDestroyed: () => false }, senderFrame: {} }), false)
  assert.equal(ready(h.sender), true)
  h.win.close()
  const id = h.win.webContents.sent.at(-1).request.id
  for (const [badId, decision] of [[id, 'discard'], [0, 'close'], [NaN, 'close'], ['1', 'close'], [id, {}]]) {
    assert.equal(respond(h.sender, badId, decision), false)
  }
  h.win.url = 'https://example.invalid/'
  assert.equal(respond(h.sender, id, 'close'), false)
  assert.equal(h.win.isDestroyed(), false)
})

test('real preload subscribes before arming, forwards responses and removes its listener', async () => {
  const h = setup()
  const requests = []
  const unsubscribe = h.api.settingsWindow.onCloseRequested(request => requests.push(request))
  assert.equal(await h.api.settingsWindow.ready(), true)
  h.win.close()
  const sent = h.win.webContents.sent.at(-1)
  h.ipcRenderer.emit(sent.channel, {}, sent.request)
  assert.equal(requests.length, 1)
  assert.equal(await h.api.settingsWindow.respond(requests[0].id, 'cancel'), true)
  unsubscribe()
  h.ipcRenderer.emit(sent.channel, {}, sent.request)
  assert.equal(requests.length, 1)
})

test('opening settings for a domain routes a new window and switches an existing one', () => {
  const h = setup()
  h.manager.openSettingsWindow(false, 'todo')
  const sent = h.win.webContents.sent.at(-1)
  assert.equal(sent.channel, h.channels.navigateDomain)
  assert.equal(Object.values(sent.request).join(''), 'todo')

  h.manager.closeSettingsWindow()
  const fresh = h.manager.openSettingsWindow(false, 'todo')
  assert.match(fresh.url, /\?domain=todo#settings$/)
  h.manager.closeSettingsWindow()
})

test('domain navigation requested during load is replayed after the page finishes loading', () => {
  const h = setup()
  h.win.webContents.isLoading = () => true
  h.manager.openSettingsWindow(false, 'voice')
  assert.equal(h.win.webContents.sent.length, 0, 'a loading renderer has no domain listener yet')
  h.win.webContents.isLoading = () => false
  h.win.webContents.emit('did-finish-load')
  const sent = h.win.webContents.sent.at(-1)
  assert.equal(sent.channel, h.channels.navigateDomain)
  assert.equal(Object.values(sent.request).join(''), 'voice')
})

test('an acknowledged domain cancels the delayed resend', async () => {
  const h = setup()
  h.win.webContents.isLoading = () => true
  h.manager.openSettingsWindow(false, 'voice')
  h.win.webContents.isLoading = () => false
  h.win.webContents.emit('did-finish-load')
  const sent = h.win.webContents.sent.length
  h.manager.acknowledgeDomain(h.win.webContents, 'voice')
  await new Promise((resolve) => setTimeout(resolve, 450))
  assert.equal(h.win.webContents.sent.length, sent, 'an applied domain must not be re-applied later')
})
