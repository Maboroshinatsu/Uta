export interface SessionMetaLike {
  hostId?: string
  sessionId?: string
  legacy?: boolean
}

export interface SessionScopeDecision {
  allowed: boolean
  /** Kept for API compatibility; incoming events are host-scoped, not session-scoped. */
  bound: boolean
}

/**
 * One pet belongs to one agent platform. Every session of that platform may
 * drive it; sessions from any other platform are ignored.
 */
export class SessionScope {
  bind(_hostId: string | undefined, _sessionId: string | null | undefined): boolean {
    return false
  }

  allows(activeHostId: string, meta?: SessionMetaLike): SessionScopeDecision {
    if (!meta || meta.legacy || !meta.hostId) return { allowed: true, bound: false }
    return { allowed: meta.hostId === activeHostId, bound: false }
  }

  reset(): void {
    /* no session state to reset */
  }

  snapshot(): Record<string, string> {
    return {}
  }
}
