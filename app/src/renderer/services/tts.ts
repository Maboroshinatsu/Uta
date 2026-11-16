/**
 * 桌宠语音播报。
 *
 * 两种提供方：
 * - system：浏览器/系统语音（零依赖，离线可用）；
 * - http：本机 TTS 桥（例如 MaiBot 的 GPT-SoVITS / cloud bridge，127.0.0.1），
 *   主进程负责请求，渲染层只播放返回的音频。
 *
 * 默认关闭（设置里主动开启），避免首次启动或夜间突然出声。
 */

import { TtsMouthTracker, buildAmplitudeEnvelope } from './mouth-motion'

export type TtsKind = 'narration' | 'reply'

export interface TtsSettings {
  enabled: boolean
  provider: 'system' | 'http' | 'cloud'
  endpoint: string
  cloudEndpoint: string
  voice: string
  rate: number
  volume: number
  speakNarration: boolean
  speakReplies: boolean
}

interface TtsQueueItem {
  text: string
  kind: TtsKind
  style?: string
}

/** 去掉 Markdown、代码、表格、URL 和角色标签，只留下能完整念出来的正文 */
function cleanSpeechSource(raw: string): string {
  const text = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    // 运行时会把换行压平，表格会变成「| 项 | 值 | --- | ...」的一行；
    // 这里按竖线成组删除，避免表头和数据被当成正文念出来。
    .replace(/\s*\|(?:\s*[^|]*\|)+/g, ' ')
    .replace(/<uta\s[^>]*\/?>/gi, ' ')
    .replace(/\[(?:uta|emotion|preset)\s*:[^\]]*\]/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    // Git 提交哈希、UUID、长 ID：这些念出来没有意义
    .replace(/\b(?:sha(?:1|224|256|384|512)|md5)\s*[:：]?\s*/gi, ' ')
    .replace(
      /(提交(?:在|于|到|落在)?|commit(?:ted)?(?:\s+(?:as|in|at))?|哈希(?:值)?(?:是|为)?|校验和(?:是|为)?|hash|sha)\s*[:：]?\s*[0-9a-f]{7,40}\b/gi,
      (_match, context) => {
        if (/^提交/.test(context)) return '已提交'
        if (/^(?:哈希|校验和)/.test(context)) return '已校验'
        if (/^committed\s+as/i.test(context)) return 'committed'
        // 英文 commit/hash 保留名词，只去掉后面的哈希
        return context
      },
    )
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ' ')
    // 只删“既有 a-f 字母又有数字”的短哈希；纯数字（电话/版本/小数）不能误伤
    .replace(/\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/gi, ' ')
    .replace(
      /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{16,}\b/g,
      ' ',
    )
    // 路径和文件名也不适合直接朗读
    .replace(/(?:[A-Za-z]:[\\/][^\s，。；、,;:：]+)/g, ' ')
    .replace(/(?:[A-Za-z0-9_.-]+[\\/]){2,}[A-Za-z0-9_.-]+/g, ' ')
    .replace(
      /\b[\w-]+\.(?:ts|tsx|js|mjs|cjs|json|md|py|exe|dll|zip|png|jpe?g|gif|webp|wav|mp3|ogg|css|html|yml|yaml|toml|lock)\b/gi,
      ' ',
    )
    .replace(/[0-9#*]\uFE0F?\u20E3/g, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D]+/gu, ' ')
    .replace(/[✓✔✕✖✗✘→←↑↓⇒⇐•·]/g, ' ')
    .replace(
      /(?:详见|详情见|参见|位于|路径(?:是|为)|文件(?:是|为))\s*(?=[，。；、,.;:：]|$)/g,
      ' ',
    )
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_#>~|]+/g, ' ')
    .replace(/\s+([，。；、！？!?,.;:：])/g, '$1')
    .replace(/([，,；;])\s*(?=[，,。；;！？!?])/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[，。；、,.;:：!?！？\s]+/, '')
    .trim()
  if (!text) return ''
  // 只剩符号/表情时直接放弃，不要让 TTS 念一串噪音
  return /[\p{L}\p{N}]/u.test(text) ? text : ''
}

/** 把 Markdown/代码/URL 清成适合朗读的短句 */
export function prepareSpeechText(raw: string, maxChars = 240): string {
  let text = cleanSpeechSource(raw)
  if (!text) return ''
  if (text.length > maxChars) {
    text = text.slice(0, maxChars).replace(/[，。；、,.;\s]+$/g, '')
  }
  return text
}

/**
 * 宿主回复送给 TTS 前先压成一两句摘要。
 * 桌宠不照读整段回复，避免长文、表格和代码把语音拖成念稿。
 */
export function summarizeSpeechText(raw: string, maxChars = 120): string {
  const text = cleanSpeechSource(raw)
  if (!text) return ''
  if (text.length <= maxChars) return text

  const sentences = text.match(/[^。！？!?；;]+[。！？!?；;]?/g) ?? [text]
  let summary = (sentences[0] || text).trim()
  if (summary.length < 24 && sentences[1]) {
    summary = `${summary} ${sentences[1].trim()}`.trim()
  }
  if (summary.length > maxChars) {
    const cut = summary.slice(0, maxChars)
    const punctuation = Math.max(
      cut.lastIndexOf('。'),
      cut.lastIndexOf('！'),
      cut.lastIndexOf('？'),
      cut.lastIndexOf('；'),
      cut.lastIndexOf('.'),
      cut.lastIndexOf(';'),
    )
    summary =
      (punctuation >= 12 ? cut.slice(0, punctuation + 1) : cut).trimEnd() + '…'
  } else if (text.length > summary.length) {
    summary = `${summary.replace(/[。！？!?；;]$/, '')}…`
  }
  return summary
}

function getSystemVoices(): SpeechSynthesisVoice[] {
  try {
    return window.speechSynthesis?.getVoices?.() ?? []
  } catch {
    return []
  }
}

/** 设置面板用：列出系统可用语音 */
export function listSystemVoices(): SpeechSynthesisVoice[] {
  return getSystemVoices()
}

function pickVoice(settings: TtsSettings): SpeechSynthesisVoice | null {
  const voices = getSystemVoices()
  if (voices.length === 0) return null
  if (settings.voice) {
    const exact = voices.find(
      (voice) => voice.name === settings.voice || voice.voiceURI === settings.voice,
    )
    if (exact) return exact
  }
  return (
    voices.find((voice) => /^zh(-|_)/i.test(voice.lang)) ??
    voices.find((voice) => /chinese|mandarin|huihui|yaoyao|xiaoxiao/i.test(voice.name)) ??
    voices[0]
  )
}

const NARRATION_TTS_TIMEOUT_MS = 10_000
const REPLY_TTS_TIMEOUT_MS = 30_000
const PLAYBACK_START_TIMEOUT_MS = 15_000
const PLAYBACK_MAX_TIMEOUT_MS = 90_000

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

let envelopeContext: AudioContext | null = null

function getEnvelopeContext(): AudioContext | null {
  try {
    if (!envelopeContext) envelopeContext = new AudioContext()
    return envelopeContext
  } catch {
    return null
  }
}

/** 解码音频取 RMS 包络；不影响正常播放，失败时口型自动退回文本时钟。 */
async function decodeAudioEnvelope(base64: string, mime: string): Promise<Float32Array | null> {
  try {
    const context = getEnvelopeContext()
    if (!context) return null
    const data = await base64ToBlob(base64, mime).arrayBuffer()
    const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
      context.decodeAudioData(data, resolve, reject)
    })
    return buildAmplitudeEnvelope(buffer.getChannelData(0), buffer.sampleRate)
  } catch (error) {
    console.debug('[Deskpet] TTS envelope decode failed:', error)
    return null
  }
}

