import type { RuntimeEventMeta } from './runtime-commands'

export const SESSION_TTL_MS = 30 * 60 * 1000
/** 已记住的事件 ID 集合最多保留的会话数；会话过期后仍保留，避免旧事件重放。 */
const MAX_RECENT_EVENT_KEYS = 512
const RECENT_SEQUENCE_WINDOW = 64

export interface RuntimeSessionRecord {
  key: string
  hostId: string
  hostInstanceId?: string
  sessionId?: string
  label?: string
  cwd?: string
  capabilities: string[]
  sdkVersion?: string
  lastSeen: number
  lastCommand?: string
  lastSeq?: number
  incomplete?: boolean
  duplicates?: number
}

export interface RuntimeEventAcceptance {
  duplicate: boolean
  gap: boolean
}

function keyFor(meta: RuntimeEventMeta): string {
  return `${meta.hostId}:${meta.sessionId ?? ''}`
}

/** 只记录归属与最近活动；不保存正文、参数或路径以外的用户内容。 */
export class RuntimeSessionRegistry {
  private readonly sessions = new Map<string, RuntimeSessionRecord>()
  private readonly recentEvents = new Map<string, Set<string>>()
  private readonly inFlight = new Map<string, Set<string>>()
  private readonly inFlightSeqs = new Map<string, Map<number, string | undefined>>()
  private readonly recentSeqs = new WeakMap<RuntimeSessionRecord, Map<number, string | undefined>>()
  /** 已退场的宿主实例；它们迟到的事件不能把会话状态翻回旧实例。 */
  private readonly retiredInstances = new Map<string, Set<string>>()

  private isRetiredInstance(meta: RuntimeEventMeta): boolean {
    const id = meta.hostInstanceId
    if (!id) return false
    const record = this.sessions.get(keyFor(meta))
    if (!record?.hostInstanceId || record.hostInstanceId === id) return false
    return this.retiredInstances.get(record.key)?.has(id) ?? false
  }

  private retireInstance(record: RuntimeSessionRecord): void {
    if (!record.hostInstanceId) return
    let retired = this.retiredInstances.get(record.key)
    if (!retired) {
      retired = new Set()
      this.retiredInstances.set(record.key, retired)
    }
    retired.add(record.hostInstanceId)
    if (retired.size > 16) {
      const oldest = retired.values().next().value
      if (oldest !== undefined) retired.delete(oldest)
    }
    if (this.retiredInstances.size > MAX_RECENT_EVENT_KEYS) {
      const oldestKey = this.retiredInstances.keys().next().value
      if (oldestKey !== undefined && oldestKey !== record.key) this.retiredInstances.delete(oldestKey)
    }
  }

  /**
   * Reserve an event before delivery. A failed sink releases the reservation,
   * so the same eventId/seq can be retried instead of being cached as a duplicate.
   */
  reserve(meta: RuntimeEventMeta, now = Date.now(), allowOutOfOrder = false): RuntimeEventAcceptance {
    if (this.isRetiredInstance(meta)) {
      const record = this.sessions.get(keyFor(meta))
      if (record) record.duplicates = (record.duplicates ?? 0) + 1
      return { duplicate: true, gap: false }
    }
    const record = this.ensure(meta, now)
    if (this.duplicateState(meta, allowOutOfOrder) !== 'none') {
      record.duplicates = (record.duplicates ?? 0) + 1
      return { duplicate: true, gap: false }
    }
    if (meta.eventId) {
      let active = this.inFlight.get(record.key)
      if (!active) {
        active = new Set()
        this.inFlight.set(record.key, active)
      }
      active.add(meta.eventId)
    }
    if (meta.seq !== undefined) {
      let active = this.inFlightSeqs.get(record.key)
      if (!active) {
        active = new Map()
        this.inFlightSeqs.set(record.key, active)
      }
      active.set(meta.seq, meta.eventId)
    }
    return { duplicate: false, gap: meta.seq !== undefined && record.lastSeq !== undefined && meta.seq > record.lastSeq + 1 }
  }

  /** A sequence watermark alone cannot prove that a specific event was delivered. */
  duplicateState(meta: RuntimeEventMeta, allowOutOfOrder = false): 'none' | 'committed' | 'in-flight' | 'stale' {
    const key = keyFor(meta)
    if (meta.eventId && this.recentEvents.get(key)?.has(meta.eventId)) return 'committed'
    if (this.isRetiredInstance(meta)) return 'stale'
    if (meta.eventId && this.inFlight.get(key)?.has(meta.eventId)) return 'in-flight'
    if (meta.seq !== undefined) {
      const record = this.sessions.get(key)
      const active = this.inFlightSeqs.get(key)
      if (active?.has(meta.seq)) return active.get(meta.seq) === meta.eventId ? 'in-flight' : 'stale'
      const committed = record && this.recentSeqs.get(record)
      if (committed?.has(meta.seq)) return committed.get(meta.seq) === meta.eventId ? 'committed' : 'stale'
      if (record?.lastSeq !== undefined && meta.seq <= record.lastSeq &&
        (!allowOutOfOrder || record.lastSeq - meta.seq >= RECENT_SEQUENCE_WINDOW)) return 'stale'
    }
    return 'none'
  }

