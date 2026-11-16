import crypto from 'node:crypto'
import {
  cloneDocument
} from './defaults'
import type {
  LegacySettingsSource,
  SettingsConflict,
  SettingsDocument,
  SettingsKey,
  SettingsWriteResult
} from './types'
import {
  MAX_SOURCES_PER_IMPORT,
  MAX_STORED_CONFLICTS,
  MAX_STORED_RECEIPTS,
  isPlainObject,
  validateLegacySource
} from './validator'

export function computeSourceDigest(values: Record<string, unknown>): string {
  const sortedKeys = Object.keys(values).sort()
  const canonicalObj: Record<string, unknown> = {}
  for (const k of sortedKeys) {
    canonicalObj[k] = values[k]
  }
  const canonicalJson = JSON.stringify(canonicalObj)
  return crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex').toLowerCase()
}

export interface ProcessImportResult {
  ok: true
  changed: boolean
  candidate: SettingsDocument
}

export type ImportProcessOutcome =
  | ProcessImportResult
  | { ok: false; code: 'invalid-request' | 'limit-reached' }

export function processLegacyImport(
  currentDoc: SettingsDocument,
  rawSources: unknown
): ImportProcessOutcome {
  if (!Array.isArray(rawSources)) {
    return { ok: false, code: 'invalid-request' }
  }

  if (rawSources.length === 0 || rawSources.length > MAX_SOURCES_PER_IMPORT) {
    return { ok: false, code: 'invalid-request' }
  }

  const validatedSources: LegacySettingsSource[] = []
  const seenSourceIds = new Set<string>()

  for (const item of rawSources) {
    const valResult = validateLegacySource(item)
    if (!valResult.ok) {
      return { ok: false, code: 'invalid-request' }
    }
    if (seenSourceIds.has(valResult.value.sourceId)) {
      return { ok: false, code: 'invalid-request' }
    }
    seenSourceIds.add(valResult.value.sourceId)
    validatedSources.push(valResult.value)
  }

  // 1. 同一次导入先按 sourceId 字典序排序，保证输入排列不影响结果
  const sortedSources = [...validatedSources].sort((a, b) =>
    a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0
  )

  const candidate = cloneDocument(currentDoc)
  let hasAnyChange = false

  for (const source of sortedSources) {
    const digest = computeSourceDigest(source.values as Record<string, unknown>)

    // 检查 (sourceId, digest) 是否已有相同收据
    const receiptExists = candidate.imports.some(
      (imp) => imp.sourceId === source.sourceId && imp.digest === digest
    )
    if (receiptExists) {
      // 相同 (sourceId, digest) 再次导入为 no-op
      continue
    }

    // 记录新收据
    candidate.imports.push({ sourceId: source.sourceId, digest })
    hasAnyChange = true

    // 键名排序逐字段处理
    const sourceKeys = (Object.keys(source.values) as SettingsKey[]).sort()

    for (const key of sourceKeys) {
      const incomingVal = source.values[key]!

      if (!candidate.claimedKeys.includes(key)) {
        // 未声明字段接纳并 claim
        ;(candidate.values as unknown as Record<string, unknown>)[key] = incomingVal
        candidate.claimedKeys.push(key)
        hasAnyChange = true
      } else {
        // 已声明字段
        const currentVal = candidate.values[key]
        if (currentVal !== incomingVal) {
          // 保留当前值，登记冲突
          const duplicateConflict = candidate.conflicts.some(
            (c) =>
              c.key === key &&
              c.sourceId === source.sourceId &&
              c.sourceDigest === digest &&
              c.incoming === incomingVal
          )
          if (!duplicateConflict) {
            candidate.conflicts.push({
              key,
              sourceId: source.sourceId,
              sourceDigest: digest,
              current: currentVal,
              incoming: incomingVal
            })
            hasAnyChange = true
          }
        }
      }
    }
  }

  // 2. 容量检查：收据最多 64，冲突最多 128
  if (candidate.imports.length > MAX_STORED_RECEIPTS) {
    return { ok: false, code: 'limit-reached' }
  }

  if (candidate.conflicts.length > MAX_STORED_CONFLICTS) {
    return { ok: false, code: 'limit-reached' }
  }

  candidate.claimedKeys.sort()

  return {
    ok: true,
    changed: hasAnyChange,
    candidate
  }
}

/** The UI has shown these exact sources. Resolve only this review, preserving older conflict records. */
export function applyReviewedSelections(current: SettingsDocument, candidate: SettingsDocument, sources: LegacySettingsSource[], selections: Partial<Record<SettingsKey, string>>): void {
  for (const [rawKey, choice] of Object.entries(selections)) {
    const key = rawKey as SettingsKey
    const selected = choice === 'current' ? current.values[key] : sources.find(source => source.sourceId === choice)!.values[key]!
    ;(candidate.values as unknown as Record<string, unknown>)[key] = selected
    if (!candidate.claimedKeys.includes(key)) candidate.claimedKeys.push(key)
  }
  candidate.claimedKeys.sort()
  // Import-generated conflicts were explicitly decided. Unshown older records remain intact.
  candidate.conflicts = current.conflicts.map(conflict => ({ ...conflict }))
}
