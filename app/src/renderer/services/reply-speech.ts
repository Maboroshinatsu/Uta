/** 与气泡一致：兼容宿主发送累计全文，避免 TTS 重复朗读。 */
export function isSimilarFinalReply(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const head = 16
  if (a.length < head || b.length < head) return false
  return a.startsWith(b.slice(0, head)) || b.startsWith(a.slice(0, head))
}

/** Qoder 的对话回顾/内部记录是 JSON，不属于聊天正文。 */
export function isRecapPayload(text: string): boolean {
  const trimmed = String(text || '').trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const parsed = JSON.parse(trimmed)
    return (
      !!parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.prototype.hasOwnProperty.call(parsed, 'recap')
    )
  } catch {
    return false
  }
}

export interface ReplySpeechTrackerOptions {
  summarize: (text: string, maxChars?: number) => string
  now?: () => number
  dedupeMs?: number
}

/**
 * 保存流式回复的原文缓冲，并用原文/可朗读摘要两种形式对最终回复判重。
 * 重复命中不刷新时间戳，避免 hook 与直连 CLI 交替重发时无限延长去重窗口。
 */
export class ReplySpeechTracker {
  private readonly buffers = new Map<string, string>()
  private readonly summarize: ReplySpeechTrackerOptions['summarize']
  private readonly now: () => number
  private readonly dedupeMs: number
  private lastRaw = ''
  private lastClean = ''
  private lastAt = 0

  constructor(options: ReplySpeechTrackerOptions) {
    this.summarize = options.summarize
    this.now = options.now ?? Date.now
    this.dedupeMs = options.dedupeMs ?? 12_000
  }

  get lastFinalAt(): number {
    return this.lastAt
  }

  resetDedupe(): void {
    this.lastRaw = ''
    this.lastClean = ''
    this.lastAt = 0
  }

  consume(text: string): boolean {
    const raw = String(text || '').replace(/\s+/g, ' ').trim()
    if (!raw) return false
    const clean = this.summarize(text, 240)
    const now = this.now()
    const inWindow = this.lastAt > 0 && now - this.lastAt < this.dedupeMs
    const duplicate =
      inWindow &&
      ((this.lastRaw && isSimilarFinalReply(raw, this.lastRaw)) ||
        (this.lastClean && clean && isSimilarFinalReply(clean, this.lastClean)) ||
        (this.lastRaw && clean && isSimilarFinalReply(clean, this.lastRaw)) ||
        (this.lastClean && isSimilarFinalReply(raw, this.lastClean)))
    if (duplicate) return false
    this.lastRaw = raw
    this.lastClean = clean
    this.lastAt = now
    return true
  }

  appendBuffer(key: string, text: string): void {
    if (!text) return
    const previous = this.buffers.get(key) || ''
    if (text.startsWith(previous) && text.length > previous.length) {
      this.buffers.set(key, text)
      return
    }
    if (text.length >= 8 && (previous.startsWith(text) || previous.endsWith(text))) return
    this.buffers.set(key, previous + text)
  }

  setBuffer(key: string, text: string): void {
    if (text) this.buffers.set(key, text)
    else this.buffers.delete(key)
  }

  getBuffer(key: string): string | undefined {
    return this.buffers.get(key)
  }

  takeBuffer(key: string): string | undefined {
    const value = this.buffers.get(key)
    this.buffers.delete(key)
    return value
  }

  dropBuffer(key: string): void {
    this.buffers.delete(key)
  }

  clearBuffers(): void {
    this.buffers.clear()
  }
}

/**
 * 根据文本分析推断情绪风格（如疑问/喜悦/思考/专注/致歉等）
 */
export function inferSpeechStyleFromText(text: string): string {
  if (!text) return ''
  const t = text.trim()
  if (/[?？]/.test(t) || /(为[什么|何]|怎么|难道|是否|好奇|探索|咦|哎呀)/.test(t)) {
    return 'curious'
  }
  if (/(好耶|太棒|真棒|哈哈|开心|不错|成功|恭喜|厉害|加油)/.test(t) || /[!！]{2,}/.test(t)) {
    return 'cheerful'
  }
  if (/(思考|分析|推导|根据|结论|推测|原因在于|值得注意|算法|架构)/.test(t)) {
    return 'thinking'
  }
  if (/(正在处理|正在执行|稍后|请稍候|已记录|已确认|检索中)/.test(t)) {
    return 'focused'
  }
  if (/(抱歉|对不起|遗憾|不好意思|失误)/.test(t)) {
    return 'sad'
  }
  return ''
}

/**
 * 综合宿主语气标记、自动风格开关与本地推断，解析最终传递给 TTS 的风格
 */
export function resolveSpeechStyle(
  text: string,
  hostEmotion?: string,
  autoStyleEnabled = true,
  fallbackStyle = '',
): string {
  if (!autoStyleEnabled) {
    return (fallbackStyle || '').trim()
  }
  if (hostEmotion && typeof hostEmotion === 'string' && hostEmotion.trim()) {
    return hostEmotion.trim()
  }
  const inferred = inferSpeechStyleFromText(text)
  if (inferred) return inferred
  return (fallbackStyle || '').trim()
}
