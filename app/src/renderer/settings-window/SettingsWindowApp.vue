<template>
  <div
    class="uta-settings-window-app"
    :data-theme="currentTheme"
    :data-layout="layoutMode"
  >
    <WindowTitleBar
      :title="onboardingActive ? 'Uta · 初次见面' : 'Uta 设置'"
      :inert="promptOpen || draftGuardOpen || undefined"
    />

    <OnboardingFlow
      v-if="onboardingActive"
      :draft="draft"
      :reentry="onboardingReentry"
      :busy="onboardingBusy"
      :finish-error="onboardingError"
      :bound-host-id="boundHostId"
      :inert="promptOpen || draftGuardOpen || undefined"
      @update="updateDraft"
      @finish="finishOnboarding"
      @close="exitOnboarding"
      @open-settings="openSettingsFromOnboarding"
    />

    <template v-else>
    <header class="window-action-bar" :inert="promptOpen || draftGuardOpen || undefined">
      <div class="header-meta">
        <span class="save-scope">改动会自动保存到本机</span>
        <span v-if="hasUnsavedSecretDraft" class="dirty-chip is-secret">有未保存的密钥</span>
        <span v-if="hasUnsavedWorkshopDraft" class="dirty-chip is-secret">有未保存的草稿</span>
      </div>

      <div class="header-actions">
        <span v-if="saveStatus === 'saving'" class="status-indicator is-saving">
          <span class="spinner" aria-hidden="true" /> 正在保存到本机…
        </span>
        <span v-else-if="saveStatus === 'success'" class="status-indicator is-success">
          <span class="status-dot is-on" aria-hidden="true" />
          已自动保存
        </span>
        <button
          v-else-if="saveStatus === 'error'"
          type="button"
          class="status-indicator is-error status-retry"
          :title="errorMessage"
          @click="retrySettingsSave"
        >
          <span class="status-dot" aria-hidden="true" />
          {{ errorMessage || '保存失败' }} · 点击重试
        </button>
      </div>
    </header>

    <div class="window-body" :inert="promptOpen || draftGuardOpen || undefined">
      <SettingsNavigation
        :environment-label="profileName"
        :active-domain="activeDomain"
        :theme="currentTheme"
        @update:active-domain="value => activeDomain = value"
        @update:theme="setTheme"
      />

      <main ref="settingsCanvas" class="settings-content-canvas">
        <SettingsBanner v-if="closeGuardError" variant="warning" title="关闭提醒不可用">
          {{ closeGuardError }}
        </SettingsBanner>

        <header :key="activeDomain" class="page-header page-enter">
          <h2 class="page-title">{{ domainMeta.title }}</h2>
          <p class="page-subtitle">{{ domainMeta.subtitle }}</p>
        </header>

        <CharacterDomain
          v-if="characterVisited"
          :hidden="activeDomain !== 'character'"
          :active="activeDomain === 'character'"
        />
        <ConnectionsDomain v-if="activeDomain === 'connections'" />
        <TodoDomain v-if="activeDomain === 'todo'" />
        <VoiceDomain
          v-if="voiceVisited"
          :hidden="activeDomain !== 'voice'"
          :draft="draft"
          @update="updateDraft"
        />
        <DesktopDomain
          v-if="activeDomain === 'desktop'"
          :draft="draft"
          :click-through="clickThrough"
          :click-through-busy="clickThroughBusy"
          :click-through-supported="clickThroughSupported"
          :voice-shortcut="voiceShortcut"
          :display-mode="settingsDisplayMode"
          @update="updateDraft"
          @toggle-click-through="value => void setClickThrough(value)"
        />
        <AppearanceDomain
          v-if="activeDomain === 'appearance'"
          :draft="draft"
          :render-fps="renderFps"
          :adaptive-idle="adaptiveIdle"
          :display-hz="displayHz"
          :performance-pending="performancePending"
          :performance-error="performanceError"
          @update="updateDraft"
          @set-render-fps="setRenderFps"
          @toggle-adaptive-idle="toggleAdaptiveIdle"
          @retry-performance="persistPerformancePreferences"
          @reload-pet="reloadPetWindow"
        />
        <AboutDomain
          v-if="activeDomain === 'about'"
          @reopen-onboarding="reopenOnboarding"
          :profile-name="profileName"
          :profile-identifier="profileIdentifier"
          :current-revision="currentRevision"
          :saving="saveStatus === 'saving'"
          :bound-host-name="boundHostName"
          :unbind-busy="unbindBusy"
          :unbind-message="unbindMessage"
          @unbind-host="unbindHost"
        />
      </main>
    </div>
    </template>

    <div v-if="promptOpen" class="close-prompt-overlay">
      <section
        ref="closePrompt"
        class="close-prompt"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="close-prompt-title"
        aria-describedby="close-prompt-description"
        @keydown.esc.stop.prevent="continueEditing"
        @keydown.tab.prevent="cycleCloseFocus"
      >
        <h2 id="close-prompt-title">{{ closeTitle }}</h2>
        <p id="close-prompt-description">{{ closeDescription }}</p>
        <p v-if="saveStatus === 'saving'" role="status">正在保存设置，请稍候。</p>
        <p v-if="closeError" class="close-prompt-error" role="alert">{{ closeError }}</p>
        <div class="close-prompt-actions">
          <button ref="continueButton" type="button" class="uta-btn btn-secondary" :disabled="replying" @click="continueEditing">继续编辑</button>
          <button type="button" class="uta-btn btn-secondary" :disabled="closeBusy" @click="discardAndClose">放弃并关闭</button>
          <button type="button" class="uta-btn btn-primary" :disabled="closeBusy" @click="saveAndClose">{{ closeBusy ? '正在处理…' : draftLabels.length ? '保存草稿并关闭' : '重试并关闭' }}</button>
        </div>
      </section>
    </div>
    <div v-if="draftGuardOpen" class="close-prompt-overlay">
      <section
        ref="draftGuardRef"
        class="close-prompt"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="draft-guard-title"
        aria-describedby="draft-guard-description"
        @keydown.esc.stop.prevent="cancelDraftGuard"
        @keydown.tab.prevent="cycleDraftGuardFocus"
      >
        <h2 id="draft-guard-title">进入首次引导前保存草稿？</h2>
        <p id="draft-guard-description">
          有未保存的{{ draftLabels.join('、') }}。进入首次引导会卸载当前设置分区，未保存的草稿和撤销历史会丢失。
        </p>
        <p v-if="draftGuardError" class="close-prompt-error" role="alert">{{ draftGuardError }}</p>
        <div class="close-prompt-actions">
          <button type="button" class="uta-btn btn-secondary" :disabled="draftGuardBusy" @click="cancelDraftGuard">继续编辑</button>
          <button type="button" class="uta-btn btn-secondary" :disabled="draftGuardBusy" @click="discardDraftsAndContinue">放弃草稿并进入</button>
          <button ref="draftGuardSaveRef" type="button" class="uta-btn btn-primary" :disabled="draftGuardBusy" @click="saveDraftsAndContinue">
            {{ draftGuardBusy ? '正在保存…' : '保存草稿并进入' }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { loadEnvironmentLabel } from '../services/environment-label'
import { settingsClient } from '../services/settings-client'
import { useDeskpetStore } from '@/stores/deskpet'
import { useSettingsDraft } from './use-settings-draft'
import { useSettingsClose } from './use-settings-close'
import {
  DEFAULT_SETTINGS_DOMAIN,
  isSettingsDomain,
  resolveSettingsDomain,
  settingsDomainDefinition,
  type SettingsDomainId,
} from './settings-domains'
import { useClickThrough } from './use-click-through'
import {
  readAdaptiveIdle,
  readRenderFpsMode,
  writeAdaptiveIdle,
  writeRenderFpsMode,
  type RenderFpsMode,
} from './render-performance'
import { resolveLayoutMode, type SettingsLayoutMode } from './layout-mode'
import { hasUnsavedSecretDraft, hasUnsavedWorkshopDraft, hasUnsavedDraft, saveUnsavedDrafts } from '../services/unsaved-drafts'
import { kindOfModelUrl } from '@/services/live2d/model-discovery'
import { findHost } from '../services/adapters/index'
import { accentHoverBackground, hexChannels, normalizeHex, readableInk } from '../services/color-contrast'

import '../components/settings-v2/tokens.css'
import './settings-center.css'
import WindowTitleBar from './WindowTitleBar.vue'
import OnboardingFlow from './onboarding/OnboardingFlow.vue'
import SettingsNavigation from '../components/settings-v2/SettingsNavigation.vue'
import SettingsBanner from '../components/settings-v2/SettingsBanner.vue'
import CharacterDomain from './domains/CharacterDomain.vue'
import ConnectionsDomain from './domains/ConnectionsDomain.vue'
import TodoDomain from './domains/TodoDomain.vue'
import VoiceDomain from './domains/VoiceDomain.vue'
import DesktopDomain from './domains/DesktopDomain.vue'
import AppearanceDomain from './domains/AppearanceDomain.vue'
import AboutDomain from './domains/AboutDomain.vue'
import type { PublicSettings } from '../../shared/settings-contracts'
import '../components/styles/settings-panel.css'

const activeDomain = ref<SettingsDomainId>(DEFAULT_SETTINGS_DOMAIN)
const domainMeta = computed(() => settingsDomainDefinition(activeDomain.value))
const settingsCanvas = ref<HTMLElement | null>(null)
watch(activeDomain, async () => {
  await nextTick()
  if (settingsCanvas.value) {
    settingsCanvas.value.scrollTop = 0
    settingsCanvas.value.scrollLeft = 0
  }
})
// Keep pages with their own drafts alive after the first visit so typed keys
// and workshop edits survive navigation and stay visible to the close guard.
const voiceVisited = ref(activeDomain.value === 'voice')
const characterVisited = ref(activeDomain.value === 'character')
watch(activeDomain, value => {
  if (value === 'voice') voiceVisited.value = true
  if (value === 'character') characterVisited.value = true
})

const profileName = ref('正在确认环境…'), profileIdentifier = ref<string | null>(null)
let disposed = false
let unsubscribePetBinding: (() => void) | null = null
let unsubscribeNavigateDomain: (() => void) | null = null
let domainNavigationSeen = false
onUnmounted(() => { disposed = true })
const draftState = useSettingsDraft(settingsClient)
const {
  draft, currentRevision, saveStatus, errorMessage,
  applyInstant, flushPending, hasPending, retryNow,
} = draftState
const {
  promptOpen, closeReason, closeBusy, replying, closeError, closeGuardError, draftLabels,
  saveAndClose, discardAndClose, continueEditing,
} = useSettingsClose(draftState, window.utaAPI?.settingsWindow)

const onboardingActive = ref(new URLSearchParams(window.location.search).get('onboarding') === '1')
const onboardingReentry = ref(false)
const onboardingBusy = ref(false)
const onboardingError = ref('')
const settingsStore = useDeskpetStore()
const settingsDisplayMode = computed<'live2d' | 'image-set'>(() =>
  settingsStore.modelUrl ? kindOfModelUrl(settingsStore.modelUrl) : 'live2d',
)
const boundHostId = ref<string>(window.utaAPI?.petBinding?.binding?.hostId ?? '')
const boundHostName = computed(() => {
  if (!boundHostId.value) return ''
  return findHost(boundHostId.value as never)?.label ?? boundHostId.value
})
const unbindBusy = ref(false)
const unbindMessage = ref('')

async function unbindHost(): Promise<void> {
  if (unbindBusy.value) return
  const api = window.utaAPI
  if (!api?.unbindPetHost) {
    unbindMessage.value = '当前版本没有提供解除绑定接口，请重新启动 Uta 后再试。'
    return
  }
  unbindBusy.value = true
  unbindMessage.value = ''
  try {
    const result = await api.unbindPetHost()
    if (!result?.ok) {
      unbindMessage.value = result?.error === 'write-failed'
        ? '无法写入解除绑定状态，请检查本机数据目录权限。'
        : '解除绑定失败，请重试。'
      return
    }
    boundHostId.value = ''
    unbindMessage.value = '已解除绑定。桌宠会回到独立待机；重新打开首次引导即可绑定另一个宿主。'
    await api.reloadWindow?.()
  } catch {
    unbindMessage.value = '解除绑定失败，请重试。'
  } finally {
    unbindBusy.value = false
  }
}

function clearOnboardingParam(): void {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('onboarding')) return
    url.searchParams.delete('onboarding')
    window.history.replaceState({}, '', url.toString())
  } catch {
    /* file URLs still support URLSearchParams; a failure must not block the guide */
  }
}

