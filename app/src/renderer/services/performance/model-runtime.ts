import { inspectCoreModel } from './inspection'
import { buildModelCapabilityProfile } from './profile'
import { createPerformanceMixer } from './mixer'
import { ambientSeedFromSignature, createAmbientMotion, type AmbientMotionEngine, type AmbientMotionFrame } from './ambient-motion'
import { clearModelTrace, inspectModelTrace, startModelTrace, stopModelTrace } from './sdk-trace'
import { buildModelCapabilityFacts, type ModelCapabilityFacts } from './capability-diagnostics'
import type { ModelCapabilityProfile, InspectedParameter, SemanticChannel } from '../../../shared/first-wave-contracts'
import type { AmbientPerformanceState, ModelPerformanceAssets, ModelPerformanceView } from '../../../shared/model-performance-contracts'
import type { ModelCalibration, CalibrationChannel } from '../../../shared/model-calibration-contracts'
import type { ModelCapabilities } from '../live2d/loader'
import type { ModelEmotionAdapter } from '../live2d/emotion-adapter'

interface Model { internalModel?: any }
interface AmbientMotion {
  head: number
  eye: number
  form: number
  accent: number
  headValue: number | null
  eyeValue: number | null
  formValue: number | null
  headSample: ModelPerformanceView['ambient']['headSample']
  eyeSamples: ModelPerformanceView['ambient']['eyeSamples']
  mouthSample: ModelPerformanceView['ambient']['mouthSample']
}
interface AmbientSelection { state: AmbientPerformanceState; since: number }
interface AmbientDemo extends AmbientSelection { timer: ReturnType<typeof setTimeout>; finish: () => void }
interface AmbientRuntime {
  engine: AmbientMotionEngine
  frame: AmbientMotionFrame | null
  frameAt: number
  owned: Set<string>
  gates: Map<string, { value: number; at: number }>
  ownershipProvider: (() => Iterable<string>) | null
}
interface Runtime {
  profile: ModelCapabilityProfile | null
  calibration: ModelCalibration[] | null
  mode: 'legacy' | 'mixer' | null
  kind: 'head' | 'eyes' | 'mouth' | null
  speechActive: boolean
  speechLevel: number
  startedAt: number
  mixer: ReturnType<typeof createPerformanceMixer> | null
  finish: (() => void) | null
  timer: ReturnType<typeof setTimeout> | null
  sample: ModelPerformanceView['sample']
  eyeSamples: ModelPerformanceView['eyeSamples']
  mouthSamples: ModelPerformanceView['mouthSamples']
  ambient: AmbientSelection | null
  ambientSuspended: boolean
  ambientMotion: AmbientMotion
  ambientRuntime: AmbientRuntime
  ambientDemo: AmbientDemo | null
}
const runtimes = new WeakMap<object, Runtime>()
const profiles = new Map<string, ModelCapabilityProfile>()
export const HEAD_PREVIEW_MS = 4000
export const AMBIENT_DEMO_MS = 4000

const AMBIENT_LABELS: Record<AmbientPerformanceState, string> = {
  idle: '待机', thinking: '思考', working: '工作', speaking: '回复', waiting: '等待',
  error: '出错', completed: '完成',
}

/** Signed channels use their actual default anchor, including asymmetric ranges. */
export function semanticToRaw(value: number, parameter: InspectedParameter): number {
  const bounded = Math.max(-1, Math.min(1, value))
  return parameter.defaultValue + bounded * (bounded < 0
    ? parameter.defaultValue - parameter.min : parameter.max - parameter.defaultValue)
}
export function rawToSemantic(value: number, parameter: InspectedParameter): number {
  const delta = value - parameter.defaultValue
  const span = delta < 0 ? parameter.defaultValue - parameter.min : parameter.max - parameter.defaultValue
  return span > 0 ? Math.max(-1, Math.min(1, delta / span)) : 0
}

