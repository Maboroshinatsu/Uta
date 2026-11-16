import { resolveRuntimePaths } from '../../../shared/uta-environment.mjs'
/**
 * Antigravity 宿主 hook：把 Antigravity 的生命周期事件映射为桌宠状态。
 *
 * 设计约束（与 AGENTS.md / 可移植方案一致）：
 * - **绝不阻塞宿主**：所有异常捕获并吞掉，退出码恒为 0（fail-open）。
 * - **不记录用户内容**：只把事件名、字段名、工具名等元数据写入调试心跳日志，
 *   严格不落盘 prompt / tool args，保护用户隐私。
 * - **双向交互**：支持 agent_state / summon / rp_reply 投递，以及可选的 PreToolUse 交互式卡片审批。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { sendCommand, askApproval } from '../../../shared/uta-runtime-client.mjs'
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

function commandOptions(payload, env = process.env, timeoutMs = SEND_TIMEOUT_MS) {
  const sessionId = String(payload?.conversationId || payload?.sessionId || '').trim().slice(0, 200)
  return { timeoutMs, env: { ...env, UTA_HOST: 'antigravity' }, meta: {
    hostId: 'antigravity', ...(sessionId ? { sessionId } : {}), eventId: crypto.randomUUID(),
  } }
}

/** 解析当前触发的事件名（命令行参数 --event=xxx 优先，其次环境变量，再次 payload 字段） */
export function resolveEventName(argv = process.argv, payload = null, env = process.env) {
  for (const arg of argv) {
    if (arg.startsWith('--event=')) {
      return arg.slice('--event='.length).trim()
    }
  }
  if (env.UTA_HOOK_EVENT) return env.UTA_HOOK_EVENT.trim()
  if (typeof payload?.hookEventName === 'string') return payload.hookEventName.trim()
  if (typeof payload?.event === 'string') return payload.event.trim()
  return ''
}

/**
 * 纯映射函数：将单个生命周期事件映射为一条或多条桌宠指令。
 */
export function mapEventToCommands(event, payload = {}) {
  const normEvent = String(event || '').trim()
  const rawTool =
    typeof payload?.toolCall?.name === 'string'
      ? payload.toolCall.name.trim()
      : typeof payload?.tool_name === 'string'
        ? payload.tool_name.trim()
        : ''
  const narrate = inferNarration(normEvent, payload)
  const withNarration = (command) => (narrate ? { ...command, narrate } : command)
  const withPostToolNarration = (command, toolName, toolArgs) => {
    const toolIntent = toolName ? inferToolIntent(toolName, toolArgs) : null
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

  switch (normEvent) {
    case 'SessionStart':
      return [withNarration({ command: 'agent_state', state: 'idle' }), { command: 'summon' }]

    case 'PreInvocation':
      return [withNarration({ command: 'agent_state', state: 'thinking', label: '思考中...' })]

    case 'PreToolUse':
      if (isUserChoiceTool(rawTool)) {
        return [
          {
            command: 'agent_state',
            state: 'tool_running',
            ...(rawTool ? { toolName: rawTool } : {}),
            label: '等待你在宿主里选择方案',
          },
        ]
      }
      return [
        withNarration({
          command: 'agent_state',
          state: 'tool_running',
          ...(rawTool ? { toolName: rawTool } : {}),
        }),
      ]

    case 'PostToolUse':
      if (payload?.error) {
        return [
          withNarration({
            command: 'agent_state',
            state: 'thinking',
            label: '处理报错，分析中...',
          }),
        ]
      }
      return [
        withPostToolNarration(
          { command: 'agent_state', state: 'thinking', label: '处理结果...' },
          rawTool,
          payload?.toolCall?.args || {},
        ),
      ]

    // 模型正文先缓存，等 Stop 时作为本轮最终回复一次性投递，避免每个步骤都弹气泡
    case 'PostInvocation':
      return []

    case 'Stop':
      return buildStopCommands(payload)

    default:
      return []
  }
}

/** 从 PostInvocation 的多种可能字段里提取模型输出文本 */
export function extractModelOutput(payload = {}) {
  const candidate =
    payload?.modelOutput ??
    payload?.model_output ??
    payload?.output ??
    payload?.response ??
    payload?.lastAssistantMessage ??
    payload?.last_assistant_message
  if (typeof candidate === 'string') return candidate
  if (Array.isArray(candidate)) {
    return candidate
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && typeof item.text === 'string') return item.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (candidate && typeof candidate === 'object' && typeof candidate.text === 'string') {
    return candidate.text
  }
  return ''
}

/** 提炼一两句正文送给桌宠；长文只留摘要，不照读全文 */
export function summarizeReply(text) {
  return summarizeCommentary(text, MAX_REPLY_SUMMARY_CHARS)
}

/** 工作中汇报：只保留一两句，去掉表格/代码与表情标签 */
export function summarizeCommentary(text, maxChars = 120) {
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
 * Antigravity 的 Stop 不带回复正文，最终正文只能来自 PostInvocation。
 * 把最近一条短摘要临时落盘，Stop 时作为 rp_reply 投递后立即删除；
 * 只存模型输出摘要，不存用户提示/工具参数，超过 60 秒自动失效。
 */
export function pendingReplyFile(session, env = process.env) {
  const key = hashReply(session || 'default').slice(0, 12)
  return path.join(resolveRuntimePaths(env).hooksDir, `antigravity-pending-${key}.json`)
}

function writePendingReply(session, text, env = process.env) {
  try {
    const file = pendingReplyFile(session, env)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ session, text, at: Date.now() }))
    fs.renameSync(tmp, file)
  } catch {
    /* 写不进去不影响 hook */
  }
}

