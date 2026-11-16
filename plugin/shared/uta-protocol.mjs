/**
 * Uta 运行时协议 v2：信封、版本与能力常量。
 *
 * 宿主插件与 Electron 主进程共用这一份校验，避免两端各写一套逐渐漂移。
 * v1 的裸指令仍然接受：normalizeRuntimeEnvelope() 会把它包成 legacy 信封。
 */
export const PROTOCOL_VERSION = '2.0'
export const PROTOCOL_VERSIONS = Object.freeze(['1.0', '2.0'])
export const MAX_BODY_BYTES = 8 * 1024

/** 运行时自身能做的事；宿主能力由 hello 另外声明。 */
export const RUNTIME_CAPABILITIES = Object.freeze([
  'statusEvents',
  'assistantText',
  'characterTools',
  'approval',
  'streamingReply',
  'sessionBinding',
  'receipts',
])

const HOST_ID_RE = /^[A-Za-z0-9._-]{1,64}$/

function cleanHostId(value) {
  return typeof value === 'string' && HOST_ID_RE.test(value.trim()) ? value.trim() : ''
}

function cleanId(value, max = 200) {
  if (typeof value !== 'string') return null
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
  return text || null
}

function cleanSeq(value) {
  return Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : undefined
}

function cleanTimestamp(value) {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text && text.length <= 64 ? text : undefined
}

function buildMeta(raw = {}, legacy = false) {
  const meta = {
    hostId: cleanHostId(raw.hostId) || (legacy ? 'legacy' : ''),
    ...(cleanId(raw.hostInstanceId) ? { hostInstanceId: cleanId(raw.hostInstanceId) } : {}),
    ...(cleanId(raw.sessionId) ? { sessionId: cleanId(raw.sessionId) } : {}),
    ...(cleanId(raw.turnId) ? { turnId: cleanId(raw.turnId) } : {}),
    ...(cleanId(raw.eventId) ? { eventId: cleanId(raw.eventId) } : {}),
    ...(cleanSeq(raw.seq) !== undefined ? { seq: raw.seq } : {}),
    ...(cleanTimestamp(raw.ts) ? { ts: cleanTimestamp(raw.ts) } : {}),
  }
  if (legacy) meta.legacy = true
  return meta
}

/** 把一条指令包成 v2 信封；SDK 用。 */
export function wrapCommand(command, meta = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    meta: buildMeta({ ...meta, hostId: meta.hostId || 'unknown', ts: meta.ts || new Date().toISOString() }),
    command,
  }
}

/**
 * 校验请求体。
 * - 有 protocolVersion：按 v2 严格校验 meta/command。
 * - 没有 protocolVersion：视为 v1 裸指令，包成 legacy 单会话。
 */
export function normalizeRuntimeEnvelope(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'body must be an object' }
  }
  const rawVersion = typeof body.protocolVersion === 'string' ? body.protocolVersion.trim() : ''
  if (!rawVersion) {
    return {
      ok: true,
      legacy: true,
      envelope: {
        protocolVersion: '1.0',
        meta: buildMeta({}, true),
        command: body,
      },
    }
  }
  if (rawVersion !== PROTOCOL_VERSION) {
    return { ok: false, error: `unsupported protocolVersion: ${rawVersion}` }
  }
  if (!body.command || typeof body.command !== 'object' || Array.isArray(body.command)) {
    return { ok: false, error: 'command is required' }
  }
  if (!body.meta || typeof body.meta !== 'object' || Array.isArray(body.meta)) {
    return { ok: false, error: 'meta is required' }
  }
  const meta = buildMeta(body.meta, false)
  if (!meta.hostId) {
    return { ok: false, error: 'meta.hostId is required' }
  }
  return {
    ok: true,
    legacy: false,
    envelope: {
      protocolVersion: PROTOCOL_VERSION,
      meta,
      command: body.command,
    },
  }
}
