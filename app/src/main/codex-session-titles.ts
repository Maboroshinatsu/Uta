import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cleanSessionTitle } from '../shared/session-title'

const MAX_INDEX_BYTES = 4 * 1024 * 1024
const cache = new Map<string, { mtimeMs: number; size: number; titles: Map<string, string> }>()

/** Read the host's title index without opening chat transcripts or guessing by workspace. */
export function readCodexSessionTitle(sessionId: string, directory?: string): string {
  if (!sessionId) return ''
  const file = path.join(directory || process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex'), 'session_index.jsonl')
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile() || stat.size > MAX_INDEX_BYTES) return ''
    const existing = cache.get(file)
    if (existing?.mtimeMs === stat.mtimeMs && existing.size === stat.size) return existing.titles.get(sessionId) ?? ''

    const titles = new Map<string, string>()
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      try {
        const row = JSON.parse(line)
        if (typeof row?.id === 'string' && row.id.length <= 200) {
          titles.set(row.id, cleanSessionTitle(row.thread_name, 'codex', row.id))
        }
      } catch {
        // An incomplete append or malformed row does not hide other sessions.
      }
    }
    if (!existing && cache.size >= 8) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, titles })
    return titles.get(sessionId) ?? ''
  } catch {
    return ''
  }
}
