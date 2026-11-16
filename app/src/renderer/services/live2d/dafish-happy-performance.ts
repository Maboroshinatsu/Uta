import type { ModelPerformanceAssets } from '../../../shared/model-performance-contracts'
import type { ModelStatePreset } from './emotion-adapter'

export const DAFISH_HAPPY_MOTION = '开心·大肥鱼连续表演'
export const DAFISH_HAPPY_PRESET = 'dafish_happy_performance_v1'
export const DAFISH_HAPPY_DURATION = 18.6
const FPS = 60

interface Point { t: number; v: number }
interface Segment { kind: number; a: Point; b: Point; c?: Point; d?: Point }
interface Track { sample(t: number): number }
export interface DafishParameter { id: string; min: number; max: number; default: number }
type Parameter = DafishParameter
interface MotionJson {
  Meta: { Duration: number }
  Curves: Array<{ Target: string; Id: string; Segments: number[] }>
}

const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t) }
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const cubic = (a: number, b: number, c: number, d: number, t: number) =>
  a * (1 - t) ** 3 + 3 * b * (1 - t) ** 2 * t + 3 * c * (1 - t) * t * t + d * t ** 3
const pulse = (t: number, start: number, peak: number, end: number) =>
  t < peak ? smooth((t - start) / (peak - start)) : 1 - smooth((t - peak) / (end - peak))

/** Decode native Cubism curves once; solve Bezier time instead of assuming uniform control points. */
export function compileMotionTrack(values: number[]): Track | null {
  if (!Array.isArray(values) || values.length < 2 || !values.every(Number.isFinite)) return null
  let a = { t: values[0], v: values[1] }
  const first = a
  const segments: Segment[] = []
  for (let i = 2; i < values.length;) {
    const kind = values[i++]
    if (kind === 1) {
      if (i + 5 >= values.length) return null
      const c = { t: values[i++], v: values[i++] }
      const d = { t: values[i++], v: values[i++] }
      const b = { t: values[i++], v: values[i++] }
      if (b.t <= a.t || c.t < a.t || d.t < c.t || d.t > b.t) return null
      segments.push({ kind, a, b, c, d }); a = b
    } else if (kind === 0 || kind === 2 || kind === 3) {
      if (i + 1 >= values.length) return null
      const b = { t: values[i++], v: values[i++] }
      if (b.t <= a.t) return null
      segments.push({ kind, a, b }); a = b
    } else return null
  }
  return {
    sample(t) {
      if (t <= first.t || !segments.length) return first.v
      if (t >= a.t) return a.v
      let lo = 0, hi = segments.length - 1
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (segments[mid].b.t < t) lo = mid + 1; else hi = mid }
      const s = segments[lo]
      if (s.kind === 2) return s.a.v
      if (s.kind === 3) return s.b.v
      if (s.kind === 0) return mix(s.a.v, s.b.v, (t - s.a.t) / (s.b.t - s.a.t))
      let left = 0, right = 1
      for (let n = 0; n < 22; n++) {
        const u = (left + right) / 2
        if (cubic(s.a.t, s.c!.t, s.d!.t, s.b.t, u) < t) left = u; else right = u
      }
      return cubic(s.a.v, s.c!.v, s.d!.v, s.b.v, (left + right) / 2)
    },
  }
}

function nativeClip(raw: unknown): { duration: number; tracks: Map<string, Track> } | null {
  const motion = raw as MotionJson | null
  const duration = motion?.Meta?.Duration
  if (!Number.isFinite(duration) || duration! <= 0 || duration! > 60 || !Array.isArray(motion?.Curves)) return null
  const tracks = new Map<string, Track>()
  for (const curve of motion.Curves) {
    if (curve.Target !== 'Parameter' || typeof curve.Id !== 'string') continue
    const track = compileMotionTrack(curve.Segments)
    if (!track) return null
    tracks.set(curve.Id, track)
  }
  return { duration: duration!, tracks }
}

/** This is an animation score, not a sequence of whole-character poses.
 * Body, native prop entry/exit, articulated wrist, gaze and face run on one clock.
 * Original assets remain on disk; only a generated motion is cached on this model instance.
 */
