/**
 * 宿主角色指令与审批载荷的校验与归一化（P2 / L0 + DeepSeek Harness 扩展）。
 *
 * 本文件刻意不 import 任何东西：可在 Node 中直接单测，也不依赖 Electron。
 *
 * 设计原则（对应可移植方案第 9 节权限分级）：
 * - 只接受固定白名单指令，绝不接受任意命令/路径/URL。
 * - 所有文本字段有长度上限，控制字符被剔除，避免注入与撑爆 UI。
 * - 未知字段被忽略，未知指令被拒绝，而不是猜测意图。
 */

import type { TodoStatus } from '../shared/todo-contracts'
import type { ChatImage } from '../shared/chat-history-contracts'

/** 允许的角色指令 */
export type RuntimeCommandName =
  | 'notify'
  | 'choice_hint'
  | 'set_emotion'
  | 'play_animation'
  | 'agent_state'
  | 'agent_narrate'
  | 'rp_reply'
  | 'set_preset'
  | 'summon'
  | 'hello'
  | 'session_bind'
  | 'todo_snapshot'
  | 'claude_task_delta'

/** v2 信封里的归属信息；sessionId/turnId 缺失时按宿主或会话范围处理，不伪造。 */
export interface RuntimeEventMeta {
  modelRevision?: string
  hostId: string
  hostInstanceId?: string
  sessionId?: string
  turnId?: string
  eventId?: string
  seq?: number
  ts?: string
  legacy?: boolean
}

/** Agent 工作状态枚举 */
export type AgentWorkingState =
  | 'idle'
  | 'thinking'
  | 'streaming'
  | 'tool_running'
  | 'error'
  | 'completed'

export const AGENT_WORKING_STATES: readonly AgentWorkingState[] = [
  'idle',
  'thinking',
  'streaming',
  'tool_running',
  'error',
  'completed',
] as const

/**
 * 状态解说意图：宿主只说“我在做什么”，具体台词、情绪和预设由渲染层决定。
 * 这样各宿主插件不需要复制中文文案，也不会把用户提示词带进桌宠。
 */
export const NARRATION_INTENTS = [
  'session_start',
  'thinking',
  'looking',
  'searching',
  'reading',
  'defining',
  'editing',
  'testing',
  'running',
  'researching',
  'waiting',
  'found',
  'progress',
  'success',
  'error',
  'retry',
] as const

export type NarrationIntent = (typeof NARRATION_INTENTS)[number]

export interface NotifyCommand {
  command: 'notify'
  text: string
  /** 模型主动发言：显示气泡并按“回复”设置朗读 */
  speak?: boolean
}

/** 宿主在等用户选择方案：用重点色气泡提示回宿主处理 */
export interface ChoiceHintCommand {
  command: 'choice_hint'
  text: string
}

export interface EmotionCommand {
  command: 'set_emotion'
  emotion: string
}

export interface AnimationCommand {
  command: 'play_animation'
  name: string
  loop: boolean
}

export interface AgentStateCommand {
  command: 'agent_state'
  state: AgentWorkingState
  label?: string
  toolName?: string
  /** 可选：让桌宠用一句状态解说配合这次状态变化 */
  narrate?: NarrationIntent
}

/** 宿主上报“当前在做什么”，由桌宠决定台词、情绪与预设 */
export interface AgentNarrateCommand {
  command: 'agent_narrate'
  intent: NarrationIntent
  toolName?: string
  /** true 表示来自推理流的视觉联动：只切预设，偶尔给一句极短状态 */
  reasoning?: boolean
}

export interface RpReplyCommand {
  command: 'rp_reply'
  /**
   * 回复文本。默认是增量片段，渲染层按追加语义拼接。
   * 当 replace:true 时，text 是该 requestId 的完整快照，渲染层直接覆盖已有文本；
   * 这样即使宿主发送累计全文或重写文本，也不会重复拼接。
   * done:true 的收尾帧可携带完整快照，也可以为空串（保留已有文本）。
   */
  text: string
  emotion?: string
  preset?: string
  streaming: boolean
  done: boolean
  replace?: boolean
  requestId?: string
}

