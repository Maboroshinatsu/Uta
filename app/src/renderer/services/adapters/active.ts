/**
 * 当前生效的宿主适配器与手动选择管理器。
 *
 * 只认用户在设置面板里的明确选择：
 * - 不自动探测宿主、不自动切换、不在偏好宿主离线时降级；
 * - 各适配器自己的连接健康检查（如 MaiBot 的 /health 轮询）保持不变，
 *   那只影响“当前宿主是否在线”的显示，不会改变绑定对象。
 */
import type { HostAdapter, HostConnectionState } from '../host/contracts'
import { findHost, type HostId, type HostPreference } from './index'
import { createFakeHost } from '../host/fake-host'

const PREFERENCE_KEY = 'uta/host-preference'
const HOST_KEY = 'uta/host-id'

/**
 * 宿主 ID 统一前的旧写法。磁盘绑定与 localStorage 里可能仍存着 `harness`，
 * 读到就归一化，否则 findHost 查不到会把合法偏好退成独立运行。
 */
const LEGACY_HOST_IDS: Record<string, string> = { harness: 'deepseek-harness' }
function canonicalHostId(value: string): string {
  return LEGACY_HOST_IDS[value] ?? value
}

type HostChangeListener = (hostId: HostId, state: HostConnectionState) => void
const changeListeners = new Set<HostChangeListener>()

function safeGetItem(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key)
    }
  } catch {}
  return null
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value)
    }
  } catch {}
}

/**
 * A pet profile is bound to exactly one agent platform. The main process owns
 * the binding; the preload snapshot is available before the first adapter is
 * created. Without a binding the pet behaves as standalone.
 */
let dynamicBoundHost: HostPreference | null = null

export function setBoundHostPreference(hostId: HostPreference | null): void {
  dynamicBoundHost = hostId
}

function boundHostPreference(): HostPreference | null {
  if (dynamicBoundHost === 'standalone' || dynamicBoundHost === 'fake') return 'standalone'
  if (dynamicBoundHost) return canonicalHostId(dynamicBoundHost) as HostPreference
  const pref = safeGetItem(PREFERENCE_KEY)
  if (pref === 'standalone') return 'standalone'
  try {
    const hostId = typeof window !== 'undefined' ? window.utaAPI?.petBinding?.binding?.hostId : ''
    if (!hostId || hostId === 'standalone' || hostId === 'fake') return null
    return canonicalHostId(hostId) as HostPreference
  } catch {
    return null
  }
}

/**
 * 读取用户手动选择的宿主。
 * 旧版本可能存过 `auto`：迁移为上次实际绑定的宿主；没有记录则独立待命。
 */
export function getHostPreference(): HostPreference {
  const bound = boundHostPreference()
  if (bound) return bound

  const raw = safeGetItem(PREFERENCE_KEY)
  if (raw === 'standalone') return raw
  if (raw && raw !== 'auto') return canonicalHostId(raw) as HostPreference

  const lastHost = safeGetItem(HOST_KEY)
  if (lastHost && lastHost !== 'fake') {
    // 启动早期外部插件还没注册，只有确认宿主已知时才落盘迁移；
    // 否则会把合法但尚未加载的插件偏好覆盖成 standalone。
    const canonical = canonicalHostId(lastHost)
    if (findHost(canonical)?.available) safeSetItem(PREFERENCE_KEY, canonical)
    return canonical as HostPreference
  }

  safeSetItem(PREFERENCE_KEY, 'standalone')
  return 'standalone'
}

/**
 * 插件加载完成后调用：把未知/不可用的偏好清理为独立运行，
 * 并持久化已经可用的外部插件选择。
 */
export function normalizeHostPreference(): void {
  const bound = boundHostPreference()
  if (bound) {
    safeSetItem(PREFERENCE_KEY, bound)
    return
  }
  const pref = getHostPreference()
  if (pref === 'standalone') {
    safeSetItem(PREFERENCE_KEY, 'standalone')
    return
  }
  safeSetItem(PREFERENCE_KEY, findHost(pref)?.available ? pref : 'standalone')
}

