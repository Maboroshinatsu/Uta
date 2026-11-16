/**
 * 声明式适配器插件清单。
 *
 * 插件只描述“怎么连、发什么、设置哪些字段”，不携带可执行代码。
 * 清单来自内置包或 %APPDATA%/uta/adapters/<id>/uta-adapter.json。
 */
import type { HostCapabilities } from '../host/contracts'

export type PluginSettingType = 'text' | 'password' | 'number' | 'boolean' | 'select'

export interface PluginSettingOption {
  value: string
  label: string
}

export interface PluginSettingField {
  key: string
  type: PluginSettingType
  label: string
  description?: string
  placeholder?: string
  default?: string | number | boolean
  min?: number
  max?: number
  step?: number
  options?: PluginSettingOption[]
}

/**
 * HTTP 路由模板。body 里的字符串支持以下占位符（可嵌在字符串中）：
 * $text / $base64 / $emotions / $controls / $presets / $now / $requestId
 */
export interface PluginHttpRoute {
  method?: 'GET' | 'POST'
  path: string
  body?: unknown
}

export interface AdapterPluginManifest {
  schemaVersion: 1
  id: string
  name: string
  version: string
  category: 'adapter'
  description?: string
  capabilities: HostCapabilities
  /** 基础地址来自哪个设置字段（该字段必须存在） */
  baseUrlSetting: string
  settings: PluginSettingField[]
  routes: {
    health: PluginHttpRoute
    text: PluginHttpRoute
    screenshot?: PluginHttpRoute
    emotions?: PluginHttpRoute
    controls?: PluginHttpRoute
  }
  /** 健康检查返回 JSON 时要求该字段为真；不填则只看 HTTP 状态 */
  healthOkKey?: string
}

export type ManifestValidationResult =
  | { ok: true; value: AdapterPluginManifest }
  | { ok: false; error: string }

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,39}$/
const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
const HEALTH_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,60}$/
const RESERVED_IDS = new Set(['auto', 'standalone', 'fake'])
const MAX_SETTINGS = 20
const MAX_BODY_BYTES = 16 * 1024

function validateRoutePath(raw: string): string | null {
  if (!raw || raw.length > 220) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  if (/[\s#?\\]/.test(raw)) return null
  // 双重编码的 .. 也可能在服务端被再次解码
  if (/%2e/i.test(raw)) return null
  let decoded = ''
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  if (decoded.split('/').some((segment) => segment === '..' || segment === '.')) return null
  return raw
}

function containsToken(value: unknown, token: string): boolean {
  if (typeof value === 'string') {
    return new RegExp(`\\$${token}\\b`).test(value)
  }
  if (Array.isArray(value)) return value.some((item) => containsToken(item, token))
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) =>
      containsToken(item, token),
    )
  }
  return false
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed
}

function parseCapabilities(raw: unknown): HostCapabilities | null {
  if (!isPlainObject(raw)) return null
  const keys = [
    'statusEvents',
    'assistantText',
    'sendInput',
    'cancelTurn',
    'characterTools',
    'sessionSelection',
  ] as const
  const result = {} as HostCapabilities
  for (const key of keys) {
    const value = raw[key]
    if (typeof value !== 'boolean') return null
    result[key] = value
  }
  return result
}

function parseSetting(raw: unknown, index: number): PluginSettingField | string {
  if (!isPlainObject(raw)) return `settings[${index}] must be an object`
  const key = text(raw.key, 40)
  if (!FIELD_KEY_PATTERN.test(key)) return `settings[${index}].key is invalid`
  const type = raw.type
  if (type !== 'text' && type !== 'password' && type !== 'number' && type !== 'boolean' && type !== 'select') {
    return `settings[${index}].type is unsupported`
  }
  const label = text(raw.label, 60)
  if (!label) return `settings[${index}].label is required`

  const field: PluginSettingField = { key, type, label }
  const description = text(raw.description, 200)
  if (description) field.description = description
  const placeholder = text(raw.placeholder, 120)
  if (placeholder) field.placeholder = placeholder

  if (type === 'boolean') {
    if (raw.default !== undefined && typeof raw.default !== 'boolean') {
      return `settings[${index}].default must be boolean`
    }
    field.default = raw.default === true
  } else if (type === 'number') {
    const defaultValue = raw.default === undefined ? 0 : Number(raw.default)
    if (!Number.isFinite(defaultValue)) return `settings[${index}].default must be a number`
    field.default = defaultValue
    for (const bound of ['min', 'max', 'step'] as const) {
      if (raw[bound] === undefined) continue
      const value = Number(raw[bound])
      if (!Number.isFinite(value)) return `settings[${index}].${bound} must be a number`
      field[bound] = value
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      return `settings[${index}].min must be <= max`
    }
  } else if (type === 'select') {
    if (!Array.isArray(raw.options) || raw.options.length === 0 || raw.options.length > 20) {
      return `settings[${index}].options must contain 1-20 entries`
    }
    const options: PluginSettingOption[] = []
    for (const option of raw.options) {
      if (!isPlainObject(option)) return `settings[${index}].options is invalid`
      const value = text(option.value, 60)
      const optionLabel = text(option.label, 60)
      if (!value || !optionLabel) return `settings[${index}].options is invalid`
      options.push({ value, label: optionLabel })
    }
    field.options = options
    const defaultValue = raw.default === undefined ? options[0].value : String(raw.default)
    if (!options.some((option) => option.value === defaultValue)) {
      return `settings[${index}].default must match an option`
    }
    field.default = defaultValue
  } else {
    if (raw.default !== undefined && typeof raw.default !== 'string') {
      return `settings[${index}].default must be a string`
    }
    field.default = typeof raw.default === 'string' ? raw.default.slice(0, 500) : ''
  }

  return field
}