export interface SetPresetCommand {
  command: 'set_preset'
  preset: string
  mode?: 'revert' | 'hold' | 'loop'
}

/** 宿主会话开始：请求把桌宠窗口带到前台（是否生效由用户开关决定） */
export interface SummonCommand {
  command: 'summon'
}

/** 协议握手：宿主声明 SDK 版本与能力，由桥记录，不进渲染层。 */
export interface HelloCommand {
  command: 'hello'
  sdkVersion?: string
  capabilities?: string[]
  label?: string
}

/** 宿主显式绑定当前会话；没有 sessionId 时退化为宿主范围。 */
export interface SessionBindCommand {
  command: 'session_bind'
  label?: string
  cwd?: string
  userInitiated?: boolean
}

/** 宿主计划/待办的完整快照；只读镜像，不反向修改宿主。 */
export interface TodoSnapshotCommand {
  command: 'todo_snapshot'
  source: string
  cwd?: string
  title?: string
  items: Array<{ text: string; status: TodoStatus }>
}

export interface ClaudeTaskDeltaCommand {
  command: 'claude_task_delta'
  action: 'create' | 'update'
  id: string
  text?: string
  status?: TodoStatus | 'deleted'
  cwd?: string
}

export interface DirectActionsCommand {
  command: 'direct_actions'
  prompt?: string
  plan?: Record<string, unknown>
}

export type RuntimeCommand =
  | DirectActionsCommand
  | NotifyCommand
  | ChoiceHintCommand
  | EmotionCommand
  | AnimationCommand
  | AgentStateCommand
  | AgentNarrateCommand
  | RpReplyCommand
  | { command: 'chat_image'; image: ChatImage; description: string }
  | SetPresetCommand
  | SummonCommand
  | HelloCommand
  | SessionBindCommand
  | TodoSnapshotCommand
  | ClaudeTaskDeltaCommand

export type ValidationResult =
  | { ok: true; value: RuntimeCommand }
  | { ok: false; error: string }

/** 审批请求载荷（由宿主插件发往 POST /approval/ask） */
export interface RuntimeApprovalRequest {
  requestId: string
  toolName: string
  reason: string
  displayReason: string
  host: string
  sessionId?: string
  timeoutMs: number
}

/** 桌宠用户对审批请求的决策结果 */
export type RuntimeApprovalDecision = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** 未知/损坏的审批决策一律 fail-closed 为拒绝，不能默认放行 */
export function normalizeApprovalDecision(raw: unknown): RuntimeApprovalDecision {
  return raw === 'allowed-once' || raw === 'rejected' || raw === 'cancelled' || raw === 'unavailable'
    ? raw
    : 'rejected'
}

export type ApprovalValidationResult =
  | { ok: true; value: RuntimeApprovalRequest }
  | { ok: false; error: string }

/** 通知文本上限（字符数） */
export const MAX_NOTIFY_CHARS = 200
/** RP 回复气泡文本上限（字符数） */
export const MAX_RP_REPLY_CHARS = 600
/** 审批原因文本上限（字符数） */
export const MAX_APPROVAL_REASON_CHARS = 300
/** 情绪/动作标识符上限 */
export const MAX_TOKEN_CHARS = 32
/** 预设/分组名上限（允许中文预设名与分组名） */
export const MAX_PRESET_NAME_CHARS = 36
/** 宿主计划快照的条目数与单条文字上限 */
export const MAX_TODO_ITEMS = 50
export const MAX_TODO_TEXT_CHARS = 200

