/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface GlobalCursorPosition {
  screenX: number
  screenY: number
  windowX?: number
  windowY?: number
  x: number
  y: number
}

interface WindowPlacement {
  windowX: number
  windowY: number
  windowWidth: number
  windowHeight: number
  workAreaX: number
  workAreaY: number
  workAreaWidth: number
  workAreaHeight: number
}

interface ModelEntry {
  /** 展示名，取自模型文件夹名 + 文件名 */
  name: string
  /** 模型适配文件里的可读名（如 Hiyori Pro） */
  displayName?: string
  /** 渲染层可直接加载的相对 URL 或 uta:// URL */
  url: string
  /** live2d = .model3.json；image-set = 静态立绘包 */
  kind: 'live2d' | 'image-set'
}

type AgentWorkingState =
  | 'idle'
  | 'thinking'
  | 'streaming'
  | 'tool_running'
  | 'error'
  | 'completed'

type NarrationIntent =
  | 'session_start'
  | 'thinking'
  | 'looking'
  | 'searching'
  | 'reading'
  | 'defining'
  | 'editing'
  | 'testing'
  | 'running'
  | 'researching'
  | 'waiting'
  | 'found'
  | 'progress'
  | 'success'
  | 'error'
  | 'retry'

/** 角色指令载荷；主进程已做白名单校验，渲染层只负责应用 */
type RuntimeCommandPayload =
  | { command: 'notify'; text: string; speak?: boolean }
  | { command: 'choice_hint'; text: string }
  | { command: 'set_emotion'; emotion: string }
  | { command: 'play_animation'; name: string; loop: boolean }
  | {
      command: 'agent_state'
      state: AgentWorkingState
      label?: string
      toolName?: string
      narrate?: NarrationIntent
    }
  | { command: 'agent_narrate'; intent: NarrationIntent; toolName?: string; reasoning?: boolean }
  | { command: 'chat_image'; image: import('../shared/chat-history-contracts').ChatImage; description: string }
  | {
      command: 'rp_reply'
      text: string
      emotion?: string
      preset?: string
      streaming: boolean
      done: boolean
      replace?: boolean
      requestId?: string
    }
  | { command: 'set_preset'; preset: string; mode?: 'revert' | 'hold' | 'loop' }
  | { command: 'direct_actions'; prompt?: string; plan?: Record<string, unknown> }
  | { command: 'session_bind'; label?: string; cwd?: string; userInitiated?: boolean }
  | {
      command: 'todo_snapshot'
      source: string
      cwd?: string
      items: Array<{ text: string; status: 'pending' | 'in_progress' | 'completed' }>
    }

interface RuntimeEventMetaPayload {
  modelRevision?: string
  completion?: import('../shared/chat-history-contracts').TaskCompletionDetails
  hostId: string
  hostInstanceId?: string
  sessionId?: string
  turnId?: string
  eventId?: string
  seq?: number
  ts?: string
  legacy?: boolean
}

interface RuntimeCommandEnvelopePayload {
  command: RuntimeCommandPayload
  meta: RuntimeEventMetaPayload
}

interface RuntimeApprovalRequestPayload {
  requestId: string
  toolName: string
  reason: string
  displayReason: string
  host: string
  sessionId?: string
  timeoutMs: number
}

type RuntimeApprovalDecision = 'allowed-once' | 'rejected' | 'unavailable'

interface ModelRuntimeContext {
  revision?: string
  ready?: boolean
  kind?: 'live2d' | 'image-set'
  animations?: string[]
  modelName: string
  emotions: string[]
  presetGroups: Array<{
    group: string
    emotion: string
    presets: string[]
  }>
}

/** 宿主连接状态（由主进程报告） */
interface HostStatus {
  /** 本机角色指令端点是否在监听 */
  runtimeEndpointReady: boolean
  /** 端点端口（未就绪为 null） */
  runtimePort: number | null
  /** 渲染层是否已完成订阅 */
  rendererReady: boolean
  /** 配对文件路径 */
  endpointFile?: string | null
}

