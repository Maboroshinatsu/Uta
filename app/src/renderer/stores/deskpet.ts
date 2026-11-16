import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { Application } from '@pixi/app'
import type { DeskpetModel, ModelCapabilities } from '@/services/live2d/loader'
import { isPresetSequenceActive, resolveHoldPresetId } from '@/services/preset-sequence'
import { toggleQuietPreferences } from '@/services/quiet-preferences'
import { DAFISH_BODY_LED_HAPPY_MOTION, DAFISH_BODY_LED_HAPPY_PRESET, createDafishBodyLedHappyPreset } from '@/services/live2d/dafish-body-led-happy'
import { DAFISH_WELL_ACTUALLY_PRESET } from '@/services/live2d/dafish-well-actually'
import { DAFISH_BODY_LED_CURIOUS_MOTION, DAFISH_BODY_LED_CURIOUS_PRESET, createDafishBodyLedCuriousPreset } from '@/services/live2d/dafish-body-led-curious'
import { DAFISH_BODY_LED_SURPRISED_MOTION, DAFISH_BODY_LED_SURPRISED_PRESET, createDafishBodyLedSurprisedPreset } from '@/services/live2d/dafish-body-led-surprised'
import { DAFISH_BODY_LED_SAD_MOTION, DAFISH_BODY_LED_SAD_PRESET, createDafishBodyLedSadPreset } from '@/services/live2d/dafish-body-led-sad'
import { DAFISH_BODY_LED_ANGRY_MOTION, DAFISH_BODY_LED_ANGRY_PRESET, createDafishBodyLedAngryPreset } from '@/services/live2d/dafish-body-led-angry'
import { DAFISH_BODY_LED_SHY_MOTION, DAFISH_BODY_LED_SHY_PRESET, createDafishBodyLedShyPreset } from '@/services/live2d/dafish-body-led-shy'
import { DAFISH_BODY_LED_THINKING_MOTION, DAFISH_BODY_LED_THINKING_PRESET, createDafishBodyLedThinkingPreset } from '@/services/live2d/dafish-body-led-thinking'
import { DAFISH_BODY_LED_NEUTRAL_MOTION, DAFISH_BODY_LED_NEUTRAL_PRESET, createDafishBodyLedNeutralPreset } from '@/services/live2d/dafish-body-led-neutral'
import {
  buildModelStatePresets,
  getPresetDefaultFinishMode,
  normalizePresetSteps,
  resolvePresetGroup,
  type ModelEmotionAdapter,
  type ModelStatePreset,
  type PresetFinishMode,
  type PresetKeyframeStep,
  type ResolvedModelControl,
  type ResolvedModelSlider,
} from '@/services/live2d/emotion-adapter'
import type { DeskpetControlAction } from '@/services/host/contracts'
import { settingsClient } from '@/services/settings-client'
import type { PublicSettings, SettingsDocument, SettingsKey } from '../../shared/settings-contracts'
import type { PetSettingsCommand, PetSettingsCommandResult } from '../../shared/settings-command-contracts'
import { createPresetPersistence, PRESET_STORAGE_KEY, type PresetMap, type PresetReadResult } from '../services/preset-persistence'
import { buildPresetExport, isUserPreset, parsePresetImport, type PresetImportError } from '../services/preset-transfer'
import { accentHoverBackground, readableInk } from '../services/color-contrast'

export interface SavePresetOptions {
  group?: string
  steps?: PresetKeyframeStep[]
  finishMode?: PresetFinishMode
  revertHoldMs?: number
  motion?: { group: string; index?: number } | 'none'
}

export interface PendingApprovalItem {
  requestId: string
  toolName: string
  reason: string
  displayReason: string
  host: string
  sessionId?: string
  timeoutMs: number
  createdAt: number
}

interface PersistedModelViewState {
  zoom: number
  offsetX: number
  offsetY: number
}

const MODEL_VIEW_STATE_KEY = 'deskpet/model-view'
const UI_STATE_KEY = 'deskpet/ui-state-biophilic-v1'
const VOICE_SERVICE_STATE_KEY = 'deskpet/voice-service-v1'
const VOICE_SERVICE_KEYS = ['ttsEndpoint', 'ttsCloudEndpoint', 'ttsCloudBackend', 'ttsCloudModel', 'ttsCloudVoice', 'ttsCloudStyle', 'ttsVoice', 'ttsAutoStyleFromHost'] as const
const LEGACY_UI_STATE_KEY = 'deskpet/ui-state'
const DEFAULT_MODEL_VIEW_STATE: PersistedModelViewState = {
  zoom: 1.0,
  offsetX: 0,
  offsetY: 0,
}

export type DeskpetThemeMode = 'dark' | 'light'
export type DeskpetOrbAction =
  | 'model_picker'
  | 'toggle_display_mode'
  | 'color_picker'
  | 'toggle_theme'
export type TtsProvider = 'system' | 'http' | 'cloud'
export type CloudTtsBackend =
  | 'siliconflow'
  | 'deepseek'
  | 'cosyvoice'
  | 'mimo'
  | 'fishaudio'
  | 'gsv2p'
  | 'openai'

export const THEME_ACCENT_PRESETS = [
  { name: '雾蓝', color: '#3d6a8e' },
  { name: '琥珀暖棕', color: '#c87137' },
  { name: '苔藓森绿', color: '#2c5e28' },
  { name: '鼠尾草青', color: '#2e6b62' },
  { name: '矿石蓝灰', color: '#465c7a' },
  { name: '山茶暗粉', color: '#8f4a5e' },
  { name: '麦穗暖金', color: '#8a6a2f' },
] as const

interface PersistedUiState {
  hoverFadeEnabled: boolean
  gazeFollowEnabled: boolean
  themeMode: DeskpetThemeMode
  accentColor: string
  orbAction: DeskpetOrbAction
  ttsEnabled: boolean
  ttsProvider: TtsProvider
  ttsEndpoint: string
  ttsCloudEndpoint: string
  ttsCloudBackend: CloudTtsBackend
  ttsCloudModel: string
  ttsCloudVoice: string
  ttsCloudStyle: string
  ttsAutoStyleFromHost: boolean
  ttsVoice: string
  ttsRate: number
  ttsVolume: number
  ttsSpeakNarration: boolean
  ttsSpeakReplies: boolean
  /** 1 起：状态解说默认关闭，只念宿主回复摘要 */
  ttsSpeechPolicyVersion: number
  idleActionsEnabled: boolean
}

const DEFAULT_UI_STATE: PersistedUiState = {
  hoverFadeEnabled: false,
  gazeFollowEnabled: true,
  themeMode: 'light',
  accentColor: '#3d6a8e',
  orbAction: 'model_picker',
  // 默认静音：夜间/首次启动不会突然出声，用户可在设置里主动开启
  ttsEnabled: false,
  ttsProvider: 'cloud',
  ttsEndpoint: 'http://127.0.0.1:9881/tts',
  ttsCloudEndpoint: 'https://api.siliconflow.cn/v1/audio/speech',
  ttsCloudBackend: 'siliconflow',
  ttsCloudModel: 'FunAudioLLM/CosyVoice2-0.5B',
  ttsCloudVoice: 'FunAudioLLM/CosyVoice2-0.5B:claire',
  ttsCloudStyle: '',
  ttsAutoStyleFromHost: true,
  ttsVoice: '',
  ttsRate: 1,
  ttsVolume: 0.8,
  ttsSpeakNarration: false,
  ttsSpeakReplies: true,
  ttsSpeechPolicyVersion: 1,
  idleActionsEnabled: true,
}

function isValidOrbAction(val: unknown): val is DeskpetOrbAction {
  return (
    val === 'model_picker' ||
    val === 'toggle_display_mode' ||
    val === 'color_picker' ||
    val === 'toggle_theme'
  )
}

function normalizeHexColor(input: unknown, fallback = '#3d6a8e'): string {
  if (typeof input !== 'string') return fallback
  const trimmed = input.trim()
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : fallback
}

