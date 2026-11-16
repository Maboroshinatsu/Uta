export interface HostInputStatus {
  hostId: string
  supported: boolean
  configured: boolean
  ready: boolean
  mode: 'queue' | 'resume' | 'native' | null
  detail: string
  targetSession?: { sessionId: string; title?: string }
}