function speakSystem(
  text: string,
  settings: TtsSettings,
  onStart?: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      reject(new Error('system speech synthesis is unavailable'))
      return
    }
    const utterance = new SpeechSynthesisUtterance(text)
    const voice = pickVoice(settings)
    if (voice) utterance.voice = voice
    const rate = Math.max(0.5, Math.min(2, settings.rate || 1))
    utterance.rate = rate
    utterance.volume = Math.max(0, Math.min(1, settings.volume ?? 0.8))

    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      fn()
    }
    // Chromium 偶发不触发 onend；按文本长度给一个兜底，避免队列永久卡住
    const watchdogMs = Math.min(60_000, Math.max(4_000, (text.length * 250) / rate + 4_000))
    const watchdog = setTimeout(() => {
      try {
        window.speechSynthesis.cancel()
      } catch {
        /* ignore */
      }
      settle(() => reject(new Error('speech synthesis timed out')))
    }, watchdogMs)

    utterance.onstart = () => {
      try {
        onStart?.()
      } catch {
        /* ignore */
      }
    }
    utterance.onend = () => settle(resolve)
    utterance.onerror = (event) =>
      settle(() => reject(new Error(event.error || 'speech synthesis failed')))
    window.speechSynthesis.speak(utterance)
  })
}

/** Chromium 播放到结尾时会先派发 pause，再派发 ended；不能把这种情况当成用户打断。 */
export function isNaturalAudioEnd(audio: { ended: boolean; currentTime: number; duration: number }): boolean {
  if (audio.ended) return true
  const duration = Number(audio.duration)
  return Number.isFinite(duration) && duration > 0 && audio.currentTime >= duration - 0.05
}

