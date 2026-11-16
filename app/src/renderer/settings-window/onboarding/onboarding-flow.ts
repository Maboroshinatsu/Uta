/**
 * First-run onboarding: pure flow rules and presentation helpers.
 *
 * Nothing in this module talks to IPC or the store. It only decides step order,
 * whether a step may advance, how host cards are ordered, and how backend
 * stage results are described. Components own all side effects.
 */
import type {
  OnboardingDetection,
  OnboardingHost,
  OnboardingHostId,
  OnboardingStage,
  OnboardingStageId,
  OnboardingStageState,
} from '../../../shared/host-onboarding-contracts'

export const ONBOARDING_STEPS = ['welcome', 'host', 'character', 'voice', 'start'] as const
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]

export const STEP_LABELS: Readonly<Record<OnboardingStepId, string>> = Object.freeze({
  welcome: '欢迎',
  host: '连接宿主',
  character: '选择角色',
  voice: '语音',
  start: '开始使用',
})

export const STEP_HINTS: Readonly<Record<OnboardingStepId, string>> = Object.freeze({
  welcome: '约 1 分钟',
  host: '可跳过',
  character: '可跳过',
  voice: '可选',
  start: '确认',
})

export function isOnboardingStep(value: unknown): value is OnboardingStepId {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value)
}

export function resolveOnboardingStep(value: unknown): OnboardingStepId {
  return isOnboardingStep(value) ? value : 'welcome'
}

export function stepIndex(step: OnboardingStepId): number {
  return ONBOARDING_STEPS.indexOf(step)
}

export function stepNumber(step: OnboardingStepId): string {
  return String(stepIndex(step) + 1).padStart(2, '0')
}

export function nextOnboardingStep(step: OnboardingStepId): OnboardingStepId | null {
  return ONBOARDING_STEPS[stepIndex(step) + 1] ?? null
}

export function previousOnboardingStep(step: OnboardingStepId): OnboardingStepId | null {
  const index = stepIndex(step)
  return index > 0 ? ONBOARDING_STEPS[index - 1] : null
}

export function laterStep(a: OnboardingStepId, b: OnboardingStepId): OnboardingStepId {
  return stepIndex(b) > stepIndex(a) ? b : a
}

/** The rail may only jump back, or forward to a step the user already reached. */
export function canNavigateToStep(target: OnboardingStepId, furthest: OnboardingStepId): boolean {
  return stepIndex(target) <= stepIndex(furthest)
}

export type StepDecision = 'pending' | 'done' | 'skipped'

export interface OnboardingStepDecisions {
  host: StepDecision
  character: StepDecision
}

export function canSkipStep(step: OnboardingStepId): boolean {
  return step === 'host' || step === 'character' || step === 'voice'
}

/**
 * Returns the next step, or null when the current step still needs a decision.
 * Host and character are always skippable, so "pending" only means the user has
 * neither chosen nor pressed skip yet.
 */
export function advanceFrom(
  step: OnboardingStepId,
  decisions: OnboardingStepDecisions,
): OnboardingStepId | null {
  switch (step) {
    case 'welcome':
      return 'host'
    case 'host':
      return decisions.host === 'pending' ? null : 'character'
    case 'character':
      return decisions.character === 'pending' ? null : 'voice'
    case 'voice':
      return 'start'
    case 'start':
      return null
    default:
      return null
  }
}

export function canAdvanceFrom(
  step: OnboardingStepId,
  decisions: OnboardingStepDecisions,
): boolean {
  return advanceFrom(step, decisions) !== null
}

export function primaryActionLabel(step: OnboardingStepId, reentry = false): string {
  switch (step) {
    case 'welcome':
      return reentry ? '继续设置' : '开始设置'
    case 'host':
      return '下一步：选择角色'
    case 'character':
      return '下一步：语音'
    case 'voice':
      return '下一步：确认'
    case 'start':
      return reentry ? '返回设置' : '完成设置'
    default:
      return '下一步'
  }
}

