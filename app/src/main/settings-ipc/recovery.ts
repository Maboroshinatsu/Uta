import type { IpcMainInvokeEvent, WebContents } from 'electron'
import type { SettingsService } from '../../shared/settings-contracts'
import type { SettingsRecoveryPreview, SettingsRecoveryResult } from '../../shared/settings-recovery-contracts'

export function createSettingsRecoveryController(options: {
  getStore: () => SettingsService | null | Promise<SettingsService | null>
  isAllowedSender: (event: IpcMainInvokeEvent) => boolean
  recovered: () => void
}) {
  let owner: { sender: unknown; frame: unknown; token: string } | null = null
  let epoch = 0
  const observed = new WeakSet<WebContents>()
  function observe(sender: WebContents) {
    if (observed.has(sender)) return
    observed.add(sender)
    const release = () => { if (owner?.sender === sender) { owner = null; epoch++ } }
    if (typeof sender.on === 'function') {
      sender.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) release() })
      sender.on('render-process-gone', release); sender.once('destroyed', release)
    }
  }
  return {
    async retry(event: IpcMainInvokeEvent): Promise<boolean> {
      if (!options.isAllowedSender(event)) return false
      owner = null; epoch++
      const store = await options.getStore()
      const ready = await store?.retryRead?.() ?? false
      if (ready) options.recovered()
      return ready
    },
    async preview(event: IpcMainInvokeEvent): Promise<SettingsRecoveryPreview> {
      if (!options.isAllowedSender(event)) return { available: false, reason: 'unavailable' }
      const version = ++epoch
      owner = { sender: event.sender, frame: event.senderFrame, token: '' }
      observe(event.sender)
      const store = await options.getStore()
      const result = await store?.previewRecovery?.() ?? { available: false as const, reason: 'unavailable' as const }
      if (version !== epoch) return { available: false, reason: 'unavailable' }
      owner = result.available ? { sender: event.sender, frame: event.senderFrame, token: result.token } : null
      return result
    },
    async restore(event: IpcMainInvokeEvent, token: unknown): Promise<SettingsRecoveryResult> {
      if (!options.isAllowedSender(event)) return { ok: false, code: 'unauthorized' }
      if (!owner || owner.sender !== event.sender || owner.frame !== event.senderFrame || typeof token !== 'string' || token !== owner.token || token.length > 80) return { ok: false, code: 'preview-expired' }
      owner = null
      epoch++
      const store = await options.getStore()
      const result = await store?.restoreBackup?.(token) ?? { ok: false as const, code: 'unavailable' as const }
      if (result.ok) options.recovered()
      return result
    },
  }
}
