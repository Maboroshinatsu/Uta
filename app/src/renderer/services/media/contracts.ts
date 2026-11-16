/**
 * 媒体能力契约（第一期只定义，不实现）。
 *
 * 用户要求「先不带语音，但留好接口」。这里把语音/音频的边界固定下来，
 * 第二期接入时只需提供实现，不必改动 UI 与控制器。
 *
 * 约定：
 * - 所有方法在未接入实现时返回明确失败，绝不静默假装成功。
 * - 麦克风相关能力默认关闭，且必须由用户显式授权后才启用。
 */

export type MediaUnavailableReason =
  | 'not-implemented'
  | 'not-configured'
  | 'permission-denied'
  | 'unsupported-platform'

export interface MediaResult<T> {
  ok: boolean
  value?: T
  reason?: MediaUnavailableReason
  /** 面向用户的简短说明 */
  message?: string
}

export interface SpeechRecognitionProvider {
  /** 是否可用（未接入时恒为 false） */
  isAvailable(): boolean
  /** 开始一次录音转写；未实现时返回 not-implemented */
  transcribe(audio: ArrayBuffer): Promise<MediaResult<string>>
}

export interface SpeechSynthesisProvider {
  isAvailable(): boolean
  /** 文本转语音；未实现时返回 not-implemented */
  synthesize(text: string): Promise<MediaResult<ArrayBuffer>>
}

export interface AudioPlaybackProvider {
  isAvailable(): boolean
  play(audio: ArrayBuffer): Promise<MediaResult<void>>
  stop(): void
}

/** 未接入的默认实现：明确返回不可用，不抛异常、不静默成功 */
export function unavailableSpeechRecognition(): SpeechRecognitionProvider {
  return {
    isAvailable: () => false,
    async transcribe() {
      return { ok: false, reason: 'not-implemented', message: '语音识别尚未接入' }
    },
  }
}

export function unavailableSpeechSynthesis(): SpeechSynthesisProvider {
  return {
    isAvailable: () => false,
    async synthesize() {
      return { ok: false, reason: 'not-implemented', message: '语音合成尚未接入' }
    },
  }
}

export function unavailableAudioPlayback(): AudioPlaybackProvider {
  return {
    isAvailable: () => false,
    async play() {
      return { ok: false, reason: 'not-implemented', message: '音频播放尚未接入' }
    },
    stop() { /* 无实现可停 */ },
  }
}
