import type { ModelStatePreset } from './live2d/emotion-adapter'

export const PRESET_TRANSFER_VERSION = 1
export const PRESET_TRANSFER_KIND = 'uta-user-presets'
const MAX_TRANSFER_BYTES = 4 * 1024 * 1024
const MAX_TRANSFER_PRESETS = 500

export type PresetImportError =
  | 'too-large'
  | 'invalid-json'
  | 'invalid-envelope'
  | 'model-mismatch'
  | 'empty'
  | 'invalid-preset'
  | 'duplicate-id'
  | 'missing-motion'

export type PresetImportResult =
  | { ok: true; presets: ModelStatePreset[] }
  | { ok: false; error: PresetImportError }

/** Seeded presets also carry custom:true; only an explicit user mark (or a legacy save id) counts. */
export function isUserPreset(preset: ModelStatePreset): boolean {
  return preset.source === 'user' || (!preset.source && preset.id.startsWith('preset_'))
}

/** 可读文件名供导出信息使用，模型匹配以资源签名或完整路径为准。 */
export function modelFileName(url: string): string {
  const cleaned = String(url || '').trim().replace(/\\/g, '/').split(/[?#]/)[0]
  const base = cleaned.slice(cleaned.lastIndexOf('/') + 1)
  try {
    return decodeURIComponent(base).toLowerCase()
  } catch {
    return base.toLowerCase()
  }
}

export function buildPresetExport(
  modelKey: string,
  modelUrl: string,
  presets: ModelStatePreset[],
  exportedAt = new Date().toISOString(),
  modelSignature?: string,
): string {
  return JSON.stringify({
    schemaVersion: PRESET_TRANSFER_VERSION,
    kind: PRESET_TRANSFER_KIND,
    modelKey,
    modelUrl,
    modelFile: modelFileName(modelUrl || modelKey),
    ...(modelSignature ? { modelSignature } : {}),
    exportedAt,
    presets: presets.map(preset => ({ ...preset, custom: true, source: 'user' as const })),
  }, null, 2)
}

export function parsePresetImport(
  raw: string,
  expectedModelKey: string,
  sanitize: (preset: ModelStatePreset) => ModelStatePreset,
  hasMotion?: (group: string, index: number) => boolean,
  expectedModelSignature?: string,
): PresetImportResult {
  if (!raw || raw.length > MAX_TRANSFER_BYTES) return { ok: false, error: 'too-large' }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return { ok: false, error: 'invalid-json' } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'invalid-envelope' }
  }
  const envelope = parsed as Record<string, unknown>
  if (envelope.schemaVersion !== PRESET_TRANSFER_VERSION ||
    envelope.kind !== PRESET_TRANSFER_KIND ||
    typeof envelope.modelKey !== 'string' ||
    !Array.isArray(envelope.presets)) {
    return { ok: false, error: 'invalid-envelope' }
  }
  const normalizeKey = (key: string) => {
    try { return decodeURI(key) } catch { return key }
  }
  const sameModel = typeof envelope.modelSignature === 'string' && expectedModelSignature
    ? envelope.modelSignature === expectedModelSignature
    : normalizeKey(envelope.modelKey) === normalizeKey(expectedModelKey)
  if (!sameModel) {
    return { ok: false, error: 'model-mismatch' }
  }
  if (envelope.presets.length === 0) return { ok: false, error: 'empty' }
  if (envelope.presets.length > MAX_TRANSFER_PRESETS) return { ok: false, error: 'invalid-envelope' }

  const ids = new Set<string>()
  const presets: ModelStatePreset[] = []
  for (const item of envelope.presets) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: 'invalid-preset' }
    }
    let preset: ModelStatePreset
    try { preset = sanitize(item as ModelStatePreset) } catch { return { ok: false, error: 'invalid-preset' } }
    if (!preset.id || !preset.label || !Array.isArray(preset.steps)) {
      return { ok: false, error: 'invalid-preset' }
    }
    if (preset.motion && typeof preset.motion === 'object' && hasMotion &&
      !hasMotion(preset.motion.group, preset.motion.index ?? 0)) {
      return { ok: false, error: 'missing-motion' }
    }
    if (Array.isArray(preset.steps) && hasMotion) {
      for (const step of preset.steps) {
        if (step.motion && typeof step.motion === 'object' &&
          !hasMotion(step.motion.group, step.motion.index ?? 0)) {
          return { ok: false, error: 'missing-motion' }
        }
      }
    }
    if (ids.has(preset.id)) return { ok: false, error: 'duplicate-id' }
    ids.add(preset.id)
    presets.push({ ...preset, custom: true, source: 'user' })
  }
  return { ok: true, presets }
}