/** Qoder 宿主活跃状态（依据 hook 日志更新时间，不读取内容） */
interface QoderStatus {
  /** hook 日志是否存在过（说明插件至少运行过一次） */
  installed: boolean
  /** 最近 10 分钟内是否有 hook 事件 */
  active: boolean
  lastEventAt: string | null
}

/** Antigravity 宿主活跃状态（依据 hook 日志更新时间，不读取内容） */
interface AntigravityStatus {
  /** hook 日志是否存在过（说明插件至少运行过一次） */
  installed: boolean
  /** 最近 10 分钟内是否有 hook 事件 */
  active: boolean
  lastEventAt: string | null
}

interface ModelExpressionAsset {
  name: string
  file: string
  registeredName?: string
  parameters: Array<{
    id: string
    value: number
    blend?: string
  }>
}

interface ModelDiskAssets {
  performance?: import('../shared/model-performance-contracts').ModelPerformanceAssets | null
  cdiParameters: Record<string, { name: string; group: string }>
  cdiParts: Record<string, string>
  physicsOutputIds: string[]
  vtubeHotkeys: Record<string, string>
  vtubeParameters?: Array<{ input: string; output: string }>
  expressions: ModelExpressionAsset[]
  motionParameterIds?: string[]
  motionDetails?: Record<string, { durationMs?: number; loop?: boolean }>
  poseGroups?: string[][]
  savedPresets?: Array<{
    id: string
    label: string
    description: string
    emotion: string
    group?: string
    controls: string[]
    parameters?: Record<string, number>
    steps?: Array<{
      label?: string
      durationMs: number
      holdMs: number
      controls: string[]
      parameters: Record<string, number>
      motion?: { group: string; index?: number }
    }>
    finishMode?: 'hold' | 'revert' | 'loop'
    revertHoldMs?: number
    motion?: { group: string; index?: number } | 'none'
    custom?: boolean
    source?: 'user'
  }> | null
}

interface UtaAPI {
  pickModelImport: (kind: 'folder' | 'zip') => Promise<import('../shared/model-import-contracts').ModelImportResult>
  installModelImport: (request: { token: string; candidateId: string; replace: boolean }) => Promise<{ ok: boolean; url?: string; error?: string }>
  cancelModelImport: (token: string) => Promise<void>
  settingsRecovery: import('../shared/settings-recovery-contracts').SettingsRecoveryBridge
  settingsImport: import('../shared/settings-import-contracts').SettingsImportBridge
  previewSpeech: (payload: import('../shared/voice-preview-contracts').VoicePreviewRequest) => Promise<import('../shared/voice-preview-contracts').VoicePreviewResult>
  getEnvironmentInfo: () => Promise<{
    isStable: boolean
    profile: string
    userData: string
    runtimeDir: string
    endpointFile: string
    packaged: boolean
    version: string
    sourceDir: string
    build: { commit: string | null; dirty: boolean | null; builtAt: string | null }
  } | null>
  dragWindow: (dx: number, dy: number) => Promise<void>
  getWindowPlacement: () => Promise<WindowPlacement | null>
  getUiState: () => Promise<{
    clickThroughLocked: boolean
    hoverFadeEnabled: boolean
    voiceShortcut?: string
  }>
  onWindowPlacement: (callback: (placement: WindowPlacement) => void) => () => void
  setAlwaysOnTop: (flag: boolean) => Promise<void>
  setClickThroughLocked: (flag: boolean) => Promise<void>
  minimizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  reloadWindow: () => Promise<void>

  onGlobalCursorPosition: (callback: (position: GlobalCursorPosition) => void) => () => void
  onResetModelView: (callback: () => void) => () => void
  onSetHoverFade: (callback: (enabled: boolean) => void) => () => void
  onSetClickThroughLocked: (callback: (locked: boolean) => void) => () => void
  onVoiceInputToggle: (callback: () => void) => () => void