export function prepareModelPerformance(model: Model, assets?: ModelPerformanceAssets | null): void {
  const speechActive = runtimes.get(model)?.speechActive ?? false
  stopModelPerformance(model)
  clearModelTrace(model)
  let profile: ModelCapabilityProfile | null = null
  const core = model.internalModel?.coreModel?._model
  const calibration = assets?.calibration ?? (assets?.calibration === null ? null : [])
  if (assets && core) {
    const inspected = inspectCoreModel(core, { modelSignature: assets.modelSignature, metadata: assets.metadata, overrides: [] })
    if (inspected.ok) {
      const baseline = buildModelCapabilityProfile(inspected.input)
      const safe = (calibration ?? []).filter(item => {
        const parameter = inspected.input.parameters.find(p => p.id === item.parameterId)
        return !!parameter && !parameter.physicsOutput && parameter.min < parameter.defaultValue && parameter.defaultValue < parameter.max &&
          Number.isFinite(item.strength) && item.strength >= 0 && item.strength <= 1 &&
          baseline.ok && !baseline.profile.mappings.some(m => m.channel !== item.channel && m.confirmed && m.parameterId === item.parameterId)
      })
      const overrides = safe.map(({ channel, parameterId, direction }) => ({ channel, parameterId, direction, confirmed: true }))
      const built = buildModelCapabilityProfile({ ...inspected.input, overrides })
      if (built.ok) {
        // Always validate this live Core. Cache only exact validated profile content.
        const key = JSON.stringify(built.profile)
        profile = profiles.get(key) ?? built.profile
        profiles.delete(key); profiles.set(key, profile)
        if (profiles.size > 8) profiles.delete(profiles.keys().next().value!)
      }
    }
  }
  runtimes.set(model, {
    profile, calibration, mode: null, kind: null, speechActive, speechLevel: 0, startedAt: 0, mixer: null, finish: null, timer: null,
    sample: null, eyeSamples: [], mouthSamples: [],
    ambient: null, ambientSuspended: false,
    ambientMotion: {
      head: 0, eye: 1, form: 0, accent: 0, headValue: null, eyeValue: null, formValue: null,
      headSample: null, eyeSamples: [], mouthSample: null,
    },
    ambientRuntime: {
      engine: createAmbientMotion(ambientSeedFromSignature(assets?.modelSignature)),
      frame: null, frameAt: -1, owned: new Set(), gates: new Map(), ownershipProvider: null,
    },
    ambientDemo: null,
  })
}
function mappedParameter(runtime: Runtime | undefined, channel: SemanticChannel): InspectedParameter | undefined {
  const profile = runtime?.profile
  if (!profile?.capabilities.some(c => c.channel === channel && c.status === 'available')) return
  const mapping = profile.mappings.find(m => m.channel === channel && m.confirmed && (m.source === 'standard-id' || m.source === 'manual'))
  return profile.parameters.find(p => p.id === mapping?.parameterId && !p.physicsOutput)
}
function head(runtime?: Runtime): InspectedParameter | undefined {
  const parameter = mappedParameter(runtime, 'headX')
  return parameter && parameter.min < parameter.defaultValue && parameter.defaultValue < parameter.max ? parameter : undefined
}
function eyes(runtime?: Runtime): Array<{ channel: 'eyeOpenLeft' | 'eyeOpenRight'; parameter: InspectedParameter }> {
  const left = mappedParameter(runtime, 'eyeOpenLeft'), right = mappedParameter(runtime, 'eyeOpenRight')
  if (!left || !right || left.id === right.id || left.min >= left.defaultValue || right.min >= right.defaultValue) return []
  return [{ channel: 'eyeOpenLeft', parameter: left }, { channel: 'eyeOpenRight', parameter: right }]
}
function mouth(runtime?: Runtime): { form: InspectedParameter; opening: InspectedParameter } | null {
  const form = mappedParameter(runtime, 'mouthForm'), opening = mappedParameter(runtime, 'mouthOpen')
  if (!form || !opening || form.id === opening.id || form.min >= form.defaultValue || form.defaultValue >= form.max ||
    opening.min !== opening.defaultValue || opening.defaultValue >= opening.max) return null
  return { form, opening }
}
function safeMouthForm(runtime?: Runtime): InspectedParameter | undefined {
  const form = mappedParameter(runtime, 'mouthForm')
  return form && form.min < form.defaultValue && form.defaultValue < form.max ? form : undefined
}
function channelParameter(runtime: Runtime | undefined, channel: SemanticChannel): InspectedParameter | undefined {
  return mappedParameter(runtime, channel)
}
function hasAmbientChannels(runtime?: Runtime): boolean {
  if (!runtime?.profile) return false
  if (head(runtime)) return true
  if (eyes(runtime).length === 2) return true
  if (safeMouthForm(runtime)) return true
  return ['headY', 'headZ', 'gazeX', 'gazeY', 'browLeft', 'browRight', 'bodyX', 'bodyZ']
    .some(channel => !!channelParameter(runtime, channel as SemanticChannel))
}
function previewEnvelope(elapsed: number): number {
  const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t) }
  return elapsed < 400 ? smooth(elapsed / 400) : elapsed < 2400 ? 1 : 1 - smooth((elapsed - 2400) / 1200)
}
function clearSamples(runtime: Runtime): void { runtime.sample = null; runtime.eyeSamples = []; runtime.mouthSamples = [] }

