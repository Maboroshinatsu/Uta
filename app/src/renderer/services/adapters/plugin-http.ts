/**
 * 声明式 HTTP 插件适配器执行器。
 *
 * 只执行 manifest 里声明的固定路由与 JSON 模板，不加载任何第三方代码。
 * 基础地址来自插件设置；路由模板支持少量允许的占位符。
 */
import {
  type HostConnectionEvent,
  type HostAdapter,
  type HostCapabilities,
  type HostConnectionState,
  type HostEventListener,
  type HostUserTextResult,
  type ModelControlPresetSummary,
  type ModelControlSummary,
} from '../host/contracts'
import type { AdapterPluginManifest, PluginHttpRoute } from './plugin-manifest'
import { getPluginBaseUrl, isHttpBaseUrl } from './adapter-plugin-settings'
import { isCompanionHttpHost } from '../../../shared/companion-http-contract'

export interface HttpPluginAdapterOptions {
  fetchFn?: typeof fetch
  /** 测试或特殊场景下覆盖基础地址；默认读取插件设置 */
  getBaseUrl?: () => string
}

const TOKEN_PATTERN = /\$(text|base64|emotions|controls|presets|now|requestId)\b/g
const EXACT_TOKEN_PATTERN = /^\$(text|base64|emotions|controls|presets|now|requestId)$/
const HEALTH_TIMEOUT_MS = 5000
const SEND_TIMEOUT_MS = 10000

function materializeBody(value: unknown, vars: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const exact = EXACT_TOKEN_PATTERN.exec(value)
    if (exact) return vars[exact[1]]
    return value.replace(TOKEN_PATTERN, (_, key: string) => String(vars[key] ?? ''))
  }
  if (Array.isArray(value)) return value.map((item) => materializeBody(item, vars))
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = materializeBody(item, vars)
    }
    return result
  }
  return value
}