export function skipActionLabel(step: OnboardingStepId): string | null {
  switch (step) {
    case 'host':
      return '跳过宿主连接'
    case 'character':
      return '跳过角色选择'
    case 'voice':
      return '跳过语音设置'
    default:
      return null
  }
}

/** `finish` records 'skipped' rather than claiming a host that was not chosen. */
export function finishedHostId(hostId: string | null, hostSkipped: boolean): string {
  const trimmed = typeof hostId === 'string' ? hostId.trim() : ''
  return hostSkipped || !trimmed ? 'skipped' : trimmed
}

/* ------------------------------------------------------------------ */
/* Stage matrix                                                        */
/* ------------------------------------------------------------------ */

export const ONBOARDING_STAGE_ORDER: readonly OnboardingStageId[] = Object.freeze([
  'detected',
  'plugin',
  'tools',
  'runtime',
  'session',
  'response',
])

export const STAGE_LABELS: Readonly<Record<OnboardingStageId, string>> = Object.freeze({
  detected: '检测宿主',
  plugin: '安装插件',
  tools: '桥接工具',
  runtime: '启动运行时',
  session: '绑定会话',
  response: '回声校验',
})

export const STAGE_STATE_LABELS: Readonly<Record<OnboardingStageState, string>> = Object.freeze({
  verified: '已验证',
  pending: '等待中',
  manual: '需手动',
  failed: '失败',
  unavailable: '无法确认',
})

export function isOnboardingStageId(value: unknown): value is OnboardingStageId {
  return typeof value === 'string' && (ONBOARDING_STAGE_ORDER as readonly string[]).includes(value)
}

export function isOnboardingStageState(value: unknown): value is OnboardingStageState {
  return value === 'verified' || value === 'pending' || value === 'manual' ||
    value === 'failed' || value === 'unavailable'
}

export const MISSING_STAGE_DETAIL = '本次结果没有包含这一阶段。'
export const EMPTY_STAGE_DETAIL = '接口没有提供这一阶段的说明。'

/**
 * Always returns all six stages in contract order. A stage the backend did not
 * return is marked `unavailable` — never silently treated as verified.
 */
export function orderedStages(
  stages: readonly OnboardingStage[] | null | undefined,
): OnboardingStage[] {
  const provided = new Map<OnboardingStageId, OnboardingStage>()
  for (const stage of stages ?? []) {
    if (!stage || !isOnboardingStageId(stage.id)) continue
    provided.set(stage.id, stage)
  }
  return ONBOARDING_STAGE_ORDER.map(id => {
    const stage = provided.get(id)
    if (!stage) return { id, state: 'unavailable', detail: MISSING_STAGE_DETAIL }
    return {
      id,
      state: isOnboardingStageState(stage.state) ? stage.state : 'unavailable',
      detail: typeof stage.detail === 'string' && stage.detail.trim()
        ? stage.detail
        : EMPTY_STAGE_DETAIL,
    }
  })
}

/** Install results override detection-time stages for the same stage id. */
export function mergeStageLists(
  base: readonly OnboardingStage[] | null | undefined,
  result: readonly OnboardingStage[] | null | undefined,
): OnboardingStage[] {
  const merged = new Map<OnboardingStageId, OnboardingStage>()
  for (const stage of base ?? []) {
    if (stage && isOnboardingStageId(stage.id)) merged.set(stage.id, stage)
  }
  for (const stage of result ?? []) {
    if (stage && isOnboardingStageId(stage.id)) merged.set(stage.id, stage)
  }
  return [...merged.values()]
}

export function hasStageEvidence(stages: readonly OnboardingStage[] | null | undefined): boolean {
  return Array.isArray(stages) && stages.some(stage => !!stage && isOnboardingStageId(stage.id))
}