export function buildDafishHappyMotion(
  assets: ModelPerformanceAssets | null | undefined,
  parameters: Parameter[],
  physicsOutputIds: Iterable<string> = [],
) {
  const motions = assets?.metadata?.motions ?? []
  const find = (group: string) => nativeClip(motions.find(m => m.group === group && m.index === 0)?.json)
  const body = find('脱捕'), enter = find('狗尾巴草打开'), exit = find('狗尾巴草关闭')
  const byId = new Map(parameters.map(p => [p.id, p]))
  if (!body || !enter || !exit || !['AngleX', 'AngleY', 'AngleZ', 'PositionX', 'Movement1', 'Param36', 'Param41'].every(id => byId.has(id))) return null
  const physics = new Set(physicsOutputIds)
  const bodyIds = ['AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ']
  if (bodyIds.some(id => !body.tracks.has(id))) return null
  const samples = new Map<string, (t: number) => number>()
  const add = (id: string, sample: (t: number) => number) => { if (byId.has(id) && !physics.has(id)) samples.set(id, sample) }
  const duration = DAFISH_HAPPY_DURATION
  for (const id of bodyIds) {
    const track = body.tracks.get(id)!
    const home = byId.get(id)?.default ?? 0
    // Preserve the native inter-channel timing. No synthetic translation of the sprite.
    add(id, t => home + (track.sample(t / duration * body.duration) - home) * 0.78)
  }

  const propIn = 1.4, propReady = propIn + enter.duration, propOut = 14.1, propGone = propOut + exit.duration
  const propWeight = (t: number) => smooth((t - propReady) / 1.2) * (1 - smooth((t - (propOut - 1.2)) / 1.2))
  for (const id of new Set([...enter.tracks.keys(), ...exit.tracks.keys()])) {
    const inTrack = enter.tracks.get(id), outTrack = exit.tracks.get(id)
    const home = byId.get(id)?.default ?? 0
    const held = inTrack?.sample(enter.duration) ?? home
    add(id, t => {
      if (t < propIn) return inTrack?.sample(0) ?? home
      if (t < propReady) return inTrack?.sample(t - propIn) ?? held
      if (t >= propOut) {
        const value = outTrack?.sample(Math.min(exit.duration, t - propOut)) ?? home
        return t < propGone ? value : mix(value, inTrack?.sample(0) ?? home, smooth((t - propGone) / 0.8))
      }
      // Only the hand's joints receive this small flourish; the shoulder/body retain their own timing.
      const sway = propWeight(t)
      if (id === 'Param41') return held + 0.095 * Math.sin((t - propReady) * Math.PI * 0.56) * sway
      if (id === 'Param42') return held + 0.13 * Math.sin((t - propReady) * Math.PI * 0.56 - 0.65) * sway
      if (id === 'Param36') return held + 0.035 * Math.sin((t - propReady) * Math.PI * 0.32) * sway
      return held
    })
  }
  // Base adapter hides alternate arms. This track must own their crossfade during the gesture.
  add('Param56', () => 1)
  add('Param57', () => 0)
  add('Movement2', () => 0)
  add('Movement3', () => 0)
  const laugh = (t: number) => Math.max(pulse(t, 4.6, 5.5, 6.7), pulse(t, 10.2, 11.1, 12.4))
  const delight = (t: number) => pulse(t, 7, 8.2, 9.6)
  add('key4', delight) // One brief heart-eye accent, not a permanent mask over all facial acting.
  add('key7', t => 0.32 + 0.24 * laugh(t))
  add('ParamMouthForm', t => 0.48 + 0.24 * laugh(t))
  add('ParamMouthOpenY', t => 0.045 + 0.23 * laugh(t))
  add('JawOpen', () => 0)
  const blink = (t: number) => Math.max(pulse(t, 2.9, 3.02, 3.2), pulse(t, 8.9, 9.02, 9.2), pulse(t, 15.9, 16.02, 16.2))
  for (const id of ['ParamEyeLOpen', 'ParamEyeROpen']) add(id, t => (0.96 - 0.32 * laugh(t)) * (1 - blink(t)))
  for (const id of ['ParamEyeLSmile', 'ParamEyeRSmile']) add(id, t => 0.25 + 0.65 * laugh(t))
  add('ParamEyeBallX', t => 0.14 * Math.sin(t / duration * Math.PI * 2) * propWeight(t))
  add('ParamEyeBallY', t => 0.04 - 0.08 * laugh(t))
  for (const id of ['ParamBrowLY', 'ParamBrowRY']) add(id, t => 0.08 + 0.06 * laugh(t))

  const intervals = Math.round(duration * FPS)
  const curves = [...samples].map(([id, sample]) => {
    const p = byId.get(id)!
    const value = (t: number) => Math.round(Math.max(p.min, Math.min(p.max, sample(t))) * 100000) / 100000
    const segments = [0, value(0)]
    for (let i = 1; i <= intervals; i++) segments.push(0, Math.round(i / FPS * 100000) / 100000, value(i / FPS))
    return { Target: 'Parameter' as const, Id: id, Segments: segments }
  })
  if (!curves.length || curves.some(c => !c.Segments.every(Number.isFinite))) return null
  return {
    Version: 3 as const,
    Meta: { Duration: duration, Fps: FPS, Loop: true, AreBeziersRestricted: true,
      CurveCount: curves.length, TotalSegmentCount: intervals * curves.length,
      TotalPointCount: (intervals + 1) * curves.length, UserDataCount: 0, TotalUserDataSize: 0,
      FadeInTime: 0.7, FadeOutTime: 0.7 },
    Curves: curves, UserData: [],
  }
}

