import { watch } from 'vue'
import type { Pinia } from 'pinia'
import { useDeskpetStore } from '@/stores/deskpet'
import { MODEL_PATH_KEY } from '@/services/live2d/model-discovery'
import type { PetSettingsCommand, PetSettingsCommandResult, PetSettingsModelContext } from '../../shared/settings-command-contracts'

/** The settings page owns no model. All model work waits for the pet's receipt. */
export function connectSettingsWindowToPet(pinia: Pinia): () => void {
  const store = useDeskpetStore(pinia)
  let disposed = false
  let transportVersion = 0
  let hydrationVersion = 0
  let model: PetSettingsModelContext | undefined
  let queue: Promise<unknown> = Promise.resolve()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const stops: Array<() => void> = []

  async function send(command: PetSettingsCommand, expected?: PetSettingsModelContext): Promise<PetSettingsCommandResult> {
    const api = window.utaAPI
    if (!api?.runPetSettingsCommand) return { ok: false, error: 'bridge-unavailable' }
    try {
      const result = await api.runPetSettingsCommand(command, expected)
      return result && typeof result.ok === 'boolean' ? result : { ok: false, error: 'invalid-result' }
    } catch { return { ok: false, error: 'bridge-failed' } }
  }

  async function hydrate(attempt = 0): Promise<void> {
    const version = ++hydrationVersion
    const result = await send({ type: 'snapshot' })
    if (disposed || version !== hydrationVersion) return
    const snapshot = result.data as Record<string, unknown> | undefined
    if (result.ok && snapshot && typeof snapshot.modelUrl === 'string' &&
      Number.isSafeInteger(snapshot.modelGeneration) && Number.isSafeInteger(snapshot.petEpoch)) {
      const next = { modelUrl: snapshot.modelUrl, modelGeneration: snapshot.modelGeneration as number, petEpoch: snapshot.petEpoch as number }
      if (model && (next.petEpoch < model.petEpoch ||
        (next.petEpoch === model.petEpoch && next.modelGeneration < model.modelGeneration))) return
      model = next
      store.modelUrl = next.modelUrl
      store.modelLoaded = snapshot.modelLoaded === true
      if (Array.isArray(snapshot.modelControls)) store.modelControls = snapshot.modelControls as typeof store.modelControls
      if (Array.isArray(snapshot.modelSliders)) store.modelSliders = snapshot.modelSliders as typeof store.modelSliders
      if (Array.isArray(snapshot.modelEmotions)) store.modelEmotions = snapshot.modelEmotions as string[]
      if (snapshot.modelCapabilities === null || (snapshot.modelCapabilities && typeof snapshot.modelCapabilities === 'object')) {
        store.modelCapabilities = snapshot.modelCapabilities as typeof store.modelCapabilities
      }
      if (typeof snapshot.activeHoldPresetId === 'string') store.activeHoldPresetId = snapshot.activeHoldPresetId
      if (typeof snapshot.activeRunningPresetId === 'string') store.activeRunningPresetId = snapshot.activeRunningPresetId
      store.emotionAdapter = snapshot.emotionAdapter && typeof snapshot.emotionAdapter === 'object'
        ? snapshot.emotionAdapter as typeof store.emotionAdapter : null
    }
    if ((!result.ok || !store.modelLoaded) && attempt < 3) {
      const timer = setTimeout(() => { timers.delete(timer); void hydrate(attempt + 1) }, 1500)
      timers.add(timer)
    }
  }

  function enqueue(command: PetSettingsCommand, expected?: PetSettingsModelContext): Promise<PetSettingsCommandResult> {
    const version = transportVersion
    const input = JSON.parse(JSON.stringify(command)) as PetSettingsCommand
    const locked = store.presetEditingLocked
    const run = async (expectedModel: PetSettingsModelContext | undefined): Promise<PetSettingsCommandResult> => {
      if (disposed || version !== transportVersion) return { ok: false, error: 'session-closed' }
      let result: PetSettingsCommandResult
      if (!['snapshot', 'inspect-performance', 'preview-head', 'preview-calibration', 'preview-eyes', 'preview-mouth', 'preview-ambient', 'switch-model', 'set-edit-lock', 'set-hold-preset', 'release-workshop', 'reload-settings', 'host-state', 'switch-host', 'reconnect-host'].includes(input.type)) {
        if (!expectedModel) { await hydrate(); return { ok: false, error: 'model-not-ready' } }
        result = await send({ type: 'set-edit-lock', locked }, expectedModel)
        if (!result.ok) {
          if (result.error === 'model-changed' || result.error === 'pet-reloaded') await hydrate()
          if (['timeout', 'session-closed', 'pet-reloaded', 'bridge-failed', 'pet-unavailable'].includes(result.error ?? '')) transportVersion++
          return result
        }
        if (disposed || version !== transportVersion) return { ok: false, error: 'session-closed' }
      }
      if (['preview-head', 'preview-calibration', 'preview-eyes', 'preview-mouth', 'preview-ambient'].includes(input.type) && !expectedModel) { await hydrate(); return { ok: false, error: 'model-not-ready' } }
      result = await send(input, expectedModel)
      if (disposed) return { ok: false, error: 'session-closed' }
      if (!result.ok && ['timeout', 'session-closed', 'pet-reloaded', 'bridge-failed', 'pet-unavailable'].includes(result.error ?? '')) transportVersion++
      if ((input.type === 'switch-model' && result.ok) || result.error === 'model-changed' || result.error === 'pet-reloaded') await hydrate()
      return result
    }
    /** A model switch can land between the user's click and the pet's check; refresh, then retry once with the new binding. */
    const runWithModelRefresh = async (): Promise<PetSettingsCommandResult> => {
      const first = await run(expected)
      if (first.error !== 'model-changed' || !expected) return first
      if (disposed || version !== transportVersion || !model) return first
      if (model.modelUrl === expected.modelUrl &&
        model.modelGeneration === expected.modelGeneration &&
        model.petEpoch === expected.petEpoch) return first
      return run({ ...model })
    }
    const response = queue.then(runWithModelRefresh).catch((): PetSettingsCommandResult => ({ ok: false, error: 'bridge-failed' }))
    queue = response
    return response
  }

  store.registerModelCommandHandler(command => {
    if (command.type === 'release-workshop') {
      transportVersion++
      return send(command)
    }
    return enqueue(command,
      ['snapshot', 'inspect-performance', 'switch-model', 'set-edit-lock', 'set-hold-preset', 'reload-settings', 'host-state', 'switch-host', 'reconnect-host'].includes(command.type) ? undefined : model && { ...model })
  })
  store.registerModelSwitcher(async url => {
    const result = await store.requestModelAction({ type: 'switch-model', url })
    if (!result.ok) throw new Error('model-switch-failed')
  })
  stops.push(watch(() => store.presetEditingLocked, locked => {
    // Acquire only together with a model-bound action; an old draft must not
    // lock a newly loaded model. Unlocks remain independent of model identity.
    if (locked) return
    const version = transportVersion
    void enqueue({ type: 'set-edit-lock', locked }).then(result => {
      if (!disposed && version === transportVersion && !result.ok && store.presetEditingLocked === locked) {
        store.modelActionStatus = 'error'
        store.modelActionMessage = '工坊控制未释放，请检查桌宠连接后重试。'
      }
    })
  }, { flush: 'sync' }))

  let reloadTimer: ReturnType<typeof setTimeout> | null = null
  stops.push(watch(() => [store.ttsEndpoint, store.ttsCloudEndpoint, store.ttsCloudBackend,
    store.ttsCloudModel, store.ttsCloudVoice, store.ttsCloudStyle, store.ttsVoice, store.ttsAutoStyleFromHost], () => {
    if (reloadTimer) { clearTimeout(reloadTimer); timers.delete(reloadTimer) }
    reloadTimer = setTimeout(() => {
      timers.delete(reloadTimer!); reloadTimer = null
      void enqueue({ type: 'reload-settings' })
    }, 250)
    timers.add(reloadTimer)
  }))

  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  const clearRefreshTimer = (): void => {
    if (!refreshTimer) return
    clearTimeout(refreshTimer)
    timers.delete(refreshTimer)
    refreshTimer = null
  }
  const scheduleHydrate = (): void => {
    if (disposed) return
    clearRefreshTimer()
    refreshTimer = setTimeout(() => {
      timers.delete(refreshTimer!)
      refreshTimer = null
      if (!disposed) void hydrate()
    }, 120)
    timers.add(refreshTimer)
  }
  const stopModelChanged = window.utaAPI?.settingsWindow?.onModelChanged?.(() => {
    clearRefreshTimer()
    if (!disposed) void hydrate()
  })
  if (stopModelChanged) stops.push(stopModelChanged)
  /** Older renderer bridges may still signal model switches via storage. */
  const onStorage = (event: StorageEvent): void => {
    if (event.key === MODEL_PATH_KEY) scheduleHydrate()
  }
  window.addEventListener('storage', onStorage)

  void hydrate()
  const dispose = () => {
    if (disposed) return
    disposed = true
    transportVersion++; hydrationVersion++
    for (const stop of stops) stop()
    clearRefreshTimer()
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('pagehide', dispose)
    store.registerModelCommandHandler(null)
    void send({ type: 'release-workshop' })
  }
  window.addEventListener('pagehide', dispose)
  return dispose
}
