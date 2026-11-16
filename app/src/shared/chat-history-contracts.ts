export const MAX_CHAT_HISTORY_MESSAGES = 1000
export const MAX_CHAT_COMPLETION_RECEIPTS = 1000
export const MAX_CHAT_HISTORY_TEXT = 50000

export interface ChatImage {
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  base64: string
}

export interface ChatHistoryEntry {
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: number
  hostId?: string
  sessionId?: string
  /** Unmarked version-one entries are chat text. Older readers display the completion text. */
  kind?: 'completion'
  sessionTitle?: string
  media?: ChatImage
  delivery?: 'pending' | 'sent' | 'failed' | 'unknown'
  /** Older readers can still read delivery=sent and ignore this optional detail. */
  deliveryStage?: 'queued'
}

/** Renderer-only metadata resolved by the main process for a completion event. */
export interface TaskCompletionDetails {
  sessionTitle?: string
  eventKey?: string
}

export type ChatHistoryReadResult =
  | { ok: true; entries: ChatHistoryEntry[] }
  | { ok: false; error: 'unreadable' | 'invalid' | 'future-version' }

export type ChatHistoryWriteResult =
  | { ok: true }
  | { ok: false; error: 'unreadable' | 'invalid' | 'future-version' | 'write-failed' }
