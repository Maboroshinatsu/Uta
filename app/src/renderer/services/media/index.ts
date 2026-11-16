/**
 * 媒体能力注册表（第一期：全部为「未接入」）。
 *
 * 第二期接入语音时，在这里替换为真实实现即可，UI 与控制器无需改动。
 */
import {
  unavailableAudioPlayback,
  unavailableSpeechRecognition,
  unavailableSpeechSynthesis,
  type AudioPlaybackProvider,
  type SpeechRecognitionProvider,
  type SpeechSynthesisProvider,
} from './contracts'

export interface MediaProviders {
  stt: SpeechRecognitionProvider
  tts: SpeechSynthesisProvider
  playback: AudioPlaybackProvider
}

let providers: MediaProviders = {
  stt: unavailableSpeechRecognition(),
  tts: unavailableSpeechSynthesis(),
  playback: unavailableAudioPlayback(),
}

export function getMediaProviders(): MediaProviders {
  return providers
}

/** 供第二期接入使用；同时便于测试注入替身 */
export function setMediaProviders(next: Partial<MediaProviders>): void {
  providers = { ...providers, ...next }
}
