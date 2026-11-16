/**
 * 本机 TTS 合成代理。
 *
 * 渲染层只负责播放；主进程只允许访问回环地址上的 TTS 桥（例如 MaiBot 的
 * GPT-SoVITS / cloud bridge），避免把任意 URL 变成 SSRF 入口。
 *
 * 兼容两种响应：
 * - 直接返回 audio/wav 等二进制；
 * - 返回 JSON { audio|audioBase64|data: base64, mime? }。
 */
import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

export const DEFAULT_TTS_ENDPOINT = 'http://127.0.0.1:9881/tts'
const MAX_TEXT_CHARS = 1000
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000

export interface SpeechSynthesisRequest {
  text: string
  endpoint?: string
  style?: string
  speed?: number
  timeoutMs?: number
}

export interface SpeechSynthesisResult {
  audioBase64: string
  mime: string
}

export class SpeechSynthesisError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpeechSynthesisError'
  }
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function normalizeEndpoint(raw: unknown): URL {
  const text = typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_TTS_ENDPOINT
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    throw new SpeechSynthesisError('TTS endpoint is not a valid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SpeechSynthesisError('TTS endpoint must use http or https')
  }
  if (!isLoopbackHost(parsed.hostname)) {
    throw new SpeechSynthesisError(
      'TTS endpoint must be loopback (127.0.0.1 / localhost); run a local bridge for cloud providers',
    )
  }
  return parsed
}

export function validateSpeechText(raw: unknown): string {
  if (typeof raw !== 'string') throw new SpeechSynthesisError('text is required')
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) throw new SpeechSynthesisError('text is empty')
  if (text.length > MAX_TEXT_CHARS) {
    throw new SpeechSynthesisError(`text exceeds ${MAX_TEXT_CHARS} characters`)
  }
  return text
}

function readAudioResponse(
  contentType: string,
  body: Buffer,
): SpeechSynthesisResult {
  const mime = contentType.split(';')[0].trim() || 'audio/wav'
  if (mime.includes('application/json')) {
    let parsed: any
    try {
      parsed = JSON.parse(body.toString('utf-8'))
    } catch {
      throw new SpeechSynthesisError('TTS bridge returned invalid JSON')
    }
    const base64 =
      parsed?.audioBase64 ?? parsed?.audio_base64 ?? parsed?.audio ?? parsed?.data?.audio
    if (typeof base64 !== 'string' || !base64.trim()) {
      throw new SpeechSynthesisError('TTS bridge JSON does not contain audio data')
    }
    return {
      audioBase64: base64.trim(),
      mime: typeof parsed?.mime === 'string' && parsed.mime ? parsed.mime : 'audio/wav',
    }
  }
  if (!mime.startsWith('audio/') && mime !== 'application/octet-stream') {
    throw new SpeechSynthesisError(`TTS bridge returned unsupported content type: ${mime}`)
  }
  return { audioBase64: body.toString('base64'), mime }
}

/** 调用本机 TTS 桥；失败时抛出可读错误，由 IPC 层转成 {ok:false}。 */
export function synthesizeSpeech(
  request: SpeechSynthesisRequest,
): Promise<SpeechSynthesisResult> {
  return new Promise((resolve, reject) => {
    let endpoint: URL
    let text: string
    try {
      endpoint = normalizeEndpoint(request?.endpoint)
      text = validateSpeechText(request?.text)
    } catch (error) {
      reject(error)
      return
    }

    const payload = Buffer.from(
      JSON.stringify({
        text,
        ...(typeof request?.style === 'string' && request.style.trim()
          ? { style: request.style.trim() }
          : {}),
        ...(Number.isFinite(request?.speed)
          ? { speed: Number(request.speed), speed_factor: Number(request.speed) }
          : {}),
      }),
      'utf-8',
    )
    const timeoutMs =
      Number.isFinite(request?.timeoutMs) && Number(request.timeoutMs) > 0
        ? Math.min(120_000, Math.max(1000, Number(request.timeoutMs)))
        : DEFAULT_TIMEOUT_MS

    const transport = endpoint.protocol === 'https:' ? https : http
    const req = transport.request(
      {
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: endpoint.port,
        path: `${endpoint.pathname}${endpoint.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          Accept: 'audio/*, application/json',
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new SpeechSynthesisError('TTS response is too large'))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => {
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            reject(new SpeechSynthesisError(`TTS bridge returned HTTP ${res.statusCode}`))
            return
          }
          try {
            resolve(readAudioResponse(String(res.headers['content-type'] || ''), Buffer.concat(chunks)))
          } catch (error) {
            reject(error)
          }
        })
        res.on('error', (error) => reject(error))
      },
    )
    req.on('timeout', () => req.destroy(new SpeechSynthesisError('TTS bridge timed out')))
    req.on('error', (error) => reject(error))
    req.end(payload)
  })
}
