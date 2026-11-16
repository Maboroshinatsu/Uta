import type { useDeskpetStore } from '../stores/deskpet'
import type { PetSettingsCommandResult, PetSettingsDispatch } from '../../shared/settings-command-contracts'
import type { ModelStatePreset, PresetFinishMode, PresetKeyframeStep } from '../services/live2d/emotion-adapter'
import type { DeskpetModel } from '../services/live2d/loader'
import type { DeskpetControlAction } from '../services/host/contracts'
import { inspectModelPerformance, semanticToRaw, startAmbientDemo, startEyePerformance, startModelPerformance, startMouthPerformance, stopModelPerformance } from '../services/performance/model-runtime'

export function createPetSettingsExecutor(options: {
  store: ReturnType<typeof useDeskpetStore>
  getModelKind: () => string
  switchModel: (url: string) => Promise<void>
  releaseWorkshop: () => void
  resetTransientParametersToHome?: (model: DeskpetModel) => void
  host?: {
    getPreference: () => string
    getActiveHostId: () => string
    getConnectionState: () => string
    isKnownPreference: (preference: string) => boolean
    switchPreference: (preference: string) => boolean | Promise<boolean>
    reconnect: () => boolean | Promise<boolean>
  }
}) {
  const { store } = options
  function hostSnapshot() {
    if (!options.host) return { preference: 'standalone', activeHostId: 'standalone', state: 'disconnected' }
    return {
      preference: options.host.getPreference(),
      activeHostId: options.host.getActiveHostId(),
      state: options.host.getConnectionState(),
    }
  }
  let session = 0
  let releasedThrough = 0
  let previousModel = store.live2dModel
  let previousUrl = store.modelUrl
  let generation = 0
  let activePreviewOwner: object | null = null
  const failure = (error: string): PetSettingsCommandResult => ({ ok: false, error })
  function beginPreview(): object {
    const owner = {}
    activePreviewOwner = owner
    return owner
  }
  function finishPreview(owner: object): void {
    if (activePreviewOwner !== owner) return
    activePreviewOwner = null
    options.releaseWorkshop()
  }
  function abandonPreviewOwnership(): void {
    activePreviewOwner = null
  }
  function modelGeneration(): number {
    if (store.live2dModel !== previousModel || store.modelUrl !== previousUrl) {
      previousModel = store.live2dModel; previousUrl = store.modelUrl; generation++
    }
    return generation
  }
  return async (dispatch: PetSettingsDispatch): Promise<PetSettingsCommandResult> => {
    const { command, session: incoming } = dispatch
    if (!Number.isSafeInteger(incoming) || incoming < 1) return failure('invalid-session')
    if (command.type === 'release-workshop') {
      releasedThrough = Math.max(releasedThrough, incoming)
      if (incoming >= session) {
        abandonPreviewOwnership()
        stopModelPerformance(store.live2dModel)
        options.releaseWorkshop()
        session = incoming
      }
      return { ok: true, data: { presetEditingLocked: store.presetEditingLocked, presetPreviewActive: store.presetPreviewActive } }
    }
    if (incoming < session || incoming <= releasedThrough) return failure('session-closed')
    if (incoming > session) {
      if (session) { stopModelPerformance(store.live2dModel); options.releaseWorkshop() }
      session = incoming
    }
    if (dispatch.model && (dispatch.model.modelUrl !== store.modelUrl || dispatch.model.modelGeneration !== modelGeneration())) {
      return failure('model-changed')
    }
    try {
      switch (command.type) {
        case 'set-emotion':
          if (!store.modelLoaded) return failure('model-not-ready')
          if (options.getModelKind() !== 'image-set' || !store.modelEmotions.includes(command.emotion)) return failure('unsupported-emotion')
          store.currentEmotion = command.emotion
          store.emotionPulse++
          return { ok: true }
        case 'host-state':
          return { ok: true, data: hostSnapshot() }
        case 'switch-host':
          if (!options.host || !options.host.isKnownPreference(command.preference)) {
            return failure('invalid-command')
          }
          if (!(await options.host.switchPreference(command.preference))) {
            return failure('action-rejected')
          }
          return { ok: true, data: hostSnapshot() }
        case 'reconnect-host':
          if (!options.host || !(await options.host.reconnect())) return failure('action-rejected')
          return { ok: true, data: hostSnapshot() }
        case 'inspect-performance':
          return { ok: true, data: inspectModelPerformance(store.live2dModel) }
        case 'snapshot':
          return { ok: true, data: JSON.parse(JSON.stringify({
            modelUrl: store.modelUrl, modelKind: options.getModelKind(), modelLoaded: store.modelLoaded,
            modelGeneration: modelGeneration(), modelControls: store.modelControls, modelSliders: store.modelSliders,
            modelEmotions: store.modelEmotions, modelCapabilities: store.modelCapabilities, emotionAdapter: store.emotionAdapter,
            presetEditingLocked: store.presetEditingLocked, presetPreviewActive: store.presetPreviewActive,
            activeRunningPresetId: store.activeRunningPresetId, activeHoldPresetId: store.activeHoldPresetId,
          })) }
        case 'switch-model':
          await options.switchModel(command.url)
          if (store.modelUrl !== command.url || !store.modelLoaded) return failure('model-load-failed')
          return incoming === session && incoming > releasedThrough ? { ok: true } : failure('session-closed')
        case 'set-edit-lock':
          if (command.locked) {
            // A real editor session now owns the workshop; a finishing demo
            // must not release this newer lock.
            abandonPreviewOwnership()
            store.presetEditingLocked = true
          } else {
            abandonPreviewOwnership()
            stopModelPerformance(store.live2dModel)
            options.releaseWorkshop()
          }
          return { ok: true }
        case 'set-hold-preset':
          store.activeHoldPresetId = command.presetId
          return { ok: true }
        case 'reload-settings':
          store.reloadPersistedUiState()
          return { ok: true }
      }
      if (!store.live2dModel || !store.modelLoaded || options.getModelKind() !== 'live2d') return failure('model-not-ready')
      let ok = false
      switch (command.type) {
        case 'preview-ambient': {
          if (store.presetEditingLocked) return failure('workshop-busy')
          const owner = beginPreview()
          ok = startAmbientDemo(store.live2dModel, command.state, () => finishPreview(owner))
          if (!ok) { abandonPreviewOwnership(); return failure('ambient-unavailable') }
          store.beginPresetPreview()
          store.presetEditingLocked = true
          break
        }
        case 'preview-mouth': {
          if (store.presetEditingLocked) return failure('workshop-busy')
          const owner = beginPreview()
          ok = startMouthPerformance(store.live2dModel, () => finishPreview(owner))
          if (!ok) { abandonPreviewOwnership(); return failure('mouth-unavailable') }
          store.beginPresetPreview()
          store.presetEditingLocked = true
          break
        }
        case 'preview-eyes': {
          if (store.presetEditingLocked) return failure('workshop-busy')
          const owner = beginPreview()
          ok = startEyePerformance(store.live2dModel, () => finishPreview(owner))
          if (!ok) { abandonPreviewOwnership(); return failure('eyes-unavailable') }
          store.beginPresetPreview()
          store.presetEditingLocked = true
          break
        }
        case 'preview-head': {
          if (store.presetEditingLocked) return failure('workshop-busy')
          const model = store.live2dModel
          const owner = beginPreview()
          ok = startModelPerformance(model, command.mode, () => finishPreview(owner))
          if (!ok) { abandonPreviewOwnership(); return failure('head-unavailable') }
          store.beginPresetPreview()
          if (command.mode === 'legacy') {
            const parameter = store.modelCapabilities?.parameters.find(p => p.id === 'ParamAngleX')
            if (!parameter) { stopModelPerformance(model); return failure('head-unavailable') }
            const range = { id: parameter.id, min: parameter.min, max: parameter.max, defaultValue: parameter.default ?? 0, physicsOutput: false }
            ok = store.triggerPreset({ id: '__head-comparison', label: '头部左右对照', description: '短时头部预览', emotion: 'neutral',
              controls: [], preview: true, finishMode: 'revert', motion: 'none',
              steps: [0.2, -0.2, 0].map(value => ({ controls: [], parameters: { ParamAngleX: semanticToRaw(value, range) }, durationMs: 900, holdMs: 100 })),
            } as ModelStatePreset, 'revert')
            if (!ok) stopModelPerformance(model)
          }
          if (ok) store.presetEditingLocked = true
          break
        }
        case 'preview-calibration': {
          if (store.presetEditingLocked) return failure('workshop-busy')
          const view = inspectModelPerformance(store.live2dModel)
          const parameter = view.parameters.find(p => p.id === command.parameterId)
          if (view.signature !== command.signature || !parameter || parameter.physicsOutput ||
            parameter.min >= parameter.defaultValue || parameter.defaultValue >= parameter.max ||
            view.mappings.some(m => m.channel !== command.channel && m.confirmed && m.parameterId === parameter.id)) {
            return failure('action-rejected')
          }
          const negative = command.direction === 'reversed'
          const amount = negative ? parameter.defaultValue - parameter.min : parameter.max - parameter.defaultValue
          const value = parameter.defaultValue + (negative ? -1 : 1) * amount * 0.1
          store.beginPresetPreview()
          ok = store.triggerPreset({ id: '__calibration-preview', label: '通道校准预览', description: '', emotion: 'neutral',
            controls: [], preview: true, finishMode: 'revert', motion: 'none',
            steps: [
              { controls: [], parameters: { [parameter.id]: value }, durationMs: 600, holdMs: 300 },
              { controls: [], parameters: { [parameter.id]: parameter.defaultValue }, durationMs: 600, holdMs: 0 },
            ],
          } as ModelStatePreset, 'revert')
          if (!ok) store.endPresetPreview()
          break
        }
        case 'preview-step': {
          const step = command.step as PresetKeyframeStep
          if (!Array.isArray(step.controls) || !step.controls.every(id => typeof id === 'string') ||
            !step.parameters || Array.isArray(step.parameters) || typeof step.parameters !== 'object' ||
            !Object.values(step.parameters).every(value => typeof value === 'number' && Number.isFinite(value))) return failure('invalid-step')
          ok = store.previewPresetStep(step, command.gaze)
          break
        }
        case 'trigger-preset': {
          const preset = command.preset as string | ModelStatePreset
          const preview = typeof preset === 'object' && preset.preview === true
          if (preview) store.beginPresetPreview()
          ok = store.triggerPreset(preset, command.mode as PresetFinishMode | undefined)
          if (!ok && preview) store.endPresetPreview()
          break
        }
        case 'control-action':
          ok = store.applyControlAction(command.control, command.action as DeskpetControlAction)
          break
        case 'sync-sliders': {
          const previousActive = new Set(
            store.modelControls.filter((control) => control.active).map((control) => control.id),
          )
          if (command.sliders) store.modelSliders = command.sliders as typeof store.modelSliders
          if (command.controls) store.modelControls = command.controls as typeof store.modelControls
          ok = store.syncSlidersToModel(command.transitionMs)
          if (ok && store.presetEditingLocked && store.live2dModel) {
            const nextActive = new Set(
              store.modelControls.filter((control) => control.active).map((control) => control.id),
            )
            const turnedOff = [...previousActive].some((id) => !nextActive.has(id))
            if (turnedOff) {
              const model = store.live2dModel
              // Let the 600ms control/part fade finish before clearing residual
              // scene parameters; an immediate reset cuts the fade and flickers.
              setTimeout(() => {
                if (store.live2dModel === model) options.resetTransientParametersToHome?.(model)
              }, Math.max(0, Number(command.transitionMs) || 0) + 120)
            }
          }
          break
        }
      }
      return ok ? { ok: true } : failure('action-rejected')
    } catch { return failure('command-failed') }
  }
}
