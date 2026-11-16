import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export interface HostSessionPreference {
  sessionId: string
  cwd: string
  updatedAt: number
}

interface PreferenceFile {
  version: 1
  hosts: Record<string, HostSessionPreference>
}

function preferencePath(runtimeDir: string): string {
  return path.join(runtimeDir, 'host-session-preference.json')
}

function sanitize(value: unknown): HostSessionPreference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.sessionId !== 'string' || !record.sessionId || record.sessionId.length > 200) return null
  return {
    sessionId: record.sessionId,
    cwd: typeof record.cwd === 'string' ? record.cwd.slice(0, 500) : '',
    updatedAt: Number.isSafeInteger(record.updatedAt) && (record.updatedAt as number) > 0
      ? record.updatedAt as number
      : Date.now(),
  }
}

export function readHostSessionPreferences(runtimeDir: string): Record<string, HostSessionPreference> {
  try {
    const raw = JSON.parse(fs.readFileSync(preferencePath(runtimeDir), 'utf-8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const hosts = (raw as Record<string, unknown>).hosts
    if (!hosts || typeof hosts !== 'object' || Array.isArray(hosts)) return {}
    const result: Record<string, HostSessionPreference> = {}
    for (const [hostId, value] of Object.entries(hosts as Record<string, unknown>)) {
      if (!/^[A-Za-z0-9._:-]{1,120}$/.test(hostId)) continue
      const preference = sanitize(value)
      if (preference) result[hostId] = preference
    }
    return result
  } catch {
    return {}
  }
}

export function readHostSessionPreference(runtimeDir: string, hostId: string): HostSessionPreference | null {
  return readHostSessionPreferences(runtimeDir)[hostId] ?? null
}

/** 锁定的会话不在非空列表里时保留偏好（不自动改投），但要让界面明确失效。 */
export function resolveHostSessionSelection(
  sessionIds: readonly string[],
  preference: HostSessionPreference | null,
): { selectedSessionId: string | null; selectionExpired: boolean } {
  const selectedSessionId = preference && sessionIds.includes(preference.sessionId)
    ? preference.sessionId
    : null
  return {
    selectedSessionId,
    selectionExpired: !!preference && sessionIds.length > 0 && selectedSessionId === null,
  }
}

export function writeHostSessionPreference(
  runtimeDir: string,
  hostId: string,
  preference: HostSessionPreference | null,
): void {
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(hostId)) throw new Error('Invalid host id')
  const hosts = readHostSessionPreferences(runtimeDir)
  if (preference) {
    const cleaned = sanitize(preference)
    if (!cleaned) throw new Error('Invalid session preference')
    hosts[hostId] = cleaned
  } else {
    delete hosts[hostId]
  }
  fs.mkdirSync(runtimeDir, { recursive: true })
  const file = preferencePath(runtimeDir)
  const temp = `${file}.tmp.${process.pid}.${randomUUID()}`
  const serialized = JSON.stringify({ version: 1, hosts } satisfies PreferenceFile, null, 2) + '\n'
  try {
    const fd = fs.openSync(temp, 'w', 0o600)
    try {
      fs.writeFileSync(fd, serialized, 'utf-8')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(temp, file)
  } catch (error) {
    try { fs.unlinkSync(temp) } catch { /* ignore */ }
    throw error
  }
}
