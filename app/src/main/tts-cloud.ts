/**
 * 云端 TTS 直连。
 *
 * 支持的 backend：
 * siliconflow / deepseek / cosyvoice / mimo / fishaudio / gsv2p / openai。
 *
 * 安全边界：
 * - API Key 只在主进程内使用，渲染层永远拿不到明文；
 * - 只允许 http/https；请求体不带任何其他用户数据；
 * - 错误信息里不回显 Key。
 */
import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

export type CloudTtsBackend =
  | 'siliconflow'
  | 'deepseek'
  | 'cosyvoice'
  | 'mimo'
  | 'fishaudio'
  | 'gsv2p'
  | 'openai'

export interface CloudTtsConfig {
  backend: CloudTtsBackend
  apiKey: string
  endpoint: string
  model: string
  voice: string
  style: string
}

export interface PublicCloudTtsConfig {
  backend: CloudTtsBackend
  endpoint: string
  model: string
  voice: string
  style: string
  hasApiKey: boolean
}

const DEFAULTS: Record<CloudTtsBackend, Omit<CloudTtsConfig, 'apiKey' | 'style'>> = {
  siliconflow: {
    backend: 'siliconflow',
    endpoint: 'https://api.siliconflow.cn/v1/audio/speech',
    model: 'FunAudioLLM/CosyVoice2-0.5B',
    voice: 'FunAudioLLM/CosyVoice2-0.5B:claire',
  },
  deepseek: {
    backend: 'deepseek',
    endpoint: 'https://api.deepseek.com/v1/tools/tts',
    model: '',
    voice: 'stella',
  },
  cosyvoice: {
    backend: 'cosyvoice',
    endpoint:
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/SpeechSynthesizer',
    model: 'qwen-audio-3.0-tts-flash',
    voice: 'cherry',
  },
  mimo: {
    backend: 'mimo',
    endpoint: 'https://api.xiaomimimo.com/v1/chat/completions',
    model: 'mimo-v2.5-tts',
    voice: 'mimo_default',
  },
  fishaudio: {
    backend: 'fishaudio',
    endpoint: 'https://api.fish.audio/v1/tts',
    model: '',
    voice: '',
  },
  gsv2p: {
    backend: 'gsv2p',
    endpoint: 'https://gsv2p.acgnai.top/v1/audio/speech',
    model: 'tts-v4',
    voice: '原神-中文-派蒙_ZH',
  },
  openai: {
    backend: 'openai',
    endpoint: 'https://api.openai.com/v1/audio/speech',
    model: 'tts-1',
    voice: 'nova',
  },
}

export const CLOUD_TTS_DEFAULTS = DEFAULTS

const MAX_AUDIO_BYTES = 12 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 60_000

export class CloudTtsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CloudTtsError'
  }
}

function text(value: unknown, max = 4000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function isCloudTtsBackend(value: unknown): value is CloudTtsBackend {
  return typeof value === 'string' && Object.hasOwn(DEFAULTS, value)
}

/** 公开配置（给设置面板）；不含 Key */
export function normalizePublicCloudConfig(raw: unknown): PublicCloudTtsConfig {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const backend = isCloudTtsBackend(record.backend) ? record.backend : 'siliconflow'
  const defaults = DEFAULTS[backend]
  let endpoint = text(record.endpoint) || defaults.endpoint
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') endpoint = defaults.endpoint
  } catch {
    endpoint = defaults.endpoint
  }
  return {
    backend,
    endpoint,
    model: text(record.model, 120) || defaults.model,
    voice: text(record.voice, 120) || defaults.voice,
    style: text(record.style, 200),
    hasApiKey: record.hasApiKey === true,
  }
}

/** 内部配置（包含 Key，只在主进程内存在） */
export function normalizeCloudConfig(raw: unknown): CloudTtsConfig {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const publicConfig = normalizePublicCloudConfig(record)
  return {
    backend: publicConfig.backend,
    apiKey: text(record.apiKey, 500),
    endpoint: publicConfig.endpoint,
    model: publicConfig.model,
    voice: publicConfig.voice,
    style: publicConfig.style,
  }
}

function endpointOrigin(endpoint: string): string {
  try { return new URL(endpoint).origin } catch { return '' }
}

export function sameCloudTtsOwner(a: CloudTtsConfig, b: CloudTtsConfig): boolean {
  return a.backend === b.backend && endpointOrigin(a.endpoint) === endpointOrigin(b.endpoint)
}

