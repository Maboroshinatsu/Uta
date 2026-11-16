import { defineStore } from 'pinia'
import { ref } from 'vue'
import { MAX_CHAT_COMPLETION_RECEIPTS, MAX_CHAT_HISTORY_MESSAGES, MAX_CHAT_HISTORY_TEXT } from '../../shared/chat-history-contracts'
import type { ChatHistoryEntry, ChatImage, TaskCompletionDetails } from '../../shared/chat-history-contracts'

/** 持久记录和临时状态分开限额，避免状态气泡挤掉记录。 */
const MAX_TRANSIENT_MESSAGES = 100
const MAX_HISTORY_MEDIA_CHARS = 4 * 1024 * 1024

function historyText(text: string): string {
  if (text.length <= MAX_CHAT_HISTORY_TEXT) return text
  const marker = '\n[记录已截断]'
  return text.slice(0, MAX_CHAT_HISTORY_TEXT - marker.length).replace(/[\uD800-\uDBFF]$/, '') + marker
}

export interface MessageSource { hostId?: string; sessionId?: string }
export interface TaskCompletionSource extends MessageSource, TaskCompletionDetails {}

export interface TextMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  streaming: boolean
  timestamp: number
  type: 'text'
  /** 流式分组用；只在 streaming 中的消息上匹配，后端缺 request_id 时不会把所有回复并进一条 */
  requestId?: string
  hostId?: string
  sessionId?: string
  delivery?: ChatHistoryEntry['delivery']
  deliveryStage?: ChatHistoryEntry['deliveryStage']
  restored?: boolean
}

export interface CompletionMessage extends MessageSource {
  id: string
  role: 'assistant'
  text: string
  timestamp: number
  type: 'completion'
  sessionTitle?: string
}

export interface EmojiMessage extends MessageSource {
  id: string
  role: 'assistant'
  image: ChatImage
  description: string
  timestamp: number
  type: 'emoji'
  restored?: boolean
}

/** 状态解说气泡：与正式回复分开，避免把“我来看看”混进聊天正文 */
export interface StatusMessage {
  id: string
  role: 'assistant'
  text: string
  timestamp: number
  type: 'status'
  ttlMs: number
}

/** 宿主在等用户选择：用重点色气泡，和普通消息明确区分 */
export interface ChoiceMessage {
  id: string
  role: 'assistant'
  text: string
  timestamp: number
  type: 'choice'
  ttlMs: number
}

export type ChatMessage = TextMessage | CompletionMessage | EmojiMessage | StatusMessage | ChoiceMessage

export function isHistoryMessage(message: ChatMessage): message is TextMessage | EmojiMessage {
  return message.type === 'text' || message.type === 'emoji'
}

/** Completion receipts remain private so reconnect/restart cannot ring the same event again. */
function isPersistedMessage(message: ChatMessage): message is TextMessage | CompletionMessage | EmojiMessage {
  return isHistoryMessage(message) || message.type === 'completion'
}

