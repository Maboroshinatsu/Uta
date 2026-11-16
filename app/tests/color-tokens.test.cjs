'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')

test('accent text uses a readable token that brightens on dark surfaces', () => {
  const tokens = read('src/renderer/components/settings-v2/tokens.css')
  assert.match(tokens, /--uta-accent-read: var\(--uta-accent\);/)
  assert.match(tokens, /--uta-accent-read: color-mix\(in srgb, var\(--uta-accent\) 55%, #FFFFFF\)/)
  assert.match(tokens, /--uta-danger-text: #A64137;/)
  assert.match(tokens, /--uta-danger-text: #F0A69C;/)

  const pet = read('src/renderer/App.vue')
  assert.match(pet, /--dp-accent-read: var\(--dp-accent\);/)
  assert.match(pet, /--dp-accent-read: color-mix\(in srgb, var\(--dp-accent\) 55%, #ffffff\)/)
  assert.match(pet, /--dp-danger: #8F3A33;/)

  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(vue|css)$/.test(entry.name)) {
        if (/^\s*color: var\(--(uta|dp)-accent\);/m.test(fs.readFileSync(full, 'utf8'))) {
          offenders.push(path.relative(path.join(__dirname, '..'), full))
        }
      }
    }
  }
  walk(path.join(__dirname, '..', 'src/renderer'))
  assert.deepEqual(offenders, [], 'text colors must use the -read accent token')
})

test('danger text and disabled rows stay readable in both themes', () => {
  const todo = read('src/renderer/settings-window/domains/TodoDomain.vue')
  assert.doesNotMatch(todo, /#e5533d/)
  assert.match(todo, /settings-note\.is-warning \{ color: var\(--uta-danger-text/)

  const quick = read('src/renderer/components/QuickSettingsPanel.vue')
  assert.match(quick, /\.qs-status\.error \{\r?\n  color: var\(--dp-danger/)

  const row = read('src/renderer/components/settings-v2/SettingsRow.vue')
  assert.match(row, /\.uta-settings-row\.is-disabled \{\r?\n  opacity: 0\.7;/)

  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(vue|ts|css)$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes('#e5533d')) {
        offenders.push(path.relative(path.join(__dirname, '..'), full))
      }
    }
  }
  walk(path.join(__dirname, '..', 'src/renderer'))
  assert.deepEqual(offenders, [], 'danger text should use --dp-danger / --uta-danger-text')
})

test('native form controls follow the active theme', () => {
  const tokens = read('src/renderer/components/settings-v2/tokens.css')
  assert.match(tokens, /:root \{\s*color-scheme: light;/)
  assert.match(tokens, /:root\[data-theme="dark"\] \{\s*color-scheme: dark;/)
  const pet = read('src/renderer/App.vue')
  assert.match(pet, /:root\[data-theme='dark'\] \{\s*color-scheme: dark;/)
  assert.match(pet, /:root,\s*:root\[data-theme='light'\] \{\s*color-scheme: light;/)
})

test('small metadata text keeps AA contrast on every light surface', () => {
  const pet = read('src/renderer/App.vue')
  const first = (name) => new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(pet)[1]
  const lum = (hex) => {
    const parts = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    const linear = parts.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  }
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  for (const token of ['dp-text-sub', 'dp-text-dim']) {
    const color = first(token)
    for (const surface of ['#FFFCF6', '#F7F3EA', '#EFE9DD']) {
      assert.ok(ratio(color, surface) >= 4.5, `${token} ${color} on ${surface} should reach AA`)
    }
  }
})

test('the older settings panel uses the same readable danger and muted tokens', () => {
  const css = read('src/renderer/components/styles/settings-panel.css')
  assert.doesNotMatch(css, /#c94a4a/i)
  assert.match(css, /\.bio-btn-pill\.danger \{\s*\n\s*color: var\(--uta-danger-text/)
  assert.match(css, /\.bio-del-step-btn \{[\s\S]*?color: var\(--uta-danger-text/)

  const tokens = read('src/renderer/components/settings-v2/tokens.css')
  const muted = /--uta-muted:\s*(#[0-9A-Fa-f]{6})/.exec(tokens)[1]
  const lum = (hex) => {
    const parts = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    const linear = parts.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  }
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  assert.ok(ratio(muted, '#F4F1E9') >= 4.5, `muted ${muted} on canvas should reach AA`)
})
