import type {
  PublicSettings,
  SettingsConflict,
  SettingsDocument,
  SettingsKey,
  SettingsValue,
  LegacySettingsSource,
  SettingsPatchRequest,
  SettingsImportRequest
} from '../../shared/settings-contracts'

export const MAX_JSON_SIZE_BYTES = 1024 * 1024 // 1 MiB
export const MAX_SOURCES_PER_IMPORT = 16
export const MAX_STORED_RECEIPTS = 64
export const MAX_STORED_CONFLICTS = 128

export const SOURCE_ID_REGEX = /^[a-z0-9][a-z0-9._-]{0,127}$/
export const ACCENT_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/
export const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/

export const SETTINGS_KEYS = Object.freeze([
  'chatDisplayName',
  'themeMode',
  'accentColor',
  'hoverFadeEnabled',
  'gazeFollowEnabled',
  'idleActionsEnabled',
  'orbAction',
  'ttsEnabled',
  'ttsProvider',
  'ttsRate',
  'ttsVolume',
  'ttsSpeakNarration',
  'ttsSpeakReplies'
] as const)

export type ValidSettingsKey = (typeof SETTINGS_KEYS)[number]

export function isSettingsKey(key: string): key is SettingsKey {
  return (SETTINGS_KEYS as readonly string[]).includes(key)
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  try {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  if (proto === null) {
    return true
  }
  let root = proto
  while (Object.getPrototypeOf(root) !== null) {
    root = Object.getPrototypeOf(root)
  }
  return proto === root
  } catch { return false }
}

/** Only enumerable own data properties cross this boundary; never execute getters. */
export function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  try {
    return Reflect.ownKeys(value).every(key => {
      if (typeof key !== 'string' || !allowed.includes(key)) return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return !!descriptor && descriptor.enumerable === true && 'value' in descriptor
    })
  } catch { return false }
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return hasOnlyKeys(value, keys) && Reflect.ownKeys(value).length === keys.length
}

export function hasDangerousKeys(record: Record<string, unknown>): boolean {
  const ownKeys = Object.getOwnPropertyNames(record)
  for (const key of ownKeys) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return true
    }
  }
  return false
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; isFutureSchema?: boolean }

export function validateSingleField(
  key: SettingsKey,
  value: unknown
): ValidationResult<SettingsValue> {
  switch (key) {
    case 'chatDisplayName':
      if (typeof value === 'string' && value.length <= 40 && !/[\u0000-\u001f\u007f]/.test(value)) {
        return { ok: true, value }
      }
      return { ok: false, error: 'Invalid chatDisplayName' }
    case 'themeMode':
      if (value === 'light' || value === 'dark') {
        return { ok: true, value }
      }
      return { ok: false, error: `Invalid themeMode: ${String(value)}` }

    case 'accentColor':
      if (typeof value === 'string' && ACCENT_COLOR_REGEX.test(value)) {
        return { ok: true, value: value.toLowerCase() }
      }
      return { ok: false, error: `Invalid accentColor: ${String(value)}` }

    case 'hoverFadeEnabled':
    case 'gazeFollowEnabled':
    case 'idleActionsEnabled':
    case 'ttsEnabled':
    case 'ttsSpeakNarration':
    case 'ttsSpeakReplies':
      if (typeof value === 'boolean') {
        return { ok: true, value }
      }
      return { ok: false, error: `Invalid boolean for ${key}: ${String(value)}` }

    case 'orbAction':
      if (
        value === 'model_picker' ||
        value === 'toggle_display_mode' ||
        value === 'color_picker' ||
        value === 'toggle_theme'
      ) {
        return { ok: true, value }
      }
      return { ok: false, error: `Invalid orbAction: ${String(value)}` }

    case 'ttsProvider':
      if (value === 'system' || value === 'http' || value === 'cloud') {
        return { ok: true, value }
      }
      return { ok: false, error: `Invalid ttsProvider: ${String(value)}` }

    case 'ttsRate':
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 2.0) {
        return { ok: true, value }
      }
      return { ok: false, error: `Invalid ttsRate (must be 0.5..2): ${String(value)}` }

    case 'ttsVolume':
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0.0 && value <= 1.0) {
        return { ok: true, value }
      }
      return { ok: false, error: `Invalid ttsVolume (must be 0..1): ${String(value)}` }

    default:
      return { ok: false, error: `Unknown settings key: ${String(key)}` }
  }
}

export function validateChanges(raw: unknown): ValidationResult<Partial<PublicSettings>> {
  if (!isPlainObject(raw) || !hasOnlyKeys(raw, SETTINGS_KEYS)) {
    return { ok: false, error: 'Changes must be a plain object without prototype pollution keys' }
  }

  const keys = Object.keys(raw)
  if (keys.length === 0) {
    return { ok: false, error: 'Changes object cannot be empty' }
  }

  const normalized: Partial<PublicSettings> = {}
  for (const k of keys) {
    if (!isSettingsKey(k)) {
      return { ok: false, error: `Unknown setting field in changes: ${k}` }
    }
    const valResult = validateSingleField(k, raw[k])
    if (!valResult.ok) {
      return valResult
    }
    ;(normalized as Record<string, unknown>)[k] = valResult.value
  }

  return { ok: true, value: normalized }
}