/** 标识符白名单：字母数字下划线连字符。中文等一律拒绝，避免歧义与注入。 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** 请求 ID 白名单：允许字母数字、下划线、连字符、点、冒号 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/

/** 预设/分组名白名单：允许中文、字母、数字、常见分隔点与下划线连字符，禁止注入字符 */
const PRESET_NAME_PATTERN = /^[\u4e00-\u9fa5A-Za-z0-9_·\-\s]{1,36}$/

/** 动作名称上限（字符数，支持中文与原生带符号动作组名） */
export const MAX_ANIMATION_NAME_CHARS = 48

/** 动作名称白名单：允许中文、日文、字母、数字、连字符、下划线、@符号、#序号、点与空格 */
const ANIMATION_NAME_PATTERN = /^[\u4e00-\u9fa5\u3040-\u30ffA-Za-z0-9_·\-@#\s.]{1,48}$/


/**
 * 归一化文本：去除 C0/C1 控制字符与零宽字符，压缩空白，并做长度截断。
 * 返回空串表示无可显示内容。
 */
export function sanitizeText(raw: unknown, maxChars: number = MAX_NOTIFY_CHARS): string {
  if (typeof raw !== 'string') return ''
  const stripped = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!stripped) return ''
  return stripped.length > maxChars ? stripped.slice(0, maxChars) : stripped
}

/** 气泡正文保留 Markdown 需要的换行，其余控制字符仍按空格处理。 */
export function sanitizeMessageText(raw: unknown, maxChars: number = MAX_NOTIFY_CHARS): string {
  if (typeof raw !== 'string') return ''
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  const normalized = lines
    .map((line) => {
      const leading = /^\s*/.exec(line)?.[0] ?? ''
      const indent = leading.replace(/\t/g, '  ')
      const body = line.slice(leading.length).replace(/[\t ]+/g, ' ').replace(/[ \t]+$/, '')
      return `${indent}${body}`
    })
    .join('\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029]/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!normalized) return ''
  return normalized.length > maxChars ? normalized.slice(0, maxChars) : normalized
}

/** 校验标识符（情绪键、动作名） */
export function sanitizeToken(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const value = raw.trim()
  return TOKEN_PATTERN.test(value) ? value : ''
}

/** 校验请求 ID（用于流式消息 requestId 与审批 requestId） */
export function sanitizeRequestId(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const value = raw.trim()
  return REQUEST_ID_PATTERN.test(value) ? value : ''
}

/** 校验预设名或情绪分组名（支持中文如 "开心"、"思考·托腮" 及英文 ID） */
export function sanitizePresetName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const value = raw.trim()
  if (!value || value.length > MAX_PRESET_NAME_CHARS) return ''
  return PRESET_NAME_PATTERN.test(value) ? value : ''
}

/** 校验动作名称（支持中文原生动作如 "脱捕"、"狗尾巴草打开" 及标准动作键） */
export function sanitizeAnimationName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const value = raw.trim()
  if (!value || value.length > MAX_ANIMATION_NAME_CHARS) return ''
  return ANIMATION_NAME_PATTERN.test(value) ? value : ''
}

export interface ModelContextGroup {
  group: string
  emotion: string
  presets: string[]
}

export interface ModelContextSummary {
  revision?: string
  ready?: boolean
  kind?: 'live2d' | 'image-set'
  animations?: string[]
  modelName: string
  emotions: string[]
  presetGroups: ModelContextGroup[]
}

const MAX_MODEL_NAME_CHARS = 80
const MAX_MODEL_EMOTIONS = 64
const MAX_PRESET_GROUPS = 20
const MAX_PRESETS_PER_GROUP = 30

/**
 * 模型元数据来自用户可写目录，注入宿主 System Prompt 前必须去控制字符并限长。
 * 任何缺失/非法字段回退到上一份可信快照，绝不把原始对象透传出去。
 */
