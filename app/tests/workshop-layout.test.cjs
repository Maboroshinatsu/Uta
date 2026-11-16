'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

test('workshop switches columns from the real board width and lets actions wrap', () => {
  const studio = fs.readFileSync(
    path.join(__dirname, '../src/renderer/components/SettingsStudioTab.vue'),
    'utf8',
  )
  const css = fs.readFileSync(
    path.join(__dirname, '../src/renderer/components/styles/settings-panel.css'),
    'utf8',
  )
  assert.match(studio, /class="studio-workbench-shell"/)
  assert.match(studio, /\.studio-workbench-shell\s*\{[\s\S]*?container-type:\s*inline-size/)
  assert.match(studio, /@container \(max-width:\s*660px\)/)
  assert.match(
    studio,
    /@container \(max-width:\s*660px\)[\s\S]*?\.studio-workbench-board\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  )
  assert.match(
    css,
    /\.studio-action-row\s*\{[\s\S]*?flex-wrap:\s*wrap/,
    'action buttons must wrap instead of overlapping at medium widths',
  )
})
