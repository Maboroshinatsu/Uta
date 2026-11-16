import type { ModelPerformanceStage, ModelPerformanceTrace } from '../../../shared/model-performance-contracts'

interface Model { internalModel?: any }
interface TraceState {
  parameterId: string | null
  trace: ModelPerformanceTrace | null
  frame: ModelPerformanceTrace['latestFrame'] | null
  beforeCore: ((value: number) => void) | null
}
const states = new WeakMap<object, TraceState>()
const MAX_FRAME_STAGES = 16

/** Install once per instance. Idle wrappers call through without reading Core or allocating samples. */
function install(model: Model): TraceState {
  const existing = states.get(model)
  if (existing) return existing
  const state: TraceState = { parameterId: null, trace: null, frame: null, beforeCore: null }
  states.set(model, state)
  const internal = model.internalModel, core = internal?.coreModel
  function sample(stage: ModelPerformanceStage) {
    if (!state.parameterId || !state.trace || !state.frame) return
    try {
      const value = Number(core?.getParameterValueById(state.parameterId))
      if (!Number.isFinite(value)) return
      if (state.frame.length < MAX_FRAME_STAGES) state.frame.push({ stage, value })
      if (!state.trace.observedStages.includes(stage)) state.trace.observedStages.push(stage)
      if (stage === 'before-core-update') state.beforeCore?.(value)
    } catch { /* Diagnostics never interfere with a native frame or expose its error. */ }
  }
  function wrap(target: any, key: string, before?: () => void, after?: () => void) {
    if (typeof target?.[key] !== 'function') return
    const original = target[key]
    target[key] = function (this: unknown, ...args: unknown[]) {
      before?.()
      const result = original.apply(this, args)
      after?.()
      return result
    }
  }
  wrap(internal, 'update', () => {
    if (!state.parameterId || !state.trace) return
    state.frame = []
  }, () => {
    if (!state.frame || !state.trace) return
    state.trace.latestFrame = state.frame
    state.trace.frames++
    state.frame = null
  })
  wrap(internal?.motionManager, 'update', () => sample('before-motion'), () => sample('after-motion'))
  wrap(core, 'saveParameters', undefined, () => sample('saved-motion'))
  wrap(internal?.motionManager?.expressionManager, 'update', undefined, () => sample('after-expression'))
  wrap(internal?.eyeBlink, 'updateParameters', undefined, () => sample('after-blink'))
  wrap(internal, 'updateFocus', undefined, () => sample('after-focus'))
  wrap(internal, 'updateNaturalMovements', undefined, () => sample('after-natural-and-uta'))
  wrap(internal?.physics, 'evaluate', undefined, () => sample('after-physics'))
  wrap(internal?.pose, 'updateParameters', undefined, () => sample('after-pose'))
  wrap(core, 'update', () => sample('before-core-update'), () => sample('after-core-update'))
  wrap(core, 'loadParameters', undefined, () => sample('restored-motion'))
  return state
}

export function startModelTrace(model: Model, parameterId: string, mode: 'legacy' | 'mixer', beforeCore: (value: number) => void): void {
  const state = install(model)
  state.parameterId = parameterId
  state.frame = null
  state.trace = { mode, parameterId, frames: 0, observedStages: [], latestFrame: [] }
  state.beforeCore = beforeCore
}
export function stopModelTrace(model: Model): void {
  const state = states.get(model)
  if (state) { state.parameterId = null; state.frame = null; state.beforeCore = null }
}
export function clearModelTrace(model: Model): void {
  stopModelTrace(model)
  const state = states.get(model)
  if (state) state.trace = null
}
export function inspectModelTrace(model: Model): ModelPerformanceTrace | null {
  const trace = states.get(model)?.trace
  return trace ? { ...trace, observedStages: [...trace.observedStages], latestFrame: trace.latestFrame.map(sample => ({ ...sample })) } : null
}
