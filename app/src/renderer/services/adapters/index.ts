/**
 * 适配器注册表：把「宿主 / 适配器 id」映射到适配器工厂。
 *
 * 适配器分两类：
 * - 声明式 HTTP 插件（MaiBot/AstrBot/自定义/外部插件）：清单驱动，设置字段由 manifest 提供；
 * - 工作型宿主（Qoder/Codex/Harness）：保留内置代码。
 */
import type { HostAdapter } from '../host/contracts'
import { createCodexAdapter } from './codex'
import { createQoderAdapter } from './qoder'
import { createAntigravityAdapter } from './antigravity'
import { createHookHostAdapter } from './hook-host'
import { BUILTIN_PLUGIN_MANIFESTS } from './builtin-plugin-manifests'
import { createHttpPluginAdapter } from './plugin-http'
import type { AdapterPluginManifest } from './plugin-manifest'

export type HostCategory = 'agent' | 'adapter'
export type BuiltinHostId =
  | 'qoder'
  | 'antigravity'
  | 'codex'
  | 'claude-code'
  | 'zcode'
  | 'opencode'
  | 'deepseek-harness'
  | 'maibot'
  | 'astrbot'
  | 'fake'
/** 允许外部插件使用新的字符串 ID，同时保留内置 ID 的自动补全 */
export type HostId = BuiltinHostId | (string & {})
export type HostPreference = HostId | 'standalone'

export interface HostRegistration {
  id: HostId
  /** 展示名，用于设置界面 */
  label: string
  /** 宿主大类：工作型宿主 vs 伴侣平台适配器 */
  category: HostCategory
  /** 功能与特点简要描述（大白话） */
  description?: string
  /** 该适配器是否在当前构建中可用 */
  available: boolean
  create: () => HostAdapter
  /** 声明式 HTTP 插件清单（内置或外部） */
  manifest?: AdapterPluginManifest
  pluginSource?: 'builtin' | 'external'
}

/** Qoder 是否正在使用：主进程检查 hook 日志是否近期更新（只读文件时间） */
async function probeQoder(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    const status = await window.utaAPI?.getQoderStatus?.()
    return !!status?.active
  } catch {
    return false
  }
}

/** Antigravity 是否正在使用：主进程检查 hook 日志是否近期更新（只读文件时间） */
async function probeAntigravity(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    const status = await window.utaAPI?.getAntigravityStatus?.()
    return !!status?.active
  } catch {
    return false
  }
}

/** 任意 hook 宿主是否正在使用：只读 hook 日志的更新时间 */
async function probeHookHost(host: string): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    const status = await window.utaAPI?.getHookStatus?.(host)
    return !!status?.active
  } catch {
    return false
  }
}

export function createPluginHostRegistration(
  manifest: AdapterPluginManifest,
  source: 'builtin' | 'external',
): HostRegistration {
  return {
    id: manifest.id,
    label: manifest.name,
    category: 'adapter',
    description: manifest.description,
    available: true,
    create: () => createHttpPluginAdapter(manifest),
    manifest,
    pluginSource: source,
  }
}

/**
 * 已注册的宿主与适配器：
 * - 声明式 HTTP 适配器：内置清单 + 外部插件动态注册；
 * - Agent 工作型宿主：Antigravity, Qoder, Codex, DeepSeek Harness。
 */
export const HOST_REGISTRY: HostRegistration[] = [
  ...BUILTIN_PLUGIN_MANIFESTS.map((manifest) =>
    createPluginHostRegistration(manifest, 'builtin'),
  ),

  // ── Agent 工作型宿主 ──
  {
    id: 'antigravity',
    label: 'Antigravity',
    category: 'agent',
    description: 'MCP 角色工具 + 原生生命周期钩子（需启用 Uta Antigravity 插件）',
    available: true,
    create: () => createAntigravityAdapter({ isActive: probeAntigravity }),
  },
  {
    id: 'qoder',
    label: 'Qoder',
    category: 'agent',
    description: 'MCP 角色工具 + 生命周期钩子状态联动（需安装 Uta Qoder 插件）',
    available: true,
    create: () => createQoderAdapter({ isActive: probeQoder }),
  },
  {
    id: 'codex',
    label: 'Codex',
    category: 'agent',
    description: 'MCP 角色工具 + 生命周期钩子（需启用 Uta Codex 插件）',
    available: true,
    create: () => createCodexAdapter({ isActive: () => probeHookHost('codex') }),
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    category: 'agent',
    description: 'MCP 角色工具 + 生命周期钩子（需启用 Uta Claude Code 插件）',
    available: true,
    create: () =>
      createHookHostAdapter({
        id: 'claude-code',
        isActive: () => probeHookHost('claude-code'),
      }),
  },
  {
    id: 'zcode',
    label: 'ZCode',
    category: 'agent',
    description: 'MCP 角色工具 + 生命周期钩子（需启用 Uta ZCode 插件）',
    available: true,
    create: () =>
      createHookHostAdapter({ id: 'zcode', isActive: () => probeHookHost('zcode') }),
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    category: 'agent',
    description: '原生插件事件与权限审批联动（需启用 Uta OpenCode 插件）',
    available: true,
    create: () =>
      createHookHostAdapter({ id: 'opencode', isActive: () => probeHookHost('opencode') }),
  },
  {
    id: 'deepseek-harness',
    label: 'DeepSeek Harness',
    category: 'agent',
    description: '原生插件事件、RP 注入与交互式任务审批',
    available: true,
    create: () =>
      createHookHostAdapter({ id: 'deepseek-harness', isActive: () => probeHookHost('deepseek-harness') }),
  },
]

/** 外部插件加载成功后动态注册；ID 冲突时拒绝 */
export function registerDynamicHost(registration: HostRegistration): boolean {
  if (HOST_REGISTRY.some((host) => host.id === registration.id)) return false
  HOST_REGISTRY.push(registration)
  return true
}

export function getAgentHosts(): HostRegistration[] {
  return HOST_REGISTRY.filter((h) => h.available && h.category === 'agent')
}

export function getAdapterHosts(): HostRegistration[] {
  return HOST_REGISTRY.filter((h) => h.available && h.category === 'adapter')
}

/** Hide agent hosts that are not present on this machine; keep the bound one visible. */
export function filterAvailableAgentHosts<T extends { id: string }>(
  hosts: readonly T[],
  detectedIds: ReadonlySet<string> | null,
  boundHostId = '',
): T[] {
  if (!detectedIds) return [...hosts]
  return hosts.filter((host) => detectedIds.has(host.id) || host.id === boundHostId)
}

export function findHost(id: string): HostRegistration | undefined {
  return HOST_REGISTRY.find((h) => h.id === id)
}

const HOST_LABEL_FALLBACKS: Record<string, string> = {
  codex: 'Codex',
  'deepseek-harness': 'DeepSeek Harness',
  'claude-code': 'Claude Code',
  zcode: 'ZCode',
  opencode: 'OpenCode',
  qoder: 'Qoder',
  antigravity: 'Antigravity',
  maibot: 'MaiBot 适配器',
  astrbot: 'AstrBot 适配器',
}

/** Stable display name for settings/todo surfaces even before a plugin entry mounts. */
export function hostDisplayName(id: string): string {
  return findHost(id)?.label ?? HOST_LABEL_FALLBACKS[id] ?? id
}
