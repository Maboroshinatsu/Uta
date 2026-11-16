import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SettingsService, SettingsWriteResult } from '../../shared/settings-contracts'
import { createSettingsStore } from './index'

export const AUTHORITY_MARKER = 'settings-authority.v1.json'
export type StableAuthority = 'legacy' | 'accepted' | 'blocked'

/** Fixed local marker only; missing, invalid and future markers have different meanings. */
export async function inspectStableAuthority(directory: string): Promise<StableAuthority> {
  const file = path.join(directory, AUTHORITY_MARKER)
  try {
    const stat = await fs.lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return 'blocked'
    const handle = await fs.open(file, 'r')
    try {
      const actual = await handle.stat()
      if (actual.ino !== stat.ino || actual.dev !== stat.dev || actual.size !== stat.size) return 'blocked'
      const bytes = Buffer.alloc(4097)
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
      if (bytesRead !== stat.size || bytesRead > 4096) return 'blocked'
      const marker = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'))
      return marker && Object.keys(marker).sort().join(',') === 'completedAt,firstRevision,scope,version' &&
        marker.version === 1 && marker.scope === 'public-preferences' &&
        Number.isSafeInteger(marker.firstRevision) && marker.firstRevision >= 0 &&
        typeof marker.completedAt === 'string' && /^\d{4}-\d\d-\d\dT/.test(marker.completedAt) &&
        Number.isFinite(Date.parse(marker.completedAt)) ? 'accepted' : 'blocked'
    } finally { await handle.close() }
  } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'legacy' : 'blocked' }
}

/** A pending store is deliberately separate from the running legacy authority. */
export class StableSettingsMigration {
  private pending: Promise<SettingsService> | null = null
  private closed = false
  private accepted = false
  private accepting: Promise<SettingsWriteResult & { restartRequired?: boolean }> | null = null
  constructor(private readonly directory: string) {}

  isAccepted(): boolean { return this.accepted }
  async peekStore(): Promise<SettingsService | null> { return this.closed ? null : await this.pending?.catch(() => null) ?? null }

  async getStore(): Promise<SettingsService | null> {
    if (this.closed || this.accepted || await inspectStableAuthority(this.directory) !== 'legacy' || this.closed || this.accepted) return null
    this.pending ??= createSettingsStore(this.directory).catch(error => { this.pending = null; throw error })
    return this.pending
  }

  accept(result: SettingsWriteResult): Promise<SettingsWriteResult & { restartRequired?: boolean }> {
    if (!result.ok) return Promise.resolve(result)
    if (this.accepting) return Promise.resolve({ ok: false, code: 'store-blocked', currentRevision: null })
    const finish = async (): Promise<SettingsWriteResult & { restartRequired?: boolean }> => {
      const store = this.pending && await this.pending
      if (!store || this.closed || this.accepted || await inspectStableAuthority(this.directory) !== 'legacy') return { ok: false, code: 'store-blocked', currentRevision: null }
      const persisted = await store.ensurePersisted?.(result.document.revision)
      if (!persisted?.ok) return persisted ?? { ok: false, code: 'io-error', currentRevision: null }
      const temporary = path.join(this.directory, `${AUTHORITY_MARKER}.${randomUUID()}.tmp`)
      let owned = false
      try {
        const handle = await fs.open(temporary, 'wx')
        owned = true
        try {
          await handle.writeFile(JSON.stringify({ version: 1, scope: 'public-preferences', firstRevision: persisted.document.revision, completedAt: new Date().toISOString() }))
          await handle.sync()
        } finally { await handle.close() }
        // link is atomic and refuses to replace an existing marker, including a future one.
        await fs.link(temporary, path.join(this.directory, AUTHORITY_MARKER))
        this.accepted = true
        return { ...persisted, restartRequired: true }
      } catch { return { ok: false, code: 'io-error', currentRevision: persisted.document.revision } }
      finally { if (owned) await fs.unlink(temporary).catch(() => {}) }
    }
    this.accepting = finish().finally(() => { this.accepting = null })
    return this.accepting
  }

  async close(): Promise<void> {
    this.closed = true
    await this.accepting?.catch(() => {})
    const store = await this.pending?.catch(() => null)
    await store?.close()
  }
}