function exitOnboarding(): void {
  onboardingActive.value = false
  onboardingReentry.value = false
  onboardingBusy.value = false
  onboardingError.value = ''
  clearOnboardingParam()
}

async function applyOnboardingSelections(hostId: string): Promise<boolean> {
  const preference = hostId
  if (preference && preference !== 'skipped') {
    try {
      const switched = await settingsStore.requestModelAction({
        type: 'switch-host',
        preference,
      })
      if (!switched?.ok) {
        onboardingError.value = boundHostId.value && preference !== boundHostId.value
          ? '目标宿主当前不可用，无法切换。请确认插件或程序已就绪，或到“连接与会话”里切换。'
          : '桌宠没有绑定到所选宿主。请确认桌宠仍在运行，或先进入设置检查连接。'
        return false
      }
      if (preference !== 'standalone') boundHostId.value = preference
    } catch {
      onboardingError.value = '桌宠没有绑定到所选宿主。请确认桌宠仍在运行，或先进入设置检查连接。'
      return false
    }
  }
  await flushPending()
  if (saveStatus.value === 'error' || hasPending()) {
    onboardingError.value = errorMessage.value || '偏好设置没有保存成功，请重试。'
    return false
  }
  return true
}

async function markOnboardingComplete(hostId: string): Promise<boolean> {
  const complete = window.utaAPI?.completeOnboarding
  if (!complete) return true
  if (await complete(hostId)) return true
  onboardingError.value = '没有记录下引导完成状态。请检查数据目录权限后重试。'
  return false
}

