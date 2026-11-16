import { resolveRuntimePaths } from './uta-environment.mjs'
/**
 * Claude Code / ZCode / Codex 共用的宿主 hook。
 *
 * 三个宿主的 hook 输入输出高度同源（都以 hook_event_name 标识事件、
 * 都以 hookSpecificOutput 返回权限决策），因此共用一套状态映射与审批逻辑，
 * 避免每接一个宿主就复制一份容易漂移的实现。
 *
 * 设计约束：
 * - 绝不阻塞宿主：任何异常都吞掉，退出码恒为 0（fail-open）。
 * - 不记录用户内容：调试日志只写事件名、工具名、字段名等元数据。
 * - 审批只做展示与决策：桌宠离线/超时/取消时输出空决策，交回宿主原生弹窗。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { sendCommand, askApproval, createHostClient } from './uta-runtime-client.mjs'
import { inferNarration, inferToolIntent, isUserChoiceTool } from './uta-narration.mjs'
import { summarizeCommentary } from './uta-commentary.mjs'
import { extractClaudeTaskDelta, extractTodoSnapshot } from './uta-todo.mjs'
import {
  isPetSpeechCall,
  shouldMarkPetSpoke,
  markPetSpoke,
  consumePetSpoke,
  clearPetSpeech,
} from './uta-pet-speech.mjs'

/** hook 单次发送超时（毫秒），必须远小于宿主等待容忍度 */
const SEND_TIMEOUT_MS = 1200
/** 审批等待上限（毫秒） */
const APPROVAL_TIMEOUT_MS = 60_000
/** 调试日志上限，超过即自动重建 */
const DEBUG_LOG_LIMIT_BYTES = 256 * 1024
/** 同一会话内重复 Stop 的去重窗口（毫秒） */
const STOP_DEDUP_MS = 10_000
/** 桌宠气泡与 TTS 摘要上限字符数 */
const MAX_REPLY_SUMMARY_CHARS = 80
const CODEX_SDK_VERSION = '0.2.5'

const HOSTS = {
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    stateFile: 'claude-code-stop-state.json',
    logFile: 'claude-code-events.jsonl',
  },
  zcode: {
    id: 'zcode',
    label: 'ZCode',
    stateFile: 'zcode-stop-state.json',
    logFile: 'zcode-events.jsonl',
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    stateFile: 'codex-stop-state.json',
    logFile: 'codex-events.jsonl',
  },
}

export function resolveHost(argv = process.argv, env = process.env) {
  for (const arg of argv) {
    if (arg.startsWith('--host=')) {
      const id = arg.slice('--host='.length).trim()
      if (HOSTS[id]) return HOSTS[id]
    }
  }
  const fromEnv = typeof env.UTA_HOST === 'string' ? env.UTA_HOST.trim() : ''
  if (HOSTS[fromEnv]) return HOSTS[fromEnv]
  return HOSTS['claude-code']
}

export function resolveEventName(argv = process.argv, payload = null, env = process.env) {
  for (const arg of argv) {
    if (arg.startsWith('--event=')) {
      return arg.slice('--event='.length).trim()
    }
  }
  if (typeof payload?.hook_event_name === 'string') return payload.hook_event_name.trim()
  if (typeof payload?.hookEventName === 'string') return payload.hookEventName.trim()
  if (typeof payload?.event === 'string') return payload.event.trim()
  if (typeof env.UTA_HOOK_EVENT === 'string') return env.UTA_HOOK_EVENT.trim()
  return ''
}

/** 工具名会进入 runtime 的白名单字段（字母数字下划线连字符，≤32） */
export function sanitizeToolName(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32)
}

/**
 * 提炼一两句正文送给桌宠。桌宠不照读完整回复：
 * 长文只保留开头摘要，代码、表格、链接和角色标签都去掉。
 */
export function summarizeReply(text) {
  return summarizeCommentary(text, MAX_REPLY_SUMMARY_CHARS)
}

export function hashReply(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex')
}

export function stopStateFile(host, env = process.env) {
  return path.join(resolveRuntimePaths(env).hooksDir, host.stateFile)
}

const lastSessionWrite = new Map()

/**
 * 只把会话 id/cwd 登记给 Uta 主进程，供“从桌宠直连宿主”续会话使用。
 * 不记录 prompt、工具参数或回复正文。
 */