function readPendingReply(session, env = process.env) {
  const file = pendingReplyFile(session, env)
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (
      raw &&
      raw.session === session &&
      typeof raw.text === 'string' &&
      raw.text.trim() &&
      Number.isFinite(raw.at) &&
      Date.now() - raw.at < 60_000
    ) {
      return raw.text.trim()
    }
    if (raw && Number.isFinite(raw.at) && Date.now() - raw.at >= 60_000) {
      fs.rmSync(file, { force: true })
    }
  } catch {
    /* 不存在/损坏/过期都按没有处理 */
  }
  return ''
}

function clearPendingReply(session, env = process.env) {
  try {
    fs.rmSync(pendingReplyFile(session, env), { force: true })
  } catch {
    /* ignore */
  }
}

function hashReply(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex')
}

/** 状态文件：记录上次播报内容，用于跨进程去重 */
function stateFile(env = process.env) {
  return path.join(resolveRuntimePaths(env).hooksDir, 'antigravity-last-stop.json')
}

export function readPreviousStop(env = process.env) {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(env), 'utf8'))
    if (raw && typeof raw.at === 'number' && typeof raw.session === 'string') return raw
  } catch {
    /* 忽略缺失或损坏 */
  }
  return null
}

export function writePreviousStop(entry, env = process.env) {
  try {
    const file = stateFile(env)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(entry))
  } catch {
    /* 忽略写入失败 */
  }
}

/**
 * 构造 Stop 事件对应的一组指令。
 * Antigravity 的 Stop 没有回复正文，只有 terminationReason；正文由 PostInvocation
 * 负责。这里只负责收尾状态、错误/取消分流与重复事件去重。
 */
export function normalizeTerminationReason(payload = {}) {
  return String(payload?.terminationReason || payload?.termination_reason || '')
    .trim()
    .toUpperCase()
    .replace('USER_CANCELLED', 'USER_CANCELED')
}

/** Stop 去重键：同一会话、同一次执行、同一终止原因才视为重复 */
export function stopReasonState(payload = {}) {
  const session = String(payload?.conversationId || payload?.sessionId || '')
  const turn = String(payload?.executionNum ?? payload?.execution_num ?? '')
  const reason = normalizeTerminationReason(payload)
  return { session, reason, hash: hashReply(`${session}|${turn}|${reason}`) }
}

/**
 * 构造 Stop 事件对应的一组指令。
 * Antigravity 的 Stop 没有回复正文，只有 terminationReason；正文由 PostInvocation
 * 负责。这里只负责收尾状态、错误/取消分流与重复事件去重。
 */
