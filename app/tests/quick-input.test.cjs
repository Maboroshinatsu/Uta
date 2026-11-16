'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')

test('the pet input can be dismissed without losing the draft', () => {
  const input = read('src/renderer/components/QuickInput.vue')
  assert.match(input, /close: \[\]/)
  assert.match(input, /@keydown\.esc\.prevent="emit\('close'\)"/)
  assert.match(input, /class="close-btn"/)
  assert.match(input, /@click="emit\('close'\)"/)

  const stage = read('src/renderer/components/DeskpetStage.vue')
  assert.match(stage, /@close="showInput = false"/)
  assert.match(stage, /if \(showInput\.value\) \{[\s\S]{0,120}showInput\.value = false[\s\S]{0,60}return/)
})

test('model errors always offer a way out', () => {
  const stage = read('src/renderer/components/DeskpetStage.vue')
  assert.doesNotMatch(stage, /v-if="!modelError\.includes\('Cubism'\)"/)
  assert.match(stage, /<details v-if="modelError\.includes\('Cubism'\)"/)
  assert.match(stage, /去设置里更换角色/)
  assert.match(stage, /打开模型目录/)

  const staticStage = read('src/renderer/components/StaticStage.vue')
  assert.match(staticStage, /emit\('open-models'\)/)
  assert.match(staticStage, /emit\('open-settings'\)/)
  assert.match(staticStage, /去设置里更换角色/)
  assert.match(staticStage, /width: min\(340px, calc\(100vw - 32px\)\)/)
  assert.match(stage, /@open-models="openModelsFolderFromError"/)
  assert.match(stage, /@open-settings="openSettingsFromError"/)
})

test('onboarding copy matches the install placeholders it renders', () => {
  const flow = read('src/renderer/settings-window/onboarding/OnboardingFlow.vue')
  assert.doesNotMatch(flow, /未安装的宿主不会出现在列表里/)
  assert.match(flow, /可以在这里直接安装/)
})

test('expiring bubbles never clear what the user is typing', () => {
  const stage = read('src/renderer/components/DeskpetStage.vue')
  const cleared = stage.match(/function onDraftCleared\(\): void \{[\s\S]*?\r?\n\}/)?.[0] ?? ''
  assert.match(cleared, /if \(!inputText\.value\.trim\(\)\) showInput\.value = false/)
  assert.doesNotMatch(cleared, /inputText\.value = ''/)
})

test('the input and companion panels stay mutually exclusive', () => {
  const stage = read('src/renderer/components/DeskpetStage.vue')
  assert.match(stage, /function retryMessage\(message: TextMessage\): void \{[\s\S]{0,400}chatPanelOpen\.value = false/)
  assert.match(stage, /chatPanelOpen\.value = false\s+todoPanelOpen\.value = false\s+showInput\.value = true/)
  assert.match(stage, /todoPanelOpen\.value = false\s+showInput\.value = false\s+chatPanelOpen\.value = true/)
  const input = read('src/renderer/components/QuickInput.vue')
  assert.match(input, /z-index: 70;/)
})
