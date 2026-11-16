/**
 * Uta 本机运行时的共用客户端（宿主无关）。
 *
 * 宿主侧的所有接入面（MCP 服务器、各宿主的 hook 脚本）都只通过这里
 * 发现端点并投递请求，避免每接一个新宿主就重写一遍传输与鉴权逻辑。
 *
 * 安全边界：
 * - 只连 127.0.0.1；
 * - 令牌只从端点文件读取，不落日志、不进 URL；
 * - 不做任何文件读写（端点文件除外）、不发起外部网络请求。
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { wrapCommand } from './uta-protocol.mjs'
import { resolveRuntimePaths } from './uta-environment.mjs'

/**
 * 端点文件候选路径：环境变量优先，其次按应用的 userData 目录逐个尝试。
 *
 * 显式 profile/路径只返回指定目标；未指定时兼容旧版目录。
 */
export function endpointCandidates(env = process.env) {
  const paths = resolveRuntimePaths(env)
  const out = [paths.endpointFile]
  const appData = env.APPDATA
  const hostId = typeof env.UTA_HOST === 'string' ? env.UTA_HOST.trim().toLowerCase() : ''
  // Explicit targets are test/host overrides and must stay exclusive.
  if (paths.explicit) return out
  if (appData && /^[a-z0-9-]{1,64}$/.test(hostId)) {
    // A pet bound to this platform publishes a host-specific pairing file.
    out.unshift(path.join(appData, 'uta', 'host-pets', hostId, 'runtime-endpoint.json'))
  }
  if (appData) {
    // 旧版：electron-builder productName 为 "MaiBot Deskpet"；开发态用 package.json name
    out.push(path.join(appData, 'MaiBot Deskpet', 'runtime-endpoint.json'))
    out.push(path.join(appData, 'maibot-deskpet', 'runtime-endpoint.json'))
  }
  return out
}

function pidIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export function readEndpoint(env = process.env) {
  for (const file of endpointCandidates(env)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
      if (!pidIsAlive(raw?.pid)) continue
      if (raw && typeof raw.port === 'number' && typeof raw.token === 'string' && raw.token) {
        return { port: raw.port, token: raw.token, file }
      }
    } catch {
      /* 试下一个候选 */
    }
  }
  return null
}

/** 向本机运行时发起请求；失败时抛出带可读信息的错误 */
export function callRuntime(method, route, body, options = {}) {
  const { env = process.env, timeoutMs = 5000 } = options
  return new Promise((resolve, reject) => {
    const endpoint = readEndpoint(env)
    if (!endpoint) {
      reject(new Error('Deskpet runtime is not running, or pairing info is unavailable. Start the Uta desktop app first.'))
      return
    }
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf-8')
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: endpoint.port,
        path: route,
        method,
        headers: {
          Authorization: `Bearer ${endpoint.token}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        res.setEncoding('utf-8')
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          let parsed = null
          try {
            parsed = JSON.parse(data)
          } catch {
            /* 非 JSON 响应 */
          }
          if (res.statusCode === 200 && parsed && parsed.ok) resolve(parsed)
          else reject(new Error((parsed && parsed.error) || `runtime returned HTTP ${res.statusCode}`))
        })
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('runtime request timed out')))
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

/** 投递一条角色指令（notify / agent_state / rp_reply / set_preset ...） */
export function sendCommand(commandPayload, options = {}) {
  const { meta, ...rest } = options
  const body = meta ? wrapCommand(commandPayload, meta) : commandPayload
  return callRuntime('POST', '/command', body, rest)
}

let protocolProbe = null

/** 先问一次 /health；旧运行时只认识裸指令，不能把 v2 信封硬发过去。 */
async function runtimeSupportsV2(options = {}) {
  const env = options.env || process.env
  const endpoint = readEndpoint(env)
  if (!endpoint) return false
  if (protocolProbe && protocolProbe.file === endpoint.file && protocolProbe.port === endpoint.port && protocolProbe.token === endpoint.token) {
    return protocolProbe.v2
  }
  try {
    const health = await getHealth({
      ...options,
      timeoutMs: Math.min(600, options.timeoutMs || 600),
    })
    const versions = Array.isArray(health?.protocolVersions) ? health.protocolVersions : []
    const v2 = versions.includes('2.0')
    protocolProbe = { file: endpoint.file, port: endpoint.port, token: endpoint.token, v2 }
    return v2
  } catch (error) {
    // 离线不是 v1：不要缓存失败，否则重启后的同一实例可能持续发裸指令。
    protocolProbe = null
    throw error
  }
}

/**
 * 带宿主/会话归属的客户端。插件只需在会话变化时 setSession()，
 * 之后的指令自动带 v2 信封；旧版运行时仍接受裸指令，客户端会按 meta 存在与否降级。
 */
export function createHostClient({
  hostId,
  hostInstanceId,
  sessionId,
  label,
  capabilities,
  sdkVersion,
  env,
} = {}) {
  let currentSession = typeof sessionId === 'string' ? sessionId : ''
  let currentTurn = ''
  const baseOptions = {
    env: {
      ...(env || process.env),
      ...(hostId ? { UTA_HOST: hostId } : {}),
    },
  }

  const meta = () => ({
    hostId,
    ...(hostInstanceId ? { hostInstanceId } : {}),
    ...(currentSession ? { sessionId: currentSession } : {}),
    ...(currentTurn ? { turnId: currentTurn } : {}),
  })

  return {
    getSession() {
      return currentSession
    },
    setSession(next, extras = {}) {
      const session = typeof next === 'string' ? next.trim().slice(0, 200) : ''
      if (session !== currentSession) currentTurn = ''
      currentSession = session
      if (typeof extras.turnId === 'string') currentTurn = extras.turnId.trim().slice(0, 200)
      return currentSession
    },
    async send(command, options = {}) {
      const merged = {
        ...options,
        env: options.env && hostId ? { ...options.env, UTA_HOST: hostId } : options.env ?? baseOptions.env,
      }
      const v2 = await runtimeSupportsV2(merged)
      if (!v2 && (command.command === 'hello' || command.command === 'session_bind')) {
        return { ok: true, skipped: true, legacy: true }
      }
      return sendCommand(command, {
        ...merged,
        ...(v2 ? { meta: { ...meta(), ...(options.meta || {}) } } : {}),
      })
    },
    bindSession(next, info = {}, options = {}) {
      this.setSession(next)
      return this.send({
        command: 'session_bind',
        ...(info.userInitiated === true ? { userInitiated: true } : {}),
        ...(info.label ? { label: info.label } : {}),
        ...(info.cwd ? { cwd: info.cwd } : {}),
      }, options)
    },
    hello(extra = {}, options = {}) {
      return this.send({
        command: 'hello',
        ...(sdkVersion ? { sdkVersion } : {}),
        ...(capabilities ? { capabilities } : {}),
        ...(label ? { label } : {}),
        ...extra,
      }, options)
    },
  }
}

export function getHealth(options) {
  return callRuntime('GET', '/health', undefined, options)
}

export function getContext(options) {
  return callRuntime('GET', '/context', undefined, options)
}

/** 请求桌宠弹出交互式审批卡片；返回 { outcome } */
export function askApproval(request, options) {
  return callRuntime('POST', '/approval/ask', request, options)
}

export function cancelApproval(requestId, options) {
  return callRuntime('POST', '/approval/cancel', { requestId }, options)
}
