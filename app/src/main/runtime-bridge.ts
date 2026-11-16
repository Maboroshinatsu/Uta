/**
 * 本机角色指令与审批桥接端点（P2 / L0 + DeepSeek Harness 扩展）。
 *
 * 给宿主侧插件（DeepSeek Harness 原生插件 / Codex MCP 服务器等）一个**只在本机回环**上
 * 投递角色指令、发起交互式工具审批、拉取 RP 人设与模型预设上下文的入口：
 *   Host Plugin →(HTTP 127.0.0.1 + Bearer token)→ 本文件 → Electron 渲染层
 *
 * 安全约束：
 * - 只绑定 127.0.0.1，不对外网/局域网暴露。
 * - 所有请求必须携带实例级随机 Bearer token；令牌写入 userData，权限尽可能收紧。
 * - body 上限 8KB，只允许白名单指令与结构化审批请求（见 runtime-commands.ts）。
 * - 不提供任意命令执行、文件读写、URL 访问。
 * - 桌宠仅作为审批请求的交互展示与决策器（返回 allowed-once / rejected / unavailable / cancelled），
 *   真正的工具执行仍在宿主侧完成。
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app, BrowserWindow } from 'electron'
import { parseMotionRequest, type MotionRequest, type MotionResult } from '../shared/motion-choreography'
import { decodeChatImage, MAX_CHAT_IMAGE_BODY } from './chat-image'
import {
  validateRuntimeCommand,
  validateApprovalRequest,
  sanitizeRequestId,
  type RuntimeCommand,
  type RuntimeEventMeta,
  type RuntimeApprovalRequest,
  type RuntimeApprovalDecision,
} from './runtime-commands'
import { RuntimeSessionRegistry } from './runtime-sessions'
import {
  MAX_BODY_BYTES,
  PROTOCOL_VERSIONS,
  PROTOCOL_VERSION,
  RUNTIME_CAPABILITIES,
  normalizeRuntimeEnvelope,
} from '../../../plugin/shared/uta-protocol.mjs'

/** 端点信息文件名（放在 Electron userData 下） */
export const ENDPOINT_FILE_NAME = 'runtime-endpoint.json'
/** 端点信息版本，便于将来演进 */
const ENDPOINT_VERSION = 2

export interface RuntimeEndpointInfo {
  version: number
  protocolVersion: string
  port: number
  token: string
  createdAt: string
  instanceId: string
  pid: number
  profile: string
  profileId?: string
  stableData?: boolean
}

export interface ModelRuntimeContext {
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

export type CommandSink = (
  command: RuntimeCommand,
  meta: RuntimeEventMeta,
) => Promise<boolean>

export type ApprovalHandler = (
  request: RuntimeApprovalRequest,
  signal: AbortSignal,
) => Promise<RuntimeApprovalDecision>

export interface RuntimeBridgeOptions {
  onMotionRequest?: (request: MotionRequest) => Promise<MotionResult>
  profile?: string
  stableData?: boolean
  /** Validated, non-duplicate activity for instance-local conversation recovery. */
  onSessionEvent?: (command: RuntimeCommand, meta: RuntimeEventMeta) => void
  /** 把校验通过的指令交给渲染层；返回 false 表示当前无法投递 */
  sink: CommandSink
  /** 探测角色是否可投递。不得有副作用（健康检查会调用它）。 */
  available?: () => boolean
  /** 处理来自宿主的交互式工具审批请求（在桌宠卡片上弹出批准/拒绝按钮） */
  onApprovalRequest?: ApprovalHandler
  /** 当宿主取消审批或连接断开时通知渲染层关闭对应审批卡片 */
  onApprovalCancel?: (requestId: string) => void
  /** 提供当前模型预设与可用表情快照（供宿主插件感知角色能力） */
  getContextSnapshot?: () => {
    modelContext: ModelRuntimeContext
  }
  /** 覆盖端点文件路径（测试用） */
  endpointFile?: string
  /** 额外发布一份按宿主查找的端点文件；绑定切换时可更新 */
  extraEndpointFile?: string
  /** 一只桌宠只接受绑定平台的事件；空字符串表示尚未绑定。 */
  allowedHostId?: () => string
}

export interface RuntimeBridge {
  readonly port: number
  readonly endpointFile: string
  /** 供测试注入的令牌（正常流程自动生成） */
  readonly token: string
  /** 当前已见到的宿主/会话归属，供 /context 与诊断使用 */
  readonly sessions: RuntimeSessionRegistry
  /** 切换按宿主发布的端点文件；空字符串表示移除 */
  setExtraEndpointFile(file: string): boolean
  /** 宿主重绑或退出时，取消挂起的在途审批请求 */
  cancelPendingApprovals(hostId?: string): void
  close(): Promise<void>
}

function endpointFilePath(override?: string): string {
  return override ?? path.join(app.getPath('userData'), ENDPOINT_FILE_NAME)
}

function writeEndpointFile(file: string, info: RuntimeEndpointInfo): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(info, null, 2), { encoding: 'utf-8', mode: 0o600 })
    try {
      fs.renameSync(tmp, file)
    } catch {
      // Windows 某些情况下不能直接覆盖；退回先删后改名
      try {
        fs.unlinkSync(file)
      } catch {}
      fs.renameSync(tmp, file)
    }
  } catch (err) {
    try {
      fs.unlinkSync(tmp)
    } catch {}
    throw err
  }
}