export function validateLegacySource(raw: unknown): ValidationResult<LegacySettingsSource> {
  if (!isPlainObject(raw) || !hasExactKeys(raw, ['sourceId', 'values'])) {
    return { ok: false, error: 'Legacy source must be a plain object' }
  }

  if (typeof raw.sourceId !== 'string' || !SOURCE_ID_REGEX.test(raw.sourceId)) {
    return { ok: false, error: `Invalid sourceId: ${String(raw.sourceId)}` }
  }

  const valuesResult = validateChanges(raw.values)
  if (!valuesResult.ok) {
    return { ok: false, error: `Invalid values in legacy source ${raw.sourceId}: ${valuesResult.error}` }
  }

  return {
    ok: true,
    value: {
      sourceId: raw.sourceId,
      values: valuesResult.value
    }
  }
}

function validateDocumentData(raw: unknown): ValidationResult<SettingsDocument> {
  if (!isPlainObject(raw) || hasDangerousKeys(raw)) {
    return { ok: false, error: 'Document must be a plain object without dangerous keys' }
  }

  if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > 1) {
    return { ok: false, error: `Future schemaVersion: ${raw.schemaVersion}`, isFutureSchema: true }
  }

  if (raw.schemaVersion !== 1) {
    return { ok: false, error: `Unsupported schemaVersion: ${String(raw.schemaVersion)}` }
  }
  if (!hasExactKeys(raw, ['schemaVersion', 'revision', 'values', 'claimedKeys', 'imports', 'conflicts'])) {
    return { ok: false, error: 'Unknown document field' }
  }

  if (
    typeof raw.revision !== 'number' ||
    !Number.isSafeInteger(raw.revision) ||
    raw.revision < 0
  ) {
    return { ok: false, error: `Invalid revision: ${String(raw.revision)}` }
  }

  if (!isPlainObject(raw.values) || !hasOnlyKeys(raw.values, SETTINGS_KEYS)) {
    return { ok: false, error: 'Document values must be a plain object' }
  }

  const normalizedValues: Record<string, unknown> = {}
  for (const k of SETTINGS_KEYS) {
    if (!(k in raw.values)) {
      // Older v1 documents predate this preference. Never fill in a lost claimed value.
      if (k === 'chatDisplayName' && Array.isArray(raw.claimedKeys) && !raw.claimedKeys.includes(k)) {
        normalizedValues[k] = ''
        continue
      }
      return { ok: false, error: `Missing required field in values: ${k}` }
    }
    const valResult = validateSingleField(k, raw.values[k])
    if (!valResult.ok) {
      return { ok: false, error: `Document invalid value for ${k}: ${valResult.error}` }
    }
    normalizedValues[k] = valResult.value
  }

  if (!Array.isArray(raw.claimedKeys)) {
    return { ok: false, error: 'Document claimedKeys must be an array' }
  }
  const claimedKeysSet = new Set<SettingsKey>()
  for (const ck of raw.claimedKeys) {
    if (typeof ck !== 'string' || !isSettingsKey(ck)) {
      return { ok: false, error: `Invalid claimedKey: ${String(ck)}` }
    }
    if (claimedKeysSet.has(ck)) {
      return { ok: false, error: `Duplicate claimedKey: ${ck}` }
    }
    claimedKeysSet.add(ck)
  }
  const normalizedClaimedKeys = Array.from(claimedKeysSet).sort()

  if (!Array.isArray(raw.imports)) {
    return { ok: false, error: 'Document imports must be an array' }
  }
  if (raw.imports.length > MAX_STORED_RECEIPTS) {
    return { ok: false, error: `Document imports exceed limit: ${raw.imports.length} > ${MAX_STORED_RECEIPTS}` }
  }
  const normalizedImports: Array<{ sourceId: string; digest: string }> = []
  const receipts = new Set<string>()
  for (const item of raw.imports) {
    if (
      !isPlainObject(item) ||
      !hasExactKeys(item, ['sourceId', 'digest']) ||
      typeof item.sourceId !== 'string' ||
      !SOURCE_ID_REGEX.test(item.sourceId) ||
      typeof item.digest !== 'string' ||
      !SHA256_HEX_REGEX.test(item.digest)
    ) {
      return { ok: false, error: 'Invalid import receipt structure' }
    }
    const identity = JSON.stringify([item.sourceId, item.digest])
    if (receipts.has(identity)) return { ok: false, error: 'Duplicate import receipt' }
    receipts.add(identity)
    normalizedImports.push({ sourceId: item.sourceId, digest: item.digest })
  }

  if (!Array.isArray(raw.conflicts)) {
    return { ok: false, error: 'Document conflicts must be an array' }
  }
  if (raw.conflicts.length > MAX_STORED_CONFLICTS) {
    return { ok: false, error: `Document conflicts exceed limit: ${raw.conflicts.length} > ${MAX_STORED_CONFLICTS}` }
  }
  const normalizedConflicts: SettingsConflict[] = []
  const conflictIds = new Set<string>()
  for (const c of raw.conflicts) {
    if (
      !isPlainObject(c) ||
      !hasExactKeys(c, ['key', 'sourceId', 'sourceDigest', 'current', 'incoming']) ||
      typeof c.key !== 'string' ||
      !isSettingsKey(c.key) ||
      typeof c.sourceId !== 'string' ||
      !SOURCE_ID_REGEX.test(c.sourceId) ||
      typeof c.sourceDigest !== 'string' ||
      !SHA256_HEX_REGEX.test(c.sourceDigest)
    ) {
      return { ok: false, error: 'Invalid conflict structure' }
    }
    const currVal = validateSingleField(c.key, c.current)
    const incVal = validateSingleField(c.key, c.incoming)
    if (!currVal.ok || !incVal.ok) {
      return { ok: false, error: `Invalid values in conflict for key ${c.key}` }
    }
    const identity = JSON.stringify([c.key, c.sourceId, c.sourceDigest])
    if (!claimedKeysSet.has(c.key) || !receipts.has(JSON.stringify([c.sourceId, c.sourceDigest])) ||
        conflictIds.has(identity) || currVal.value === incVal.value) {
      return { ok: false, error: 'Duplicate or inconsistent conflict metadata' }
    }
    conflictIds.add(identity)
    normalizedConflicts.push({
      key: c.key,
      sourceId: c.sourceId,
      sourceDigest: c.sourceDigest,
      current: currVal.value,
      incoming: incVal.value
    })
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      revision: raw.revision,
      values: normalizedValues as unknown as PublicSettings,
      claimedKeys: normalizedClaimedKeys,
      imports: normalizedImports,
      conflicts: normalizedConflicts
    }
  }
}

