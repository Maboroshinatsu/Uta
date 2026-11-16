import type { ModelStatePreset } from './emotion-adapter'
import { authoredTrack, bakeDafishParameterMotion } from './dafish-authored-happy'
import { registerDafishGeneratedMotion, type DafishParameter } from './dafish-happy-performance'

export const DAFISH_CALIBRATED_HAPPY_MOTION = '开心·大肥鱼标定编排'
export const DAFISH_CALIBRATED_HAPPY_PRESET = 'dafish_calibrated_happy_v3'
export const DAFISH_CALIBRATED_HAPPY_DURATION = 12.8

/** Empirical rig notes: docs/live2d/dafish-calibration-20261102.md.
 * Movement2 selects a hand, not a ready-made chest action. Its joints must move together.
 * EyeSmile is conditional on eyelid opening; no ParamEyeLSmile/ParamEyeRSmile exists here.
 */
export function buildDafishCalibratedHappyMotion(parameters: DafishParameter[], physicsOutputIds: Iterable<string> = []) {
  const byId = new Map(parameters.map(p => [p.id, p])), physics = new Set(physicsOutputIds)
  const required = ['AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput', 'Movement2', 'Param62', 'Param59', 'Param60', 'Param61']
  if (!required.every(id => byId.has(id) && !physics.has(id))) return null
  const tracks = new Map<string, (t: number) => number>(), duration = DAFISH_CALIBRATED_HAPPY_DURATION
  const add = (id: string, sample: (t: number) => number) => {
    if (byId.has(id) && !physics.has(id)) tracks.set(id, sample)
  }
  const keys = (id: string, points: Array<readonly [number, number]>) => add(id, authoredTrack(points))
  const body = (id: string, points: Array<readonly [number, number]>) => keys(id, [[0, 0], ...points, [duration, 0]])

  // Notice first. Torso follows the gaze/head, then comes one small laughing nod.
  body('AngleX', [[0.45, 0], [1.35, -4.5], [3.2, -2], [5.3, 0.6], [7.5, 1.2], [10.5, 0]])
  body('AngleY', [[1.1, 1.8], [3.6, 2.8], [4.45, -3.3], [5.1, 2.5], [5.9, 0.8], [8.2, 1.1], [11.0, 0]])
  body('AngleZ', [[1.5, 2.2], [3.4, 3.1], [4.6, 1.3], [6.1, 2.2], [8.6, 1.2], [11.2, 0]])
  body('PositionX', [[1.0, -0.35], [3.0, 1.8], [5.4, 1.4], [7.1, 1.1], [10.6, 0]])
  body('PositionY', [[0.6, -0.25], [2.4, 1.1], [4.4, 0.6], [5.2, 1.0], [7.7, 0.55], [10.8, 0]])
  body('PositionZ', [[1.6, 0.7], [3.8, 1.3], [6.3, 0.8], [10.7, 0]])
  body('LeanInput', [[1.9, 0.5], [3.7, 1.8], [4.5, 2.6], [5.5, 1.2], [8.0, 0.7], [10.8, 0]])

  // Positive elbow paths still swept outward in candidate A. An additional negative-angle
  // sweep found a chest-height pose halfway along the inward path, with the elbow kept low.
  const lift = authoredTrack([[0, 0], [0.9, 0], [3.0, 1], [6.7, 1], [10.4, 0], [duration, 0]])
  add('Param62', t => 0.034 * 0.5 * lift(t))
  add('Param59', t => 0.476 * (0.5 * lift(t)) ** 2)
  add('Param60', t => -(1 - (1 - 0.5 * lift(t)) ** 1.7))
  body('Param61', [[3.0, 0], [4.2, -0.055], [5.4, 0.035], [6.8, 0], [10.4, 0]])
  keys('Movement2', [[0, 0], [0.15, 0], [0.33, 1], [10.8, 1], [10.98, 0], [duration, 0]])
  for (const id of ['Movement1', 'Movement3', 'Param36', 'Param39', 'Param41', 'Param42', 'Param43']) add(id, () => byId.get(id)?.default ?? 0)

  keys('ParamMouthForm', [[0, 0.25], [1.2, 0.45], [3.2, 0.6], [4.6, 0.8], [5.6, 0.65], [7.6, 0.5], [11.3, 0.25], [duration, 0.25]])
  keys('ParamMouthOpenY', [[0, 0.025], [2.4, 0.06], [3.9, 0.12], [4.6, 0.27], [5.2, 0.16], [6.0, 0.065], [8.4, 0.04], [11.5, 0.025], [duration, 0.025]])
  keys('EyeSmile', [[0, 0.1], [3.3, 0.35], [4.7, 0.85], [6.2, 0.4], [10.9, 0.1], [duration, 0.1]])
  for (const id of ['ParamEyeLOpen', 'ParamEyeROpen']) keys(id, [[0, 0.97], [2.9, 0.96], [3.02, 0.04], [3.23, 0.92], [4.65, 0.66], [5.6, 0.87], [8.8, 0.95], [8.94, 0.04], [9.16, 0.97], [duration, 0.97]])
  body('ParamEyeBallX', [[0.6, -0.12], [2.2, 0], [6.5, 0.03], [9.1, 0.06], [11.4, 0]])
  body('ParamEyeBallY', [[1.1, 0.025], [4.45, -0.035], [5.8, 0.025], [10.8, 0]])
  for (const id of ['ParamBrowLY', 'ParamBrowRY']) body(id, [[1.3, 0.10], [4.6, 0.15], [6.0, 0.08], [11.2, 0]])
  keys('key7', [[0, 0.1], [2.3, 0.35], [4.6, 0.65], [6.7, 0.5], [10.5, 0.1], [duration, 0.1]])
  for (const id of ['key4', 'JawOpen']) add(id, () => 0)
  return bakeDafishParameterMotion(parameters, tracks, duration)
}

export function createDafishCalibratedHappyPreset(): ModelStatePreset {
  return { id: DAFISH_CALIBRATED_HAPPY_PRESET, label: '开心·标定编排样板', group: '开心样板', emotion: 'happy',
    description: '',
    controls: [], parameters: {}, motion: { group: DAFISH_CALIBRATED_HAPPY_MOTION, index: 0 },
    steps: ['注意到你', '抚胸轻笑', '放松收手', '停歇'].map(label => ({ label, durationMs: 3200, holdMs: 0, controls: [], parameters: {} })),
    finishMode: 'loop', source: 'builtin', custom: true }
}

export function installDafishCalibratedHappyMotion(model: { internalModel?: any }, parameters: DafishParameter[], physicsOutputIds: Iterable<string> = []): boolean {
  return registerDafishGeneratedMotion(model, DAFISH_CALIBRATED_HAPPY_MOTION, buildDafishCalibratedHappyMotion(parameters, physicsOutputIds))
}