  listModels: () => Promise<ModelEntry[]>
  inspectModelAssets: (modelUrl: string) => Promise<ModelDiskAssets | null>
  saveModelCalibration?: (payload: { modelUrl: string; signature: string; entries: import('../shared/model-calibration-contracts').ModelCalibration[]; expected: import('../shared/model-calibration-contracts').ModelCalibration[] }) => Promise<{ ok: boolean }>
  readModelCalibrations?: () => Promise<{ ok: true; models: Record<string, import('../shared/model-calibration-contracts').ModelCalibration[]> } | { ok: false }>
  mergeModelCalibrations?: (payload: { models: Record<string, import('../shared/model-calibration-contracts').ModelCalibration[]>; expected: Record<string, import('../shared/model-calibration-contracts').ModelCalibration[]> }) => Promise<{ ok: boolean; imported: number; skipped: number }>
  saveModelPresets: (modelUrl: string, presets: unknown) => Promise<boolean>
  openModelsFolder: () => Promise<string>
  controlWindow: (action: 'minimize' | 'toggle-maximize' | 'close' | 'state') =>
    Promise<{ ok: boolean; maximized?: boolean; error?: string }>
  getOnboardingState: () => Promise<{
    state: { version: 1; completed: boolean; completedAt: string | null; hostId: string } | null
    shouldOpen: boolean
  } | null>
  completeOnboarding: (hostId: string) => Promise<boolean>
  detectOnboardingHosts: () => Promise<import('../shared/host-onboarding-contracts').OnboardingDetection | null>
  detectInstalledHosts: () => Promise<{ ids: string[]; checkedAt: string } | null>
  requestCompanionHost?: (host: import('../shared/companion-http-contract').CompanionHttpHost, base: string, route: string, body?: string) => Promise<number | null>
  getTodoState: () => Promise<import('../shared/todo-contracts').TodoState | null>
  getSessionTitles?: (references: import('../shared/session-title').SessionReference[]) => Promise<import('../shared/session-title').SessionTitle[]>
  onTodoChanged: (callback: () => void) => () => void
  getDailyState: () => Promise<import('../shared/daily-todo-contracts').DailyTodoState | null>
  dailyAddItem: (payload: import('../shared/daily-todo-contracts').DailyAddItemInput) =>
    Promise<import('../shared/daily-todo-contracts').DailyMutationResult>
  dailyUpdateItem: (payload: import('../shared/daily-todo-contracts').DailyUpdateItemInput) =>
    Promise<import('../shared/daily-todo-contracts').DailyMutationResult>
  dailyDeleteItem: (payload: { id: string }) =>
    Promise<import('../shared/daily-todo-contracts').DailyMutationResult>
  dailyClearCompleted: () => Promise<import('../shared/daily-todo-contracts').DailyMutationResult>
  dailySnoozeItem: (payload: import('../shared/daily-todo-contracts').DailySnoozeInput) =>
    Promise<import('../shared/daily-todo-contracts').DailyMutationResult>
  dailySetReminderSound: (enabled: boolean) =>
    Promise<import('../shared/daily-todo-contracts').DailyMutationResult>
  onDailyChanged: (callback: () => void) => () => void
  onDailyReminder: (callback: (payload: import('../shared/daily-todo-contracts').DailyReminderPayload) => void) => () => void
  installOnboardingHost: (
    hostId: string,
  ) => Promise<import('../shared/host-onboarding-contracts').OnboardingInstallResult | null>
  unblockOnboardingHost: (hostId: string) => Promise<{ ok: boolean; error?: string } | null>
  petBinding: {
    binding: { version: 1; hostId: string; boundAt: string } | null
  }
  bindPetHost: (hostId: string) => Promise<
    | { ok: true; binding: { version: 1; hostId: string; boundAt: string } }
    | { ok: false; error: string; boundHostId?: string }
  >
  switchPetHost: (hostId: string) => Promise<
    | { ok: true; binding: { version: 1; hostId: string; boundAt: string } }
    | { ok: false; error: string }
  >
  unbindPetHost: () => Promise<{ ok: boolean; error?: string }>
  getPetBinding: () => Promise<{
    binding: { version: 1; hostId: string; boundAt: string } | null
  } | null>
  onPetBindingChanged: (
    callback: (payload: {
      binding: { version: 1; hostId: string; boundAt: string } | null
    }) => void,
  ) => () => void

