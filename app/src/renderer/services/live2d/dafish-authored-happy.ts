import type { ModelStatePreset } from './emotion-adapter'
import { registerDafishGeneratedMotion, type DafishParameter } from './dafish-happy-performance'

export const DAFISH_AUTHORED_HAPPY_MOTION = '开心·大肥鱼独立编排'
export const DAFISH_AUTHORED_HAPPY_PRESET = 'dafish_authored_happy_v2'
export const DAFISH_AUTHORED_HAPPY_DURATION = 17.6
type Key = readonly [seconds: number, value: number]

/** Shape-preserving Hermite interpolation. Each joint has its own timing and velocity;
 * zero endpoint velocity makes the seam stationary without a whole-body reset.
 */
export function authoredTrack(keys: readonly Key[]): (t: number) => number {
  const slopes = keys.slice(1).map((k, i) => (k[1] - keys[i][1]) / (k[0] - keys[i][0]))
  const tangent = keys.map((_, i) => {
    if (i === 0 || i === keys.length - 1 || slopes[i - 1] * slopes[i] <= 0) return 0
    const a = keys[i][0] - keys[i - 1][0], b = keys[i + 1][0] - keys[i][0]
    return (3 * (a + b)) / ((2 * b + a) / slopes[i - 1] + (b + 2 * a) / slopes[i])
  })
  return t => {
    if (t <= keys[0][0]) return keys[0][1]
    if (t >= keys[keys.length - 1][0]) return keys[keys.length - 1][1]
    let i = 0
    while (i < keys.length - 2 && keys[i + 1][0] < t) i++
    const width = keys[i + 1][0] - keys[i][0], u = (t - keys[i][0]) / width
    const u2 = u * u, u3 = u2 * u
    return (2 * u3 - 3 * u2 + 1) * keys[i][1] + (u3 - 2 * u2 + u) * width * tangent[i]
      + (-2 * u3 + 3 * u2) * keys[i + 1][1] + (u3 - u2) * width * tangent[i + 1]
  }
}