export function normalizeModelContext(
  raw: unknown,
  fallback: ModelContextSummary,
): ModelContextSummary {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback
  const record = raw as Record<string, unknown>

  const modelName = sanitizeText(record.modelName, MAX_MODEL_NAME_CHARS) || fallback.modelName

  let emotions = fallback.emotions
  if (Array.isArray(record.emotions)) {
    emotions = Array.from(
      new Set(
        record.emotions
          .map((emotion) => sanitizeText(emotion, 32))
          .filter(Boolean),
      ),
    ).slice(0, MAX_MODEL_EMOTIONS)
  }

  let presetGroups = fallback.presetGroups
  if (Array.isArray(record.presetGroups)) {
    presetGroups = record.presetGroups
      .slice(0, MAX_PRESET_GROUPS)
      .map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
        const groupRecord = entry as Record<string, unknown>
        const group = sanitizePresetName(groupRecord.group)
        if (!group) return null
        const emotion = sanitizeText(groupRecord.emotion, 32) || 'neutral'
        const presets = Array.isArray(groupRecord.presets)
          ? Array.from(
              new Set(
                groupRecord.presets
                  .map((preset) => sanitizePresetName(preset))
                  .filter(Boolean),
              ),
            ).slice(0, MAX_PRESETS_PER_GROUP)
          : []
        return { group, emotion, presets }
      })
      .filter((group): group is ModelContextGroup => !!group)
  }

  return { modelName, emotions, presetGroups,
    ...(typeof record.revision === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(record.revision) ? { revision: record.revision } : {}),
    ...(typeof record.ready === 'boolean' ? { ready: record.ready } : {}),
    ...(record.kind === 'live2d' || record.kind === 'image-set' ? { kind: record.kind } : {}),
    ...(Array.isArray(record.animations) ? { animations: [...new Set(record.animations.map(value => sanitizeText(value, 80)).filter(Boolean))].slice(0, 100) } : {}),
  }
}

/**
 * 校验一条来自宿主（MCP 工具或 DeepSeek Harness 插件）的角色指令。
 * 任何不符合契约的输入都返回 ok:false 与简短原因，绝不抛异常。
 */
