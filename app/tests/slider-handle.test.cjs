'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
const ruleOf = (css, selector) => {
  const rule = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\}`))
  assert.ok(rule, `missing rule ${selector}`)
  return rule[1]
}
const px = (block, property) => {
  const value = block.match(new RegExp(`(?:^|;)\\s*${property}:\\s*(\\d+)px`))
  assert.ok(value, `missing ${property}`)
  return Number(value[1])
}
const overlayGrip = (block, height, barHeight) => {
  assert.equal(px(block, 'width'), 16, 'grip must stay narrow')
  assert.equal(px(block, 'height'), height, 'grip must stay tall')
  assert.equal(px(block, 'border-radius'), 8)
  assert.ok(height * 0.95 > barHeight, 'pressed grip must still cover the bar')
  assert.match(block, /pointer-events:\s*none/, 'grip is painted, the input handles dragging')
  assert.match(block, /background:\s*#ffffff/)
  assert.match(block, /radial|box-shadow|border:\s*1px|border:/)
}
const hiddenNativeThumb = block => {
  assert.match(block, /background:\s*transparent/, 'native thumb must stay invisible')
  assert.match(block, /border:\s*none/)
  assert.match(block, /box-shadow:\s*none/)
}

test('voice slider paints its grip at the fill edge and keeps the native thumb invisible', () => {
  const voice = read('src/renderer/components/TtsSettingsSection.vue')
  const bar = ruleOf(voice, '.slider-track-wrap')
  assert.equal(px(bar, 'height'), 30)
  assert.equal(px(bar, 'border-radius'), 8)
  assert.match(bar, /(?:^|;)\s*padding:\s*0;/)
  assert.match(bar, /overflow:\s*visible/)
  hiddenNativeThumb(ruleOf(voice, '.slider-range-input::-webkit-slider-thumb'))
  overlayGrip(ruleOf(voice, '.slider-grip'), 36, 30)
  assert.match(ruleOf(voice, '.slider-track-wrap:active .slider-grip'), /scale\(0\.95\)/)
  assert.equal((voice.match(/class="slider-grip"/g) ?? []).length, 2)
  assert.equal((voice.match(/gripLeft\(/g) ?? []).length, 3)
})

test('workshop slider paints its grip at the fill edge and keeps the native thumb invisible', () => {
  const css = read('src/renderer/components/styles/settings-panel.css')
  const studio = read('src/renderer/components/SettingsStudioTab.vue')
  const bar = ruleOf(css, '.bio-scrub')
  assert.equal(px(bar, 'height'), 34)
  assert.equal(px(bar, 'border-radius'), 11)
  assert.match(bar, /background:\s*var\(--dp-pill-inner\)/)
  assert.match(bar, /overflow:\s*visible/)
  assert.match(ruleOf(css, '.bio-scrub-label'), /z-index:\s*3/)
  assert.match(ruleOf(css, '.bio-scrub-val'), /z-index:\s*3/)
  assert.equal(px(ruleOf(css, '.bio-scrub-fill'), 'border-radius'), 7)
  assert.ok(px(ruleOf(css, '.bio-slider-list'), 'gap') > 6, 'slider rows must leave room for the taller grips')

  hiddenNativeThumb(ruleOf(css, '.bio-range-input::-webkit-slider-thumb'))
  overlayGrip(ruleOf(css, '.bio-scrub-grip'), 40, 34)
  assert.match(ruleOf(css, '.bio-scrub:active .bio-scrub-grip'), /scale\(0\.95\)/)
  assert.equal((studio.match(/class="bio-scrub-grip"/g) ?? []).length, 3)
  assert.equal((studio.match(/getSliderGripLeft\(slider\)/g) ?? []).length, 3)

  assert.equal((studio.match(/width: workshop\.getSliderFillPercent\(slider\) \+ '%'/g) ?? []).length, 3)
  assert.doesNotMatch(studio, /getSliderFillWidth|sliderFillWidth|clamp\(16px/)
  assert.equal((studio.match(/step="0\.01"/g) ?? []).length, 3, 'workshop sliders must drag continuously')
  assert.doesNotMatch(studio, /:step="slider\.step"/)
  assert.doesNotMatch(studio, /bio-scrub-head|bio-scrub-track|getSliderFillStyle/)
  assert.doesNotMatch(css, /\.bio-scrub-fill::after/)
})