function createFor(id: HostId): HostAdapter {
  const registration = findHost(id)
  if (!registration || !registration.available) {
    return createFakeHost()
  }
  return registration.create()
}

export function toHostId(pref: HostPreference): HostId {
  return pref === 'standalone' ? 'fake' : pref
}

function connectQuietly(adapter: HostAdapter): void {
  try {
    adapter.connect()
  } catch {}
}

let unsubscribeActive: (() => void) | null = null
let active: HostAdapter = createFor(toHostId(getHostPreference()))

/** 把适配器自己的连接状态变化转发给设置面板等订阅者 */
function installAdapter(adapter: HostAdapter): void {
  unsubscribeActive?.()
  unsubscribeActive = null
  active = adapter
  try {
    unsubscribeActive = adapter.subscribe((event) => {
      if (event.kind !== 'connection') return
      // 切换宿主后，旧适配器仍在途的异步探测不得覆盖新宿主状态
      if (active !== adapter) return
      notifyState(adapter.id as HostId, event.state)
    })
  } catch {
    unsubscribeActive = null
  }
}

function notifyState(hostId: HostId, state: HostConnectionState): void {
  for (const listener of changeListeners) {
    try {
      listener(hostId, state)
    } catch {}
  }
}

function notifyChange(): void {
  notifyState(active.id as HostId, active.getConnectionState())
}

installAdapter(active)
connectQuietly(active)

/** 订阅宿主或连接状态切换 */
export function onHostChanged(listener: HostChangeListener): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}

export function getActiveAdapter(): HostAdapter {
  return active
}

export function getActiveHostId(): HostId {
  return active.id as HostId
}

/** 切换到指定宿主（仅由用户手动操作触发） */
export function switchActiveHost(id: HostId): HostAdapter {
  if (active.id === id) {
    if (active.getConnectionState() === 'disconnected') {
      connectQuietly(active)
    }
    return active
  }

  unsubscribeActive?.()
  unsubscribeActive = null
  try {
    active.dispose()
  } catch {}

  const next = createFor(id)
  installAdapter(next)
  safeSetItem(HOST_KEY, id)
  connectQuietly(next)
  notifyChange()
  return next
}

/** 用户手动设定偏好宿主 */
export function setHostPreference(pref: HostPreference): HostAdapter {
  safeSetItem(PREFERENCE_KEY, pref)
  dynamicBoundHost = pref
  return switchActiveHost(toHostId(pref))
}

/** 重新连接当前宿主（用于“重新连接”按钮，不会切换宿主） */
export async function reconnectActiveHost(): Promise<HostId> {
  const adapter = active
  try {
    adapter.disconnect()
  } catch {}
  if (boundHostPreference() && typeof window !== 'undefined' && window.utaAPI?.switchPetHost) {
    const result = await window.utaAPI.switchPetHost(adapter.id)
    if (!result?.ok) throw new Error('当前实例配对失败，请重试。')
  }
  if (active !== adapter) return active.id as HostId
  connectQuietly(adapter)
  notifyChange()
  return active.id as HostId
}

/**
 * 外部插件在启动时异步加载；加载完成后按已保存的偏好补一次绑定。
 * 只处理“偏好宿主现在可用但当前仍是兜底宿主”的情况。
 */
export function reloadActiveHostFromPreference(): void {
  const desired = toHostId(getHostPreference())
  if (active.id === desired) return
  const registration = findHost(desired)
  if (!registration?.available) return
  switchActiveHost(desired)
}

if (typeof window !== 'undefined' && window.utaAPI?.onPetBindingChanged) {
  window.utaAPI.onPetBindingChanged((payload) => {
    const nextHost = payload?.binding?.hostId
    if (nextHost) {
      const canonical = canonicalHostId(nextHost)
      dynamicBoundHost = canonical as HostPreference
      safeSetItem(PREFERENCE_KEY, canonical)
      switchActiveHost(toHostId(canonical as HostPreference))
    } else {
      dynamicBoundHost = 'standalone'
      safeSetItem(PREFERENCE_KEY, 'standalone')
      switchActiveHost('fake')
    }
  })
}
