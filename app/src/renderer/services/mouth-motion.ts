const PAUSE_CHARS = new Set(Array.from('，。！？；：、,.!?;:…—–\n*#`>'))
const SPACE_RE = /\s/

function charDuration(char: string, charMs: number): number {
  return PAUSE_CHARS.has(char) ? Math.max(charMs, 220) : charMs
}

function charWeight(char: string): number {
  return 0.55 + (((char.codePointAt(0) ?? 0) * 31) % 45) / 100
}

/**
 * 逐字推进的语音时钟：文本停止增长时停在末尾等待，新增文本后从断点继续，
 * 不会因为模型思考/工具调用造成的长停顿而把后面的字“跳过去”。
 */
export class TextSpeechClock {
  private started = false
  private text = ''
  private chars: string[] = []
  private index = 0
  private stepStart = 0

  start(now = performance.now()): void {
    this.started = true
    this.text = ''
    this.chars = []
    this.index = 0
    this.stepStart = now
  }

  reset(): void {
    this.started = false
    this.text = ''
    this.chars = []
    this.index = 0
    this.stepStart = 0
  }

  level(text: string, now = performance.now(), charsPerSecond = 9): number {
    if (!this.started) this.start(now)
    const next = String(text || '')
    // 流式文本每帧都会调用；只在文本真正变化时拆分，避免每帧分配整段字符数组
    if (next !== this.text) {
      if (this.text && !next.startsWith(this.text)) {
        this.index = 0
        this.stepStart = now
      }
      this.text = next
      this.chars = next ? Array.from(next) : []
    }
    const chars = this.chars
    if (chars.length === 0) {
      this.index = 0
      this.stepStart = now
      return 0
    }
    if (this.index >= chars.length) {
      this.stepStart = now
      return 0
    }
    const charMs = 1000 / Math.max(1, charsPerSecond)
    while (this.index < chars.length) {
      const duration = charDuration(chars[this.index], charMs)
      if (now < this.stepStart + duration) break
      this.stepStart += duration
      this.index += 1
    }
    if (this.index >= chars.length) {
      this.stepStart = now
      return 0
    }
    const char = chars[this.index]
    if (SPACE_RE.test(char) || PAUSE_CHARS.has(char)) return 0
    const phase = Math.min(1, Math.max(0, (now - this.stepStart) / charMs))
    return Math.min(1, Math.max(0, Math.sin(Math.PI * phase) * charWeight(char)))
  }
}

/** 开口快、收口慢，避免每帧电平抖动造成的机械感。 */
export function smoothMouth(previous: number, target: number, dtMs: number): number {
  const from = Math.min(1, Math.max(0, Number.isFinite(previous) ? previous : 0))
  const to = Math.min(1, Math.max(0, Number.isFinite(target) ? target : 0))
  const tau = to > from ? 55 : 120
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau)
  return Math.min(1, Math.max(0, from + (to - from) * k))
}

/** 把 PCM 压成每 windowMs 一个的 RMS 包络，供口型按音频时间取样。 */
export function buildAmplitudeEnvelope(
  samples: Float32Array,
  sampleRate: number,
  windowMs = 50,
): Float32Array {
  if (!samples || samples.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return new Float32Array(0)
  }
  const windowSamples = Math.max(1, Math.round((sampleRate * windowMs) / 1000))
  const count = Math.ceil(samples.length / windowSamples)
  const envelope = new Float32Array(count)
  let peak = 0
  for (let i = 0; i < count; i += 1) {
    const start = i * windowSamples
    const end = Math.min(samples.length, start + windowSamples)
    let sum = 0
    for (let j = start; j < end; j += 1) sum += samples[j] * samples[j]
    const rms = Math.sqrt(sum / Math.max(1, end - start))
    envelope[i] = rms
    if (rms > peak) peak = rms
  }
  if (peak > 1e-6) {
    for (let i = 0; i < count; i += 1) {
      const normalized = envelope[i] / peak
      envelope[i] = normalized < 0.04 ? 0 : Math.min(1, Math.pow(normalized, 0.65))
    }
  }
  return envelope
}

/** Audio uses its own playback time; missing envelopes use a text fallback at that same time. */
export class TtsMouthTracker {
  private text = ''
  private started = false
  private startedAt = 0
  private lastAudioTimeMs = -1
  private audio: HTMLAudioElement | null = null
  private envelope: Float32Array | null = null
  private readonly windowMs = 50
  private readonly clock = new TextSpeechClock()

  start(text: string, audio: HTMLAudioElement | null = null, now = performance.now()): void {
    const origin = Number.isFinite(now) ? now : 0
    this.text = String(text || '')
    this.started = true
    this.audio = audio
    this.envelope = null
    this.startedAt = origin
    this.lastAudioTimeMs = -1
    this.clock.start(origin)
  }

  setEnvelope(envelope: Float32Array | null, audio: HTMLAudioElement | null = null): void {
    if (!this.audio) return
    if (audio && audio !== this.audio) return
    this.envelope = envelope && envelope.length > 0 ? envelope : null
  }

  clear(): void {
    this.text = ''
    this.started = false
    this.startedAt = 0
    this.lastAudioTimeMs = -1
    this.audio = null
    this.envelope = null
    this.clock.reset()
  }

  level(now = performance.now()): number {
    if (!this.started) return 0
    const audio = this.audio
    if (audio) {
      if (audio.paused || audio.ended || audio.seeking || (Number.isFinite(audio.readyState) && audio.readyState < 3)) return 0
      const timeMs = audio.currentTime * 1000
      if (!Number.isFinite(timeMs) || timeMs < 0) return 0
      if (timeMs < this.lastAudioTimeMs) this.clock.start(this.startedAt)
      this.lastAudioTimeMs = timeMs
      if (this.envelope) {
        const level = this.envelope[Math.floor(timeMs / this.windowMs)]
        return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
      }
      return this.clock.level(this.text, this.startedAt + timeMs)
    }
    return Number.isFinite(now) ? this.clock.level(this.text, now) : 0
  }
}