export function validateRuntimeCommand(payload: unknown): ValidationResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'command payload must be an object' }
  }
  const record = payload as Record<string, unknown>
  const name = record.command

  switch (name) {
    case 'notify': {
      const text = sanitizeMessageText(record.text, MAX_NOTIFY_CHARS)
      if (!text) return { ok: false, error: 'text is empty or invalid' }
      return {
        ok: true,
        value: { command: 'notify', text, ...(record.speak === true ? { speak: true } : {}) },
      }
    }

    case 'choice_hint': {
      const text = sanitizeMessageText(record.text, MAX_NOTIFY_CHARS)
      if (!text) return { ok: false, error: 'text is empty or invalid' }
      return { ok: true, value: { command: 'choice_hint', text } }
    }

    case 'set_emotion': {
      const emotion = sanitizeToken(record.emotion)
      if (!emotion) {
        return { ok: false, error: `emotion must match /^[A-Za-z0-9_-]{1,${MAX_TOKEN_CHARS}}$/` }
      }
      return { ok: true, value: { command: 'set_emotion', emotion } }
    }

    case 'play_animation': {
      const animName = sanitizeAnimationName(record.name)
      if (!animName) {
        return { ok: false, error: 'name is empty or contains invalid characters' }
      }
      // loop 只接受真正的布尔值；缺失视为 false
      const loop = record.loop === true
      return { ok: true, value: { command: 'play_animation', name: animName, loop } }
    }

    case 'agent_state': {
      const rawState = typeof record.state === 'string' ? record.state.trim() : ''
      if (!AGENT_WORKING_STATES.includes(rawState as AgentWorkingState)) {
        return {
          ok: false,
          error: `state must be one of: ${AGENT_WORKING_STATES.join(', ')}`,
        }
      }
      const label = sanitizeText(record.label, 80)
      const toolName = sanitizeText(record.toolName, 64)
      const rawNarrate = typeof record.narrate === 'string' ? record.narrate.trim() : ''
      const narrate = NARRATION_INTENTS.includes(rawNarrate as NarrationIntent)
        ? (rawNarrate as NarrationIntent)
        : undefined
      return {
        ok: true,
        value: {
          command: 'agent_state',
          state: rawState as AgentWorkingState,
          ...(label ? { label } : {}),
          ...(toolName ? { toolName } : {}),
          ...(narrate ? { narrate } : {}),
        },
      }
    }

    case 'agent_narrate': {
      const rawIntent = typeof record.intent === 'string' ? record.intent.trim() : ''
      if (!NARRATION_INTENTS.includes(rawIntent as NarrationIntent)) {
        return {
          ok: false,
          error: `intent must be one of: ${NARRATION_INTENTS.join(', ')}`,
        }
      }
      const toolName = sanitizeText(record.toolName, 64)
      const reasoning = record.reasoning === true
      return {
        ok: true,
        value: {
          command: 'agent_narrate',
          intent: rawIntent as NarrationIntent,
          ...(toolName ? { toolName } : {}),
          ...(reasoning ? { reasoning: true } : {}),
        },
      }
    }

    case 'rp_reply': {
      const streaming = record.streaming === true
      const done = record.done === true
      const replace = record.replace === true
      const text = sanitizeMessageText(record.text, MAX_RP_REPLY_CHARS)
      const requestId = sanitizeRequestId(record.requestId)
      if (!text && !(done && requestId)) {
        return { ok: false, error: 'rp_reply requires non-empty text (or done:true with requestId)' }
      }
      const emotion = sanitizePresetName(record.emotion)
      const preset = sanitizePresetName(record.preset)
      return {
        ok: true,
        value: {
          command: 'rp_reply',
          text,
          streaming,
          done,
          ...(replace ? { replace: true } : {}),
          ...(emotion ? { emotion } : {}),
          ...(preset ? { preset } : {}),
          ...(requestId ? { requestId } : {}),
        },
      }
    }

    case 'set_preset': {
      const preset = sanitizePresetName(record.preset)
      if (!preset) {
        return { ok: false, error: 'preset is empty or contains invalid characters' }
      }
      const rawMode = typeof record.mode === 'string' ? record.mode.trim() : ''
      const mode: 'revert' | 'hold' | 'loop' | undefined =
        rawMode === 'revert' || rawMode === 'hold' || rawMode === 'loop' ? rawMode : undefined
      return {
        ok: true,
        value: {
          command: 'set_preset',
          preset,
          ...(mode ? { mode } : {}),
        },
      }
    }

    case 'direct_actions': {
      const prompt = typeof record.prompt === 'string' ? sanitizeText(record.prompt, 1000) : ''
      const plan = record.plan && typeof record.plan === 'object' && !Array.isArray(record.plan)
        ? (record.plan as Record<string, unknown>)
        : undefined
      if (!prompt && !plan) {
        return { ok: false, error: 'direct_actions requires either a prompt string or a plan object' }
      }
      return {
        ok: true,
        value: {
          command: 'direct_actions',
          ...(prompt ? { prompt } : {}),
          ...(plan ? { plan } : {}),
        },
      }
    }

    case 'summon':
      return { ok: true, value: { command: 'summon' } }

    case 'hello': {
      const sdkVersion = sanitizeText(record.sdkVersion, 64)
      const label = sanitizeText(record.label, 80)
      const capabilities = Array.isArray(record.capabilities)
        ? [...new Set(record.capabilities.map((value) => sanitizeToken(value)).filter(Boolean))].slice(0, 32)
        : []
      return {
        ok: true,
        value: {
          command: 'hello',
          ...(sdkVersion ? { sdkVersion } : {}),
          ...(capabilities.length > 0 ? { capabilities } : {}),
          ...(label ? { label } : {}),
        },
      }
    }

    case 'session_bind': {
      const label = sanitizeText(record.label, 80)
      const cwd = sanitizeText(record.cwd, 500)
      return {
        ok: true,
        value: {
          command: 'session_bind',
          ...(record.userInitiated === true ? { userInitiated: true } : {}),
          ...(label ? { label } : {}),
          ...(typeof record.cwd === 'string' ? { cwd } : {}),
        },
      }
    }

    case 'claude_task_delta': {
      const action = record.action
      const id = typeof record.id === 'string' ? record.id.trim() : ''
      if ((action !== 'create' && action !== 'update') || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
        return { ok: false, error: 'invalid claude task action or id' }
      }
      const text = sanitizeText(record.text, MAX_TODO_TEXT_CHARS)
      const status = record.status
      if (status !== undefined && status !== 'pending' && status !== 'in_progress' && status !== 'completed' && status !== 'deleted') {
        return { ok: false, error: 'invalid claude task status' }
      }
      if ((action === 'create' && (!text || status === 'deleted')) || (action === 'update' && !text && status === undefined)) {
        return { ok: false, error: 'empty claude task delta' }
      }
      const cwd = sanitizeText(record.cwd, 500)
      return { ok: true, value: { command: 'claude_task_delta', action, id, ...(text ? { text } : {}), ...(status ? { status } : {}), ...(cwd ? { cwd } : {}) } }
    }
    case 'todo_snapshot': {
      if (!Array.isArray(record.items)) {
        return { ok: false, error: 'todo_snapshot.items must be an array' }
      }
      const source = sanitizeToken(record.source) || 'host-plan'
      const cwd = sanitizeText(record.cwd, 500)
      const title = sanitizeText(record.title, 120)
      const items = record.items
        .slice(0, MAX_TODO_ITEMS)
        .map((raw) => {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
          const item = raw as Record<string, unknown>
          const text = sanitizeText(item.text, MAX_TODO_TEXT_CHARS)
          if (!text) return null
          const rawStatus = typeof item.status === 'string' ? item.status.trim() : ''
          const status: TodoStatus = rawStatus === 'completed' || rawStatus === 'in_progress' || rawStatus === 'inProgress'
            ? rawStatus === 'inProgress' ? 'in_progress' : rawStatus
            : 'pending'
          return { text, status }
        })
        .filter((item): item is { text: string; status: TodoStatus } => !!item)
      return {
        ok: true,
        value: {
          command: 'todo_snapshot',
          source,
          ...(cwd ? { cwd } : {}),
          ...(title ? { title } : {}),
          items,
        },
      }
    }

    default:
      return { ok: false, error: `unsupported command: ${String(name)}` }
  }
}