/** 只删除属于当前实例的端点文件，避免误删另一个实例写入的配对文件 */
function removeEndpointFile(file: string, token: string): void {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as { token?: unknown } | null
    if (!raw || raw.token !== token) return
    fs.unlinkSync(file)
  } catch {
    /* 文件不存在、正在被替换或不属于当前实例 */
  }
}

function endpointPidIsAlive(pid: unknown): boolean {
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0) return false
  try {
    process.kill(pid as number, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

/** 当前共享端点是否属于另一个仍存活的实例。 */
function endpointOwnedByLiveOther(file: string, token: string): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      token?: unknown
      pid?: unknown
    } | null
    if (!raw || typeof raw.token !== 'string' || raw.token === token) return false
    return endpointPidIsAlive(raw.pid)
  } catch {
    return false
  }
}

/**
 * 发布共享宿主端点前先认领；已有存活实例时不覆盖。
 * claim 锁只保护“检查 + 写入”的短窗口，崩溃锁由存活 PID/时间兜底。
 */
function claimEndpointFile(file: string, info: RuntimeEndpointInfo): boolean {
  if (endpointOwnedByLiveOther(file, info.token)) return false
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const lockFile = `${file}.claim`
  let locked = false
  for (let attempt = 0; attempt < 2 && !locked; attempt += 1) {
    try {
      const fd = fs.openSync(lockFile, 'wx')
      fs.writeSync(fd, JSON.stringify({ pid: info.pid, token: info.token, at: Date.now() }))
      fs.closeSync(fd)
      locked = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') return false
      try {
        const lock = JSON.parse(fs.readFileSync(lockFile, 'utf-8')) as {
          pid?: unknown
          token?: unknown
          at?: unknown
        }
        const stale =
          lock?.token === info.token ||
          !endpointPidIsAlive(lock?.pid) ||
          !Number.isFinite(lock?.at) ||
          Date.now() - Number(lock?.at) > 10_000
        if (!stale) return false
        fs.unlinkSync(lockFile)
        continue
      } catch {
        try {
          fs.unlinkSync(lockFile)
        } catch {
          /* retry once */
        }
        continue
      }
    }
  }
  if (!locked) return false
  try {
    if (endpointOwnedByLiveOther(file, info.token)) return false
    writeEndpointFile(file, info)
    return true
  } catch {
    return false
  } finally {
    try {
      fs.unlinkSync(lockFile)
    } catch {
      /* lock may have been removed by the OS */
    }
  }
}

/** 常量时间比较，避免通过响应时间猜测令牌 */
function tokenMatches(expected: string, provided: unknown): boolean {
  if (typeof provided !== 'string' || provided.length !== expected.length) return false
  const a = Buffer.from(expected, 'utf-8')
  const b = Buffer.from(provided, 'utf-8')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

const BODY_TOO_LARGE = 'BODY_TOO_LARGE'
function bodyTooLargeError(): Error {
  const error = new Error('body too large')
  ;(error as NodeJS.ErrnoException).code = BODY_TOO_LARGE
  return error
}

function readBody(req: http.IncomingMessage, limit = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > limit) {
      reject(bodyTooLargeError())
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    req.on('data', (chunk: Buffer) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        // 先让处理器回 413，再在响应写完后断开；立刻 destroy 会让客户端只看到 ECONNRESET
        settled = true
        reject(bodyTooLargeError())
        req.pause()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { if (!settled) resolve(Buffer.concat(chunks).toString('utf-8')) })
    req.on('error', reject)
  })
}

