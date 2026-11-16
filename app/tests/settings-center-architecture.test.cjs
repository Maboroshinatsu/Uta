'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const createLoader = require('./support/settings-loader.cjs')

const load = createLoader()
const domains = load('renderer/settings-window/settings-domains')
const layout = load('renderer/settings-window/layout-mode')
const performance = load('renderer/settings-window/render-performance')

test('default and invalid routes resolve to the character destination', () => {
  assert.equal(domains.DEFAULT_SETTINGS_DOMAIN, 'character')
  assert.equal(domains.resolveSettingsDomain(null), 'character')
  assert.equal(domains.resolveSettingsDomain('unknown-domain'), 'character')
  assert.equal(domains.resolveSettingsDomain('voice'), 'voice')
})

test('the navigation registry exposes seven named destinations with page copy', () => {
  assert.equal(domains.SETTINGS_DOMAINS.length, 7)
  assert.equal(
    domains.SETTINGS_DOMAINS.map(domain => domain.label).join('|'),
    ['模型与动作', '连接与会话', '待办', '语音', '桌面与交互', '外观与性能', '关于与诊断'].join('|'),
  )
  for (const domain of domains.SETTINGS_DOMAINS) {
    assert.ok(domain.title.length > 0)
    assert.ok(domain.subtitle.length > 0)
    assert.match(domain.icon, /^[a-z]+$/)
  }
})

test('backgrounded pages stay hidden even though their layout class sets display', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/renderer/settings-window/settings-center.css'), 'utf8')
  assert.match(css, /\.settings-stack\[hidden\][\s\S]*?\.settings-panel\[hidden\][\s\S]*?display:\s*none/)
})

test('theme tokens stay on :root so a nested data-theme cannot shadow the live accent', () => {
  const tokens = fs.readFileSync(
    path.join(__dirname, '../src/renderer/components/settings-v2/tokens.css'),
    'utf8',
  )
  assert.match(tokens, /:root\[data-theme="dark"\]\s*\{/)
  assert.doesNotMatch(
    tokens,
    /(^|\n)\s*\[data-theme=["'][^"']+["']\]\s*\{/,
    'palette blocks must not match the settings app root, which carries data-theme itself',
  )
  const settingsApp = fs.readFileSync(
    path.join(__dirname, '../src/renderer/settings-window/SettingsWindowApp.vue'),
    'utf8',
  )
  assert.match(settingsApp, /:data-theme="currentTheme"/)
  assert.match(settingsApp, /root\.setProperty\('--uta-accent', accent\)/)
})

test('settings page switches use the slower transition', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/renderer/settings-window/SettingsWindowApp.vue'), 'utf8')
  const css = fs.readFileSync(path.join(__dirname, '../src/renderer/settings-window/settings-center.css'), 'utf8')
  assert.match(app, /animation:\s*page-enter\s+360ms/)
  assert.match(css, /animation:\s*page-enter\s+360ms/)
})

test('layout breakpoints keep 960 and 640 usable and switch navigation to compact below 620', () => {
  assert.equal(layout.resolveLayoutMode(960), 'wide')
  assert.equal(layout.resolveLayoutMode(800), 'medium')
  assert.equal(layout.resolveLayoutMode(640), 'medium')
  assert.equal(layout.resolveLayoutMode(620), 'compact')
  assert.equal(layout.resolveLayoutMode(480), 'compact')
  assert.equal(layout.resolveLayoutMode(Number.NaN), 'compact')
})

test('one pet is bound to one platform in the settings UI', () => {
  const connections = fs.readFileSync(
    path.join(__dirname, '../src/renderer/settings-window/domains/ConnectionsDomain.vue'),
    'utf8',
  )
  assert.match(connections, /boundHostId/)
  assert.match(connections, /host-switch-grid/)
  assert.match(connections, /switchHost/)
  assert.doesNotMatch(connections, /selectPreference/)
  assert.doesNotMatch(connections, /class="host-grid"/)
  assert.match(connections, /该宿主的所有会话都会驱动桌宠/)

  const about = fs.readFileSync(
    path.join(__dirname, '../src/renderer/settings-window/domains/AboutDomain.vue'),
    'utf8',
  )
  assert.match(about, /解除宿主绑定/)
  assert.match(about, /unbind-host/)

  const petsDir = path.join(__dirname, '../scripts/pets')
  for (const file of [
    'Uta-Codex.bat',
    'Uta-DeepSeek-Harness.bat',
    'Uta-Qoder.bat',
    'Uta-Antigravity.bat',
    'Uta-Claude-Code.bat',
    'Uta-ZCode.bat',
    'Uta-OpenCode.bat',
  ]) {
    assert.ok(fs.existsSync(path.join(petsDir, file)), file)
  }
})

test('render performance preferences use the same local keys without inventing a backend', () => {
  const memory = new Map()
  const storage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
  }
  assert.equal(performance.readRenderFpsMode(storage), '60')
  assert.equal(performance.readAdaptiveIdle(storage), true)
  assert.equal(performance.writeRenderFpsMode('auto', storage), true)
  assert.equal(performance.writeAdaptiveIdle(false, storage), true)
  assert.equal(performance.readRenderFpsMode(storage), 'auto')
  assert.equal(performance.readAdaptiveIdle(storage), false)
  assert.equal(memory.get(performance.RENDER_FPS_STORAGE_KEY), 'auto')
  assert.equal(memory.get(performance.ADAPTIVE_IDLE_STORAGE_KEY), 'false')
  const denied = { setItem: () => { throw Error('storage disabled') } }
  assert.equal(performance.writeRenderFpsMode('30', denied), false)
  assert.equal(performance.writeAdaptiveIdle(true, denied), false)
})
