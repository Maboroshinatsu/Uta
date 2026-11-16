import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, globalShortcut, protocol, net, shell, safeStorage, session, dialog, powerMonitor, clipboard, type WebContents } from 'electron'
import path from 'path'
import { createHash, randomUUID } from 'node:crypto'
import type { MotionResult } from '../shared/motion-choreography'
import { SETTINGS_WINDOW_CHANNELS } from '../shared/settings-window-contracts'
import { COMPANION_HTTP_CHANNEL, isCompanionHttpHost } from '../shared/companion-http-contract'
import { requestCompanionHost } from './companion-http'
import { FullscreenVisibility } from './fullscreen-visibility'
import { startWindowsFullscreenProbe } from './win-fullscreen-probe'
import type { VtsParameterSetting } from './vts-import'
import { pathToFileURL } from 'url'
import fs from 'fs'
import {
  startRuntimeBridge,
  windowCommandSink,
  type RuntimeBridge,
  type ModelRuntimeContext,
} from './runtime-bridge'
import { normalizeApprovalDecision, normalizeModelContext } from './runtime-commands'
import type { RuntimeApprovalRequest, RuntimeApprovalDecision } from './runtime-commands'
import { resolveContainedModelFile } from './model-path-safety'
import { createModelImporter } from './model-import'
import { shouldAllowMediaPermission } from './media-permission'
import { synthesizeSpeech } from './tts'
import {
  normalizeCloudConfig,
  mergeCloudTtsConfig,
  normalizePublicCloudConfig,
  sameCloudTtsOwner,
  synthesizeCloudSpeech,
  type CloudTtsConfig,
} from './tts-cloud'
import {
  readVoiceConfigFile,
  shouldBlockVoiceConfigWrite,
  shouldPreserveEncryptedApiKey,
  writeVoiceConfigFile,
} from './voice-config-file'
import { getHostInputStatus, readHostSession, sendHostMessage, sessionFilePath, type HostSessionRecord } from './host-bridge'
import { createChatHistory } from './chat-history'
import { createTodoStore } from './todo-store'
import { createTodoRecovery } from './todo-recovery'
import { completeTodoSession } from './todo-session'
import { createDailyTodoStore, currentOccurrence, dueDailyReminders } from './daily-todo-store'
import { createModelCalibration } from './model-calibration'
import { readHostSessionPreference, resolveHostSessionSelection, writeHostSessionPreference } from './host-session-preference'
import { createCodexSessionStore } from './codex-sessions'
import { readCodexSessionTitle } from './codex-session-titles'
import { cleanSessionTitle } from '../shared/session-title'
import { resolveHostPaths, writeDshHomeOverride, writeHostPathOverride } from './host-paths'
import { resolveAppEnvironment } from '../../../plugin/shared/uta-environment.mjs'
import {
  normalizeSttConfig,
  mergeSttConfig,
  normalizePublicSttConfig,
  sameSttOwner,
  transcribeAudio,
  type SttConfig,
} from './stt'
import { createSettingsStore } from './settings-store'
import { isSettingsPage, isValidSettingsSender, SettingsWindowManager, type SettingsIpcController } from './settings-ipc'
import { initializeSettingsIpc, createSettingsQuitGuard, observeHoverFade, patchHoverFade } from './settings-ipc/lifecycle'
import { registerSettingsWindowLifecycle } from './settings-ipc/window-lifecycle'
import { SettingsPetCommands, registerSettingsPetCommands } from './settings-ipc/pet-commands'
import { readModelPerformanceAssets } from './model-performance-assets'
import { createVoicePreviewHandler } from './settings-ipc/voice-preview'
import { createSettingsImportController } from './settings-ipc/import-preview'
import { inspectStableAuthority } from './settings-store/stable-migration'
import { createSettingsRecoveryController } from './settings-ipc/recovery'
import { createOnboardingStateStore } from './onboarding-state'
import { createHostOnboarding } from './host-onboarding'
import { canonicalPetHostId, createPetBindingStore, isBindableHostId } from './pet-binding'
import { resolveHostEndpointFile } from './host-endpoint'
import { findForeignLiveEndpoint } from './shortcut-scope'
import type { ModelPerformanceAssets } from '../shared/model-performance-contracts'
import type { SettingsService } from '../shared/settings-contracts'


// 在单实例锁、session 和窗口初始化之前确定数据归属。
const environment = resolveAppEnvironment(process.env, {
  appData: app.getPath('appData'),
  sourceDir: app.getAppPath(),
  isPackaged: app.isPackaged,
})
fs.mkdirSync(environment.userData, { recursive: true })
fs.mkdirSync(environment.runtimeDir, { recursive: true })
app.setPath('userData', environment.userData)
app.setPath('sessionData', environment.userData)
Object.assign(process.env, {
  UTA_PROFILE: environment.profile,
  UTA_USER_DATA_DIR: environment.userData,
  UTA_RUNTIME_DIR: environment.runtimeDir,
  UTA_ENDPOINT_FILE: environment.endpointFile,
})
console.info(`[uta] profile=${environment.profile} userData=${environment.userData} endpoint=${environment.endpointFile}`)

const petBindingStore = createPetBindingStore(environment.runtimeDir)
const codexConversations = createCodexSessionStore(environment.runtimeDir)
if (codexConversations.list().length === 0) {
  const pinned = readHostSessionPreference(environment.runtimeDir, 'codex')
  const saved = readHostSession(app.getPath('appData'), 'codex', environment.runtimeDir, pinned?.sessionId)
  if (saved) codexConversations.observe({ command: 'session_bind', cwd: saved.cwd },
    { hostId: 'codex', sessionId: saved.sessionId }, saved.updatedAt)
}
const modelCalibration = createModelCalibration(environment.userData)
const requestedBoundHost = typeof process.env.UTA_BOUND_HOST === 'string'
  ? process.env.UTA_BOUND_HOST.trim()
  : ''
const canonicalBoundHost = canonicalPetHostId(requestedBoundHost)
const explicitBoundHost = isBindableHostId(canonicalBoundHost) ? canonicalBoundHost : ''
if (requestedBoundHost && !explicitBoundHost) {
  console.warn(`[uta] ignoring unknown UTA_BOUND_HOST: ${requestedBoundHost}`)
} else if (explicitBoundHost) {
  const result = petBindingStore.bind(explicitBoundHost)
  if (!result.ok) console.warn(`[uta] cannot apply UTA_BOUND_HOST: ${result.error}`)
}
let boundHostId = petBindingStore.get()?.hostId ?? ''
let dailyReminderTimer: ReturnType<typeof setInterval> | null = null
let checkDailyReminders: (() => void) | undefined

function boundHostEndpointFile(hostId: string): string {
  return resolveHostEndpointFile(app.getPath('appData'), hostId, {
    isStable: environment.isStable,
    explicitBoundHost,
    pairedHost: petBindingStore.get()?.sharedDiscovery ? petBindingStore.get()?.hostId : undefined,
  })
}
if (!environment.isStable && !explicitBoundHost && !petBindingStore.get()?.sharedDiscovery) {
  console.info('[uta] development profile: shared host endpoint disabled; use UTA_ENDPOINT_FILE for explicit routing')
}

function notifyPetBindingChanged(): void {
  const payload = { binding: petBindingStore.get() }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('pet-binding-changed', payload)
  }
}

// The preload reads this synchronously before the renderer chooses its initial
// host adapter; one pet profile can never inherit another profile's host.
ipcMain.on('pet-binding', event => {
  event.returnValue = { binding: petBindingStore.get() }
})
const onboardingState = createOnboardingStateStore(environment.userData)
const buildInfo = (() => {
  if (app.isPackaged) {
    try {
      return JSON.parse(fs.readFileSync(path.join(__dirname, '../build-info.json'), 'utf8'))
    } catch { /* 未附带来源清单的旧包不伪造构建身份。 */ }
  }
  return { commit: null, dirty: null, builtAt: null }
})()

// 单实例锁：避免两个实例同时写同一份 endpoint 文件、互相顶掉 token
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}

app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('in-process-gpu')

// 打包后渲染层经 file:// 加载，fetch/XHR 拿不到 out/renderer 之外的模型文件，
// 注册自定义协议把 models 根目录暴露成 uta://models/<relative>
protocol.registerSchemesAsPrivileged([
  { scheme: 'uta', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

const MIN_WINDOW_WIDTH = 260
const MIN_WINDOW_HEIGHT = 360
const SHORTCUTS = {
  toggleVisible: 'CommandOrControl+Alt+H',
  toggleHoverFade: 'CommandOrControl+Alt+F',
  toggleClickThrough: 'CommandOrControl+Alt+L',
  toggleVoiceInput: 'CommandOrControl+Alt+V',
}

interface WindowBoundsState {
  x: number
  y: number
  width: number
  height: number
}

interface WindowState {
  bounds: WindowBoundsState
  alwaysOnTop: boolean
  clickThroughLocked: boolean
  hoverFadeEnabled: boolean
  summonOnHostStart: boolean
}

interface ModelEntry {
  /** 展示名，取自模型文件夹名 + 文件名 */
  name: string
  /** 模型适配文件里的可读名（如 Hiyori Pro），没有则为空 */
  displayName?: string
  /** 渲染层可直接加载的相对 URL，例如 ./models/xxx/xxx.model3.json */
  url: string
  /** live2d = .model3.json；image-set = 静态立绘包（deskpet-images.json） */
  kind: 'live2d' | 'image-set'
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clampWindowBounds(bounds: WindowBoundsState): WindowBoundsState {
  const display = screen.getDisplayMatching(bounds)
  const area = display.workArea
  const minVisibleSize = 120
  const navBarHalfSpan = 88 // 底部居中导航条宽 160px（半宽 80px + 8px 余量）
  const width = Math.max(bounds.width, MIN_WINDOW_WIDTH)
  const height = Math.max(bounds.height, MIN_WINDOW_HEIGHT)

  // 水平方向保证居中导航条始终留在工作区内；
  // 垂直方向保证窗口底边（导航条所在处 bottom: 4px）绝不越过工作区底边进入任务栏。
  const minVisibleX = Math.min(width, Math.max(minVisibleSize, Math.ceil(width / 2 + navBarHalfSpan)))
  const minX = area.x + minVisibleX - width
  const maxX = area.x + area.width - minVisibleX
  const maxY = area.y + area.height - height
  const minY = Math.min(area.y + minVisibleSize - height, maxY)

  return {
    width,
    height,
    x: clamp(bounds.x, Math.min(minX, maxX), Math.max(minX, maxX)),
    y: clamp(bounds.y, minY, maxY),
  }
}

function getDefaultWindowBounds(width = 600, height = 800): WindowBoundsState {
  const display = screen.getPrimaryDisplay()
  const area = display.workArea
  const safeWidth = Math.min(width, area.width)
  const safeHeight = Math.min(height, area.height)
  return {
    width: safeWidth,
    height: safeHeight,
    x: area.x + area.width - safeWidth - 20,
    y: area.y + area.height - safeHeight - 20,
  }
}

function resetWindowPosition(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const bounds = getDefaultWindowBounds(lastSavedBounds.width, lastSavedBounds.height)
  applyWindowBounds(bounds)
  saveWindowState()
}

function resetAllLayout(): void {
  resetWindowPosition()
  mainWindow?.webContents.send('reset-model-view')
}

function getWindowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json')
}

/** 声明式适配器插件目录（用户可放入/删除，不含可执行代码） */
function getAdaptersRoot(): string {
  return path.join(app.getPath('userData'), 'adapters')
}


/**
 * models 目录在 dev 与打包后位置不同：
 *   dev   → <project>/src/renderer/public/models（vite 直接从 public 提供）
 *   build → out/renderer/models（public 内容被拷到 renderer 输出目录）
 */
function getModelsRoot(): string | null {
  const built = path.join(__dirname, '../renderer/models')
  const source = path.join(app.getAppPath(), 'src/renderer/public/models')
  const candidates = app.isPackaged
    ? [built, path.join(process.resourcesPath, 'models')]
    : [source, built]
  for (const dir of candidates) {
    try {
      if (fs.statSync(dir).isDirectory()) return dir
    } catch {
      // 试下一个候选路径
    }
  }
  return null
}

/**
 * 用户模型目录：重装打包版时 NSIS 会清空安装目录（resources/models 里的
 * 自定义模型全没），而 userData 不动 —— 自定义模型/立绘包都应放这里。
 */
function getUserModelsRoot(): string {
  return path.join(app.getPath('userData'), 'models')
}

interface ModelRoot {
  fsPath: string
  /** bundled = 随包/源码目录（dev 下走 vite 相对 URL）；user = userData（一律走 uta://） */
  kind: 'bundled' | 'user'
}

/** 扫描顺序：用户目录在前（允许覆盖随包模型），随包目录在后 */
function getModelsRoots(): ModelRoot[] {
  const roots: ModelRoot[] = [{ fsPath: getUserModelsRoot(), kind: 'user' }]
  const bundled = getModelsRoot()
  if (bundled) roots.push({ fsPath: bundled, kind: 'bundled' })
  return roots
}

function readJsonDisplayName(file: string): string {
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile() || stat.size > 64 * 1024) return ''
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: unknown }
    return typeof parsed?.name === 'string' ? parsed.name.trim().slice(0, 60) : ''
  } catch {
    return ''
  }
}

function scanModelFiles(root: ModelRoot): ModelEntry[] {
  const found: ModelEntry[] = []
  const MAX_DEPTH = 5

  const makeUrl = (relative: string): string => {
    // Encode each segment once; a literal # or % must not become a URL fragment/escape.
    const encoded = relative.split('/').map((segment) => encodeURIComponent(segment)).join('/')
    if (root.kind === 'user' || app.isPackaged) return `uta://models/${encoded}`
    return `./models/${encoded}`
  }

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.model3.json')) {
        const relative = path.relative(root.fsPath, full).split(path.sep).join('/')
        const base = entry.name.replace(/\.model3\.json$/i, '')
        const topFolder = relative.includes('/') ? relative.split('/')[0] : ''
        const displayName = readJsonDisplayName(path.join(path.dirname(full), 'deskpet-adapter.json'))
        found.push({
          name: !topFolder || topFolder === base ? base : `${topFolder} / ${base}`,
          ...(displayName ? { displayName } : {}),
          url: makeUrl(relative),
          kind: 'live2d',
        })
      } else if (entry.isFile() && entry.name === 'deskpet-images.json') {
        const relative = path.relative(root.fsPath, full).split(path.sep).join('/')
        const topFolder = relative.includes('/') ? relative.split('/')[0] : ''
        const displayName = readJsonDisplayName(full)
        found.push({
          name: topFolder || '立绘包',
          ...(displayName ? { displayName } : {}),
          url: makeUrl(relative),
          kind: 'image-set',
        })
      }
    }
  }

  walk(root.fsPath, 0)
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