/** 预设/控件层正在写的参数：日常微表现当帧让路，不再叠加。 */
export function setAmbientOwnedParameters(model: Model, ids: Iterable<string>): void {
  const runtime = runtimes.get(model)
  if (!runtime) return
  const owned = runtime.ambientRuntime.owned
  owned.clear()
  for (const id of ids) {
    if (typeof id === 'string' && id) owned.add(id)
  }
}

/** 由 loader 注入的实时占用查询；每次新渲染帧最多取一次。 */
export function setPerformanceOwnershipProvider(model: Model, provider: (() => Iterable<string>) | null): void {
  const runtime = runtimes.get(model)
  if (!runtime) return
  runtime.ambientRuntime.ownershipProvider = provider
}

/** Includes silent syllables and the closing tail, not just nonzero audio levels. */
export function setPerformanceSpeechActive(model: Model, active: boolean): void {
  const runtime = runtimes.get(model)
  if (!runtime || runtime.speechActive === active) return
  runtime.speechActive = active
  if (!active) {
    runtime.speechLevel = 0
    runtime.ambientRuntime.engine.setSpeechLevel(0, performance.now())
  }
  if (active && runtime.kind === 'mouth') {
    const opening = mouth(runtime)?.opening.id
    runtime.mouthSamples = runtime.mouthSamples.filter(sample => sample.parameterId !== opening)
  }
}

/**
 * Actual lip-sync level from the loader. It feeds a small reply smile and a sparse
 * phrase-start accent; the opening parameter stays exclusively owned by lip sync.
 */
export function setPerformanceSpeechLevel(model: Model, level: number, now = performance.now()): void {
  const runtime = runtimes.get(model)
  if (!runtime) return
  const next = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0
  runtime.speechLevel = next
  if (!Number.isFinite(now) || now < 0) return
  runtime.ambientRuntime.engine.setSpeechLevel(next, now)
}
export function inspectModelPerformance(model?: Model | null): ModelPerformanceView {
  const runtime = model && runtimes.get(model)
  const profile = runtime?.profile
  const ambientSelection = runtime?.ambientDemo ?? runtime?.ambient
  const motion = runtime?.ambientMotion
  const ambientLabel = ambientSelection ? AMBIENT_LABELS[ambientSelection.state] : ''
  const previewSource = runtime?.kind === 'mouth' ? runtime.speechActive ? '试验嘴形 · 开合由说话口型控制' : '试验控制 · 微笑与开口'
    : runtime?.kind === 'eyes' ? '试验控制 · 双眼闭合' : runtime?.mode === 'mixer' ? '试验控制 · 仅头部左右' : runtime?.mode === 'legacy' ? '旧预设控制 · 头部左右' : null
  return {
    signature: profile?.modelSignature ?? null, parameterCount: profile?.parameters.length ?? 0,
    expressionCount: profile?.expressions.length ?? 0, motionCount: profile?.motions.length ?? 0,
    channels: profile?.capabilities ?? [], parameters: profile?.parameters ?? [], mappings: profile?.mappings ?? [],
    calibration: runtime?.calibration ?? (runtime?.calibration === null ? null : []),
    headPreviewAvailable: !!head(runtime || undefined), eyePreviewAvailable: eyes(runtime || undefined).length === 2,
    mouthPreviewAvailable: !!mouth(runtime || undefined), ambientAvailable: !!runtime && hasAmbientChannels(runtime), speechActive: runtime?.speechActive ?? false,
    preview: runtime?.mode ?? null,
    previewKind: runtime?.kind ?? null,
    ambient: {
      state: runtime?.ambient?.state ?? null,
      demo: runtime?.ambientDemo?.state ?? null,
      suspended: runtime?.ambientSuspended ?? false,
      head: ambientSelection && motion ? motion.headValue === null ? null : motion.head : null,
      eye: ambientSelection && motion ? motion.eyeValue === null ? null : motion.eye : null,
      mouthForm: ambientSelection && motion ? motion.formValue === null ? null : motion.form : null,
      accent: ambientSelection && motion ? motion.accent : null,
      speechLevel: runtime?.speechActive ? runtime.speechLevel : 0,
      headSample: ambientSelection && motion?.headSample ? { ...motion.headSample } : null,
      eyeSamples: ambientSelection ? motion?.eyeSamples.map(sample => ({ ...sample })) ?? [] : [],
      mouthSample: ambientSelection && motion?.mouthSample ? { ...motion.mouthSample } : null,
    },
    source: previewSource ?? (ambientSelection
      ? `${runtime?.ambientDemo ? '日常演示' : '日常表现'} · ${ambientLabel}${runtime?.ambientSuspended ? '（暂停）' : ''}`
      : '现有动作、表情与跟随'),
    sample: runtime?.sample ?? null,
    trace: model ? inspectModelTrace(model) : null,
    eyeSamples: runtime?.eyeSamples.map(sample => ({ ...sample })) ?? [],
    mouthSamples: runtime?.mouthSamples.map(sample => ({ ...sample })) ?? [],
  }
}