  /** Record a successfully delivered reservation and advance the sequence. */
  commit(meta: RuntimeEventMeta, now = Date.now()): void {
    // 旧实例晚到的投递不能推进新实例的 seq，也不能混入新实例的事件集合
    if (this.isRetiredInstance(meta)) return
    const record = this.ensure(meta, now)
    if (meta.eventId) {
      let seen = this.recentEvents.get(record.key)
      if (!seen) {
        seen = new Set()
        this.recentEvents.set(record.key, seen)
      }
      seen.add(meta.eventId)
      if (seen.size > 64) {
        const oldest = seen.values().next().value
        if (oldest !== undefined) seen.delete(oldest)
      }
      if (this.recentEvents.size > MAX_RECENT_EVENT_KEYS) {
        const oldestKey = this.recentEvents.keys().next().value
        if (oldestKey !== undefined && oldestKey !== record.key) this.recentEvents.delete(oldestKey)
      }
      this.inFlight.get(record.key)?.delete(meta.eventId)
    }
    if (meta.seq !== undefined) {
      this.inFlightSeqs.get(record.key)?.delete(meta.seq)
      if (record.lastSeq === undefined || meta.seq > record.lastSeq) {
        if (record.lastSeq !== undefined && meta.seq > record.lastSeq + 1) record.incomplete = true
        record.lastSeq = meta.seq
      }
      let committed = this.recentSeqs.get(record)
      if (!committed) {
        committed = new Map()
        this.recentSeqs.set(record, committed)
      }
      if (record.lastSeq - meta.seq < RECENT_SEQUENCE_WINDOW) committed.set(meta.seq, meta.eventId)
      for (const seq of committed.keys()) {
        if (record.lastSeq - seq >= RECENT_SEQUENCE_WINDOW) committed.delete(seq)
      }
    }
  }

  release(meta: RuntimeEventMeta): void {
    if (this.isRetiredInstance(meta)) return
    const key = keyFor(meta)
    if (meta.eventId) this.inFlight.get(key)?.delete(meta.eventId)
    if (meta.seq !== undefined) this.inFlightSeqs.get(key)?.delete(meta.seq)
  }

  /** Convenience for callers that acknowledge before any asynchronous delivery. */
  accept(meta: RuntimeEventMeta, now = Date.now()): RuntimeEventAcceptance {
    const acceptance = this.reserve(meta, now)
    if (!acceptance.duplicate) this.commit(meta, now)
    return acceptance
  }

  private ensure(meta: RuntimeEventMeta, now: number): RuntimeSessionRecord {
    const key = keyFor(meta)
    const current = this.sessions.get(key)
    if (current) {
      // 宿主重启后 seq 从 0 重新计数；沿用旧实例的 lastSeq 会把整段新事件判成重复。
      // 已退场实例的迟到事件不得反过来把当前实例切回旧状态。
      if (meta.hostInstanceId && current.hostInstanceId && meta.hostInstanceId !== current.hostInstanceId) {
        if (this.retiredInstances.get(key)?.has(meta.hostInstanceId)) {
          current.lastSeen = now
          return current
        }
        this.retireInstance(current)
        current.lastSeq = undefined
        current.incomplete = undefined
        this.inFlight.delete(key)
        this.inFlightSeqs.delete(key)
        this.recentSeqs.delete(current)
      }
      if (meta.hostInstanceId) current.hostInstanceId = meta.hostInstanceId
      if (meta.sessionId) current.sessionId = meta.sessionId
      current.lastSeen = now
      return current
    }
    const created: RuntimeSessionRecord = {
      key,
      hostId: meta.hostId,
      ...(meta.hostInstanceId ? { hostInstanceId: meta.hostInstanceId } : {}),
      ...(meta.sessionId ? { sessionId: meta.sessionId } : {}),
      capabilities: [],
      lastSeen: now,
    }
    this.sessions.set(key, created)
    return created
  }

  touch(meta: RuntimeEventMeta, command: string, now = Date.now()): RuntimeSessionRecord {
    const record = this.ensure(meta, now)
    record.lastCommand = command
    return record
  }

  bind(
    meta: RuntimeEventMeta,
    info: { label?: string; cwd?: string },
    now = Date.now(),
  ): RuntimeSessionRecord {
    const record = this.touch(meta, 'session_bind', now)
    if (info.label) record.label = info.label
    if (typeof info.cwd === 'string') {
      if (info.cwd) record.cwd = info.cwd
      else delete record.cwd
    }
    return record
  }

  declare(
    meta: RuntimeEventMeta,
    info: { capabilities?: string[]; sdkVersion?: string; label?: string },
    now = Date.now(),
  ): RuntimeSessionRecord {
    const record = this.ensure(meta, now)
    if (info.capabilities) record.capabilities = [...info.capabilities]
    if (info.sdkVersion) record.sdkVersion = info.sdkVersion
    if (info.label) record.label = info.label
    return record
  }

  get(hostId: string, sessionId?: string): RuntimeSessionRecord | undefined {
    return this.sessions.get(`${hostId}:${sessionId ?? ''}`)
  }

  list(now = Date.now(), ttlMs = SESSION_TTL_MS): RuntimeSessionRecord[] {
    for (const [key, record] of this.sessions) {
      if (now - record.lastSeen > ttlMs) {
        this.sessions.delete(key)
        this.inFlight.delete(key)
        this.inFlightSeqs.delete(key)
      }
    }
    return [...this.sessions.values()]
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((record) => ({ ...record, capabilities: [...record.capabilities] }))
  }
}
