import { resolveRuntimePaths } from '../../../shared/uta-environment.mjs'
/**
 * Qoder 宿主 hook：把 Qoder 的生命周期事件映射为桌宠状态。
 *
 * 设计约束（与 AGENTS.md / 可移植方案一致）：
 * - **绝不阻塞宿主**：所有失败吞掉，退出码恒为 0；hooks.json 里再标 async。
 * - **不记录用户内容**：只把事件名、字段名、工具名写入调试日志，
 *   不写 prompt / tool_input，便于后续补齐审批与正文能力而不侵犯隐私。
 * - **只取助手正文**：工作中从本地 transcript 的 assistant text 块取短汇报，
 *   最终回复从 Stop 的 last_assistant_message 取；不读用户提示与工具参数。
 * - **只做状态映射**：审批（PermissionRequest）暂不参与决策，先观察真实 payload。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createHostClient, askApproval } from '../../../shared/uta-runtime-client.mjs'
import {
  inferNarration,
  inferToolIntent,
  isUserChoiceTool,
} from '../../../shared/uta-narration.mjs'
import {
  isPetSpeechCall,
  shouldMarkPetSpoke,
  markPetSpoke,
  consumePetSpoke,
  clearPetSpeech,
} from '../../../shared/uta-pet-speech.mjs'
import { extractTodoSnapshot } from '../../../shared/uta-todo.mjs'

/** hook 的超时必须远小于宿主的等待容忍度 */
const SEND_TIMEOUT_MS = 1200
/** 审批等待上限：与 hooks.json 的 timeout（秒）保持余量 */
const APPROVAL_TIMEOUT_MS = 60_000
/** 调试日志上限，超过即重建 */
const DEBUG_LOG_LIMIT_BYTES = 256 * 1024
/** 同一会话内重复 Stop 的去重窗口 */
const STOP_DEDUP_MS = 10_000
const COMMENTARY_MAX_CHARS = 120

const hostClient = createHostClient({
  hostId: 'qoder',
  label: 'Qoder',
  sdkVersion: '0.1.11',
  capabilities: ['statusEvents', 'assistantText', 'characterTools', 'approval', 'streamingReply'],
})

export function reportHostSession(payload, env = process.env) {
  const sessionId = typeof payload?.session_id === 'string' ? payload.session_id.trim() : ''
  if (!sessionId || sessionId.length > 200) return
  const modes = { acceptEdits: 'accept_edits', bypassPermissions: 'bypass_permissions', dontAsk: 'dont_ask' }
  const permissionMode = modes[payload.permission_mode] || payload.permission_mode
  const cli = env.UTA_QODER_SURFACE === 'cli' && [env.UTA_QODER_EXE, env.UTA_QODER_CONFIG_DIR, env.UTA_QODER_PLUGIN_DIR].every(value => typeof value === 'string' && path.isAbsolute(value))
  const activity = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest'].includes(payload.hook_event_name) ? 'busy'
    : ['SessionStart', 'Stop', 'StopFailure', 'SessionEnd', 'Interrupt'].includes(payload.hook_event_name) ? 'idle' : 'unknown'
  const record = { host: 'qoder', sessionId, cwd: typeof payload.cwd === 'string' ? payload.cwd.slice(0, 500) : '', updatedAt: Date.now(), activity, inputSurface: cli ? 'cli' : 'unconfirmed',
    ...(cli ? { hostExecutable: env.UTA_QODER_EXE, hostConfigDir: env.UTA_QODER_CONFIG_DIR, hostPluginDir: env.UTA_QODER_PLUGIN_DIR } : {}),
    ...(['default', 'accept_edits', 'bypass_permissions', 'dont_ask', 'auto', 'plan'].includes(permissionMode) ? { permissionMode } : {}),
  }
  try {
    const hooks = resolveRuntimePaths(env).hooksDir
    const scoped = path.join(hooks, 'sessions/qoder', `${crypto.createHash('sha256').update(sessionId).digest('hex')}.json`)
    fs.mkdirSync(path.dirname(scoped), { recursive: true })
    for (const file of [scoped, path.join(hooks, 'qoder-session.json')]) {
      const temporary = `${file}.${crypto.randomUUID()}.tmp`
      try { fs.writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 }); fs.renameSync(temporary, file) }
      finally { try { fs.rmSync(temporary, { force: true }) } catch {} }
    }
  } catch { /* Registration failure never blocks the host. */ }
}

