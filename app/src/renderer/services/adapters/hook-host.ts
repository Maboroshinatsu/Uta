/**
 * hook 型宿主适配器。
 *
 * Claude Code / ZCode / Codex / OpenCode 都不经过渲染层的 HostAdapter 契约
 * 传输状态：宿主侧插件直接调用本机运行时，渲染层只负责声明能力与展示活跃度。
 * 活跃度由主进程按 hook 日志的更新时间判断，不读取日志内容。
 */
import {
  NO_CAPABILITIES,
  type HostConnectionEvent,
  type HostAdapter,
  type HostCapabilities,
  type HostConnectionState,
  type HostEventListener,
} from '../host/contracts'

export interface HookHostAdapterOptions {
  id: string
  isActive?: () => boolean | Promise<boolean>
}

export function createHookHostAdapter(options: HookHostAdapterOptions): HostAdapter {
  const listeners = new Set<HostEventListener>()
  const capabilities: HostCapabilities = {
    ...NO_CAPABILITIES,
    characterTools: true,
  }
  let state: HostConnectionState = 'disconnected'
  let refreshTimer: ReturnType<typeof setInterval> | null = null
  let refreshEpoch = 0

  function stopRefreshTimer(): void {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
  }

  function emit(event: HostConnectionEvent): void {
    for (const listener of [...listeners]) listener(event)
  }

  async function refresh(): Promise<void> {
    const epoch = ++refreshEpoch
    let active = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      active = await Promise.race([
        Promise.resolve().then(() => options.isActive?.() ?? false),
        new Promise<false>(resolve => { timeout = setTimeout(() => resolve(false), 5000) }),
      ])
    } catch {
      active = false
    } finally {
      clearTimeout(timeout)
    }
    if (epoch !== refreshEpoch) return
    const next: HostConnectionState = active ? 'connected' : 'disconnected'
    if (next !== state) {
      state = next
      emit({ kind: 'connection', state })
    }
  }

  return {
    id: options.id,
    getCapabilities: () => ({ ...capabilities }),
    getConnectionState: () => state,

    connect() {
      state = 'connecting'
      emit({ kind: 'connection', state })
      void refresh()
      // 宿主插件运行在别的进程里，没有连接回调；定期看 hook 日志是否仍在更新
      stopRefreshTimer()
      refreshTimer = setInterval(() => void refresh(), 15_000)
    },

    disconnect() {
      refreshEpoch++
      stopRefreshTimer()
      state = 'disconnected'
      emit({ kind: 'connection', state })
    },

    subscribe(listener: HostEventListener) {
      listeners.add(listener)
      listener({ kind: 'connection', state })
      return () => {
        listeners.delete(listener)
      }
    },

    // 这些宿主没有开放的外部输入注入接口，如实返回 false
    sendUserText: () => false,
    sendScreenshot: () => false,
    sendModelEmotions: () => false,

    dispose() {
      refreshEpoch++
      stopRefreshTimer()
      listeners.clear()
      state = 'disconnected'
    },
  }
}
