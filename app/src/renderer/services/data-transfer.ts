import { PUBLIC_SETTINGS_DEFAULTS, type PublicSettings, type SettingsKey } from '../../shared/settings-contracts'
import type { ModelStatePreset } from './live2d/emotion-adapter'
import { createPresetPersistence, PRESET_STORAGE_KEY, type PresetMap } from './preset-persistence'
import { isUserPreset } from './preset-transfer'
import { valid } from '../settings-window/legacy-preferences'
import { isModelCalibrationEntries, type ModelCalibration } from '../../shared/model-calibration-contracts'

const MAX_BYTES = 4 * 1024 * 1024
const SETTINGS_KEYS = Object.keys(PUBLIC_SETTINGS_DEFAULTS) as SettingsKey[]
export interface TransferBundle { kind: 'uta-data-transfer'; version: 2; settings: PublicSettings; presets: PresetMap; calibrations: Record<string, ModelCalibration[]> }

function validCalibrations(value: unknown): value is Record<string, ModelCalibration[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return entries.length <= 100 && entries.every(([signature, list]) => /^uta-live2d-assets-v1:[a-f0-9]{64}$/.test(signature) && isModelCalibrationEntries(list))
}

function readSettings(value: unknown): PublicSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !SETTINGS_KEYS.includes(key as SettingsKey)) ||
    !SETTINGS_KEYS.every(key => key === 'chatDisplayName' && !Object.hasOwn(record, key) ||
      Object.hasOwn(record, key) && valid(key, record[key]))) return null
  return { ...PUBLIC_SETTINGS_DEFAULTS, ...record } as PublicSettings
}

function inspectPresets(raw: string | null, sanitize: (item: ModelStatePreset) => ModelStatePreset): PresetMap | null {
  const storage = { getItem: (key: string) => key === PRESET_STORAGE_KEY ? raw : null, setItem: () => {} }
  const result = createPresetPersistence(storage, sanitize).read()
  return result.ok ? result.map : null
}

export function availablePresetTargets(raw: string | null, sanitize: (item: ModelStatePreset) => ModelStatePreset): string[] | null {
  const map = inspectPresets(raw, sanitize)
  return map ? Object.keys(map) : null
}

/** Export only user-created presets; built-in seed data and credentials are excluded. */
export function buildDataTransfer(settings: unknown, presetRaw: string | null, sanitize: (item: ModelStatePreset) => ModelStatePreset, calibrations: unknown = {}): string | null {
  const publicSettings = readSettings(settings)
  if (!publicSettings || !validCalibrations(calibrations)) return null
  const map = inspectPresets(presetRaw, sanitize)
  if (!map) return null
  const presets: PresetMap = Object.create(null)
  for (const [model, list] of Object.entries(map)) {
    const user = list.filter(isUserPreset)
    if (user.length) presets[model] = user
  }
  const text = JSON.stringify({ kind: 'uta-data-transfer', version: 2, settings: publicSettings, presets, calibrations } satisfies TransferBundle, null, 2)
  return text.length <= MAX_BYTES ? text : null
}

export function parseDataTransfer(raw: string, sanitize: (item: ModelStatePreset) => ModelStatePreset): TransferBundle | null {
  if (!raw || raw.length > MAX_BYTES) return null
  try {
    const doc: unknown = JSON.parse(raw)
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
    const record = doc as Record<string, unknown>
    const settings = readSettings(record.settings)
    if (record.kind !== 'uta-data-transfer' || (record.version !== 1 && record.version !== 2) ||
      Object.keys(record).some(key => !['kind', 'version', 'settings', 'presets', 'calibrations'].includes(key)) || !settings) return null
    const calibrations = record.version === 1 && record.calibrations === undefined ? {} : record.calibrations
    if (!validCalibrations(calibrations)) return null
    const map = inspectPresets(JSON.stringify(record.presets), sanitize)
    if (!map || Object.keys(map).length > 100) return null
    for (const list of Object.values(map)) {
      if (list.length > 500 || list.some(item => !isUserPreset(item))) return null
      if (new Set(list.map(item => item.id)).size !== list.length) return null
    }
    return { kind: 'uta-data-transfer', version: 2, settings, presets: map, calibrations }
  } catch { return null }
}

/** Merge only new IDs and names into explicitly matched model buckets. */
export function mergeDataTransferPresets(
  existingRaw: string | null,
  incoming: PresetMap,
  targets: Record<string, string>,
  allowedTargets: ReadonlySet<string>,
  sanitize: (item: ModelStatePreset) => ModelStatePreset,
): { text: string; imported: number; skipped: number } | null {
  const map = inspectPresets(existingRaw, sanitize)
  if (!map) return null
  let rawMap: Record<string, ModelStatePreset[]>
  try { rawMap = existingRaw ? JSON.parse(existingRaw) : {} } catch { return null }
  let imported = 0, skipped = 0
  for (const [source, list] of Object.entries(incoming)) {
    const target = targets[source]
    if (!target) { skipped += list.length; continue }
    if (!allowedTargets.has(target) || ['__proto__', 'constructor', 'prototype'].includes(target)) return null
    // A missing bucket has not been seeded for this model; creating one here
    // would hide its built-in defaults on first use.
    if (!Object.hasOwn(map, target)) return null
    const current = [...map[target]]
    const rawCurrent = [...rawMap[target]]
    for (const item of list) {
      if (current.some(existing => existing.id === item.id || existing.label.toLowerCase() === item.label.toLowerCase())) {
        skipped++
      } else { current.push(item); rawCurrent.push(item); imported++ }
    }
    map[target] = current
    rawMap[target] = rawCurrent
  }
  const text = JSON.stringify(rawMap)
  return text.length <= MAX_BYTES ? { text, imported, skipped } : null
}