function parseRoute(raw: unknown, name: string, requireBody: boolean): PluginHttpRoute | string {
  if (!isPlainObject(raw)) return `routes.${name} must be an object`
  const rawPath = text(raw.path, 220)
  const path = validateRoutePath(rawPath)
  if (!path) return `routes.${name}.path is invalid`
  const method = raw.method === undefined ? (name === 'health' ? 'GET' : 'POST') : raw.method
  if (method !== 'GET' && method !== 'POST') return `routes.${name}.method is unsupported`
  if (name === 'health' && method !== 'GET') return 'routes.health.method must be GET'
  if (name !== 'health' && method !== 'POST') return `routes.${name}.method must be POST`
  const route: PluginHttpRoute = { method, path }
  if (raw.body !== undefined) {
    if (!isPlainObject(raw.body)) return `routes.${name}.body must be an object`
    let serialized = ''
    try {
      serialized = JSON.stringify(raw.body)
    } catch {
      return `routes.${name}.body is not JSON serializable`
    }
    if (serialized.length > MAX_BODY_BYTES) return `routes.${name}.body is too large`
    route.body = raw.body
  } else if (requireBody && method === 'POST') {
    route.body = {}
  }
  return route
}

export function validateAdapterManifest(raw: unknown): ManifestValidationResult {
  if (!isPlainObject(raw)) return { ok: false, error: 'manifest must be an object' }
  if (raw.schemaVersion !== 1) return { ok: false, error: 'schemaVersion must be 1' }

  const id = text(raw.id, 40)
  if (!ID_PATTERN.test(id)) return { ok: false, error: 'id is invalid' }
  if (RESERVED_IDS.has(id)) return { ok: false, error: `id "${id}" is reserved` }
  const name = text(raw.name, 60)
  if (!name) return { ok: false, error: 'name is required' }
  const version = text(raw.version, 40)
  if (!version) return { ok: false, error: 'version is required' }
  if (raw.category !== 'adapter') return { ok: false, error: 'category must be "adapter"' }

  const capabilities = parseCapabilities(raw.capabilities)
  if (!capabilities) return { ok: false, error: 'capabilities must contain six boolean fields' }

  if (!Array.isArray(raw.settings) || raw.settings.length > MAX_SETTINGS) {
    return { ok: false, error: `settings must be an array (max ${MAX_SETTINGS} entries)` }
  }
  const settings: PluginSettingField[] = []
  const keys = new Set<string>()
  for (let i = 0; i < raw.settings.length; i++) {
    const field = parseSetting(raw.settings[i], i)
    if (typeof field === 'string') return { ok: false, error: field }
    if (keys.has(field.key)) return { ok: false, error: `duplicate setting key: ${field.key}` }
    keys.add(field.key)
    settings.push(field)
  }

  const baseUrlSetting = text(raw.baseUrlSetting, 40)
  if (!baseUrlSetting) return { ok: false, error: 'baseUrlSetting is required' }
  const baseField = settings.find((field) => field.key === baseUrlSetting)
  if (!baseField) return { ok: false, error: 'baseUrlSetting must reference a settings field' }
  if (baseField.type !== 'text' && baseField.type !== 'password') {
    return { ok: false, error: 'baseUrlSetting must be a text field' }
  }

  if (!isPlainObject(raw.routes)) return { ok: false, error: 'routes is required' }
  const health = parseRoute(raw.routes.health, 'health', false)
  if (typeof health === 'string') return { ok: false, error: health }
  const textRoute = parseRoute(raw.routes.text, 'text', true)
  if (typeof textRoute === 'string') return { ok: false, error: textRoute }

  const routes: AdapterPluginManifest['routes'] = { health, text: textRoute }
  for (const name of ['screenshot', 'emotions', 'controls'] as const) {
    if (raw.routes[name] === undefined) continue
    const route = parseRoute(raw.routes[name], name, true)
    if (typeof route === 'string') return { ok: false, error: route }
    routes[name] = route
  }

  if (!containsToken(textRoute.body, 'text')) {
    return { ok: false, error: 'routes.text.body must contain $text' }
  }
  if (routes.screenshot && !containsToken(routes.screenshot.body, 'base64')) {
    return { ok: false, error: 'routes.screenshot.body must contain $base64' }
  }

  const manifest: AdapterPluginManifest = {
    schemaVersion: 1,
    id,
    name,
    version,
    category: 'adapter',
    capabilities,
    baseUrlSetting,
    settings,
    routes,
  }
  const description = text(raw.description, 300)
  if (description) manifest.description = description
  if (typeof raw.healthOkKey === 'string' && raw.healthOkKey.trim()) {
    const healthOkKey = raw.healthOkKey.trim()
    if (!HEALTH_KEY_PATTERN.test(healthOkKey)) {
      return { ok: false, error: 'healthOkKey is invalid' }
    }
    manifest.healthOkKey = healthOkKey
  }

  return { ok: true, value: manifest }
}