function listModels(): ModelEntry[] {
  const merged: ModelEntry[] = []
  const seenRel = new Set<string>()
  for (const root of getModelsRoots()) {
    for (const entry of scanModelFiles(root)) {
      const relKey = entry.url.replace(/^uta:\/\/models\//, '').replace(/^\.\/models\//, '')
      if (seenRel.has(relKey)) continue
      seenRel.add(relKey)
      merged.push(entry)
    }
  }
  return merged.sort((a, b) => a.name.localeCompare(b.name))
}

export interface ModelExpressionAsset {
  name: string
  file: string
  registeredName?: string
  parameters: Array<{
    id: string
    value: number
    blend?: string
  }>
}

export interface ModelDiskPresetStep {
  label?: string
  durationMs: number
  holdMs: number
  controls: string[]
  parameters: Record<string, number>
  motion?: { group: string; index?: number }
}

export interface ModelDiskPreset {
  id: string
  label: string
  description: string
  emotion: string
  group?: string
  controls: string[]
  parameters?: Record<string, number>
  steps?: ModelDiskPresetStep[]
  finishMode?: 'hold' | 'revert' | 'loop'
  revertHoldMs?: number
  motion?: { group: string; index?: number } | 'none'
  custom?: boolean
  source?: 'user'
}

export interface ModelDiskAssets {
  performance?: ModelPerformanceAssets | null
  cdiParameters: Record<string, { name: string; group: string }>
  cdiParts: Record<string, string>
  physicsOutputIds: string[]
  vtubeHotkeys: Record<string, string>
  vtubeParameters?: Array<{ input: string; output: string }>
  vtubeFocusBindings?: Array<{ input: string; output: string; lower?: number; upper?: number }>
  expressions: ModelExpressionAsset[]
  /** 被 .motion3.json 驱动过的参数（用于把道具/动画内部通道从手动滑块中排除） */
  motionParameterIds?: string[]
  motionDetails?: Record<string, { durationMs?: number; loop?: boolean }>
  poseGroups?: string[][]
  savedPresets?: ModelDiskPreset[] | null
}

const MODEL_PRESETS_FILENAME = 'deskpet-presets.json'

function sanitizeParamRecord(raw: unknown): Record<string, number> {
  const cleanParams: Record<string, number> = {}
  if (raw && typeof raw === 'object') {
    for (const [pid, pval] of Object.entries(raw as Record<string, unknown>)) {
      const num = Number(pval)
      if (pid && Number.isFinite(num)) cleanParams[pid] = num
    }
  }
  return cleanParams
}

function sanitizeDiskMotion(raw: unknown): { group: string; index?: number } | 'none' | undefined {
  if (raw === 'none') return 'none'
  if (!raw || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  if (typeof rec.group !== 'string') return undefined
  const index = Number(rec.index)
  return Number.isFinite(index) && index >= 0
    ? { group: rec.group, index: Math.floor(index) }
    : { group: rec.group }
}

function sanitizeModelPresets(raw: unknown): ModelDiskPreset[] | null {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { presets?: unknown }).presets)
      ? (raw as { presets: unknown[] }).presets
      : null
  if (!list) return null
  const result: ModelDiskPreset[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const id = String(rec.id || '').trim()
    const label = String(rec.label || '').trim()
    if (!id || !label) continue
    const rawGroup = typeof rec.group === 'string' ? rec.group.trim() : ''
    const cleanParams = sanitizeParamRecord(rec.parameters)
    let cleanSteps: ModelDiskPresetStep[] | undefined
    if (Array.isArray(rec.steps) && rec.steps.length > 0) {
      const parsedSteps: ModelDiskPresetStep[] = []
      for (const st of rec.steps) {
        if (!st || typeof st !== 'object') continue
        const srec = st as Record<string, unknown>
        const dur = Number(srec.durationMs)
        const hold = Number(srec.holdMs)
        const stepMotion = sanitizeDiskMotion(srec.motion)
        parsedSteps.push({
          ...(typeof srec.label === 'string' && srec.label.trim()
            ? { label: srec.label.trim() }
            : {}),
          durationMs: Number.isFinite(dur) ? Math.max(40, Math.min(5000, Math.round(dur))) : 350,
          holdMs: Number.isFinite(hold) ? Math.max(0, Math.min(10000, Math.round(hold))) : 150,
          controls: Array.isArray(srec.controls)
            ? srec.controls.map((c) => String(c).trim()).filter(Boolean)
            : [],
          parameters: sanitizeParamRecord(srec.parameters),
          ...(stepMotion && typeof stepMotion === 'object' ? { motion: stepMotion } : {}),
        })
      }
      if (parsedSteps.length > 0) cleanSteps = parsedSteps
    }
    const rawFinish = String(rec.finishMode || '').trim()
    const finishMode: 'hold' | 'revert' | 'loop' | undefined =
      rawFinish === 'hold' || rawFinish === 'revert' || rawFinish === 'loop'
        ? rawFinish
        : undefined
    const rawRevertHold = Number(rec.revertHoldMs)
    const revertHoldMs = Number.isFinite(rawRevertHold)
      ? Math.max(0, Math.min(15000, Math.round(rawRevertHold)))
      : undefined
    const motion = sanitizeDiskMotion(rec.motion)

    result.push({
      id,
      label,
      description: String(rec.description || '').trim(),
      emotion: String(rec.emotion || 'neutral').trim() || 'neutral',
      ...(rawGroup ? { group: rawGroup } : {}),
      controls: Array.isArray(rec.controls)
        ? rec.controls.map((c) => String(c).trim()).filter(Boolean)
        : [],
      parameters: cleanParams,
      ...(cleanSteps ? { steps: cleanSteps } : {}),
      ...(finishMode ? { finishMode } : {}),
      ...(revertHoldMs !== undefined ? { revertHoldMs } : {}),
      ...(motion !== undefined ? { motion } : {}),
      custom: true,
      ...(rec.source === 'user' ? { source: 'user' as const } : {}),
    })
  }
  return result
}

function resolveModelFilePath(modelUrl: string): string | null {
  if (!modelUrl || typeof modelUrl !== 'string') return null
  let rel = ''
  try {
    if (modelUrl.startsWith('uta://models/') || modelUrl.startsWith('deskpet://models/')) {
      const parsed = new URL(modelUrl)
      rel = decodeURIComponent(parsed.pathname).replace(/^\/+/, '')
    } else if (modelUrl.startsWith('./models/')) {
      rel = decodeURIComponent(modelUrl.slice('./models/'.length)).replace(/^\/+/, '')
    } else if (modelUrl.startsWith('/models/')) {
      rel = decodeURIComponent(modelUrl.slice('/models/'.length)).replace(/^\/+/, '')
    } else {
      const parsed = new URL(modelUrl)
      const idx = parsed.pathname.indexOf('/models/')
      if (idx >= 0) {
        rel = decodeURIComponent(parsed.pathname.slice(idx + '/models/'.length)).replace(/^\/+/, '')
      }
    }
  } catch {
    return null
  }
  if (!rel) return null
  return resolveContainedModelFile(
    getModelsRoots().map((root) => root.fsPath),
    rel,
  )
}

function inspectModelAssets(modelUrl: string): ModelDiskAssets | null {
  const modelFile = resolveModelFilePath(modelUrl)
  if (!modelFile) return null
  const modelDir = path.dirname(modelFile)

  const cdiParameters: Record<string, { name: string; group: string }> = {}
  const cdiParts: Record<string, string> = {}
  const physicsOutputSet = new Set<string>()
  const vtubeHotkeys: Record<string, string> = {}
  const expressions: ModelExpressionAsset[] = []
  const registeredExpressions = new Map<string, string>()
  let references: Record<string, any> = {}
  try {
    const manifest = JSON.parse(fs.readFileSync(modelFile, 'utf-8'))
    if (manifest?.FileReferences && typeof manifest.FileReferences === 'object') references = manifest.FileReferences
    for (const expression of manifest?.FileReferences?.Expressions ?? []) {
      if (typeof expression?.File === 'string' && typeof expression?.Name === 'string') {
        registeredExpressions.set(expression.File.replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase(), expression.Name)
      }
    }
  } catch {
    // 单个清单不可读不妨碍发现目录中可解析的资源。
  }

  const cdiFiles: string[] = []
  const physicsFiles: string[] = []
  const vtubeFiles: string[] = []
  const expFiles: string[] = []
  const motionFiles: string[] = []
  const poseFiles: string[] = []
  const poseGroups: string[][] = []

  const walkAssets = (dir: string, depth: number): void => {
    if (depth > 2) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walkAssets(full, depth + 1)
      } else if (entry.isFile()) {
        const lower = entry.name.toLowerCase()
        if (lower.endsWith('.cdi3.json')) cdiFiles.push(full)
        else if (lower.endsWith('.physics3.json')) physicsFiles.push(full)
        else if (lower.endsWith('.vtube.json')) vtubeFiles.push(full)
        else if (lower.endsWith('.exp3.json')) expFiles.push(full)
        else if (lower.endsWith('.motion3.json')) motionFiles.push(full)
        else if (lower.endsWith('.pose3.json')) poseFiles.push(full)
      }
    }
  }

  walkAssets(modelDir, 0)

  // 清单是资源归属的依据：已声明资源不受目录兜底扫描深度影响；CDI/物理/姿态优先使用当前模型声明。
  const declaredFiles = (files: unknown[]): string[] => files.flatMap(file => {
    if (typeof file !== 'string') return []
    const resolved = resolveContainedModelFile([modelDir], file.replaceAll('\\', '/'))
    return resolved ? [resolved] : []
  })
  for (const [target, reference] of [[cdiFiles, references.DisplayInfo], [physicsFiles, references.Physics], [poseFiles, references.Pose]] as const) {
    const files = declaredFiles([reference])
    if (files.length) target.splice(0, target.length, ...files)
  }
  const expressionRefs = Array.isArray(references.Expressions) ? references.Expressions.map((entry: any) => entry?.File) : []
  const motionRefs = references.Motions && typeof references.Motions === 'object'
    ? Object.values(references.Motions).flatMap(group => Array.isArray(group) ? group.map((entry: any) => entry?.File) : []) : []
  for (const [target, refs] of [[expFiles, expressionRefs], [motionFiles, motionRefs]] as const) {
    for (const file of declaredFiles(refs)) if (!target.includes(file)) target.push(file)
  }

  for (const posePath of poseFiles) {
    try {
      const pose = JSON.parse(fs.readFileSync(posePath, 'utf-8'))
      if (Array.isArray(pose?.Groups)) {
        for (const group of pose.Groups) {
          if (!Array.isArray(group)) continue
          const partIds = group
            .map((entry: any) => (typeof entry?.Id === 'string' ? entry.Id.trim() : ''))
            .filter(Boolean)
          if (partIds.length >= 2) {
            poseGroups.push(partIds)
          }
        }
      }
    } catch {
      // ignore malformed pose3.json
    }
  }

  for (const cdiPath of cdiFiles) {
    try {
      const cdi = JSON.parse(fs.readFileSync(cdiPath, 'utf-8'))
      const groups: Record<string, string> = {}
      if (Array.isArray(cdi?.ParameterGroups)) {
        for (const g of cdi.ParameterGroups) {
          if (typeof g?.Id === 'string') {
            groups[g.Id] = typeof g?.Name === 'string' ? g.Name.trim() : ''
          }
        }
      }
      if (Array.isArray(cdi?.Parameters)) {
        for (const p of cdi.Parameters) {
          if (typeof p?.Id === 'string') {
            cdiParameters[p.Id] = {
              name: typeof p?.Name === 'string' ? p.Name.trim() : '',
              group: typeof p?.GroupId === 'string' ? (groups[p.GroupId] ?? '') : '',
            }
          }
        }
      }
      if (Array.isArray(cdi?.Parts)) {
        for (const part of cdi.Parts) {
          if (typeof part?.Id === 'string' && typeof part?.Name === 'string') {
            cdiParts[part.Id] = part.Name.trim()
          }
        }
      }
    } catch {
      // ignore malformed cdi3.json
    }
  }

  for (const physPath of physicsFiles) {
    try {
      const phys = JSON.parse(fs.readFileSync(physPath, 'utf-8'))
      if (Array.isArray(phys?.PhysicsSettings)) {
        for (const setting of phys.PhysicsSettings) {
          if (!Array.isArray(setting?.Output)) continue
          for (const out of setting.Output) {
            const destId = out?.Destination?.Id
            if (typeof destId === 'string' && destId) {
              physicsOutputSet.add(destId)
            }
          }
        }
      }
    } catch {
      // ignore malformed physics3.json
    }
  }

  const vtubeParameters: Array<{ input: string; output: string }> = []
  const vtubeFocusBindings: NonNullable<ModelDiskAssets['vtubeFocusBindings']> = []
  const modelVtubeFile = modelFile.replace(/\.model3\.json$/i, '.vtube.json').toLowerCase()
  for (const vtPath of vtubeFiles) {
    try {
      const vt = JSON.parse(fs.readFileSync(vtPath, 'utf-8'))
      if (Array.isArray(vt?.Hotkeys)) {
        for (const hk of vt.Hotkeys) {
          if (typeof hk?.File === 'string' && hk.File && typeof hk?.Name === 'string' && hk.Name.trim()) {
            vtubeHotkeys[hk.File] = hk.Name.trim()
          }
        }
      }
      if (Array.isArray(vt?.ParameterSettings)) {
        for (const ps of vt.ParameterSettings as VtsParameterSetting[]) {
          if (typeof ps?.OutputLive2D === 'string' && ps.OutputLive2D) {
            const binding = {
              input: typeof ps?.Input === 'string' ? ps.Input : '',
              output: ps.OutputLive2D,
            }
            vtubeParameters.push(binding)
            if (vtPath.toLowerCase() === modelVtubeFile) {
              const lower = ps.OutputRangeLower
              const upper = ps.OutputRangeUpper
              vtubeFocusBindings.push({
                ...binding,
                ...(typeof lower === 'number' && Number.isFinite(lower) ? { lower } : {}),
                ...(typeof upper === 'number' && Number.isFinite(upper) ? { upper } : {}),
              })
            }
          }
        }
      }
    } catch {
      // ignore malformed vtube.json
    }
  }

  expFiles.sort((a, b) => a.localeCompare(b))
  for (const expPath of expFiles) {
    try {
      const exp = JSON.parse(fs.readFileSync(expPath, 'utf-8'))
      if (!Array.isArray(exp?.Parameters)) continue
      const params: Array<{ id: string; value: number; blend?: string }> = []
      for (const p of exp.Parameters) {
        if (typeof p?.Id === 'string' && typeof p?.Value === 'number') {
          params.push({
            id: p.Id,
            value: p.Value,
            ...(typeof p?.Blend === 'string' ? { blend: p.Blend } : {}),
          })
        }
      }
      const baseName = path.basename(expPath)
      const stem = baseName.replace(/\.exp3\.json$/i, '')
      const relativeFile = path.relative(modelDir, expPath).replaceAll('\\', '/')
      const registeredName = registeredExpressions.get(relativeFile.toLowerCase())
      expressions.push({
        name: stem,
        file: relativeFile,
        ...(registeredName ? { registeredName } : {}),
        parameters: params,
      })
    } catch {
      // ignore malformed exp3.json
    }
  }

  const motionParameterSet = new Set<string>()
  const motionDetails: Record<string, { durationMs?: number; loop?: boolean }> = {}
  for (const motionPath of motionFiles) {
    try {
      const motion = JSON.parse(fs.readFileSync(motionPath, 'utf-8'))
      const relativeFile = path.relative(modelDir, motionPath).replaceAll('\\', '/')
      const dur = typeof motion?.Meta?.Duration === 'number' ? Math.round(motion.Meta.Duration * 1000) : undefined
      const loop = typeof motion?.Meta?.Loop === 'boolean' ? motion.Meta.Loop : undefined
      if (dur !== undefined || loop !== undefined) {
        motionDetails[relativeFile] = {
          ...(dur !== undefined ? { durationMs: dur } : {}),
          ...(loop !== undefined ? { loop } : {}),
        }
      }
    } catch {}

    try {
      const motion = JSON.parse(fs.readFileSync(motionPath, 'utf-8'))
      if (!Array.isArray(motion?.Curves)) continue
      for (const curve of motion.Curves) {
        if (typeof curve?.Id === 'string' && curve.Id) motionParameterSet.add(curve.Id)
      }
    } catch {
      // ignore malformed motion3.json
    }
  }

  let savedPresets: ModelDiskPreset[] | null = null
  const presetsPath = path.join(modelDir, MODEL_PRESETS_FILENAME)
  try {
    if (fs.existsSync(presetsPath) && fs.statSync(presetsPath).isFile()) {
      const rawPresets = JSON.parse(fs.readFileSync(presetsPath, 'utf-8'))
      savedPresets = sanitizeModelPresets(rawPresets)
    }
  } catch (error) {
    // 文件存在但读不动/解析失败要留下痕迹：否则首次导入的模型会静默没有预设。
    if (fs.existsSync(presetsPath)) {
      console.warn(`[Deskpet] 忽略损坏的模型侧车预设 ${presetsPath}：`, error)
    }
  }

  const performanceAssets = readModelPerformanceAssets(modelFile)
  if (performanceAssets) performanceAssets.calibration = modelCalibration.get(performanceAssets.modelSignature)
  return {
    cdiParameters,
    performance: performanceAssets,
    cdiParts,
    physicsOutputIds: [...physicsOutputSet],
    vtubeHotkeys,
    ...(vtubeParameters.length > 0 ? { vtubeParameters } : {}),
    ...(vtubeFocusBindings.length > 0 ? { vtubeFocusBindings } : {}),
    expressions,
    ...(motionParameterSet.size > 0 ? { motionParameterIds: [...motionParameterSet] } : {}),
    ...(Object.keys(motionDetails).length > 0 ? { motionDetails } : {}),
    poseGroups,
    savedPresets,
  }
}

