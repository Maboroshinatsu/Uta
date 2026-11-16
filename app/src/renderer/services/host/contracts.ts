/**
 * 宿主接入契约（DP-017）。
 *
 * 本文件是“宿主无关”的边界定义，刻意不 import Vue / Pinia / Electron / DOM / Node fs。
 * 目的：让不同 Agent 宿主（MaiBot、Codex、Harness、Fake）只实现同一组接口，
 * 而 Core 与 UI 不感知具体宿主。
 *
 * 入站指令统一走协议 v2 运行时桥，不再经过本契约；
 * 适配器只负责声明能力、汇报连接状态与发送反向命令。
 */

/** 连接状态（宿主无关，不含任何 WebSocket 细节） */
export type HostConnectionState = 'disconnected' | 'connecting' | 'connected'

/** 宿主声明的能力。UI 只根据能力决定展示什么，不去猜宿主类型。 */
export interface HostCapabilities {
  /** 能推送任务状态（工作中/等待/失败/完成） */
  statusEvents: boolean
  /** 能提供助手可见文本 */
  assistantText: boolean
  /** 能把用户输入送回宿主会话 */
  sendInput: boolean
  /** 能取消进行中的轮次 */
  cancelTurn: boolean
  /** 能接收角色类指令（表情/动作/通知） */
  characterTools: boolean
  /** 能选择/绑定具体会话 */
  sessionSelection: boolean
}

export const NO_CAPABILITIES: HostCapabilities = {
  statusEvents: false,
  assistantText: false,
  sendInput: false,
  cancelTurn: false,
  characterTools: false,
  sessionSelection: false,
}

export type DeskpetControlAction = 'on' | 'off' | 'toggle' | 'reset' | 'reset_transient' | 'set' | 'preset'

export interface ModelControlSummary {
  id: string
  label: string
  category: string
  active: boolean
}

export interface ModelControlPresetSummary {
  id: string
  label: string
  controls: string[]
  emotion: string
  description: string
  parameters?: Record<string, number>
  custom?: boolean
}

/**
 * 适配器唯一会主动推送的事件：连接状态。
 * 助手文本、情绪、审批等入站消息由运行时桥按会话投递，不在这里重复定义。
 */
export type HostConnectionEvent = { kind: 'connection'; state: HostConnectionState }

/** 订阅回调 */
export type HostEventListener = (event: HostConnectionEvent) => void

/**
 * 宿主适配器：连接 + 声明能力 + 事件订阅 + 允许的反向命令。
 * 不负责角色渲染、窗口行为、音频播放或任意文件访问。
 */
export interface HostUserTextResult {
  ok: boolean
  delivery?: import('../../../shared/host-delivery').HostDeliveryState
  error?: 'unsupported' | 'not-configured' | 'failed'
  message?: string
}

export interface HostAdapter {
  /** 稳定标识，用于日志与去重（例如 'maibot'、'codex'、'fake'） */
  readonly id: string
  connect(): void
  disconnect(): void
  getConnectionState(): HostConnectionState
  getCapabilities(): HostCapabilities
  /** 订阅连接状态；返回取消订阅函数 */
  subscribe(listener: HostEventListener): () => void
  /** 以下反向命令在不支持时应返回 false，而不是静默丢弃 */
  sendUserText(text: string): boolean
  /** Optional awaitable receipt for transports that can report delivery failure. */
  sendUserTextReceipt?(text: string): Promise<HostUserTextResult>
  sendScreenshot(base64: string): boolean
  sendModelEmotions(emotions: string[]): boolean
  sendModelControls?(controls: ModelControlSummary[], presets?: ModelControlPresetSummary[]): boolean
  dispose(): void
}