export function buildStopCommands(payload, previous = null, now = Date.now()) {
  const current = stopReasonState(payload)
  const duplicate =
    previous &&
    previous.session === current.session &&
    typeof previous.at === 'number' &&
    now - previous.at >= 0 &&
    now - previous.at < STOP_DEDUP_MS &&
    previous.hash === current.hash
  if (duplicate) return []

  if (current.reason === 'ERROR') {
    return [
      {
        command: 'agent_state',
        state: 'error',
        label: '执行出错',
        narrate: 'error',
      },
    ]
  }
  if (current.reason === 'USER_CANCELED') {
    return [{ command: 'agent_state', state: 'idle' }]
  }
  if (current.reason !== 'NO_TOOL_CALL') return [{ command: 'agent_state', state: 'idle', label: '宿主已停止' }]
  return [
    {
      command: 'agent_state',
      state: 'completed',
      label: '回复完成',
    },
  ]
}

/** 提炼工具参数摘要（仅供桌宠审批卡片展示，不落盘） */
export function summarizeToolArgs(args) {
  if (!args || typeof args !== 'object') return ''
  const candidate =
    args.Url ?? args.url ?? args.CommandLine ?? args.command ?? args.TargetFile ?? args.path ?? args.query
  return typeof candidate === 'string' ? candidate.trim().slice(0, 300) : ''
}

/**
 * Antigravity 对 read_url_content/read_browser_page 走了宿主级 gated HTTP 沙箱，
 * 第三方 Hook 的 allow/permissionOverrides 无法豁免，宿主仍会弹原生审批。
 * 这些工具直接交回宿主，避免桌宠先弹一次造成二次打扰。
 */
const HOST_GATED_NETWORK_TOOLS = new Set(['read_url_content', 'read_browser_page'])

export function isHostGatedNetworkTool(toolName) {
  return HOST_GATED_NETWORK_TOOLS.has(String(toolName || '').trim())
}

/** 判断某个工具是否需要向桌宠发起权限审批 */
export function shouldRequireApproval(toolName, env = process.env) {
  const approvalEnabled =
    env.UTA_APPROVAL_ENABLED === 'true' ||
    env.UTA_APPROVAL_ENABLED === '1' ||
    env.UTA_ANTIGRAVITY_APPROVAL === 'true'
  if (approvalEnabled) return true

  // 搜索工具仍可由桌宠审批；URL 抓取由宿主网络沙箱接管
  return toolName === 'search_web'
}

/**
 * 记录一次事件的“形状”（只记录事件名、工具名，不记录用户 prompt 或参数）
 * 供 Uta 主进程感知 Antigravity 的活跃状态。
 */
export function logPayloadShape(event, payload, env = process.env) {
  try {
    const dir = resolveRuntimePaths(env).hooksDir
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'antigravity-events.jsonl')
    try {
      if (fs.statSync(file).size > DEBUG_LOG_LIMIT_BYTES) fs.rmSync(file)
    } catch {
      /* 文件不存在 */
    }

    const entry = {
      ts: new Date().toISOString(),
      event: String(event || ''),
      tool: payload?.toolCall?.name || payload?.tool_name || undefined,
      conversationId:
        typeof payload?.conversationId === 'string' ? payload.conversationId.slice(-8) : undefined,
    }
    fs.appendFileSync(file, JSON.stringify(entry) + '\n')
  } catch {
    /* 调试日志失败绝不能影响 hook 运行 */
  }
}

/** 读取 stdin 所有内容 */
async function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(''))
  })
}

/** 构造 Antigravity 专用的临时权限豁免项，避免 IDE 在桌宠批准后重复弹窗 */
export function buildPermissionOverrides(toolName, args = {}) {
  const overrides = []
  const normTool = String(toolName || '').trim()

  if (normTool === 'run_command') {
    const cmd = args?.CommandLine ?? args?.command
    if (typeof cmd === 'string' && cmd.trim()) {
      overrides.push(`command(${cmd.trim()})`)
    }
  } else if (normTool === 'search_web') {
    overrides.push('web_search')
  } else if (normTool === 'call_mcp_tool') {
    const server = String(args?.ServerName || '').trim()
    const targetTool = String(args?.ToolName || '').trim()
    if (server && targetTool) {
      overrides.push(`mcp(${server}/${targetTool})`)
    }
  } else if (normTool.startsWith('mcp_') || normTool.startsWith('deskpet_')) {
    overrides.push(normTool)
  }

  return overrides
}