function hexToRgbNumbers(hex: string): [number, number, number] {
  const clean = normalizeHexColor(hex).slice(1)
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return [r, g, b]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) {
    h = (gn - bn) / d + (gn < bn ? 6 : 0)
  } else if (max === gn) {
    h = (bn - rn) / d + 2
  } else {
    h = (rn - gn) / d + 4
  }
  return [Math.round(h * 60), s, l]
}

function applyThemeCssVariables(mode: DeskpetThemeMode, accent: string): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const validAccent = normalizeHexColor(accent)
  const [r, g, b] = hexToRgbNumbers(validAccent)
  const [h, s, l] = rgbToHsl(r, g, b)

  root.setAttribute('data-theme', mode)
  root.style.setProperty('--dp-accent', validAccent)
  root.style.setProperty('--dp-accent-rgb', `${r}, ${g}, ${b}`)

  const ink = readableInk(validAccent)
  root.style.setProperty('--dp-accent-text', ink)
  root.style.setProperty('--dp-accent-hover', accentHoverBackground(validAccent, ink))

  if (mode === 'dark') {
    const darkSat = s < 0.06 ? 0 : Math.min(7, Math.round(s * 14))
    const wellSat = s < 0.06 ? 0 : Math.min(9, Math.round(s * 18))
    const vividSat = s < 0.08 ? 0 : Math.max(58, Math.min(88, Math.round(s * 100)))
    const vividLight = Math.max(68, Math.min(80, Math.round(l * 100)))

    root.style.setProperty('--dp-panel-bg', `hsl(${h} ${darkSat}% 10%)`)
    root.style.setProperty('--dp-bg', `hsl(${h} ${darkSat}% 10%)`)
    root.style.setProperty('--dp-card-bg', `hsl(${h} ${wellSat}% 14.5%)`)
    root.style.setProperty('--dp-bg-elevated', `hsl(${h} ${wellSat}% 14.5%)`)
    root.style.setProperty('--dp-surface', `hsl(${h} ${wellSat}% 14.5%)`)
    root.style.setProperty('--dp-card-hover', `hsl(${h} ${wellSat}% 18.5%)`)
    root.style.setProperty('--dp-surface-hover', `hsl(${h} ${wellSat}% 18.5%)`)
    root.style.setProperty('--dp-pill-inner', `hsl(${h} ${darkSat}% 19.5%)`)
    root.style.setProperty('--dp-input-bg', `hsl(${h} ${darkSat}% 11.5%)`)
    root.style.setProperty('--dp-bubble-bg', `hsl(${h} ${darkSat}% 11% / 0.96)`)
    root.style.setProperty('--dp-dock-bg', `hsl(${h} ${darkSat}% 11% / 0.92)`)
    root.style.setProperty('--dp-accent-vivid', `hsl(${h} ${vividSat}% ${vividLight}%)`)
  } else {
    root.style.removeProperty('--dp-panel-bg')
    root.style.removeProperty('--dp-bg')
    root.style.removeProperty('--dp-card-bg')
    root.style.removeProperty('--dp-bg-elevated')
    root.style.removeProperty('--dp-surface')
    root.style.removeProperty('--dp-card-hover')
    root.style.removeProperty('--dp-surface-hover')
    root.style.removeProperty('--dp-pill-inner')
    root.style.removeProperty('--dp-input-bg')
    root.style.removeProperty('--dp-bubble-bg')
    root.style.removeProperty('--dp-dock-bg')
    const dayVividLight = Math.min(42, Math.max(24, Math.round(l * 100)))
    const dayVividSat = s < 0.08 ? 0 : Math.max(45, Math.round(s * 100))
    root.style.setProperty('--dp-accent-vivid', `hsl(${h} ${dayVividSat}% ${dayVividLight}%)`)
  }
}

function loadModelViewState(): PersistedModelViewState {
  try {
    const raw = localStorage.getItem(MODEL_VIEW_STATE_KEY)
    if (!raw) return { ...DEFAULT_MODEL_VIEW_STATE }
    const parsed = JSON.parse(raw) as Partial<PersistedModelViewState>
    return {
      zoom: typeof parsed.zoom === 'number' ? parsed.zoom : DEFAULT_MODEL_VIEW_STATE.zoom,
      offsetX: typeof parsed.offsetX === 'number' ? parsed.offsetX : DEFAULT_MODEL_VIEW_STATE.offsetX,
      offsetY: typeof parsed.offsetY === 'number' ? parsed.offsetY : DEFAULT_MODEL_VIEW_STATE.offsetY,
    }
  } catch {
    return { ...DEFAULT_MODEL_VIEW_STATE }
  }
}

function loadUiState(): PersistedUiState {
  try {
    let raw = localStorage.getItem(UI_STATE_KEY)
    if (['canonical-dev', 'canonical-stable'].includes(settingsClient.getMode())) {
      try {
        const serviceText = localStorage.getItem(VOICE_SERVICE_STATE_KEY)
        if (serviceText && serviceText.length <= 256 * 1024) {
          const service = JSON.parse(serviceText)
          if (service && typeof service === 'object' && !Array.isArray(service)) {
            const base = raw ? JSON.parse(raw) : {}
            const projected = Object.fromEntries(
              VOICE_SERVICE_KEYS.filter(
                (key) => typeof service[key] === 'string' || typeof service[key] === 'boolean',
              ).map((key) => [key, service[key]]),
            )
            raw = JSON.stringify({ ...base, ...projected })
          }
        }
      } catch { /* Preserve legacy service fallback if the separate record cannot be read. */ }
    }
    if (!raw) {
      const legacyRaw = localStorage.getItem(LEGACY_UI_STATE_KEY)
      if (legacyRaw) {
        const legacyParsed = JSON.parse(legacyRaw) as Partial<PersistedUiState>
        return {
          ...DEFAULT_UI_STATE,
          hoverFadeEnabled:
            typeof legacyParsed.hoverFadeEnabled === 'boolean'
              ? legacyParsed.hoverFadeEnabled
              : DEFAULT_UI_STATE.hoverFadeEnabled,
        }
      }
      return { ...DEFAULT_UI_STATE }
    }
    const parsed = JSON.parse(raw) as Partial<PersistedUiState>
    const speechPolicyVersion =
      typeof parsed.ttsSpeechPolicyVersion === 'number'
        ? parsed.ttsSpeechPolicyVersion
        : 0
    return {
      hoverFadeEnabled: typeof parsed.hoverFadeEnabled === 'boolean' ? parsed.hoverFadeEnabled : DEFAULT_UI_STATE.hoverFadeEnabled,
      gazeFollowEnabled:
        typeof parsed.gazeFollowEnabled === 'boolean'
          ? parsed.gazeFollowEnabled
          : DEFAULT_UI_STATE.gazeFollowEnabled,
      themeMode: parsed.themeMode === 'light' || parsed.themeMode === 'dark' ? parsed.themeMode : DEFAULT_UI_STATE.themeMode,
      accentColor: normalizeHexColor(parsed.accentColor, DEFAULT_UI_STATE.accentColor),
      orbAction: isValidOrbAction(parsed.orbAction) ? parsed.orbAction : DEFAULT_UI_STATE.orbAction,
      ttsEnabled: typeof parsed.ttsEnabled === 'boolean' ? parsed.ttsEnabled : DEFAULT_UI_STATE.ttsEnabled,
      // 系统语音是早期兜底，机械感很重；旧配置里的 system 一次性迁到云端 TTS
      ttsProvider:
        parsed.ttsProvider === 'http' || parsed.ttsProvider === 'cloud'
          ? parsed.ttsProvider
          : 'cloud',
      ttsEndpoint:
        typeof parsed.ttsEndpoint === 'string' && parsed.ttsEndpoint.trim()
          ? parsed.ttsEndpoint.trim()
          : DEFAULT_UI_STATE.ttsEndpoint,
      ttsCloudEndpoint:
        typeof parsed.ttsCloudEndpoint === 'string' && parsed.ttsCloudEndpoint.trim()
          ? parsed.ttsCloudEndpoint.trim()
          : DEFAULT_UI_STATE.ttsCloudEndpoint,
      ttsCloudBackend: (
        ['siliconflow', 'deepseek', 'cosyvoice', 'mimo', 'fishaudio', 'gsv2p', 'openai'] as CloudTtsBackend[]
      ).includes(parsed.ttsCloudBackend as CloudTtsBackend)
        ? (parsed.ttsCloudBackend as CloudTtsBackend)
        : DEFAULT_UI_STATE.ttsCloudBackend,
      ttsCloudModel:
        typeof parsed.ttsCloudModel === 'string' && parsed.ttsCloudModel.trim()
          ? parsed.ttsCloudModel.trim()
          : DEFAULT_UI_STATE.ttsCloudModel,
      ttsCloudVoice:
        typeof parsed.ttsCloudVoice === 'string'
          ? parsed.ttsCloudVoice
          : DEFAULT_UI_STATE.ttsCloudVoice,
      ttsCloudStyle:
        typeof parsed.ttsCloudStyle === 'string' ? parsed.ttsCloudStyle : DEFAULT_UI_STATE.ttsCloudStyle,
      ttsAutoStyleFromHost:
        typeof parsed.ttsAutoStyleFromHost === 'boolean'
          ? parsed.ttsAutoStyleFromHost
          : DEFAULT_UI_STATE.ttsAutoStyleFromHost,
      ttsVoice: typeof parsed.ttsVoice === 'string' ? parsed.ttsVoice : DEFAULT_UI_STATE.ttsVoice,
      ttsRate:
        typeof parsed.ttsRate === 'number' && Number.isFinite(parsed.ttsRate)
          ? Math.max(0.5, Math.min(2, parsed.ttsRate))
          : DEFAULT_UI_STATE.ttsRate,
      ttsVolume:
        typeof parsed.ttsVolume === 'number' && Number.isFinite(parsed.ttsVolume)
          ? Math.max(0, Math.min(1, parsed.ttsVolume))
          : DEFAULT_UI_STATE.ttsVolume,
      // 旧配置里状态解说默认是开着的；升级后一次性改成“只念宿主回复”，
      // 之后用户主动打开就按用户的选择保存。
      ttsSpeakNarration:
        speechPolicyVersion >= 1 && typeof parsed.ttsSpeakNarration === 'boolean'
          ? parsed.ttsSpeakNarration
          : DEFAULT_UI_STATE.ttsSpeakNarration,
      ttsSpeakReplies:
        typeof parsed.ttsSpeakReplies === 'boolean'
          ? parsed.ttsSpeakReplies
          : DEFAULT_UI_STATE.ttsSpeakReplies,
      ttsSpeechPolicyVersion: DEFAULT_UI_STATE.ttsSpeechPolicyVersion,
      idleActionsEnabled:
        typeof parsed.idleActionsEnabled === 'boolean'
          ? parsed.idleActionsEnabled
          : DEFAULT_UI_STATE.idleActionsEnabled,
    }
  } catch {
    return { ...DEFAULT_UI_STATE }
  }
}