/** 目录内是否存在可用模型清单（.model3.json 或 deskpet-images.json） */
export function hasModelManifest(dir: string, depth = 3): boolean {
  if (depth < 0) return false
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    const lower = entry.name.toLowerCase()
    if (entry.isFile()) {
      if (lower.endsWith('.model3.json') || lower === 'deskpet-images.json') return true
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory() && hasModelManifest(path.join(dir, entry.name), depth - 1)) return true
  }
  return false
}

export function measureDir(dir: string): { files: number; bytes: number } {
  const acc = { files: 0, bytes: 0 }
  const walk = (d: string, depth: number): void => {
    if (depth < 0) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full, depth - 1)
      else if (entry.isFile()) {
        acc.files += 1
        try {
          acc.bytes += fs.statSync(full).size
        } catch {
          /* 计不到大小就按文件数判定 */
        }
      }
    }
  }
  walk(dir, 6)
  return acc
}

/**
 * 原子迁移单个模型目录：先复制到 .incoming，校验清单齐备且体量不缩水，再改名落地。
 * 已存在的目标一律不动 —— 那可能是上次中断的半套复制，也可能是用户自己放的目录，
 * 程序无权替用户改名或删除。
 */
export function migrateModelDir(src: string, dest: string, sourceLabel: string): boolean {
  if (fs.existsSync(dest)) return false

  const incoming = `${dest}.incoming`
  try {
    fs.rmSync(incoming, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(src, incoming, { recursive: true })

    if (!hasModelManifest(incoming)) {
      console.warn(
        `[uta] 跳过迁移「${path.basename(src)}」：源目录里没有 .model3.json 或 deskpet-images.json，复制过来也无法加载（来源 ${sourceLabel}）`,
      )
      return false
    }
    const from = measureDir(src)
    const to = measureDir(incoming)
    if (to.files < from.files || to.bytes < from.bytes) {
      console.warn(
        `[uta] 跳过迁移「${path.basename(src)}」：复制结果不完整（${to.files}/${from.files} 个文件），已放弃本次复制，下次启动会重试`,
      )
      return false
    }

    fs.renameSync(incoming, dest)
    console.info(`[uta] 用户模型已迁移到 userData: ${path.basename(src)}（来源 ${sourceLabel}）`)
    return true
  } catch (err) {
    console.warn(`[uta] 迁移「${path.basename(src)}」失败，下次启动会重试:`, err)
    return false
  } finally {
    try {
      if (fs.existsSync(incoming)) fs.rmSync(incoming, { recursive: true, force: true })
    } catch {
      /* 清不掉临时目录也只是留个 .incoming，不影响现有模型 */
    }
  }
}

const warnedUnusableModelDirs = new Set<string>()

/** 把扫不出清单的顶层目录说出来，而不是让它在列表里静默消失 */
/** 只用于启动提示：限时/限条目地数文件，避免误拖入的大目录阻塞主线程。 */
function countFilesQuick(dir: string, maxMs = 60, maxEntries = 4000): { files: number; complete: boolean } {
  const startedAt = Date.now()
  let files = 0
  let visited = 0
  let complete = true
  const walk = (current: string, depth: number): void => {
    if (!complete || depth < 0) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      visited += 1
      if (visited > maxEntries || Date.now() - startedAt > maxMs) {
        complete = false
        return
      }
      if (entry.isDirectory()) walk(path.join(current, entry.name), depth - 1)
      else if (entry.isFile()) files += 1
    }
  }
  walk(dir, 6)
  return { files, complete }
}

function reportUnusableModelDirs(root: string): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === 'node_modules' || entry.name.endsWith('.incoming')) continue
    const full = path.join(root, entry.name)
    if (hasModelManifest(full)) continue
    if (warnedUnusableModelDirs.has(full)) continue
    warnedUnusableModelDirs.add(full)
    const counted = countFilesQuick(full)
    const fileText = counted.complete ? `${counted.files} 个文件` : `至少 ${counted.files} 个文件`
    console.warn(
      `[uta] 模型目录「${entry.name}」缺少 .model3.json / deskpet-images.json（内含 ${fileText}），不会出现在模型列表里；如是误拖进来的贴图子目录或空壳，可以删掉。`,
    )
  }
}

/** 随包目录里非自带的文件夹视为用户模型，一次性迁到 userData（之后重装不再丢） */
function migrateUserModelsOnce(): void {
  const BUNDLED_SET = new Set(['hiyori_pro_zh', 'sample_static', 'README.md'])
  const userRoot = getUserModelsRoot()

  const bundled = getModelsRoot()
  if (bundled) {
    try {
      for (const entry of fs.readdirSync(bundled, { withFileTypes: true })) {
        if (!entry.isDirectory() || BUNDLED_SET.has(entry.name)) continue
        migrateModelDir(path.join(bundled, entry.name), path.join(userRoot, entry.name), '安装目录')
      }
    } catch (err) {
      console.warn('[uta] 用户模型迁移异常:', err)
    }
  }

  // 兼容从 maibot-deskpet 升级过来的用户，安全迁移旧模型
  try {
    const legacyMaibotRoot = path.join(app.getPath('appData'), 'maibot-deskpet', 'models')
    if (fs.existsSync(legacyMaibotRoot) && legacyMaibotRoot !== userRoot) {
      for (const entry of fs.readdirSync(legacyMaibotRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || BUNDLED_SET.has(entry.name)) continue
        migrateModelDir(
          path.join(legacyMaibotRoot, entry.name),
          path.join(userRoot, entry.name),
          'maibot-deskpet 旧路径',
        )
      }
    }
  } catch (err) {
    console.warn('[uta] 旧路径用户模型迁移异常:', err)
  }

  reportUnusableModelDirs(userRoot)
}

function loadWindowState(): WindowState {
  try {
    const parsed = JSON.parse(fs.readFileSync(getWindowStatePath(), 'utf-8')) as Partial<WindowState & WindowBoundsState>
    const sourceBounds = 'bounds' in parsed && parsed.bounds ? parsed.bounds : parsed
    return {
      bounds: clampWindowBounds({
        width: typeof sourceBounds.width === 'number' ? sourceBounds.width : 600,
        height: typeof sourceBounds.height === 'number' ? sourceBounds.height : 800,
        x: typeof sourceBounds.x === 'number' ? sourceBounds.x : 100,
        y: typeof sourceBounds.y === 'number' ? sourceBounds.y : 100,
      }),
      alwaysOnTop: typeof parsed.alwaysOnTop === 'boolean' ? parsed.alwaysOnTop : true,
      clickThroughLocked: typeof parsed.clickThroughLocked === 'boolean' ? parsed.clickThroughLocked : false,
      hoverFadeEnabled: typeof parsed.hoverFadeEnabled === 'boolean' ? parsed.hoverFadeEnabled : false,
      summonOnHostStart:
        typeof parsed.summonOnHostStart === 'boolean' ? parsed.summonOnHostStart : true,
    }
  } catch {
    return {
      bounds: getDefaultWindowBounds(),
      alwaysOnTop: true,
      clickThroughLocked: false,
      hoverFadeEnabled: false,
      summonOnHostStart: true,
    }
  }
}

let enforcingWindowBounds = false
let lastDragAt = 0

function applyWindowBounds(next: WindowBoundsState): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  enforcingWindowBounds = true
  try {
    lastSavedBounds = next
    mainWindow.setBounds(next)
  } finally {
    enforcingWindowBounds = false
  }
}

function enforceWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || enforcingWindowBounds) return
  if (Date.now() - lastDragAt < 150) return
  const current = mainWindow.getBounds()
  const width = Math.abs(current.width - lastSavedBounds.width) > 2 ? current.width : lastSavedBounds.width
  const height = Math.abs(current.height - lastSavedBounds.height) > 2 ? current.height : lastSavedBounds.height
  const candidate = { x: current.x, y: current.y, width, height }
  const next = clampWindowBounds(candidate)
  if (current.x !== next.x || current.y !== next.y || width !== next.width || height !== next.height) {
    applyWindowBounds(next)
  } else {
    lastSavedBounds = next
  }
}

let saveStateTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSaveWindowState(): void {
  if (saveStateTimer) clearTimeout(saveStateTimer)
  saveStateTimer = setTimeout(() => {
    saveStateTimer = null
    saveWindowState()
  }, 500)
}

function saveWindowState(): boolean {
  if (saveStateTimer) {
    clearTimeout(saveStateTimer)
    saveStateTimer = null
  }
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(getWindowStatePath(), JSON.stringify({
      bounds: lastSavedBounds,
      alwaysOnTop,
      clickThroughLocked,
      hoverFadeEnabled: environment.isStable ? hoverFadeEnabled : undefined,
      summonOnHostStart,
    }, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
}

let mainWindow: BrowserWindow | null = null

/** P2/L0：宿主侧插件投递角色指令与审批的本机端点（仅回环 + 令牌） */
const SETTINGS_DOMAIN_IDS = new Set(['character', 'connections', 'todo', 'voice', 'desktop', 'appearance', 'about'])
const RUNTIME_COMMAND_CHANNEL = 'runtime-command'
const RUNTIME_APPROVAL_REQUEST_CHANNEL = 'runtime-approval-request'
const RUNTIME_APPROVAL_CANCEL_CHANNEL = 'runtime-approval-cancel'
let runtimeBridge: RuntimeBridge | null = null
/** 渲染层是否已完成角色指令订阅；未就绪时不得谎报投递成功 */
let runtimeCommandReady = false

/** 待决的交互式工具审批请求表：requestId -> resolve(decision) */
const pendingApprovals = new Map<string, (decision: RuntimeApprovalDecision) => void>()
/** 审批期间是否临时提升过窗口层级；审批结束后必须恢复用户设置 */
let approvalTopmostActive = false

const RENDERER_RECOVERY_WINDOW_MS = 60_000
const MAX_RENDERER_RECOVERY_ATTEMPTS = 2
let rendererRecoveryAttempts = 0
let rendererRecoveryStartedAt = 0
let rendererRecoveryTimer: NodeJS.Timeout | null = null
let isQuitting = false

/** 手动重载清空自动恢复计数；崩溃后只在窗口期内重试，避免崩溃循环里无限刷新。 */
function reloadRenderer(manual = true): void {
  if (isQuitting) return
  if (manual) {
    rendererRecoveryAttempts = 0
    rendererRecoveryStartedAt = 0
  }
  if (rendererRecoveryTimer) {
    clearTimeout(rendererRecoveryTimer)
    rendererRecoveryTimer = null
  }
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.reload()
  }
}

function scheduleRendererRecovery(): void {
  if (isQuitting) return
  const now = Date.now()
  if (!rendererRecoveryStartedAt || now - rendererRecoveryStartedAt > RENDERER_RECOVERY_WINDOW_MS) {
    rendererRecoveryStartedAt = now
    rendererRecoveryAttempts = 0
  }
  if (rendererRecoveryAttempts >= MAX_RENDERER_RECOVERY_ATTEMPTS) return
  rendererRecoveryAttempts += 1
  if (rendererRecoveryTimer) clearTimeout(rendererRecoveryTimer)
  rendererRecoveryTimer = setTimeout(() => {
    rendererRecoveryTimer = null
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.reload()
    }
  }, rendererRecoveryAttempts === 1 ? 600 : 2000)
}

/**
 * 桌面可见时临时提升审批卡片层级，审批结束后恢复置顶设置。
 */
function presentApprovalWindow(): void {
  if (process.env.DESKPET_HEADLESS === '1' || fullscreenVisibility?.blocksReveal()) return
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  if (!approvalTopmostActive) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    approvalTopmostActive = true
  }
  mainWindow.moveTop()
  mainWindow.focus()
}

function restoreApprovalWindowLayer(): void {
  if (!approvalTopmostActive) return
  approvalTopmostActive = false
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(alwaysOnTop, 'floating')
  }
}

function resolvePendingApproval(
  requestId: string,
  decision: RuntimeApprovalDecision,
): boolean {
  const resolver = pendingApprovals.get(requestId)
  if (!resolver) return false
  pendingApprovals.delete(requestId)
  updateWindowMouseIgnore()
  if (pendingApprovals.size === 0) restoreApprovalWindowLayer()
  resolver(decision)
  return true
}

/** 窗口重载/渲染进程崩溃时，审批已不可能送达，恢复审批期间临时改过的窗口状态。 */
function resolveAllPendingApprovals(decision: RuntimeApprovalDecision): void {
  for (const [, resolve] of pendingApprovals) resolve(decision)
  pendingApprovals.clear()
  updateWindowMouseIgnore()
  restoreApprovalWindowLayer()
}

/** 当前模型运行时上下文快照（由渲染层上报，供宿主插件读取以构造 System Prompt） */
let currentModelContext: ModelRuntimeContext = {
  modelName: 'Uta Live2D',
  revision: 'model-loading',
  ready: false,
  animations: [],
  emotions: [],
  presetGroups: [],
}

let tray: Tray | null = null
let fullscreenVisibility: FullscreenVisibility | null = null
let stopFullscreenProbe: (() => void) | undefined
let cursorPollTimer: ReturnType<typeof setInterval> | null = null
let lastCursorX: number | null = null
let lastCursorY: number | null = null
let alwaysOnTop = true
let clickThroughLocked = false
let hoverFadeEnabled = false
let summonOnHostStart = true
let voiceShortcut = ''
let lastSavedBounds: WindowBoundsState = { width: 600, height: 800, x: 100, y: 100 }

/** 宿主会话开始时的“呼出”：只把窗口带到前台，不抢键盘焦点 */
function summonPetWindow(): void {
  if (process.env.DESKPET_HEADLESS === '1' || fullscreenVisibility?.blocksReveal()) return
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.showInactive()
  if (alwaysOnTop) mainWindow.moveTop()
}

function updateWindowMouseIgnore(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  // 当存在待决审批卡片时，临时允许窗口接收点击，确保用户能直接点击「批准/拒绝」按钮
  const effectiveIgnore = clickThroughLocked && pendingApprovals.size === 0
  mainWindow.setIgnoreMouseEvents(effectiveIgnore, { forward: true })
}

function setAlwaysOnTopState(flag: boolean): void {
  alwaysOnTop = flag
  mainWindow?.setAlwaysOnTop(flag, 'floating')
  saveWindowState()
  createTray()
}

function setClickThroughLocked(flag: boolean): void {
  clickThroughLocked = flag
  updateWindowMouseIgnore()
  mainWindow?.webContents.send('set-click-through-locked', flag)
  saveWindowState()
  createTray()
}

