export const SETTINGS_WINDOW_CHANNELS = Object.freeze({
  ready: 'uta:settings-window:ready',
  closeRequested: 'uta:settings-window:close-requested',
  respond: 'uta:settings-window:respond-close',
  navigateDomain: 'uta:settings-window:navigate-domain',
  domainApplied: 'uta:settings-window:domain-applied',
  modelChanged: 'uta:settings-window:model-changed',
})

export interface SettingsCloseRequest {
  id: number
  reason: 'window' | 'quit'
}

export interface SettingsWindowBridge {
  ready(): Promise<boolean>
  onCloseRequested(listener: (request: SettingsCloseRequest) => void): () => void
  respond(requestId: number, decision: 'close' | 'cancel'): Promise<boolean>
  onNavigateDomain(listener: (domain: string) => void): () => void
  acknowledgeDomain(domain: string): void
  onModelChanged(listener: () => void): () => void
}
