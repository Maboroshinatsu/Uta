import { BrowserWindow, shell } from 'electron'
import type { WebContents } from 'electron'
import path from 'node:path'
import { isSettingsPage } from './index'
import { SETTINGS_WINDOW_CHANNELS, type SettingsCloseRequest } from '../../shared/settings-window-contracts'

export interface SettingsWindowManagerOptions {
  isStable: boolean
  profile: string
  getAppIconPath: () => string
  settingsPageUrl: string
  getWorkArea?: () => { x: number; y: number; width: number; height: number }
}

export class SettingsWindowManager {
  private window: BrowserWindow | null = null
  private readonly options: SettingsWindowManagerOptions
  private closeGuardReady = false
  private closeApproved = false
  private closeRequest: SettingsCloseRequest | null = null
  private nextCloseId = 0
  private resumeQuit: (() => void) | null = null
  private pendingDomain: string | null = null
  private pendingDomainTimer: ReturnType<typeof setTimeout> | null = null
  private domainRetryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: SettingsWindowManagerOptions) {
    this.options = options
  }

  public getSettingsWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null
  }

  public getWebContents(): WebContents | null {
    const win = this.getSettingsWindow()
    if (!win) return null
    const wc = win.webContents
    return wc && !wc.isDestroyed() ? wc : null
  }

  public openSettingsWindow(onboarding = false, domain?: string): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) {
        this.window.restore()
      }
      this.window.show()
      this.window.focus()
      if (domain) this.queueDomain(this.window, domain)
      return this.window
    }

    const { isStable, profile, getAppIconPath, settingsPageUrl, getWorkArea } = this.options
    const area = getWorkArea?.()
    const width = area ? Math.min(1080, Math.max(480, area.width - 40)) : 880
    const height = area ? Math.min(760, Math.max(420, area.height - 40)) : 640

    const win = new BrowserWindow({
      title: isStable ? 'Uta 设置' : `Uta 设置 [${profile}]`,
      width,
      height,
      minWidth: Math.min(560, width),
      minHeight: Math.min(460, height),
      show: false,
      frame: false,
      thickFrame: true,
      roundedCorners: true,
      transparent: false,
      hasShadow: true,
      alwaysOnTop: false,
      skipTaskbar: false,
      autoHideMenuBar: true,
      icon: getAppIconPath(),
      backgroundColor: '#f4f1e9',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
      },
    })

    this.window = win
    this.resetCloseGuard()

    win.on('close', (event) => {
      if (!this.closeGuardReady || this.closeApproved) return
      event.preventDefault()
      this.closeRequest ??= { id: ++this.nextCloseId, reason: 'window' }
      this.closeRequest.reason = this.resumeQuit ? 'quit' : 'window'
      win.webContents.send(SETTINGS_WINDOW_CHANNELS.closeRequested, { ...this.closeRequest })
    })

    // A new document/process must install its listener before it can guard close.
    win.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      if (this.window === win && isMainFrame && !isInPlace) this.resetCloseGuard()
    })
    win.webContents.on('render-process-gone', () => {
      if (this.window === win) this.resetCloseGuard()
    })
    win.webContents.on('did-finish-load', () => {
      if (this.window !== win || !this.pendingDomain) return
      const domain = this.pendingDomain
      win.webContents.send(SETTINGS_WINDOW_CHANNELS.navigateDomain, domain)
      // 设置页可能还在挂载监听；加载完成后再补一次，避免单次事件落在监听注册之前。
      // 渲染层应用后会发回执，回执一到就取消这次补发。
      if (this.domainRetryTimer) clearTimeout(this.domainRetryTimer)
      this.domainRetryTimer = setTimeout(() => {
        this.domainRetryTimer = null
        if (this.pendingDomain === domain && this.window === win &&
          !win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(SETTINGS_WINDOW_CHANNELS.navigateDomain, domain)
        }
      }, 400)
      this.domainRetryTimer.unref?.()
    })

    // The renderer document is titled "Uta"; keep a distinct settings title so
    // the taskbar button is identifiable while the window is open.
    const windowTitle = isStable ? 'Uta 设置' : `Uta 设置 [${profile}]`
    win.on('page-title-updated', (event) => {
      event.preventDefault()
      win.setTitle(windowTitle)
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })

    win.webContents.on('will-navigate', (event, url) => {
      const current = win.webContents.getURL()
      if (url === current) return
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    })

    win.once('ready-to-show', () => {
      win.show()
    })

    win.on('closed', () => {
      if (this.window === win) {
        const resume = this.resumeQuit
        this.window = null
        this.clearPendingDomain()
        this.resetCloseGuard()
        // Resume outside the original before-quit event, after its veto is applied.
        if (resume) queueMicrotask(resume)
      }
    })

    const target = new URL(settingsPageUrl)
    target.hash = 'settings'
    if (onboarding) target.searchParams.set('onboarding', '1')
    if (domain) target.searchParams.set('domain', domain)
    win.loadURL(target.toString())

    return win
  }

  public closeSettingsWindow(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close()
    }
  }

  /** After sleep, a monitor change or a scaling change, pull the settings window back into view. */
  public ensureOnScreen(): void {
    const win = this.getSettingsWindow()
    const area = this.options.getWorkArea?.()
    if (!win || !area) return
    const bounds = win.getBounds()
    const width = Math.min(bounds.width, area.width)
    const height = Math.min(bounds.height, area.height)
    const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)
    const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)
    if (x !== bounds.x || y !== bounds.y || width !== bounds.width || height !== bounds.height) {
      win.setBounds({ x, y, width, height })
    }
  }

  /**
   * 已加载的窗口立即切页；正在创建/重载的窗口还没挂监听，靠 did-finish-load 补发。
   * 两种情况都先记 pending，避免“导航尚未真正开始但 isLoading 仍为 false”的窗口期。
   */
  private queueDomain(_win: BrowserWindow, domain: string): void {
    this.clearPendingDomain()
    this.pendingDomain = domain
    this.pendingDomainTimer = setTimeout(() => {
      if (this.pendingDomain === domain) this.pendingDomain = null
      this.pendingDomainTimer = null
    }, 5000)
    this.pendingDomainTimer.unref?.()
    const wc = this.getWebContents()
    if (wc && !wc.isLoading()) wc.send(SETTINGS_WINDOW_CHANNELS.navigateDomain, domain)
  }

  /** 渲染层确认已经应用了目标分区，取消可能覆盖用户后续操作的补发。 */
  public acknowledgeDomain(sender: WebContents, domain: string): void {
    if (this.getWebContents() !== sender || this.pendingDomain !== domain) return
    this.clearPendingDomain()
  }

  private clearPendingDomain(): void {
    this.pendingDomain = null
    if (this.pendingDomainTimer) {
      clearTimeout(this.pendingDomainTimer)
      this.pendingDomainTimer = null
    }
    if (this.domainRetryTimer) {
      clearTimeout(this.domainRetryTimer)
      this.domainRetryTimer = null
    }
  }

  private resetCloseGuard(): void {
    this.closeGuardReady = false
    this.closeApproved = false
    this.closeRequest = null
    this.resumeQuit = null
  }

  public enableCloseGuard(): boolean {
    if (!this.getWebContents()) return false
    this.closeGuardReady = true
    if (this.closeRequest) {
      this.getWebContents()!.send(SETTINGS_WINDOW_CHANNELS.closeRequested, { ...this.closeRequest })
    }
    return true
  }

  public respondToClose(requestId: number, decision: 'close' | 'cancel'): boolean {
    const win = this.getSettingsWindow()
    if (!win || this.closeRequest?.id !== requestId) return false
    this.closeRequest = null
    if (decision === 'cancel') {
      this.resumeQuit = null
    } else {
      this.closeApproved = true
      win.close()
      this.closeApproved = false
    }
    return true
  }

  /** A cancelled settings close must also cancel quitting before services shut down. */
  public deferQuitUntilSettingsClosed(resume: () => void): boolean {
    const win = this.getSettingsWindow()
    if (!win) return false
    if (this.resumeQuit) return true
    this.resumeQuit = resume
    win.close()
    return true
  }

  public isRegisteredTarget(target: WebContents): boolean {
    const wc = this.getWebContents()
    if (!wc || wc !== target) return false
    return isSettingsPage(target, this.options.settingsPageUrl)
  }
}