export interface OnboardingStageSummary {
  total: number
  verified: number
  pending: number
  manual: number
  failed: number
  unavailable: number
  allVerified: boolean
  hasEvidence: boolean
  needsAttention: boolean
  headline: string
}

export function summarizeStages(
  stages: readonly OnboardingStage[] | null | undefined,
): OnboardingStageSummary {
  const ordered = orderedStages(stages)
  const counts = { verified: 0, pending: 0, manual: 0, failed: 0, unavailable: 0 }
  for (const stage of ordered) counts[stage.state] += 1

  const evidence = hasStageEvidence(stages)
  const allVerified = evidence && counts.verified === ONBOARDING_STAGE_ORDER.length
  const bits: string[] = []
  if (!evidence) {
    bits.push('尚无阶段结果')
  } else if (allVerified) {
    bits.push('全部阶段已验证')
  } else {
    if (counts.verified) bits.push(`${counts.verified} 个阶段已验证`)
    if (counts.failed) bits.push(`${counts.failed} 个阶段失败`)
    if (counts.manual) bits.push(`${counts.manual} 个阶段需要手动完成`)
    if (counts.pending) bits.push(`${counts.pending} 个阶段仍在等待`)
    if (counts.unavailable) bits.push(`${counts.unavailable} 个阶段无法确认`)
  }

  return {
    total: ONBOARDING_STAGE_ORDER.length,
    ...counts,
    allVerified,
    hasEvidence: evidence,
    needsAttention: counts.failed > 0 || counts.manual > 0,
    headline: bits.join('，'),
  }
}

/* ------------------------------------------------------------------ */
/* Hosts                                                               */
/* ------------------------------------------------------------------ */

export type DetectionState = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
export type HostMode = 'auto' | 'manual' | 'compatible'
export type HostBadgeTone = 'accent' | 'success' | 'muted' | 'warning' | 'danger'

export interface HostBadge {
  id: string
  label: string
  tone: HostBadgeTone
}

export interface OnboardingHostCardModel {
  host: OnboardingHost
  mode: HostMode
  placeholder: boolean
}

export const PRIMARY_HOSTS = [
  {
    id: 'codex',
    name: 'Codex',
    description: '把 Codex 里的工作进度、工具调用与回复同步到桌面，让 Uta 跟着你的节奏回应。',
  },
  {
    id: 'deepseek-harness',
    name: 'DeepSeek Harness',
    description: '接入 DeepSeek Harness 的会话与工具，让 Uta 在长时间任务里保持陪伴。',
  },
] as const

export const HOST_ORDER: readonly OnboardingHostId[] = Object.freeze([
  'codex',
  'deepseek-harness',
  'maibot',
  'qoder',
  'antigravity',
  'claude-code',
  'zcode',
  'opencode',
  'standalone',
])

const PRIMARY_IDS: readonly string[] = PRIMARY_HOSTS.map(host => host.id)

export function placeholderHost(id: OnboardingHostId): OnboardingHost {
  const primary = PRIMARY_HOSTS.find(host => host.id === id)
  return {
    id,
    name: primary?.name ?? id,
    description: primary?.description ?? '本次检测没有返回这个宿主的说明。',
    installed: false,
    executable: '',
    configPath: '',
    autoInstall: false,
    pluginInstalled: false,
    pluginVersion: '',
    stages: [],
    notes: [],
    manualSteps: [],
  }
}

export function hostMode(host: OnboardingHost): HostMode {
  // MaiBot 由随包插件接入，不需要也不应该让 Uta 改写 MaiBot 的配置。
  if (host.id === 'maibot') return 'compatible'
  if (!host.autoInstall) return 'manual'
  return PRIMARY_IDS.includes(host.id) ? 'auto' : 'compatible'
}

export const HOST_MODE_LABELS: Readonly<Record<HostMode, string>> = Object.freeze({
  auto: '自动安装',
  manual: '手动配置',
  compatible: '兼容接入',
})

