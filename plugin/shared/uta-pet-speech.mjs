import { resolveRuntimePaths } from './uta-environment.mjs'
/**
 * 桌宠发言规则与回合标记。
 *
 * 状态由宿主自动同步，正文只由模型主动调用桌宠工具决定；
 * 模型整轮没说话时，宿主才可以补一条短摘要兜底。
 */
import fs from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

export const PET_SPEECH_POLICY = [
  'Uta desktop pet speech policy:',
  '- The pet is a glanceable companion window, not a second transcript.',
  '- Speak only at meaningful moments: a key finding, a user-visible decision, or the final answer.',
  '- Normally 1-2 messages per turn, each 1-2 sentences (<=160 characters). Do not comment on every tool step.',
  '- Working state is mirrored automatically; do not repeat it as text.',
  '- To speak, call deskpet_notify (or uta_express with text on DeepSeek Harness). Staying silent is fine.',
].join('\n')

const MARKER_TTL_MS = 30 * 60_000

function normalized(value) {
  return String(value || '').toLowerCase()
}

function isCallMcpTool(name) {
  const normalizedName = normalized(name).replace(/[^a-z0-9]/g, '')
  return normalizedName === 'callmcptool' || normalizedName === 'mcpcall'
}

function petSpeechTarget(args = {}) {
  const target = normalized(
    args?.ToolName ??
      args?.toolName ??
      args?.tool_name ??
      args?.mcpToolName ??
      args?.mcp_tool_name ??
      args?.tool ??
      args?.name,
  )
  if (!target) return false
  return /(^|[^a-z0-9])(deskpet_(notify|say)|uta_express)([^a-z0-9]|$)/.test(target)
}

/** 判断一次工具调用是否等于“模型主动让桌宠说话” */
export function isPetSpeechCall(toolName, args = {}) {
  const rawName = String(toolName || '')
  const name = normalized(rawName)
  if (!name) return false

  if (isCallMcpTool(rawName)) {
    const server = normalized(
      args?.ServerName ??
        args?.serverName ??
        args?.server_name ??
        args?.mcpServerName ??
        args?.mcp_server_name ??
        args?.server,
    )
    if (server && !/(deskpet|uta)/.test(server)) return false
    return petSpeechTarget(args)
  }

  if (name.includes('uta_express')) {
    const text = args?.text ?? args?.Text ?? ''
    return typeof text === 'string' && text.trim().length > 0
  }

  return /(^|[^a-z0-9])deskpet_(notify|say)([^a-z0-9]|$)/.test(name)
}

/** 只把明确成功的工具结果当作已发言；拒绝、失败和错误响应都不算。 */
export function isSuccessfulToolResult(payload = {}) {
  if (payload?.error || payload?.hook_event_name === 'PostToolUseFailure' ||
    payload?.hookEventName === 'PostToolUseFailure') return false
  const result =
    payload?.tool_response ??
    payload?.toolResponse ??
    payload?.tool_output ??
    payload?.toolOutput ??
    payload?.tool_result ??
    payload?.toolResult ??
    payload?.result
  if (result && typeof result === 'object') {
    if (result.error || result.is_error === true || result.isError === true ||
      result.success === false || result.ok === false ||
      result.status === 'failed' || result.status === 'error') return false
  }
  return true
}

export function shouldMarkPetSpoke(event, payload = {}) {
  return event === 'PostToolUse' && isSuccessfulToolResult(payload)
}

function speechMarkerFile(hostId, sessionId, env) {
  const sessionHash = createHash('sha256').update(String(sessionId || 'default')).digest('hex')
  return path.join(resolveRuntimePaths(env).hooksDir, `${hostId}-pet-speech`, `${sessionHash}.json`)
}

function readMarker(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

export function markPetSpoke(hostId, sessionId, toolName = '', env = process.env) {
  try {
    const file = speechMarkerFile(hostId, sessionId, env)
    const dir = path.dirname(file)
    fs.mkdirSync(dir, { recursive: true })
    for (const entry of fs.readdirSync(dir)) {
      const candidate = path.join(dir, entry)
      try {
        const stat = fs.lstatSync(candidate)
        if (stat.isFile() && Date.now() - stat.mtimeMs > MARKER_TTL_MS) fs.rmSync(candidate, { force: true })
      } catch { /* Another hook may have consumed the marker. */ }
    }
    const tmp = `${file}.${randomUUID()}.tmp`
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        session: String(sessionId || 'default'),
        tool: String(toolName || '').slice(0, 80),
        at: Date.now(),
      }),
    )
    fs.renameSync(tmp, file)
  } catch {
    /* 发言标记失败不能影响宿主 */
  }
}

/** 读取并清除本回合标记；跨回合或过期标记一律忽略 */
export function consumePetSpoke(hostId, sessionId, env = process.env) {
  const file = speechMarkerFile(hostId, sessionId, env)
  const marker = readMarker(file)
  if (!marker) return false
  if (marker.session !== String(sessionId || 'default')) return false
  const expired = !Number.isFinite(marker.at) || Date.now() - marker.at > MARKER_TTL_MS
  try {
    fs.rmSync(file, { force: true })
  } catch {
    /* ignore */
  }
  return !expired
}

export function clearPetSpeech(hostId, sessionId, env = process.env) {
  try {
    fs.rmSync(speechMarkerFile(hostId, sessionId, env), { force: true })
  } catch {
    /* ignore */
  }
}
