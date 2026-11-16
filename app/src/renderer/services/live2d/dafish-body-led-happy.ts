import type { ModelStatePreset } from './emotion-adapter'
import { authoredTrack, bakeDafishParameterMotion } from './dafish-authored-happy'
import { buildDafishCalibratedHappyMotion } from './dafish-calibrated-happy'
import { compileMotionTrack, registerDafishGeneratedMotion, type DafishParameter } from './dafish-happy-performance'

export const DAFISH_BODY_LED_HAPPY_MOTION = '开心·大肥鱼身体主导'
export const DAFISH_BODY_LED_HAPPY_PRESET = 'dafish_body_led_happy_v4'
export const DAFISH_BODY_LED_HAPPY_DURATION = 6.4

/** V3 was rejected: body peaks of 1–3 and multi-second lifts were not readable.
 * Keep its independently authored face material, replace torso/hip/arm choreography.
 * headStill is a diagnostic variant used to verify body motion without head accents.
 */
export function buildDafishBodyLedHappyMotion(parameters: DafishParameter[], physicsOutputIds: Iterable<string> = [], headStill = false) {
  const previous = buildDafishCalibratedHappyMotion(parameters, physicsOutputIds)
  if (!previous) return null
  const tracks = new Map(previous.Curves.map(c => {
    const source = compileMotionTrack(c.Segments)!
    return [c.Id, (t: number) => source.sample(t * 2)] as const
  }))
  const duration = DAFISH_BODY_LED_HAPPY_DURATION
  const byId = new Map(parameters.map((p) => [p.id, p]))
  const physics = new Set(physicsOutputIds)
  const keys = (id: string, points: Array<readonly [number, number]>) => {
    if (tracks.has(id)) tracks.set(id, authoredTrack(points))
  }
  const body = (id: string, points: Array<readonly [number, number]>) => keys(id, [[0, 0], ...points, [duration, 0]])

  // Small anticipation, a clear upward/open weight shift, laughing accent, then settle.
  // PositionZ drives opposite torso/pelvis rotations; these are inputs, not physics outputs.
  body('PositionX', [[0.24, -3], [0.86, 12], [1.55, 9], [2.25, 6], [3.05, -3.5], [4.4, 0]])
  body('PositionZ', [[0.27, -4], [0.98, 16], [1.6, 11], [2.2, 7], [3.15, -4], [4.5, 0]])
  body('PositionY', [[0.24, -2], [0.78, 6.5], [1.3, 3.2], [1.83, 5.5], [2.55, 1.3], [3.3, -0.6], [4.3, 0]])
  body('LeanInput', [[0.3, 0], [1.0, 4.5], [1.46, 1.7], [1.95, 5.5], [2.65, 1.4], [4.4, 0]])

  body('AngleX', [[0.8, -2.5], [1.8, 1.3], [3.8, 0]])
  body('AngleY', [[0.85, 1.4], [1.9, -2], [2.3, 0.8], [4.0, 0]])
  body('AngleZ', [[0.95, 3], [2.0, 1.5], [3.2, -0.8], [4.4, 0]])
  if (headStill) for (const id of ['AngleX', 'AngleY', 'AngleZ']) tracks.set(id, () => 0)

  const handStart = 0.24, handHome = 3.12
  const lift = authoredTrack([[0, 0], [handStart, 0], [0.98, 1], [2.12, 1], [handHome, 0], [duration, 0]])
  tracks.set('Param62', t => 0.017 * lift(t))
  tracks.set('Param59', t => 0.119 * lift(t) ** 2)
  tracks.set('Param60', t => -(1 - (1 - 0.5 * lift(t)) ** 1.7))
  body('Param61', [[0.98, 0], [1.25, -0.08], [1.65, 0.04], [2.05, -0.03], [2.5, 0], [3.12, 0]])
  keys('Movement2', [[0, 0], [0.04, 0], [0.19, 1], [3.28, 1], [3.45, 0], [duration, 0]])
  // 手要留在身前靠 Param56/57（与「抚胸」控件同值），其余 8 个身体主导预设都写了这两条。
  // V3 的曲线里没有它们，keys() 的 has 守卫会静默跳过，所以必须直接补常量轨道，
  // 否则抚胸手会被画到本体后面，看起来像手消失了。
  for (const [id, value] of [['Param56', 1], ['Param57', 0]] as const) {
    if (byId.has(id) && !physics.has(id)) tracks.set(id, () => value)
  }

  // Laugh with the gesture, not with V3's delayed facial peak. Stay open through
  // the complete return, then ease out after the hand has reached its home pose.
  const laugh = authoredTrack([[0, 0], [handStart, 0], [handStart + 0.32, 1], [handHome, 1], [handHome + 0.43, 0], [duration, 0]])
  if (tracks.has('ParamMouthOpenY')) tracks.set('ParamMouthOpenY', t => 0.025 + 0.245 * laugh(t))
  if (tracks.has('ParamMouthForm')) tracks.set('ParamMouthForm', t => 0.25 + 0.55 * laugh(t))
  if (tracks.has('EyeSmile')) tracks.set('EyeSmile', t => 0.1 + 0.75 * laugh(t))
  return bakeDafishParameterMotion(parameters, tracks, duration)
}

export function createDafishBodyLedHappyPreset(): ModelStatePreset {
  return { id: DAFISH_BODY_LED_HAPPY_PRESET, label: '开心', group: '开心', emotion: 'happy',
    description: '',
    controls: [], parameters: {}, motion: { group: DAFISH_BODY_LED_HAPPY_MOTION, index: 0 },
    // Empty steps are lifecycle labels, not slow joint transitions. Take gaze ownership
    // promptly so a 1.6-second focus fade cannot overwhelm the first body accent.
    steps: [
      {
        label: '抬身迎向',
        durationMs: 200,
        holdMs: 1400,
        controls: [],
        parameters: { PositionZ: 8, AngleY: 6, ParamMouthForm: 0.8, ParamMouthOpenY: 0.2, EyeSmile: 0.8 },
      },
      {
        label: '抚胸轻笑',
        durationMs: 1600,
        holdMs: 0,
        controls: [],
        parameters: { PositionZ: 10, AngleY: 4, ParamMouthForm: 0.9, ParamMouthOpenY: 0.3, EyeSmile: 0.9 },
      },
      {
        label: '收手回落',
        durationMs: 1600,
        holdMs: 0,
        controls: [],
        parameters: { PositionZ: 4, AngleY: 2, ParamMouthForm: 0.5 },
      },
      {
        label: '停歇',
        durationMs: 1600,
        holdMs: 0,
        controls: [],
        parameters: { PositionZ: 0, AngleY: 0, ParamMouthForm: 0, EyeSmile: 0 },
      },
    ],
    finishMode: 'revert', revertHoldMs: 0, source: 'builtin', custom: true }
}

export function installDafishBodyLedHappyMotion(model: { internalModel?: any }, parameters: DafishParameter[], physicsOutputIds: Iterable<string> = []): boolean {
  return registerDafishGeneratedMotion(model, DAFISH_BODY_LED_HAPPY_MOTION, buildDafishBodyLedHappyMotion(parameters, physicsOutputIds))
}