function drainDeclaredOversize(req: http.IncomingMessage, limit: number): Promise<void> {
  const declared = Number(req.headers['content-length'])
  // Read only a bounded amount for a bounded time. Closing a socket while the
  // peer is still uploading can reset the response even after writeHead(413).
  if (!(declared > limit && declared <= 2 * limit) || req.readableEnded || req.destroyed) return Promise.resolve()
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer)
      req.off('end', finish)
      req.off('close', finish)
      req.off('error', finish)
      resolve()
    }
    const timer = setTimeout(finish, 1500)
    req.once('end', finish)
    req.once('close', finish)
    req.once('error', finish)
    req.resume()
  })
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  if (res.writableEnded) return
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    // 本地端点不需要被浏览器访问
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

const MEDIA_HOSTS = new Map([['/maibot-media', 'maibot'], ['/astrbot-media', 'astrbot']])
const ALLOWED_ROUTES = new Set([
  '/command',
  ...MEDIA_HOSTS.keys(),
  '/health',
  '/context',
  '/motion',
  '/approval/ask',
  '/approval/cancel',
])

/** 同时挂起的审批上限：超过后让宿主自己处理，避免审批卡片堆满窗口。 */
const MAX_PENDING_APPROVALS = 8

/**
 * 启动本机端点。失败时抛异常，由调用方决定是否降级（角色工具不可用不应阻止桌宠启动）。
 */