function isDeskpetTool(toolName, args = {}) {
  const name = String(toolName || '').trim()
  const DESKPET_TOOLS = new Set([
    'deskpet_get_capabilities',
    'deskpet_notify',
    'deskpet_set_emotion',
    'deskpet_set_preset',
    'deskpet_play_animation',
  ])
  if (DESKPET_TOOLS.has(name)) return true
  if (name === 'call_mcp_tool') {
    const server = String(args?.ServerName || args?.server || '').trim()
    return server === 'uta-deskpet_uta-deskpet' || server === 'uta-deskpet' || server.startsWith('uta-deskpet')
  }
  return false
}

/**
 * 处理 PreToolUse 事件的审批逻辑（若启用或命中敏感工具）。
 *
 * 安全边界：只有“桌宠自己的 MCP 角色工具”和“用户在桌宠上明确批准过的操作”
 * 才返回 allow；其他工具一律不接管，交回 Antigravity 自己的权限流程。
 */
export async function handlePreToolUseApproval(payload, options = {}) {
  const { env = process.env } = options
  const hostEnv = { ...env, UTA_HOST: 'antigravity' }
  const toolCall = payload?.toolCall || {}
  const toolName = typeof toolCall.name === 'string' ? toolCall.name.trim() : ''

  if (!toolName) return { decision: 'ask' }

  // 选方案/回答问题不是权限审批：只提示一句，让 Antigravity 自己弹出选择界面。
  if (isUserChoiceTool(toolName)) {
    try {
      await sendCommand(
        {
          command: 'choice_hint',
          text: 'Antigravity 在等你选择方案，请回宿主窗口处理。',
        },
        commandOptions(payload, env, 800),
      )
    } catch {
      /* 桌宠离线时不影响宿主自己的选择界面 */
    }
    return { decision: 'ask' }
  }

  if (isDeskpetTool(toolName, toolCall.args)) {
    const overrides = buildPermissionOverrides(toolName, toolCall.args)
    return {
      decision: 'allow',
      ...(overrides.length > 0 ? { permissionOverrides: overrides } : {}),
    }
  }

  if (isHostGatedNetworkTool(toolName)) {
    // 网络沙箱由宿主强制确认；桌宠不弹卡，也不伪造无法生效的 read_url override。
    return { decision: 'ask' }
  }

  if (!shouldRequireApproval(toolName, env)) {
    // 不接管：ask 会走 Antigravity 自己的权限/Always Allow 逻辑，绝不静默放行
    return { decision: 'ask' }
  }

  const summary = summarizeToolArgs(toolCall.args)
  const reason = summary
    ? `Antigravity 请求执行 ${toolName}：${summary}`
    : `Antigravity 请求执行工具 ${toolName}`

  const sessionKey = String(payload?.conversationId || 'anon')
    .replace(/[^A-Za-z0-9_.:-]/g, '_')
    .slice(-24)
  const stepIdx = payload?.stepIdx ?? Date.now()
  const requestId = `ag-${sessionKey}-${stepIdx}`

  try {
    await sendCommand(
      {
        command: 'agent_state',
        state: 'tool_running',
        toolName: toolName.slice(0, 64),
        narrate: 'waiting',
      },
      commandOptions(payload, env, 800),
    )
  } catch {
    /* 桌宠离线时继续走审批兜底 */
  }

  try {
    const result = await askApproval(
      {
        requestId,
        toolName: toolName.slice(0, 80),
        reason,
        displayReason: reason,
        host: 'antigravity',
        ...(payload?.conversationId || payload?.sessionId ? { sessionId: String(payload.conversationId || payload.sessionId).slice(0, 200) } : {}),
        timeoutMs: APPROVAL_TIMEOUT_MS,
      },
      { env: hostEnv, timeoutMs: APPROVAL_TIMEOUT_MS + 3000 },
    )

    if (result?.outcome === 'allowed-once' || result?.outcome === 'approved') {
      const overrides = buildPermissionOverrides(toolName, toolCall.args)
      return {
        decision: 'allow',
        ...(overrides.length > 0 ? { permissionOverrides: overrides } : {}),
      }
    }
    if (result?.outcome === 'rejected') {
      return { decision: 'deny', reason: '用户已在 Uta 桌宠审批卡片上拒绝该操作。' }
    }
    // 桌宠取消/不可用/超时：交回宿主自己的审批弹窗，绝不自动放行
    return { decision: 'ask' }
  } catch {
    // 审批服务未响应或超时时，fail-open 到宿主自身逻辑，而不是放行工具
    return { decision: 'ask' }
  }
}