export function inspectModelCapabilityFacts(
  model: Model | null | undefined,
  adapter: ModelEmotionAdapter | null | undefined,
  caps?: ModelCapabilities | null,
): ModelCapabilityFacts | null {
  const profile = model ? runtimes.get(model)?.profile : null
  return profile && adapter ? buildModelCapabilityFacts(profile, adapter, caps) : null
}
export function startModelPerformance(model: Model, mode: 'legacy' | 'mixer', finish: () => void, now = performance.now()): boolean {
  const runtime = runtimes.get(model)
  if (!runtime || !head(runtime)) return false
  stopModelPerformance(model)
  runtime.ambientSuspended = true
  runtime.mode = mode; runtime.kind = 'head'; runtime.startedAt = now; runtime.finish = finish; clearSamples(runtime)
  // One disposable mixer per short preview; no cross-session leases/tombstones accumulate.
  runtime.mixer = mode === 'mixer' ? createPerformanceMixer() : null
  startModelTrace(model, head(runtime)!.id, mode, value => {
    if (runtime.sample) runtime.sample.rendered = value
  })
  runtime.timer = setTimeout(() => stopModelPerformance(model), HEAD_PREVIEW_MS)
  return true
}
export function startEyePerformance(model: Model, finish: () => void, now = performance.now()): boolean {
  const runtime = runtimes.get(model), parameters = eyes(runtime)
  if (!runtime || parameters.length !== 2) return false
  stopModelPerformance(model)
  runtime.ambientSuspended = true
  runtime.mode = 'mixer'; runtime.kind = 'eyes'; runtime.startedAt = now; runtime.finish = finish; clearSamples(runtime)
  runtime.mixer = createPerformanceMixer()
  startModelTrace(model, parameters[0].parameter.id, 'mixer', () => {})
  runtime.timer = setTimeout(() => stopModelPerformance(model), HEAD_PREVIEW_MS)
  return true
}
export function startMouthPerformance(model: Model, finish: () => void, now = performance.now()): boolean {
  const runtime = runtimes.get(model), parameters = mouth(runtime)
  if (!runtime || !parameters) return false
  stopModelPerformance(model)
  runtime.ambientSuspended = true
  runtime.mode = 'mixer'; runtime.kind = 'mouth'; runtime.startedAt = now; runtime.finish = finish; clearSamples(runtime)
  runtime.mixer = createPerformanceMixer()
  startModelTrace(model, parameters.form.id, 'mixer', () => {})
  runtime.timer = setTimeout(() => stopModelPerformance(model), HEAD_PREVIEW_MS)
  return true
}
function stopAmbientDemo(runtime: Runtime, invokeFinish: boolean): void {
  const demo = runtime.ambientDemo
  if (!demo) return
  runtime.ambientDemo = null
  clearTimeout(demo.timer)
  if (invokeFinish) demo.finish()
}
export function stopModelPerformance(model?: Model | null): void {
  const runtime = model && runtimes.get(model)
  if (!runtime) return
  stopModelTrace(model!)
  if (runtime.timer) clearTimeout(runtime.timer)
  stopAmbientDemo(runtime, true)
  const finish = runtime.finish
  runtime.mode = null; runtime.kind = null; runtime.mixer = null; runtime.finish = null; runtime.timer = null
  runtime.ambientSuspended = false
  runtime.ambientRuntime.gates.clear()
  clearSamples(runtime)
  finish?.()
}
function ambientFrame(runtime: Runtime, selection: AmbientSelection, now: number): AmbientMotionFrame {
  const ambient = runtime.ambientRuntime
  ambient.engine.setState(selection.state, now)
  if (ambient.frame && ambient.frameAt === now) return ambient.frame
  const frame = ambient.engine.step(now)
  ambient.frame = frame
  ambient.frameAt = now
  const motion = runtime.ambientMotion
  motion.head = frame.headX
  motion.eye = frame.eyeOpen
  motion.form = frame.mouthForm
  motion.accent = frame.accent
  return frame
}
/** 让路结束或首次启用时从 0 渐入，避免恢复瞬间把参数顶一下。 */
function gateWeight(runtime: Runtime, id: string, now: number): number {
  const gates = runtime.ambientRuntime.gates
  const previous = gates.get(id)
  if (!previous) {
    gates.set(id, { value: 0, at: now })
    return 0
  }
  let dt = now - previous.at
  if (!(dt >= 0)) dt = 0
  dt = Math.min(dt, 50)
  const value = previous.value + (1 - previous.value) * (1 - Math.exp(-dt / 420))
  gates.set(id, { value, at: now })
  return value
}
function additiveWrite(
  runtime: Runtime,
  core: any,
  channel: CalibrationChannel,
  parameter: InspectedParameter,
  offset: number,
  now: number,
): { native: number; applied: number } | null {
  if (runtime.ambientRuntime.owned.has(parameter.id)) {
    runtime.ambientRuntime.gates.delete(parameter.id)
    return null
  }
  if (!Number.isFinite(offset)) return null
  const mapping = runtime.profile?.mappings.find(item => item.channel === channel && item.parameterId === parameter.id)
  const calibration = mapping?.source === 'manual' ? runtime.calibration?.find(item => item.channel === channel && item.parameterId === parameter.id) : undefined
  if (calibration) offset *= calibration.strength * (calibration.direction === 'reversed' ? -1 : 1)
  const gate = gateWeight(runtime, parameter.id, now)
  if (gate <= 0.001 || Math.abs(offset * gate) < 0.0004) return null
  let native: number
  try { native = Number(core.getParameterValueById(parameter.id)) } catch { return null }
  if (!Number.isFinite(native)) return null
  const semantic = Math.max(-1, Math.min(1, rawToSemantic(native, parameter) + offset * gate))
  const applied = semanticToRaw(semantic, parameter)
  if (!Number.isFinite(applied)) return null
  try { core.setParameterValueById(parameter.id, applied) } catch { return null }
  return { native, applied }
}
function multiplyWrite(
  runtime: Runtime,
  core: any,
  parameter: InspectedParameter,
  factor: number,
  now: number,
): { native: number; applied: number } | null {
  if (runtime.ambientRuntime.owned.has(parameter.id)) {
    runtime.ambientRuntime.gates.delete(parameter.id)
    return null
  }
  if (!Number.isFinite(factor)) return null
  const gate = gateWeight(runtime, parameter.id, now)
  const effective = 1 + (factor - 1) * gate
  if (Math.abs(effective - 1) < 0.002) return null
  let native: number
  try { native = Number(core.getParameterValueById(parameter.id)) } catch { return null }
  if (!Number.isFinite(native)) return null
  const span = parameter.max - parameter.min
  if (!(span > 0)) return null
  const normalized = Math.max(0, Math.min(1, (native - parameter.min) / span))
  const applied = parameter.min + Math.max(0, Math.min(1, normalized * effective)) * span
  if (!Number.isFinite(applied)) return null
  try { core.setParameterValueById(parameter.id, applied) } catch { return null }
  return { native, applied }
}
function disableAmbient(runtime: Runtime): void {
  runtime.ambient = null
  runtime.ambientSuspended = false
  runtime.ambientRuntime.gates.clear()
  stopAmbientDemo(runtime, true)
}
function ambientSelection(runtime?: Runtime): AmbientSelection | null {
  if (!runtime || runtime.ambientSuspended || runtime.mode) return null
  return runtime.ambientDemo ?? runtime.ambient
}

