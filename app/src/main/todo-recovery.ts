import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { validProject } from './todo-store'
import { validDailyItem } from './daily-todo-store'

type Kind = 'project' | 'daily'
const FILES: Record<Kind, string> = { project: 'todo.v1.json', daily: 'daily-todos.v1.json' }
const LIMITS: Record<Kind, number> = { project: 2 * 1024 * 1024, daily: 1024 * 1024 }
const MAX_ORIGINAL_BYTES = 8 * 1024 * 1024

function validDocument(kind: Kind, text: string): { count: number } | null {
  try {
    if (Buffer.byteLength(text, 'utf8') > LIMITS[kind]) return null
    const doc = JSON.parse(text)
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.version !== 1) return null
    if (kind === 'project') {
      if (!Array.isArray(doc.projects) || doc.projects.length > 100 || !doc.projects.every(validProject)) return null
      return { count: doc.projects.reduce((n: number, p: { items: unknown[] }) => n + p.items.length, 0) }
    }
    if (!Array.isArray(doc.items) || doc.items.length > 200 || !doc.items.every(validDailyItem)) return null
    if (doc.reminderSound !== undefined && typeof doc.reminderSound !== 'boolean') return null
    return { count: doc.items.length }
  } catch { return null }
}

/** Validate and snapshot a single fixed profile file. No caller-supplied paths. */
export function createTodoRecovery(directory: string) {
  let pending: { token: string; kind: Kind; text: string; digest: string } | null = null
  function readOriginal(kind: unknown): { ok: true; bytes: Buffer; filename: string } | { ok: false } {
    if (kind !== 'project' && kind !== 'daily') return { ok: false }
    try {
      const file = path.join(directory, FILES[kind])
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ORIGINAL_BYTES) return { ok: false }
      const bytes = fs.readFileSync(file)
      if (bytes.length > MAX_ORIGINAL_BYTES) return { ok: false }
      return { ok: true, bytes, filename: FILES[kind] }
    } catch { return { ok: false } }
  }
  function current(kind: Kind): Buffer | null {
    const file = path.join(directory, FILES[kind])
    try {
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ORIGINAL_BYTES) throw new Error('unreadable')
      const bytes = fs.readFileSync(file)
      if (bytes.length > MAX_ORIGINAL_BYTES) throw new Error('unreadable')
      try {
        const doc = JSON.parse(bytes.toString('utf8'))
        if (typeof doc?.version === 'number' && doc.version > 1) throw new Error('future-version')
      } catch (error) {
        if ((error as Error).message === 'future-version') throw error
      }
      return bytes
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  function digest(bytes: Buffer | null): string {
    return bytes === null ? 'missing' : createHash('sha256').update(bytes).digest('hex')
  }
  function preview(kind: unknown, text: unknown) {
    pending = null
    if ((kind !== 'project' && kind !== 'daily') || typeof text !== 'string') return { ok: false as const, error: 'invalid' }
    const parsed = validDocument(kind, text)
    if (!parsed) return { ok: false as const, error: 'invalid' }
    try {
      const token = randomUUID()
      pending = { token, kind, text, digest: digest(current(kind)) }
      return { ok: true as const, token, count: parsed.count }
    } catch { return { ok: false as const, error: 'unreadable' } }
  }
  function apply(token: unknown) {
    const plan = pending
    pending = null
    if (!plan || token !== plan.token) return { ok: false as const, error: 'stale' }
    const file = path.join(directory, FILES[plan.kind])
    const temp = path.join(directory, `.todo-restore-${randomUUID()}.tmp`)
    try {
      const original = current(plan.kind)
      if (digest(original) !== plan.digest) return { ok: false as const, error: 'stale' }
      if (original !== null) {
        const backups = path.join(directory, 'todo-recovery-backups')
        try { fs.mkdirSync(backups) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
        const stat = fs.lstatSync(backups)
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe-backup')
        const fd = fs.openSync(path.join(backups, `${plan.kind}-${randomUUID()}.bin`), 'wx', 0o600)
        try { fs.writeFileSync(fd, original); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      }
      const fd = fs.openSync(temp, 'wx', 0o600)
      try { fs.writeFileSync(fd, plan.text, 'utf8'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      if (digest(current(plan.kind)) !== plan.digest) return { ok: false as const, error: 'stale' }
      fs.renameSync(temp, file)
      return { ok: true as const, kind: plan.kind }
    } catch { return { ok: false as const, error: 'write-failed' } }
    finally { try { fs.unlinkSync(temp) } catch { /* renamed or never created */ } }
  }
  return { preview, apply, readOriginal }
}