/** Hook 主执行入口 */
export async function main() {
  const rawInput = await readStdin()
  let payload = null
  try {
    payload = rawInput ? JSON.parse(rawInput) : {}
  } catch {
    payload = {}
  }

  const event = resolveEventName(process.argv, payload)
  const session = String(payload?.conversationId || payload?.sessionId || '')
  const workspaces = Array.isArray(payload.workspacePaths) ? payload.workspacePaths.filter(value => typeof value === 'string' && path.isAbsolute(value)) : []
  logPayloadShape(event, payload)
  if (session && ['SessionStart', 'PreInvocation'].includes(event) && Array.isArray(payload.workspacePaths)) {
    try {
      await sendCommand({ command: 'session_bind', label: 'Antigravity', cwd: workspaces.length === 1 ? workspaces[0] : '' }, commandOptions(payload))
    } catch { /* No directory is guessed for multiple workspaces. */ }
  }

  if (event === 'SessionStart' || event === 'PreInvocation') {
    clearPendingReply(session)
    clearPetSpeech('antigravity', session)
  }

  if (shouldMarkPetSpoke(event, payload)) {
    const toolCall = payload?.toolCall || {}
    const toolName = toolCall.name || payload?.tool_name
    const toolArgs = toolCall.args || payload?.tool_input || {}
    if (isPetSpeechCall(toolName, toolArgs)) {
      markPetSpoke('antigravity', session, toolName)
    }
  }

  // 1. 若为 PreToolUse 且开启审批，走审批分支
  let preToolDecision = {}
  if (event === 'PreToolUse') {
    preToolDecision = await handlePreToolUseApproval(payload)
  }

  // 2. 指令映射与投递
  let commands
  if (event === 'Stop') {
    const previous = readPreviousStop()
    const petSpoke = consumePetSpoke('antigravity', session)
    commands = buildStopCommands(payload, previous)
    const reason = normalizeTerminationReason(payload)
    // 最终正文独立于 Stop 状态去重：即使 Stop 被误判为重复，也不能丢最终回复
    const reply = reason !== 'NO_TOOL_CALL' || petSpoke ? '' : readPendingReply(session)
    if (reply) commands.unshift({ command: 'rp_reply', text: reply })
    if (commands.length > 0) {
      const current = stopReasonState(payload)
      writePreviousStop({ session: current.session, at: Date.now(), hash: current.hash })
    }
    clearPendingReply(session)
  } else {
    commands = mapEventToCommands(event, payload)
  }
  if (event === 'PostInvocation') {
    const rawText = extractModelOutput(payload)
    const summary = rawText ? summarizeCommentary(rawText, MAX_REPLY_SUMMARY_CHARS) : ''
    if (summary) writePendingReply(session, summary)
    // Antigravity 的中间步骤不再逐个弹气泡；正文留给 Stop 当最终回复
    commands = []
  }
  const todoSnapshot = extractTodoSnapshot(event, { ...payload, cwd: workspaces.length === 1 ? workspaces[0] : '' }, 'antigravity')
  if (todoSnapshot) {
    try {
      await sendCommand(todoSnapshot, commandOptions(payload))
    } catch {
      /* 桌宠离线时静默跳过宿主计划 */
    }
  }

  for (const cmd of commands) {
    try {
      await sendCommand(cmd, commandOptions(payload))
    } catch {
      /* Uta 未启动或网络错误时保持静默 */
    }
  }

  // 4. 标准输出响应：PreToolUse 未接管时返回 ask，交回 Antigravity 自身权限流程
  if (event === 'PreToolUse') {
    const out =
      preToolDecision && typeof preToolDecision.decision === 'string'
        ? preToolDecision
        : { decision: 'ask' }
    process.stdout.write(JSON.stringify(out))
  } else {
    process.stdout.write('{}')
  }
}

// 直接由 node 执行时启动
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch(() => {})
    .finally(() => {
      process.exit(0)
    })
}