/**
 * 纯映射函数：便于单测，不产生任何副作用。
 * 返回 null 表示这个事件不需要驱动桌宠。
 */
export function mapEventToCommand(payload) {
  const event = String(payload?.hook_event_name || '')
  const rawTool = typeof payload?.tool_name === 'string' ? payload.tool_name.trim() : ''
  const narrate = inferNarration(event, payload)
  const withNarration = (command) => (narrate ? { ...command, narrate } : command)
  const withPostToolNarration = (command, toolName, toolPayload) => {
    if (toolPayload?.error) return withNarration(command)
    const toolIntent = toolName ? inferToolIntent(toolName, toolPayload?.tool_input) : null
    if (!toolIntent) return command
    const intent =
      toolIntent === 'looking' ||
      toolIntent === 'reading' ||
      toolIntent === 'searching' ||
      toolIntent === 'researching'
        ? 'found'
        : 'progress'
    return { ...command, narrate: intent }
  }

  switch (event) {
    case 'SessionStart':
      return withNarration({ command: 'agent_state', state: 'idle' })
    case 'UserPromptSubmit':
      return withNarration({ command: 'agent_state', state: 'thinking', label: '思考中...' })
    case 'PreToolUse':
      return withNarration({
        command: 'agent_state',
        state: 'tool_running',
        ...(rawTool ? { toolName: rawTool } : {}),
      })
    case 'PostToolUse':
      return withPostToolNarration(
        { command: 'agent_state', state: 'thinking', label: '处理结果...' },
        rawTool,
        payload,
      )
    case 'PostToolUseFailure':
      return withNarration({ command: 'agent_state', state: 'thinking', label: '处理失败，重试中...' })
    case 'SessionEnd':
      return { command: 'agent_state', state: 'idle' }
    // PermissionRequest / Notification 等：先只记录 payload 形状，不参与决策
    default:
      return null
  }
}

/**
 * 一个事件可能需要发多条指令。
 * SessionStart 除了复位状态，还请求宿主呼出桌宠；
 * 是否真正显示由 Uta 设置里的“宿主启动时呼出桌宠”开关决定。
 */
export function mapEventToCommands(payload) {
  if (String(payload?.source || '').toLowerCase() === 'compact') return []
  const command = mapEventToCommand(payload)
  if (!command) return []
  if (payload?.hook_event_name === 'SessionStart') {
    return [command, { command: 'summon' }]
  }
  return [command]
}

/** 桌宠气泡与 TTS 摘要上限字符数 */
const MAX_REPLY_SUMMARY_CHARS = 80

/** Qoder 的 recap/对话回顾是内部 JSON，不是用户可见正文 */
export function isRecapPayload(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const parsed = JSON.parse(trimmed)
    return (
      !!parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.prototype.hasOwnProperty.call(parsed, 'recap')
    )
  } catch {
    return false
  }
}

/**
 * 把最终回复压成适合小窗口和语音的一两句：
 * 去掉代码、表格、链接和角色标签；长文只保留开头摘要，不照读全文。
 */
export function summarizeReply(text) {
  if (isRecapPayload(text)) return ''
  return summarizeCommentary(text, MAX_REPLY_SUMMARY_CHARS)
}

/**
 * Stop 事件：Qoder 官方 payload 里带 `last_assistant_message`。
 * 桌宠只做"完成提示"，不搬运整段回复——小窗口读长文没有意义。
 *
 * 宿主在一次任务结束时可能连续发两次 Stop（stop_hook_active 不一定可靠），
 * 因此这里按「会话 + 回复内容哈希 + 10 秒窗口」做去重：
 * - 完全重复：什么都不发；
 * - 窗口内但内容不同：只补气泡，不重复播报「完成」。
 */