async function speakHttp(
  text: string,
  settings: TtsSettings,
  style: string | undefined,
  audioRef: { current: HTMLAudioElement | null },
  shouldAbort: () => boolean = () => false,
  timeoutMs = REPLY_TTS_TIMEOUT_MS,
  onStart?: () => void,
  mouth?: TtsMouthTracker,
): Promise<void> {
  const api = window.utaAPI
  if (!api?.synthesizeSpeech) throw new Error('TTS IPC is unavailable')
  const result =
    settings.provider === 'cloud'
      ? await api.synthesizeSpeech({
          text,
          provider: 'cloud',
          ...(style ? { style } : {}),
          speed: settings.rate,
          timeoutMs,
        })
      : await api.synthesizeSpeech({
          text,
          endpoint: settings.endpoint,
          ...(style ? { style } : {}),
          speed: settings.rate,
          timeoutMs,
        })
  if (shouldAbort()) return
  if (!result?.ok || !result.audioBase64) {
    throw new Error(result?.error || 'TTS bridge failed')
  }
  const mime = result.mime || 'audio/wav'
  const audioBase64 = result.audioBase64
  const url = URL.createObjectURL(base64ToBlob(audioBase64, mime))
  const audio = new Audio(url)
  audio.volume = Math.max(0, Math.min(1, settings.volume ?? 0.8))
  audioRef.current = audio
  let watchdog: ReturnType<typeof setTimeout> | null = null
  try {
    await new Promise<void>((resolve, reject) => {
      let playbackStarted = false
      const clearWatchdog = () => {
        if (watchdog) {
          clearTimeout(watchdog)
          watchdog = null
        }
      }
      const armWatchdog = () => {
        clearWatchdog()
        const durationMs = Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration * 1000
          : 0
        const limit = durationMs > 0
          ? Math.min(PLAYBACK_MAX_TIMEOUT_MS, Math.max(PLAYBACK_START_TIMEOUT_MS, durationMs + 10_000))
          : PLAYBACK_START_TIMEOUT_MS
        watchdog = setTimeout(() => {
          watchdog = null
          try { audio.pause() } catch { /* ignore */ }
          reject(new Error('audio playback timeout'))
        }, limit)
      }
      audio.onended = () => { clearWatchdog(); resolve() }
      audio.onerror = () => { clearWatchdog(); reject(new Error('audio playback failed')) }
      audio.onpause = () => {
        clearWatchdog()
        if (isNaturalAudioEnd(audio)) return
        reject(new Error('audio interrupted'))
      }
      audio.onloadedmetadata = () => armWatchdog()
      audio.onplaying = () => {
        if (shouldAbort() || playbackStarted) return
        playbackStarted = true
        armWatchdog()
        if (mouth) {
          mouth.start(text, audio)
          void decodeAudioEnvelope(audioBase64, mime).then((envelope) => {
            mouth.setEnvelope(envelope, audio)
          })
        }
        try {
          onStart?.()
        } catch {
          /* ignore */
        }
      }
      if (shouldAbort()) {
        resolve()
        return
      }
      armWatchdog()
      void audio.play().catch(reject)
    })
  } finally {
    if (watchdog) clearTimeout(watchdog)
    audio.onended = null; audio.onerror = null; audio.onpause = null; audio.onplaying = null
    audio.onloadedmetadata = null
    try { audio.pause() } catch { /* ignore */ }
    URL.revokeObjectURL(url)
    if (audioRef.current === audio) audioRef.current = null
  }
}

/** 设置面板“试听”：不经过播报队列，直接播放一段短句 */
export async function previewTts(text: string, settings: TtsSettings): Promise<void> {
  const speech = prepareSpeechText(text, 120)
  if (!speech) return
  const audioRef: { current: HTMLAudioElement | null } = { current: null }
  if (settings.provider === 'http' || settings.provider === 'cloud') {
    try {
      await speakHttp(speech, settings, undefined, audioRef)
    } catch (error) {
      // 选云端/本地 TTS 时不再偷偷降级为系统机械音；失败就静默，保留用户的选择
      console.debug('[Deskpet] TTS preview failed:', error)
    }
    return
  }
  await speakSystem(speech, settings)
}

export interface TtsController {
  speak(text: string, options: { kind: TtsKind; style?: string }): void
  /** 新一轮对话开始：只清重复判定，不打断正在播放的语音 */
  beginTurn(): void
  isBusy(): boolean
  cancel(): void
  dispose(): void
  /** 当前语速下的张嘴幅度 0..1；没有播报时为 0。 */
  getLevel(): number
}

