import type { IpcMainInvokeEvent, WebContents } from 'electron'
import type { VoicePreviewRequest, VoicePreviewResult } from '../../shared/voice-preview-contracts'
import type { SpeechSynthesisResult } from '../tts'

/** A settings-only capability. It provides neither host input nor runtime approval access. */
export function createVoicePreviewHandler(options: {
  isAllowedSender: (event: IpcMainInvokeEvent) => boolean
  synthesize: (request: VoicePreviewRequest) => Promise<SpeechSynthesisResult | null>
}) {
  const pending = new WeakSet<WebContents>()
  return async (event: IpcMainInvokeEvent, raw: unknown): Promise<VoicePreviewResult> => {
    if (!options.isAllowedSender(event)) return { ok: false, error: 'unauthorized' }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid-request' }
    const value = raw as Record<string, unknown>
    if (Object.keys(value).some(key => !['provider', 'text', 'endpoint', 'speed'].includes(key)) ||
      (value.provider !== 'http' && value.provider !== 'cloud') || typeof value.text !== 'string' ||
      !value.text.trim() || value.text.length > 120 || typeof value.speed !== 'number' ||
      !Number.isFinite(value.speed) || value.speed < .5 || value.speed > 2 ||
      (value.endpoint !== undefined && (typeof value.endpoint !== 'string' || value.endpoint.length > 2048))) {
      return { ok: false, error: 'invalid-request' }
    }
    if (value.provider === 'http') {
      try {
        const endpoint = new URL(value.endpoint as string)
        if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
          !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname.toLowerCase())) return { ok: false, error: 'invalid-request' }
      } catch { return { ok: false, error: 'invalid-request' } }
    }
    if (pending.has(event.sender)) return { ok: false, error: 'busy' }
    pending.add(event.sender)
    try {
      const result = await options.synthesize({ provider: value.provider as 'http' | 'cloud', text: value.text.trim(), speed: value.speed,
        ...(value.provider === 'http' ? { endpoint: value.endpoint as string } : {}) })
      if (!result) return { ok: false, error: 'not-configured' }
      if (typeof result.audioBase64 !== 'string' || !result.audioBase64 || result.audioBase64.length > 8 * 1024 * 1024 ||
        typeof result.mime !== 'string' || !/^audio\/[a-z0-9.+-]+$/i.test(result.mime)) return { ok: false, error: 'synthesis-failed' }
      return { ok: true, audioBase64: result.audioBase64, mime: result.mime }
    } catch { return { ok: false, error: 'synthesis-failed' } }
    finally { pending.delete(event.sender) }
  }
}