/**
 * 校验来自宿主插件的交互式工具审批请求（POST /approval/ask）。
 */
export function validateApprovalRequest(payload: unknown): ApprovalValidationResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'approval payload must be an object' }
  }
  const record = payload as Record<string, unknown>
  const requestId = sanitizeRequestId(record.requestId)
  if (!requestId) {
    return { ok: false, error: 'requestId is required and must be a valid identifier' }
  }
  const toolName = sanitizeText(record.toolName, 80)
  if (!toolName) {
    return { ok: false, error: 'toolName is required' }
  }
  const reason = sanitizeText(record.reason, MAX_APPROVAL_REASON_CHARS)
  const displayReason =
    sanitizeText(record.displayReason, MAX_APPROVAL_REASON_CHARS) ||
    reason ||
    `请求执行工具 ${toolName}`
  const host = sanitizeText(record.host || record.hostId, 40) || 'deepseek-harness'
  const sessionId = sanitizeText(record.sessionId, 200)
  const rawTimeout = Number(record.timeoutMs)
  const timeoutMs = Number.isFinite(rawTimeout)
    ? Math.max(5000, Math.min(600000, Math.round(rawTimeout)))
    : 120000

  return {
    ok: true,
    value: {
      requestId,
      toolName,
      reason: reason || displayReason,
      displayReason,
      host,
      ...(sessionId ? { sessionId } : {}),
      timeoutMs,
    },
  }
}