/**
 * Adds a restrained continuous layer on top of the current native/preset value.
 * Head/body are added before physics; gaze, eyelids, brow and mouth form are
 * layered after expressions/physics. Channels owned by a preset or control
 * layer are skipped for that frame instead of being overwritten.
 */
export function applyAmbientHead(model: Model, now = performance.now()): void {
  const runtime = runtimes.get(model)
  const selection = ambientSelection(runtime)
  if (!runtime || !selection) return
  const core = model.internalModel?.coreModel
  if (!core) return
  if (runtime.ambientRuntime.ownershipProvider && runtime.ambientRuntime.frameAt !== now) {
    setAmbientOwnedParameters(model, runtime.ambientRuntime.ownershipProvider())
  }
  const frame = ambientFrame(runtime, selection, now)
  const motion = runtime.ambientMotion
  motion.headValue = null
  motion.headSample = null

  const x = head(runtime)
  if (x) {
    const result = additiveWrite(runtime, core, 'headX', x, frame.headX, now)
    if (result) {
      motion.headValue = result.applied
      motion.headSample = { parameterId: x.id, native: result.native, applied: result.applied }
    }
  }
  const y = channelParameter(runtime, 'headY')
  if (y) additiveWrite(runtime, core, 'headY', y, frame.headY, now)
  const z = channelParameter(runtime, 'headZ')
  if (z) additiveWrite(runtime, core, 'headZ', z, frame.headZ, now)
  const bodyX = channelParameter(runtime, 'bodyX')
  if (bodyX) additiveWrite(runtime, core, 'bodyX', bodyX, frame.bodyX, now)
  const bodyZ = channelParameter(runtime, 'bodyZ')
  if (bodyZ) additiveWrite(runtime, core, 'bodyZ', bodyZ, frame.bodyZ, now)
}

