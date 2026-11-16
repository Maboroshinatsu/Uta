export interface VoicePreviewRequest {
  provider: 'http' | 'cloud'
  text: string
  endpoint?: string
  speed: number
}
export type VoicePreviewResult =
  | { ok: true; audioBase64: string; mime: string }
  | { ok: false; error: 'unauthorized' | 'invalid-request' | 'busy' | 'not-configured' | 'synthesis-failed' }
