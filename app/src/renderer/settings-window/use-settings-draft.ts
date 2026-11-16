import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { PUBLIC_SETTINGS_DEFAULTS, type PublicSettings, type SettingsDocument, type SettingsKey } from '../../shared/settings-contracts'
import type { SettingsClient } from '../services/settings-client/client'
import { PUBLIC_SETTINGS_KEYS as keys } from '../services/settings-client/types'

const equal = (key: SettingsKey, left: PublicSettings, right: PublicSettings): boolean =>
  key === 'accentColor' ? left.accentColor.toLowerCase() === right.accentColor.toLowerCase() : left[key] === right[key]

/**
 * Public preferences write on change. `draft` mirrors the committed document
 * while keeping values typed during an in-flight write; `baseline` always
 * follows the last committed revision.
 */
export function useSettingsDraft(client: Pick<SettingsClient, 'getCurrentDocument' | 'subscribe' | 'patch'>) {
  const baseline = ref<SettingsDocument | null>(null)
  const draft = ref<PublicSettings>({ ...PUBLIC_SETTINGS_DEFAULTS })
  const saveStatus = ref<'idle' | 'saving' | 'success' | 'error'>('idle')
  const errorMessage = ref('')
  const versions = Object.fromEntries(keys.map(key => [key, 0])) as Record<SettingsKey, number>
  let applyingSnapshot = false
  let alive = true
  let unsubscribe: (() => void) | null = null
  let successTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let queued: Partial<PublicSettings> = {}
  let saveChain: Promise<void> = Promise.resolve()
  let pendingWrite: { versions: Record<SettingsKey, number>; keys: SettingsKey[] } | null = null
  const failedKeys = new Set<SettingsKey>()

  const currentRevision = computed(() => baseline.value?.revision ?? null)

  function uncommittedKeys(scope: readonly SettingsKey[] = keys): SettingsKey[] {
    if (!baseline.value) return []
    return scope.filter(key => !equal(key, draft.value, baseline.value!.values))
  }

  function settleStatus(): void {
    if (failedKeys.size > 0) markError('部分设置尚未保存，正在重试。')
    else markSuccess()
  }

  function applyDraft(values: PublicSettings): void {
    applyingSnapshot = true
    try { draft.value = { ...values } } finally { applyingSnapshot = false }
  }

  // Synchronous versions let a broadcast keep input typed while a write was in flight.
  for (const key of keys) watch(() => draft.value[key], () => {
    if (applyingSnapshot) return
    versions[key]++
    if (saveStatus.value === 'success') saveStatus.value = 'idle'
  }, { flush: 'sync' })

  function syncFromDocument(document: SettingsDocument): void {
    const previous = baseline.value
    if (previous && document.revision <= previous.revision) return
    if (!previous) {
      baseline.value = { ...document, values: { ...document.values } }
      applyDraft(document.values)
      return
    }
    const nextDraft = { ...draft.value }
    for (const key of keys) {
      const editedDuringWrite = pendingWrite !== null && pendingWrite.keys.includes(key) &&
        versions[key] !== pendingWrite.versions[key]
      const localEdit = editedDuringWrite || !equal(key, draft.value, previous.values)
      if (!localEdit) nextDraft[key] = document.values[key] as never
    }
    baseline.value = { ...document, values: { ...document.values } }
    applyDraft(nextDraft)
    for (const key of [...failedKeys]) {
      if (equal(key, nextDraft, document.values)) failedKeys.delete(key)
    }
    if (failedKeys.size === 0 && saveStatus.value === 'error' && uncommittedKeys().length === 0) {
      markSuccess()
    }
  }

  onMounted(() => {
    unsubscribe = client.subscribe(syncFromDocument)
    const initial = client.getCurrentDocument()
    if (initial) syncFromDocument(initial)
  })

  onUnmounted(() => {
    alive = false
    unsubscribe?.()
    if (successTimer !== null) clearTimeout(successTimer)
    if (retryTimer !== null) clearTimeout(retryTimer)
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    successTimer = null
    retryTimer = null
    debounceTimer = null
    pendingWrite = null
    queued = {}
  })

  function markSuccess(): void {
    saveStatus.value = 'success'
    errorMessage.value = ''
    if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null }
    if (successTimer !== null) clearTimeout(successTimer)
    successTimer = setTimeout(() => {
      successTimer = null
      if (alive && saveStatus.value === 'success') saveStatus.value = 'idle'
    }, 2200)
  }

  function markError(message: string): void {
    saveStatus.value = 'error'
    errorMessage.value = message
  }

  async function writeOnce(scope: SettingsKey[]): Promise<'ok' | 'conflict' | 'error' | 'closed'> {
    if (!alive || !baseline.value) return 'closed'
    const changes: Partial<PublicSettings> = {}
    for (const key of scope) {
      const raw = draft.value[key]
      const value = key === 'accentColor' ? String(raw).toLowerCase() : raw
      const committed = baseline.value.values[key]
      const changed = key === 'accentColor'
        ? String(value) !== String(committed).toLowerCase()
        : value !== committed
      if (changed) (changes as Record<string, unknown>)[key] = value
    }
    const changedKeys = Object.keys(changes) as SettingsKey[]
    if (changedKeys.length === 0) {
      for (const key of scope) failedKeys.delete(key)
      if (failedKeys.size === 0 && saveStatus.value === 'error') markSuccess()
      return 'ok'
    }

    saveStatus.value = 'saving'
    errorMessage.value = ''
    const attempt = { versions: { ...versions }, keys: changedKeys }
    pendingWrite = attempt
    let result: Awaited<ReturnType<typeof client.patch>>
    try {
      result = await client.patch(changes)
    } catch {
      result = { ok: false, code: 'io-error', currentRevision: baseline.value.revision }
    } finally {
      if (pendingWrite === attempt) pendingWrite = null
    }
    if (!alive) return 'closed'
    if (result.ok) {
      if (result.document) syncFromDocument(result.document)
      for (const key of changedKeys) failedKeys.delete(key)
      settleStatus()
      return 'ok'
    }
    const current = client.getCurrentDocument()
    if (current) syncFromDocument(current)
    if (result.code === 'revision-conflict') return 'conflict'
    for (const key of changedKeys) failedKeys.add(key)
    markError(result.code === 'store-blocked'
      ? '设置存储暂不可用，改动尚未保存。'
      : '设置未能保存到本机，改动会继续重试。')
    return 'error'
  }

  function scheduleRetry(): void {
    if (retryTimer !== null) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (!alive) return
      const scope = [...failedKeys]
      if (scope.length > 0) void enqueue(scope)
    }, 1800)
  }

  function enqueue(scope: SettingsKey[]): Promise<void> {
    if (!alive || scope.length === 0) return saveChain
    saveChain = saveChain.then(async () => {
      for (let attempt = 0; attempt < 3 && alive; attempt++) {
        const outcome = await writeOnce(scope)
        if (outcome === 'closed') return
        if (outcome === 'conflict') continue
        if (outcome === 'error') scheduleRetry()
        return
      }
      for (const key of uncommittedKeys(scope)) failedKeys.add(key)
      markError('设置被其他窗口连续修改，未能保存。请再改一次以重试。')
      scheduleRetry()
    }).catch(() => {})
    return saveChain
  }

  function flushQueued(): Promise<void> {
    if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null }
    const patch = queued
    queued = {}
    const scope = keys.filter(key => key in patch)
    if (scope.length === 0) return saveChain
    return enqueue(scope)
  }

  /**
   * Apply a change immediately, or merge it into a short debounce for
   * continuous controls such as sliders and the colour picker.
   */
  function applyInstant(patch: Partial<PublicSettings>, debounceMs = 0): void {
    const present = keys.filter(key => key in patch)
    if (present.length === 0) return
    const picked: Partial<PublicSettings> = {}
    for (const key of present) {
      ;(draft.value as Record<string, unknown>)[key] = patch[key]
      ;(picked as Record<string, unknown>)[key] = patch[key]
    }
    queued = { ...queued, ...picked }
    if (debounceMs > 0) {
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        void flushQueued()
      }, debounceMs)
    } else {
      void flushQueued()
    }
  }

  function flushPending(): Promise<void> {
    return flushQueued()
  }

  function hasPending(): boolean {
    return debounceTimer !== null ||
      Object.keys(queued).length > 0 ||
      saveStatus.value === 'saving' ||
      failedKeys.size > 0 ||
      uncommittedKeys().length > 0
  }

  function retryNow(): Promise<void> {
    if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null }
    saveStatus.value = 'idle'
    errorMessage.value = ''
    const scope = [...new Set([...failedKeys, ...uncommittedKeys()])]
    if (scope.length === 0) {
      failedKeys.clear()
      markSuccess()
      return saveChain
    }
    return enqueue(scope)
  }

  return {
    draft, currentRevision, saveStatus, errorMessage,
    applyInstant, flushPending, hasPending, retryNow,
  }
}
