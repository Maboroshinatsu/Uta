/**
 * Codex 宿主适配器。
 *
 * Codex 通过「插件 hooks + MCP 角色工具」接入桌宠：
 * - hooks 直接向本机运行时投递状态与审批，不经过渲染层的 HostAdapter 契约；
 * - 这个适配器只声明角色工具能力，并用 codex-events.jsonl 的更新时间判断活跃度。
 */
import { createHookHostAdapter } from './hook-host'
import type { HostAdapter } from '../host/contracts'

export interface CodexAdapterOptions {
  /** 由主进程提供的活跃探测（hook 日志是否近期更新） */
  isActive?: () => boolean | Promise<boolean>
}

export function createCodexAdapter(options: CodexAdapterOptions = {}): HostAdapter {
  return createHookHostAdapter({ id: 'codex', isActive: options.isActive })
}
