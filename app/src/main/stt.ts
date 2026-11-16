/**
 * 云端 / 本地语音识别（STT）。
 *
 * 云端走 OpenAI 兼容的 /v1/audio/transcriptions（默认硅基流动 SenseVoice），
 * 本地默认复用 MaiBot 的 SenseVoice 桥 http://127.0.0.1:18530/stt。
 * API Key 只留在主进程，渲染层只拿 hasApiKey。
 */
import { URL } from 'node:url'

export type SttProvider = 'cloud' | 'local'
export type SttCloudBackend = 'siliconflow' | 'groq' | 'openai' | 'custom'

export interface SttConfig {
  enabled: boolean
  provider: SttProvider
  backend: SttCloudBackend
  endpoint: string
  model: string
  apiKey: string
  language: string
  localEndpoint: string
  autoSend: boolean
}

export interface PublicSttConfig {
  enabled: boolean
  provider: SttProvider
  backend: SttCloudBackend
  endpoint: string
  model: string
  language: string
  localEndpoint: string
  autoSend: boolean
  hasApiKey: boolean
}

export const DEFAULT_STT_CONFIG: SttConfig = {
  enabled: false,
  provider: 'cloud',
  backend: 'siliconflow',
  endpoint: 'https://api.siliconflow.cn/v1/audio/transcriptions',
  model: 'FunAudioLLM/SenseVoiceSmall',
  apiKey: '',
  language: 'zh',
  localEndpoint: 'http://127.0.0.1:18530/stt',
  autoSend: false,
}

const CLOUD_DEFAULTS: Record<Exclude<SttCloudBackend, 'custom'>, { endpoint: string; model: string }> = {
  siliconflow: {
    endpoint: 'https://api.siliconflow.cn/v1/audio/transcriptions',
    model: 'FunAudioLLM/SenseVoiceSmall',
  },
  groq: {
    endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
    model: 'whisper-large-v3-turbo',
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/audio/transcriptions',
    model: 'whisper-1',
  },
}

const MAX_AUDIO_BYTES = 15 * 1024 * 1024
const CLOUD_TIMEOUT_MS = 60_000
const LOCAL_TIMEOUT_MS = 180_000

export class SttError extends Error {}

export function sameSttOwner(a: SttConfig, b: SttConfig): boolean {
  try {
    return a.backend === b.backend && new URL(a.endpoint).origin === new URL(b.endpoint).origin
  } catch {
    return false
  }
}