function setHoverFadeEnabled(flag: boolean): void {
  if (settingsAuthorityMode !== 'legacy') {
    if (!canonicalSettingsStore) return
    const rollbackTray = (): void => {
      if (tray) createTray()
    }
    void patchHoverFade(canonicalSettingsStore, flag).then(result => {
      if (!result.ok) {
        console.warn('[Settings] Hover preference was not saved')
        rollbackTray()
      }
    }).catch(() => {
      console.warn('[Settings] Hover preference is unavailable')
      rollbackTray()
    })
    return
  }
  hoverFadeEnabled = flag
  mainWindow?.webContents.send('set-hover-fade', flag)
  saveWindowState()
  createTray()
}

function getCurrentWindowPlacement(): {
  windowX: number
  windowY: number
  windowWidth: number
  windowHeight: number
  workAreaX: number
  workAreaY: number
  workAreaWidth: number
  workAreaHeight: number
} | null {
  if (!mainWindow || mainWindow.isDestroyed()) return null
  const bounds = mainWindow.getBounds()
  const display = screen.getDisplayMatching(bounds)
  const area = display.workArea
  return {
    windowX: bounds.x,
    windowY: bounds.y,
    windowWidth: bounds.width,
    windowHeight: bounds.height,
    workAreaX: area.x,
    workAreaY: area.y,
    workAreaWidth: area.width,
    workAreaHeight: area.height,
  }
}

function sendWindowPlacement(): void {
  const placement = getCurrentWindowPlacement()
  if (placement) {
    mainWindow?.webContents.send('window-placement', placement)
  }
}

function stopGlobalCursorPolling(): void {
  if (cursorPollTimer) {
    clearInterval(cursorPollTimer)
    cursorPollTimer = null
  }
}

function startGlobalCursorPolling(): void {
  if (cursorPollTimer) return
  if (isQuitting || !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return
  // 恢复轮询时强制发一次位置，避免隐藏前的悬停状态残留
  lastCursorX = null
  lastCursorY = null

  cursorPollTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      stopGlobalCursorPolling()
      return
    }
    if (mainWindow.webContents.isDestroyed()) {
      stopGlobalCursorPolling()
      return
    }

    const cursor = screen.getCursorScreenPoint()
    if (cursor.x === lastCursorX && cursor.y === lastCursorY) return

    lastCursorX = cursor.x
    lastCursorY = cursor.y

    const bounds = mainWindow.getBounds()
    mainWindow.webContents.send('global-cursor-position', {
      screenX: cursor.x,
      screenY: cursor.y,
      windowX: bounds.x,
      windowY: bounds.y,
      x: cursor.x - bounds.x,
      y: cursor.y - bounds.y,
    })
  }, 33)
}

function getAppIconPath(): string {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'icon.png'), path.join(__dirname, '../renderer/icon.png')]
    : [path.join(app.getAppPath(), 'src/renderer/public/icon.png'), path.join(__dirname, '../renderer/icon.png')]

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // 试下一个候选路径
    }
  }
  return candidates[0]
}

function createWindow(): void {
  const state = loadWindowState()
  const bounds = state.bounds
  lastSavedBounds = bounds
  alwaysOnTop = state.alwaysOnTop
  clickThroughLocked = state.clickThroughLocked
  if (environment.isStable) hoverFadeEnabled = state.hoverFadeEnabled
  summonOnHostStart = state.summonOnHostStart
  const headlessForTests = process.env.DESKPET_HEADLESS === '1'
  const watchFullscreen = process.platform === 'win32' && !headlessForTests
  mainWindow = new BrowserWindow({
    title: environment.isStable ? 'Uta' : `Uta [${environment.profile}]`,
    show: !headlessForTests && !watchFullscreen,
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: false,
    // 桌宠常驻托盘/桌面，不占任务栏；设置窗口打开时才作为普通窗口进入任务栏
    skipTaskbar: true,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    icon: getAppIconPath(),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
    },
  })

  if (watchFullscreen) {
    const visibility = new FullscreenVisibility(mainWindow, () => checkDailyReminders?.())
    fullscreenVisibility = visibility
    stopFullscreenProbe = startWindowsFullscreenProbe(mainWindow.getNativeWindowHandle(),
      occupied => visibility.sample(occupied), () => visibility.clearFullscreen())
  }
  let initialShowRequested = false
  const requestInitialShow = (): void => {
    if (initialShowRequested) return
    initialShowRequested = true
    fullscreenVisibility?.requestShow()
  }

  if (!environment.isStable) {
    mainWindow.webContents.on('page-title-updated', (event) => {
      event.preventDefault()
      mainWindow?.setTitle(`Uta [${environment.profile}]`)
    })
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === mainWindow?.webContents.getURL()) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  if (app.isPackaged) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow?.webContents.closeDevTools()
    })
  }

  if (process.platform === 'darwin') {
    mainWindow.setAlwaysOnTop(alwaysOnTop, 'floating')
  } else {
    mainWindow.setAlwaysOnTop(alwaysOnTop)
  }
  updateWindowMouseIgnore()

  mainWindow.once('ready-to-show', () => {
    if (watchFullscreen) requestInitialShow()
    else if (!headlessForTests) {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.once('did-finish-load', () => {
    if (watchFullscreen) requestInitialShow()
    else if (!headlessForTests && mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
    }
    mainWindow?.webContents.send('set-hover-fade', hoverFadeEnabled)
    mainWindow?.webContents.send('set-click-through-locked', clickThroughLocked)
    sendWindowPlacement()
  })

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return
    const isReload = input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')
    if (isReload) {
      mainWindow?.webContents.reload()
      return
    }
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      if (!app.isPackaged) mainWindow?.webContents.toggleDevTools()
    }
  })

  mainWindow.on('move', () => {
    enforceWindowBounds()
    sendWindowPlacement()
    scheduleSaveWindowState()
  })
  mainWindow.on('resize', () => {
    enforceWindowBounds()
    sendWindowPlacement()
    scheduleSaveWindowState()
  })
  // 隐藏/最小化时没必要继续 30Hz 读取全局光标
  mainWindow.on('hide', stopGlobalCursorPolling)
  mainWindow.on('minimize', stopGlobalCursorPolling)
  mainWindow.on('show', startGlobalCursorPolling)
  mainWindow.on('restore', startGlobalCursorPolling)
  mainWindow.on('close', saveWindowState)

  mainWindow.on('closed', () => {
    stopGlobalCursorPolling()
    stopFullscreenProbe?.()
    stopFullscreenProbe = undefined
    fullscreenVisibility = null
    mainWindow = null
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow?.isVisible()) startGlobalCursorPolling()
  })
  mainWindow.webContents.on('did-start-navigation', (_e, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) {
      runtimeCommandReady = false
      resolveAllPendingApprovals('unavailable')
    }
  })
  mainWindow.webContents.on('render-process-gone', () => {
    runtimeCommandReady = false
    stopGlobalCursorPolling()
    resolveAllPendingApprovals('unavailable')
    scheduleRendererRecovery()
  })

  startGlobalCursorPolling()
}

function getTrayIcon(): Electron.NativeImage {
  const trayPath = path.join(path.dirname(getAppIconPath()), 'icon-tray.png')
  const icon = nativeImage.createFromPath(fs.existsSync(trayPath) ? trayPath : getAppIconPath())
  return icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 })
}

function formatShortcut(accelerator: string): string {
  return accelerator.replace('CommandOrControl', 'Ctrl')
}

function toggleWindowVisible(): void {
  if (!mainWindow) return
  if (fullscreenVisibility?.blocksReveal()) {
    fullscreenVisibility.toggleDeferredShow()
    return
  }
  mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

/** 日常稳定实例优先占用系统热键；开发实例只在没有别的 Uta 在跑时接管。 */
function otherLiveUtaEndpoint(): string | null {
  const root = path.join(app.getPath('appData'), 'uta')
  const owners: Array<{ file: string; pid: unknown }> = []
  const add = (file: string): void => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { pid?: unknown } | null
      owners.push({ file, pid: parsed?.pid })
    } catch {
      /* 没有端点文件或内容损坏 */
    }
  }
  add(path.join(root, 'runtime-endpoint.json'))
  try {
    for (const entry of fs.readdirSync(path.join(root, 'host-pets'))) {
      add(path.join(root, 'host-pets', entry, 'runtime-endpoint.json'))
    }
  } catch {
    /* 没有多桌宠端点 */
  }
  return findForeignLiveEndpoint(owners, process.pid, processIsAlive)
}

function registerGlobalShortcuts(): void {
  globalShortcut.unregisterAll()
  voiceShortcut = ''
  if (!environment.isStable) {
    const foreign = otherLiveUtaEndpoint()
    if (foreign) {
      console.info(`[uta] another Uta instance owns global shortcuts (${foreign}); staying off`)
      return
    }
  }

  const bindings: Array<[string, () => void]> = [
    [SHORTCUTS.toggleVisible, toggleWindowVisible],
    [SHORTCUTS.toggleHoverFade, () => setHoverFadeEnabled(!hoverFadeEnabled)],
    [SHORTCUTS.toggleClickThrough, () => setClickThroughLocked(!clickThroughLocked)],
  ]

  for (const [accelerator, callback] of bindings) {
    if (!globalShortcut.register(accelerator, callback)) {
      console.warn(`[uta] Global shortcut registration failed: ${accelerator}`)
    }
  }

  // Ctrl+Alt+V 经常被截图/剪贴板工具占用；依次尝试候选键，设置和托盘显示实际生效项
  const voiceCandidates = [
    SHORTCUTS.toggleVoiceInput,
    'CommandOrControl+Alt+Space',
    'CommandOrControl+Shift+Alt+V',
    'CommandOrControl+Alt+U',
  ]
  for (const accelerator of voiceCandidates) {
    if (globalShortcut.register(accelerator, () => mainWindow?.webContents.send('voice-input-toggle'))) {
      voiceShortcut = accelerator
      break
    }
  }
  if (!voiceShortcut) {
    console.warn('[uta] No available voice input shortcut; use the microphone button')
  }
}

function createTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }

  // Only advertise a key that actually registered; a development instance may
  // have deliberately left the system-wide hotkeys to the daily stable pet.
  const shortcutSuffix = (accelerator: string): string =>
    globalShortcut.isRegistered(accelerator)
      ? ` (${formatShortcut(accelerator)})`
      : ''
  const lockLabel = clickThroughLocked
    ? `取消锁定穿透（当前鼠标会穿透桌宠${shortcutSuffix(SHORTCUTS.toggleClickThrough)}）`
    : `锁定穿透${shortcutSuffix(SHORTCUTS.toggleClickThrough)}`
  const voiceLabel = voiceShortcut
    ? `语音输入 (${formatShortcut(voiceShortcut)})`
    : '语音输入（无可用快捷键）'
  tray = new Tray(getTrayIcon())
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `显示/隐藏${shortcutSuffix(SHORTCUTS.toggleVisible)}`, click: toggleWindowVisible },
    { label: '置顶', type: 'checkbox', checked: alwaysOnTop, click: (mi) => { setAlwaysOnTopState(mi.checked) } },
    { label: lockLabel, type: 'checkbox', checked: clickThroughLocked, click: (mi) => { setClickThroughLocked(mi.checked) } },
    { label: `悬停淡化模型${shortcutSuffix(SHORTCUTS.toggleHoverFade)}`, type: 'checkbox', checked: hoverFadeEnabled, click: (mi) => { setHoverFadeEnabled(mi.checked) } },
    {
      label: voiceLabel,
      click: () => { mainWindow?.webContents.send('voice-input-toggle') },
    },
    { label: '重置模型位置', click: () => { mainWindow?.webContents.send('reset-model-view') } },
    { label: '重置窗口位置', click: () => { resetWindowPosition() } },
    { label: '重置全部布局', click: () => { resetAllLayout() } },
    { type: 'separator' },
    { label: '重新加载桌宠', click: () => { reloadRenderer(true) } },
    { label: '设置', click: () => { settingsWindowManager.openSettingsWindow() } },
    { type: 'separator' },
    { label: '退出', click: () => { app.quit() } },
  ]))
  const tooltip = clickThroughLocked ? 'Uta 桌面宠物（已锁定穿透，请从托盘取消）' : 'Uta 桌面宠物'
  tray.setToolTip(environment.isStable ? tooltip : `${tooltip} [${environment.profile}]`)
}

let settingsInitialization: Promise<SettingsIpcController> | null = null
let canonicalSettingsStore: SettingsService | null = null
let settingsAuthorityMode: 'legacy' | 'canonical-dev' | 'canonical-stable' = 'legacy'
let disposeSettingsImport = () => {}
let modelImporter: ReturnType<typeof createModelImporter> | null = null
let settingsQuitting = false
const settingsPageUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
  ? process.env.ELECTRON_RENDERER_URL
  : pathToFileURL(path.join(__dirname, '../renderer/index.html')).href
const settingsWindowManager = new SettingsWindowManager({
  isStable: environment.isStable,
  profile: environment.profile,
  getAppIconPath,
  settingsPageUrl,
  getWorkArea: () => screen.getPrimaryDisplay().workArea,
})

function ensureWindowsOnScreen(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const next = clampWindowBounds(mainWindow.getBounds())
    const current = mainWindow.getBounds()
    if (next.x !== current.x || next.y !== current.y ||
      next.width !== current.width || next.height !== current.height) {
      applyWindowBounds(next)
      sendWindowPlacement()
    }
  }
  settingsWindowManager.ensureOnScreen()
}

function isSettingsWindowSender(
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
): boolean {
  return settingsWindowManager.isRegisteredTarget(event.sender) &&
    !!event.senderFrame && event.senderFrame === event.sender.mainFrame
}

/** Read/settings IPC is available to both the pet and the independent settings window. */
function isTrustedUiSender(
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
): boolean {
  const fromPet = !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents
  return fromPet || isSettingsWindowSender(event)
}

const settingsPetCommands = new SettingsPetCommands({
  getPet: () => mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null,
  isSettingsSender: isSettingsWindowSender,
  isPetSender: event => !!mainWindow && !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents && !!event.senderFrame &&
    event.senderFrame === event.sender.mainFrame && isSettingsPage(event.sender, settingsPageUrl),
})

