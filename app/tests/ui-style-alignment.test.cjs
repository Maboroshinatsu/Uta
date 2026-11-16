'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')

test('model calibration uses the settings controls and the workshop slider visual', () => {
  const panel = read('src/renderer/settings-window/ModelCalibrationPanel.vue')
  assert.match(panel, /calibration-inspect/)
  assert.match(panel, /class="calibration-select"/)
  assert.match(panel, /class="calibration-strength bio-scrub"/)
  assert.match(panel, /class="bio-scrub-grip"/)
  assert.match(panel, /class="bio-range-input"/)
  assert.match(panel, /border-radius: 9px/)
  assert.match(panel, /min-height: 36px/)
  assert.match(panel, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
})

test('data transfer keeps a distinct kicker and settings-styled controls', () => {
  const panel = read('src/renderer/settings-window/SettingsTransferPanel.vue')
  assert.match(panel, /panel-kicker">数据备份</)
  assert.match(panel, /class="transfer-select"/)
  assert.match(panel, /class="transfer-check"/)
  assert.match(panel, /min-height: 36px/)
  assert.match(panel, /accent-color: var\(--uta-accent\)/)
  assert.doesNotMatch(panel, /panel-kicker">数据与迁移</)
})

test('chat history keeps confirmation separate and labels sources quietly', () => {
  const bubble = read('src/renderer/components/ChatBubble.vue')
  assert.match(bubble, /class="history-confirm"/)
  assert.match(bubble, /class="msg-source"/)
  assert.match(bubble, /class="msg-delivery"/)
  assert.match(bubble, /const HOST_LABELS/)
  assert.match(bubble, /sourceTitle/)
  assert.doesNotMatch(bubble, /会话 \$\{message\.sessionId\.slice\(0, 12\)\}/)
})

test('quick input only shows a counter when there is text and uses the shared error color', () => {
  const input = read('src/renderer/components/QuickInput.vue')
  assert.match(input, /const showCounter = computed/)
  assert.match(input, /v-if="showCounter && maxChars"/)
  assert.match(input, /color: var\(--dp-danger, #8F3A33\);/)
  assert.doesNotMatch(input, /#e5533d/)
  assert.doesNotMatch(input, /#c34444/)
})

test('the play test explains why it is disabled when the model has no state presets', () => {
  const domain = read('src/renderer/settings-window/domains/ConnectionsDomain.vue')
  assert.match(domain, /当前模型没有可播放的状态预设；换回 Live2D 模型后再试。/)
  assert.match(domain, /:title="store\.statePresets\.length === 0 \? '当前模型没有可播放的状态预设'/)
})

test('host switching reuses one-click rebind instead of unbind and re-onboarding', () => {
  const stage = read('src/renderer/components/DeskpetStage.vue')
  const start = stage.indexOf('switchPreference: async preference =>')
  const end = stage.indexOf('reconnect:', start)
  assert.ok(start >= 0 && end > start, 'settings host switch block should exist')
  const block = stage.slice(start, end)
  assert.match(block, /switchPetHost/)
  assert.match(block, /switchActiveHost/)
  assert.doesNotMatch(block, /bindPetHost/)

  const connections = read('src/renderer/settings-window/domains/ConnectionsDomain.vue')
  assert.match(connections, /host-switch-grid/)
  assert.match(connections, /switchableHosts/)
  assert.match(connections, /requestModelAction\(\{ type: 'switch-host'/)
  assert.match(connections, /detectInstalledHosts/)
  assert.match(connections, /detectedHostIds/)
  assert.doesNotMatch(connections, /请从“关于与诊断”解除绑定/)
  assert.doesNotMatch(connections, /panel-hint">\s*这只桌宠同一时间只连接一个平台/)

  const quick = read('src/renderer/components/QuickSettingsPanel.vue')
  assert.match(quick, /getAdapterHosts/)
  assert.match(quick, /switchPetHost/)
  assert.match(quick, /detectInstalledHosts/)
  assert.match(quick, /detectedHostIds/)
  assert.doesNotMatch(quick, /这只桌宠一次只连接一个平台/)
})

test('onboarding does not recommend Codex and filters undetected hosts', () => {
  const source = read('src/renderer/settings-window/onboarding/OnboardingFlow.vue')
  assert.doesNotMatch(source, /推荐从 Codex 开始/)
  assert.doesNotMatch(source, /Codex 优先/)
  assert.doesNotMatch(source, /host\.recommended/)
  assert.match(source, /card\.host\.installed/)
  const card = read('src/renderer/settings-window/onboarding/HostStageCard.vue')
  assert.doesNotMatch(card, /推荐/)
  const main = read('src/main/host-onboarding.ts')
  assert.doesNotMatch(main, /recommended/)
  assert.doesNotMatch(read('src/shared/host-onboarding-contracts.ts'), /recommended/)
})