/** A key belongs to its cloud backend and endpoint origin, never to the next selected service. */
export function mergeSttConfig(existing: SttConfig, record: Record<string, unknown>): SttConfig {
  // Reading old config is tolerant; an explicit save must not silently replace an invalid address.
  for (const key of ['endpoint', 'localEndpoint'] as const) {
    if (!Object.hasOwn(record, key)) continue
    const value = record[key]
    if (typeof value !== 'string') throw new SttError('识别服务地址格式不正确')
    if (!value.trim() && key === 'endpoint' && (record.provider ?? existing.provider) === 'local') continue
    let url: URL
    try { url = new URL(value.trim()) } catch { throw new SttError('识别服务地址格式不正确') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new SttError('识别服务地址格式不正确')
    normalizeEndpoint(value, '', key === 'localEndpoint' ? 'local' : 'cloud')
  }
  const next = normalizeSttConfig({ ...existing, ...record, apiKey: '' })
  let sameOrigin = false
  try { sameOrigin = new URL(next.endpoint).origin === new URL(existing.endpoint).origin } catch { /* Empty custom endpoints own no key. */ }
  const sameOwner = next.backend === existing.backend && sameOrigin
  return normalizeSttConfig({ ...next, apiKey: record.clearKey === true ? ''
    : typeof record.apiKey === 'string' && record.apiKey.trim() ? record.apiKey.trim() : sameOwner ? existing.apiKey : '' })
}

function clip(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizeEndpoint(raw: unknown, fallback: string, provider: SttProvider): string {
  const value = clip(raw, 500) || fallback
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return fallback
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return fallback
  const host = url.hostname.toLowerCase()
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
  if (url.protocol === 'http:' && !loopback) {
    throw new SttError('普通 HTTP 只允许本机 STT 地址，云端请使用 HTTPS')
  }
  if (provider === 'local' && !loopback) {
    throw new SttError('本地 STT 只允许回环地址')
  }
  return url.toString()
}

export function normalizeSttConfig(raw: unknown): SttConfig {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const provider: SttProvider = record.provider === 'local' ? 'local' : 'cloud'
  const backend: SttCloudBackend =
    record.backend === 'groq' || record.backend === 'openai' || record.backend === 'custom'
      ? record.backend
      : 'siliconflow'
  const defaults = backend === 'custom' ? { endpoint: '', model: '' } : CLOUD_DEFAULTS[backend]
  let endpoint = defaults.endpoint
  let localEndpoint = DEFAULT_STT_CONFIG.localEndpoint
  try {
    endpoint = normalizeEndpoint(record.endpoint, defaults.endpoint, 'cloud')
  } catch {
    endpoint = defaults.endpoint
  }
  try {
    localEndpoint = normalizeEndpoint(record.localEndpoint, DEFAULT_STT_CONFIG.localEndpoint, 'local')
  } catch {
    localEndpoint = DEFAULT_STT_CONFIG.localEndpoint
  }
  return {
    enabled: record.enabled === true,
    provider,
    backend,
    endpoint,
    model: clip(record.model, 120) || defaults.model,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey.trim() : '',
    language: clip(record.language, 20) || 'zh',
    localEndpoint,
    autoSend: record.autoSend === true,
  }
}

export function normalizePublicSttConfig(config: SttConfig): PublicSttConfig {
  return {
    enabled: config.enabled,
    provider: config.provider,
    backend: config.backend,
    endpoint: config.endpoint,
    model: config.model,
    language: config.language,
    localEndpoint: config.localEndpoint,
    autoSend: config.autoSend,
    hasApiKey: !!config.apiKey,
  }
}

export function cleanTranscript(raw: unknown): string {
  return clip(raw, 2000)
    .replace(/^(识别结果|转写结果|text)[:：\s]*/i, '')
    .trim()
}

async function transcribeCloud(config: SttConfig, audio: Uint8Array): Promise<string> {
  if (!config.endpoint) throw new SttError('云端 STT 还没有配置接口地址')
  if (!config.apiKey && config.backend !== 'custom') {
    throw new SttError('云端 STT 还没有保存 API Key')
  }
  const form = new FormData()
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'speech.wav')
  form.append('model', config.model)
  if (config.language) form.append('language', config.language)
  const headers: Record<string, string> = {}
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers,
    body: form,
    signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
  })
  if (!response.ok) throw new SttError(`云端 STT 返回 HTTP ${response.status}`)
  const data = (await response.json()) as { text?: string; result?: string }
  const text = cleanTranscript(data?.text ?? data?.result)
  if (!text) throw new SttError('云端 STT 没有返回文本')
  return text
}

async function transcribeLocal(config: SttConfig, audio: Uint8Array): Promise<string> {
  const response = await fetch(config.localEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: audio,
    redirect: 'error',
    signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
  })
  if (!response.ok) throw new SttError(`本地 STT 返回 HTTP ${response.status}`)
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('json')) {
    const data = (await response.json()) as { text?: string; result?: string }
    const text = cleanTranscript(data?.text ?? data?.result)
    if (!text) throw new SttError('本地 STT 没有识别到文字')
    return text
  }
  const text = cleanTranscript(await response.text())
  if (!text) throw new SttError('本地 STT 没有识别到文字')
  return text
}

export async function transcribeAudio(
  rawConfig: SttConfig,
  audioBase64: string,
): Promise<string> {
  const config = normalizeSttConfig(rawConfig)
  if (!config.enabled) throw new SttError('语音输入还没有开启')
  const audio = Buffer.from(String(audioBase64 || ''), 'base64')
  if (!audio.length) throw new SttError('录音为空')
  if (audio.length > MAX_AUDIO_BYTES) throw new SttError('录音过大')
  return config.provider === 'local'
    ? transcribeLocal(config, audio)
    : transcribeCloud(config, audio)
}
