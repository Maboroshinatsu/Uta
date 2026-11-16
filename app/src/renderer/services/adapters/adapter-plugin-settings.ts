/**
 * 声明式适配器插件的设置存储（localStorage）。
 * 字段类型与默认值全部来自 manifest。
 */
import type { AdapterPluginManifest, PluginSettingField } from './plugin-manifest'

const STORAGE_KEY = 'uta/adapter-plugin-settings'

export type PluginSettingValue = string | number | boolean
export type PluginSettings = Record<string, PluginSettingValue>

function readAll(): Record<string, PluginSettings> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, PluginSettings>)
      : {}
  } catch {
    return {}
  }
}

function writeAll(all: Record<string, PluginSettings>): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {}
}

function coerceField(field: PluginSettingField, raw: unknown): PluginSettingValue {
  if (field.type === 'boolean') {
    return typeof raw === 'boolean' ? raw : field.default === true
  }
  if (field.type === 'number') {
    const value = Number(raw)
    if (!Number.isFinite(value)) return typeof field.default === 'number' ? field.default : 0
    const min = field.min ?? -Infinity
    const max = field.max ?? Infinity
    return Math.min(max, Math.max(min, value))
  }
  if (field.type === 'select') {
    const value = typeof raw === 'string' ? raw : ''
    if (field.options?.some((option) => option.value === value)) return value
    return typeof field.default === 'string' ? field.default : (field.options?.[0]?.value ?? '')
  }
  const value = typeof raw === 'string' ? raw : ''
  if (value) return value
  return typeof field.default === 'string' ? field.default : ''
}

export function getPluginSettings(manifest: AdapterPluginManifest): PluginSettings {
  const all = readAll()
  const stored = { ...(all[manifest.id] ?? {}) }

  const result: PluginSettings = {}
  for (const field of manifest.settings) {
    result[field.key] = coerceField(field, stored[field.key])
  }
  return result
}

export function setPluginSetting(
  manifest: AdapterPluginManifest,
  key: string,
  value: PluginSettingValue,
): void {
  const field = manifest.settings.find((item) => item.key === key)
  if (!field) return
  const all = readAll()
  const current = { ...(all[manifest.id] ?? {}) }
  current[key] = coerceField(field, value)
  all[manifest.id] = current
  writeAll(all)
}

export function getPluginBaseUrl(manifest: AdapterPluginManifest): string {
  const settings = getPluginSettings(manifest)
  const raw = String(settings[manifest.baseUrlSetting] ?? '').trim()
  const fallbackField = manifest.settings.find((field) => field.key === manifest.baseUrlSetting)
  const fallback = typeof fallbackField?.default === 'string' ? fallbackField.default.trim() : ''
  const value = raw || fallback
  return value.replace(/\/+$/, '')
}

export function isHttpBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