export function hostSessionFile(host, env = process.env) {
  return path.join(resolveRuntimePaths(env).hooksDir, `${host.id}-session.json`)
}

export function reportHostSession(host, payload = {}, env = process.env) {
  const sessionId = String(payload?.session_id || payload?.sessionId || '').trim()
  if (!sessionId) return
  if (sessionId.length > 200) return
  const permissionMode = host.id === 'zcode' && ['build', 'edit', 'plan', 'yolo', 'guarded'].includes(payload.permission_mode)
    ? payload.permission_mode : undefined
  const hostConfigDir = host.id === 'codex' ? path.resolve(env.CODEX_HOME || path.join(os.homedir(), '.codex'))
    : host.id === 'claude-code' ? path.resolve(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')) : undefined
  const workspace = typeof payload?.cwd === 'string' ? payload.cwd.trim().slice(0, 500) : ''
  const event = payload.hook_event_name || payload.hookEventName || payload.event || ''
  const activity = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest'].includes(event) ? 'busy'
    : ['SessionStart', 'Stop', 'StopFailure', 'SessionEnd', 'Interrupt'].includes(event) ? 'idle' : 'unknown'
  const key = `${hostSessionFile(host, env)}:${sessionId}:${workspace}:${permissionMode || ''}:${hostConfigDir || ''}:${activity}`
  const now = Date.now()
  if (now - (lastSessionWrite.get(key) || 0) < 2000) return
  lastSessionWrite.set(key, now)
  try {
    const file = hostSessionFile(host, env)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const body = JSON.stringify({ host: host.id, sessionId, cwd: workspace, updatedAt: now, activity,
      ...(permissionMode ? { permissionMode } : {}), ...(hostConfigDir ? { hostConfigDir } : {}) }, null, 2)
    const scoped = path.join(path.dirname(file), 'sessions', host.id, `${crypto.createHash('sha256').update(sessionId).digest('hex')}.json`)
    fs.mkdirSync(path.dirname(scoped), { recursive: true })
    for (const target of [scoped, file]) {
      const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`
      try {
        fs.writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600 })
        fs.renameSync(temporary, target)
      } finally { try { fs.rmSync(temporary, { force: true }) } catch {} }
    }
  } catch {
    /* 会话登记失败不能影响 hook */
  }
}

export function readPreviousStop(host, env = process.env) {
  try {
    const raw = JSON.parse(fs.readFileSync(stopStateFile(host, env), 'utf-8'))
    if (
      raw &&
      typeof raw.session === 'string' &&
      typeof raw.hash === 'string' &&
      typeof raw.at === 'number'
    ) {
      return raw
    }
  } catch {
    /* 首次运行或文件损坏 */
  }
  return null
}

export function writePreviousStop(host, entry, env = process.env) {
  try {
    const file = stopStateFile(host, env)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(entry))
  } catch {
    /* 状态写不进去也不能影响 hook */
  }
}

/** 把单个生命周期事件映射为一条或多条桌宠指令（纯函数） */
export function mapEventToCommands(event, payload = {}, host = HOSTS.codex) {
  const normEvent = String(event || '').trim()
  const rawTool =
    typeof payload?.tool_name === 'string'
      ? payload.tool_name
      : typeof payload?.toolName === 'string'
        ? payload.toolName
        : ''
  const toolName = sanitizeToolName(rawTool)
  const narrate = inferNarration(normEvent, payload)

  switch (normEvent) {
    case 'SessionStart':
      // 自动压缩也会触发 SessionStart；不能把正在工作的桌宠复位成 idle
      if (String(payload?.source || '').toLowerCase() === 'compact') return []
      return [
        {
          command: 'agent_state',
          state: 'idle',
          ...(narrate ? { narrate } : {}),
        },
        { command: 'summon' },
      ]
    case 'UserPromptSubmit':
      return [
        {
          command: 'agent_state',
          state: 'thinking',
          label: '思考中...',
          ...(narrate ? { narrate } : {}),
        },
      ]
    case 'PreToolUse':
      return [
        {
          command: 'agent_state',
          state: 'tool_running',
          ...(toolName ? { toolName } : {}),
          ...(narrate ? { narrate } : {}),
        },
      ]
    case 'PostToolUse': {
      const toolInput = payload?.tool_input || payload?.toolInput || payload?.args
      const toolIntent = rawTool ? inferToolIntent(rawTool, toolInput) : null
      const successNarration =
        toolIntent === 'looking' ||
        toolIntent === 'reading' ||
        toolIntent === 'searching' ||
        toolIntent === 'researching'
          ? 'found'
          : toolIntent
            ? 'progress'
            : null
      return [
        {
          command: 'agent_state',
          state: 'thinking',
          label: '处理结果...',
          ...(narrate || successNarration
            ? { narrate: narrate || successNarration }
            : {}),
        },
      ]
    }
    case 'PostToolUseFailure':
      return [
        {
          command: 'agent_state',
          state: 'thinking',
          label: '处理失败，重试中...',
          ...(narrate ? { narrate } : {}),
        },
      ]
    case 'Stop':
      return [] // Stop 走 buildStopCommands，需要跨进程去重与最终回复
    case 'StopFailure':
      return host.id === 'claude-code'
        ? [{ command: 'agent_state', state: 'error', label: '宿主回复失败' }]
        : []
    case 'SessionEnd':
      return [{ command: 'agent_state', state: 'idle' }]
    case 'Interrupt':
      return [
        {
          command: 'agent_state',
          state: 'idle',
          ...(narrate ? { narrate } : {}),
        },
      ]
    default:
      return []
  }
}

/**
 * Stop 事件：宿主可能在一次任务结束时连续发两次 Stop。
 * 完全重复：什么都不发；窗口内但内容不同：只补气泡，不重复播报「完成」。
 */
export function buildStopCommands(
  payload,
  previous = null,
  now = Date.now(),
  host = HOSTS.codex,
  petSpoke = false,
) {
  if (payload?.stop_hook_active === true) return []

  const session = String(payload?.session_id || payload?.sessionId || '')
  const message =
    payload?.last_assistant_message ?? payload?.lastAssistantMessage ?? payload?.message ?? ''
  const hash = hashReply(message)

  const duplicate =
    previous &&
    previous.session === session &&
    Number.isFinite(previous.at) &&
    now - previous.at >= 0 &&
    now - previous.at < STOP_DEDUP_MS

  if (duplicate && previous.hash === hash) return []

  const commands = []
  const text = petSpoke ? '' : summarizeReply(message)
  if (text) commands.push({ command: 'rp_reply', text })
  if (!duplicate) {
    commands.push({
      command: 'agent_state',
      state: 'completed',
      label: '回复完成',
    })
  }
  return commands
}

/** 提炼工具参数摘要（仅供桌宠审批卡片展示，不落盘） */
export function summarizeToolInput(input) {
  if (!input || typeof input !== 'object') return ''
  const candidate =
    input.command ??
    input.file_path ??
    input.path ??
    input.url ??
    input.query ??
    input.description ??
    input.CommandLine
  if (typeof candidate === 'string') return candidate.trim().slice(0, 300)
  if (Array.isArray(candidate)) {
    return candidate.filter((item) => typeof item === 'string').join(' ').trim().slice(0, 300)
  }
  return ''
}

/**
 * 构造 PermissionRequest 的决策输出。
 * Claude Code / ZCode / Codex 的 PermissionRequest schema 一致：
 * { hookSpecificOutput: { hookEventName, decision: { behavior, message? } } }
 */
export function buildPermissionOutput(decision) {
  if (decision === 'allow') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' },
      },
    }
  }
  if (decision === 'deny') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'deny',
          message: '用户已在 Uta 桌宠审批卡片上拒绝该操作。',
        },
      },
    }
  }
  return null
}

/**
 * 把一次权限请求交给桌宠卡片决策。
 * 返回 null 表示不接管（桌宠离线 / 超时 / 取消），由宿主走自己的弹窗。
 */
export async function handlePermissionRequest(payload, options = {}) {
  const ask = options.askApproval || askApproval
  const send = options.sendCommand || sendCommand
  const env = options.env || process.env
  const host = options.host || HOSTS.codex
  const mode = String(payload?.permission_mode || '')
  if (mode === 'bypassPermissions' || mode === 'yolo') return null

  const toolName = typeof payload?.tool_name === 'string' ? payload.tool_name.trim() : ''
  if (!toolName) return null

  // 「让用户选方案/回答问题」不是权限审批：不弹批准/拒绝卡，
  // 只给桌宠一句提示，立刻交回宿主自己的选择界面。
  if (isUserChoiceTool(toolName)) {
    try {
      await send(
        {
          command: 'agent_state',
          state: 'tool_running',
          label: '等待你在宿主里选择方案',
        },
        { env, timeoutMs: 800 },
      )
      await send(
        {
          command: 'choice_hint',
          text: `${host.label} 在等你选择方案，请回宿主窗口处理。`,
        },
        { env, timeoutMs: 800 },
      )
    } catch {
      /* 桌宠离线时不影响宿主自己的选择界面 */
    }
    return null
  }

  const summary = summarizeToolInput(payload?.tool_input)
  const reason = summary
    ? `${host.label} 请求执行 ${toolName}：${summary}`
    : `${host.label} 请求执行工具 ${toolName}`

  // 审批卡片弹出前先让桌宠说一句“这一步需要你确认”，
  // 失败或超时都不影响真正的审批流程。
  try {
    await send(
      {
        command: 'agent_state',
        state: 'tool_running',
        ...(sanitizeToolName(toolName) ? { toolName: sanitizeToolName(toolName) } : {}),
        narrate: 'waiting',
      },
      { env, timeoutMs: 800 },
    )
  } catch {
    /* 桌宠离线时继续走审批兜底 */
  }

  const sessionKey = String(payload?.session_id || payload?.sessionId || 'anon')
    .replace(/[^A-Za-z0-9_.:-]/g, '_')
    .slice(-24)
  const requestId = `${host.id}-${sessionKey}-${Date.now()}`
  const sessionId = String(payload?.session_id || payload?.sessionId || '').trim().slice(0, 200)

  try {
    const result = await ask(
      {
        requestId,
        toolName: toolName.slice(0, 80),
        reason,
        displayReason: reason,
        host: host.id,
        ...(sessionId ? { sessionId } : {}),
        timeoutMs: APPROVAL_TIMEOUT_MS,
      },
      { env, timeoutMs: APPROVAL_TIMEOUT_MS + 3000 },
    )
    if (result?.outcome === 'allowed-once' || result?.outcome === 'approved') {
      return buildPermissionOutput('allow')
    }
    if (result?.outcome === 'rejected') {
      return buildPermissionOutput('deny')
    }
    return null
  } catch {
    return null
  }
}

/** 记录事件形状（只记录事件名、工具名、会话尾号，不记录提示词或工具参数） */
export function logPayloadShape(event, payload, host = HOSTS.codex, env = process.env) {
  try {
    const dir = resolveRuntimePaths(env).hooksDir
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, host.logFile)
    try {
      if (fs.statSync(file).size > DEBUG_LOG_LIMIT_BYTES) fs.rmSync(file)
    } catch {
      /* 文件还不存在 */
    }

    const entry = {
      ts: new Date().toISOString(),
      event: String(event || ''),
      keys: payload && typeof payload === 'object' ? Object.keys(payload).sort() : [],
      tool: typeof payload?.tool_name === 'string' ? payload.tool_name : undefined,
      mode: typeof payload?.permission_mode === 'string' ? payload.permission_mode : undefined,
      session: typeof payload?.session_id === 'string' ? payload.session_id.slice(-8) : undefined,
      stopActive:
        typeof payload?.stop_hook_active === 'boolean' ? payload.stop_hook_active : undefined,
      hasMessage:
        typeof payload?.last_assistant_message === 'string'
          ? payload.last_assistant_message.length > 0
          : undefined,
    }
    fs.appendFileSync(file, JSON.stringify(entry) + '\n')
  } catch {
    /* 调试日志失败绝不能影响 hook */
  }
}

async function readStdin() {
  if (process.stdin.isTTY) return ''
  let data = ''
  process.stdin.setEncoding('utf-8')
  for await (const chunk of process.stdin) data += chunk
  return data
}

export async function main(argv = process.argv, env = process.env) {
  const host = resolveHost(argv, env)
  let payload = {}
  try {
    const raw = (await readStdin()).trim()
    if (raw) payload = JSON.parse(raw)
  } catch {
    /* 非 JSON 输入：按空事件处理 */
  }

  const event = resolveEventName(argv, payload, env)
  logPayloadShape(event, payload, host, env)
  reportHostSession(host, { ...payload, hook_event_name: event }, env)
  const hostEnv = { ...env, UTA_HOST: host.id }

  // Codex 的真实 session/turn 只取自 hook 载荷，不从“最近活跃会话”猜测。
  const client = host.id === 'codex' ? createHostClient({
    hostId: host.id,
    label: host.label,
    sdkVersion: CODEX_SDK_VERSION,
    capabilities: ['statusEvents', 'assistantText', 'characterTools', 'approval'],
    env,
  }) : null
  const sessionId = payload?.session_id || payload?.sessionId || ''
  client?.setSession(sessionId, { turnId: payload?.turn_id || payload?.turnId || '' })
  const send = client
    ? (command, options) => client.send(command, options)
    : (command, options = {}) => sendCommand(command, { ...options, env: { ...hostEnv, ...options.env, UTA_HOST: host.id } })

  if (client && (event === 'SessionStart' || event === 'UserPromptSubmit')) {
    try {
      await client.hello({}, { timeoutMs: 600 })
      if (client.getSession()) {
        await client.bindSession(client.getSession(), {
          label: host.label,
          userInitiated: event === 'UserPromptSubmit',
          cwd: typeof payload?.cwd === 'string' ? payload.cwd : '',
        }, { timeoutMs: 600 })
      }
    } catch {
      /* 握手/绑定失败不影响宿主，也不阻止后续指令尝试投递 */
    }
  }

  if (event === 'SessionStart' || event === 'UserPromptSubmit') {
    clearPetSpeech(host.id, sessionId, env)
  }

  if (shouldMarkPetSpoke(event, payload)) {
    const toolName =
      typeof payload?.tool_name === 'string' ? payload.tool_name : payload?.toolName
    const toolInput = payload?.tool_input || payload?.toolInput || payload?.args || {}
    if (isPetSpeechCall(toolName, toolInput)) {
      markPetSpoke(host.id, payload?.session_id || payload?.sessionId, toolName, env)
    }
  }

  if (event === 'PermissionRequest') {
    const decision = await handlePermissionRequest(payload, { host, env, sendCommand: send })
    // 不接管时输出空对象：宿主会走自己的原生审批弹窗
    process.stdout.write(JSON.stringify(decision || {}) + '\n')
    return
  }

  if (event === 'Stop') {
    const now = Date.now()
    const previous = readPreviousStop(host, env)
    const petSpoke = consumePetSpoke(
      host.id,
      payload?.session_id || payload?.sessionId || '',
      env,
    )
    const commands = buildStopCommands(payload, previous, now, host, petSpoke)
    if (commands.length === 0) {
      process.stdout.write('{}\n')
      return
    }
    const message =
      payload?.last_assistant_message ??
      payload?.lastAssistantMessage ??
      payload?.message ??
      ''
    writePreviousStop(
      host,
      {
        session: String(payload?.session_id || payload?.sessionId || ''),
        at: now,
        hash: hashReply(message),
      },
      env,
    )
    for (const command of commands) {
      try {
        await send(command, { env, timeoutMs: SEND_TIMEOUT_MS })
      } catch {
        /* 桌宠离线时静默跳过 */
      }
    }
    process.stdout.write('{}\n')
    return
  }

  const todoSnapshot = extractClaudeTaskDelta(event, payload, host.id) || extractTodoSnapshot(event, payload, host.id)
  if (todoSnapshot) {
    try {
      await send(todoSnapshot, {
        env,
        timeoutMs: SEND_TIMEOUT_MS,
        meta: {
          hostId: host.id,
          ...(sessionId ? { sessionId } : {}),
        },
      })
    } catch {
      /* 桌宠离线或旧运行时：宿主计划静默跳过 */
    }
  }

  for (const command of mapEventToCommands(event, payload, host)) {
    try {
      await send(command, { env, timeoutMs: SEND_TIMEOUT_MS })
    } catch {
      /* 桌宠没开 / 超时：静默失败，绝不影响宿主 */
    }
  }
  process.stdout.write('{}\n')
}

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
