'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

const color = createLoader()('renderer/services/color-contrast')

const BUILT_IN_ACCENTS = [
  '#3d6a8e',
  '#5c87a3',
  '#6f8f7f',
  '#8a7f9e',
  '#a9825c',
  '#a9605a',
  '#c87137',
]

test('accent text picks a WCAG-readable ink instead of a brightness threshold', () => {
  const amber = color.readableInk('#c87137')
  assert.ok(color.contrastRatio(amber, '#c87137') >= 4.5)
  assert.equal(amber, '#0d1a20')
  assert.equal(color.readableInk('#3d6a8e'), '#ffffff')
  assert.equal(color.readableInk('#f2e8d5'), '#0d1a20')
})

test('every built-in accent keeps 4.5:1 for normal and hover fills', () => {
  for (const accent of BUILT_IN_ACCENTS) {
    const ink = color.readableInk(accent)
    const hover = color.accentHoverBackground(accent, ink)
    assert.ok(color.contrastRatio(ink, accent) >= 4.5, `${ink} on ${accent}`)
    assert.ok(color.contrastRatio(ink, hover) >= 4.5, `${ink} on hover ${hover} (${accent})`)
  }
})

test('mid-luminance colors fall back to black when the branded ink is not enough', () => {
  for (const accent of ['#7d7d7d', '#8a8a8a', '#9b8a6b', '#6f8f6a']) {
    const ink = color.readableInk(accent)
    assert.ok(color.contrastRatio(ink, accent) >= 4.5, `${ink} on ${accent}`)
  }
})

test('very light pastels switch to dark ink', () => {
  for (const accent of ['#f5f5f7', '#fff8e7', '#eaf5ea', '#eef2fb']) {
    assert.equal(color.readableInk(accent), '#0d1a20', `${accent}`)
  }
})

test('hover fills move in the direction that keeps the chosen ink readable', () => {
  const amberInk = color.readableInk('#c87137')
  const amberHover = color.accentHoverBackground('#c87137', amberInk)
  assert.ok(color.relativeLuminance(amberHover) > color.relativeLuminance('#c87137'))
  assert.ok(color.contrastRatio(amberInk, amberHover) >= 4.5)

  const blueInk = color.readableInk('#3d6a8e')
  const blueHover = color.accentHoverBackground('#3d6a8e', blueInk)
  assert.ok(color.relativeLuminance(blueHover) < color.relativeLuminance('#3d6a8e'))
  assert.ok(color.contrastRatio(blueInk, blueHover) >= 4.5)
})

test('invalid colors normalize to null without throwing', () => {
  assert.equal(color.normalizeHex('nope'), null)
  assert.equal(color.normalizeHex('#ABCDEF'), '#abcdef')
  assert.equal(color.contrastRatio('#000000', '#ffffff'), 21)
})
