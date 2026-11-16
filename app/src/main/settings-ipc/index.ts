import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import {
  SETTINGS_CHANNELS,
  type SettingsDocument,
  type SettingsPatchRequest,
  type SettingsService,
  type SettingsState,
  type SettingsWriteResult,
} from '../../shared/settings-contracts'
import {
  SETTINGS_MODE_CHANNEL,
  type SettingsAuthorityMode,
} from '../../shared/settings-integration-contracts'

export interface SettingsIpcOptions {
  mode: SettingsAuthorityMode
  store?: SettingsService | null
  isAllowedSender: (event: IpcMainInvokeEvent) => boolean
  getTargets: () => WebContents[]
}

export { SettingsWindowManager } from './window-manager'
export type { SettingsWindowManagerOptions } from './window-manager'

export interface SettingsIpcController {
  mode: SettingsAuthorityMode
  dispose: () => Promise<void>
}

/**
 * 校验 IPC 发送者合法性：
 * 1. 窗口未销毁且属于已登记目标
 * 2. senderFrame 必须为主 frame，拒绝任意子 frame / iframe 注入
 */
export function isValidSettingsSender(
  event: IpcMainInvokeEvent,
  approvedTargets: WebContents[]
): boolean {
  try {
    const sender = event.sender
    return !!sender && !sender.isDestroyed() && approvedTargets.includes(sender) &&
      !!event.senderFrame && !!sender.mainFrame && event.senderFrame === sender.mainFrame
  } catch {
    return false
  }
}

/** Only the configured page remains eligible after navigation/reload. Query
 * parameters are allowed (the first-run route uses ?onboarding=1), but a
 * different document path is not. */
export function isSettingsPage(target: WebContents, expectedUrl: string): boolean {
  try {
    if (target.isDestroyed()) return false
    const actual = new URL(target.getURL())
    const expected = new URL(expectedUrl)
    return actual.protocol === expected.protocol &&
      actual.host === expected.host &&
      actual.pathname === expected.pathname
  } catch { return false }
}

/**
 * 主进程设置 IPC 注册模块：
 * - 未迁移 stable：legacy 不创建 store，read 返回 null，patch 返回 store-blocked。
 * - canonical-dev / canonical-stable：接入同一 SettingsService 与 revision 广播。
 * - 不暴露 importLegacy 给渲染层。
 */
export function registerSettingsIpc(options: SettingsIpcOptions): SettingsIpcController {
  let isDisposed = false
  let closing: Promise<void> | null = null
  let unsubscribe: (() => void) | null = null

  ipcMain.handle(SETTINGS_MODE_CHANNEL, (event: IpcMainInvokeEvent): SettingsAuthorityMode => {
    if (!options.isAllowedSender(event)) {
      throw new Error('Unauthorized settings IPC sender')
    }
    return options.mode
  })

  ipcMain.handle(SETTINGS_CHANNELS.read, async (event: IpcMainInvokeEvent): Promise<SettingsState | null> => {
    if (!options.isAllowedSender(event)) {
      throw new Error('Unauthorized settings IPC sender')
    }
    if (options.mode === 'legacy') return null
    if (!options.store) return { status: 'blocked', reason: 'io-error', backupAvailable: false }
    try {
      return await options.store.read()
    } catch {
      return { status: 'blocked', reason: 'io-error', backupAvailable: false }
    }
  })

  ipcMain.handle(
    SETTINGS_CHANNELS.patch,
    async (event: IpcMainInvokeEvent, rawRequest: unknown): Promise<SettingsWriteResult> => {
      if (!options.isAllowedSender(event)) {
        return { ok: false, code: 'invalid-request', currentRevision: null }
      }
      if (options.mode === 'legacy' || !options.store) {
        return { ok: false, code: 'store-blocked', currentRevision: null }
      }
      if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)) {
        return { ok: false, code: 'invalid-request', currentRevision: null }
      }
      const req = rawRequest as Partial<SettingsPatchRequest>
      if (
        typeof req.expectedRevision !== 'number' ||
        !Number.isInteger(req.expectedRevision) ||
        req.expectedRevision < 0
      ) {
        return { ok: false, code: 'invalid-request', currentRevision: null }
      }
      if (!req.changes || typeof req.changes !== 'object' || Array.isArray(req.changes)) {
        return { ok: false, code: 'invalid-request', currentRevision: req.expectedRevision }
      }
      try {
        return await options.store.patch(req as SettingsPatchRequest)
      } catch {
        return { ok: false, code: 'io-error', currentRevision: req.expectedRevision }
      }
    }
  )

  if (options.mode !== 'legacy' && options.store) {
    unsubscribe = options.store.subscribe((doc: SettingsDocument) => {
      if (isDisposed) return
      const targets = options.getTargets()
      for (const target of targets) {
        if (target && !target.isDestroyed()) {
          try {
            target.send(SETTINGS_CHANNELS.changed, doc)
          } catch {
            // 忽略销毁中的窗口
          }
        }
      }
    })
  }

  const dispose = (): Promise<void> => {
    if (closing) return closing
    isDisposed = true

    ipcMain.removeHandler(SETTINGS_MODE_CHANNEL)
    ipcMain.removeHandler(SETTINGS_CHANNELS.read)
    ipcMain.removeHandler(SETTINGS_CHANNELS.patch)

    if (unsubscribe) {
      try {
        unsubscribe()
      } catch {
        // ignore
      }
      unsubscribe = null
    }

    closing = (async () => {
      try {
        await options.store?.close()
      } catch {
        // ignore
      }
    })()
    return closing
  }

  return {
    mode: options.mode,
    dispose,
  }
}
