'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')

test('companion panels fit the narrowest pet window instead of clipping', () => {
  for (const file of ['src/renderer/components/ChatBubble.vue', 'src/renderer/components/TodoBoard.vue']) {
    const source = read(file)
    assert.match(source, /max-width: calc\(100vw - 24px\)/, `${file} should cap its width to the viewport`)
  }
})

test('settings dialogs and secondary buttons share one surface style', () => {
  const app = read('src/renderer/settings-window/SettingsWindowApp.vue')
  const closePrompt = app.match(/\.close-prompt \{[\s\S]*?\}/)?.[0] ?? ''
  assert.match(closePrompt, /background: var\(--uta-surface\)/)
  assert.match(closePrompt, /border-radius: var\(--uta-radius-lg\)/)

  const secondary = app.match(/\.btn-secondary \{[\s\S]*?\}/)?.[0] ?? ''
  assert.match(secondary, /box-shadow: inset 0 0 0 1px var\(--uta-separator\)/)
  assert.match(app, /\.btn-secondary:hover:not\(:disabled\)/)

  const character = read('src/renderer/settings-window/domains/CharacterDomain.vue')
  assert.match(character, /\.model-draft-prompt \{\s*\n\s*width: min\(480px, 100%\);/)
})

test('keyboard focus is not doubled or hidden', () => {
  const toggle = read('src/renderer/components/settings-v2/SettingsToggle.vue')
  assert.doesNotMatch(toggle, /\.uta-toggle:focus-visible/)
  assert.doesNotMatch(toggle, /outline: none;/)

  const board = read('src/renderer/components/TodoBoard.vue')
  assert.match(board, /\.todo-board-add input:focus-visible \{ outline: 2px solid var\(--dp-accent-read\);/)
})

test('wide bubbles never slide under the right toolbar when a panel shifts the stage', () => {
  const stage = read('src/renderer/components/DeskpetStage.vue')
  assert.match(stage, /const PANEL_BUBBLE_RESERVE = 296/)
  assert.match(stage, /const QUICK_PANEL_BUBBLE_RESERVE = 316/)
  assert.match(stage, /const BUBBLE_GUTTER = 12 \+ 12 \+ 46 \+ 14/)
  assert.match(stage, /window\.innerWidth - reserve - BUBBLE_GUTTER/)
  assert.match(stage, /window\.innerWidth \/ 2 - bubbleWidth\.value \/ 2 - \(46 \+ 14\)/)
  assert.match(stage, /Math\.max\(62, bubbleFit\)/)
  const bubble = read('src/renderer/components/ChatBubble.vue')
  assert.match(bubble, /width: var\(--stage-bubble-width, 256px\);/)
  assert.match(bubble, /left: max\(var\(--stage-bubble-min-left, 8px\), min\(calc\(50% - var\(--stage-bubble-width, 256px\) \/ 2 \+ var\(--stage-bubble-shift-x, 0px\)\)/)
  assert.match(bubble, /max-width: 100%;\s*\n\s*padding: 9px 14px;/)
})

test('Escape inside todo fields cancels the field instead of closing the board', () => {
  const board = read('src/renderer/components/TodoBoard.vue')
  assert.match(board, /event\.defaultPrevented/)
  assert.match(board, /target\?\.matches\('input, textarea, select'\) \|\| target\?\.isContentEditable/)
  const daily = read('src/renderer/components/DailyTodoList.vue')
  assert.match(daily, /@keydown\.esc\.stop\.prevent="cancelTextEdit"/)
  assert.match(daily, /@keydown\.esc\.stop\.prevent="cancelReminder"/)
})

test('the quick input keeps its 12px margin in a 260px pet window', () => {
  const input = read('src/renderer/components/QuickInput.vue')
  assert.match(input, /left: max\(12px, calc\(50% - 160px \+ var\(--stage-shift-x, 0px\)\)\);/)
  assert.match(input, /max-width: calc\(100vw - 24px\);/)
})

test('onboarding actions stay reachable when the host list is long', () => {
  const css = read('src/renderer/settings-window/onboarding/onboarding.css')
  const actions = css.match(/\.onb-actions \{[\s\S]*?\}/)?.[0] ?? ''
  assert.match(actions, /position: sticky;/)
  assert.match(actions, /bottom: -28px;/)
  assert.match(actions, /background: var\(--uta-canvas\);/)
})

test('overlays keep right-click from reaching the stage emotion toggle', () => {
  const bubble = read('src/renderer/components/ChatBubble.vue')
  assert.match(bubble, /class="companion-window message-companion"[\s\S]*?@contextmenu\.stop\.prevent/)
  const approval = read('src/renderer/components/ApprovalCard.vue')
  assert.match(approval, /class="approval-card"[^>]*@contextmenu\.stop\.prevent/)
  const stage = read('src/renderer/components/DeskpetStage.vue')
  assert.match(stage, /class="reminder-card"[\s\S]*?@contextmenu\.stop\.prevent/)
})

test('Escape closes the message and todo overlays like the quick panel', () => {
  for (const file of [
    'src/renderer/components/ChatBubble.vue',
    'src/renderer/components/TodoBoard.vue',
    'src/renderer/components/QuickSettingsPanel.vue',
  ]) {
    const source = read(file)
    assert.match(source, /event\.key !== 'Escape'/, `${file} should handle Escape`)
    assert.match(source, /window\.addEventListener\('keydown', onKeydown\)/, `${file} should listen globally`)
    assert.match(source, /emit\('close'\)/, `${file} should close on Escape`)
  }
})

test('an incoming approval clears the side panels so the card stays clickable', () => {
  const stage = read('src/renderer/components/DeskpetStage.vue')
  assert.match(stage, /watch\(\s*\(\) => store\.currentApproval\?\.requestId \?\? ''/)
  assert.match(stage, /showSettings\.value = false\s*\n\s*chatPanelOpen\.value = false\s*\n\s*todoPanelOpen\.value = false\s*\n\s*showInput\.value = false/)
})

test('speech bubbles follow a dragged character but stay inside the window', () => {
  const stage = read('src/renderer/components/DeskpetStage.vue')
  assert.match(stage, /const bubbleShiftX = computed\(\(\) => stageShiftX\.value \+ store\.modelOffsetX\)/)
  assert.match(stage, /--stage-bubble-shift-x/)
  assert.match(stage, /--stage-bubble-min-left/)
  const bubble = read('src/renderer/components/ChatBubble.vue')
  assert.match(bubble, /max\(var\(--stage-bubble-min-left, 8px\), min\(calc\(50% - var\(--stage-bubble-width, 256px\) \/ 2 \+ var\(--stage-bubble-shift-x, 0px\)\)/)
  assert.match(bubble, /transition: left var\(--stage-bubble-ms, 560ms\) var\(--spring-gentle\);/)
})

test('the bubble left bound adapts when the window is narrower than panel plus bubble', () => {
  const stage = read('src/renderer/components/DeskpetStage.vue')
  assert.match(stage, /const roomForBubble = Math\.max\(8, window\.innerWidth - bubbleWidth\.value - 60 - 8\)/)
  assert.match(stage, /Math\.min\(besidePanel, roomForBubble\)/)
})

test('narrow windows reserve room for the toolbar when capping bubble width', () => {
  const bubble = read('src/renderer/components/ChatBubble.vue')
  assert.match(bubble, /max-width: calc\(100vw - 92px\);/)
})

test('approval cards wrap long tool names instead of scrolling sideways', () => {
  const card = read('src/renderer/components/ApprovalCard.vue')
  assert.match(card, /\.approval-question strong \{[^}]*overflow-wrap: anywhere;/)
  assert.match(card, /\.approval-tool-code \{[^}]*min-width: 0;/)
  assert.match(card, /\.approval-reason-text \{[^}]*overflow-wrap: anywhere;/)
  assert.match(card, /:title="approval\.toolName"/)
})

test('history search Escape clears the query and closing resets clear confirmation', () => {
  const bubble = read('src/renderer/components/ChatBubble.vue')
  assert.match(bubble, /@keydown\.esc\.stop\.prevent="onSearchEscape"/)
  assert.match(bubble, /if \(searchTerm\.value\) \{\r?\n\s+searchTerm\.value = ''/)
  assert.match(bubble, /if \(!open\) clearConfirm\.value = false/)
  assert.match(bubble, /target\?\.matches\('input, textarea, select'\) \|\| target\?\.isContentEditable/)
})

test('the Live2D error card also fits a 260px pet window', () => {
  const stage = read('src/renderer/components/DeskpetStage.vue')
  const rule = stage.match(/\.model-error \{[\s\S]*?\}/)?.[0] ?? ''
  assert.match(rule, /width: min\(340px, calc\(100vw - 32px\)\)/)
  assert.match(rule, /box-sizing: border-box/)
  assert.match(rule, /padding: 28px/)
  assert.match(stage, /\.model-error p \{[\s\S]*?overflow-wrap: anywhere;/)
})

test('keyboard users can reach hidden controls and dismiss transient cards', () => {
  const stage = read('src/renderer/components/DeskpetStage.vue')
  assert.match(stage, /\.btn-bar\.visible,\r?\n\.btn-bar:focus-within \{/)
  assert.match(stage, /class="btn-bar"[\s\S]{0,220}@dblclick\.stop/)
  assert.match(stage, /@keydown\.esc\.stop\.prevent="dismissReminder"/)
  assert.match(stage, /@focusin="pauseReminderTimer"/)
  assert.match(stage, /@focusout="resumeReminderTimer"/)
  assert.match(stage, /top: 52px;\r?\n  z-index: 72;/)

  const approval = read('src/renderer/components/ApprovalCard.vue')
  assert.match(approval, /role="alertdialog"/)
  assert.match(approval, /tabindex="-1"/)
  assert.match(approval, /function focusCard\(\)/)
  assert.match(approval, /cardRef\.value\?\.contains\(active\)/)

  const board = read('src/renderer/components/TodoBoard.vue')
  assert.match(board, /target\.blur\(\)/)
  assert.match(board, /第二次 Esc 再收起面板/)

  const about = read('src/renderer/settings-window/domains/AboutDomain.vue')
  assert.match(about, /v-if="confirmingUnbind"[\s\S]{0,180}>取消<\/button>/)

  const character = read('src/renderer/settings-window/domains/CharacterDomain.vue')
  assert.doesNotMatch(character, /role="listitem"/)
  assert.match(character, /:aria-current="store\.modelUrl === model\.url \? 'true' : undefined"/)
})

test('the model draft dialog keeps Tab inside and returns focus when cancelled', () => {
  const character = read('src/renderer/settings-window/domains/CharacterDomain.vue')
  assert.match(character, /ref="draftSwitchOverlayRef"/)
  assert.match(character, /function onDraftSwitchKeys/)
  assert.match(character, /!overlay\.contains\(active\)/)
  assert.match(character, /draftSwitchReturnFocus\?\.focus\?\.\(\)/)
  assert.match(character, /window\.addEventListener\?\.\('keydown', onDraftSwitchKeys\)/)
  assert.match(character, /window\.removeEventListener\?\.\('keydown', onDraftSwitchKeys\)/)

  const app = read('src/renderer/settings-window/SettingsWindowApp.vue')
  assert.match(app, /draftGuardReturnFocus\?\.focus\?\.\(\)/)
})

test('inactive character pages and replaced reminders do not keep hidden focus', () => {
  const character = read('src/renderer/settings-window/domains/CharacterDomain.vue')
  assert.match(character, /if \(!props\.active \|\| !draftSwitchOpen\.value\) return/)
  assert.match(character, /watch\(\s*\(\) => props\.active,/)
  assert.match(character, /if \(active \|\| !draftSwitchOpen\.value \|\| draftSwitchBusy\.value\) return/)

  const stage = read('src/renderer/components/DeskpetStage.vue')
  assert.match(stage, /document\.activeElement\?\.closest\('\.reminder-card'\)/)
})

test('a navigation event that arrives during mount is not overwritten by the URL domain', () => {
  const app = read('src/renderer/settings-window/SettingsWindowApp.vue')
  assert.match(app, /if \(!domainNavigationSeen\) \{/)
  assert.match(app, /domainNavigationSeen = true/)
})

test('button-style selectors use aria-pressed instead of incomplete listbox/tab semantics', () => {
  const files = [
    'src/renderer/components/QuickSettingsPanel.vue',
    'src/renderer/components/TodoBoard.vue',
    'src/renderer/settings-window/domains/ConnectionsDomain.vue',
    'src/renderer/settings-window/domains/VoiceDomain.vue',
    'src/renderer/settings-window/domains/CharacterDomain.vue',
  ]
  for (const file of files) {
    const source = read(file)
    assert.doesNotMatch(source, /role="(?:listbox|tablist|option|tab)"/, `${file} should not claim unsupported listbox/tab keyboard semantics`)
  }
  for (const file of [
    'src/renderer/components/QuickSettingsPanel.vue',
    'src/renderer/settings-window/domains/ConnectionsDomain.vue',
    'src/renderer/settings-window/domains/VoiceDomain.vue',
    'src/renderer/components/DailyTodoList.vue',
  ]) {
    assert.match(read(file), /:aria-pressed="/, `${file} should expose its selected state on buttons`)
  }
})

test('the approval card keeps Tab inside its decision buttons', () => {
  const approval = read('src/renderer/components/ApprovalCard.vue')
  assert.match(approval, /event\.key !== 'Tab'/)
  assert.match(approval, /querySelectorAll<HTMLButtonElement>\('button:not\(\[disabled\]\)'\)/)
  assert.match(approval, /event\.shiftKey \? -1 : 1/)
})

test('the onboarding host step explains why its primary action is unavailable', () => {
  const flow = read('src/renderer/settings-window/onboarding/OnboardingFlow.vue')
  assert.match(flow, /const hostPrimaryLabel = computed/)
  assert.match(flow, /'正在检测宿主…'/)
  assert.match(flow, /'请选择或跳过宿主'/)
  assert.match(flow, /\{\{ hostPrimaryLabel \}\}/)
  assert.doesNotMatch(flow, /\{\{ primaryActionLabel\('host', reentry\) \}\}/)
})

test('settings acknowledges an applied domain so delayed navigation stops', () => {
  const app = read('src/renderer/settings-window/SettingsWindowApp.vue')
  assert.match(app, /domainNavigationSeen = true/)
  assert.match(app, /acknowledgeDomain\?\.\(domain\)/)
})

test('restoring default presets requires a second click before deleting custom presets', () => {
  const tab = read('src/renderer/components/SettingsStatesTab.vue')
  assert.match(tab, /useConfirmAction/)
  assert.match(tab, /function requestRestoreDefaults\(\)/)
  assert.match(tab, /armRestore\('restore-defaults'\)/)
  assert.match(tab, /确认恢复？/)
})

test('preset import explains that same-name presets are replaced', () => {
  const character = read('src/renderer/settings-window/domains/CharacterDomain.vue')
  assert.match(character, /导入时同名预设会被覆盖/)
})

test('deleting a preset also requires a second click', () => {
  const tab = read('src/renderer/components/SettingsStatesTab.vue')
  assert.match(tab, /const \{ armed: confirmDelete/)
  assert.match(tab, /function requestDeletePreset/)
  assert.match(tab, /armDelete\(`delete-\$\{presetId\}`\)/)
  assert.match(tab, /确认删除？/)
})

test('reminder actions fail visibly and recording stays reachable under an approval', () => {
  const stage = read('src/renderer/components/DeskpetStage.vue')
  assert.match(stage, /class="reminder-card-error" role="alert"/)
  assert.match(stage, /keepReminderAfterFailure/)
  assert.match(stage, /window\.addEventListener\('keydown', onReminderKeydown\)/)
  assert.match(stage, /target\?\.closest\('input, textarea, select, \[contenteditable="true"\]'\)/)
  assert.match(stage, /:class="\{ 'is-over-approval': !!store\.currentApproval \}"/)
  assert.match(stage, /\.voice-input-pill\.is-over-approval \{\s*top: 12px;\s*bottom: auto;\s*z-index: 83;/)
  assert.match(stage, /:disabled="reminderBusy"/)
})

test('failed instant saves offer a real retry and revert the summon switch', () => {
  const tts = read('src/renderer/components/TtsSettingsSection.vue')
  assert.match(tts, /@click="persistCloudConfigSilently\(\)"/)
  assert.doesNotMatch(tts, /请点击“保存密钥”重试/)
  const connections = read('src/renderer/settings-window/domains/ConnectionsDomain.vue')
  assert.match(connections, /const result = await window\.utaAPI\?\.setSummonOnHostStart\?\.\(enabled\)/)
  assert.match(connections, /summonOnHostStart\.value = previous/)
  const main = read('src/main/index.ts')
  assert.match(main, /if \(!saveWindowState\(\)\) \{[\s\S]{0,80}summonOnHostStart = previous/)
})

test('todo read failures explain the lock and offer error defense', () => {
  const board = read('src/renderer/components/TodoBoard.vue')
  assert.match(board, /<DailyTodoList compact \/>/)
  const list = read('src/renderer/components/DailyTodoList.vue')
  assert.match(list, /待办文件无法读取，已停止写入/)
  assert.match(list, /addReminderOn\.value && remindAt === null/)
  assert.match(list, /请选择提醒时间/)
})

test('an incomplete custom accent is marked and keeps the last usable swatch', () => {
  const appearance = read('src/renderer/settings-window/domains/AppearanceDomain.vue')
  assert.match(appearance, /backgroundColor: accentPreview/)
  assert.match(appearance, /:aria-invalid="accentInvalid \? 'true' : undefined"/)
  assert.match(appearance, /颜色需为完整的 #RRGGBB/)
  assert.match(appearance, /\.custom-color-input-wrap\.is-invalid \{/)
})

test('connection status names the local endpoint and expired session locks honestly', () => {
  const connections = read('src/renderer/settings-window/domains/ConnectionsDomain.vue')
  assert.match(connections, /本机消息端点/)
  assert.match(connections, /if \(selectionExpired\.value\) return '锁定的会话已失效'/)
  assert.match(connections, /!selectedSessionId && !selectionExpired/)
  assert.match(connections, /锁定的会话已不在列表/)
  const main = read('src/main/index.ts')
  assert.match(main, /resolveHostSessionSelection\(sessions\.map/)
})

test('an unsent pet draft survives the reload used by host switching', () => {
  const stage = read('src/renderer/components/DeskpetStage.vue')
  assert.match(stage, /const INPUT_DRAFT_KEY = 'uta\/pet-input-draft'/)
  assert.match(stage, /sessionStorage\.getItem\(INPUT_DRAFT_KEY\)/)
  assert.match(stage, /sessionStorage\.setItem\(INPUT_DRAFT_KEY, value\)/)
  assert.match(stage, /sessionStorage\.removeItem\(INPUT_DRAFT_KEY\)/)
})

test('an invalid accent keeps the last valid swatch, not the default blue', () => {
  const appearance = read('src/renderer/settings-window/domains/AppearanceDomain.vue')
  assert.match(appearance, /const lastValidAccent = ref\(safeHex\(props\.draft\.accentColor\)\)/)
  assert.match(appearance, /if \(\/\^#\[0-9a-fA-F\]\{6\}\$\/\.test\(value\)\) lastValidAccent\.value = value/)
  assert.match(appearance, /const accentPreview = computed\(\(\) => accentInvalid\.value \? lastValidAccent\.value : props\.draft\.accentColor\)/)
  assert.match(appearance, /backgroundColor: accentPreview/)
})

test('first-run onboarding says how to reopen it after exiting', () => {
  const onboarding = read('src/renderer/settings-window/onboarding/OnboardingFlow.vue')
  assert.match(onboarding, /之后可在“关于与诊断”里重新打开引导/)
  assert.match(onboarding, /reentry \? '可以随时返回设置'/)
})