async function finishOnboarding(hostId: string): Promise<void> {
  if (onboardingBusy.value) return
  onboardingBusy.value = true
  onboardingError.value = ''
  try {
    if (!(await applyOnboardingSelections(hostId))) return
    if (!(await markOnboardingComplete(hostId))) return
    onboardingActive.value = false
    clearOnboardingParam()
    if (onboardingReentry.value) {
      onboardingReentry.value = false
      return
    }
    const closed = await window.utaAPI?.controlWindow?.('close')
    if (closed && !closed.ok) {
      onboardingActive.value = true
      onboardingError.value = '暂时无法关闭设置窗口，请重试或使用标题栏关闭。'
    }
  } finally {
    onboardingBusy.value = false
  }
}

async function openSettingsFromOnboarding(domain?: string, hostId = 'skipped'): Promise<void> {
  if (onboardingBusy.value) return
  onboardingBusy.value = true
  onboardingError.value = ''
  try {
    // Leaving for detailed voice setup still applies and records the choices
    // made so far; About → 重新打开首次引导 remains available.
    if (!(await applyOnboardingSelections(hostId))) return
    if (!(await markOnboardingComplete(hostId))) return
    onboardingActive.value = false
    onboardingReentry.value = false
    clearOnboardingParam()
    if (isSettingsDomain(domain)) activeDomain.value = domain
  } finally {
    onboardingBusy.value = false
  }
}

