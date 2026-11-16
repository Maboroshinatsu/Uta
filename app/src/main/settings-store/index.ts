import fsSync from 'node:fs'
import path from 'node:path'
import { platform } from 'node:process'
import {
  AtomicWriter
} from './atomic-writer'
import { SettingsRecovery } from './recovery'
import {
  cloneDocument,
  createDefaultDocument
} from './defaults'
import {
  TransactionQueue
} from './transaction-queue'
import {
  processLegacyImport, applyReviewedSelections
} from './legacy-importer'
import type {
  SettingsDocument,
  SettingsImportRequest,
  SettingsKey,
  SettingsPatchRequest,
  SettingsService,
  SettingsState,
  SettingsStoreOptions,
  SettingsWriteResult
} from './types'
import {
  validateWriteRequest
} from './validator'

const activeStoreDirectories = new Set<string>()

export async function createSettingsStore(
  directory: string,
  options?: SettingsStoreOptions
): Promise<SettingsService> {
  if (typeof directory !== 'string' || directory.trim() === '') {
    throw new Error('Directory path must be a non-empty string')
  }

  if (!path.isAbsolute(directory)) {
    throw new Error(`Directory must be an absolute path: ${directory}`)
  }

  const resolvedDir = path.resolve(directory)
  if (!fsSync.existsSync(resolvedDir)) {
    throw new Error(`Directory does not exist: ${resolvedDir}`)
  }

  const stat = fsSync.statSync(resolvedDir)
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolvedDir}`)
  }

  const canonicalDir = fsSync.realpathSync.native(resolvedDir)
  const directoryKey = platform === 'win32' ? canonicalDir.toLowerCase() : canonicalDir
  if (activeStoreDirectories.has(directoryKey)) {
    throw new Error(`Settings store already open for directory: ${resolvedDir}`)
  }

  activeStoreDirectories.add(directoryKey)

  let writer: AtomicWriter
  let currentDoc: SettingsDocument | null = null
  let currentState: SettingsState
  let isClosed = false
  let hasCommitted = false

  try {
    writer = new AtomicWriter(canonicalDir, options?.io)
    const initial = await writer.readInitialState()

    if (initial.isFirstLaunch && options?.requireExisting) {
      currentState = { status: 'blocked', reason: 'corrupt', backupAvailable: false }
    } else if (initial.isFirstLaunch) {
      currentDoc = createDefaultDocument()
      currentState = {
        status: 'ready',
        document: currentDoc
      }
    } else if (initial.state.status === 'ready') {
      currentDoc = initial.state.document
      currentState = initial.state
      hasCommitted = true
    } else {
      currentState = initial.state
      currentDoc = null
    }
  } catch (err) {
    activeStoreDirectories.delete(directoryKey)
    throw err
  }

  const queue = new TransactionQueue()
  const recovery = new SettingsRecovery(canonicalDir, options?.recoveryIo)
  const listeners = new Set<(document: SettingsDocument) => void>()

  function notifyListeners(doc: SettingsDocument): void {
    const snapshot = cloneDocument(doc)
    for (const listener of Array.from(listeners)) {
      queueMicrotask(() => {
        if (isClosed || !listeners.has(listener)) return
        try {
          listener(cloneDocument(snapshot))
        } catch {
          // 监听器抛错隔离，绝不影响其他监听器或已完成的提交
        }
      })
    }
  }

  /** A patch must not turn a newer/corrupt/external disk state back into the in-memory schema. */
  async function verifyDiskUnchanged(): Promise<SettingsWriteResult | null> {
    if (!currentDoc) return { ok: false, code: 'store-blocked', currentRevision: null }
    let disk
    try {
      disk = await writer.readInitialState()
    } catch {
      return { ok: false, code: 'io-error', currentRevision: currentDoc.revision }
    }
    if (disk.isFirstLaunch) {
      // The first commit may create the file; a missing file after a committed
      // write means it was removed/changed outside this store, so refuse.
      if (!hasCommitted && currentDoc.revision === 0) return null
      return { ok: false, code: 'store-blocked', currentRevision: currentDoc.revision }
    }
    if (disk.state.status !== 'ready') {
      return disk.state.reason === 'io-error'
        ? { ok: false, code: 'io-error', currentRevision: currentDoc.revision }
        : { ok: false, code: 'store-blocked', currentRevision: currentDoc.revision }
    }
    if (disk.state.document.schemaVersion !== currentDoc.schemaVersion ||
      disk.state.document.revision !== currentDoc.revision ||
      JSON.stringify(disk.state.document) !== JSON.stringify(currentDoc)) {
      return { ok: false, code: 'revision-conflict', currentRevision: currentDoc.revision }
    }
    return null
  }

  const service: SettingsService = {
    async ensurePersisted(expectedRevision: number) {
      return queue.enqueue(async (): Promise<SettingsWriteResult> => {
        if (isClosed) return { ok: false, code: 'closed', currentRevision: null }
        if (!currentDoc || currentState.status !== 'ready') return { ok: false, code: 'store-blocked', currentRevision: null }
        if (expectedRevision !== currentDoc.revision) return { ok: false, code: 'revision-conflict', currentRevision: currentDoc.revision }
        try {
          const disk = await writer.readInitialState()
          if (disk.isFirstLaunch) {
            await writer.ensureImportBackup(currentDoc)
            await writer.writeDocument(currentDoc)
            hasCommitted = true
          } else if (disk.state.status !== 'ready' || JSON.stringify(disk.state.document) !== JSON.stringify(currentDoc)) {
            return { ok: false, code: 'revision-conflict', currentRevision: currentDoc.revision }
          }
          return { ok: true, changed: false, document: cloneDocument(currentDoc) }
        } catch { return { ok: false, code: 'io-error', currentRevision: currentDoc.revision } }
      })
    },
    async retryRead() {
      return queue.enqueue(async () => {
        if (isClosed) return false
        if (currentState.status === 'ready') return true
        recovery.clear()
        const reread = await writer.readInitialState()
        if (reread.isFirstLaunch) { currentState = { status: 'blocked', reason: 'corrupt', backupAvailable: false }; return false }
        if (reread.state.status !== 'ready') { currentState = reread.state; return false }
        currentDoc = reread.state.document
        currentState = { status: 'ready', document: currentDoc }
        hasCommitted = true
        notifyListeners(currentDoc)
        return true
      })
    },
    async previewRecovery() {
      return queue.enqueue(async () => {
        if (isClosed) return { available: false as const, reason: 'unavailable' as const }
        if (currentState.status === 'ready') return { available: false as const, reason: 'not-needed' as const }
        if (currentState.reason === 'future-schema') return { available: false as const, reason: 'future-schema' as const }
        return recovery.preview()
      })
    },
    async restoreBackup(token: string) {
      return queue.enqueue(async () => {
        if (isClosed || currentState.status === 'ready') return { ok: false as const, code: 'unavailable' as const }
        if (currentState.reason === 'future-schema') return { ok: false as const, code: 'future-schema' as const }
        const result = await recovery.restore(token)
        if (result.ok && result.document) {
          currentDoc = result.document
          currentState = { status: 'ready', document: currentDoc }
          hasCommitted = true
          notifyListeners(currentDoc)
          return { ok: true as const, retainedOriginal: result.retainedOriginal }
        }
        return result.ok ? { ok: false as const, code: 'unavailable' as const } : result
      })
    },
    async read(): Promise<SettingsState> {
      return queue.enqueue(async () => {
        if (isClosed) {
          if (currentState.status === 'ready' && currentDoc) {
            return {
              status: 'ready',
              document: cloneDocument(currentDoc)
            }
          }
          return { ...currentState }
        }

        if (currentState.status === 'ready' && currentDoc) {
          return {
            status: 'ready',
            document: cloneDocument(currentDoc)
          }
        }
        return { ...currentState }
      })
    },

    async patch(request: SettingsPatchRequest): Promise<SettingsWriteResult> {
      const validated = validateWriteRequest(request, 'patch')
      return queue.enqueue(async () => {
        if (isClosed) {
          return {
            ok: false,
            code: 'closed',
            currentRevision: currentDoc ? currentDoc.revision : null
          }
        }

        if (currentState.status !== 'ready' || !currentDoc) {
          return {
            ok: false,
            code: 'store-blocked',
            currentRevision: null
          }
        }

        if (!validated.ok) {
          return {
            ok: false,
            code: 'invalid-request',
            currentRevision: currentDoc.revision
          }
        }

        if (validated.value.expectedRevision !== currentDoc.revision) {
          return {
            ok: false,
            code: 'revision-conflict',
            currentRevision: currentDoc.revision
          }
        }

        const changes = validated.value.changes
        const touchedKeys = Object.keys(changes) as SettingsKey[]

        let hasEffectiveChange = false
        for (const k of touchedKeys) {
          if (currentDoc.values[k] !== changes[k]) {
            hasEffectiveChange = true
            break
          }
          if (!currentDoc.claimedKeys.includes(k)) {
            hasEffectiveChange = true
            break
          }
        }

        if (!hasEffectiveChange) {
          const hasConflictOnTouched = currentDoc.conflicts.some((c) =>
            touchedKeys.includes(c.key)
          )
          if (hasConflictOnTouched) {
            hasEffectiveChange = true
          }
        }

        if (!hasEffectiveChange) {
          return {
            ok: true,
            changed: false,
            document: cloneDocument(currentDoc)
          }
        }

        if (currentDoc.revision >= Number.MAX_SAFE_INTEGER) {
          return { ok: false, code: 'limit-reached', currentRevision: currentDoc.revision }
        }
        const candidate = cloneDocument(currentDoc)
        candidate.revision += 1

        for (const k of touchedKeys) {
          ;(candidate.values as unknown as Record<string, unknown>)[k] = changes[k]
          if (!candidate.claimedKeys.includes(k)) {
            candidate.claimedKeys.push(k)
          }
        }
        candidate.claimedKeys.sort()

        // 成功 patch 清除所修改字段的所有冲突
        candidate.conflicts = candidate.conflicts.filter(
          (c) => !touchedKeys.includes(c.key)
        )

        const diskCheck = await verifyDiskUnchanged()
        if (diskCheck) return diskCheck
        try {
          await writer.writeDocument(candidate)
        } catch {
          return {
            ok: false,
            code: 'io-error',
            currentRevision: currentDoc.revision
          }
        }

        currentDoc = candidate
        currentState = {
          status: 'ready',
          document: candidate
        }
        hasCommitted = true

        notifyListeners(candidate)

        return {
          ok: true,
          changed: true,
          document: cloneDocument(candidate)
        }
      })
    },

    async importLegacy(request: SettingsImportRequest): Promise<SettingsWriteResult> {
      const validated = validateWriteRequest(request, 'import')
      return queue.enqueue(async () => {
        if (isClosed) {
          return {
            ok: false,
            code: 'closed',
            currentRevision: currentDoc ? currentDoc.revision : null
          }
        }

        if (currentState.status !== 'ready' || !currentDoc) {
          return {
            ok: false,
            code: 'store-blocked',
            currentRevision: null
          }
        }

        if (!validated.ok) {
          return {
            ok: false,
            code: 'invalid-request',
            currentRevision: currentDoc.revision
          }
        }

        if (validated.value.expectedRevision !== currentDoc.revision) {
          return {
            ok: false,
            code: 'revision-conflict',
            currentRevision: currentDoc.revision
          }
        }

        const outcome = processLegacyImport(currentDoc, validated.value.sources)
        if (!outcome.ok) {
          return {
            ok: false,
            code: outcome.code,
            currentRevision: currentDoc.revision
          }
        }

        if (!outcome.changed) {
          return {
            ok: true,
            changed: false,
            document: cloneDocument(currentDoc)
          }
        }

        if (currentDoc.revision >= Number.MAX_SAFE_INTEGER) {
          return { ok: false, code: 'limit-reached', currentRevision: currentDoc.revision }
        }
        const candidate = outcome.candidate
        if (validated.value.selections) {
          applyReviewedSelections(currentDoc, candidate, validated.value.sources, validated.value.selections)
        }
        candidate.revision += 1

        const diskCheck = await verifyDiskUnchanged()
        if (diskCheck) return diskCheck
        try {
          if (validated.value.selections) await writer.ensureImportBackup(currentDoc)
          await writer.writeDocument(candidate)
        } catch {
          return {
            ok: false,
            code: 'io-error',
            currentRevision: currentDoc.revision
          }
        }

        currentDoc = candidate
        currentState = {
          status: 'ready',
          document: candidate
        }
        hasCommitted = true

        notifyListeners(candidate)

        return {
          ok: true,
          changed: true,
          document: cloneDocument(candidate)
        }
      })
    },

    subscribe(listener: (document: SettingsDocument) => void): () => void {
      if (isClosed) {
        return () => {}
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async close(): Promise<void> {
      return queue.enqueue(async () => {
        if (isClosed) return
        isClosed = true
        recovery.clear()
        listeners.clear()
        activeStoreDirectories.delete(directoryKey)
      })
    }
  }

  return service
}