/** Authored from rig parameters only. Deliberately accepts no model assets/motion JSON. */
export function buildDafishAuthoredHappyMotion(parameters: DafishParameter[], physicsOutputIds: Iterable<string> = []) {
  const byId = new Map(parameters.map(p => [p.id, p]))
  const physics = new Set(physicsOutputIds)
  const required = ['AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'Movement2', 'Param59', 'Param60', 'Param61', 'Param62']
  if (!required.every(id => byId.has(id) && !physics.has(id))) return null
  const duration = DAFISH_AUTHORED_HAPPY_DURATION
  const tracks = new Map<string, (t: number) => number>()
  const add = (id: string, keys: Key[]) => {
    if (!byId.has(id) || physics.has(id)) return
    tracks.set(id, authoredTrack(keys))
  }
  const pose = (id: string, keys: Key[]) => {
    const home = byId.get(id)?.default ?? 0
    add(id, [[0, home], ...keys, [duration, home]])
  }

  // A small anticipation precedes one forward, open greeting. No alternating sway cycle.
  pose('PositionX', [[0.7, -0.3], [2.7, 1.7], [4.8, 2.5], [8.3, 1.9], [11.5, 1.1], [14.8, -0.2], [16.3, 0]])
  pose('PositionY', [[0.55, -0.55], [1.8, 2.8], [3.8, 2.1], [5.5, 1.5], [6.15, 2.3], [8.5, 1.8], [12, 0.5], [15.3, 0]])
  pose('PositionZ', [[1.1, 0.4], [3.2, -1.5], [6.4, -0.8], [11, -0.5], [14.9, 0]])
  pose('AngleX', [[0.75, -1.8], [2.1, -5.5], [4.2, -2.8], [6.4, 1.5], [9.5, 0.8], [12.9, 3.2], [15.4, 0]])
  pose('AngleY', [[0.65, -1.3], [1.9, 5.2], [4.55, 3.2], [5.35, -4.1], [5.95, 2.8], [6.75, 0.7], [8.8, 2.1], [12.7, 1.4], [15.7, 0]])
  pose('AngleZ', [[1.2, 1.5], [3.6, 3.5], [5.5, 1.4], [7.4, 2.2], [10.8, 1], [13.8, -1], [16.1, 0]])

  // Left shoulder leads, elbow folds after it, wrist settles last. Reverse that order to release.
  pose('Movement2', [[2.0, 0], [2.9, 1], [11.9, 1], [13.5, 0], [15.7, 0]])
  pose('Param62', [[2.0, 0], [2.45, -0.045], [3.4, 0.065], [4.3, 0.035], [6.2, 0.058], [9.6, 0.042], [11.6, 0.06], [12.7, 0.018], [14.2, 0]])
  pose('Param59', [[2.1, 0], [2.85, 0.18], [3.6, 0.46], [5.4, 0.49], [7.7, 0.43], [11.8, 0.47], [12.8, 0.15], [14.1, 0]])
  pose('Param60', [[2.2, 0], [2.85, 0.28], [3.75, 0.87], [4.8, 0.81], [5.65, 0.76], [6.35, 0.89], [8.6, 0.83], [11.7, 0.85], [12.55, 0.38], [13.8, 0]])
  pose('Param61', [[2.45, 0], [3.15, -0.10], [4.0, 0.075], [4.7, 0.018], [5.6, -0.035], [6.5, 0.055], [9.5, 0.012], [11.6, 0.035], [12.2, -0.06], [13.35, 0]])
  for (const id of ['Movement1', 'Movement3', 'Param36', 'Param39', 'Param41', 'Param42', 'Param43']) pose(id, [])
  add('Param56', [[0, 1], [duration, 1]])
  add('Param57', [[0, 0], [duration, 0]])

  // Face notices the user before the torso responds; gaze returns before the hand lowers.
  add('ParamMouthForm', [[0, 0.28], [0.55, 0.46], [2.4, 0.61], [4.8, 0.56], [5.8, 0.84], [7.0, 0.67], [10.6, 0.53], [13.4, 0.41], [16.3, 0.28], [duration, 0.28]])
  add('ParamMouthOpenY', [[0, 0.025], [1.5, 0.07], [3.5, 0.045], [5.4, 0.22], [5.8, 0.30], [6.35, 0.13], [7.2, 0.055], [11, 0.045], [15.5, 0.025], [duration, 0.025]])
  add('ParamEyeBallX', [[0, 0], [0.65, -0.12], [2.4, -0.04], [4.4, 0], [9.7, 0.02], [12.6, 0.13], [15.2, 0], [duration, 0]])
  add('ParamEyeBallY', [[0, 0], [0.65, 0.055], [2.2, 0.025], [5.3, -0.06], [7.0, 0.02], [11.5, 0.04], [15.8, 0], [duration, 0]])
  const eyelids: Key[] = [[0, 0.97], [2.5, 0.97], [2.62, 0.06], [2.83, 0.95], [4.8, 0.89], [5.8, 0.58], [7.0, 0.86], [10.6, 0.94], [10.76, 0.04], [10.97, 0.96], [15.4, 0.96], [15.53, 0.05], [15.75, 0.97], [duration, 0.97]]
  for (const id of ['ParamEyeLOpen', 'ParamEyeROpen']) add(id, eyelids)
  for (const id of ['ParamEyeLSmile', 'ParamEyeRSmile']) add(id, [[0, 0.12], [2.0, 0.35], [5.8, 0.9], [7.4, 0.45], [13.5, 0.25], [duration, 0.12]])
  for (const id of ['ParamBrowLY', 'ParamBrowRY']) add(id, [[0, 0.04], [1.2, 0.13], [3.5, 0.08], [5.7, 0.16], [8.1, 0.09], [14.5, 0.04], [duration, 0.04]])
  add('key7', [[0, 0.12], [2.6, 0.32], [5.9, 0.5], [10.4, 0.27], [15.6, 0.12], [duration, 0.12]])
  for (const id of ['key4', 'JawOpen']) add(id, [[0, 0], [duration, 0]])

  return bakeDafishParameterMotion(parameters, tracks, duration)
}

/** Shared compiler only; callers supply their own parameter tracks, never native motion assets. */
export function bakeDafishParameterMotion(parameters: DafishParameter[], tracks: Map<string, (t: number) => number>, duration: number) {
  const byId = new Map(parameters.map(p => [p.id, p]))
  const fps = 60, intervals = Math.round(duration * fps)
  const curves = [...tracks].map(([id, sample]) => {
    const p = byId.get(id)!
    const value = (t: number) => Math.round(Math.max(p.min, Math.min(p.max, sample(t))) * 100000) / 100000
    const segments = [0, value(0)]
    for (let i = 1; i <= intervals; i++) segments.push(0, Math.round(i / fps * 100000) / 100000, value(i / fps))
    return { Target: 'Parameter' as const, Id: id, Segments: segments }
  })
  if (curves.some(c => !c.Segments.every(Number.isFinite))) return null
  return { Version: 3 as const,
    Meta: { Duration: duration, Fps: fps, Loop: true, AreBeziersRestricted: true, CurveCount: curves.length,
      TotalSegmentCount: intervals * curves.length, TotalPointCount: (intervals + 1) * curves.length,
      UserDataCount: 0, TotalUserDataSize: 0, FadeInTime: 0.7, FadeOutTime: 0.7 },
    Curves: curves, UserData: [],
  }
}

export function createDafishAuthoredHappyPreset(): ModelStatePreset {
  return { id: DAFISH_AUTHORED_HAPPY_PRESET, label: '开心·独立编排样板', group: '开心样板', emotion: 'happy',
    description: '',
    controls: [], parameters: {}, motion: { group: DAFISH_AUTHORED_HAPPY_MOTION, index: 0 },
    steps: ['迎向你', '抚胸轻笑', '回望放松', '舒展收手'].map(label => ({ label, durationMs: 4400, holdMs: 0, controls: [], parameters: {} })),
    finishMode: 'loop', source: 'builtin', custom: true }
}

export function installDafishAuthoredHappyMotion(model: { internalModel?: any }, parameters: DafishParameter[], physicsOutputIds: Iterable<string> = []): boolean {
  return registerDafishGeneratedMotion(model, DAFISH_AUTHORED_HAPPY_MOTION, buildDafishAuthoredHappyMotion(parameters, physicsOutputIds))
}