function enterOnboarding(): void {
  onboardingReentry.value = true
  onboardingActive.value = true
}

const draftGuardOpen = ref(false)
const draftGuardBusy = ref(false)
const draftGuardError = ref('')
const draftGuardRef = ref<HTMLElement | null>(null)
const draftGuardSaveRef = ref<HTMLButtonElement | null>(null)
let draftGuardAction: (() => void) | null = null
let draftGuardReturnFocus: HTMLElement | null = null

function closeDraftGuard(): void {
  draftGuardOpen.value = false
  draftGuardBusy.value = false
  draftGuardError.value = ''
  draftGuardAction = null
}

function reopenOnboarding(): void {
  if (!hasUnsavedDraft.value) {
    enterOnboarding()
    return
  }
  draftGuardError.value = ''
  draftGuardAction = enterOnboarding
  draftGuardReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  draftGuardOpen.value = true
  void nextTick(() => draftGuardSaveRef.value?.focus())
}

async function saveDraftsAndContinue(): Promise<void> {
  if (draftGuardBusy.value) return
  draftGuardBusy.value = true
  draftGuardError.value = ''
  try {
    const result = await saveUnsavedDrafts()
    if (!result.ok) {
      draftGuardError.value = `未能保存${result.failed.join('、')}，请重试或放弃后进入引导。`
      return
    }
    const action = draftGuardAction
    closeDraftGuard()
    action?.()
  } finally {
    if (draftGuardOpen.value) draftGuardBusy.value = false
  }
}

function discardDraftsAndContinue(): void {
  if (draftGuardBusy.value) return
  const action = draftGuardAction
  closeDraftGuard()
  action?.()
}

function cancelDraftGuard(): void {
  if (draftGuardBusy.value) return
  closeDraftGuard()
  void nextTick(() => draftGuardReturnFocus?.focus?.())
}