/** Eyes/gaze/brow/mouth form layer on top of native expression and physics results. */
export function applyAmbientPost(model: Model, now = performance.now()): void {
  const runtime = runtimes.get(model)
  const selection = ambientSelection(runtime)
  if (!runtime || !selection) return
  const core = model.internalModel?.coreModel
  if (!core) return
  if (runtime.ambientRuntime.ownershipProvider && runtime.ambientRuntime.frameAt !== now) {
    setAmbientOwnedParameters(model, runtime.ambientRuntime.ownershipProvider())
  }
  const frame = ambientFrame(runtime, selection, now)
  const motion = runtime.ambientMotion
  motion.eyeSamples = []
  motion.eyeValue = null
  for (const { parameter } of eyes(runtime)) {
    const result = multiplyWrite(runtime, core, parameter, frame.eyeOpen, now)
    if (!result) continue
    motion.eyeValue = result.applied
    motion.eyeSamples.push({ parameterId: parameter.id, native: result.native, applied: result.applied })
  }

  const gazeX = channelParameter(runtime, 'gazeX')
  if (gazeX) additiveWrite(runtime, core, 'gazeX', gazeX, frame.gazeX, now)
  const gazeY = channelParameter(runtime, 'gazeY')
  if (gazeY) additiveWrite(runtime, core, 'gazeY', gazeY, frame.gazeY, now)
  const browLeft = channelParameter(runtime, 'browLeft')
  if (browLeft) additiveWrite(runtime, core, 'browLeft', browLeft, frame.browLeft, now)
  const browRight = channelParameter(runtime, 'browRight')
  if (browRight) additiveWrite(runtime, core, 'browRight', browRight, frame.browRight, now)

  const form = safeMouthForm(runtime)
  motion.formValue = null
  motion.mouthSample = null
  if (form) {
    const result = additiveWrite(runtime, core, 'mouthForm', form, frame.mouthForm, now)
    if (result) {
      motion.formValue = result.applied
      motion.mouthSample = { parameterId: form.id, native: result.native, applied: result.applied }
    }
  }
}