export function createDafishHappyPreset(): ModelStatePreset {
  return {
    id: DAFISH_HAPPY_PRESET, label: '开心·自然表演样板', group: '开心样板', emotion: 'happy',
    description: '',
    controls: [], parameters: {}, motion: { group: DAFISH_HAPPY_MOTION, index: 0 },
    // Keep the stage's gaze/idle ownership for the full score; do not replay the native motion at each beat.
    steps: Array.from({ length: 4 }, (_, i) => ({ label: ['展开笑容', '轻摇狗尾草', '笑意舒展', '收手回望'][i], durationMs: 4650, holdMs: 0, controls: [], parameters: {} })),
    finishMode: 'loop', source: 'builtin', custom: true,
  }
}

/** Instance-scoped registration. The SDK will evaluate the compiled curves with normal fades and physics. */
export function installDafishHappyMotion(model: { internalModel?: any }, assets: ModelPerformanceAssets | null | undefined, parameters: Parameter[], physicsOutputIds: Iterable<string> = []): boolean {
  const data = buildDafishHappyMotion(assets, parameters, physicsOutputIds)
  return registerDafishGeneratedMotion(model, DAFISH_HAPPY_MOTION, data)
}

/** Samples share playback/ownership infrastructure; independently authored variants supply their own curves. */
export function registerDafishGeneratedMotion(model: { internalModel?: any }, group: string, data: ReturnType<typeof buildDafishHappyMotion>): boolean {
  const manager = model.internalModel?.motionManager
  if (!manager?.definitions || !manager?.motionGroups || typeof manager.createMotion !== 'function') return false
  if (!data) return false
  const definition = { File: `__uta_runtime_${group}.motion3.json`, FadeInTime: 0.7, FadeOutTime: 0.7 }
  try {
    const motion = manager.createMotion(data, group, definition)
    if (!motion) return false
    manager.definitions[group] = [definition]
    manager.motionGroups[group] = [motion]
    const groups = installed.get(model) ?? new Map<string, ReadonlySet<string>>()
    groups.set(group, new Set(data.Curves.map(c => c.Id)))
    installed.set(model, groups)
    return true
  } catch { return false }
}

const installed = new WeakMap<object, Map<string, ReadonlySet<string>>>()
export function getDafishHappyOwnedParameters(model: { internalModel?: any }): ReadonlySet<string> {
  const state = model.internalModel?.motionManager?.state
  const groups = installed.get(model)
  return groups?.get(state?.reservedGroup) ?? groups?.get(state?.currentGroup) ?? EMPTY
}
const EMPTY: ReadonlySet<string> = new Set()