export function validateDocument(raw: unknown): ValidationResult<SettingsDocument> {
  try { return validateDocumentData(raw) } catch { return { ok: false, error: 'Invalid document' } }
}

/** Snapshot request data synchronously, before placing a transaction on the queue. */
export function validateWriteRequest(raw: unknown, kind: 'patch'): ValidationResult<SettingsPatchRequest>
export function validateWriteRequest(raw: unknown, kind: 'import'): ValidationResult<SettingsImportRequest>
export function validateWriteRequest(raw: unknown, kind: 'patch' | 'import'): ValidationResult<SettingsPatchRequest | SettingsImportRequest> {
  const invalid = { ok: false as const, error: 'Invalid request' }
  try {
    if (!isPlainObject(raw) || !hasExactKeys(raw, ['expectedRevision', kind === 'patch' ? 'changes' : 'sources',
        ...(kind === 'import' && Object.hasOwn(raw, 'selections') ? ['selections'] : [])]) ||
        typeof raw.expectedRevision !== 'number' || !Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision < 0) return invalid
    let value: SettingsPatchRequest | SettingsImportRequest
    if (kind === 'patch') {
      const changes = validateChanges(raw.changes)
      if (!changes.ok) return invalid
      value = { expectedRevision: raw.expectedRevision, changes: changes.value }
    } else {
      if (!Array.isArray(raw.sources) || raw.sources.length === 0 || raw.sources.length > MAX_SOURCES_PER_IMPORT) return invalid
      const sources: LegacySettingsSource[] = [], ids = new Set<string>()
      for (const source of raw.sources) {
        const validated = validateLegacySource(source)
        if (!validated.ok || ids.has(validated.value.sourceId)) return invalid
        ids.add(validated.value.sourceId); sources.push(validated.value)
      }
      value = { expectedRevision: raw.expectedRevision, sources }
      if (Object.hasOwn(raw, 'selections')) {
        if (!isPlainObject(raw.selections)) return invalid
        const keys = [...new Set(sources.flatMap(source => Object.keys(source.values)))].sort()
        if (!hasExactKeys(raw.selections, keys)) return invalid
        const selections: Partial<Record<SettingsKey, string>> = {}
        for (const key of keys) {
          const choice = raw.selections[key]
          if (choice !== 'current' && !sources.some(source => source.sourceId === choice && Object.hasOwn(source.values, key))) return invalid
          selections[key as SettingsKey] = choice as string
        }
        value.selections = selections
      }
    }
    return Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_JSON_SIZE_BYTES ? invalid : { ok: true, value }
  } catch { return invalid }
}