export function createHttpPluginAdapter(
  manifest: AdapterPluginManifest,
  options: HttpPluginAdapterOptions = {},
): HostAdapter {
  const listeners = new Set<HostEventListener>()
  const companionHost = isCompanionHttpHost(manifest.id) ? manifest.id : null
  const companionRequest = typeof window !== 'undefined' ? window.utaAPI?.requestCompanionHost : undefined
  const directFetch =
    options.fetchFn ||
    (typeof window !== 'undefined' && typeof window.fetch === 'function'
      ? window.fetch.bind(window)
      : typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'
      ? globalThis.fetch.bind(globalThis)
      : undefined)
  const request = companionHost && !options.fetchFn
    ? companionRequest && (async (base: string, route: string, init: RequestInit) => {
      const status = await companionRequest(companionHost, base, route, typeof init.body === 'string' ? init.body : undefined)
      if (status === null) throw new Error('companion-transport-unconfirmed')
      return new Response(null, { status })
    })
    : directFetch && ((base: string, route: string, init: RequestInit) => directFetch(`${base}${route}`, init))

  const capabilities: HostCapabilities = { ...manifest.capabilities }
  let state: HostConnectionState = 'disconnected'
  let checkTimer: ReturnType<typeof setInterval> | null = null
  /** 每次探测/重连递增；旧请求的迟到结果不得覆盖新状态 */
  let healthEpoch = 0

  function emit(event: HostConnectionEvent): void {
    for (const listener of [...listeners]) listener(event)
  }

  function getBaseUrl(): string {
    const base = (options.getBaseUrl ? options.getBaseUrl() : getPluginBaseUrl(manifest)).replace(
      /\/+$/,
      '',
    )
    return isHttpBaseUrl(base) ? base : ''
  }

  async function checkHealth(): Promise<boolean> {
    if (!request) return false
    const base = getBaseUrl()
    if (!base) return false
    const route = manifest.routes.health
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
    try {
      const res = await request(base, route.path, {
        method: route.method ?? 'GET',
        signal: controller.signal,
      })
      if (!res.ok) return false
      if (!manifest.healthOkKey) return true
      const data = (await res.json()) as Record<string, unknown> | null
      return !!(
        data &&
        Object.prototype.hasOwnProperty.call(data, manifest.healthOkKey) &&
        data[manifest.healthOkKey] === true
      )
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  async function updateConnectionState(): Promise<void> {
    const epoch = ++healthEpoch
    const isOk = await checkHealth()
    if (epoch !== healthEpoch) return
    const next: HostConnectionState = isOk ? 'connected' : 'disconnected'
    if (next !== state) {
      state = next
      emit({ kind: 'connection', state })
    }
  }

  async function sendRouteResult(
    route: PluginHttpRoute | undefined,
    vars: Record<string, unknown>,
    label: string,
  ): Promise<HostUserTextResult> {
    if (!route || !request) return { ok: false, error: 'unsupported', message: '插件没有声明发送路由' }
    const base = getBaseUrl()
    if (!base) return { ok: false, error: 'not-configured', message: '插件还没有配置连接地址' }
    const method = route.method ?? 'POST'
    const init: RequestInit = { method }
    if (method !== 'GET' && route.body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(materializeBody(route.body, vars))
    }
    const controller = new AbortController()
    init.signal = controller.signal
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
    try {
      const res = await request(base, route.path, init)
      if (companionHost && res.status === 401) {
        return { ok: false, error: 'failed', message: `${manifest.name}配对校验失败，请检查桌宠绑定和插件配置` }
      }
      if (companionHost && res.status === 404) {
        return { ok: false, error: 'failed', message: `${manifest.name}插件版本不匹配，请更新适配器` }
      }
      if (!res.ok) return { ok: false, error: 'failed', message: `宿主返回 HTTP ${res.status}` }
      return { ok: true }
    } catch (err) {
      console.debug(`[uta:plugin:${manifest.id}] ${label} failed:`, err)
      return {
        ok: false,
        error: 'failed',
        ...(companionHost ? { delivery: 'unknown' as const } : {}),
        message: companionHost ? '发送结果未确认，请先查看宿主，避免重复发送。'
          : controller.signal.aborted ? '宿主请求超时' : '宿主请求失败',
      }
    } finally {
      clearTimeout(timer)
    }
  }

  function sendRoute(
    route: PluginHttpRoute | undefined,
    vars: Record<string, unknown>,
    label: string,
  ): boolean {
    if (!route || !request || !getBaseUrl()) return false
    void sendRouteResult(route, vars, label).catch(() => {})
    return true
  }

  return {
    id: manifest.id,
    getCapabilities: () => ({ ...capabilities }),
    getConnectionState: () => state,

    connect() {
      state = 'connecting'
      emit({ kind: 'connection', state })
      void updateConnectionState()
      if (!checkTimer) {
        checkTimer = setInterval(() => {
          void updateConnectionState()
        }, 10000)
      }
    },

    disconnect() {
      healthEpoch += 1
      if (checkTimer) {
        clearInterval(checkTimer)
        checkTimer = null
      }
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

    sendUserText(text: string): boolean {
      const trimmed = text.trim()
      if (!trimmed) return false
      return sendRoute(
        manifest.routes.text,
        { text: trimmed, now: Date.now(), requestId: `uta-${crypto.randomUUID()}` },
        'sendUserText',
      )
    },

    sendUserTextReceipt(text: string): Promise<HostUserTextResult> {
      const trimmed = text.trim()
      if (!trimmed) {
        return Promise.resolve({ ok: false, error: 'failed', message: '发送文本为空' })
      }
      return sendRouteResult(
        manifest.routes.text,
        { text: trimmed, now: Date.now(), requestId: `uta-${crypto.randomUUID()}` },
        'sendUserText',
      )
    },

    sendScreenshot(base64: string): boolean {
      if (!base64) return false
      return sendRoute(
        manifest.routes.screenshot,
        { base64, now: Date.now(), requestId: `uta-ss-${crypto.randomUUID()}` },
        'sendScreenshot',
      )
    },

    sendModelEmotions(emotions: string[]): boolean {
      if (!Array.isArray(emotions)) return false
      return sendRoute(manifest.routes.emotions, { emotions }, 'sendModelEmotions')
    },

    sendModelControls(
      controls: ModelControlSummary[],
      presets?: ModelControlPresetSummary[],
    ): boolean {
      return sendRoute(
        manifest.routes.controls,
        { controls: controls || [], presets: presets || [] },
        'sendModelControls',
      )
    },

    dispose() {
      healthEpoch += 1
      if (checkTimer) {
        clearInterval(checkTimer)
        checkTimer = null
      }
      listeners.clear()
      state = 'disconnected'
    },
  }
}