export async function startRuntimeBridge(options: RuntimeBridgeOptions): Promise<RuntimeBridge> {
  const instanceId = crypto.randomUUID()
  const token = crypto.randomBytes(32).toString('hex')
  const endpointFile = endpointFilePath(options.endpointFile)
  const profilePath = process.platform === 'win32' ? path.resolve(endpointFile).toLowerCase() : path.resolve(endpointFile)
  const profileId = crypto.createHash('sha256').update(profilePath).digest('hex')
  const pendingControllers = new Map<string, {
    controller: AbortController
    requestId: string
    host: string
    sessionId: string
  }>()
  const sessions = new RuntimeSessionRegistry()
  interface DeliveryOutcome {
    status: number
    body: Record<string, unknown>
  }
  const inFlightDeliveries = new Map<string, Promise<DeliveryOutcome>>()
  let extraEndpointFile = options.extraEndpointFile || ''

  function hostAllowed(hostId: string | undefined, legacy = false): boolean {
    if (typeof options.allowedHostId !== 'function') return true
    const allowed = options.allowedHostId()
    // Legacy commands carry a synthetic host id and no real identity. Accept
    // them only when the pet is actually bound.
    if (legacy || !hostId) return !!allowed
    return !!allowed && hostId === allowed
  }

  function deliveryKeys(meta: RuntimeEventMeta): string[] {
    const base = `${meta.hostId}:${meta.sessionId ?? ''}`
    const keys: string[] = []
    if (meta.eventId) keys.push(`${base}:e:${meta.eventId}`)
    if (meta.seq !== undefined) keys.push(`${base}:s:${meta.seq}`)
    return keys
  }

  function trackDelivery(meta: RuntimeEventMeta, promise: Promise<DeliveryOutcome>): void {
    const keys = deliveryKeys(meta)
    for (const key of keys) inFlightDeliveries.set(key, promise)
    const cleanup = (): void => {
      for (const key of keys) {
        if (inFlightDeliveries.get(key) === promise) inFlightDeliveries.delete(key)
      }
    }
    void promise.then(cleanup, cleanup)
  }

  function pendingDelivery(meta: RuntimeEventMeta): Promise<DeliveryOutcome> | undefined {
    for (const key of deliveryKeys(meta)) {
      const promise = inFlightDeliveries.get(key)
      if (promise) return promise
    }
    return undefined
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const route = (req.url ?? '').split('?')[0]
      const mediaHost = MEDIA_HOSTS.get(route)
      if (!ALLOWED_ROUTES.has(route)) {
        sendJson(res, 404, { ok: false, error: 'not found' })
        return
      }

      // 所有路由（含健康检查）都要求令牌，避免对外暴露端点存在性
      const auth = req.headers.authorization ?? ''
      const provided = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
      if (!tokenMatches(token, provided)) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' })
        return
      }

      if (route === '/health') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        // 只做无副作用的可用性探测，绝不为了健康检查而发送任何指令
        const characterAvailable = options.available ? options.available() : true
        sendJson(res, 200, {
          ok: true,
          service: 'uta-runtime',
          instanceId,
          pid: process.pid,
          profile: options.profile || 'stable',
          profileId,
          stableData: options.stableData === true,
          version: ENDPOINT_VERSION,
          protocolVersion: PROTOCOL_VERSION,
          protocolVersions: PROTOCOL_VERSIONS,
          capabilities: RUNTIME_CAPABILITIES,
          maxBodyBytes: MAX_BODY_BYTES,
          characterAvailable,
          approvalSupported: !!options.onApprovalRequest,
        })
        return
      }

      if (route === '/context') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        const requestedHost = new URLSearchParams(req.url?.split('?')[1]).get('hostId')
        if (requestedHost !== null && (!requestedHost || !hostAllowed(requestedHost))) {
          sendJson(res, 403, { ok: false, error: 'host-not-bound' })
          return
        }
        const characterAvailable = options.available ? options.available() : true
        const snapshot = options.getContextSnapshot?.() ?? {
          modelContext: {
            modelName: 'Live2D Character',
            emotions: ['neutral', 'happy', 'sad', 'angry', 'surprise', 'thinking', 'shy'],
            presetGroups: [],
          },
        }
        sendJson(res, 200, {
          ok: true,
          protocolVersion: PROTOCOL_VERSION,
          characterAvailable,
          sessions: sessions.list(),
          ...snapshot,
        })
        return
      }

      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }

      let raw: string
      const bodyLimit = mediaHost ? MAX_CHAT_IMAGE_BODY : MAX_BODY_BYTES
      try {
        raw = await readBody(req, bodyLimit)
      } catch (err) {
        const oversized = (err as NodeJS.ErrnoException)?.code === BODY_TOO_LARGE
        if (oversized) {
          await drainDeclaredOversize(req, bodyLimit)
          if (res.destroyed) return
          res.setHeader('Connection', 'close')
        }
        sendJson(res, 413, { ok: false, error: String((err as Error).message ?? err) })
        if (oversized) req.resume()
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        sendJson(res, 400, { ok: false, error: 'invalid json' })
        return
      }

      if (route === '/motion') {
        const request = parseMotionRequest(parsed)
        if (!request) { sendJson(res, 400, { ok: false, error: 'invalid motion request' }); return }
        if (!hostAllowed(request.hostId)) { sendJson(res, 403, { ok: false, error: 'host-not-bound' }); return }
        if (!options.onMotionRequest) { sendJson(res, 503, { ok: false, error: 'motion-unavailable' }); return }
        try {
          const result = await options.onMotionRequest(request)
          sendJson(res, result.ok ? 200 : 409, result)
        } catch {
          sendJson(res, 503, { ok: false, error: 'motion-unavailable' })
        }
        return
      }

      if (route === '/approval/cancel') {
        const record =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {}
        const rawLookup = typeof record.requestId === 'string' ? record.requestId.trim().slice(0, 400) : ''
        const originalId = sanitizeRequestId(record.requestId)
        if (!rawLookup || (!originalId && !pendingControllers.has(rawLookup))) {
          sendJson(res, 400, { ok: false, error: 'requestId is required' })
          return
        }
        // 渲染层拿到的是内部键；插件通常仍用原始 requestId 取消。
        // 同名 requestId 跨会话并存时，允许宿主带上 host/sessionId 消歧。
        const hostFilter = typeof record.host === 'string' ? record.host.trim() : undefined
        const sessionFilter = typeof record.sessionId === 'string' ? record.sessionId.trim() : undefined
        let approvalKey = pendingControllers.has(rawLookup) ? rawLookup : ''
        if (!approvalKey && originalId) {
          const matches = [...pendingControllers.entries()]
            .filter(([, pending]) => pending.requestId === originalId &&
              (hostFilter === undefined || pending.host === hostFilter) &&
              (sessionFilter === undefined || pending.sessionId === sessionFilter))
            .map(([key]) => key)
          if (matches.length > 1) {
            sendJson(res, 409, {
              ok: false,
              error: 'ambiguous requestId; add sessionId or use the namespace-qualified id',
            })
            return
          }
          approvalKey = matches[0] ?? ''
        }
        const pending = approvalKey ? pendingControllers.get(approvalKey) : undefined
        if (pending && approvalKey) {
          pending.controller.abort()
          pendingControllers.delete(approvalKey)
          options.onApprovalCancel?.(approvalKey)
        }
        sendJson(res, 200, {
          ok: true,
          // 与批准响应一致：对宿主回显它的原始 requestId
          requestId: pending?.requestId || originalId || rawLookup,
          cancelled: !!pending,
        })
        return
      }

      if (route === '/approval/ask') {
        const validation = validateApprovalRequest(parsed)
        if (!validation.ok) {
          sendJson(res, 400, { ok: false, error: validation.error })
          return
        }
        const characterAvailable = options.available ? options.available() : true
        if (!characterAvailable || !options.onApprovalRequest) {
          sendJson(res, 200, {
            ok: true,
            requestId: validation.value.requestId,
            outcome: 'unavailable' as RuntimeApprovalDecision,
          })
          return
        }

        const { requestId, timeoutMs, host, sessionId } = validation.value
        if (!hostAllowed(host)) {
          sendJson(res, 403, {
            ok: false,
            error: 'host-not-bound',
            detail: 'This Uta pet is bound to another agent platform.',
          })
          return
        }
        // 内部键用 JSON 元组，避免 host/session 里的冒号与 requestId 拼接碰撞；
        // 两个宿主或同一宿主的两个会话撞到同一个 requestId 时也能共存。
        const approvalKey = JSON.stringify([host, sessionId ?? '', requestId])
        if (pendingControllers.size >= MAX_PENDING_APPROVALS) {
          sendJson(res, 200, {
            ok: true,
            requestId,
            outcome: 'unavailable' as RuntimeApprovalDecision,
            error: 'too many pending approvals',
          })
          return
        }
        if (pendingControllers.has(approvalKey)) {
          sendJson(res, 409, {
            ok: false,
            error: 'approval request already in progress',
          })
          return
        }

        const ctrl = new AbortController()
        pendingControllers.set(approvalKey, {
          controller: ctrl,
          requestId,
          host,
          sessionId: sessionId ?? '',
        })
        const request = { ...validation.value, requestId: approvalKey }

        const onClose = () => {
          if (!res.writableEnded) {
            ctrl.abort()
            options.onApprovalCancel?.(approvalKey)
          }
        }
        res.on('close', onClose)

        const timer = setTimeout(() => {
          ctrl.abort()
          options.onApprovalCancel?.(approvalKey)
        }, timeoutMs)

        try {
          const outcome = await Promise.race([
            options.onApprovalRequest(request, ctrl.signal),
            new Promise<RuntimeApprovalDecision>((resolve) => {
              if (ctrl.signal.aborted) resolve('cancelled')
              else ctrl.signal.addEventListener('abort', () => resolve('cancelled'), { once: true })
            }),
          ])
          sendJson(res, 200, {
            ok: true,
            // 响应给宿主：requestId 回显原始值；cancelId 是唯一可寻址的内部键，
            // 同名 requestId 跨会话并存时，取消必须用它。
            requestId,
            outcome,
          })
        } catch (err) {
          sendJson(res, 500, { ok: false, error: String((err as Error).message ?? err) })
        } finally {
          clearTimeout(timer)
          res.removeListener('close', onClose)
          if (pendingControllers.get(approvalKey)?.controller === ctrl) {
            pendingControllers.delete(approvalKey)
          }
        }
        return
      }

      // route === '/command'
      const normalized = normalizeRuntimeEnvelope(parsed)
      if (!normalized.ok) {
        sendJson(res, 400, { ok: false, error: normalized.error })
        return
      }
      const { envelope, legacy } = normalized
      const { meta } = envelope
      let command: RuntimeCommand
      if (mediaHost) {
        if (legacy || meta.hostId !== mediaHost || !meta.sessionId || !meta.eventId) {
          sendJson(res, 403, { ok: false, error: 'media requires the matching host, session and event identity' })
          return
        }
        const payload = envelope.command as Record<string, unknown> | null
        const image = payload?.command === 'chat_image' ? decodeChatImage(payload.base64) : null
        if (!image) {
          sendJson(res, 400, { ok: false, error: 'invalid chat image' })
          return
        }
        const description = typeof payload?.description === 'string' ? payload.description.trim().slice(0, 160) : ''
        command = { command: 'chat_image', image, description: description || '图片' }
      } else {
        const result = validateRuntimeCommand(envelope.command)
        if (!result.ok) {
          sendJson(res, 400, { ok: false, error: result.error })
          return
        }
        command = result.value
      }
      if (!hostAllowed(meta.hostId, legacy)) {
        sendJson(res, 403, {
          ok: false,
          error: 'host-not-bound',
          detail: 'This Uta pet is bound to another agent platform.',
        })
        return
      }
      if (['set_emotion', 'set_preset', 'play_animation'].includes(command.command)) {
        const model = options.getContextSnapshot?.()?.modelContext
        const expected = envelope.command.modelRevision
        if (model?.revision) {
          if (expected !== undefined && expected !== model.revision) {
            sendJson(res, 409, { ok: false, error: 'Character capabilities changed. Call deskpet_get_capabilities again before choosing a new action.', modelRevision: model.revision })
            return
          }
          if (model.ready === false) { sendJson(res, 409, { ok: false, error: 'Character is still loading. Refresh capabilities after it is ready.' }); return }
          const supported = command.command === 'set_emotion' ? model.emotions.includes(command.emotion)
            : command.command === 'play_animation' ? (model.animations?.includes(command.name) || (command.name.includes('#') && model.animations?.includes(command.name.slice(0, command.name.indexOf('#')))) || model.animations?.some(a => a.toLowerCase() === command.name.toLowerCase() || (command.name.includes('#') && a.toLowerCase() === command.name.slice(0, command.name.indexOf('#')).toLowerCase())))
              : command.command === 'set_preset' && model.presetGroups.some(group => group.group === command.preset || group.presets.includes(command.preset))
          if (!supported) { sendJson(res, 422, { ok: false, error: 'This character does not support that action. Call deskpet_get_capabilities for current actions.' }); return }
          // Keep this revision attached until the renderer applies the effect.
          meta.modelRevision = model.revision
        }
      }
      // Discrete conversation content can fill a recent gap. State, plan
      // snapshots and reply streams must preserve their application order.
      const allowOutOfOrder = command.command === 'notify' || command.command === 'chat_image' ||
        (command.command === 'rp_reply' && !command.streaming && !command.requestId)
      const acceptance = sessions.reserve(meta, Date.now(), allowOutOfOrder)
      if (acceptance.duplicate) {
        const state = sessions.duplicateState(meta, allowOutOfOrder)
        if (state === 'stale') {
          sendJson(res, 409, { ok: false, accepted: false, error: 'stale-event' })
          return
        }
        // A duplicate that is still delivering must observe the first request's
        // outcome. Only a committed event can be acknowledged immediately.
        if (state === 'in-flight') {
          const pending = pendingDelivery(meta)
          if (pending) {
            const outcome = await pending
            sendJson(res, outcome.status, {
              ...outcome.body,
              duplicate: outcome.status === 200 && outcome.body.accepted !== false,
            })
            return
          }
          sendJson(res, 409, {
            ok: false,
            accepted: false,
            pending: true,
            retryable: true,
            error: 'event delivery is still in flight',
          })
          return
        }
        sendJson(res, 200, {
          ok: true,
          accepted: true,
          duplicate: true,
          command: command.command,
          protocolVersion: envelope.protocolVersion,
          legacy,
          hostId: meta.hostId,
          sessionId: meta.sessionId,
        })
        return
      }
      sessions.touch(meta, command.command)
      options.onSessionEvent?.(command, meta)

      if (command.command === 'hello') {
        sessions.declare(meta, {
          capabilities: command.capabilities,
          sdkVersion: command.sdkVersion,
          label: command.label,
        })
        sessions.commit(meta)
        sendJson(res, 200, {
          ok: true,
          accepted: true,
          command: 'hello',
          protocolVersion: PROTOCOL_VERSION,
          hostId: meta.hostId,
          sessionId: meta.sessionId,
          ack: {
            protocolVersion: PROTOCOL_VERSION,
            protocolVersions: PROTOCOL_VERSIONS,
            capabilities: RUNTIME_CAPABILITIES,
            maxBodyBytes: MAX_BODY_BYTES,
          },
        })
        return
      }

      if (command.command === 'session_bind') {
        const delivery = (async (): Promise<DeliveryOutcome> => {
          sessions.bind(meta, { label: command.label, cwd: command.cwd })
          let delivered = false
          try {
            delivered = await options.sink(command, meta)
          } catch {
            delivered = false
          }
          if (delivered) sessions.commit(meta)
          else sessions.release(meta)
          return {
            status: 200,
            body: {
              ok: true,
              accepted: delivered,
              command: 'session_bind',
              protocolVersion: envelope.protocolVersion,
              legacy,
              hostId: meta.hostId,
              sessionId: meta.sessionId,
              ...(acceptance.gap ? { gap: true } : {}),
            },
          }
        })()
        trackDelivery(meta, delivery)
        const outcome = await delivery
        sendJson(res, outcome.status, outcome.body)
        return
      }

      const delivery = (async (): Promise<DeliveryOutcome> => {
        try {
          const delivered = await options.sink(command, meta)
          if (!delivered) {
            sessions.release(meta)
            return { status: 503, body: { ok: false, error: 'no deskpet window available' } }
          }
          sessions.commit(meta)
          return {
            status: 200,
            body: {
              ok: true,
              accepted: true,
              command: command.command,
              protocolVersion: envelope.protocolVersion,
              legacy,
              hostId: meta.hostId,
              sessionId: meta.sessionId,
              ...(acceptance.gap ? { gap: true } : {}),
            },
          }
        } catch (err) {
          sessions.release(meta)
          return { status: 500, body: { ok: false, error: String((err as Error).message ?? err) } }
        }
      })()
      trackDelivery(meta, delivery)
      const outcome = await delivery
      sendJson(res, outcome.status, outcome.body)
    })()
  })

  // 只绑定回环
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const info: RuntimeEndpointInfo = {
    version: ENDPOINT_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    port,
    token,
    createdAt: new Date().toISOString(),
    instanceId,
    pid: process.pid,
    profile: options.profile || 'stable',
    profileId,
    stableData: options.stableData === true,
  }
  try {
    writeEndpointFile(endpointFile, info)
  } catch (error) {
    // 发布配对文件失败时关闭已创建的监听，避免留下无法管理的桥实例。
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw error
  }
  if (extraEndpointFile) {
    try {
      if (!claimEndpointFile(extraEndpointFile, info)) {
        console.warn(`[uta] host-specific endpoint is already served by another live instance: ${extraEndpointFile}`)
      }
    } catch (error) {
      console.warn('[uta] cannot publish host-specific endpoint:', error)
    }
  }

  return {
    port,
    endpointFile,
    token,
    sessions,
    setExtraEndpointFile(file: string) {
      const next = file || ''
      try {
        if (next && !claimEndpointFile(next, info)) {
          console.warn(`[uta] host-specific endpoint is already served by another live instance: ${next}`)
          return false
        }
        if (extraEndpointFile && extraEndpointFile !== next) removeEndpointFile(extraEndpointFile, token)
        extraEndpointFile = next
        return true
      } catch (error) {
        console.warn('[uta] cannot publish host-specific endpoint:', error)
        return false
      }
    },
    cancelPendingApprovals(hostId?: string) {
      for (const [key, pending] of pendingControllers.entries()) {
        if (!hostId || pending.host === hostId) {
          pending.controller.abort()
          options.onApprovalCancel?.(key)
          pendingControllers.delete(key)
        }
      }
    },
    async close() {
      for (const pending of pendingControllers.values()) {
        pending.controller.abort()
      }
      pendingControllers.clear()
      removeEndpointFile(endpointFile, token)
      if (extraEndpointFile) removeEndpointFile(extraEndpointFile, token)
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        // 已建立的 keep-alive 连接不应阻塞关闭
        server.closeAllConnections?.()
      })
    },
  }
}

/**
 * 便捷封装：把指令发给指定窗口。
 * 默认取第一个可用窗口只适合单窗口场景；设置窗口打开时必须由调用方显式传宠物主窗口，
 * 否则宿主事件可能被设置窗接走而桌宠收不到。
 */
export function windowCommandSink(
  channel: string,
  getWindow: () => BrowserWindow | null = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null,
): CommandSink {
  return async (command, meta) => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return false
    win.webContents.send(channel, { command, meta })
    return true
  }
}