export function sanitizePresetObject(item: ModelStatePreset): ModelStatePreset {
  const cleanParams: Record<string, number> = {}
  if (item.parameters && typeof item.parameters === 'object') {
    for (const [pid, pval] of Object.entries(item.parameters)) {
      const num = Number(pval)
      if (pid && Number.isFinite(num)) cleanParams[pid] = num
    }
  }
  const controls = Array.isArray(item.controls)
    ? item.controls.map((c) => String(c).trim()).filter(Boolean)
    : []
  const steps = normalizePresetSteps({
    controls,
    parameters: cleanParams,
    steps: item.steps,
  })
  const lastStep = steps[steps.length - 1]
  const finishMode = getPresetDefaultFinishMode(item)
  return {
    id: String(item.id || ''),
    label: String(item.label || '').trim(),
    description: String(item.description || '').trim(),
    emotion: String(item.emotion || 'neutral').trim() || 'neutral',
    group: resolvePresetGroup(item),
    controls: lastStep ? [...lastStep.controls] : controls,
    parameters: lastStep ? { ...lastStep.parameters } : cleanParams,
    steps,
    finishMode,
    ...(typeof item.revertHoldMs === 'number' && Number.isFinite(item.revertHoldMs)
      ? { revertHoldMs: item.revertHoldMs }
      : {}),
    ...(item.motion === 'none' ? { motion: 'none' as const } :
      item.motion && typeof item.motion === 'object' && typeof item.motion.group === 'string'
        ? {
            motion: {
              group: item.motion.group,
              ...(Number.isFinite(Number(item.motion.index)) && Number(item.motion.index) >= 0
                ? { index: Math.floor(Number(item.motion.index)) }
                : {}),
            },
          }
        : {}),
    custom: true,
    ...(item.source === 'user' ? { source: 'user' as const } : {}),
    ...(item.unavailable === true && item.source !== 'user' ? { unavailable: true as const } : {}),
  }
}