export function createTtsController(
  getSettings: () => TtsSettings,
  onSpeakingChange: (speaking: boolean) => void,
): TtsController {
  let queue: TtsQueueItem[] = []
  let running = false
  let runningKind: TtsKind | null = null
  let disposed = false
  const audioRef: { current: HTMLAudioElement | null } = { current: null }
  const mouth = new TtsMouthTracker()
  let generation = 0
  let lastReplySpeech = ''
  let lastReplyAt = 0

  const REPLY_DEDUPE_MS = 8000

  function isSimilarReply(a: string, b: string): boolean {
    if (!a || !b) return false
    if (a === b) return true
    const head = 16
    if (a.length < head || b.length < head) return false
    return a.startsWith(b.slice(0, head)) || b.startsWith(a.slice(0, head))
  }

  function stopCurrentAudio(): void {
    try {
      window.speechSynthesis?.cancel?.()
    } catch {
      /* ignore */
    }
    if (audioRef.current) {
      try {
        audioRef.current.pause()
        audioRef.current.src = ''
      } catch {
        /* ignore */
      }
      audioRef.current = null
    }
  }

  const pagehideTarget = typeof window !== 'undefined' && typeof window.addEventListener === 'function'
    ? window
    : null
  pagehideTarget?.addEventListener('pagehide', stopCurrentAudio)

  async function pump(): Promise<void> {
    if (running || disposed) return
    const item = queue.shift()
    if (!item) return
    const settings = getSettings()
    if (!settings.enabled) {
      queue = []
      return
    }
    running = true
    runningKind = item.kind
    const myGeneration = generation
    const startSpeaking = () => {
      if (myGeneration === generation) onSpeakingChange(true)
    }
    try {
      if (settings.provider === 'http' || settings.provider === 'cloud') {
        try {
          await speakHttp(
            item.text,
            settings,
            item.style,
            audioRef,
            () => myGeneration !== generation,
            item.kind === 'narration' ? NARRATION_TTS_TIMEOUT_MS : REPLY_TTS_TIMEOUT_MS,
            startSpeaking,
            mouth,
          )
        } catch (error) {
          if (myGeneration !== generation) return
          // 云端/本地 TTS 失败或被打断时绝不降级到系统机械音，避免“正常播报后
          // 又跟一句机械播报”；队列会继续处理下一条，用户的选择保持不变。
          console.debug('[Deskpet] TTS failed (system fallback disabled):', error)
        }
      } else {
        await speakSystem(item.text, settings, () => {
          if (myGeneration !== generation) return
          mouth.start(item.text, null)
          startSpeaking()
        })
      }
    } catch (error) {
      console.debug('[Deskpet] TTS failed:', error)
    } finally {
      if (myGeneration === generation) {
        mouth.clear()
        running = false
        runningKind = null
        onSpeakingChange(false)
        if (queue.length > 0) void pump()
      }
    }
  }

  return {
    speak(text, options) {
      if (disposed) return
      const settings = getSettings()
      if (!settings.enabled) return
      if (options.kind === 'narration' && !settings.speakNarration) return
      if (options.kind === 'reply' && !settings.speakReplies) return
      const speech =
        options.kind === 'narration'
          ? prepareSpeechText(text, 140)
          : summarizeSpeechText(text, 120)
      if (!speech) return

      if (options.kind === 'reply') {
        const now = Date.now()
        // 同一轮最终回复可能同时从 hook 和直连 CLI 回来；重复内容不再念第二遍
        if (
          lastReplySpeech &&
          now - lastReplyAt < REPLY_DEDUPE_MS &&
          isSimilarReply(speech, lastReplySpeech)
        ) {
          return
        }
        lastReplySpeech = speech
        lastReplyAt = now

        // 正式回复优先：丢掉排队中的状态解说；如果正在念状态解说就打断它。
        // 正在播放的另一条回复不打断，按队列顺序念完，避免半句话被切掉。
        queue = queue.filter((item) => item.kind !== 'narration')
        if (runningKind === 'narration') {
          generation += 1
          stopCurrentAudio()
          mouth.clear()
          running = false
          runningKind = null
          onSpeakingChange(false)
        }
      }
      queue.push({ text: speech, kind: options.kind, ...(options.style ? { style: options.style } : {}) })
      if (queue.length > 6) {
        const narrationIndex = queue.findIndex((item) => item.kind === 'narration')
        if (narrationIndex >= 0) queue.splice(narrationIndex, 1)
        else queue.splice(0, queue.length - 6)
      }
      void pump()
    },
    beginTurn() {
      lastReplySpeech = ''
      lastReplyAt = 0
    },
    isBusy() {
      return running || queue.length > 0
    },
    getLevel() {
      return mouth.level()
    },
    cancel() {
      generation += 1
      queue = []
      stopCurrentAudio()
      mouth.clear()
      running = false
      runningKind = null
      lastReplySpeech = ''
      lastReplyAt = 0
      onSpeakingChange(false)
    },
    dispose() {
      disposed = true
      this.cancel()
      pagehideTarget?.removeEventListener('pagehide', stopCurrentAudio)
    },
  }
}
