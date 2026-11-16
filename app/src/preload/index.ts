import { contextBridge, ipcRenderer } from 'electron'
import type { MotionDispatch, MotionResult } from '../shared/motion-choreography'
import { SETTINGS_MODE_CHANNEL } from '../shared/settings-integration-contracts'
import { SETTINGS_CHANNELS } from '../shared/settings-contracts'
import type { SettingsAuthorityMode } from '../shared/settings-integration-contracts'
import type { SettingsDocument, SettingsPatchRequest, SettingsState, SettingsWriteResult } from '../shared/settings-contracts'
import type { PetSettingsCommand, PetSettingsCommandResult, PetSettingsDispatch, PetSettingsModelContext } from '../shared/settings-command-contracts'
import { SETTINGS_WINDOW_CHANNELS, type SettingsCloseRequest } from '../shared/settings-window-contracts'
import { COMPANION_HTTP_CHANNEL, type CompanionHttpHost } from '../shared/companion-http-contract'

interface GlobalCursorPosition {
  screenX: number
  screenY: number
  windowX: number
  windowY: number
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
  name: string
  displayName?: string
  url: string
  kind: 'live2d' | 'image-set'
}

contextBridge.exposeInMainWorld('utaAPI', {
  getEnvironmentInfo: () => ipcRenderer.invoke('environment-info'),
  // ── 窗口 ──
  dragWindow: (dx: number, dy: number) => ipcRenderer.invoke('drag-window', { dx, dy }),
  getWindowPlacement: (): Promise<WindowPlacement | null> => ipcRenderer.invoke('get-window-placement'),
  getUiState: (): Promise<{ clickThroughLocked: boolean; hoverFadeEnabled: boolean }> =>
    ipcRenderer.invoke('get-ui-state'),
  onWindowPlacement: (callback: (placement: WindowPlacement) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, placement: WindowPlacement) => callback(placement)
    ipcRenderer.on('window-placement', listener)
    return () => ipcRenderer.removeListener('window-placement', listener)
  },
  setAlwaysOnTop: (flag: boolean) => ipcRenderer.invoke('set-always-on-top', flag),
  setClickThroughLocked: (flag: boolean) => ipcRenderer.invoke('set-click-through-locked', flag),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  reloadWindow: () => ipcRenderer.invoke('reload-window'),

  // ── 指针与窗口状态 ──
  onGlobalCursorPosition: (callback: (position: GlobalCursorPosition) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, position: GlobalCursorPosition) => callback(position)
    ipcRenderer.on('global-cursor-position', listener)
    return () => ipcRenderer.removeListener('global-cursor-position', listener)
  },
  onResetModelView: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('reset-model-view', listener)
    return () => ipcRenderer.removeListener('reset-model-view', listener)
  },
  onSetHoverFade: (callback: (enabled: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, enabled: boolean) => callback(enabled)
    ipcRenderer.on('set-hover-fade', listener)
    return () => ipcRenderer.removeListener('set-hover-fade', listener)
  },
  onSetClickThroughLocked: (callback: (locked: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, locked: boolean) => callback(locked)
    ipcRenderer.on('set-click-through-locked', listener)
    return () => ipcRenderer.removeListener('set-click-through-locked', listener)
  },
  onVoiceInputToggle: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('voice-input-toggle', listener)
    return () => ipcRenderer.removeListener('voice-input-toggle', listener)
  },

  // ── 模型资源与预设持久化 ──
  listModels: (): Promise<ModelEntry[]> => ipcRenderer.invoke('list-models'),
  pickModelImport: (kind: 'folder' | 'zip') => ipcRenderer.invoke('model-import-pick', kind),
  installModelImport: (request: unknown) => ipcRenderer.invoke('model-import-install', request),
  cancelModelImport: (token: string) => ipcRenderer.invoke('model-import-cancel', token),
  inspectModelAssets: (modelUrl: string) => ipcRenderer.invoke('inspect-model-assets', modelUrl),
  saveModelCalibration: (payload: unknown) => ipcRenderer.invoke('settings-save-model-calibration', payload),
  readModelCalibrations: () => ipcRenderer.invoke('settings-read-model-calibrations'),
  mergeModelCalibrations: (payload: unknown) => ipcRenderer.invoke('settings-merge-model-calibrations', payload),
  /** @deprecated Model sidecar writes are disabled; retained only for older documents. */
  saveModelPresets: (modelUrl: string, presets: unknown): Promise<boolean> =>
    ipcRenderer.invoke('save-model-presets', modelUrl, presets),
  openModelsFolder: () => ipcRenderer.invoke('open-models-folder'),
  controlWindow: (action: 'minimize' | 'toggle-maximize' | 'close' | 'state') =>
    ipcRenderer.invoke('control-window', action),
  getOnboardingState: () => ipcRenderer.invoke('onboarding-state'),
  completeOnboarding: (hostId: string) => ipcRenderer.invoke('onboarding-complete', hostId),
  detectOnboardingHosts: () => ipcRenderer.invoke('onboarding-detect-hosts'),
  detectInstalledHosts: () => ipcRenderer.invoke('detected-hosts'),
  requestCompanionHost: (host: CompanionHttpHost, base: string, route: string, body?: string): Promise<number | null> =>
    ipcRenderer.invoke(COMPANION_HTTP_CHANNEL, host, base, route, body),
  getTodoState: () => ipcRenderer.invoke('todo-get-state'),
  getSessionTitles: (references: import('../shared/session-title').SessionReference[]) => ipcRenderer.invoke('session-titles', references),
  onTodoChanged: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('todo-changed', listener)
    return () => ipcRenderer.removeListener('todo-changed', listener)
  },
  getDailyState: () => ipcRenderer.invoke('daily-get-state'),
  dailyAddItem: (payload: unknown) => ipcRenderer.invoke('daily-add-item', payload),
  dailyUpdateItem: (payload: unknown) => ipcRenderer.invoke('daily-update-item', payload),
  dailyDeleteItem: (payload: unknown) => ipcRenderer.invoke('daily-delete-item', payload),
  dailyClearCompleted: () => ipcRenderer.invoke('daily-clear-completed'),
  dailySnoozeItem: (payload: unknown) => ipcRenderer.invoke('daily-snooze-item', payload),
  dailySetReminderSound: (enabled: boolean) => ipcRenderer.invoke('daily-set-reminder-sound', enabled),
  onDailyChanged: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('daily-changed', listener)
    return () => ipcRenderer.removeListener('daily-changed', listener)
  },
  onDailyReminder: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('daily-reminder-due', listener)
    return () => ipcRenderer.removeListener('daily-reminder-due', listener)
  },
  installOnboardingHost: (hostId: string) => ipcRenderer.invoke('onboarding-install-host', hostId),
  unblockOnboardingHost: (hostId: string) => ipcRenderer.invoke('onboarding-unblock-install', hostId),
  petBinding: (() => {
    try {
      const initial = ipcRenderer.sendSync('pet-binding') as {
        binding: { version: 1; hostId: string; boundAt: string } | null
      }
      const state = { binding: initial?.binding ?? null }
      ipcRenderer.on('pet-binding-changed', (_event, payload: { binding: { version: 1; hostId: string; boundAt: string } | null }) => {
        state.binding = payload?.binding ?? null
      })
      return state
    } catch {
      return { binding: null }
    }
  })(),
  bindPetHost: (hostId: string) => ipcRenderer.invoke('pet-bind-host', hostId),
  switchPetHost: (hostId: string) => ipcRenderer.invoke('pet-switch-host', hostId),
  unbindPetHost: () => ipcRenderer.invoke('pet-unbind-host'),
  getPetBinding: () => ipcRenderer.invoke('pet-binding-state'),
  onPetBindingChanged: (
    callback: (payload: {
      binding: { version: 1; hostId: string; boundAt: string } | null
    }) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { binding: { version: 1; hostId: string; boundAt: string } | null },
    ) => callback(payload)
    ipcRenderer.on('pet-binding-changed', listener)
    return () => ipcRenderer.removeListener('pet-binding-changed', listener)
  },

  // ── 宿主角色指令与交互式审批（DeepSeek Harness / Codex / ...）──
  /** 渲染层订阅完成后调用，主进程据此判断指令是否真正可达 */
  notifyRuntimeReady: () => ipcRenderer.send('runtime-command-ready'),
  onRuntimeCommand: (callback: (command: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: unknown) => callback(command)
    ipcRenderer.on('runtime-command', listener)
    return () => ipcRenderer.removeListener('runtime-command', listener)
  },
  onMotionRequest: (callback: (dispatch: MotionDispatch) => MotionResult) => {
    const listener = (_event: Electron.IpcRendererEvent, dispatch: MotionDispatch) => {
      if (Date.now() > dispatch.deadline) return
      let result: MotionResult
      try { result = callback(dispatch) }
      catch { result = { ok: false, error: 'motion-renderer-failed' } }
      ipcRenderer.send('runtime-motion-result', dispatch.id, result)
    }
    ipcRenderer.on('runtime-motion-request', listener)
    return () => ipcRenderer.removeListener('runtime-motion-request', listener)
  },
  onApprovalRequest: (callback: (request: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: unknown) => callback(request)
    ipcRenderer.on('runtime-approval-request', listener)
    return () => ipcRenderer.removeListener('runtime-approval-request', listener)
  },
  onApprovalCancel: (callback: (requestId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, requestId: string) => callback(requestId)
    ipcRenderer.on('runtime-approval-cancel', listener)
    return () => ipcRenderer.removeListener('runtime-approval-cancel', listener)
  },
  resolveApproval: (
    requestId: string,
    decision: 'allowed-once' | 'rejected' | 'unavailable',
  ): Promise<boolean> => ipcRenderer.invoke('resolve-approval', { requestId, decision }),

  // ── 模型运行时上下文同步 ──
  syncModelContext: (context: unknown): Promise<boolean> =>
    ipcRenderer.invoke('sync-model-context', context),

  /** 宿主连接状态（主进程持有运行时端点，渲染层据此显示） */
  getHostStatus: () => ipcRenderer.invoke('host-status'),

  /** 连接引导：会话列表与选择、宿主路径检查/选择 */
  getHostSessions: (hostId: string) => ipcRenderer.invoke('settings-host-sessions', hostId),
  getHostInputStatus: (hostId: string) => ipcRenderer.invoke('host-input-status', hostId),
  selectHostSession: (hostId: string, sessionId: string | null) =>
    ipcRenderer.invoke('settings-host-session-select', { hostId, sessionId }),
  getHostPathInfo: (hostId: string) => ipcRenderer.invoke('settings-host-path-info', hostId),
  chooseHostPath: (hostId: string) => ipcRenderer.invoke('settings-host-path-choose', hostId),
  chooseDshHome: () => ipcRenderer.invoke('settings-dsh-home-choose'),
  exportPresetFile: (payload: { suggestedName: string; text: string }) =>
    ipcRenderer.invoke('settings-preset-export-file', payload),
  exportMotionFile: (payload: { suggestedName: string; text: string }) =>
    ipcRenderer.invoke('settings-motion-export-file', payload),
  importPresetFile: () => ipcRenderer.invoke('settings-preset-import-file'),
  exportSettingsTransfer: (text: string) => ipcRenderer.invoke('settings-transfer-export', text),
  importSettingsTransfer: () => ipcRenderer.invoke('settings-transfer-import'),
  backupSettingsTransfer: (text: string) => ipcRenderer.invoke('settings-transfer-backup', text),
  previewTodoRecovery: (payload: { kind: 'project' | 'daily'; text: string }) => ipcRenderer.invoke('todo-recovery-preview', payload),
  applyTodoRecovery: (token: string) => ipcRenderer.invoke('todo-recovery-apply', token),
  exportTodoOriginal: (kind: 'project' | 'daily') => ipcRenderer.invoke('todo-recovery-export-original', kind),

  /** Qoder 是否近期活跃（依据 hook 日志更新时间，不读取内容） */
  getQoderStatus: () => ipcRenderer.invoke('qoder-status'),

  /** Antigravity 是否近期活跃（依据 hook 日志更新时间，不读取内容） */
  getAntigravityStatus: () => ipcRenderer.invoke('antigravity-status'),

  /** 任意 hook 宿主是否近期活跃（codex / claude-code / zcode / opencode ...） */
  getHookStatus: (host: string) => ipcRenderer.invoke('hook-status', host),

  /** 宿主会话开始时是否主动呼出桌宠窗口 */
  getSummonOnHostStart: (): Promise<boolean | null> => ipcRenderer.invoke('get-summon-on-host-start'),
  setSummonOnHostStart: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('set-summon-on-host-start', enabled),

  /** 当前显示器刷新率（自适应档位使用） */
  getDisplayRefreshRate: (): Promise<number | null> => ipcRenderer.invoke('display-refresh-rate'),

  /** 本机 TTS 桥合成语音（只允许回环地址） */
  synthesizeSpeech: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('tts-synthesize', payload),
  previewSpeech: (payload: import('../shared/voice-preview-contracts').VoicePreviewRequest): Promise<import('../shared/voice-preview-contracts').VoicePreviewResult> =>
    ipcRenderer.invoke('settings-voice-preview', payload),

  /** 云端 TTS 配置（不返回 API Key 明文） */
  getCloudTtsConfig: () => ipcRenderer.invoke('tts-cloud-get-config'),
  saveCloudTtsConfig: (payload: unknown) => ipcRenderer.invoke('tts-cloud-save-config', payload),

  /** 桌宠直连宿主会话（目前支持 DeepSeek Harness / Claude Code / ZCode / OpenCode / Codex） */
  sendHostMessage: (payload: unknown) => ipcRenderer.invoke('host-bridge-send', payload),
  readChatHistory: () => ipcRenderer.invoke('chat-history-read'),
  writeChatHistory: (entries: unknown) => ipcRenderer.invoke('chat-history-write', entries),
  exportChatHistory: () => ipcRenderer.invoke('chat-history-export'),

  /** 语音输入（STT，不返回 API Key 明文） */
  getSttConfig: () => ipcRenderer.invoke('stt-get-config'),
  saveSttConfig: (payload: unknown) => ipcRenderer.invoke('stt-save-config', payload),
  transcribeAudio: (payload: unknown) => ipcRenderer.invoke('stt-transcribe', payload),

  /** 声明式适配器插件 */
  listAdapterPlugins: (): Promise<unknown[]> => ipcRenderer.invoke('list-adapter-plugins'),
  openAdaptersFolder: (): Promise<boolean> => ipcRenderer.invoke('open-adapters-folder'),
  openSettingsWindow: (domain?: string): Promise<boolean> => ipcRenderer.invoke('open-settings-window', domain),
  settingsWindow: {
    ready: (): Promise<boolean> => ipcRenderer.invoke(SETTINGS_WINDOW_CHANNELS.ready),
    onCloseRequested: (callback: (request: SettingsCloseRequest) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: SettingsCloseRequest) => callback(request)
      ipcRenderer.on(SETTINGS_WINDOW_CHANNELS.closeRequested, listener)
      return () => ipcRenderer.removeListener(SETTINGS_WINDOW_CHANNELS.closeRequested, listener)
    },
    respond: (id: number, decision: 'close' | 'cancel'): Promise<boolean> =>
      ipcRenderer.invoke(SETTINGS_WINDOW_CHANNELS.respond, id, decision),
    onNavigateDomain: (callback: (domain: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, domain: string) => callback(domain)
      ipcRenderer.on(SETTINGS_WINDOW_CHANNELS.navigateDomain, listener)
      return () => ipcRenderer.removeListener(SETTINGS_WINDOW_CHANNELS.navigateDomain, listener)
    },
    acknowledgeDomain: (domain: string): void => {
      ipcRenderer.send(SETTINGS_WINDOW_CHANNELS.domainApplied, domain)
    },
    onModelChanged: (callback: () => void): (() => void) => {
      const listener = () => callback()
      ipcRenderer.on(SETTINGS_WINDOW_CHANNELS.modelChanged, listener)
      return () => ipcRenderer.removeListener(SETTINGS_WINDOW_CHANNELS.modelChanged, listener)
    },
  },
  /** 设置窗口 → 主进程 → 桌宠窗口的白名单指令 */
  runPetSettingsCommand: (command: PetSettingsCommand, model?: PetSettingsModelContext): Promise<PetSettingsCommandResult> =>
    ipcRenderer.invoke('settings-pet-command', command, model),
  onPetSettingsCommand: (
    callback: (payload: PetSettingsDispatch) => void,
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: PetSettingsDispatch) =>
      callback(payload)
    ipcRenderer.on('pet-settings-command', listener)
    return () => ipcRenderer.removeListener('pet-settings-command', listener)
  },
  respondPetSettingsCommand: (id: string, result: PetSettingsCommandResult): void => {
    ipcRenderer.send('pet-settings-command-result', { id, result })
  },
  publicSettings: {
    getMode: (): Promise<SettingsAuthorityMode> => ipcRenderer.invoke(SETTINGS_MODE_CHANNEL),
    read: (): Promise<SettingsState | null> => ipcRenderer.invoke(SETTINGS_CHANNELS.read),
    patch: (request: SettingsPatchRequest): Promise<SettingsWriteResult> =>
      ipcRenderer.invoke(SETTINGS_CHANNELS.patch, request),
    onChanged: (callback: (document: SettingsDocument) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, document: SettingsDocument) => callback(document)
      ipcRenderer.on(SETTINGS_CHANNELS.changed, listener)
      return () => ipcRenderer.removeListener(SETTINGS_CHANNELS.changed, listener)
    },
  },
  settingsImport: {
    cancel: () => ipcRenderer.invoke('settings-import-cancel'),
    preview: (sources: import('../shared/settings-contracts').LegacySettingsSource[]) => ipcRenderer.invoke('settings-import-preview', sources),
    apply: (request: Parameters<import('../shared/settings-import-contracts').SettingsImportBridge['apply']>[0]) => ipcRenderer.invoke('settings-import-apply', request),
  },
  settingsRecovery: {
    retry: () => ipcRenderer.invoke('settings-recovery-retry'),
    preview: () => ipcRenderer.invoke('settings-recovery-preview'),
    restore: (token: string) => ipcRenderer.invoke('settings-recovery-restore', token),
    onRecovered: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('settings-recovered', listener)
      return () => ipcRenderer.removeListener('settings-recovered', listener)
    },
  },
})
