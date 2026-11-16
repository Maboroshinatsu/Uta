import type { ModelStatePreset } from './live2d/emotion-adapter'

export const PRESET_STORAGE_KEY = 'deskpet/state-presets-v3'
export type PresetMap = Record<string, ModelStatePreset[]>
export type PresetReadResult = { ok: true; map: PresetMap } | { ok: false; error: 'unreadable' | 'invalid' | 'write-failed' }
const MAX_PRESET_TEXT = 4 * 1024 * 1024

/** Profile/origin-local transition storage. Never writes a model resource or accepts a disk path. */
export function createPresetPersistence(storage: Pick<Storage, 'getItem' | 'setItem'>, sanitize: (preset: ModelStatePreset) => ModelStatePreset) {
  function read(): PresetReadResult {
    let raw: string | null
    try { raw = storage.getItem(PRESET_STORAGE_KEY) } catch { return { ok: false, error: 'unreadable' } }
    if (raw === null) return { ok: true, map: {} }
    try {
      if (raw.length > MAX_PRESET_TEXT) throw Error('size')
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('shape')
      const map: PresetMap = {}
      for (const [key, list] of Object.entries(parsed)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key) || !Array.isArray(list)) throw Error('bucket')
        map[key] = list.map(item => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('item')
          const preset = sanitize(item)
          if (!preset.id || !preset.label) throw Error('item')
          return preset
        })
      }
      return { ok: true, map }
    } catch { return { ok: false, error: 'invalid' } }
  }
  function writeBucket(key: string, presets: ModelStatePreset[]): PresetReadResult {
    const latest = read()
    if (!latest.ok) return latest
    try {
      if (!key || ['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('key')
      const clean = presets.map(preset => {
        const value = sanitize(preset)
        if (!value.id || !value.label) throw Error('item')
        return value
      })
      const map = { ...latest.map, [key]: clean }
      const text = JSON.stringify(map)
      if (text.length > MAX_PRESET_TEXT) throw Error('size')
      storage.setItem(PRESET_STORAGE_KEY, text)
      return { ok: true, map }
    } catch { return { ok: false, error: 'write-failed' } }
  }
  return { read, writeBucket }
}