function getSettingsTargets(): WebContents[] {
  const targets: WebContents[] = []
  if (mainWindow && !mainWindow.isDestroyed() && isSettingsPage(mainWindow.webContents, settingsPageUrl)) {
    targets.push(mainWindow.webContents)
  }
  const settingsWc = settingsWindowManager.getWebContents()
  if (settingsWc && isSettingsPage(settingsWc, settingsPageUrl)) {
    targets.push(settingsWc)
  }
  return targets

}
const guardSettingsQuit = createSettingsQuitGuard(async () => {
  settingsQuitting = true
  settingsPetCommands.dispose()
  disposeSettingsImport()
  modelImporter?.dispose()
  settingsWindowManager.closeSettingsWindow()
  const controller = await settingsInitialization
  await controller?.dispose()
}, () => app.quit())

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock || settingsQuitting) return

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (fullscreenVisibility?.blocksReveal()) {
      fullscreenVisibility.requestShow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  })

  // Keep both windows reachable when a monitor disappears, scaling changes or the PC wakes.
  screen.on('display-added', ensureWindowsOnScreen)
  screen.on('display-removed', ensureWindowsOnScreen)
  screen.on('display-metrics-changed', ensureWindowsOnScreen)
  powerMonitor.on('resume', () => {
    ensureWindowsOnScreen()
    sendWindowPlacement()
  })

  modelImporter = createModelImporter(environment.userData)
  protocol.handle('uta', async (request) => {
    const url = new URL(request.url)
    if (!['models', 'model-import'].includes(url.host)) return new Response('Not Found', { status: 404 })
    let rel: string
    try {
      rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    } catch {
      return new Response('Bad Request', { status: 400 })
    }
    const [token, ...previewPath] = rel.split('/')
    const full = url.host === 'model-import' ? modelImporter?.previewFile(token, previewPath.join('/')) : resolveContainedModelFile(
      getModelsRoots().map((root) => root.fsPath),
      rel,
    )
    if (!full) return new Response('Not Found', { status: 404 })
    const resp = await net.fetch(pathToFileURL(full).toString())
    const headers = new Headers(resp.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    if (full.toLowerCase().endsWith('.svg')) {
      headers.set('Content-Type', 'image/svg+xml')
      headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
      headers.set('X-Content-Type-Options', 'nosniff')
    }
    return new Response(resp.body, { status: resp.status, headers })
  })

  if (environment.isStable) migrateUserModelsOnce()

  const stableAuthority = environment.isStable ? await inspectStableAuthority(environment.userData) : 'legacy'
  settingsInitialization = initializeSettingsIpc({
    isStable: environment.isStable,
    stableAuthority,
    createStore: async () => {
      fs.mkdirSync(environment.userData, { recursive: true })
      const store = await createSettingsStore(environment.userData, {
        requireExisting: environment.isStable && stableAuthority !== 'legacy',
      })
      canonicalSettingsStore = store
      await observeHoverFade(store, enabled => {
        hoverFadeEnabled = enabled
        if (tray) createTray()
      })
      return store
    },
    isAllowedSender: event => isValidSettingsSender(event, getSettingsTargets()),
    getTargets: getSettingsTargets,
  })
  settingsAuthorityMode = (await settingsInitialization).mode
  if (settingsQuitting) return

  ipcMain.handle(COMPANION_HTTP_CHANNEL, (event, host: unknown, base: unknown, route: unknown, body: unknown) => {
    if (!isTrustedUiSender(event) || !isCompanionHttpHost(host) || host !== boundHostId) return 403
    if (!runtimeBridge) return 503
    return requestCompanionHost(host, runtimeBridge.token, base, route, body)
  })

  // Register binding IPC before the pet renderer can migrate/bind on mount.
  ipcMain.handle('pet-bind-host', (event, hostId: unknown) => {
    const host = canonicalPetHostId(hostId)
    if (!isTrustedUiSender(event) || !isBindableHostId(host)) {
      return { ok: false, error: 'invalid-host' }
    }
    const result = petBindingStore.bind(host)
    if (!result.ok) return { ok: false, error: result.error, boundHostId: result.boundHostId ?? '' }
    boundHostId = result.binding.hostId
    runtimeBridge?.setExtraEndpointFile(boundHostEndpointFile(boundHostId))
    notifyPetBindingChanged()
    return { ok: true, binding: result.binding }
  })

  ipcMain.handle('pet-switch-host', (event, hostId: unknown) => {
    const host = canonicalPetHostId(hostId)
    if (!isTrustedUiSender(event) || !isBindableHostId(host)) {
      return { ok: false, error: 'invalid-host' }
    }
    const previousEndpoint = boundHostId ? boundHostEndpointFile(boundHostId) : ''
    const endpoint = resolveHostEndpointFile(app.getPath('appData'), host, {
      isStable: environment.isStable, explicitBoundHost, pairedHost: host,
    })
    if (!runtimeBridge?.setExtraEndpointFile(endpoint)) return { ok: false, error: 'pairing-unavailable' }
    const result = petBindingStore.rebind(host, true)
    if (!result.ok) {
      runtimeBridge.setExtraEndpointFile(previousEndpoint)
      return { ok: false, error: result.error }
    }
    boundHostId = result.binding.hostId
    runtimeBridge?.cancelPendingApprovals?.()
    notifyPetBindingChanged()
    return { ok: true, binding: result.binding }
  })

  ipcMain.handle('pet-unbind-host', event => {
    if (!isSettingsWindowSender(event)) return { ok: false, error: 'unauthorized' }
    if (!petBindingStore.clear()) return { ok: false, error: 'write-failed' }
    boundHostId = ''
    runtimeBridge?.setExtraEndpointFile('')
    runtimeBridge?.cancelPendingApprovals?.()
    notifyPetBindingChanged()
    return { ok: true }
  })

  ipcMain.handle('pet-binding-state', event =>
    isTrustedUiSender(event) ? { binding: petBindingStore.get() } : null)

  createWindow()
  if (!process.env.UTA_SKIP_ONBOARDING && onboardingState.shouldOpen()) {
    setTimeout(() => {
      if (settingsQuitting) return
      // A manually opened settings window wins; leave the guide pending so the
      // next launch still offers it instead of silently marking it seen.
      if (settingsWindowManager.getSettingsWindow()) return
      onboardingState.markPending()
      settingsWindowManager.openSettingsWindow(true)
    }, 900)
  }
  ipcMain.handle('onboarding-state', (event) => {
    if (!isSettingsWindowSender(event)) return null
    return { state: onboardingState.read(), shouldOpen: onboardingState.shouldOpen() }
  })
  ipcMain.handle('onboarding-complete', (event, hostId: unknown) => {
    if (!isSettingsWindowSender(event) || typeof hostId !== 'string') return false
    return onboardingState.complete(hostId)
  })
  ipcMain.handle('environment-info', (event) => {
    if (!isTrustedUiSender(event)) return null
    return {
      profile: environment.profile,
      isStable: environment.isStable,
      userData: environment.userData,
      runtimeDir: environment.runtimeDir,
      endpointFile: environment.endpointFile,
      packaged: app.isPackaged,
      version: app.getVersion(),
      sourceDir: app.getAppPath(),
      build: buildInfo,
    }
  })
  // 只给主窗口放行麦克风；其余权限一律拒绝
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const isPetWindow = !!mainWindow && !mainWindow.isDestroyed() && webContents === mainWindow.webContents
    callback(shouldAllowMediaPermission(permission, isPetWindow))
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const isPetWindow = !!mainWindow && !mainWindow.isDestroyed() && webContents === mainWindow.webContents
    return shouldAllowMediaPermission(permission, isPetWindow)
  })
  registerGlobalShortcuts()
  createTray()

  ipcMain.handle('drag-window', (event, { dx, dy }: { dx: number; dy: number }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win !== mainWindow) return
    lastDragAt = Date.now()
    const nextBounds = clampWindowBounds({
      width: lastSavedBounds.width,
      height: lastSavedBounds.height,
      x: lastSavedBounds.x + dx,
      y: lastSavedBounds.y + dy,
    })
    applyWindowBounds(nextBounds)
    sendWindowPlacement()
    scheduleSaveWindowState()
  })

  ipcMain.handle('control-window', (event, action: unknown) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    const settingsWin = settingsWindowManager.getSettingsWindow()
    const isSettings = !!settingsWin && event.sender === settingsWin.webContents
    const isPet = !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents
    const isMainFrame = !!event.senderFrame && event.senderFrame === event.sender.mainFrame
    if (!target || !isMainFrame || (!isSettings && !isPet)) return { ok: false, error: 'unauthorized' }
    if (isSettings && !isSettingsPage(event.sender, settingsPageUrl)) {
      return { ok: false, error: 'unauthorized' }
    }
    if (action === 'state') return { ok: true, maximized: target.isMaximized() }
    if (action === 'close') {
      if (isSettings) settingsWindowManager.closeSettingsWindow()
      else target.close()
      return { ok: true }
    }
    if (action === 'minimize') {
      target.minimize()
      return { ok: true }
    }
    if (action === 'toggle-maximize') {
      if (target.isMaximized()) target.unmaximize()
      else target.maximize()
      return { ok: true, maximized: target.isMaximized() }
    }
    return { ok: false, error: 'invalid-action' }
  })

  ipcMain.handle('open-settings-window', (event, domain: unknown) => {
    if (!isRuntimeSender(event) && !getSettingsTargets().includes(event.sender)) return false
    const target = typeof domain === 'string' && SETTINGS_DOMAIN_IDS.has(domain) ? domain : undefined
    settingsWindowManager.openSettingsWindow(false, target)
    return true
  })

  registerSettingsWindowLifecycle(settingsWindowManager, isSettingsWindowSender)

  registerSettingsPetCommands(settingsPetCommands)
  const settingsImportController = createSettingsImportController({
    isAllowedSender: isSettingsWindowSender,
    getStore: () => canonicalSettingsStore,
  })
  disposeSettingsImport = () => settingsImportController.dispose()
  ipcMain.handle('settings-import-preview', (event, sources) => settingsImportController.preview(event, sources)
    .catch(() => ({ ok: false, error: 'io-error' })))
  ipcMain.handle('settings-import-apply', (event, request) => settingsImportController.apply(event, request)
    .catch(() => ({ ok: false, code: 'io-error', currentRevision: null })))
  ipcMain.handle('settings-import-cancel', event => settingsImportController.cancel(event))
  const settingsRecoveryController = createSettingsRecoveryController({
    getStore: () => canonicalSettingsStore,
    isAllowedSender: event => isValidSettingsSender(event, getSettingsTargets()) && isSettingsPage(event.sender, settingsPageUrl),
    recovered: () => { for (const target of getSettingsTargets()) { try { if (!target.isDestroyed()) target.send('settings-recovered') } catch { /* A window may close during recovery I/O. */ } } },
  })
  ipcMain.handle('settings-recovery-preview', event => settingsRecoveryController.preview(event).catch(() => ({ available: false, reason: 'unavailable' })))
  ipcMain.handle('settings-recovery-retry', event => settingsRecoveryController.retry(event).catch(() => false))
  ipcMain.handle('settings-recovery-restore', (event, token) => settingsRecoveryController.restore(event, token).catch(() => ({ ok: false, code: 'unavailable' })))
  ipcMain.handle('settings-voice-preview', createVoicePreviewHandler({
    isAllowedSender: isSettingsWindowSender,
    synthesize: async request => {
      if (request.provider === 'cloud') {
        const state = readCloudTtsState()
        if (state.readError) throw new Error('云端 TTS 配置无法读取，请打开设置检查后重试。')
        if (!state.config.apiKey) return null
        return synthesizeCloudSpeech(state.config, request.text, request.speed)
      }
      return synthesizeSpeech({ text: request.text, endpoint: request.endpoint, speed: request.speed, timeoutMs: 15000 })
    },
  }))

  ipcMain.handle('get-window-placement', () => getCurrentWindowPlacement())

  // 穿透/悬停的权威状态在主进程。did-finish-load 那次广播早于渲染层订阅注册
  // （Live2D 模型加载越慢越必然），渲染层需要主动拉一次兜底，否则重启后
  // 系统层面已穿透、界面却按未锁定渲染，底衬和按钮会跟着 hover 反复闪。
  ipcMain.handle('get-ui-state', () => ({ clickThroughLocked, hoverFadeEnabled, voiceShortcut }))

  ipcMain.handle('set-always-on-top', (_event, flag: boolean) => {
    setAlwaysOnTopState(flag)
  })

  ipcMain.handle('set-click-through-locked', (_event, flag: boolean) => {
    setClickThroughLocked(flag)
  })

  ipcMain.handle('minimize-window', () => {
    mainWindow?.minimize()
  })

  ipcMain.handle('list-models', () => listModels())
  ipcMain.handle('model-import-pick', async (event, kind: unknown) => {
    if (!isSettingsWindowSender(event) || !modelImporter || !['folder', 'zip'].includes(String(kind))) return { ok: false, error: '导入窗口不可用。' }
    const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
      title: kind === 'folder' ? '选择完整角色文件夹' : '选择角色 ZIP',
      properties: kind === 'folder' ? ['openDirectory'] : ['openFile'],
      ...(kind === 'zip' ? { filters: [{ name: 'ZIP', extensions: ['zip'] }] } : {}),
    })
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, error: '已取消选择。' }
    if (!isSettingsWindowSender(event)) return { ok: false, error: '导入窗口已关闭。' }
    try {
      const preview = await modelImporter.stage(picked.filePaths[0], event.sender.id)
      if (!isSettingsWindowSender(event)) { modelImporter.cancel(preview.token, event.sender.id); return { ok: false, error: '导入窗口已关闭。' } }
      const owner = event.sender.id
      event.sender.once('destroyed', () => modelImporter?.cancel(preview.token, owner))
      return { ok: true, preview }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '角色包检查失败。' } }
  })
  ipcMain.handle('model-import-install', async (event, payload: unknown) => {
    if (!isSettingsWindowSender(event) || !modelImporter || !payload || typeof payload !== 'object') return { ok: false, error: '导入窗口不可用。' }
    const request = payload as Record<string, unknown>
    if (typeof request.token !== 'string' || typeof request.candidateId !== 'string') return { ok: false, error: '导入记录不正确。' }
    try { return { ok: true, url: await modelImporter.install(request.token, request.candidateId, event.sender.id, request.replace === true) } }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '角色保存失败，原角色已保留。' } }
  })
  ipcMain.handle('model-import-cancel', (event, token: unknown) => {
    if (isSettingsWindowSender(event) && typeof token === 'string') modelImporter?.cancel(token, event.sender.id)
  })
  ipcMain.handle('inspect-model-assets', (_event, modelUrl: string) => inspectModelAssets(modelUrl))
  ipcMain.handle('settings-save-model-calibration', (event, payload: unknown) => {
    if (!isSettingsWindowSender(event) || !payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false }
    const item = payload as Record<string, unknown>
    if (typeof item.modelUrl !== 'string' || typeof item.signature !== 'string' || !Array.isArray(item.expected)) return { ok: false }
    const modelFile = resolveModelFilePath(item.modelUrl)
    const assets = modelFile ? readModelPerformanceAssets(modelFile) : null
    if (!assets || assets.modelSignature !== item.signature) return { ok: false }
    return { ok: modelCalibration.write(item.signature, item.entries, item.expected) }
  })
  ipcMain.handle('settings-read-model-calibrations', event =>
    isSettingsWindowSender(event) ? modelCalibration.read() : { ok: false })
  ipcMain.handle('settings-merge-model-calibrations', (event, payload: unknown) => {
    if (!isSettingsWindowSender(event) || !payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, imported: 0, skipped: 0 }
    const item = payload as Record<string, unknown>
    return modelCalibration.merge(item.models, item.expected)
  })
  // Deprecated bridge stays fail-closed for old renderer documents. Model resources are read-only.
  ipcMain.handle('save-model-presets', () => false)

  ipcMain.handle('open-models-folder', () => {
    const dir = getUserModelsRoot()
    fs.mkdirSync(dir, { recursive: true })
    return shell.openPath(dir)
  })

  // 只接受主窗口渲染层的 IPC，拒绝其他 frame
  const isRuntimeSender = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents

  const chatHistory = createChatHistory(environment.userData)
  const todoStore = createTodoStore(environment.userData)
  const dailyStore = createDailyTodoStore(environment.userData)
  const todoRecovery = createTodoRecovery(environment.userData)
  const isProfileExportDestination = (file: string): boolean => {
    try {
      const root = fs.realpathSync(environment.userData)
      const target = path.join(fs.realpathSync(path.dirname(file)), path.basename(file))
      const relative = path.relative(root, target)
      return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    } catch { return true }
  }
  const broadcastTodoChanged = (): void => {
    const targets = [mainWindow?.webContents, settingsWindowManager.getWebContents()]
    for (const target of targets) {
      if (target && !target.isDestroyed()) target.send('todo-changed')
    }
  }
  const broadcastDailyChanged = (): void => {
    const targets = [mainWindow?.webContents, settingsWindowManager.getWebContents()]
    for (const target of targets) {
      if (target && !target.isDestroyed()) target.send('daily-changed')
    }
  }
  ipcMain.handle('todo-recovery-preview', (event, payload: unknown) => {
    if (!isSettingsWindowSender(event) || !payload || typeof payload !== 'object') return { ok: false, error: 'unauthorized' }
    const record = payload as Record<string, unknown>
    return todoRecovery.preview(record.kind, record.text)
  })
  ipcMain.handle('todo-recovery-apply', (event, token: unknown) => {
    if (!isSettingsWindowSender(event)) return { ok: false, error: 'unauthorized' }
    const result = todoRecovery.apply(token)
    if (result.ok) {
      if (result.kind === 'project') { todoStore.reload(); broadcastTodoChanged() }
      else { dailyStore.reload(); broadcastDailyChanged() }
    }
    return result
  })
  ipcMain.handle('todo-recovery-export-original', async (event, kind: unknown) => {
    if (!isSettingsWindowSender(event)) return { ok: false, error: 'unauthorized' }
    const original = todoRecovery.readOriginal(kind)
    if (!original.ok) return { ok: false, error: 'unreadable' }
    try {
      const options = { title: '导出待办原文件', defaultPath: path.join(app.getPath('downloads'), `uta-original-${original.filename}`) }
      const parent = settingsWindowManager.getSettingsWindow()
      const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { ok: false, error: 'cancelled' }
      const dest = path.resolve(result.filePath)
      if (isProfileExportDestination(dest)) return { ok: false, error: 'invalid' }
      const source = path.resolve(environment.userData, original.filename)
      if ((process.platform === 'win32' ? dest.toLowerCase() : dest) === (process.platform === 'win32' ? source.toLowerCase() : source)) {
        return { ok: false, error: 'invalid' }
      }
      const temp = path.join(path.dirname(dest), `.uta-original-${randomUUID()}.tmp`)
      try {
        const fd = fs.openSync(temp, 'wx', 0o600)
        try { fs.writeFileSync(fd, original.bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
        fs.renameSync(temp, dest)
      } catch (error) { try { fs.unlinkSync(temp) } catch { /* no temp */ }; throw error }
      return { ok: true }
    } catch { return { ok: false, error: 'write-failed' } }
  })
  ipcMain.handle('chat-history-read', event =>
    isRuntimeSender(event) ? chatHistory.read() : { ok: false, error: 'unreadable' })
  ipcMain.handle('chat-history-write', (event, entries: unknown) =>
    isRuntimeSender(event) ? chatHistory.write(entries) : { ok: false, error: 'unreadable' })
  ipcMain.handle('chat-history-export', async event => {
    if (!isRuntimeSender(event)) return { ok: false, error: 'unavailable' }
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: '导出消息记录',
      defaultPath: path.join(app.getPath('downloads'), 'uta-chat-history.json'),
      filters: [{ name: 'Uta 消息记录', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false, error: 'cancelled' }
    const target = path.resolve(result.filePath)
    if (target.toLowerCase() === path.resolve(environment.userData, 'chat-history.v1.json').toLowerCase()) {
      return { ok: false, error: 'write-failed' }
    }
    const history = chatHistory.read()
    if (!history.ok) return { ok: false, error: 'unavailable' }
    const temp = path.join(path.dirname(target), `.uta-chat-export-${randomUUID()}.tmp`)
    try {
      const fd = fs.openSync(temp, 'wx', 0o600)
      try { fs.writeFileSync(fd, JSON.stringify({ version: 1, entries: history.entries.filter(entry => entry.kind !== 'completion') }, null, 2), 'utf8'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      fs.renameSync(temp, target)
      return { ok: true }
    } catch {
      try { fs.unlinkSync(temp) } catch { /* no temporary export */ }
      return { ok: false, error: 'write-failed' }
    }
  })

  // 渲染层订阅完成信号
  ipcMain.on('runtime-command-ready', (event) => {
    if (isRuntimeSender(event)) runtimeCommandReady = true
  })

  // 渲染层解决一条审批请求（点击「批准」/「拒绝」/「转交宿主」）
  ipcMain.handle(
    'resolve-approval',
    (event, payload: { requestId: string; decision: RuntimeApprovalDecision }) => {
      if (!isRuntimeSender(event) || !payload || typeof payload !== 'object') return false
      return resolvePendingApproval(payload.requestId, normalizeApprovalDecision(payload.decision))
    },
  )


  // 渲染层同步当前模型可用情绪与预设分组摘要
  let settingsModel: { frame: Electron.WebFrameMain | null; url: string; ready: boolean } | undefined
  ipcMain.handle('sync-model-context', (event, ctx: Partial<ModelRuntimeContext> & { settingsModelUrl?: string }) => {
    if (!isRuntimeSender(event) || !ctx || typeof ctx !== 'object') return false
    currentModelContext = normalizeModelContext(ctx, currentModelContext)
    if (typeof ctx.settingsModelUrl === 'string') {
      const next = { frame: event.senderFrame, url: ctx.settingsModelUrl, ready: currentModelContext.ready === true }
      if (!settingsModel || next.frame !== settingsModel.frame || next.url !== settingsModel.url || next.ready !== settingsModel.ready) {
        settingsModel = next
        for (const target of getSettingsTargets()) {
          if (target !== event.sender && !target.isDestroyed()) target.send(SETTINGS_WINDOW_CHANNELS.modelChanged)
        }
      }
    }
    return true
  })

  const pendingMotion = new Map<string, { frame: Electron.WebFrameMain; finish: (result: MotionResult) => void }>()
  ipcMain.on('runtime-motion-result', (event, id: unknown, result: MotionResult) => {
    if (!isRuntimeSender(event) || typeof id !== 'string' || typeof result?.ok !== 'boolean') return
    const pending = pendingMotion.get(id)
    if (pending && event.senderFrame === pending.frame) pending.finish(result)
  })

  // 扫描声明式适配器插件；只读清单，不执行插件代码
  ipcMain.handle('list-adapter-plugins', (event) => {
    if (!isRuntimeSender(event) && !isSettingsWindowSender(event)) return []
    const root = getAdaptersRoot()
    const result: Array<{ dir: string; manifest?: unknown; error?: string }> = []
    try {
      fs.mkdirSync(root, { recursive: true })
      const entries = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 50)
      for (const entry of entries) {
        const manifestPath = path.join(root, entry.name, 'uta-adapter.json')
        try {
          const stat = fs.statSync(manifestPath)
          if (!stat.isFile()) {
            result.push({ dir: entry.name, error: 'uta-adapter.json 不是文件' })
            continue
          }
          if (stat.size > 64 * 1024) {
            result.push({ dir: entry.name, error: 'uta-adapter.json 超过 64KB' })
            continue
          }
          result.push({
            dir: entry.name,
            manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf-8')),
          })
        } catch {
          result.push({ dir: entry.name, error: '缺少或无法读取 uta-adapter.json' })
        }
      }
    } catch {
      return [{ dir: '', error: '无法读取插件目录' }]
    }
    return result
  })

  ipcMain.handle('open-adapters-folder', async (event) => {
    if (!isTrustedUiSender(event)) return false
    try {
      const root = getAdaptersRoot()
      fs.mkdirSync(root, { recursive: true })
      await shell.openPath(root)
      return true
    } catch {
      return false
    }
  })

  // 当前显示器刷新率（设置里的“自适应”档位）
  ipcMain.handle('display-refresh-rate', (event) => {
    if (!isTrustedUiSender(event)) return null
    try {
      const display = mainWindow
        ? screen.getDisplayMatching(mainWindow.getBounds())
        : screen.getPrimaryDisplay()
      return typeof display.displayFrequency === 'number' && display.displayFrequency > 0
        ? display.displayFrequency
        : null
    } catch {
      return null
    }
  })

  // 宿主连接状态（渲染层据此显示）
  ipcMain.handle('host-status', (event) => {
    if (!isTrustedUiSender(event)) return null
    return {
      runtimeEndpointReady: !!runtimeBridge,
      runtimePort: runtimeBridge?.port ?? null,
      rendererReady: runtimeCommandReady,
      endpointFile: runtimeBridge?.endpointFile ?? null,
    }
  })

  const sessionTitle = (hostId: string, sessionId: string, label?: string): string => {
    if (!hostId || !sessionId) return ''
    if (hostId === 'codex') {
      const record = readHostSession(app.getPath('appData'), hostId, environment.runtimeDir, sessionId)
      const title = readCodexSessionTitle(sessionId, record?.hostConfigDir)
      if (title) return title
      return cleanSessionTitle(label ?? codexConversations.list().find(item => item.sessionId === sessionId)?.label, hostId, sessionId)
    }
    return cleanSessionTitle(label ?? runtimeBridge?.sessions.list().find(item => item.hostId === hostId && item.sessionId === sessionId)?.label, hostId, sessionId)
  }

  ipcMain.handle('session-titles', (event, references: unknown) => {
    if (!isTrustedUiSender(event) || !Array.isArray(references)) return []
    return references.slice(0, 256).flatMap(reference => {
      const { hostId, sessionId } = reference ?? {}
      if (typeof hostId !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(hostId) ||
          typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) return []
      return [{ hostId, sessionId, title: sessionTitle(hostId, sessionId) }]
    })
  })

  const hostSessionList = (hostId: string) => {
    if (hostId === 'codex') {
      const preference = readHostSessionPreference(environment.runtimeDir, hostId)
      return {
        ok: true as const,
        sessions: codexConversations.list().map(record => ({ ...record,
          label: sessionTitle(hostId, record.sessionId, record.label), lastCommand: '', hostInstanceId: '',
        })),
        selectedSessionId: preference?.sessionId ?? null,
        selectionExpired: !!preference && !codexConversations.target(preference),
        automaticSessionId: codexConversations.getAutomaticSessionId(),
      }
    }
    const sessions = (runtimeBridge?.sessions.list() ?? [])
      .filter((record) => record.hostId === hostId)
      .map((record) => ({
        sessionId: record.sessionId ?? '',
        label: sessionTitle(hostId, record.sessionId ?? '', record.label ?? ''),
        cwd: record.cwd ?? '',
        lastSeen: record.lastSeen,
        lastCommand: record.lastCommand ?? '',
        hostInstanceId: record.hostInstanceId ?? '',
      }))
      .filter((record) => !!record.sessionId)
    const preference = readHostSessionPreference(environment.runtimeDir, hostId)
    return {
      ok: true as const,
      sessions,
      ...resolveHostSessionSelection(sessions.map(session => session.sessionId), preference),
    }
  }

  const selectedHostSession = (hostId: string): HostSessionRecord | null | undefined => {
    const preference = readHostSessionPreference(environment.runtimeDir, hostId)
    if (hostId === 'codex') return codexConversations.target(preference)
    // undefined means automatic selection; null means an explicit selection is missing.
    if (!preference) return undefined
    const record = runtimeBridge?.sessions.get(hostId, preference.sessionId)
    if (!record?.sessionId) return null
    const saved = readHostSession(app.getPath('appData'), hostId, environment.runtimeDir, record.sessionId)
    return {
      ...saved,
      host: hostId,
      sessionId: record.sessionId,
      cwd: saved ? saved.cwd : record.cwd || '',
      updatedAt: record.lastSeen,
    }
  }

  const sendHostText = async (hostId: string, text: string, expectedSessionId?: string) => {
    const target = selectedHostSession(hostId)
    const result = await sendHostMessage(app.getPath('appData'), hostId, text, environment.runtimeDir, target, expectedSessionId)
    if (hostId === 'codex' && target && result.code === 'no-session') codexConversations.invalidate(target.sessionId)
    return result
  }

  const activeTodoContext = (): { hostId: string; sessionId: string; cwd: string } => {
    const hostId = boundHostId || ''
    if (!hostId) return { hostId: '', sessionId: '', cwd: '' }
    const selected = selectedHostSession(hostId)
    if (selected === null) return { hostId, sessionId: '', cwd: '' }
    let session: HostSessionRecord | null = selected ?? (() => {
      const latest = (runtimeBridge?.sessions.list() ?? [])
        .filter(record => record.hostId === hostId && !!record.sessionId)
        .sort((a, b) => b.lastSeen - a.lastSeen)[0]
      return latest
        ? { host: hostId, sessionId: latest.sessionId ?? '', cwd: latest.cwd ?? '', updatedAt: latest.lastSeen }
        : null
    })()
    if (!session?.cwd) {
      const fileSession = readHostSession(app.getPath('appData'), hostId, environment.runtimeDir)
      session = completeTodoSession(session, fileSession, Date.now())
    }
    return {
      hostId,
      sessionId: session?.sessionId ?? '',
      cwd: session?.cwd ?? '',
    }
  }
  const readTodoState = () => {
    const context = activeTodoContext()
    const state = todoStore.state(context.hostId, context.sessionId, context.cwd)
    const displayed = state.hostPlan ?? context
    return { ...state, hostPlanSessionTitle: sessionTitle(displayed.hostId, displayed.sessionId) }
  }
  ipcMain.handle('todo-get-state', (event) => {
    if (!isTrustedUiSender(event)) return null
    // 文件可能在运行期间被修复；每次读取桌面状态前重新加载，重试按钮才有意义
    todoStore.reload()
    return readTodoState()
  })
  const dailyMutation = (result: { ok: boolean; error?: string; state: unknown }) => {
    if (result.ok) broadcastDailyChanged()
    return result
  }
  ipcMain.handle('daily-get-state', (event) => isTrustedUiSender(event) ? dailyStore.state() : null)
  ipcMain.handle('daily-add-item', (event, payload: unknown) => {
    if (!isTrustedUiSender(event)) return { ok: false, error: 'unauthorized', state: dailyStore.state() }
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    if (typeof record.text !== 'string') return { ok: false, error: '待办内容不能为空。', state: dailyStore.state() }
    return dailyMutation(dailyStore.addItem({
      text: record.text,
      ...(record.remindAt === null || typeof record.remindAt === 'number' ? { remindAt: record.remindAt } : {}),
      ...(record.repeat === 'daily' || record.repeat === 'none' ? { repeat: record.repeat } : {}),
      ...(typeof record.resetDaily === 'boolean' ? { resetDaily: record.resetDaily } : {}),
    }))
  })
  ipcMain.handle('daily-update-item', (event, payload: unknown) => {
    if (!isTrustedUiSender(event)) return { ok: false, error: 'unauthorized', state: dailyStore.state() }
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    if (typeof record.id !== 'string') return { ok: false, error: '待办条目不存在。', state: dailyStore.state() }
    return dailyMutation(dailyStore.updateItem({
      id: record.id,
      ...(typeof record.text === 'string' ? { text: record.text } : {}),
      ...(record.status === 'pending' || record.status === 'completed' ? { status: record.status } : {}),
      ...(record.remindAt === null || typeof record.remindAt === 'number' ? { remindAt: record.remindAt } : {}),
      ...(record.repeat === 'daily' || record.repeat === 'none' ? { repeat: record.repeat } : {}),
      ...(typeof record.resetDaily === 'boolean' ? { resetDaily: record.resetDaily } : {}),
    }))
  })
  ipcMain.handle('daily-delete-item', (event, payload: unknown) => {
    if (!isTrustedUiSender(event)) return { ok: false, error: 'unauthorized', state: dailyStore.state() }
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    if (typeof record.id !== 'string') return { ok: false, error: '待办条目不存在。', state: dailyStore.state() }
    return dailyMutation(dailyStore.deleteItem(record.id))
  })
  ipcMain.handle('daily-clear-completed', (event) => {
    if (!isTrustedUiSender(event)) return { ok: false, error: 'unauthorized', state: dailyStore.state() }
    return dailyMutation(dailyStore.clearCompleted())
  })
  ipcMain.handle('daily-set-reminder-sound', (event, enabled: unknown) => {
    if (!isTrustedUiSender(event)) return { ok: false, error: 'unauthorized', state: dailyStore.state() }
    return dailyMutation(dailyStore.setReminderSound(enabled === true))
  })
  ipcMain.handle('daily-snooze-item', (event, payload: unknown) => {
    if (!isTrustedUiSender(event)) return { ok: false, error: 'unauthorized', state: dailyStore.state() }
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    if (typeof record.id !== 'string' || typeof record.minutes !== 'number') {
      return { ok: false, error: '稍后提醒需要 1 到 1440 分钟。', state: dailyStore.state() }
    }
    return dailyMutation(dailyStore.snoozeItem({ id: record.id, minutes: record.minutes }))
  })

  const tickDailyReminders = (): void => {
    // “第二天重新出现”要先翻回未完成，今天的提醒才有意义
    if (dailyStore.applyDailyRecurrence()) broadcastDailyChanged()
    if (!runtimeCommandReady || !mainWindow || mainWindow.isDestroyed() || fullscreenVisibility?.blocksReveal()) return
    const now = Date.now()
    const snapshot = dailyStore.state()
    const due = dueDailyReminders(snapshot.items, now)
    if (due.length === 0) return
    dailyStore.markReminded(due.map(item => item.id), now)
    broadcastDailyChanged()
    mainWindow.webContents.send('daily-reminder-due', {
      items: due.map(item => ({
        id: item.id,
        text: item.text,
        dueAt: item.snoozedUntil ?? currentOccurrence(item, now) ?? now,
        repeat: item.repeat,
      })),
      sound: snapshot.reminderSound,
    })
    summonPetWindow()
  }
  checkDailyReminders = tickDailyReminders
  dailyReminderTimer = setInterval(tickDailyReminders, 30_000)
  tickDailyReminders()

  const hostOnboarding = createHostOnboarding({
    appData: app.getPath('appData'),
    runtimeDir: environment.runtimeDir,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    isRuntimeReady: () => !!runtimeBridge && runtimeCommandReady,
    getSelectedWorkspace: hostId => {
      const { selectedSessionId, selectionExpired } = hostSessionList(hostId)
      if (selectionExpired) return undefined
      const session = selectedSessionId ? runtimeBridge?.sessions.get(hostId, selectedSessionId)
        : runtimeBridge?.sessions.list().filter(record => record.hostId === hostId)
          .sort((a, b) => b.lastSeen - a.lastSeen)[0]
      return session?.cwd
    },
    getSessions: hostId => {
      const list = hostSessionList(hostId)
      return list.sessions.map(session => ({
        sessionId: session.sessionId,
        label: session.label,
        selected: session.sessionId === list.selectedSessionId,
      }))
    },
  })
  ipcMain.handle('onboarding-detect-hosts', (event) =>
    isSettingsWindowSender(event) ? hostOnboarding.detect() : null)
  let detectedHostsCache: { ids: string[]; checkedAt: string; at: number } | null = null
  ipcMain.handle('detected-hosts', async (event) => {
    if (!isTrustedUiSender(event)) return null
    if (detectedHostsCache && Date.now() - detectedHostsCache.at < 15_000) {
      return { ids: detectedHostsCache.ids, checkedAt: detectedHostsCache.checkedAt }
    }
    const result = await hostOnboarding.detectPresence()
    detectedHostsCache = { ...result, at: Date.now() }
    return result
  })
  ipcMain.handle('onboarding-install-host', (event, hostId: unknown) =>
    isSettingsWindowSender(event) && typeof hostId === 'string'
      ? hostOnboarding.install(hostId)
      : null)
  ipcMain.handle('onboarding-unblock-install', (event, hostId: unknown) =>
    isSettingsWindowSender(event) && typeof hostId === 'string'
      ? hostOnboarding.unblockInstall(hostId)
      : null)

  ipcMain.handle('settings-host-sessions', (event, rawHostId: unknown) => {
    if (!isSettingsWindowSender(event)) return { ok: false, error: 'unauthorized' }
    if (typeof rawHostId !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(rawHostId)) {
      return { ok: false, error: 'invalid-host' }
    }
    return hostSessionList(rawHostId)
  })

  ipcMain.handle('host-input-status', (event, hostId: unknown) => {
    if (!isTrustedUiSender(event) || typeof hostId !== 'string' || hostId !== boundHostId) return null
    const status = getHostInputStatus(app.getPath('appData'), hostId, environment.runtimeDir, selectedHostSession(hostId))
    if (status.targetSession) status.targetSession.title = sessionTitle(hostId, status.targetSession.sessionId)
    return status
  })

  ipcMain.handle('settings-host-session-select', (event, payload: unknown) => {
    if (!isSettingsWindowSender(event)) return { ok: false, error: 'unauthorized' }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, error: 'invalid-request' }
    }
    const record = payload as Record<string, unknown>
    const hostId = record.hostId
    const sessionId = record.sessionId
    if (typeof hostId !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(hostId)) {
      return { ok: false, error: 'invalid-host' }
    }
    if (sessionId !== null && (typeof sessionId !== 'string' || sessionId.length > 200)) {
      return { ok: false, error: 'invalid-session' }
    }
    try {
      if (sessionId === null) {
        writeHostSessionPreference(environment.runtimeDir, hostId, null)
      } else {
        const session = hostId === 'codex'
          ? codexConversations.list().find(item => item.sessionId === sessionId && item.available)
          : runtimeBridge?.sessions.list().find(item => item.hostId === hostId && item.sessionId === sessionId)
        if (!session?.sessionId) return { ok: false, error: 'session-not-found' }
        writeHostSessionPreference(environment.runtimeDir, hostId, {
          sessionId: session.sessionId,
          cwd: session.cwd ?? '',
          updatedAt: session.lastSeen,
        })
      }
      return hostSessionList(hostId)
    } catch {
      return { ok: false, error: 'io-error' }
    }
  })

  const hostPathFor = (hostId: string) => {
    const paths = resolveHostPaths(app.getPath('appData'), environment.runtimeDir)
    if (hostId === 'deepseek-harness') return paths.harnessExe
    if (hostId === 'opencode') return paths.opencodeExe
    if (hostId === 'zcode') return paths.zcodeCli
    if (hostId === 'claude-code') return paths.claudeExe || paths.claudeJs
    if (hostId === 'codex') return paths.codexExe
    if (hostId === 'node') return paths.nodeExe
    return ''
  }

  ipcMain.handle('settings-host-path-info', (event, rawHostId: unknown) => {
    if (!isSettingsWindowSender(event)) return { ok: false, error: 'unauthorized' }
    if (typeof rawHostId !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(rawHostId)) {
      return { ok: false, error: 'invalid-host' }
    }
    return { ok: true, path: hostPathFor(rawHostId) }
  })

  ipcMain.handle('settings-host-path-choose', async (event, rawHostId: unknown) => {
    if (!isSettingsWindowSender(event)) return { ok: false, error: 'unauthorized' }
    if (typeof rawHostId !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(rawHostId)) {
      return { ok: false, error: 'invalid-host' }
    }
    try {
      const options = {
        title: '选择宿主程序或 JS 入口',
        properties: ['openFile'] as Array<'openFile'>,
        filters: [{ name: '宿主程序或 JS 入口', extensions: ['exe', 'com', 'js', 'cjs', 'mjs'] }],
      }
      const parent = settingsWindowManager.getSettingsWindow()
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      const file = result.filePaths[0]
      if (result.canceled || !file) return { ok: false, error: 'cancelled' }
      writeHostPathOverride(environment.runtimeDir, rawHostId, file)
      return { ok: true, path: file }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error) }
    }
  })

  ipcMain.handle('settings-dsh-home-choose', async (event) => {
    if (!isSettingsWindowSender(event)) return { ok: false, error: 'unauthorized' }
    try {
      const currentHome = resolveHostPaths(app.getPath('appData'), environment.runtimeDir).harnessHome
      const options = {
        title: '选择 DeepSeek Harness 数据目录（.dsh）',
        defaultPath: currentHome,
        properties: ['openDirectory'] as Array<'openDirectory'>,
      }
      const parent = settingsWindowManager.getSettingsWindow()
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      const directory = result.filePaths[0]
      if (result.canceled || !directory) return { ok: false, error: 'cancelled' }
      const saved = writeDshHomeOverride(environment.runtimeDir, directory)
      return { ok: true, path: saved }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error) }
    }
  })

  const MAX_PRESET_TRANSFER_BYTES = 4 * 1024 * 1024
  ipcMain.handle('settings-transfer-export', async (event, text: unknown) => {
    if (!isSettingsWindowSender(event) || typeof text !== 'string' || !text || Buffer.byteLength(text, 'utf8') > MAX_PRESET_TRANSFER_BYTES) return { ok: false, error: 'invalid' }
    try {
      const options = { title: '导出 Uta 数据', defaultPath: path.join(app.getPath('downloads'), 'uta-data-transfer.json'), filters: [{ name: 'Uta 数据', extensions: ['json'] }] }
      const parent = settingsWindowManager.getSettingsWindow()
      const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { ok: false, error: 'cancelled' }
      if (isProfileExportDestination(result.filePath)) return { ok: false, error: 'invalid' }
      const temp = path.join(path.dirname(result.filePath), `.uta-transfer-${randomUUID()}.tmp`)
      try {
        const fd = fs.openSync(temp, 'wx', 0o600)
        try { fs.writeFileSync(fd, text, 'utf8'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
        fs.renameSync(temp, result.filePath)
      } catch (error) { try { fs.unlinkSync(temp) } catch { /* no temp */ }; throw error }
      return { ok: true }
    } catch { return { ok: false, error: 'write-failed' } }
  })
  ipcMain.handle('settings-transfer-import', async event => {
    if (!isSettingsWindowSender(event)) return { ok: false, error: 'unauthorized' }
    try {
      const options = { title: '选择 Uta 数据文件', properties: ['openFile'] as Array<'openFile'>, filters: [{ name: 'Uta 数据', extensions: ['json'] }] }
      const parent = settingsWindowManager.getSettingsWindow()
      const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
      if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'cancelled' }
      const info = await fs.promises.stat(result.filePaths[0])
      if (!info.isFile() || info.size > MAX_PRESET_TRANSFER_BYTES) return { ok: false, error: 'invalid' }
      const text = await fs.promises.readFile(result.filePaths[0], 'utf8')
      if (Buffer.byteLength(text, 'utf8') > MAX_PRESET_TRANSFER_BYTES) return { ok: false, error: 'invalid' }
      return { ok: true, text }
    } catch { return { ok: false, error: 'unreadable' } }
  })
  ipcMain.handle('settings-transfer-backup', (event, text: unknown) => {
    if (!isSettingsWindowSender(event) || typeof text !== 'string' || !text || Buffer.byteLength(text, 'utf8') > MAX_PRESET_TRANSFER_BYTES) return { ok: false }
    try {
      const directory = path.join(environment.userData, 'transfer-backups')
      try { fs.mkdirSync(directory) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      const stat = fs.lstatSync(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink()) return { ok: false }
      const file = path.join(directory, `before-import-${randomUUID()}.json`)
      const fd = fs.openSync(file, 'wx', 0o600)
      try { fs.writeFileSync(fd, text, 'utf8'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      return { ok: true }
    } catch { return { ok: false } }
  })
  ipcMain.handle('settings-preset-export-file', async (event, payload: unknown) => {
    if (!isSettingsWindowSender(event)) return { ok: false, error: 'unauthorized' }
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const text = typeof record.text === 'string' ? record.text : ''
    if (!text || Buffer.byteLength(text, 'utf8') > MAX_PRESET_TRANSFER_BYTES) {
      return { ok: false, error: 'invalid' }
    }
    const suggested = typeof record.suggestedName === 'string' &&
      /^[\w\u4e00-\u9fa5.-]{1,120}\.json$/.test(record.suggestedName)
      ? record.suggestedName
      : 'uta-user-presets.json'
    try {
      const options = {
        title: '导出用户预设',
        defaultPath: path.join(app.getPath('downloads'), suggested),
        filters: [{ name: 'Uta 用户预设', extensions: ['json'] }],
      }
      const parent = settingsWindowManager.getSettingsWindow()
      const result = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { ok: false, error: 'cancelled' }
      await fs.promises.writeFile(result.filePath, text, 'utf8')
      return { ok: true, path: result.filePath }
    } catch {
      return { ok: false, error: 'write-failed' }
    }
  })

    ipcMain.handle('settings-motion-export-file', async (event, payload: unknown) => {
    if (!isSettingsWindowSender(event)) return { ok: false, error: 'unauthorized' }
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const text = typeof record.text === 'string' ? record.text : ''
    if (!text || Buffer.byteLength(text, 'utf8') > MAX_PRESET_TRANSFER_BYTES) {
      return { ok: false, error: 'invalid' }
    }
    const suggested = typeof record.suggestedName === 'string' &&
      /^[\w\u4e00-\u9fa5.-]{1,120}\.(motion3\.json|json)$/.test(record.suggestedName)
      ? record.suggestedName
      : 'motion.motion3.json'
    try {
      const options = {
        title: '导出 Live2D motion3.json 动作文件',
        defaultPath: path.join(app.getPath('downloads'), suggested),
        filters: [
          { name: 'Live2D Motion (*.motion3.json)', extensions: ['motion3.json', 'json'] },
          { name: 'JSON (*.json)', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      }
      const parent = settingsWindowManager.getSettingsWindow()
      const result = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { ok: false, error: 'cancelled' }
      await fs.promises.writeFile(result.filePath, text, 'utf8')
      return { ok: true, path: result.filePath }
    } catch {
      return { ok: false, error: 'write-failed' }
    }
  })

  ipcMain.handle('settings-preset-import-file', async (event) => {
    if (!isSettingsWindowSender(event)) return { ok: false, error: 'unauthorized' }
    try {
      const options = {
        title: '导入用户预设',
        properties: ['openFile'] as Array<'openFile'>,
        filters: [{ name: 'Uta 用户预设', extensions: ['json'] }],
      }
      const parent = settingsWindowManager.getSettingsWindow()
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      const file = result.filePaths[0]
      if (result.canceled || !file) return { ok: false, error: 'cancelled' }
      const stat = await fs.promises.stat(file)
      if (!stat.isFile() || stat.size > MAX_PRESET_TRANSFER_BYTES) return { ok: false, error: 'too-large' }
      return { ok: true, text: await fs.promises.readFile(file, 'utf8') }
    } catch {
      return { ok: false, error: 'read-failed' }
    }
  })

  // 宿主会话开始时是否主动呼出桌宠（只影响窗口显示，不改变宿主绑定）
  ipcMain.handle('get-summon-on-host-start', (event) => {
    if (!isTrustedUiSender(event)) return null
    return summonOnHostStart
  })

  ipcMain.handle('set-summon-on-host-start', (event, enabled: boolean) => {
    if (!isTrustedUiSender(event) || typeof enabled !== 'boolean') return false
    const previous = summonOnHostStart
    summonOnHostStart = enabled
    if (!saveWindowState()) {
      summonOnHostStart = previous
      return false
    }
    return true
  })

  // 宿主活跃状态：只看 hook 日志的更新时间，不读取其中的内容
  const HOST_HOOK_LOG_FILES: Record<string, string> = {
    qoder: 'qoder-events.jsonl',
    antigravity: 'antigravity-events.jsonl',
    codex: 'codex-events.jsonl',
    'claude-code': 'claude-code-events.jsonl',
    zcode: 'zcode-events.jsonl',
    opencode: 'opencode-events.jsonl',
    'deepseek-harness': 'deepseek-events.jsonl',
  }
  const readHookHostStatus = (host: string) => {
    const logFile = HOST_HOOK_LOG_FILES[host]
    if (!logFile) return null
    const file = path.join(environment.hooksDir, logFile)
    const recentSession = runtimeBridge?.sessions.list().find(record =>
      record.hostId === host && Date.now() - record.lastSeen < 10 * 60 * 1000)
    if (recentSession) {
      return { installed: true, active: true, lastEventAt: new Date(recentSession.lastSeen).toISOString() }
    }
    try {
      const stat = fs.statSync(file)
      return {
        installed: true,
        active: Date.now() - stat.mtimeMs < 10 * 60 * 1000,
        lastEventAt: new Date(stat.mtimeMs).toISOString(),
      }
    } catch {
      return { installed: false, active: false, lastEventAt: null }
    }
  }

  ipcMain.handle('hook-status', (event, host: string) => {
    if (!isTrustedUiSender(event) || typeof host !== 'string') return null
    return readHookHostStatus(host)
  })

  ipcMain.handle('qoder-status', (event) => {
    if (!isTrustedUiSender(event)) return null
    return readHookHostStatus('qoder')
  })

  ipcMain.handle('antigravity-status', (event) => {
    if (!isTrustedUiSender(event)) return null
    return readHookHostStatus('antigravity')
  })

  // 云端 TTS / STT 配置：Key 用 Electron safeStorage（Windows DPAPI）加密后落盘，
  // 渲染层只拿到 hasApiKey，永远拿不到明文。
  type VoiceConfigReadError = 'config-unreadable' | 'config-corrupt' | 'decrypt-failed'

  interface SecureVoiceReadState<T> {
    config: T
    encryptedApiKey: string
    exists: boolean
    previousRaw?: string
    readError?: VoiceConfigReadError
  }

  const cloudTtsConfigFile = () =>
    path.join(app.getPath('userData'), 'tts-cloud.json')
  const readCloudTtsState = (): SecureVoiceReadState<CloudTtsConfig> => {
    const fileRead = readVoiceConfigFile(cloudTtsConfigFile())
    if (fileRead.kind === 'missing') {
      return { config: normalizeCloudConfig({}), encryptedApiKey: '', exists: false }
    }
    if (fileRead.kind !== 'ok') {
      return {
        config: normalizeCloudConfig({}),
        encryptedApiKey: '',
        exists: true,
        readError: fileRead.kind === 'unreadable' ? 'config-unreadable' : 'config-corrupt',
      }
    }
    let apiKey = ''
    let readError: VoiceConfigReadError | undefined
    if (fileRead.encryptedApiKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        readError = 'decrypt-failed'
      } else {
        try {
          apiKey = safeStorage.decryptString(Buffer.from(fileRead.encryptedApiKey, 'base64'))
        } catch {
          readError = 'decrypt-failed'
        }
      }
    }
    return {
      config: normalizeCloudConfig({ ...fileRead.record, apiKey }),
      encryptedApiKey: fileRead.encryptedApiKey,
      exists: true,
      previousRaw: fileRead.raw,
      readError,
    }
  }
  const writeCloudTtsConfig = (
    config: CloudTtsConfig,
    options: { preserveEncryptedApiKey?: string; previousRaw?: string } = {},
  ): void => {
    let encryptedApiKey = options.preserveEncryptedApiKey ?? ''
    if (config.apiKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('当前系统不支持安全存储 API Key')
      }
      encryptedApiKey = safeStorage.encryptString(config.apiKey).toString('base64')
    }
    const publicConfig = normalizePublicCloudConfig(config)
    writeVoiceConfigFile(cloudTtsConfigFile(), {
      backend: publicConfig.backend,
      endpoint: publicConfig.endpoint,
      model: publicConfig.model,
      voice: publicConfig.voice,
      style: publicConfig.style,
      encryptedApiKey,
    }, { previousRaw: options.previousRaw })
  }
  const publicCloudTtsConfig = () => {
    const state = readCloudTtsState()
    return {
      ...normalizePublicCloudConfig(state.config),
      hasApiKey: !state.readError && !!state.config.apiKey,
      ...(state.readError ? { readError: state.readError } : {}),
    }
  }

  const sttConfigFile = () => path.join(app.getPath('userData'), 'stt.json')
  const readSttState = (): SecureVoiceReadState<SttConfig> => {
    const fileRead = readVoiceConfigFile(sttConfigFile())
    if (fileRead.kind === 'missing') {
      return { config: normalizeSttConfig({}), encryptedApiKey: '', exists: false }
    }
    if (fileRead.kind !== 'ok') {
      return {
        config: normalizeSttConfig({}),
        encryptedApiKey: '',
        exists: true,
        readError: fileRead.kind === 'unreadable' ? 'config-unreadable' : 'config-corrupt',
      }
    }
    let apiKey = ''
    let readError: VoiceConfigReadError | undefined
    if (fileRead.encryptedApiKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        readError = 'decrypt-failed'
      } else {
        try {
          apiKey = safeStorage.decryptString(Buffer.from(fileRead.encryptedApiKey, 'base64'))
        } catch {
          readError = 'decrypt-failed'
        }
      }
    }
    return {
      config: normalizeSttConfig({ ...fileRead.record, apiKey }),
      encryptedApiKey: fileRead.encryptedApiKey,
      exists: true,
      previousRaw: fileRead.raw,
      readError,
    }
  }
  const writeSttConfig = (
    config: SttConfig,
    options: { preserveEncryptedApiKey?: string; previousRaw?: string } = {},
  ): void => {
    let encryptedApiKey = options.preserveEncryptedApiKey ?? ''
    if (config.apiKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('当前系统不支持安全存储 API Key')
      }
      encryptedApiKey = safeStorage.encryptString(config.apiKey).toString('base64')
    }
    const publicConfig = normalizePublicSttConfig(config)
    writeVoiceConfigFile(sttConfigFile(), {
      enabled: publicConfig.enabled,
      provider: publicConfig.provider,
      backend: publicConfig.backend,
      endpoint: publicConfig.endpoint,
      model: publicConfig.model,
      language: publicConfig.language,
      localEndpoint: publicConfig.localEndpoint,
      autoSend: publicConfig.autoSend,
      encryptedApiKey,
    }, { previousRaw: options.previousRaw })
  }
  const publicSttConfig = () => {
    const state = readSttState()
    return {
      ...normalizePublicSttConfig(state.config),
      hasApiKey: !state.readError && !!state.config.apiKey,
      ...(state.readError ? { readError: state.readError } : {}),
    }
  }

  ipcMain.handle('stt-get-config', (event) => {
    if (!isTrustedUiSender(event)) return null
    return publicSttConfig()
  })

  ipcMain.handle('stt-save-config', (event, payload: unknown) => {
    if (!isTrustedUiSender(event)) return { ok: false, error: 'unauthorized' }
    try {
      const record =
        payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
      const state = readSttState()
      if (shouldBlockVoiceConfigWrite(state.readError)) {
        return { ok: false, error: state.readError }
      }
      const existing = state.config
      const next = mergeSttConfig(existing, record)
      const explicitKey = record.clearKey === true ||
        (typeof record.apiKey === 'string' && record.apiKey.trim().length > 0)
      const preserveEncryptedApiKey = shouldPreserveEncryptedApiKey(
        state.readError,
        explicitKey,
        sameSttOwner(existing, next),
      ) ? state.encryptedApiKey : undefined
      writeSttConfig(next, {
        preserveEncryptedApiKey,
        previousRaw: state.previousRaw,
      })
      return { ok: true, config: { ...normalizePublicSttConfig(next), hasApiKey: !!next.apiKey } }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error) }
    }
  })

  ipcMain.handle('stt-transcribe', async (event, payload: unknown) => {
    if (!isTrustedUiSender(event)) return { ok: false, error: 'unauthorized' }
    try {
      const record =
        payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
      const state = readSttState()
      if (state.readError === 'config-unreadable' || state.readError === 'config-corrupt' ||
        (state.readError === 'decrypt-failed' && state.config.provider === 'cloud')) {
        return { ok: false, error: '语音识别配置无法读取，请打开设置检查后重试。' }
      }
      const text = await transcribeAudio(
        state.config,
        typeof record.audioBase64 === 'string' ? record.audioBase64 : '',
      )
      return { ok: true, text }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error) }
    }
  })

  ipcMain.handle('tts-cloud-get-config', (event) => {
    if (!isTrustedUiSender(event)) return null
    return publicCloudTtsConfig()
  })

  ipcMain.handle('tts-cloud-save-config', (event, payload: unknown) => {
    if (!isTrustedUiSender(event)) return { ok: false, error: 'unauthorized' }
    try {
      const record =
        payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
      const state = readCloudTtsState()
      if (shouldBlockVoiceConfigWrite(state.readError)) {
        return { ok: false, error: state.readError }
      }
      const existing = state.config
      const next = mergeCloudTtsConfig(existing, record)
      const explicitKey = record.clearKey === true ||
        (typeof record.apiKey === 'string' && record.apiKey.trim().length > 0)
      const preserveEncryptedApiKey = shouldPreserveEncryptedApiKey(
        state.readError,
        explicitKey,
        sameCloudTtsOwner(existing, next),
      ) ? state.encryptedApiKey : undefined
      writeCloudTtsConfig(next, {
        preserveEncryptedApiKey,
        previousRaw: state.previousRaw,
      })
      return { ok: true, config: { ...normalizePublicCloudConfig(next), hasApiKey: !!next.apiKey } }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error) }
    }
  })

  ipcMain.handle('host-bridge-send', async (event, payload: unknown) => {
    if (!isRuntimeSender(event) && !isSettingsWindowSender(event)) return { ok: false, code: 'failed', error: 'unauthorized' }
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const hostId = typeof record.host === 'string' ? record.host : ''
    if (!boundHostId || hostId !== boundHostId) {
      return { ok: false, code: 'failed', delivery: 'not-sent', error: '绑定的宿主已改变，请确认目标后重新发送。' }
    }
    const expected = record.expectedSessionId
    if (expected !== undefined && (typeof expected !== 'string' || !expected.trim() || expected.length > 200)) {
      return { ok: false, code: 'failed', delivery: 'not-sent', error: '无法确认目标聊天。' }
    }
    return sendHostText(hostId, typeof record.text === 'string' ? record.text : '', expected)
  })

  ipcMain.handle('tts-synthesize', async (event, payload: unknown) => {
    if (!isRuntimeSender(event)) return { ok: false, error: 'unauthorized' }
    try {
      const record =
        payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
      if (record.provider === 'cloud') {
        const state = readCloudTtsState()
        if (state.readError) {
          return { ok: false, error: '云端 TTS 配置无法读取，请打开设置检查后重试。' }
        }
        const config = state.config
        const requestStyle = typeof record.style === 'string' ? record.style.trim() : ''
        const result = await synthesizeCloudSpeech(
          requestStyle ? { ...config, style: requestStyle } : config,
          record.text,
          typeof record.speed === 'number' ? record.speed : 1,
        )
        return { ok: true, ...result }
      }
      const result = await synthesizeSpeech(record as any)
      return { ok: true, ...result }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error) }
    }
  })

  // 启动本机角色指令与审批端点
  startRuntimeBridge({
    profile: environment.profile,
    stableData: environment.isStable,
    onSessionEvent: (command, meta) => codexConversations.observe(command, meta),
    endpointFile: environment.endpointFile,
    allowedHostId: () => boundHostId,
    extraEndpointFile: boundHostId ? boundHostEndpointFile(boundHostId) : '',
    sink: async (command, meta) => {
      if (command.command === 'claude_task_delta') {
        if (meta.hostId !== 'claude-code' || !meta.sessionId || meta.legacy) return false
        const changed = todoStore.applyClaudeTaskDelta({ ...command, sessionId: meta.sessionId })
        if (changed) broadcastTodoChanged()
        return true
      }
      if (command.command === 'todo_snapshot') {
        const changed = todoStore.applyHostSnapshot({
          hostId: meta.hostId,
          sessionId: meta.sessionId ?? '',
          cwd: command.cwd ?? '',
          source: command.source,
          title: command.title,
          items: command.items,
        })
        if (changed) broadcastTodoChanged()
        return true
      }
      // summon 由主进程直接处理，不依赖渲染层订阅状态
      if (command.command === 'summon') {
        if (summonOnHostStart) summonPetWindow()
        return true
      }
      if (!runtimeCommandReady || !mainWindow || mainWindow.isDestroyed()) return false
      const rendererMeta = command.command === 'agent_state' && command.state === 'completed'
        ? { ...meta, completion: {
            ...(meta.sessionId ? { sessionTitle: sessionTitle(meta.hostId, meta.sessionId) } : {}),
            ...(meta.eventId ? { eventKey: createHash('sha256').update(JSON.stringify([
              meta.hostId, meta.hostInstanceId, meta.sessionId, meta.eventId,
            ])).digest('hex') } : {}),
          } }
        : meta
      return windowCommandSink(RUNTIME_COMMAND_CHANNEL, () => mainWindow)(command, rendererMeta)
    },
    available: () => runtimeCommandReady && !!mainWindow && !mainWindow.isDestroyed(),
    onApprovalRequest: async (request: RuntimeApprovalRequest, signal: AbortSignal) => {
      if (!runtimeCommandReady || !mainWindow || mainWindow.isDestroyed()) {
        return 'unavailable'
      }
      return new Promise<RuntimeApprovalDecision>((resolve) => {
        pendingApprovals.set(request.requestId, resolve)
        updateWindowMouseIgnore()
        // 卡片渲染出来还不够：IDE 可能全屏覆盖，必须主动把窗口提到最前
        presentApprovalWindow()

        signal.addEventListener(
          'abort',
          () => {
            if (pendingApprovals.has(request.requestId)) {
              mainWindow?.webContents.send(RUNTIME_APPROVAL_CANCEL_CHANNEL, request.requestId)
              resolvePendingApproval(request.requestId, 'cancelled')
            }
          },
          { once: true },
        )

        mainWindow?.webContents.send(RUNTIME_APPROVAL_REQUEST_CHANNEL, request)
      })
    },
    onApprovalCancel: (requestId: string) => {
      resolvePendingApproval(requestId, 'cancelled')
      mainWindow?.webContents.send(RUNTIME_APPROVAL_CANCEL_CHANNEL, requestId)
    },
    getContextSnapshot: () => ({
      modelContext: currentModelContext,
    }),
    onMotionRequest: request => {
      const pet = mainWindow?.webContents
      if (!runtimeCommandReady || !pet || pet.isDestroyed() || pendingMotion.size >= 12) {
        return Promise.resolve({ ok: false, error: 'motion-unavailable' })
      }
      const id = randomUUID(), timeout = 2500
      return new Promise<MotionResult>(resolve => {
        const finish = (result: MotionResult) => {
          clearTimeout(timer)
          pendingMotion.delete(id)
          resolve(result)
        }
        const timer = setTimeout(() => finish({ ok: false, error: 'motion-renderer-timeout' }), timeout)
        pendingMotion.set(id, { frame: pet.mainFrame, finish })
        try { pet.send('runtime-motion-request', { id, deadline: Date.now() + timeout, request }) }
        catch { finish({ ok: false, error: 'motion-unavailable' }) }
      })
    },
  })
    .then((bridge) => {
      runtimeBridge = bridge
      console.info(`[uta] runtime command & approval endpoint on 127.0.0.1:${bridge.port}`)
    })
    .catch((err) => {
      console.warn('[uta] runtime command endpoint unavailable:', err)
    })

  ipcMain.handle('reload-window', () => {
    reloadRenderer(true)
  })

  ipcMain.handle('close-window', () => {
    mainWindow?.close()
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (settingsWindowManager.deferQuitUntilSettingsClosed(() => app.quit())) {
    event.preventDefault()
    return
  }
  isQuitting = true
  if (rendererRecoveryTimer) {
    clearTimeout(rendererRecoveryTimer)
    rendererRecoveryTimer = null
  }
  settingsQuitting = true
  if (dailyReminderTimer) {
    clearInterval(dailyReminderTimer)
    dailyReminderTimer = null
  }
  checkDailyReminders = undefined
  settingsWindowManager.closeSettingsWindow()
  guardSettingsQuit(event)
  void runtimeBridge?.close().catch(() => {})
  runtimeBridge = null
  stopGlobalCursorPolling()
  stopFullscreenProbe?.()
  globalShortcut.unregisterAll()
  if (tray) {
    tray.destroy()
    tray = null
  }
})
