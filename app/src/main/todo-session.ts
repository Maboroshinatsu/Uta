import path from 'node:path'
import type { HostSessionRecord } from './host-bridge'

/** Fill a missing directory only from another record for the same session. */
export function completeTodoSession(
  session: HostSessionRecord | null,
  fallback: HostSessionRecord | null,
  now: number,
): HostSessionRecord | null {
  if (!session) return fallback && now - fallback.updatedAt >= 0 && now - fallback.updatedAt < 30 * 60_000 ? fallback : null
  if (session.cwd || !fallback || fallback.host !== session.host || fallback.sessionId !== session.sessionId ||
      now - fallback.updatedAt < 0 || now - fallback.updatedAt >= 30 * 60_000) return session
  return { ...session, cwd: fallback.cwd }
}

export function todoProjectMatchesSession(projectPath: string, session: HostSessionRecord | null): boolean {
  if (!projectPath || !session?.sessionId || !session.cwd) return false
  const normalize = (value: string) => {
    const resolved = path.resolve(value).replace(/\\/g, '/')
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  return normalize(projectPath) === normalize(session.cwd)
}
