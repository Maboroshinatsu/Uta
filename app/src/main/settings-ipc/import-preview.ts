import { randomUUID } from 'node:crypto'
import type { IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron'
import type { SettingsService, SettingsKey, SettingsWriteResult, LegacySettingsSource } from '../../shared/settings-contracts'
import type { SettingsImportPreview } from '../../shared/settings-import-contracts'
import { validateWriteRequest } from '../settings-store/validator'
import { computeSourceDigest, processLegacyImport } from '../settings-store/legacy-importer'

export function createSettingsImportController(options: {
  isAllowedSender: (event: IpcMainInvokeEvent) => boolean
  getStore: () => SettingsService | null | Promise<SettingsService | null>
  allowNoSources?: boolean
  onCommitted?: (result: SettingsWriteResult) => Promise<SettingsWriteResult & { restartRequired?: boolean }>
  now?: () => number
}) {
  let pending: { token: string; revision: number; sources: LegacySettingsSource[]; frame: unknown; sender: unknown; expires: number } | null = null
  let epoch = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let owner: { sender: WebContents; frame: WebFrameMain | null } | null = null
  const observed = new WeakSet<WebContents>()
  function invalidate() {
    pending = null; owner = null; epoch++
    if (timer) clearTimeout(timer)
    timer = null
  }
  function observe(sender: WebContents) {
    if (observed.has(sender)) return
    observed.add(sender)
    const release = () => { if (owner?.sender === sender) invalidate() }
    if (typeof sender.on === 'function') {
      sender.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) release() })
      sender.on('render-process-gone', release)
      sender.once('destroyed', release)
    }
  }
  const now = options.now ?? Date.now
  return {
    async preview(event: IpcMainInvokeEvent, raw: unknown) {
      if (!options.isAllowedSender(event)) return { ok: false as const, error: 'unauthorized' }
      invalidate()
      const version = epoch
      owner = { sender: event.sender, frame: event.senderFrame }
      observe(event.sender)
      const store = await options.getStore()
      if (!store) return { ok: false as const, error: 'store-blocked' }
      const state = await store.read()
      if (version !== epoch) return { ok: false as const, error: 'preview-expired' }
      if (state.status !== 'ready') return { ok: false as const, error: 'store-blocked' }
      const validated = options.allowNoSources && Array.isArray(raw) && raw.length === 0
        ? { ok: true as const, value: { sources: [] as LegacySettingsSource[] } }
        : validateWriteRequest({ expectedRevision: state.document.revision, sources: raw }, 'import')
      if (!validated.ok) return { ok: false as const, error: 'invalid-request' }
      if (validated.value.sources.some(source => source.sourceId === 'current')) return { ok: false as const, error: 'invalid-request' }
      const doc = state.document
      const sources = validated.value.sources.filter(source => !doc.imports.some(receipt => receipt.sourceId === source.sourceId && receipt.digest === computeSourceDigest(source.values)))
      const processedSources = validated.value.sources.filter(source => !sources.includes(source)).map(source => source.sourceId)
      if (sources.length && !processLegacyImport(doc, sources).ok) return { ok: false as const, error: 'limit-reached' }
      const keys = [...new Set(sources.flatMap(source => Object.keys(source.values)))].sort() as SettingsKey[]
      const token = randomUUID()
      const preview: SettingsImportPreview = { token, revision: doc.revision, processedSources, existingConflictCount: doc.conflicts.length,
        ...(options.allowNoSources ? { currentValues: { ...doc.values } } : {}),
        rows: keys.map(key => ({ key, current: doc.values[key], claimed: doc.claimedKeys.includes(key),
          options: sources.filter(source => Object.hasOwn(source.values, key)).map(source => ({ sourceId: source.sourceId, value: source.values[key]! })),
        })),
      }
      pending = { token, revision: doc.revision, sources, sender: event.sender, frame: event.senderFrame, expires: now() + 120000 }
      timer = setTimeout(invalidate, 120000)
      timer.unref?.()
      return { ok: true as const, preview }
    },
    async apply(event: IpcMainInvokeEvent, raw: unknown): Promise<SettingsWriteResult | { ok: false; code: 'preview-expired'; currentRevision: null }> {
      const review = pending
      if (!options.isAllowedSender(event)) return { ok: false, code: 'invalid-request', currentRevision: null }
      if (!review || review.sender !== event.sender || review.frame !== event.senderFrame || now() > review.expires ||
        !raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as { token?: unknown }).token !== review.token) {
        return { ok: false, code: 'preview-expired', currentRevision: null }
      }
      const request = raw as Record<string, unknown>
      if (Object.keys(request).some(key => !['token', 'selections'].includes(key))) return { ok: false, code: 'invalid-request', currentRevision: review.revision }
      const noChanges = review.sources.length === 0
      const validated = validateWriteRequest({ expectedRevision: review.revision, sources: review.sources, selections: request.selections }, 'import')
      if (noChanges ? !request.selections || typeof request.selections !== 'object' || Array.isArray(request.selections) || Object.keys(request.selections).length !== 0 : !validated.ok) return { ok: false, code: 'invalid-request', currentRevision: review.revision }
      // Consume before any await so two simultaneous applies cannot share a review.
      invalidate()
      const store = await options.getStore()
      if (!store) return { ok: false, code: 'store-blocked', currentRevision: null }
      let result: SettingsWriteResult
      if (noChanges) {
        const current = await store.read()
        result = current.status !== 'ready' ? { ok: false, code: 'store-blocked', currentRevision: null }
          : current.document.revision !== review.revision ? { ok: false, code: 'revision-conflict', currentRevision: current.document.revision }
          : { ok: true, changed: false, document: current.document }
      } else {
        if (!validated.ok) return { ok: false, code: 'invalid-request', currentRevision: null }
        result = await store.importLegacy(validated.value)
      }
      return options.onCommitted ? options.onCommitted(result) : result
    },
    cancel(event: IpcMainInvokeEvent): boolean {
      if (!options.isAllowedSender(event) || owner?.sender !== event.sender || owner.frame !== event.senderFrame) return false
      invalidate(); return true
    },
    dispose: invalidate,
  }
}