/** Stage-selected real state. Passing null pauses the layer without touching native controls. */
export function setAmbientPerformance(model: Model | null | undefined, state: AmbientPerformanceState | null, now = performance.now()): void {
  const runtime = model && runtimes.get(model)
  if (!runtime) return
  if (!state || !hasAmbientChannels(runtime) || !Object.prototype.hasOwnProperty.call(AMBIENT_LABELS, state)) {
    runtime.ambient = null
    runtime.ambientRuntime.gates.clear()
    return
  }
  if (runtime.ambient?.state === state) return
  runtime.ambient = { state, since: now }
}

/** Explicit settings demo. It overrides the real state for a few seconds, then releases. */
export function startAmbientDemo(model: Model, state: AmbientPerformanceState, finish: () => void, now = performance.now()): boolean {
  const runtime = runtimes.get(model)
  if (!runtime || !hasAmbientChannels(runtime) || !Object.prototype.hasOwnProperty.call(AMBIENT_LABELS, state)) return false
  stopAmbientDemo(runtime, false)
  if (runtime.mode) stopModelPerformance(model)
  runtime.ambientSuspended = false
  const demo = { state, since: now, timer: null as unknown as ReturnType<typeof setTimeout>, finish }
  demo.timer = setTimeout(() => {
    if (runtime.ambientDemo !== demo) return
    runtime.ambientDemo = null
    finish()
  }, AMBIENT_DEMO_MS)
  runtime.ambientDemo = demo
  return true
}

export function performanceOwnsParameter(model: Model, id: string): boolean {
  const runtime = runtimes.get(model)
  if (runtime?.mode !== 'mixer') return false
  if (runtime.kind === 'eyes') return eyes(runtime).some(p => p.parameter.id === id)
  if (runtime.kind === 'mouth') {
    const parameters = mouth(runtime)
    return parameters?.form.id === id || (!runtime.speechActive && parameters?.opening.id === id)
  }
  return head(runtime)?.id === id
}
/** Called once after legacy natural/stack updates, before physics. No file/IPC/PIXI work. */
export function applyModelPerformance(model: Model, now = performance.now()): void {
  const runtime = runtimes.get(model)
  if (!runtime?.mixer || runtime.mode !== 'mixer' || runtime.kind !== 'head' || !runtime.profile) return
  const parameter = head(runtime)
  if (!parameter) { stopModelPerformance(model); return }
  const elapsed = Math.max(0, now - runtime.startedAt)
  if (elapsed >= HEAD_PREVIEW_MS) { stopModelPerformance(model); return }
  const core = model.internalModel?.coreModel
  let native: number
  try { native = Number(core?.getParameterValueById(parameter.id)) }
  catch { stopModelPerformance(model); return }
  if (!Number.isFinite(native)) { stopModelPerformance(model); return }
  // Two small looks with a zero-slope start/end, added to this frame's native motion.
  const phase = elapsed / HEAD_PREVIEW_MS
  const calibration = runtime.profile.mappings.find(m => m.channel === 'headX' && m.source === 'manual')
    ? runtime.calibration?.find(item => item.channel === 'headX') : undefined
  const value = Math.sin(phase * Math.PI * 4) * Math.sin(phase * Math.PI) ** 2 * 0.2 *
    (calibration ? calibration.strength * (calibration.direction === 'reversed' ? -1 : 1) : 1)
  const result = runtime.mixer.step({ version: 1, sampledAtMonotonicMs: now, modelEpoch: 1, bindingGeneration: 1,
    base: { headX: rawToSemantic(native, parameter) }, intents: [], profile: runtime.profile, releases: [],
    contributions: [{ version: 1, contributionId: 'head-demo', ownerId: 'settings-preview', generation: 1,
      modelEpoch: 1, bindingGeneration: 1, intentId: 'head-demo', mode: 'add', phase: 'pre-physics',
      values: { headX: value }, strength: 1, fadeInMs: 0, fadeOutMs: 0, ttlMs: null }],
  })
  const applied = semanticToRaw(result.prePhysics.headX ?? 0, parameter)
  try { core.setParameterValueById(parameter.id, applied) }
  catch { stopModelPerformance(model); return }
  runtime.sample = { channel: 'headX', native, applied, rendered: null }
}