let idSeq = 0
/** Date.now() 同毫秒内会碰撞（连发表情包、快速输入），补个单调序号保证 :key 唯一 */
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++idSeq}`
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([])
  const historyState = ref<'loading' | 'ready' | 'error' | 'unavailable'>('loading')
  const historyMessage = ref('')
  let initialized = false
  let clearing = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let writeChain: Promise<void> = Promise.resolve()

  function historyEntries(): ChatHistoryEntry[] {
    return messages.value.filter(isPersistedMessage).map(m => ({
      id: m.id, role: m.role, text: historyText(m.type === 'emoji' ? m.description : m.text), timestamp: m.timestamp,
      ...(m.hostId ? { hostId: m.hostId } : {}),
      ...(m.sessionId ? { sessionId: m.sessionId } : {}),
      ...(m.type === 'completion' ? {
        kind: 'completion' as const, ...(m.sessionTitle ? { sessionTitle: m.sessionTitle } : {}),
      } : m.type === 'emoji' ? { media: m.image } : {
        ...(m.delivery ? { delivery: m.delivery } : {}),
        ...(m.deliveryStage ? { deliveryStage: m.deliveryStage } : {}),
      }),
    }))
  }

  async function initializeHistory(): Promise<void> {
    if (typeof window === 'undefined' || !window.utaAPI?.readChatHistory || !window.utaAPI?.writeChatHistory) {
      historyState.value = 'unavailable'
      return
    }
    historyState.value = 'loading'
    try {
      await writeChain
      const result = await window.utaAPI.readChatHistory()
      if (!result.ok) {
        historyState.value = 'error'
        historyMessage.value = '消息记录无法读取，原文件已保留；新消息暂只在本次显示。'
        return
      }
      const currentIds = new Set(messages.value.map(m => m.id))
      const restored = result.entries.filter(m => !currentIds.has(m.id)).map((m): TextMessage | CompletionMessage | EmojiMessage =>
        m.kind === 'completion'
          ? { ...m, role: 'assistant', type: 'completion' }
          : m.media ? { id: m.id, role: 'assistant', type: 'emoji', description: m.text, image: m.media,
              hostId: m.hostId, sessionId: m.sessionId, timestamp: m.timestamp, restored: true }
          : { ...m, type: 'text', streaming: false, restored: true,
              ...(m.delivery === 'pending' ? { delivery: 'unknown' as const } : {}) },
      )
      messages.value = [...restored, ...messages.value]
      trimMessages()
      initialized = true
      historyState.value = 'ready'
      historyMessage.value = ''
      scheduleHistorySave()
    } catch {
      historyState.value = 'error'
      historyMessage.value = '消息记录无法读取，原文件已保留；新消息暂只在本次显示。'
    }
  }

  function saveSnapshot(entries: ChatHistoryEntry[]): Promise<boolean> {
    let success = false
    writeChain = writeChain.then(async () => {
      try {
        const result = await window.utaAPI?.writeChatHistory?.(entries)
        if (result?.ok) { success = true; return }
      } catch { /* show a recoverable error below */ }
      historyState.value = 'error'
      historyMessage.value = '消息记录保存失败，已有文件已保留；请检查后重试。'
    })
    return writeChain.then(() => success)
  }

  function scheduleHistorySave(): void {
    if (!initialized || clearing || historyState.value !== 'ready') return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void saveSnapshot(historyEntries())
    }, 400)
  }

  async function flushHistory(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null }
    if (initialized && historyState.value === 'ready' && !clearing) await saveSnapshot(historyEntries())
    await writeChain
  }

  async function clearHistory(): Promise<boolean> {
    if (!initialized || historyState.value !== 'ready' || clearing) return false
    if (timer) { clearTimeout(timer); timer = null }
    clearing = true
    const ids = new Set(messages.value.map(m => m.id))
    const ok = await saveSnapshot([])
    if (ok) messages.value = messages.value.filter(m => !ids.has(m.id))
    clearing = false
    if (ok && messages.value.length) scheduleHistorySave()
    return ok
  }

  function trimMessages(): void {
    let historyCount = 0, completionCount = 0, transientCount = 0
    let mediaChars = 0
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const message = messages.value[i]
      if (message.type === 'emoji') {
        if (mediaChars + message.image.base64.length > MAX_HISTORY_MEDIA_CHARS) {
          messages.value.splice(i, 1)
          continue
        }
        mediaChars += message.image.base64.length
      }
      if (message.type === 'completion') {
        if (++completionCount > MAX_CHAT_COMPLETION_RECEIPTS) messages.value.splice(i, 1)
      } else if (isHistoryMessage(message)) {
        if (++historyCount > MAX_CHAT_HISTORY_MESSAGES) messages.value.splice(i, 1)
      } else {
        if (++transientCount > MAX_TRANSIENT_MESSAGES) messages.value.splice(i, 1)
      }
    }
  }
  function push(msg: ChatMessage) { messages.value.push(msg); trimMessages() }

  function addUserMessage(text: string, source?: MessageSource): string {
    const id = nextId('user')
    push({
      id,
      role: 'user',
      text,
      streaming: false,
      timestamp: Date.now(),
      type: 'text',
      ...source,
      delivery: 'pending',
    })
    scheduleHistorySave()
    return id
  }

  function setDelivery(id: string, delivery: TextMessage['delivery'], source?: MessageSource, stage?: TextMessage['deliveryStage']): void {
    const message = messages.value.find((m): m is TextMessage => m.id === id && m.type === 'text')
    if (!message) return
    message.delivery = delivery
    message.deliveryStage = delivery === 'sent' ? stage : undefined
    if (source?.hostId) message.hostId = source.hostId
    if (source?.sessionId) message.sessionId = source.sessionId
    scheduleHistorySave()
  }

  function findStreamingMessage(requestId: string): TextMessage | undefined {
    return messages.value.find(
      (m): m is TextMessage =>
        m.type === 'text' && m.role === 'assistant' && m.streaming && m.requestId === requestId,
    )
  }

  function appendChatText(delta: string, requestId: string, replace = false, source?: MessageSource) {
    const existing = findStreamingMessage(requestId)
    if (existing) {
      if (replace) {
        if (delta) { existing.text = delta; scheduleHistorySave() }
        return
      }
      if (!delta) return
      // 兼容少数宿主把“累计全文”当增量发送的情况，避免气泡重复叠加
      if (delta.startsWith(existing.text) && delta.length > existing.text.length) {
        existing.text = delta
        scheduleHistorySave()
        return
      }
      if (delta.length >= 8 && (existing.text.startsWith(delta) || existing.text.endsWith(delta))) {
        return
      }
      existing.text += delta
    } else {
      if (!delta) return
      push({
        id: nextId('assistant'),
        requestId,
        role: 'assistant',
        text: delta,
        streaming: true,
        timestamp: Date.now(),
        type: 'text',
        ...source,
      })
    }
    scheduleHistorySave()
  }

  function finishChatStream(requestId: string) {
    const msg = findStreamingMessage(requestId)
    if (msg) msg.streaming = false
    scheduleHistorySave()
  }

  function finishAllStreams() {
    for (const message of messages.value) {
      if (message.type === 'text') message.streaming = false
    }
    scheduleHistorySave()
  }

  function showChatMessage(text: string, source?: MessageSource) {
    push({
      id: nextId('assistant'),
      role: 'assistant',
      text,
      streaming: false,
      timestamp: Date.now(),
      type: 'text',
      ...source,
    })
    scheduleHistorySave()
  }

  function showStatusMessage(text: string, ttlMs = 4500) {
    const clean = String(text || '').trim()
    if (!clean) return
    push({
      id: nextId('status'),
      role: 'assistant',
      text: clean,
      timestamp: Date.now(),
      type: 'status',
      ttlMs: Math.max(1500, Math.min(12000, Math.round(ttlMs))),
    })
  }

  function recordTaskCompletion(source: TaskCompletionSource): boolean {
    const { hostId, sessionId, sessionTitle, eventKey } = source
    const id = eventKey ? `completion-${eventKey}` : nextId('completion')
    if (eventKey && messages.value.some(message => message.id === id)) return false
    push({ id, role: 'assistant', type: 'completion', text: '宿主任务已完成', timestamp: Date.now(), hostId, sessionId, sessionTitle })
    scheduleHistorySave()
    return true
  }

  function showChoiceMessage(text: string, ttlMs = 15000) {
    const clean = String(text || '').trim()
    if (!clean) return
    push({
      id: nextId('choice'),
      role: 'assistant',
      text: clean,
      timestamp: Date.now(),
      type: 'choice',
      ttlMs: Math.max(5000, Math.min(30000, Math.round(ttlMs))),
    })
  }

  function addChatImage(image: ChatImage, description: string, source?: MessageSource) {
    push({
      id: nextId('emoji'),
      role: 'assistant',
      image,
      description,
      timestamp: Date.now(),
      type: 'emoji',
      ...source,
    })
    scheduleHistorySave()
  }

  function clear() {
    messages.value = []
  }

  return {
    messages,
    historyState,
    historyMessage,
    initializeHistory,
    flushHistory,
    clearHistory,
    addUserMessage,
    setDelivery,
    addChatImage,
    appendChatText,
    finishChatStream,
    finishAllStreams,
    showChatMessage,
    showStatusMessage,
    recordTaskCompletion,
    showChoiceMessage,
    clear,
  }
})