function getModelPresetScopeKey(url: string): string {
  const trimmed = (url || '').trim()
  if (!trimmed) return 'default'
  return trimmed.replace(/[?#].*$/, '')
}

export const useDeskpetStore = defineStore('deskpet', () => {
  const persistedModelView = loadModelViewState()
  const persistedUiState = loadUiState()
  const presetPersistence = createPresetPersistence(localStorage, sanitizePresetObject)
  const initialPresets = presetPersistence.read()
  const presetsByModel = ref<PresetMap>(initialPresets.ok ? initialPresets.map : {})
  const presetSaveStatus = ref<'idle' | 'success' | 'error'>(initialPresets.ok ? 'idle' : 'error')
  const presetSaveMessage = ref(initialPresets.ok ? '' : '预设记录无法读取，原记录保持不变。请保留数据并检查后重试。')
  const wsConnected = ref(false)
  const pixiApp = shallowRef<Application | null>(null)
  const live2dModel = shallowRef<DeskpetModel | null>(null)
  const emotionAdapter = shallowRef<ModelEmotionAdapter | null>(null)
  /** 当前模型的动作组/表情/参数清单，供适配校验和 deskpetInspectModel() 使用 */
  const modelCapabilities = shallowRef<ModelCapabilities | null>(null)
  const modelLoaded = ref(false)
  const modelUrl = ref('')
  const modelZoom = ref(persistedModelView.zoom)
  const modelOffsetX = ref(persistedModelView.offsetX)
  const modelOffsetY = ref(persistedModelView.offsetY)

  const isCanonicalSettings = ['canonical-dev', 'canonical-stable'].includes(settingsClient.getMode())
  const canonicalSettings = isCanonicalSettings ? settingsClient.getCurrentSettings() : null

  if (isCanonicalSettings && !canonicalSettings) throw new Error('Settings must be hydrated before creating the store')

  // canonical 必须使用已水合的权威快照；legacy 保留原持久化行为。
  const hoverFadeEnabled = ref(
    canonicalSettings ? canonicalSettings.hoverFadeEnabled : persistedUiState.hoverFadeEnabled
  )
  const gazeFollowEnabled = ref(
    canonicalSettings ? canonicalSettings.gazeFollowEnabled : persistedUiState.gazeFollowEnabled
  )
  const clickThroughLocked = ref(false)
  const themeMode = ref<DeskpetThemeMode>(
    canonicalSettings ? canonicalSettings.themeMode : persistedUiState.themeMode
  )
  const accentColor = ref<string>(
    canonicalSettings ? canonicalSettings.accentColor : persistedUiState.accentColor
  )
  const orbAction = ref<DeskpetOrbAction>(
    canonicalSettings ? canonicalSettings.orbAction : persistedUiState.orbAction
  )
  const ttsEnabled = ref(
    canonicalSettings ? canonicalSettings.ttsEnabled : persistedUiState.ttsEnabled
  )
  const ttsProvider = ref<TtsProvider>(
    canonicalSettings ? canonicalSettings.ttsProvider : persistedUiState.ttsProvider
  )
  const ttsEndpoint = ref(persistedUiState.ttsEndpoint)
  const ttsCloudEndpoint = ref(persistedUiState.ttsCloudEndpoint)
  const ttsCloudBackend = ref<CloudTtsBackend>(persistedUiState.ttsCloudBackend)
  const ttsCloudModel = ref(persistedUiState.ttsCloudModel)
  const ttsCloudVoice = ref(persistedUiState.ttsCloudVoice)
  const ttsCloudStyle = ref(persistedUiState.ttsCloudStyle)
  const ttsAutoStyleFromHost = ref(persistedUiState.ttsAutoStyleFromHost ?? true)
  const ttsVoice = ref(persistedUiState.ttsVoice)
  const ttsRate = ref(
    canonicalSettings ? canonicalSettings.ttsRate : persistedUiState.ttsRate
  )
  const ttsVolume = ref(
    canonicalSettings ? canonicalSettings.ttsVolume : persistedUiState.ttsVolume
  )
  const ttsSpeakNarration = ref(
    canonicalSettings ? canonicalSettings.ttsSpeakNarration : persistedUiState.ttsSpeakNarration
  )
  const ttsSpeakReplies = ref(
    canonicalSettings ? canonicalSettings.ttsSpeakReplies : persistedUiState.ttsSpeakReplies
  )
  const idleActionsEnabled = ref(
    canonicalSettings ? canonicalSettings.idleActionsEnabled : persistedUiState.idleActionsEnabled
  )
  const chatDisplayName = ref(canonicalSettings?.chatDisplayName ?? '')
  const interactionEnabled = ref(true)
  try { interactionEnabled.value = localStorage.getItem('uta:interaction-enabled') !== 'false' } catch { /* use default */ }
  watch(interactionEnabled, enabled => {
    try { localStorage.setItem('uta:interaction-enabled', String(enabled)) } catch { /* preference remains in memory */ }
  })
  const focusActive = ref(false)
  let focusTimer: ReturnType<typeof setTimeout> | null = null
  function setFocusUntil(until: number): void {
    if (focusTimer) clearTimeout(focusTimer)
    focusTimer = null
    const remaining = until - Date.now()
    focusActive.value = remaining > 0 && remaining <= 8 * 60 * 60_000
    try {
      if (focusActive.value) localStorage.setItem('uta:focus-until', String(until))
      else localStorage.removeItem('uta:focus-until')
    } catch { /* focus remains active in this session */ }
    if (focusActive.value) focusTimer = setTimeout(() => setFocusUntil(0), remaining)
  }
  try { setFocusUntil(Number(localStorage.getItem('uta:focus-until')) || 0) } catch { /* use default */ }
  function toggleFocus(): void { setFocusUntil(focusActive.value ? 0 : Date.now() + 30 * 60_000) }
  onScopeDispose(() => { if (focusTimer) clearTimeout(focusTimer) })
  const quietMode = computed({
    get: () => !idleActionsEnabled.value && !ttsSpeakNarration.value,
    set: (enabled: boolean) => {
      const next = toggleQuietPreferences({ idleActionsEnabled: idleActionsEnabled.value, ttsSpeakNarration: ttsSpeakNarration.value }, enabled)
      idleActionsEnabled.value = next.idleActionsEnabled
      ttsSpeakNarration.value = next.ttsSpeakNarration
    },
  })

  applyThemeCssVariables(themeMode.value, accentColor.value)

  const settingsRevision = ref(settingsClient.getCurrentRevision())
  const settingsUnsavedChanges = ref<Partial<PublicSettings>>({})
  function applyLegacyHoverFade(enabled: boolean): void {
    if (!isCanonicalSettings) hoverFadeEnabled.value = enabled
  }
  const settingsSaveError = ref<{
    code: string
    message: string
    timestamp: number
  } | null>(null)

  if (!isCanonicalSettings) {
    // legacy 模式：保留原有的 localStorage 混合 blob 全量持久化
    watch(
      [
        hoverFadeEnabled,
        gazeFollowEnabled,
        themeMode,
        accentColor,
        orbAction,
        ttsEnabled,
        ttsProvider,
        ttsEndpoint,
        ttsCloudEndpoint,
        ttsCloudBackend,
        ttsCloudModel,
        ttsCloudVoice,
        ttsCloudStyle,
        ttsAutoStyleFromHost,
        ttsVoice,
        ttsRate,
        ttsVolume,
        ttsSpeakNarration,
        ttsSpeakReplies,
        idleActionsEnabled,
      ],
      ([
        enabled,
        gazeEnabled,
        mode,
        accent,
        orb,
        voiceEnabled,
        voiceProvider,
        voiceEndpoint,
        voiceCloudEndpoint,
        voiceCloudBackend,
        voiceCloudModel,
        voiceCloudVoice,
        voiceCloudStyle,
        autoStyleFromHost,
        voiceName,
        voiceRate,
        voiceVolume,
        speakNarration,
        speakReplies,
        idleEnabled,
      ]) => {
        const validAccent = normalizeHexColor(accent)
        applyThemeCssVariables(mode, validAccent)
        try {
          localStorage.setItem(
            UI_STATE_KEY,
            JSON.stringify({
              hoverFadeEnabled: enabled,
              gazeFollowEnabled: gazeEnabled,
              themeMode: mode,
              accentColor: validAccent,
              orbAction: orb,
              ttsEnabled: voiceEnabled,
              ttsProvider: voiceProvider,
              ttsEndpoint: voiceEndpoint,
              ttsCloudEndpoint: voiceCloudEndpoint,
              ttsCloudBackend: voiceCloudBackend,
              ttsCloudModel: voiceCloudModel,
              ttsCloudVoice: voiceCloudVoice,
              ttsCloudStyle: voiceCloudStyle,
              ttsAutoStyleFromHost: ttsAutoStyleFromHost.value,
              ttsVoice: voiceName,
              ttsRate: voiceRate,
              ttsVolume: voiceVolume,
              ttsSpeakNarration: speakNarration,
              ttsSpeakReplies: speakReplies,
              ttsSpeechPolicyVersion: DEFAULT_UI_STATE.ttsSpeechPolicyVersion,
              idleActionsEnabled: idleEnabled,
            }),
          )
        } catch {
          /* ignore storage quota errors */
        }
      },
      // 启动时就把迁移后的状态写回，避免旧的“状态解说已开”一直留在存储里
      { immediate: true },
    )
  } else {
    // canonical 模式：
    // Separate service record leaves legacy public-preference sources unchanged.
    watch(
      [
        ttsEndpoint,
        ttsCloudEndpoint,
        ttsCloudBackend,
        ttsCloudModel,
        ttsCloudVoice,
        ttsCloudStyle,
        ttsAutoStyleFromHost,
        ttsVoice,
      ],
      ([
        voiceEndpoint,
        voiceCloudEndpoint,
        voiceCloudBackend,
        voiceCloudModel,
        voiceCloudVoice,
        voiceCloudStyle,
        autoStyleFromHost,
        voiceName,
      ]) => {
        try {
          localStorage.setItem(
            VOICE_SERVICE_STATE_KEY,
            JSON.stringify({
              ttsEndpoint: voiceEndpoint,
              ttsCloudEndpoint: voiceCloudEndpoint,
              ttsCloudBackend: voiceCloudBackend,
              ttsCloudModel: voiceCloudModel,
              ttsCloudVoice: voiceCloudVoice,
              ttsCloudStyle: voiceCloudStyle,
              ttsAutoStyleFromHost: ttsAutoStyleFromHost.value,
              ttsVoice: voiceName,
              ttsSpeechPolicyVersion: DEFAULT_UI_STATE.ttsSpeechPolicyVersion,
            }),
          )
        } catch {
          /* ignore storage quota errors */
        }
      },
      { immediate: true },
    )

    const fields = {
      hoverFadeEnabled, gazeFollowEnabled, themeMode, accentColor, orbAction,
      ttsEnabled, ttsProvider, ttsRate, ttsVolume, ttsSpeakNarration,
      ttsSpeakReplies, idleActionsEnabled, chatDisplayName,
    }
    const keys = Object.keys(fields) as SettingsKey[]
    const editVersions = new Map<SettingsKey, number>()
    let nextEdit = 0
    let applying = false
    let disposed = false
    let committed = { ...canonicalSettings! }

    const applyCommitted = (doc?: SettingsDocument): void => {
      if (disposed) return
      if (doc && doc.revision >= (settingsRevision.value ?? -1)) {
        committed = { ...doc.values }
        settingsRevision.value = doc.revision
      }
      applying = true
      try {
        for (const key of keys) {
          if (!(key in settingsUnsavedChanges.value)) {
            ;(fields[key] as { value: PublicSettings[SettingsKey] }).value = committed[key]
          }
        }
        applyThemeCssVariables(themeMode.value, accentColor.value)
      } finally { applying = false }
    }

    /** 失败时保留本地编辑（便于再次修改重试），同时留下可见错误。 */
    const reportSettingsFailure = (versions: Map<SettingsKey, number>, code: string): void => {
      if (Array.from(versions).some(([key, version]) => editVersions.get(key) === version)) {
        settingsSaveError.value = {
          code,
          message: '设置未保存，请重新尝试修改。',
          timestamp: Date.now(),
        }
      }
    }

    // Synchronous tracking records user intent before an intervening remote event.
    // Only the changed fields are submitted; other fields remain server-owned.
    watch(keys.map(key => fields[key]), (values, previous) => {
      if (applying || disposed) return
      const changes: Partial<PublicSettings> = {}
      const versions = new Map<SettingsKey, number>()
      keys.forEach((key, index) => {
        if (values[index] !== previous[index]) {
          const value = key === 'accentColor' ? normalizeHexColor(String(values[index])) : values[index]
          ;(changes as Record<string, unknown>)[key] = value
          const version = ++nextEdit
          editVersions.set(key, version)
          versions.set(key, version)
        }
      })
      if (versions.size === 0) return
      settingsUnsavedChanges.value = { ...settingsUnsavedChanges.value, ...changes }
      applyThemeCssVariables(themeMode.value, accentColor.value)
      void settingsClient.patch(changes).then(result => {
        if (disposed) return
        if (result.ok) {
          const remaining = { ...settingsUnsavedChanges.value }
          for (const [key, version] of versions) {
            if (editVersions.get(key) === version) delete remaining[key]
          }
          settingsUnsavedChanges.value = remaining
          applyCommitted(result.document)
          if (Object.keys(remaining).length === 0) settingsSaveError.value = null
        } else {
          reportSettingsFailure(versions, result.code)
        }
      }).catch(() => {
        if (!disposed) reportSettingsFailure(versions, 'io-error')
      })
    }, { immediate: false, flush: 'sync' })

    const unsubscribe = settingsClient.subscribe(doc => applyCommitted(doc))
    onScopeDispose(() => { disposed = true; unsubscribe() })
  }

  let viewPersistTimer: ReturnType<typeof setTimeout> | null = null
  watch([modelZoom, modelOffsetX, modelOffsetY], ([zoom, offsetX, offsetY]) => {
    // 拖动期间每帧都会变，攒到停手后再落盘
    if (viewPersistTimer) clearTimeout(viewPersistTimer)
    viewPersistTimer = setTimeout(() => {
      viewPersistTimer = null
      try {
        localStorage.setItem(MODEL_VIEW_STATE_KEY, JSON.stringify({ zoom, offsetX, offsetY }))
      } catch {
        /* 存储不可用时只影响位置记忆 */
      }
    }, 240)
  })

  function presetFailure(result: Extract<PresetReadResult, { ok: false }>): false {
    presetSaveStatus.value = 'error'
    presetSaveMessage.value = result.error === 'write-failed'
      ? '预设未保存，编辑内容仍在。请检查存储空间或权限后再次保存。'
      : '已保存的预设记录无法读取，原记录保持不变。请保留数据并检查后重试。'
    return false
  }

  function reloadPresetStorage(): boolean {
    const latest = presetPersistence.read()
    if (!latest.ok) return presetFailure(latest)
    presetsByModel.value = latest.map
    return true
  }

  function persistPresetBucket(key: string, list: ModelStatePreset[]): boolean {
    const result = presetPersistence.writeBucket(key, list)
    if (!result.ok) return presetFailure(result)
    presetsByModel.value = result.map
    presetSaveStatus.value = 'success'
    presetSaveMessage.value = '预设已保存到当前实例。'
    return true
  }

  // The pet and settings window share an origin, but never a Live2D instance.
  const receivePresetStorage = (event: StorageEvent) => {
    if (event.storageArea === localStorage && (event.key === PRESET_STORAGE_KEY || event.key === null)) reloadPresetStorage()
  }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('storage', receivePresetStorage)
    onScopeDispose(() => window.removeEventListener('storage', receivePresetStorage))
  }

  const currentEmotion = ref('neutral')
  /** 每次收到情绪指令递增；同值情绪连发时 watch([currentEmotion, emotionPulse]) 仍会触发 */
  const emotionPulse = ref(0)
  /** 当前模型声明的自定义情绪键（adapter / 立绘包清单的键），模型切换时更新 */
  const modelEmotions = ref<string[]>([])
  /** 当前模型可用的控件列表（服饰/发型/道具/特效开关），随模型加载与开关变化同步到后端 */
  const modelControls = ref<ResolvedModelControl[]>([])
  /** 当前模型可调节的 VTB 面捕/五官/头身角度滑块列表 */
  const modelSliders = ref<ResolvedModelSlider[]>([])
  /** 情绪自动回退的目标（静态立绘包 = 清单标定的 default；Live2D 固定 neutral） */
  const defaultEmotion = ref('neutral')
  const isThinking = ref(false)
  /** TTS 正在出声或流式输出时驱动口型 */
  const isSpeaking = ref(false)
  const pendingAnimation = ref<string | null>(null)
  const pendingAnimationLoop = ref(false)

  /** 宿主 Agent 当前工作状态与状态提示文案 */
  const agentWorkingState = ref<AgentWorkingState>('idle')
  const agentStateLabel = ref<string>('')
  const agentActiveToolName = ref<string>('')

  /** 待决的交互式工具审批队列（支持多条排队，顶部展示第 1 条） */
  const pendingApprovals = ref<PendingApprovalItem[]>([])
  const currentApproval = computed<PendingApprovalItem | null>(
    () => pendingApprovals.value[0] ?? null,
  )

  function enqueueApprovalRequest(req: RuntimeApprovalRequestPayload): void {
    const idx = pendingApprovals.value.findIndex((item) => item.requestId === req.requestId)
    const entry: PendingApprovalItem = {
      ...req,
      createdAt: Date.now(),
    }
    if (idx >= 0) {
      pendingApprovals.value.splice(idx, 1, entry)
    } else {
      pendingApprovals.value.push(entry)
    }
  }

  function removeApprovalRequest(requestId: string): void {
    pendingApprovals.value = pendingApprovals.value.filter((item) => item.requestId !== requestId)
  }

  function clearApprovalRequests(): void {
    pendingApprovals.value = []
  }

  /** 当前由用户显式钉为常驻基底保持的预设 ID（为空时播完恢复默认回退到 neutral 日常待机） */
  const activeHoldPresetId = ref<string>('')
  /** 展示与回退用的常驻基准：没手动钉选时就是日常待机。闸门仍看原始 id。 */
  const effectiveHoldPresetId = computed(() => resolveHoldPresetId(activeHoldPresetId.value))
  /** 当前正在执行或激活的预设 ID */
  const activeRunningPresetId = ref<string | null>('neutral')
  /** 是否有一次非常驻的预设正在播放。空闲小动作、悬停回应与外部触发都必须让路，
   *  否则会在播放中途 cancel 掉当前序列并走回退清理，把预设临时激活的部件收掉。 */
  const presetSequenceActive = computed(() =>
    isPresetSequenceActive(activeRunningPresetId.value, activeHoldPresetId.value),
  )
  /** 当用户在设置面板展开预设进行分镜/滑块编辑时置为 true，暂停自动回退 */
  const presetEditingLocked = ref<boolean>(false)
  /** 预设工坊里启动的临时预览；关闭面板时必须取消，否则 loop 预览会一直锁视线 */
  const presetPreviewActive = ref<boolean>(false)

  function beginPresetPreview() {
    presetPreviewActive.value = true
  }

  function endPresetPreview() {
    presetPreviewActive.value = false
  }

  const RETIRED_DEFAULT_PRESET_IDS = new Set([
    'happy_tilt', 'sad_glance', 'angry_glare', 'annoyed', 'weary', 'embarrassed', 'shy_peek',
    'focus', 'waiting', 'testing', 'cheer', 'nod', 'wave', 'continuous_work', 'continuous_idle',
    'dafish_happy_v2', 'dafish_curious_v2', 'dafish_angry_v2', 'dafish_sad_v2', 'dafish_shy_v2',
    'dafish_thinking_v2', 'dafish_surprised_v2', 'dafish_body_led_happy_v2',
    'dafish_body_led_curious_v2', 'dafish_body_led_angry_v2', 'dafish_body_led_sad_v2',
    'dafish_body_led_shy_v2', 'dafish_body_led_thinking_v2', 'dafish_body_led_surprised_v2',
    DAFISH_WELL_ACTUALLY_PRESET,
  ])
  const DAFISH_ONLY_PRESET_IDS = new Set([
    DAFISH_BODY_LED_HAPPY_PRESET, DAFISH_BODY_LED_CURIOUS_PRESET, DAFISH_BODY_LED_SURPRISED_PRESET,
    DAFISH_BODY_LED_SAD_PRESET, DAFISH_BODY_LED_ANGRY_PRESET, DAFISH_BODY_LED_SHY_PRESET, DAFISH_BODY_LED_THINKING_PRESET,
  ])
  const defaultPresets = computed(() =>
    buildModelStatePresets(modelControls.value, modelSliders.value, modelCapabilities.value, emotionAdapter.value).map(sanitizePresetObject),
  )

  function upgradeDefaultPresetBucket(current: ModelStatePreset[], fillMissingSlots: boolean): ModelStatePreset[] {
    const defaults = defaultPresets.value
    const defaultIds = new Set(defaults.map(preset => preset.id))
    const currentIds = new Set(current.map(preset => preset.id))
    const userById = new Map(current.filter(isUserPreset).map(preset => [preset.id, preset]))
    const updated = defaults
      .filter(preset => fillMissingSlots || currentIds.has(preset.id))
      .map(preset => userById.get(preset.id) ?? preset)
    const remaining = current.filter(preset =>
      !defaultIds.has(preset.id) && (isUserPreset(preset) ||
        !(RETIRED_DEFAULT_PRESET_IDS.has(preset.id) || DAFISH_ONLY_PRESET_IDS.has(preset.id))),
    )
    return [...updated, ...remaining]
  }

  /** 只迁移当前配置中的旧内置动作，保留用户编辑、已删除的共有槽位及模型额外预设。 */
  function ensureModelPresetsSeeded(diskPresets?: ModelStatePreset[] | null) {
    const key = getModelPresetScopeKey(modelUrl.value)
    activeHoldPresetId.value = ''
    activeRunningPresetId.value = 'neutral'
    if (!reloadPresetStorage()) return false
    const current = presetsByModel.value[key]
    const dafish = defaultPresets.value.some(preset => preset.id === DAFISH_BODY_LED_HAPPY_PRESET)
    const flagKey = dafish ? `deskpet/dafish-purged-legacy-v9:${key}` : `deskpet/default-preset-slots-v3:${key}`
    try {
      if (current && localStorage.getItem(flagKey) === '1') return true
    } catch { /* best effort */ }

    const sidecar = diskPresets?.map(sanitizePresetObject)
    const replaceDafishSlots = !dafish && !!current?.some(preset => !isUserPreset(preset) && DAFISH_ONLY_PRESET_IDS.has(preset.id))
    const next = current
      ? upgradeDefaultPresetBucket(current, (dafish && current.length > 0) || replaceDafishSlots)
      : sidecar?.length === 0 ? [] : upgradeDefaultPresetBucket(sidecar ?? [], true)
    if ((!current || JSON.stringify(current) !== JSON.stringify(next)) && !persistPresetBucket(key, next)) {
      return false
    }
    try {
      localStorage.setItem(flagKey, '1')
    } catch { /* best effort */ }
    return true
  }

  /** Restore only this profile's bucket; distributed model resources stay unchanged. */
  function restoreDefaultPresets(): ModelStatePreset[] | null {
    const key = getModelPresetScopeKey(modelUrl.value)
    const seeded = defaultPresets.value
    return persistPresetBucket(key, seeded) ? seeded : null
  }

  /** 当前模型的所有状态预设（全部可删除、可覆盖编辑，并暴露给后端 AI 调用） */
  const availablePresets = (list: ModelStatePreset[]) =>
    list.filter(p => p.id !== DAFISH_BODY_LED_HAPPY_PRESET || modelCapabilities.value?.motionGroups[DAFISH_BODY_LED_HAPPY_MOTION])
  const defaultStatePresets = computed(() => availablePresets(defaultPresets.value))
  const statePresets = computed<ModelStatePreset[]>(() => {
    const key = getModelPresetScopeKey(modelUrl.value)
    return availablePresets(presetsByModel.value[key] ?? defaultPresets.value).filter(preset => !preset.unavailable)
  })

  /** 兼容旧引用的别名 */
  const customPresets = statePresets

  /**
   * 将当前控件、面捕滑块以及可选的多步关键帧序列保存为命名预设
   */
  function saveCustomPreset(
    label: string,
    controlIds?: string[],
    customParams?: Record<string, number>,
    emotion = 'neutral',
    options?: SavePresetOptions,
  ): ModelStatePreset | null {
    const cleanLabel = label.trim()
    if (!cleanLabel) return null

    const fallbackActiveIds =
      controlIds !== undefined
        ? Array.from(new Set(controlIds.map((c) => c.trim()).filter(Boolean)))
        : modelControls.value.filter((c) => c.active).map((c) => c.id)

    const fallbackSliderParams: Record<string, number> = {}
    if (customParams !== undefined) {
      for (const [pid, val] of Object.entries(customParams)) {
        if (Number.isFinite(val)) fallbackSliderParams[pid] = Math.round(val * 100) / 100
      }
    } else {
      for (const s of modelSliders.value) {
        if (Math.abs(s.value - s.defaultValue) > 1e-3) {
          fallbackSliderParams[s.id] = Math.round(s.value * 100) / 100
        }
      }
    }

    const steps = normalizePresetSteps({
      controls: fallbackActiveIds,
      parameters: fallbackSliderParams,
      steps: options?.steps,
    })
    const lastStep = steps[steps.length - 1]
    const activeIds = lastStep ? [...lastStep.controls] : fallbackActiveIds
    const sliderParams = lastStep ? { ...lastStep.parameters } : fallbackSliderParams

    const ctrlLabelMap = new Map(
      modelControls.value.map((c) => [c.id, c.label.replace(/\s*\([^)]*\)\s*$/, '').trim() || c.id]),
    )
    const sliderLabelMap = new Map(modelSliders.value.map((s) => [s.id, s.label]))

    const ctrlNames = activeIds.map((id) => ctrlLabelMap.get(id) || id)
    const touchedParamSet = new Set<string>()
    for (const st of steps) {
      for (const pid of Object.keys(st.parameters)) touchedParamSet.add(pid)
    }
    const sliderNames = [...touchedParamSet].map((id) => sliderLabelMap.get(id) || id)
    const descParts: string[] = []
    if (steps.length > 1) {
      descParts.push(`${steps.length}步连续动作`)
    }
    if (ctrlNames.length > 0) {
      descParts.push(
        ctrlNames.slice(0, 3).join(' + ') + (ctrlNames.length > 3 ? ` 等${ctrlNames.length}项` : ''),
      )
    }
    if (sliderNames.length > 0) {
      descParts.push(
        `滑块(${sliderNames.slice(0, 2).join('/')}${sliderNames.length > 2 ? `等${sliderNames.length}项` : ''})`,
      )
    }
    const desc = descParts.join(' · ') || '默认外观与自然面捕'

    const key = getModelPresetScopeKey(modelUrl.value)
    if (!reloadPresetStorage()) return null
    const currentList =
      key in presetsByModel.value
        ? [...presetsByModel.value[key]]
        : [...defaultPresets.value]

    const existingIdx = currentList.findIndex(
      (p) => p.label.toLowerCase() === cleanLabel.toLowerCase(),
    )
    const existingPreset = existingIdx >= 0 ? currentList[existingIdx] : undefined

    const cleanEmotion = (emotion || 'neutral').trim() || 'neutral'
    const resolvedGroup = resolvePresetGroup({
      id: existingPreset?.id,
      label: cleanLabel,
      emotion: cleanEmotion,
      group: options?.group ?? existingPreset?.group,
    })

    const finishMode =
      options?.finishMode ??
      existingPreset?.finishMode ??
      getPresetDefaultFinishMode({
        id: existingPreset?.id,
        label: cleanLabel,
        emotion: cleanEmotion,
        group: resolvedGroup,
      })

    const revertHoldMs = options?.revertHoldMs ?? existingPreset?.revertHoldMs
    const motion = options?.motion !== undefined ? options.motion : existingPreset?.motion

    let presetId = existingPreset?.id
    if (!presetId) {
      let counter = 0
      do {
        const rand = Math.random().toString(36).slice(2, 7)
        presetId = `preset_${Date.now().toString(36)}_${rand}${counter > 0 ? `_${counter}` : ''}`
        counter++
      } while (currentList.some((p) => p.id === presetId))
    }

    const preset: ModelStatePreset = {
      id: presetId,
      label: cleanLabel,
      description: desc,
      emotion: cleanEmotion,
      group: resolvedGroup,
      controls: activeIds,
      parameters: sliderParams,
      steps,
      finishMode,
      ...(typeof revertHoldMs === 'number' ? { revertHoldMs } : {}),
      ...(motion !== undefined ? { motion } : {}),
      custom: true,
      source: 'user',
    }

    if (existingIdx >= 0) {
      currentList[existingIdx] = preset
    } else {
      currentList.push(preset)
    }

    return persistPresetBucket(key, currentList) ? preset : null
  }

  function deleteCustomPreset(id: string): boolean {
    const key = getModelPresetScopeKey(modelUrl.value)
    if (!reloadPresetStorage()) return false
    const currentList =
      key in presetsByModel.value
        ? [...presetsByModel.value[key]]
        : [...defaultPresets.value]
    const next = currentList.filter((p) => p.id !== id)
    if (next.length === currentList.length) return false
    if (!persistPresetBucket(key, next)) return false
    if (activeHoldPresetId.value === id) {
      activeHoldPresetId.value = ''
    }
    return true
  }

  /** Export only user-owned presets; built-in packs stay recoverable in code. */
  function exportUserPresets():
    | { ok: true; text: string; count: number }
    | { ok: false; error: 'empty' | 'unreadable' } {
    const key = getModelPresetScopeKey(modelUrl.value)
    if (!reloadPresetStorage()) return { ok: false, error: 'unreadable' }
    const list = (presetsByModel.value[key] ?? []).filter(isUserPreset)
    if (list.length === 0) return { ok: false, error: 'empty' }
    return {
      ok: true,
      count: list.length,
      text: buildPresetExport(key, modelUrl.value, list, undefined, modelCapabilities.value?.assetSignature),
    }
  }

  /** Import is scoped to the current model; a mismatched file is rejected whole. */
  function importUserPresets(raw: string):
    | { ok: true; imported: number; replaced: number }
    | { ok: false; error: PresetImportError | 'unreadable' | 'write-failed' } {
    const key = getModelPresetScopeKey(modelUrl.value)
    const parsed = parsePresetImport(raw, key, sanitizePresetObject, (group, index) =>
      (modelCapabilities.value?.motionGroups[group] ?? 0) > index, modelCapabilities.value?.assetSignature,
    )
    if (!parsed.ok) return parsed
    if (!reloadPresetStorage()) return { ok: false, error: 'unreadable' }
    const currentList =
      key in presetsByModel.value
        ? [...presetsByModel.value[key]]
        : [...defaultPresets.value]
    let replaced = 0
    for (const incoming of parsed.presets) {
      const byId = currentList.findIndex((preset) => preset.id === incoming.id)
      const byLabel = byId < 0
        ? currentList.findIndex((preset) => preset.label.toLowerCase() === incoming.label.toLowerCase())
        : -1
      if (byId >= 0) {
        currentList[byId] = incoming
        replaced += 1
      } else if (byLabel >= 0) {
        currentList[byLabel] = incoming
        replaced += 1
      } else {
        currentList.push(incoming)
      }
    }
    if (!persistPresetBucket(key, currentList)) return { ok: false, error: 'write-failed' }
    return { ok: true, imported: parsed.presets.length, replaced }
  }

  function consumePendingAnimation(): { name: string; loop: boolean } | null {
    if (!pendingAnimation.value) return null
    const result = { name: pendingAnimation.value, loop: pendingAnimationLoop.value }
    pendingAnimation.value = null
    pendingAnimationLoop.value = false
    return result
  }

  function setModelOffset(x: number, y: number) {
    modelOffsetX.value = x
    modelOffsetY.value = y
  }

  function resetModelView() {
    modelZoom.value = DEFAULT_MODEL_VIEW_STATE.zoom
    modelOffsetX.value = DEFAULT_MODEL_VIEW_STATE.offsetX
    modelOffsetY.value = DEFAULT_MODEL_VIEW_STATE.offsetY
  }

  /** Re-read persisted non-public voice state after another window edits it. */
  function reloadPersistedUiState(): void {
    reloadPresetStorage()
    const state = loadUiState()
    ttsEndpoint.value = state.ttsEndpoint
    ttsCloudEndpoint.value = state.ttsCloudEndpoint
    ttsCloudBackend.value = state.ttsCloudBackend
    ttsCloudModel.value = state.ttsCloudModel
    ttsCloudVoice.value = state.ttsCloudVoice
    ttsCloudStyle.value = state.ttsCloudStyle
    ttsAutoStyleFromHost.value = state.ttsAutoStyleFromHost ?? true
    ttsVoice.value = state.ttsVoice
    if (!isCanonicalSettings) {
      hoverFadeEnabled.value = state.hoverFadeEnabled
      gazeFollowEnabled.value = state.gazeFollowEnabled
      themeMode.value = state.themeMode
      accentColor.value = state.accentColor
      orbAction.value = state.orbAction
      ttsEnabled.value = state.ttsEnabled
      ttsProvider.value = state.ttsProvider
      ttsRate.value = state.ttsRate
      ttsVolume.value = state.ttsVolume
      ttsSpeakNarration.value = state.ttsSpeakNarration
      ttsSpeakReplies.value = state.ttsSpeakReplies
      idleActionsEnabled.value = state.idleActionsEnabled
    }
    applyThemeCssVariables(themeMode.value, accentColor.value)
  }

  let modelSwitcher: ((url: string) => Promise<void>) | null = null

  function registerModelSwitcher(fn: (url: string) => Promise<void>) {
    modelSwitcher = fn
  }

  async function requestModelSwitch(url: string): Promise<void> {
    if (!modelSwitcher) {
      console.warn('[Deskpet] No model switcher registered')
      return
    }
    await modelSwitcher(url)
  }

  let controlActionHandler: ((control: string, action: DeskpetControlAction) => boolean) | null = null
  let sliderSyncHandler: ((transitionMs?: number) => boolean) | null = null
  let presetTriggerHandler:
    | ((presetOrId: string | ModelStatePreset, modeOverride?: PresetFinishMode) => boolean)
    | null = null
  let stepPreviewHandler:
    | ((step: PresetKeyframeStep, gazeOverride?: boolean) => boolean)
    | null = null

  function registerControlHandler(fn: (control: string, action: DeskpetControlAction) => boolean) {
    controlActionHandler = fn
  }

  function registerSliderSyncHandler(fn: (transitionMs?: number) => boolean) {
    sliderSyncHandler = fn
  }

  function registerPresetTriggerHandler(
    fn: (presetOrId: string | ModelStatePreset, modeOverride?: PresetFinishMode) => boolean,
  ) {
    presetTriggerHandler = fn
  }

  function registerStepPreviewHandler(
    fn: (step: PresetKeyframeStep, gazeOverride?: boolean) => boolean,
  ) {
    stepPreviewHandler = fn
  }

  function applyControlAction(control: string, action: DeskpetControlAction = 'toggle'): boolean {
    if (!controlActionHandler) {
      console.warn('[Deskpet] No control handler registered')
      return false
    }
    return controlActionHandler(control, action)
  }

  function pinHeldControl(controlId: string): boolean {
    const control = modelControls.value.find((c) => c.id === controlId)
    if (!control) return false
    if (!control.active && !applyControlAction(controlId, 'on')) return false
    control.held = true
    return true
  }

  function unpinHeldControl(controlId: string): boolean {
    const control = modelControls.value.find((c) => c.id === controlId)
    if (!control) return false
    if (control.active && !applyControlAction(controlId, 'off')) return false
    control.held = false
    return true
  }

  function toggleHeldControl(controlId: string): boolean {
    const control = modelControls.value.find((c) => c.id === controlId)
    if (!control) return false
    if (control.stages && control.stages.length > 0) {
      const stageCount = control.stages.length
      const defIdx = control.defaultStageIndex ?? 0
      const curIdx = control.currentStageIndex ?? defIdx
      const nextIdx = (curIdx + 1) % stageCount
      if (nextIdx === defIdx && !control.defaultActive) {
        return unpinHeldControl(controlId)
      }
      if (!applyControlAction(controlId, 'toggle')) return false
      control.held = true
      return true
    }
    return control.active ? unpinHeldControl(controlId) : pinHeldControl(controlId)
  }

  function clearHeldControls(): boolean {
    let changed = false
    for (const control of modelControls.value) {
      if (!control.held) continue
      if (control.active) changed = applyControlAction(control.id, 'off') || changed
      control.held = false
    }
    return changed
  }

  function triggerPreset(
    presetOrId: string | ModelStatePreset,
    modeOverride?: PresetFinishMode,
  ): boolean {
    if (presetTriggerHandler) {
      return presetTriggerHandler(presetOrId, modeOverride)
    }
    const id = typeof presetOrId === 'string' ? presetOrId : presetOrId.id
    return applyControlAction(id, 'preset')
  }

  function previewPresetStep(step: PresetKeyframeStep, gazeOverride = true): boolean {
    return stepPreviewHandler?.(step, gazeOverride) ?? false
  }

  function syncSlidersToModel(transitionMs = 0) {
    return sliderSyncHandler?.(transitionMs) ?? false
  }

  // Desktop-host controllers keep their synchronous API. Settings UI uses the
  // asynchronous bridge so an enqueued request is never mistaken for execution.
  const modelActionStatus = ref<'idle' | 'running' | 'success' | 'error'>('idle')
  const modelActionMessage = ref('')
  let actionVersion = 0
  let modelCommandHandler: ((command: PetSettingsCommand) => Promise<PetSettingsCommandResult>) | null = null
  function registerModelCommandHandler(handler: typeof modelCommandHandler) { modelCommandHandler = handler }
  async function requestModelAction(command: PetSettingsCommand): Promise<PetSettingsCommandResult> {
    const version = ++actionVersion
    const labels: Partial<Record<PetSettingsCommand['type'], string>> = {
      'preview-step': '步骤预览', 'trigger-preset': '预设播放', 'sync-sliders': '控件预览',
      'control-action': '模型控件', 'switch-model': '模型切换',
      'preview-head': '头部对照',
      'preview-calibration': '通道校准预览',
      'preview-eyes': '闭眼预览',
      'preview-mouth': '嘴部预览',
      'preview-ambient': '日常表现演示',
      'set-hold-preset': '常驻预设',
    }
    const label = labels[command.type] ?? '模型操作'
    modelActionStatus.value = 'running'
    modelActionMessage.value = `${label}：正在等待桌宠执行…`
    let result: PetSettingsCommandResult
    try { result = await modelCommandHandler?.(command) ?? { ok: false, error: 'bridge-unavailable' } }
    catch { result = { ok: false, error: 'bridge-failed' } }
    if (version === actionVersion) {
      modelActionStatus.value = result.ok ? 'success' : 'error'
      const errors: Record<string, string> = {
        'pet-unavailable': '桌宠窗口不可用，请重新打开桌宠。', 'timeout': '桌宠没有及时回应，请重试。',
        'model-not-ready': 'Live2D 模型尚未就绪或不支持此操作。', 'model-changed': '模型已变化，请确认当前模型后重试。',
        'session-closed': '编辑会话已结束，请重新打开设置。', 'pet-reloaded': '桌宠已重新加载，请重试。',
        'action-rejected': '当前模型无法执行此操作，请检查预设和控件。',
        'workshop-busy': '请先退出工坊预览，再开始表现测试。',
        'head-unavailable': '此模型没有已确认的安全头部通道，暂不能预览。',
        'eyes-unavailable': '此模型没有已确认的安全双眼开合通道，暂不能预览。',
        'mouth-unavailable': '此模型没有已确认的安全嘴形与开合通道，暂不能预览。',
        'ambient-unavailable': '此模型没有可安全驱动的头部、眼睛或嘴形通道，暂不能演示日常表现。',
      }
      modelActionMessage.value = result.ok ? `${label}：桌宠已开始执行。` : `${label}失败：${errors[result.error ?? ''] ?? '请检查桌宠连接后重试。'}`
    }
    return result
  }

  async function releaseModelWorkshop(): Promise<void> {
    actionVersion++
    modelActionStatus.value = 'idle'
    modelActionMessage.value = ''
    try { await modelCommandHandler?.({ type: 'release-workshop' }) } catch { /* main owns final release */ }
  }

  return {
    wsConnected,
    pixiApp,
    live2dModel,
    emotionAdapter,
    modelCapabilities,
    modelLoaded,
    modelUrl,
    modelZoom,
    modelOffsetX,
    modelOffsetY,
    hoverFadeEnabled,
    gazeFollowEnabled,
    clickThroughLocked,
    themeMode,
    accentColor,
    orbAction,
    ttsEnabled,
    ttsProvider,
    ttsEndpoint,
    ttsCloudEndpoint,
    ttsCloudBackend,
    ttsCloudModel,
    ttsCloudVoice,
    ttsCloudStyle,
    ttsAutoStyleFromHost,
    ttsVoice,
    ttsRate,
    ttsVolume,
    ttsSpeakNarration,
    ttsSpeakReplies,
    idleActionsEnabled,
    chatDisplayName,
    interactionEnabled,
    focusActive,
    toggleFocus,
    quietMode,
    settingsSaveError,
    settingsAuthorityMode: computed(() => settingsClient.getMode()),
    settingsRevision,
    settingsUnsavedChanges,
    applyLegacyHoverFade,
    currentEmotion,
    emotionPulse,
    modelEmotions,
    modelControls,
    modelSliders,
    customPresets,
    statePresets,
    defaultStatePresets,
    presetSaveStatus,
    presetSaveMessage,
    activeHoldPresetId,
    effectiveHoldPresetId,
    activeRunningPresetId,
    presetSequenceActive,
    presetEditingLocked,
    presetPreviewActive,
    beginPresetPreview,
    endPresetPreview,
    agentWorkingState,
    agentStateLabel,
    agentActiveToolName,
    pendingApprovals,
    currentApproval,
    enqueueApprovalRequest,
    removeApprovalRequest,
    clearApprovalRequests,
    ensureModelPresetsSeeded,
    restoreDefaultPresets,
    saveCustomPreset,
    deleteCustomPreset,
    exportUserPresets,
    importUserPresets,
    defaultEmotion,
    isThinking,
    isSpeaking,
    pendingAnimation,
    pendingAnimationLoop,
    consumePendingAnimation,
    setModelOffset,
    resetModelView,
    reloadPersistedUiState,
    registerModelSwitcher,
    requestModelSwitch,
    registerControlHandler,
    registerSliderSyncHandler,
    registerPresetTriggerHandler,
    registerStepPreviewHandler,
    applyControlAction,
    pinHeldControl,
    unpinHeldControl,
    toggleHeldControl,
    clearHeldControls,
    triggerPreset,
    previewPresetStep,
    syncSlidersToModel,
    modelActionStatus,
    modelActionMessage,
    registerModelCommandHandler,
    requestModelAction,
    releaseModelWorkshop,
  }
})
