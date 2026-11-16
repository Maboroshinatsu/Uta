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

test('welcome title breaks at phrase boundaries instead of splitting words', () => {
  const flow = read('src/renderer/settings-window/onboarding/OnboardingFlow.vue')
  assert.match(flow, /让 Uta 住进桌面，<br>陪你把手上的事做完。/)
  assert.doesNotMatch(flow, />返回设置<\/button>/, 'reentry welcome must not duplicate the top return button')
  const display = ruleOf(read('src/renderer/settings-window/onboarding/onboarding.css'), '.onb-display')
  const width = display.match(/max-width:\s*(\d+)ch/)
  assert.ok(width, 'display title must keep a width cap')
  assert.ok(Number(width[1]) >= 20, 'title must be wide enough for each phrase line')
  const lineHeight = Number(display.match(/line-height:\s*([\d.]+)/)?.[1])
  assert.ok(lineHeight >= 1.1, 'line-height must leave breathing room between the two lines')
})

test('onboarding action buttons share one height and no bare pill slips through', () => {
  const css = read('src/renderer/settings-window/onboarding/onboarding.css')
  assert.equal(px(ruleOf(css, '.onb-pill'), 'min-height'), 36)
  assert.equal(px(ruleOf(css, '.onb-pill'), 'border-radius'), 9, 'all onboarding action buttons must use the settings radius')
  assert.equal(px(ruleOf(css, '.onb-pill--primary'), 'min-height'), 36)
  const host = read('src/renderer/settings-window/onboarding/HostStageCard.vue')
  assert.match(host, /class="onb-pill onb-pill--ghost"\s+:disabled="installBusy \|\| pathBusy"/)
})

test('onboarding step transitions are slowed for readability', () => {
  const css = read('src/renderer/settings-window/onboarding/onboarding.css')
  const enter = ruleOf(css, '.onb-step-enter-active')
  const leave = ruleOf(css, '.onb-step-leave-active')
  const enterMs = Math.max(...([...enter.matchAll(/(\d+)ms/g)].map(m => Number(m[1]))), 0)
  const leaveMs = Math.max(...([...leave.matchAll(/(\d+)ms/g)].map(m => Number(m[1]))), 0)
  assert.ok(enterMs >= 280, 'enter transition must be slower than before')
  assert.ok(leaveMs >= 220, 'leave transition must be slower than before')
})
