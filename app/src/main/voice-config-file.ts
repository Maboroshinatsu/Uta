import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export type VoiceConfigFileRead =
  | { kind: 'missing' }
  | { kind: 'ok'; record: Record<string, unknown>; raw: string; encryptedApiKey: string }
  | { kind: 'unreadable'; error: string }
  | { kind: 'corrupt'; error: string }

export interface VoiceConfigWriteOptions {
  /** Raw, parseable old document to preserve as a backup. */
  previousRaw?: string
}

export function shouldBlockVoiceConfigWrite(readError?: string): boolean {
  return readError === 'config-unreadable' || readError === 'config-corrupt'
}

export function shouldPreserveEncryptedApiKey(
  readError: string | undefined,
  explicitKey: boolean,
  sameOwner: boolean,
): boolean {
  return readError === 'decrypt-failed' && !explicitKey && sameOwner
}

/** Read a voice-service config without hiding permission, I/O or JSON failures. */
export function readVoiceConfigFile(file: string): VoiceConfigFileRead {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'unreadable', error: 'read-failed' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'corrupt', error: 'invalid-json' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'corrupt', error: 'invalid-shape' }
  }
  const record = parsed as Record<string, unknown>
  return {
    kind: 'ok',
    record,
    raw,
    encryptedApiKey: typeof record.encryptedApiKey === 'string' ? record.encryptedApiKey : '',
  }
}

/** Replace the config in one rename; keep a backup only when the previous document parsed. */
export function writeVoiceConfigFile(
  file: string,
  payload: Record<string, unknown>,
  options: VoiceConfigWriteOptions = {},
): void {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const suffix = `${process.pid}.${randomUUID()}`
  const tempPath = `${file}.tmp.${suffix}`
  const backupPath = `${file}.bak`
  const backupTempPath = `${backupPath}.tmp.${suffix}`
  const owned: string[] = []

  const writeDurable = (target: string, content: string): void => {
    owned.push(target)
    const fd = fs.openSync(target, 'w', 0o600)
    try {
      fs.writeFileSync(fd, content, 'utf-8')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  }

  try {
    writeDurable(tempPath, JSON.stringify(payload, null, 2) + '\n')
    if (options.previousRaw) {
      writeDurable(backupTempPath, options.previousRaw)
      fs.renameSync(backupTempPath, backupPath)
      owned.pop()
    }
    fs.renameSync(tempPath, file)
    owned.pop()
  } catch (error) {
    for (const target of owned) {
      try { fs.unlinkSync(target) } catch { /* Best-effort cleanup of this attempt only. */ }
    }
    throw error
  }
}