export function hostModeLabel(mode: HostMode): string {
  return HOST_MODE_LABELS[mode] ?? HOST_MODE_LABELS.manual
}

/** Codex first, then DeepSeek Harness, then any other host the backend found. */
export function buildHostCards(
  hosts: readonly OnboardingHost[] | null | undefined,
): OnboardingHostCardModel[] {
  const source = Array.isArray(hosts)
    ? hosts.filter((host): host is OnboardingHost => !!host && typeof host.id === 'string')
    : []
  const provided = new Map<string, OnboardingHost>()
  for (const host of source) if (!provided.has(host.id)) provided.set(host.id, host)
  const detectedIds = new Set(provided.keys())

  const ordered: OnboardingHost[] = []
  for (const id of HOST_ORDER) {
    const detected = provided.get(id)
    if (detected) {
      ordered.push(detected)
      provided.delete(id)
    } else if (PRIMARY_IDS.includes(id)) {
      ordered.push(placeholderHost(id))
    }
  }
  for (const host of provided.values()) ordered.push(host)

  return ordered.map(host => ({
    host,
    mode: hostMode(host),
    placeholder: !detectedIds.has(host.id),
  }))
}

export function hostName(
  id: string | null | undefined,
  hosts?: readonly OnboardingHost[] | null,
): string {
  const trimmed = typeof id === 'string' ? id.trim() : ''
  if (!trimmed) return '未选择'
  const detected = (hosts ?? []).find(host => host.id === trimmed)
  if (detected?.name) return detected.name
  const primary = PRIMARY_HOSTS.find(host => host.id === trimmed)
  return primary?.name ?? trimmed
}

/** Only badge facts the detection actually reported; never infer a connection. */
export function hostBadges(
  host: OnboardingHost,
  runtime: OnboardingDetection['runtime'] | null | undefined,
  detectionState: DetectionState = 'ready',
  placeholder = false,
): HostBadge[] {
  if (detectionState === 'loading' || detectionState === 'idle') {
    return [{ id: 'detection', label: '正在检测…', tone: 'muted' }]
  }
  if (detectionState !== 'ready') {
    return [{ id: 'detection', label: '检测暂不可用', tone: 'warning' }]
  }
  if (placeholder) {
    return [{ id: 'detected', label: '本次检测未出现', tone: 'muted' }]
  }

  if (host.id === 'maibot') {
    return [
      { id: 'bundled', label: '随包适配器', tone: 'muted' },
      { id: 'manual', label: '需放入 MaiBot', tone: 'muted' },
    ]
  }

  const badges: HostBadge[] = []
  const detectionDetail = host.stages.find(stage => stage.id === 'detected')?.detail ?? ''
  const detectionUnsupported = detectionDetail.includes('暂不支持自动检测')
  badges.push(host.installed
    ? { id: 'installed', label: '已安装', tone: 'success' }
    : {
        id: 'installed',
        label: detectionUnsupported ? '暂不支持自动检测' : '未检测到安装',
        tone: 'muted',
      })
  badges.push(host.pluginInstalled
    ? {
        id: 'plugin',
        label: host.pluginVersion ? `插件已安装 v${host.pluginVersion}` : '插件已安装',
        tone: 'success',
      }
    : {
        id: 'plugin',
        label: detectionUnsupported ? '插件状态未知' : '插件未安装',
        tone: 'muted',
      })

  if (runtime?.activeHostId === host.id) {
    badges.push(runtime.connected
      ? { id: 'runtime', label: '运行时已连接', tone: 'success' }
      : { id: 'runtime', label: '运行时未连接', tone: 'muted' })
  }
  return badges
}

/* ------------------------------------------------------------------ */
/* Runtime / sessions                                                  */
/* ------------------------------------------------------------------ */

export const NEW_SESSION_LABEL = '新会话启动后绑定'