  notifyRuntimeReady: () => void
  onRuntimeCommand: (callback: (payload: RuntimeCommandEnvelopePayload) => void) => () => void
  onMotionRequest?: (callback: (dispatch: import('../shared/motion-choreography').MotionDispatch) => import('../shared/motion-choreography').MotionResult) => () => void
  onApprovalRequest: (callback: (request: RuntimeApprovalRequestPayload) => void) => () => void
  onApprovalCancel: (callback: (requestId: string) => void) => () => void
  resolveApproval: (requestId: string, decision: RuntimeApprovalDecision) => Promise<boolean>

  syncModelContext: (context: ModelRuntimeContext & { settingsModelUrl: string }) => Promise<boolean>

  getHostStatus: () => Promise<HostStatus>

  getHostSessions: (hostId: string) => Promise<{
    ok: boolean
    error?: string
    sessions?: Array<{
      sessionId: string
      label: string
      cwd: string
      lastSeen: number
      lastCommand: string
      hostInstanceId: string
      available?: boolean
    }>
    selectedSessionId?: string | null
    automaticSessionId?: string | null
    selectionExpired?: boolean
  }>
  selectHostSession: (hostId: string, sessionId: string | null) => Promise<{
    ok: boolean
    error?: string
    sessions?: Array<{
      sessionId: string
      label: string
      cwd: string
      lastSeen: number
      lastCommand: string
      hostInstanceId: string
      available?: boolean
    }>
    selectedSessionId?: string | null
    automaticSessionId?: string | null
    selectionExpired?: boolean
  }>
  getHostPathInfo: (hostId: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  chooseHostPath: (hostId: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  chooseDshHome: () => Promise<{ ok: boolean; path?: string; error?: string }>
  exportPresetFile: (payload: { suggestedName: string; text: string }) =>
    Promise<{ ok: boolean; path?: string; error?: string }>
  exportMotionFile: (payload: { suggestedName: string; text: string }) =>
    Promise<{ ok: boolean; path?: string; error?: string }>
  importPresetFile: () => Promise<{ ok: boolean; text?: string; error?: string }>

  /** Qoder 是否近期活跃（依据 hook 日志更新时间，不读取内容） */
  getQoderStatus: () => Promise<QoderStatus | null>

  /** Antigravity 是否近期活跃（依据 hook 日志更新时间，不读取内容） */
  getAntigravityStatus: () => Promise<AntigravityStatus | null>

  /** 任意 hook 宿主是否近期活跃（codex / claude-code / zcode / opencode ...） */
  getHookStatus: (host: string) => Promise<QoderStatus | null>

  /** 宿主会话开始时是否主动呼出桌宠窗口 */
  getSummonOnHostStart: () => Promise<boolean | null>
  setSummonOnHostStart: (enabled: boolean) => Promise<boolean>

  /** 当前显示器刷新率（自适应档位使用） */
  getDisplayRefreshRate: () => Promise<number | null>

  /** 本机 TTS 桥合成语音（只允许回环地址） */
  synthesizeSpeech: (payload: {
    text: string
    endpoint?: string
    style?: string
    speed?: number
    timeoutMs?: number
    provider?: 'http' | 'cloud'
  }) => Promise<{
    ok: boolean
    audioBase64?: string
    mime?: string
    error?: string
  }>

  /** 云端 TTS 配置（不返回 API Key 明文） */
  getCloudTtsConfig: () => Promise<{
    backend: string
    endpoint: string
    model: string
    voice: string
    style: string
    hasApiKey: boolean
    readError?: 'config-unreadable' | 'config-corrupt' | 'decrypt-failed'
  } | null>
  saveCloudTtsConfig: (payload: {
    backend?: string
    endpoint?: string
    model?: string
    voice?: string
    style?: string
    apiKey?: string
    clearKey?: boolean
  }) => Promise<{
    ok: boolean
    error?: string
    config?: {
      backend: string
      endpoint: string
      model: string
      voice: string
      style: string
      hasApiKey: boolean
    }
  }>

  /** 语音输入（STT，不返回 API Key 明文） */
  getSttConfig: () => Promise<{
    enabled: boolean
    provider: 'cloud' | 'local'
    backend: 'siliconflow' | 'groq' | 'openai' | 'custom'
    endpoint: string
    model: string
    language: string
    localEndpoint: string
    autoSend: boolean
    hasApiKey: boolean
    readError?: 'config-unreadable' | 'config-corrupt' | 'decrypt-failed'
  } | null>
  saveSttConfig: (payload: {
    enabled?: boolean
    provider?: 'cloud' | 'local'
    backend?: 'siliconflow' | 'groq' | 'openai' | 'custom'
    endpoint?: string
    model?: string
    language?: string
    localEndpoint?: string
    autoSend?: boolean
    apiKey?: string
    clearKey?: boolean
  }) => Promise<{
    ok: boolean
    error?: string
    config?: {
      enabled: boolean
      provider: 'cloud' | 'local'
      backend: 'siliconflow' | 'groq' | 'openai' | 'custom'
      endpoint: string
      model: string
      language: string
      localEndpoint: string
      autoSend: boolean
      hasApiKey: boolean
    }
  }>
  transcribeAudio: (payload: { audioBase64: string }) => Promise<{
    ok: boolean
    text?: string
    error?: string
  }>

  getHostInputStatus?: (hostId: string) => Promise<import('../shared/host-input-status').HostInputStatus | null>

  /** 桌宠直连宿主会话，能力由主进程按配置和目标会话判断。 */
  sendHostMessage: (payload: { host: string; text: string; expectedSessionId?: string }) => Promise<{
    ok: boolean
    delivery?: import('../shared/host-delivery').HostDeliveryState
    code?: 'unsupported' | 'no-session' | 'target-changed' | 'busy' | 'failed'
    text?: string
    accepted?: boolean
    error?: string
    sessionId?: string
  }>
  readChatHistory?: () => Promise<import('../shared/chat-history-contracts').ChatHistoryReadResult>
  writeChatHistory?: (entries: import('../shared/chat-history-contracts').ChatHistoryEntry[]) => Promise<import('../shared/chat-history-contracts').ChatHistoryWriteResult>
  exportChatHistory?: () => Promise<{ ok: boolean; error?: string }>
  exportSettingsTransfer?: (text: string) => Promise<{ ok: boolean; error?: string }>
  importSettingsTransfer?: () => Promise<{ ok: boolean; text?: string; error?: string }>
  backupSettingsTransfer?: (text: string) => Promise<{ ok: boolean }>
  previewTodoRecovery?: (payload: { kind: 'project' | 'daily'; text: string }) => Promise<{ ok: boolean; token?: string; count?: number; error?: string }>
  applyTodoRecovery?: (token: string) => Promise<{ ok: boolean; error?: string }>
  exportTodoOriginal?: (kind: 'project' | 'daily') => Promise<{ ok: boolean; error?: string }>

  /** 声明式适配器插件扫描结果 */
  listAdapterPlugins: () => Promise<AdapterPluginScanEntry[]>
  openAdaptersFolder: () => Promise<boolean>
  openSettingsWindow?: (domain?: string) => Promise<boolean>
  settingsWindow?: import('../shared/settings-window-contracts').SettingsWindowBridge
  runPetSettingsCommand?: (
    command: import('../shared/settings-command-contracts').PetSettingsCommand,
    model?: import('../shared/settings-command-contracts').PetSettingsModelContext,
  ) => Promise<import('../shared/settings-command-contracts').PetSettingsCommandResult>
  onPetSettingsCommand?: (
    callback: (payload: import('../shared/settings-command-contracts').PetSettingsDispatch) => void,
  ) => () => void
  respondPetSettingsCommand?: (
    id: string,
    result: import('../shared/settings-command-contracts').PetSettingsCommandResult,
  ) => void
  publicSettings?: import('../shared/settings-integration-contracts').PublicSettingsBridge
}

interface AdapterPluginScanEntry {
  dir: string
  manifest?: unknown
  error?: string
}

interface Window {
  utaAPI?: UtaAPI
}
