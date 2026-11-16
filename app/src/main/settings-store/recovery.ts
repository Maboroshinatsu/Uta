import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { SETTINGS_SCHEMA_VERSION, type SettingsDocument } from '../../shared/settings-contracts'
import type { SettingsRecoveryPreview, SettingsRecoveryResult } from '../../shared/settings-recovery-contracts'
import { validateDocument, MAX_JSON_SIZE_BYTES } from './validator'
import { MAIN_SETTINGS_FILENAME, BACKUP_SETTINGS_FILENAME } from './atomic-writer'

export interface RecoveryIo {
  read(file: string, limit: number): Promise<Buffer | null>
  writeExclusive(file: string, bytes: Buffer): Promise<void>
  rename(from: string, to: string): Promise<void>
  unlink(file: string): Promise<void>
}
export const recoveryIo: RecoveryIo = {
  async read(file, limit) {
    let info
    try { info = await fs.lstat(file) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('unreadable-file')
    const handle = await fs.open(file, 'r')
    try {
      const opened = await handle.stat()
      if (!opened.isFile() || opened.ino !== info.ino || opened.dev !== info.dev || opened.size > limit) throw new Error('changed-file')
      const bytes = Buffer.alloc(limit + 1)
      let count = 0
      while (count < bytes.length) { const read = await handle.read(bytes, count, bytes.length - count, count); if (!read.bytesRead) break; count += read.bytesRead }
      if (count > limit) throw new Error('oversized-file')
      return bytes.subarray(0, count)
    } finally { await handle.close() }
  },
  async writeExclusive(file, bytes) {
    const handle = await fs.open(file, 'wx')
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  },
  rename: (from, to) => fs.rename(from, to),
  unlink: file => fs.unlink(file),
}
const digest = (bytes: Buffer | null) => bytes === null ? 'missing' : createHash('sha256').update(bytes).digest('hex')
class FutureSettingsSchema extends Error {}

/** Fixed profile files only. Invalid originals remain byte-identical, including non-UTF8 content. */
export class SettingsRecovery {
  private readonly io: RecoveryIo
  private pending: { token: string; mainDigest: string; backupDigest: string; expires: number } | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(private readonly directory: string, io: Partial<RecoveryIo> = {}) { this.io = { ...recoveryIo, ...io } }
  private async readFiles() {
    const main = await this.io.read(path.join(this.directory, MAIN_SETTINGS_FILENAME), 4 * MAX_JSON_SIZE_BYTES)
    const backup = await this.io.read(path.join(this.directory, BACKUP_SETTINGS_FILENAME), MAX_JSON_SIZE_BYTES)
    if (main) {
      let parsed: unknown
      try { parsed = JSON.parse(main.toString('utf8').replace(/^\uFEFF/, '')) } catch { /* Invalid bytes are retained as an original. */ }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
        typeof (parsed as { schemaVersion?: unknown }).schemaVersion === 'number' &&
        (parsed as { schemaVersion: number }).schemaVersion > SETTINGS_SCHEMA_VERSION) throw new FutureSettingsSchema()
    }
    if (!backup) throw new Error('no-backup')
    const valid = validateDocument(JSON.parse(backup.toString('utf8')))
    if (!valid.ok) throw new Error('invalid-backup')
    return { main, backup, document: valid.value }
  }
  public clear(): void { this.pending = null; if (this.timer) clearTimeout(this.timer); this.timer = null }
  public async preview(): Promise<SettingsRecoveryPreview> {
    this.clear()
    try {
      const files = await this.readFiles()
      const token = randomUUID()
      this.pending = { token, mainDigest: digest(files.main), backupDigest: digest(files.backup), expires: Date.now() + 120000 }
      this.timer = setTimeout(() => this.clear(), 120000); this.timer.unref?.()
      return { available: true, token, backupRevision: files.document.revision, themeMode: files.document.values.themeMode, ttsEnabled: files.document.values.ttsEnabled }
    } catch (error) { return { available: false, reason: error instanceof FutureSettingsSchema ? 'future-schema' : 'no-backup' } }
  }
  public async restore(token: string): Promise<(SettingsRecoveryResult & { document?: SettingsDocument })> {
    const review = this.pending
    if (!review || review.token !== token || Date.now() >= review.expires) return { ok: false, code: 'preview-expired' }
    this.clear()
    const owned = new Set<string>()
    try {
      const files = await this.readFiles()
      if (digest(files.main) !== review.mainDigest || digest(files.backup) !== review.backupDigest) return { ok: false, code: 'changed' }
      const tag = `${Date.now()}.${randomUUID()}`
      const archive = path.join(this.directory, `${MAIN_SETTINGS_FILENAME}.recovery-original.${tag}.bin`)
      const temp = path.join(this.directory, `${MAIN_SETTINGS_FILENAME}.recovery-tmp.${tag}`)
      const write = async (file: string, bytes: Buffer) => {
        owned.add(file)
        try { await this.io.writeExclusive(file, bytes) }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') owned.delete(file); throw error }
      }
      if (files.main !== null) await write(archive, files.main)
      await write(temp, files.backup)
      const current = await this.readFiles()
      if (digest(current.main) !== review.mainDigest || digest(current.backup) !== review.backupDigest) return { ok: false, code: 'changed' }
      await this.io.rename(temp, path.join(this.directory, MAIN_SETTINGS_FILENAME))
      owned.delete(temp); owned.delete(archive)
      return { ok: true, retainedOriginal: files.main !== null, document: files.document }
    } catch (error) { return { ok: false, code: error instanceof FutureSettingsSchema ? 'future-schema' : 'unavailable' } }
    finally { for (const file of owned) await this.io.unlink(file).catch(() => {}) }
  }
}