export function buildStopCommands(payload, previous = null, now = Date.now(), petSpoke = false) {
  if (payload?.stop_hook_active === true) return []

  const session = String(payload?.session_id || '')
  const hash = hashReply(payload?.last_assistant_message)
  const duplicate =
    previous &&
    previous.session === session &&
    Number.isFinite(previous.at) &&
    now - previous.at >= 0 &&
    now - previous.at < STOP_DEDUP_MS

  if (duplicate && previous.hash === hash) return []

  const commands = []
  const text = petSpoke ? '' : summarizeReply(payload?.last_assistant_message)
  if (text) {
    commands.push({ command: 'rp_reply', text })
  }
  if (!duplicate) {
    commands.push({
      command: 'agent_state',
      state: 'completed',
      label: '回复完成',
    })
  }
  return commands
}

export function hashReply(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex').slice(0, 16)
}

export function stopStateFile(env = process.env) {
  return path.join(resolveRuntimePaths(env).hooksDir, 'qoder-stop-state.json')
}

function readStopState(env) {
  try {
    const raw = JSON.parse(fs.readFileSync(stopStateFile(env), 'utf-8'))
    if (raw && typeof raw.session === 'string' && typeof raw.hash === 'string') return raw
  } catch {
    /* 首次运行或文件损坏 */
  }
  return null
}

function writeStopState(state, env) {
  try {
    const file = stopStateFile(env)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(state))
  } catch {
    /* 状态写不进去也不能影响 hook */
  }
}