export interface OnboardingRuntimeSummary {
  connected: boolean
  activeHostId: string
  hostName: string
  sessionLabel: string
  sessionId: string
  sessionBound: boolean
}

export function runtimeSummary(
  detection: OnboardingDetection | null | undefined,
  hosts?: readonly OnboardingHost[] | null,
): OnboardingRuntimeSummary {
  const runtime = detection?.runtime
  const sessions = Array.isArray(runtime?.sessions) ? runtime.sessions : []
  const session = sessions.find(item => item?.selected) ?? sessions[0] ?? null
  const activeHostId = typeof runtime?.activeHostId === 'string' ? runtime.activeHostId : ''
  const sessionId = typeof session?.sessionId === 'string' ? session.sessionId.trim() : ''
  const rawLabel = typeof session?.label === 'string' ? session.label.trim() : ''
  const sessionLabel = rawLabel || (sessionId ? '未命名会话' : NEW_SESSION_LABEL)

  return {
    connected: runtime?.connected === true,
    activeHostId,
    hostName: activeHostId ? hostName(activeHostId, hosts) : (runtime?.connected === true ? 'Uta 运行时（等待宿主会话）' : '尚未检测到运行时'),
    sessionLabel,
    sessionId,
    sessionBound: !!session,
  }
}

export function sessionSummaryText(summary: OnboardingRuntimeSummary): string {
  if (!summary.sessionBound) return NEW_SESSION_LABEL
  return summary.sessionId
    ? `${summary.sessionLabel} · ${summary.sessionId}`
    : summary.sessionLabel
}

/* ------------------------------------------------------------------ */
/* Characters                                                          */
/* ------------------------------------------------------------------ */

export interface OnboardingModelEntry {
  name: string
  url: string
  kind: 'live2d' | 'image-set'
}

export function modelKindLabel(kind: string): string {
  return kind === 'image-set' ? '静态立绘' : 'Live2D'
}

export function pathTail(url: string): string {
  return (typeof url === 'string' ? url : '').split(/[\\/]/).filter(Boolean).pop() ?? ''
}

export function modelDisplayName(
  models: readonly OnboardingModelEntry[] | null | undefined,
  url: string,
  emptyLabel = '正在读取当前角色…',
): string {
  if (!url) return emptyLabel
  const matched = (models ?? []).find(model => model.url === url)
  if (matched?.name) return matched.name
  const tail = pathTail(url)
    .replace(/\.model3\.json$/i, '')
    .replace(/\.[^.]+$/, '')
  return tail || '当前角色'
}

/**
 * The built-in default is the configured MODEL_PATH when present, otherwise the
 * first Live2D model, so "use default" still works when the bundled path moved.
 */
export function defaultModelUrl(
  models: readonly OnboardingModelEntry[] | null | undefined,
  fallbackPath = '',
): string {
  const list = models ?? []
  if (fallbackPath) {
    const exact = list.find(model => model.url === fallbackPath)
    if (exact) return exact.url
    const tail = pathTail(fallbackPath)
    if (tail) {
      const matched = list.find(model => pathTail(model.url) === tail)
      if (matched) return matched.url
    }
  }
  return list.find(model => model.kind === 'live2d')?.url ?? list[0]?.url ?? ''
}

export function isDefaultModel(
  url: string,
  models: readonly OnboardingModelEntry[] | null | undefined,
  fallbackPath = '',
): boolean {
  const fallback = defaultModelUrl(models, fallbackPath)
  return !!url && !!fallback && url === fallback
}

/* ------------------------------------------------------------------ */
/* Voice / errors                                                      */
/* ------------------------------------------------------------------ */

export function voiceStateLabel(enabled: boolean): string {
  return enabled ? '已开启' : '保持关闭（默认）'
}

/** Show the backend's actual message; do not replace it with a generic guess. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim()
    if (message) return message
  }
  if (typeof error === 'string' && error.trim()) return error.trim()
  return '未知错误（接口没有提供说明）'
}
