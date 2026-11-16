import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { SETTINGS_WINDOW_CHANNELS } from '../../shared/settings-window-contracts'
import type { SettingsWindowManager } from './window-manager'

export function registerSettingsWindowLifecycle(
  manager: SettingsWindowManager,
  isAllowed: (event: IpcMainInvokeEvent) => boolean,
): void {
  ipcMain.handle(SETTINGS_WINDOW_CHANNELS.ready, event =>
    isAllowed(event) && manager.enableCloseGuard())
  ipcMain.handle(SETTINGS_WINDOW_CHANNELS.respond, (event, id: unknown, decision: unknown) => {
    if (!isAllowed(event) || !Number.isSafeInteger(id) || (id as number) <= 0 ||
      (decision !== 'close' && decision !== 'cancel')) return false
    return manager.respondToClose(id as number, decision)
  })
  ipcMain.on(SETTINGS_WINDOW_CHANNELS.domainApplied, (event, domain: unknown) => {
    if (typeof domain === 'string') manager.acknowledgeDomain(event.sender, domain)
  })
}
