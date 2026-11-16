import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { decodeChatImage } from './chat-image'
import { MAX_CHAT_COMPLETION_RECEIPTS, MAX_CHAT_HISTORY_MESSAGES, MAX_CHAT_HISTORY_TEXT } from '../shared/chat-history-contracts'
import type { ChatHistoryEntry, ChatHistoryReadResult, ChatHistoryWriteResult } from '../shared/chat-history-contracts'

const MAX_BYTES = 8 * 1024 * 1024
const MAX_RECEIPT_BYTES = 512 * 1024
const EMPTY_DOCUMENT = '{"version":1,"entries":[],"completionReceipts":[]}'

function validEntry(value: unknown): value is ChatHistoryEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (item.media !== undefined) {
    if (!item.media || typeof item.media !== 'object' || item.role !== 'assistant' || item.kind !== undefined || item.delivery !== undefined) return false
    const media = item.media as Record<string, unknown>
    if (decodeChatImage(media.base64)?.mimeType !== media.mimeType || typeof media.mimeType !== 'string') return false
  }
  const optionalString = (v: unknown, max: number) => v === undefined || (typeof v === 'string' && v.length <= max)
  return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 200 &&
    (item.role === 'user' || item.role === 'assistant') &&
    typeof item.text === 'string' && item.text.length <= MAX_CHAT_HISTORY_TEXT &&
    typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) &&
    optionalString(item.hostId, 120) && optionalString(item.sessionId, 200) &&
    (item.kind === undefined ? item.sessionTitle === undefined :
      item.kind === 'completion' && item.role === 'assistant' && item.delivery === undefined && optionalString(item.sessionTitle, 160)) &&
    (item.delivery === undefined || ['pending', 'sent', 'failed', 'unknown'].includes(String(item.delivery))) &&
    (item.deliveryStage === undefined || (item.deliveryStage === 'queued' && item.delivery === 'sent'))
}

function serializeTail(entries: readonly ChatHistoryEntry[], limit: number): string {
  const retained: string[] = []
  for (let index = entries.length - 1; index >= 0; index--) {
    const line = JSON.stringify(entries[index])
    limit -= Buffer.byteLength(line, 'utf8') + (retained.length ? 1 : 0)
    if (limit < 0) break
    retained.push(line)
  }
  return retained.reverse().join(',')
}

/** Fixed per-profile path, fail closed on damaged or newer data. */
export function createChatHistory(directory: string) {
  const file = path.join(directory, 'chat-history.v1.json')
  /** 上一次自己写盘后的文件指纹；未变化时写入无需再整份回读。 */
  let lastWritten: { size: number; mtimeMs: number } | null = null

  function rememberWritten(): void {
    try {
      const stat = fs.lstatSync(file)
      lastWritten = { size: stat.size, mtimeMs: stat.mtimeMs }
    } catch {
      lastWritten = null
    }
  }

  function fileUnchangedSinceWrite(): boolean {
    if (!lastWritten) return false
    try {
      const stat = fs.lstatSync(file)
      return stat.size === lastWritten.size && stat.mtimeMs === lastWritten.mtimeMs
    } catch {
      return false
    }
  }

  function read(): ChatHistoryReadResult {
    try {
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) return { ok: false, error: 'invalid' }
      const raw = fs.readFileSync(file, 'utf8')
      if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) return { ok: false, error: 'invalid' }
      let parsed: unknown
      try { parsed = JSON.parse(raw) } catch { return { ok: false, error: 'invalid' } }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'invalid' }
      const doc = parsed as Record<string, unknown>
      if (typeof doc.version === 'number' && doc.version > 1) return { ok: false, error: 'future-version' }
      const receipts = doc.completionReceipts === undefined ? [] : doc.completionReceipts
      if (doc.version !== 1 || !Array.isArray(doc.entries) || doc.entries.length > MAX_CHAT_HISTORY_MESSAGES || !doc.entries.every(validEntry) ||
        !Array.isArray(receipts) || receipts.length > MAX_CHAT_COMPLETION_RECEIPTS ||
        !receipts.every(entry => validEntry(entry) && entry.kind === 'completion')) {
        return { ok: false, error: 'invalid' }
      }
      lastWritten = { size: stat.size, mtimeMs: stat.mtimeMs }
      return { ok: true, entries: [...doc.entries, ...receipts] }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, entries: [] }
      return { ok: false, error: 'unreadable' }
    }
  }

  function write(value: unknown): ChatHistoryWriteResult {
    if (!Array.isArray(value) || value.length > MAX_CHAT_HISTORY_MESSAGES + MAX_CHAT_COMPLETION_RECEIPTS || !value.every(validEntry)) {
      return { ok: false, error: 'invalid' }
    }
    // 只有文件仍是自己上次写下的那份时才跳过回读；外部改动仍会走完整校验。
    if (!fileUnchangedSinceWrite()) {
      const previous = read()
      if (!previous.ok) return previous
    }
    // Rebuild every entry so unrecognized fields are not persisted.
    const entries = value.map(({ id, role, text, timestamp, hostId, sessionId, kind, sessionTitle, delivery, deliveryStage, media }) => ({
      id, role, text, timestamp,
      ...(hostId ? { hostId } : {}), ...(sessionId ? { sessionId } : {}), ...(delivery ? { delivery } : {}),
      ...(kind ? { kind } : {}), ...(sessionTitle ? { sessionTitle } : {}),
      ...(deliveryStage ? { deliveryStage } : {}),
      ...(media ? { media: { mimeType: media.mimeType, base64: media.base64 } } : {}),
    }))
    const chat = entries.filter(entry => entry.kind !== 'completion').slice(-MAX_CHAT_HISTORY_MESSAGES)
    const receipts = entries.filter(entry => entry.kind === 'completion').slice(-MAX_CHAT_COMPLETION_RECEIPTS)
    // Keep v1 readable on downgrade and reserve independent capacity for each kind.
    const chatJson = serializeTail(chat, MAX_BYTES - MAX_RECEIPT_BYTES - EMPTY_DOCUMENT.length)
    const receiptJson = serializeTail(receipts, MAX_RECEIPT_BYTES)
    const serialized = `{"version":1,"entries":[${chatJson}],"completionReceipts":[${receiptJson}]}`
    const temp = path.join(directory, `.chat-history.${randomUUID()}.tmp`)
    try {
      const fd = fs.openSync(temp, 'wx', 0o600)
      try { fs.writeFileSync(fd, serialized, 'utf8'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      fs.renameSync(temp, file)
      rememberWritten()
      return { ok: true }
    } catch {
      try { fs.unlinkSync(temp) } catch { /* no scratch file or cleanup failed */ }
      return { ok: false, error: 'write-failed' }
    }
  }
  return { read, write }
}