/** Preserve a key only within the same backend and endpoint origin; never forward it to a new service. */
export function mergeCloudTtsConfig(existing: CloudTtsConfig, raw: unknown): CloudTtsConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CloudTtsError('Invalid cloud TTS configuration')
  const record = raw as Record<string, unknown>
  if (record.backend !== undefined && !isCloudTtsBackend(record.backend)) throw new CloudTtsError('Invalid cloud TTS backend')
  const next = normalizeCloudConfig({ ...existing, ...record, apiKey: '' })
  const sameOwner = next.backend === existing.backend &&
    endpointOrigin(next.endpoint) === endpointOrigin(existing.endpoint)
  const apiKey = record.clearKey === true ? ''
    : typeof record.apiKey === 'string' && record.apiKey.trim()
      ? record.apiKey.trim()
      : sameOwner ? existing.apiKey : ''
  return normalizeCloudConfig({ ...next, apiKey })
}

interface HttpResult {
  status: number
  contentType: string
  body: Buffer
}

const SENSITIVE_HEADER_NAMES = new Set(['authorization', 'api-key', 'api_token', 'cookie'])

function hasSensitiveHeaders(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((name) => SENSITIVE_HEADER_NAMES.has(name.toLowerCase()))
}

export function stripSensitiveRedirectHeaders(headers: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!SENSITIVE_HEADER_NAMES.has(name.toLowerCase())) next[name] = value
  }
  return next
}

export function shouldBlockCredentialDowngrade(
  from: string,
  to: string,
  headers: Record<string, string>,
): boolean {
  try {
    return new URL(from).protocol === 'https:' &&
      new URL(to).protocol === 'http:' &&
      hasSensitiveHeaders(headers)
  } catch {
    return false
  }
}

function requestBinary(
  urlText: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body?: Buffer,
  timeoutMs = REQUEST_TIMEOUT_MS,
  redirects = 0,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    let url: URL
    try {
      url = new URL(urlText)
    } catch {
      reject(new CloudTtsError('云端 TTS 地址不是合法 URL'))
      return
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      reject(new CloudTtsError('云端 TTS 只支持 http/https'))
      return
    }
    const transport = url.protocol === 'https:' ? https : http
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          ...headers,
          ...(body ? { 'Content-Length': body.length } : {}),
          Accept: 'audio/*, application/json',
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_AUDIO_BYTES) {
            req.destroy(new CloudTtsError('云端 TTS 响应过大'))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => {
          const status = res.statusCode || 0
          const location = res.headers.location
          if (status >= 300 && status < 400 && location && redirects < 2) {
            let nextUrl: URL
            try { nextUrl = new URL(location, url) } catch {
              reject(new CloudTtsError('云端 TTS 重定向地址无效'))
              return
            }
            if (shouldBlockCredentialDowngrade(url.toString(), nextUrl.toString(), headers)) {
              reject(new CloudTtsError('云端 TTS 不允许携带凭据的 HTTPS 降级重定向'))
              return
            }
            const keepMethod = status === 307 || status === 308
            const nextHeaders = nextUrl.origin === url.origin
              ? { ...headers }
              : stripSensitiveRedirectHeaders(headers)
            if (!keepMethod) delete nextHeaders['Content-Type']
            requestBinary(
              nextUrl.toString(),
              keepMethod ? method : 'GET',
              nextHeaders,
              keepMethod ? body : undefined,
              timeoutMs,
              redirects + 1,
            ).then(resolve).catch(reject)
            return
          }
          resolve({
            status,
            contentType: String(res.headers['content-type'] || ''),
            body: Buffer.concat(chunks),
          })
        })
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new CloudTtsError('云端 TTS 请求超时')))
    req.on('error', (error) => reject(error))
    req.end(body)
  })
}

function audioResult(result: HttpResult): { audioBase64: string; mime: string } {
  if (result.status < 200 || result.status >= 300) {
    const preview = result.body.toString('utf-8').replace(/\s+/g, ' ').slice(0, 200)
    throw new CloudTtsError(`云端 TTS 返回 HTTP ${result.status}: ${preview}`)
  }
  const mime = result.contentType.split(';')[0].trim() || 'audio/wav'
  if (mime.includes('application/json')) {
    throw new CloudTtsError('云端 TTS 返回了 JSON 而不是音频')
  }
  if (result.body.length === 0) throw new CloudTtsError('云端 TTS 返回空音频')
  return { audioBase64: result.body.toString('base64'), mime }
}

function parseJson(result: HttpResult, label: string): any {
  if (result.status < 200 || result.status >= 300) {
    const preview = result.body.toString('utf-8').replace(/\s+/g, ' ').slice(0, 200)
    throw new CloudTtsError(`${label} 返回 HTTP ${result.status}: ${preview}`)
  }
  try {
    return JSON.parse(result.body.toString('utf-8'))
  } catch {
    throw new CloudTtsError(`${label} 返回了非 JSON 响应`)
  }
}