/** 最终摘要只保留一两句，去掉表格/代码与表情标签 */
export function summarizeCommentary(text, maxChars = COMMENTARY_MAX_CHARS) {
  if (typeof text !== 'string' || !text.trim()) return ''
  const normalized = text.replace(/\r\n?/g, '\n')
  const withoutCode = normalized.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]+)`/g, '$1')
  const withoutTables = withoutCode
    .split('\n')
    .filter((line) => !/^\s*\|.*\|\s*$/.test(line))
    .join('\n')
  const prose = withoutTables
    .replace(/\[(?:uta|emotion|preset)\s*:[^\]]*\]/gi, '')
    .replace(/<uta\s[^>]*\/?>/gi, '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!prose) return ''
  if (prose.length <= maxChars) return prose
  const sentences = prose.match(/[^。！？!?]+[。！？!?]?/g) ?? [prose]
  let summary = (sentences[0] || prose).trim()
  if (summary.length < 24 && sentences[1]) summary = `${summary} ${sentences[1].trim()}`.trim()
  if (summary.length > maxChars) {
    const cut = summary.slice(0, maxChars)
    const punctuation = Math.max(
      cut.lastIndexOf('。'),
      cut.lastIndexOf('！'),
      cut.lastIndexOf('？'),
      cut.lastIndexOf('；'),
      cut.lastIndexOf('.'),
    )
    summary = (punctuation >= 12 ? cut.slice(0, punctuation + 1) : cut).trimEnd() + '…'
  } else if (prose.length > summary.length) {
    summary = `${summary.replace(/[。！？!?]$/, '')}…`
  }
  return summary.slice(0, maxChars + 1)
}

/**
 * 记录一次事件的“形状”（字段名 + 工具名 + 枚举类取值），用于后续实现审批/正文。
 * 刻意不记录 prompt、tool_input 等用户内容；嵌套字段只取枚举类键。
 */
export function logPayloadShape(payload, env = process.env) {
  try {
    const dir = resolveRuntimePaths(env).hooksDir
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'qoder-events.jsonl')
    try {
      if (fs.statSync(file).size > DEBUG_LOG_LIMIT_BYTES) fs.rmSync(file)
    } catch {
      /* 文件还不存在 */
    }

    const enumOnly = (value) => {
      if (!Array.isArray(value)) return undefined
      return value.map((item) => {
        if (!item || typeof item !== 'object') return typeof item
        const out = { keys: Object.keys(item).sort() }
        for (const key of Object.keys(item)) {
          if (!/^(type|behavior|kind|decision|mode|id|name)$/i.test(key)) continue
          const v = item[key]
          if (typeof v === 'string' || typeof v === 'boolean') out[key] = v
        }
        return out
      })
    }

    const toolInput =
      payload?.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : null
    const toolHints = {}
    if (toolInput) {
      for (const key of Object.keys(toolInput)) {
        if (!/^(tool|toolname|tool_name|servername|server_name|server|mcp|name)$/i.test(key)) continue
        if (typeof toolInput[key] === 'string') toolHints[key] = toolInput[key].slice(0, 80)
      }
    }

    const entry = {
      ts: new Date().toISOString(),
      event: typeof payload?.hook_event_name === 'string' ? payload.hook_event_name : '',
      keys: payload && typeof payload === 'object' ? Object.keys(payload).sort() : [],
      toolInputKeys: toolInput ? Object.keys(toolInput).sort() : undefined,
      toolHints: Object.keys(toolHints).length > 0 ? toolHints : undefined,
      tool: typeof payload?.tool_name === 'string' ? payload.tool_name : undefined,
      mode: typeof payload?.permission_mode === 'string' ? payload.permission_mode : undefined,
      session: typeof payload?.session_id === 'string' ? payload.session_id.slice(-8) : undefined,
      stopActive:
        typeof payload?.stop_hook_active === 'boolean' ? payload.stop_hook_active : undefined,
      hasMessage:
        typeof payload?.last_assistant_message === 'string'
          ? payload.last_assistant_message.length > 0
          : undefined,
      suggestions: enumOnly(payload?.permission_suggestions),
    }
    fs.appendFileSync(file, JSON.stringify(entry) + '\n')
  } catch {
    /* 调试日志失败绝不能影响 hook */
  }
}

/** 从 tool_input 里挑一个能让人看懂“要批准什么”的摘要（只用于本地审批卡片） */
export function summarizeToolInput(input) {
  if (!input || typeof input !== 'object') return ''
  const candidate =
    input.command ?? input.file_path ?? input.path ?? input.url ?? input.query ?? input.description
  return typeof candidate === 'string' ? candidate.trim().slice(0, 300) : ''
}

/**
 * 构造 Qoder 的 PermissionRequest 决策输出。
 *
 * 依据实测：Qoder 的 permission_suggestions 用 `behavior: "allow"`，
 * 与其 Agent SDK 的 can_use_tool 返回结构一致（deny 必须带 message）。
 * 注意：`permissionDecision` 是 PreToolUse 的字段，PermissionRequest 不认。
 */
export function buildPermissionDecision(decision, reason) {
  const behavior = decision === 'allow' ? 'allow' : 'deny'
  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: {
        behavior,
        ...(behavior === 'deny' ? { message: reason } : {}),
      },
    },
  }
}

/**
 * 把一次权限请求交给桌宠卡片决策。
 * 返回 null 表示不接管（桌宠离线 / 超时 / 取消），由 Qoder 走自己的弹窗。
 * 这是刻意选择的安全方向：宁可多问一次，也不静默放行。
 */
export async function handlePermissionRequest(payload, deps = {}) {
  const ask = deps.askApproval || askApproval
  const send = deps.sendCommand || ((command, options) => hostClient.send(command, options))
  const mode = String(payload?.permission_mode || '')
  if (mode === 'bypassPermissions' || mode === 'yolo') return null

  const toolName = typeof payload?.tool_name === 'string' ? payload.tool_name.trim() : ''
  if (!toolName) return null

  // 选方案/回答问题不是权限审批：桌宠只提示，把交互留在 Qoder 窗口。
  if (isUserChoiceTool(toolName)) {
    try {
      await send(
        {
          command: 'agent_state',
          state: 'tool_running',
          label: '等待你在宿主里选择方案',
        },
        { timeoutMs: 800 },
      )
      await send(
        {
          command: 'choice_hint',
          text: 'Qoder 在等你选择方案，请回宿主窗口处理。',
        },
        { timeoutMs: 800 },
      )
    } catch {
      /* 桌宠离线时不影响 Qoder 自己的选择界面 */
    }
    return null
  }

  const summary = summarizeToolInput(payload?.tool_input)
  const reason = summary
    ? `Qoder 请求执行 ${toolName}：${summary}`
    : `Qoder 请求执行工具 ${toolName}`
  const sessionKey = String(payload?.session_id || 'anon')
    .replace(/[^A-Za-z0-9_.:-]/g, '_')
    .slice(0, 24)
  const requestId = `qoder-${sessionKey}-${Date.now()}`

  try {
    await send(
      {
        command: 'agent_state',
        state: 'tool_running',
        toolName: toolName.slice(0, 64),
        narrate: 'waiting',
      },
      { timeoutMs: 800 },
    )
  } catch {
    /* 桌宠离线时继续走审批兜底 */
  }

  try {
    const result = await ask(
      {
        requestId,
        toolName: toolName.slice(0, 80),
        reason,
        displayReason: reason,
        host: 'qoder',
        ...(payload.session_id ? { sessionId: String(payload.session_id) } : {}),
        timeoutMs: APPROVAL_TIMEOUT_MS,
      },
      { timeoutMs: APPROVAL_TIMEOUT_MS + 3000 },
    )
    if (result?.outcome === 'allowed-once') {
      return buildPermissionDecision('allow', '用户已在 Uta 桌宠上批准')
    }
    if (result?.outcome === 'rejected') {
      return buildPermissionDecision('deny', '用户已在 Uta 桌宠上拒绝')
    }
    return null
  } catch {
    return null
  }
}

async function readStdin() {
  if (process.stdin.isTTY) return ''
  let data = ''
  process.stdin.setEncoding('utf-8')
  for await (const chunk of process.stdin) data += chunk
  return data
}

async function main() {
  let payload = {}
  try {
    const raw = (await readStdin()).trim()
    if (raw) payload = JSON.parse(raw)
  } catch {
    /* 非 JSON 输入：按空事件处理 */
  }

  logPayloadShape(payload)

  // 允许用环境变量注入事件名，方便本地手工验证
  if (!payload.hook_event_name && process.env.UTA_HOOK_EVENT) {
    payload.hook_event_name = process.env.UTA_HOOK_EVENT
  }

  const sessionId = String(payload.session_id || '').trim()
  reportHostSession(payload)
  if (sessionId) hostClient.setSession(sessionId)

  if (
    payload.hook_event_name === 'SessionStart' ||
    payload.hook_event_name === 'UserPromptSubmit'
  ) {
    clearPetSpeech('qoder', sessionId)
    if (sessionId) {
      try {
        if (payload.hook_event_name === 'SessionStart') await hostClient.hello()
        await hostClient.bindSession(sessionId, { label: process.env.UTA_QODER_SURFACE === 'cli' ? 'Qoder CLI' : 'Qoder', cwd: payload.cwd })
      } catch {
        /* 桌宠离线时保持静默 */
      }
    }
  }

  if (shouldMarkPetSpoke(payload.hook_event_name, payload)) {
    if (isPetSpeechCall(payload.tool_name, payload.tool_input || {})) {
      markPetSpoke('qoder', payload.session_id, payload.tool_name)
    }
  }

  if (payload.hook_event_name === 'PermissionRequest') {
    const decision = await handlePermissionRequest(payload)
    // 不接管时保持静默：Qoder 会显示自己的审批弹窗
    if (decision) process.stdout.write(JSON.stringify(decision) + '\n')
    return
  }

  if (payload.hook_event_name === 'Stop') {
    const now = Date.now()
    const previous = readStopState()
    const petSpoke = consumePetSpoke('qoder', payload.session_id)
    const commands = buildStopCommands(payload, previous, now, petSpoke)
    if (commands.length === 0) return
    writeStopState({
      session: String(payload.session_id || ''),
      at: now,
      hash: hashReply(payload.last_assistant_message),
    })
    for (const command of commands) {
      try {
        await hostClient.send(command, { timeoutMs: SEND_TIMEOUT_MS })
      } catch {
        /* 桌宠离线时静默跳过 */
      }
    }
    return
  }

  const todoSnapshot = extractTodoSnapshot(payload.hook_event_name, payload, 'qoder')
  if (todoSnapshot) {
    try {
      await hostClient.send(todoSnapshot, { timeoutMs: SEND_TIMEOUT_MS })
    } catch {
      /* 桌宠离线时静默跳过宿主计划 */
    }
  }

  for (const command of mapEventToCommands(payload)) {
    try {
      await hostClient.send(command, { timeoutMs: SEND_TIMEOUT_MS })
    } catch {
      /* 桌宠没开 / 超时：静默失败，绝不影响宿主 */
    }
  }
}

// 仅在被 Qoder 作为脚本拉起时读取 stdin；被单测 import 时不执行副作用。
const isEntryPoint =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href

if (isEntryPoint) {
  main()
    .catch(() => {
      /* stdin/EPIPE 等异常也必须 fail-open */
    })
    .finally(() => {
      // 无论成功失败都返回 0：hook 永远不阻塞、不报错、不注入上下文
      process.exitCode = 0
    })
}
