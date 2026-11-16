import type { VoicePreviewRequest, VoicePreviewResult } from '../../shared/voice-preview-contracts'
import { isNaturalAudioEnd } from './tts'

export type VoicePreviewState = 'idle' | 'loading' | 'playing' | 'success' | 'cancelled' | 'error'
class VoicePreviewError extends Error {}
/** One owned audio player. Cancelled synthesis is ignored; repeat clicks never overlap. */
export function createVoicePreview(options: {
  synthesize: (request: VoicePreviewRequest) => Promise<VoicePreviewResult>
  update: (state: VoicePreviewState, message: string) => void
}) {
  let generation = 0, disposed = false, pending = false
  let audio: HTMLAudioElement | null = null, objectUrl: string | null = null
  let finishPlayback: (() => void) | null = null
  let playbackTimer: ReturnType<typeof setTimeout> | null = null
  const update = (state: VoicePreviewState, message: string) => { if (!disposed) options.update(state, message) }
  function releaseAudio() {
    if (playbackTimer) clearTimeout(playbackTimer)
    playbackTimer = null
    const previous = audio
    audio = null
    if (previous) { previous.onended = null; previous.onerror = null; previous.onplaying = null; previous.onpause = null; previous.pause(); previous.removeAttribute('src'); previous.load() }
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = null
    finishPlayback?.(); finishPlayback = null
  }
  function cancel() {
    generation++
    releaseAudio()
    update('cancelled', pending ? '已取消试听，等待当前合成请求结束。' : '已停止试听。')
  }
  return {
    async play(request: VoicePreviewRequest, volume: number): Promise<void> {
      if (disposed || pending || audio) return
      const version = ++generation
      pending = true
      update('loading', '正在合成试听音频…')
      try {
        const result = await options.synthesize(request)
        if (disposed || version !== generation) return
        if (!result.ok) {
          const messages = { unauthorized: '试听连接不可用，请重新打开设置。', 'invalid-request': '请检查服务地址和语速；本地服务只支持回环地址。',
            busy: '上一条合成请求仍在结束，请稍后重试。', 'not-configured': '请先配置并保存云端 API 密钥。', 'synthesis-failed': '语音合成失败，请检查服务是否启动、配置和密钥是否正确。' }
          throw new VoicePreviewError(messages[result.error] ?? '语音合成失败，请检查服务配置。')
        }
        const binary = atob(result.audioBase64)
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: result.mime }))
        const player = audio = new Audio(objectUrl)
        player.volume = Math.max(0, Math.min(1, volume))
        await new Promise<void>((resolve, reject) => {
          finishPlayback = resolve
          player.onplaying = () => { if (version === generation) update('playing', '正在播放试听音频…') }
          player.onended = () => resolve()
          player.onerror = () => reject(new VoicePreviewError('音频无法播放，请检查服务返回的音频格式。'))
          player.onpause = () => { if (!isNaturalAudioEnd(player)) reject(new VoicePreviewError('音频播放被中断，请重试。')) }
          playbackTimer = setTimeout(() => reject(new VoicePreviewError('试听播放超时，已停止。')), 30000)
          void player.play().catch(() => reject(new VoicePreviewError('音频播放失败，请检查系统音频输出后重试。')))
        })
        if (version === generation && !disposed) update('success', '试听播放完成。')
      } catch (error) {
        if (version === generation && !disposed) update('error', error instanceof VoicePreviewError ? error.message : '试听连接失败，请检查服务配置后重试。')
      } finally {
        pending = false
        if (version === generation) releaseAudio()
        else if (!disposed) update('cancelled', '已停止试听，可以重新播放。')
      }
    },
    cancel,
    get busy() { return pending || !!audio },
    dispose() { cancel(); disposed = true },
  }
}