/** 调用云端 TTS；返回 base64 音频和 MIME */
export async function synthesizeCloudSpeech(
  rawConfig: CloudTtsConfig | unknown,
  rawText: unknown,
  speed = 1,
): Promise<{ audioBase64: string; mime: string }> {
  const config = normalizeCloudConfig(rawConfig)
  const content = text(rawText, 1000)
  if (!content) throw new CloudTtsError('朗读文本为空')
  if (!config.apiKey && config.backend !== 'openai') {
    throw new CloudTtsError('云端 TTS 还没有保存 API Key')
  }

  const baseHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  const authHeaders: Record<string, string> =
    config.backend === 'mimo'
      ? { 'api-key': config.apiKey }
      : config.backend === 'gsv2p'
        ? { api_token: config.apiKey }
        : config.apiKey
          ? { Authorization: `Bearer ${config.apiKey}` }
          : {}
  const headers = { ...baseHeaders, ...authHeaders }
  const speedValue = Number.isFinite(speed) ? Math.max(0.5, Math.min(2, speed)) : 1

  if (config.backend === 'deepseek') {
    if (config.voice !== 'stella' && config.voice !== 'tide') {
      throw new CloudTtsError('DeepSeek 音色请选择海星或暗潮')
    }
    // DeepSeek uses its own tools API and has no model, speed or style parameters.
    const body = Buffer.from(JSON.stringify({
      text: content,
      voice_id: config.voice,
      format: 'wav',
      filter_markdown: true,
    }), 'utf-8')
    const result = await requestBinary(config.endpoint, 'POST', headers, body)
    if (result.status < 200 || result.status >= 300) {
      throw new CloudTtsError(`DeepSeek TTS 返回 HTTP ${result.status}`)
    }
    const audio = audioResult(result)
    if (audio.mime !== 'audio/wav') throw new CloudTtsError('DeepSeek TTS 未返回 WAV 音频')
    return audio
  }

  if (config.backend === 'mimo') {
    const messages: Array<{ role: string; content: string }> = []
    if (config.style) messages.push({ role: 'user', content: config.style })
    messages.push({ role: 'assistant', content })
    const body = Buffer.from(
      JSON.stringify({
        model: config.model,
        messages,
        audio: { format: 'wav', voice: config.voice },
      }),
      'utf-8',
    )
    const result = await requestBinary(config.endpoint, 'POST', headers, body)
    const data = parseJson(result, 'MiMo')
    const base64 = data?.choices?.[0]?.message?.audio?.data
    if (typeof base64 !== 'string' || !base64) throw new CloudTtsError('MiMo 响应缺少音频数据')
    return { audioBase64: base64, mime: 'audio/wav' }
  }

  if (config.backend === 'cosyvoice') {
    const body = Buffer.from(
      JSON.stringify({
        model: config.model,
        input: { text: content, voice: config.voice, format: 'wav', sample_rate: 24000 },
      }),
      'utf-8',
    )
    const result = await requestBinary(config.endpoint, 'POST', headers, body)
    const mime = result.contentType.split(';')[0].trim() || ''
    if (!mime.includes('json')) return audioResult(result)
    const data = parseJson(result, 'CosyVoice')
    const output = data?.output
    const audioData = output?.audio?.data
    if (typeof audioData === 'string' && audioData) {
      return { audioBase64: audioData, mime: 'audio/wav' }
    }
    const audioUrl = output?.audio?.url || output?.url
    if (typeof audioUrl === 'string' && /^https?:\/\//i.test(audioUrl)) {
      const audio = await requestBinary(audioUrl, 'GET', {})
      return audioResult(audio)
    }
    const preview = JSON.stringify(data).slice(0, 200)
    throw new CloudTtsError(`CosyVoice 响应格式异常: ${preview}`)
  }

  if (config.backend === 'fishaudio') {
    const body = Buffer.from(
      JSON.stringify({
        text: content,
        format: 'wav',
        ...(config.voice ? { reference_id: config.voice } : {}),
      }),
      'utf-8',
    )
    return audioResult(await requestBinary(config.endpoint, 'POST', headers, body))
  }

  // siliconflow / gsv2p / openai：OpenAI-compatible audio/speech
  const body = Buffer.from(
    JSON.stringify({
      model: config.model,
      input: content,
      voice: config.voice,
      response_format: 'wav',
      speed: speedValue,
      ...(config.style && config.backend === 'siliconflow' ? { style: config.style } : {}),
    }),
    'utf-8',
  )
  const result = await requestBinary(config.endpoint, 'POST', headers, body)
  return audioResult(result)
}
