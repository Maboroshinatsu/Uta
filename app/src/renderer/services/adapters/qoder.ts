/**
 * Qoder 宿主适配器。
 *
 * Qoder 通过「MCP 角色工具 + 生命周期 hooks」接入桌宠，两个方向都不经过
 * 渲染层的 HostAdapter 契约：
 * - 出站：模型调用 MCP 工具 → deskpet-mcp → 本机运行时；
 * - 入站：hooks → 本机运行时 → IPC → 桌宠。
 *
 * 因此这个适配器只做两件事：声明角色工具能力，以及用 Qoder hook 的活跃度
 * （主进程检查 qoder-events.jsonl 的更新时间）判断它是否正在使用。
 * 本适配器不提供 sendInput；已登记的 CLI 由主进程发送桥续跑，桌面版输入仍留在宿主。
 */
import {
  NO_CAPABILITIES,
  type HostConnectionEvent,
  type HostAdapter,
  type HostCapabilities,
  type HostConnectionState,
  type HostEventListener,
} from '../host/contracts'

export interface QoderAdapterOptions {
  /** 由主进程提供的活跃探测（hook 日志是否近期更新） */
  isActive?: () => boolean | Promise<boolean>
}

export function createQoderAdapter(options: QoderAdapterOptions = {}): HostAdapter {
  const listeners = new Set<HostEventListener>()
  const capabilities: HostCapabilities = {
    ...NO_CAPABILITIES,
    // 仅角色工具是确定能力；状态由 hooks 直接进运行时，不走适配器契约
    characterTools: true,
  }
  let state: HostConnectionState = 'disconnected'

  function emit(event: HostConnectionEvent): void {
    for (const listener of [...listeners]) listener(event)
  }

  async function refresh(): Promise<void> {
    let active = false
    try {
      active = options.isActive ? await options.isActive() : false
    } catch {
      active = false
    }
    const next: HostConnectionState = active ? 'connected' : 'disconnected'
    if (next !== state) {
      state = next
      emit({ kind: 'connection', state })
    }
  }

  return {
    id: 'qoder',
    getCapabilities: () => ({ ...capabilities }),
    getConnectionState: () => state,

    connect() {
      state = 'connecting'
      emit({ kind: 'connection', state })
      void refresh()
    },

    disconnect() {
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

    // CLI 输入由主进程按明确登记的目标处理
    sendUserText: () => false,
    sendScreenshot: () => false,
    sendModelEmotions: () => false,

    dispose() {
      listeners.clear()
      state = 'disconnected'
    },
  }
}