/** Eyes multiply the actual post-physics baseline; factor 1 preserves native opening, including wide eyes. */
export function applyEyePerformance(model: Model, now = performance.now()): void {
  const runtime = runtimes.get(model)
  if (!runtime?.mixer || runtime.kind !== 'eyes' || !runtime.profile) return
  const elapsed = Math.max(0, now - runtime.startedAt)
  if (elapsed >= HEAD_PREVIEW_MS) { stopModelPerformance(model); return }
  const parameters = eyes(runtime)
  if (parameters.length !== 2) { stopModelPerformance(model); return }
  const core = model.internalModel?.coreModel
  const factor = 1 - previewEnvelope(elapsed)
  try {
    const samples = parameters.map(({ channel, parameter }) => {
      const native = Number(core.getParameterValueById(parameter.id))
      if (!Number.isFinite(native)) throw Error('invalid eye value')
      return { channel, parameter, native, semantic: Math.max(0, Math.min(1, (native - parameter.min) / (parameter.max - parameter.min))) }
    })
    const result = runtime.mixer.step({ version: 1, sampledAtMonotonicMs: now, modelEpoch: 1, bindingGeneration: 1,
      base: Object.fromEntries(samples.map(s => [s.channel, s.semantic])), intents: [], profile: runtime.profile, releases: [],
      contributions: [{ version: 1, contributionId: 'eye-demo', ownerId: 'settings-preview', generation: 1,
        modelEpoch: 1, bindingGeneration: 1, intentId: 'eye-demo', mode: 'multiply', phase: 'post-physics',
        values: { eyeOpenLeft: factor, eyeOpenRight: factor }, strength: 1, fadeInMs: 0, fadeOutMs: 0, ttlMs: null }],
    })
    runtime.eyeSamples = samples.map(({ channel, parameter, native }) => {
      const value = result.postPhysics[channel]
      if (!Number.isFinite(value)) throw Error('missing eye result')
      const applied = parameter.min + value! * (parameter.max - parameter.min)
      core.setParameterValueById(parameter.id, applied)
      return { parameterId: parameter.id, native, applied }
    })
  } catch { stopModelPerformance(model) }
}

/** Mouth shape remains independent; active speech exclusively owns opening even when its level is zero. */
export function applyMouthPerformance(model: Model, now = performance.now()): void {
  const runtime = runtimes.get(model)
  if (!runtime?.mixer || runtime.kind !== 'mouth' || !runtime.profile) return
  const elapsed = Math.max(0, now - runtime.startedAt), parameters = mouth(runtime)
  if (elapsed >= HEAD_PREVIEW_MS || !parameters) { stopModelPerformance(model); return }
  const core = model.internalModel?.coreModel, { form, opening } = parameters
  try {
    const samples = [{ channel: 'mouthForm' as const, parameter: form, signed: true },
      ...(!runtime.speechActive ? [{ channel: 'mouthOpen' as const, parameter: opening, signed: false }] : [])]
      .map(sample => {
        const native = Number(core.getParameterValueById(sample.parameter.id))
        if (!Number.isFinite(native)) throw Error('invalid mouth value')
        return { ...sample, native, semantic: sample.signed ? rawToSemantic(native, sample.parameter)
          : Math.max(0, Math.min(1, (native - opening.min) / (opening.max - opening.min))) }
      })
    const result = runtime.mixer.step({ version: 1, sampledAtMonotonicMs: now, modelEpoch: 1, bindingGeneration: 1,
      base: Object.fromEntries(samples.map(sample => [sample.channel, sample.semantic])), intents: [], profile: runtime.profile, releases: [],
      contributions: [{ version: 1, contributionId: 'mouth-demo', ownerId: 'settings-preview', generation: 1,
        modelEpoch: 1, bindingGeneration: 1, intentId: 'mouth-demo', mode: 'replace', phase: 'post-physics',
        values: { mouthForm: 0.45, ...(!runtime.speechActive ? { mouthOpen: 0.45 } : {}) },
        strength: previewEnvelope(elapsed), fadeInMs: 0, fadeOutMs: 0, ttlMs: null }],
    })
    runtime.mouthSamples = samples.map(({ channel, parameter, signed, native }) => {
      const value = result.postPhysics[channel]
      if (!Number.isFinite(value)) throw Error('missing mouth result')
      const applied = signed ? semanticToRaw(value!, parameter) : parameter.min + value! * (parameter.max - parameter.min)
      core.setParameterValueById(parameter.id, applied)
      return { parameterId: parameter.id, native, applied }
    })
  } catch { stopModelPerformance(model) }
}