function cycleDraftGuardFocus(event: KeyboardEvent): void {
  const buttons = [...(draftGuardRef.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
  if (!buttons.length) return
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length
  buttons[next]?.focus()
}
const closeTitle = computed(() => {
  const hasDrafts = draftLabels.value.length > 0
  if (closeReason.value === 'quit') return hasDrafts ? '退出 Uta 前保存草稿？' : '退出 Uta 前重试保存？'
  return hasDrafts ? '关闭设置前保存草稿？' : '关闭设置前重试保存？'
})
const closeDescription = computed(() => {
  const drafts = draftLabels.value
  if (drafts.length) {
    return `有未保存的${drafts.join('、')}。你可以保存草稿后关闭、放弃这些更改，或继续编辑。`
  }
  return errorMessage.value || '设置未能保存到本机。你可以继续编辑后重试，或放弃更改并关闭。'
})
const closePrompt = ref<HTMLElement | null>(null)
const continueButton = ref<HTMLButtonElement | null>(null)
let previousFocus: HTMLElement | null = null
watch(promptOpen, async open => {
  if (open) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    if (promptOpen.value) continueButton.value?.focus()
  } else {
    previousFocus?.focus()
    previousFocus = null
  }
})

function cycleCloseFocus(event: KeyboardEvent): void {
  const buttons = [...(closePrompt.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
  if (!buttons.length) return
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length
  buttons[next]?.focus()
}

const currentTheme = computed(() => draft.value.themeMode)

function setTheme(theme: 'light' | 'dark'): void {
  if (draft.value.themeMode === theme) return
  updateDraft({ themeMode: theme })
}

// Sliders and the colour picker emit continuously; discrete choices save at once.
const CONTINUOUS_SETTINGS: Partial<Record<keyof PublicSettings, number>> = {
  chatDisplayName: 220,
  accentColor: 180,
  ttsRate: 220,
  ttsVolume: 220,
}

function updateDraft(patch: Partial<PublicSettings>): void {
  Object.assign(draft.value, patch)
  const request: Partial<PublicSettings> = { ...patch }
  if ('accentColor' in request) {
    const normalized = normalizeHex(String(request.accentColor))
    if (!normalized) delete request.accentColor
    else request.accentColor = normalized
  }
  const present = Object.keys(request) as (keyof PublicSettings)[]
  if (present.length === 0) return
  const delay = Math.max(0, ...present.map(key => CONTINUOUS_SETTINGS[key] ?? 0))
  applyInstant(request, delay)
}

function retrySettingsSave(): void {
  void retryNow()
}

watch(() => draft.value.themeMode, value => {
  document.documentElement.setAttribute('data-theme', value)
  applyAccentPreview(draft.value.accentColor)
}, { immediate: true })

function normalizeAccent(value: string): string | null {
  return normalizeHex(value)
}

function applyAccentPreview(value: string): void {
  const accent = normalizeAccent(value)
  if (!accent) return
  const root = document.documentElement.style
  if (!root) return
  const [r, g, b] = hexChannels(accent)
  const ink = readableInk(accent)
  const hover = accentHoverBackground(accent, ink)
  root.setProperty('--uta-accent', accent)
  root.setProperty('--uta-accent-rgb', `${r}, ${g}, ${b}`)
  root.setProperty('--uta-accent-text', ink)
  root.setProperty('--uta-accent-hover', hover)
  root.setProperty('--uta-accent-strong', hover)
  root.setProperty('--uta-action', accent)
  root.setProperty('--uta-action-text', ink)
  root.setProperty('--uta-action-hover', hover)
  root.setProperty('--uta-focus', accent)
  root.setProperty('--uta-accent-soft', `rgba(${r}, ${g}, ${b}, 0.22)`)
  root.setProperty('--uta-focus-ring', `rgba(${r}, ${g}, ${b}, 0.36)`)

  // The legacy panel and workshop share the same accent tokens
  root.setProperty('--dp-accent', accent)
  root.setProperty('--dp-accent-rgb', `${r}, ${g}, ${b}`)
  root.setProperty('--dp-accent-vivid', accent)
  root.setProperty('--dp-accent-text', ink)
  root.setProperty('--dp-accent-hover', hover)
  root.setProperty('--dp-accent-soft', `rgba(${r}, ${g}, ${b}, 0.22)`)
  root.setProperty('--dp-accent-fill', `rgba(${r}, ${g}, ${b}, 0.32)`)
  root.setProperty('--dp-accent-border', `rgba(${r}, ${g}, ${b}, 0.48)`)
  root.setProperty('--dp-accent-glow', `rgba(${r}, ${g}, ${b}, 0.34)`)
}

watch(() => draft.value.accentColor, applyAccentPreview, { immediate: true })

const { locked: clickThrough, busy: clickThroughBusy, supported: clickThroughSupported, setLocked: setClickThrough } = useClickThrough()

const renderFps = ref<RenderFpsMode>(readRenderFpsMode())
const adaptiveIdle = ref(readAdaptiveIdle())
const displayHz = ref<number | null>(null)
const performancePending = ref(false)
const performanceError = ref('')
const voiceShortcut = ref('')

function persistPerformancePreferences(): void {
  const fpsSaved = writeRenderFpsMode(renderFps.value)
  const idleSaved = writeAdaptiveIdle(adaptiveIdle.value)
  if (fpsSaved && idleSaved) {
    performanceError.value = ''
    performancePending.value = true
  } else {
    performancePending.value = false
    performanceError.value = '刷新率偏好未能保存到本机，请检查可用存储后重试。'
  }
}

function setRenderFps(mode: RenderFpsMode): void {
  renderFps.value = mode
  persistPerformancePreferences()
  if (mode === 'auto') void refreshDisplayHz()
}

function toggleAdaptiveIdle(value: boolean): void {
  adaptiveIdle.value = value
  persistPerformancePreferences()
}

async function reloadPetWindow(): Promise<void> {
  performanceError.value = ''
  try {
    await window.utaAPI?.reloadWindow?.()
    performancePending.value = false
  } catch {
    performanceError.value = '桌宠窗口未能重新加载，请稍后再试。'
  }
}

async function refreshDisplayHz(): Promise<void> {
  try {
    displayHz.value = await window.utaAPI?.getDisplayRefreshRate?.() ?? null
  } catch {
    displayHz.value = null
  }
}

async function loadUiDetails(): Promise<void> {
  try {
    const state = await window.utaAPI?.getUiState?.()
    voiceShortcut.value = state?.voiceShortcut
      ? String(state.voiceShortcut).replace('CommandOrControl', 'Ctrl')
      : ''
  } catch {
    voiceShortcut.value = ''
  }
}

const layoutMode = ref<SettingsLayoutMode>('wide')
function updateLayoutMode(): void {
  const width = typeof window !== 'undefined' && Number.isFinite(window.innerWidth) ? window.innerWidth : 960
  layoutMode.value = resolveLayoutMode(width)
}

onMounted(() => {
  updateLayoutMode()
  window.addEventListener?.('resize', updateLayoutMode)
  void loadEnvironmentLabel(window.utaAPI).then(environment => {
    if (!disposed) { profileName.value = environment.label; profileIdentifier.value = environment.identifier }
  })
  if (!domainNavigationSeen) {
    const domain = new URLSearchParams(window.location.search).get('domain')
    activeDomain.value = resolveSettingsDomain(domain)
  }
  void window.utaAPI?.getPetBinding?.().then(result => {
    if (!disposed) boundHostId.value = result?.binding?.hostId ?? ''
  }).catch(() => {})
  unsubscribePetBinding = window.utaAPI?.onPetBindingChanged?.((payload) => {
    if (!disposed) boundHostId.value = payload?.binding?.hostId ?? ''
  }) ?? null
  unsubscribeNavigateDomain = window.utaAPI?.settingsWindow?.onNavigateDomain?.((domain) => {
    domainNavigationSeen = true
    if (disposed) return
    activeDomain.value = resolveSettingsDomain(domain)
    window.utaAPI?.settingsWindow?.acknowledgeDomain?.(domain)
  }) ?? null
  void refreshDisplayHz()
  void loadUiDetails()
})

onUnmounted(() => {
  window.removeEventListener?.('resize', updateLayoutMode)
  unsubscribePetBinding?.()
  unsubscribePetBinding = null
  unsubscribeNavigateDomain?.()
  unsubscribeNavigateDomain = null
})
</script>

<style scoped>
.close-prompt-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(0 0 0 / 32%);
}
.close-prompt {
  width: min(100%, 480px);
  box-sizing: border-box;
  padding: 24px;
  border: 1px solid var(--uta-separator);
  border-radius: var(--uta-radius-lg);
  background: var(--uta-surface);
  color: var(--uta-ink);
  box-shadow: var(--uta-shadow-hover);
}
.close-prompt h2 { margin: 0 0 12px; font-size: 20px; }
.close-prompt p { line-height: 1.6; }
.close-prompt-error { color: var(--uta-error, #b42318); }
.close-prompt-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; margin-top: 24px; }

.page-enter { animation: page-enter 360ms var(--uta-ease-out, cubic-bezier(0.22, 1, 0.36, 1)) both; }
@keyframes page-enter {
  from { opacity: 0; transform: translateY(7px); }
  to { opacity: 1; transform: translateY(0); }
}

.uta-settings-window-app {
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
  --spring-gentle: cubic-bezier(0.2, 0.9, 0.3, 1);
  --uta-danger: var(--uta-error);
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  background-color: var(--uta-canvas);
  color: var(--uta-ink);
  font-family: var(--uta-font-sans);
  overflow: hidden;
  user-select: none;
  transition:
    background-color 0.28s ease,
    color 0.28s ease;
}

.window-action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  padding: 8px 18px;
  box-sizing: border-box;
  flex-wrap: wrap;
  gap: 8px 16px;
  background-color: var(--uta-surface);
  border-bottom: 1px solid var(--uta-separator);
  flex-shrink: 0;
  -webkit-app-region: drag;
  transition:
    background-color 0.28s ease,
    border-color 0.28s ease;
}

.window-action-bar button,
.window-action-bar input,
.window-action-bar .status-retry,
.window-action-bar .dirty-chip {
  -webkit-app-region: no-drag;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  flex-wrap: wrap;
}

.app-badge {
  white-space: nowrap;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--uta-ink);
}

.save-scope {
  padding: 3px 9px;
  border-radius: 999px;
  background-color: var(--uta-canvas);
  color: var(--uta-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.dirty-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background-color: var(--uta-warning-bg);
  color: var(--uta-warning);
  font-size: 11px;
  font-weight: 600;
}

.dirty-chip.is-secret {
  background-color: var(--uta-accent-soft);
  color: var(--uta-accent-read);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.status-indicator.is-saving { color: var(--uta-accent); }
.status-indicator.is-success { color: var(--uta-success); font-weight: 600; }
.status-indicator.is-error { color: var(--uta-error); font-weight: 600; }
.status-retry {
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.status-retry:hover { text-decoration: underline; }

.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--uta-accent);
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.uta-btn {
  min-height: 36px;
  white-space: nowrap;
  flex-shrink: 0;
  padding: 0 14px;
  border-radius: 9px;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color var(--uta-transition-fast),
    opacity var(--uta-transition-fast),
    transform var(--uta-transition-fast),
    box-shadow var(--uta-transition-fast);
  border: none;
}

.uta-btn:not(:disabled):active {
  transform: scale(0.96);
}

.btn-secondary {
  background-color: var(--uta-surface);
  color: var(--uta-ink);
  box-shadow: inset 0 0 0 1px var(--uta-separator);
}
.btn-secondary:hover:not(:disabled) {
  background-color: var(--uta-surface-subtle);
}
.btn-secondary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-primary {
  background-color: var(--uta-accent);
  color: var(--uta-accent-text);
}
.btn-primary:hover:not(:disabled) {
  background-color: var(--uta-accent-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px -2px var(--uta-focus-ring);
}
.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.window-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  min-height: 0;
  -webkit-app-region: initial !important;
}

.window-body * {
  -webkit-app-region: initial;
}

.settings-content-canvas {
  flex: 1;
  overflow-y: auto;
  padding: 26px 34px 40px;
  min-width: 0;
  min-height: 0;
  overflow-wrap: anywhere;
  transition:
    background-color 0.28s ease,
    color 0.28s ease;
}

.page-header {
  margin-bottom: 20px;
  max-width: 760px;
}

.page-title {
  margin: 0 0 5px;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.025em;
  color: var(--uta-ink);
}

.page-subtitle {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--uta-secondary);
}

.uta-settings-window-app :deep(button:focus-visible),
.uta-settings-window-app :deep(input:focus-visible),
.uta-settings-window-app :deep(select:focus-visible) {
  outline: 2px solid var(--uta-focus);
  outline-offset: 2px;
}

@media (max-width: 800px) {
  .settings-content-canvas { padding: 20px 20px 32px; }
  .page-title { font-size: 22px; }
  .save-scope { max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
}

@media (max-width: 620px) {
  .window-body { flex-direction: column; }
  .window-action-bar { padding: 9px 12px; }
  .header-meta { gap: 6px; }
  .save-scope { display: none; }
  .header-actions { width: 100%; gap: 8px; }
  .header-actions .status-indicator { flex: 1 1 150px; }
  .settings-content-canvas { padding: 16px 14px 28px; }
  .page-header { margin-bottom: 16px; }
  .page-title { font-size: 20px; }
  .close-prompt-overlay { padding: 12px; }
  .close-prompt { max-height: 100%; overflow-y: auto; padding: 18px; }
}
</style>

<style>
/* The embedded workshop keeps its behaviour but adopts the settings centre's
 * surfaces and blue accent, so there is only one title/chrome/theme layer. */
:root,
:root[data-theme='light'] {
  --dp-accent: var(--uta-accent);
  --dp-accent-rgb: var(--uta-accent-rgb);
  --dp-accent-soft: var(--uta-accent-soft);
  --dp-accent-fill: var(--uta-accent-soft);
  --dp-accent-border: rgba(var(--uta-accent-rgb), 0.35);
  --dp-accent-glow: rgba(var(--uta-accent-rgb), 0.22);
  --dp-orb-grad: linear-gradient(135deg, var(--uta-accent) 0%, var(--uta-sage) 100%);
  --dp-clay: var(--uta-sand);
  --dp-panel-bg: var(--uta-surface);
  --dp-bg: var(--uta-canvas);
  --dp-bg-elevated: var(--uta-surface);
  --dp-card-bg: var(--uta-canvas);
  --dp-surface: var(--uta-canvas);
  --dp-card-hover: var(--uta-surface-subtle);
  --dp-surface-hover: var(--uta-surface-subtle);
  --dp-pill-inner: var(--uta-surface);
  --dp-input-bg: var(--uta-input);
  --dp-border: var(--uta-separator);
  --dp-border-subtle: var(--uta-whisper-line);
  --dp-border-strong: var(--uta-input-border);
  --dp-text-main: var(--uta-ink);
  --dp-text-primary: var(--uta-ink);
  --dp-text-sub: var(--uta-secondary);
  --dp-text-secondary: var(--uta-secondary);
  --dp-text-dim: var(--uta-muted);
  --dp-text-muted: var(--uta-muted);
  --dp-accent-vivid: var(--uta-accent);
  --dp-accent-text: #ffffff;
  --dp-icon: var(--uta-ink);
  --dp-icon-muted: var(--uta-secondary);
  --dp-bubble-bg: var(--uta-surface);
  --dp-bubble-text: var(--uta-ink);
  --dp-shadow: none;
  --dp-dock-bg: var(--uta-surface);
  --dp-scrollbar: var(--uta-input-border);
}

:root[data-theme='dark'] {
  --dp-accent: var(--uta-accent);
  --dp-accent-rgb: var(--uta-accent-rgb);
  --dp-accent-soft: var(--uta-accent-soft);
  --dp-accent-fill: var(--uta-accent-soft);
  --dp-accent-border: rgba(var(--uta-accent-rgb), 0.42);
  --dp-accent-glow: rgba(var(--uta-accent-rgb), 0.28);
  --dp-accent-vivid: var(--uta-accent);
  --dp-accent-text: var(--uta-accent-text, #ffffff);
}

.companion-window.embedded {
  position: relative;
  inset: auto;
  width: 100%;
  max-width: none;
  height: auto;
  min-height: 0;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  z-index: auto;
  overflow: visible;
}

.companion-window.embedded .bio-scroll {
  overflow: visible;
  padding: 0;
  gap: 12px;
  scrollbar-gutter: auto;
}

.companion-window.embedded .oat-hero-well,
.companion-window.embedded .oat-well,
.companion-window.embedded .bio-fold-card {
  border-radius: 14px;
}

.companion-window.embedded .oat-hero-title {
  font-size: 19px;
}

.companion-window.embedded .oat-eyebrow {
  font-size: 11px;
  color: var(--uta-secondary);
}

.companion-window.embedded .bio-btn-pill,
.companion-window.embedded .ctrl-capsule {
  min-height: 36px;
}

.companion-window.embedded .preset-capsule {
  min-height: 42px;
}

@media (max-width: 700px) {
  .companion-window.embedded .studio-action-row,
  .companion-window.embedded .studio-name-row,
  .companion-window.embedded .studio-timing-row,
  .companion-window.embedded .bio-sec-head {
    flex-wrap: wrap;
  }
  .companion-window.embedded .group-name-input {
    width: 100%;
  }
}
</style>

<style scoped>
.uta-settings-window-app > .onb {
  flex: 1 1 auto;
  height: auto;
  min-height: 0;
}
</style>
