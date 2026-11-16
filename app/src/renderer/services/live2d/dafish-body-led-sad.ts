import type { ModelStatePreset } from './emotion-adapter'
import { authoredTrack, bakeDafishParameterMotion } from './dafish-authored-happy'
import { registerDafishGeneratedMotion, type DafishParameter } from './dafish-happy-performance'

export const DAFISH_BODY_LED_SAD_MOTION = '委屈·大肥鱼抚胸含泪'
export const DAFISH_BODY_LED_SAD_PRESET = 'dafish_body_led_sad'
export const DAFISH_BODY_LED_SAD_DURATION = 6.0

type Key = readonly [seconds: number, value: number]

/**
 * 委屈·大肥鱼抚胸含泪（6.0 秒）：
 * 1. 0.0s ~ 0.9s【含胸塌肩与下沉】：抚胸手护于胸口，整个人塌肩含胸下沉（PositionY: -5.5, PositionX: -6.5, PositionZ: -8），
 *    头颈低垂（AngleY: -7.5），八字大蹙眉，嘴角大幅下撇，眼角流出清泪（key2: 1）；
 * 2. 0.9s ~ 3.8s【委屈抽泣·短促颤动】：在低沉蜷缩姿态下，伴随两次伤心的抽噎抽泣（PositionY: -5.5 -> -4.0 -> -5.8），
 *    嘴巴随抽噎微张微抽，眼泪在眼角溢出；
 * 3. 3.8s ~ 5.0s【吸气平复·收手舒缓】：抽泣渐止，手腕放松顺势滑落身侧，Movement2 切回 0，泪痕淡出，身体微微回抬；
 * 4. 5.0s ~ 6.0s【平滑归零与无缝 C1 循环】。
 */
export function buildDafishBodyLedSadMotion(
  parameters: DafishParameter[],
  physicsOutputIds: Iterable<string> = [],
) {
  const byId = new Map(parameters.map(p => [p.id, p]))
  const physics = new Set(physicsOutputIds)
  const required = [
    'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ',
    'Movement2', 'Param59', 'Param60', 'Param61', 'Param62',
  ]
  if (!required.every(id => byId.has(id) && !physics.has(id))) return null

  const duration = DAFISH_BODY_LED_SAD_DURATION
  const tracks = new Map<string, (t: number) => number>()

  const add = (id: string, keys: Key[]) => {
    if (!byId.has(id) || physics.has(id)) return
    tracks.set(id, authoredTrack(keys))
  }
  const body = (id: string, keys: Key[]) => add(id, [[0, 0], ...keys, [duration, 0]])

  // 1. 身体主控：塌肩下沉与蜷缩（身体主导）
  body('PositionY', [
    [0.25, 0.5],
    [0.90, -5.5], // 身体下沉凹陷
    // 抽泣 1
    [1.50, -5.5],
    [1.70, -3.8],
    [1.95, -5.8],
    // 抽泣 2
    [2.50, -5.8],
    [2.70, -4.2],
    [2.95, -5.6],
    // 舒缓回升
    [4.00, -2.5],
    [5.00, 0.0],
  ])
  body('PositionX', [
    [0.25, -1.0],
    [0.90, -6.5],
    [2.50, -7.0],
    [4.00, -3.0],
    [5.00, 0.0],
  ])
  body('PositionZ', [
    [0.25, 1.0],
    [0.90, -8.0],
    [2.50, -8.5],
    [4.00, -3.5],
    [5.00, 0.0],
  ])
  body('LeanInput', [
    [0.90, 8.0], // 含胸弓背
    [2.50, 9.0],
    [4.00, 3.0],
    [5.00, 0.0],
  ])

  // 头部低垂微侧
  body('AngleY', [
    [0.90, -7.5], // 低头
    [1.70, -6.0],
    [1.95, -8.0],
    [2.70, -6.5],
    [2.95, -7.8],
    [4.00, -2.5],
    [5.00, 0.0],
  ])
  body('AngleZ', [
    [0.90, 4.5],
    [2.50, 5.0],
    [4.00, 1.5],
    [5.00, 0.0],
  ])
  body('AngleX', [
    [0.90, -3.0],
    [2.50, -3.5],
    [4.00, 0.0],
  ])

  // 2. 抚胸手（护在心口）
  add('Movement2', [
    [0.00, 0],
    [0.20, 0],
    [0.25, 1],
    [4.10, 1],
    [4.45, 0],
    [duration, 0],
  ])
  const handLift = authoredTrack([
    [0.00, 0],
    [0.25, 0],
    [0.90, 1],
    [3.80, 1],
    [4.40, 0],
    [duration, 0],
  ])
  tracks.set('Param62', t => 0.017 * handLift(t))
  tracks.set('Param59', t => 0.119 * handLift(t) ** 2)
  tracks.set('Param60', t => -(1 - (1 - 0.5 * handLift(t)) ** 1.7))
  body('Param61', [
    [1.70, -0.06], // 抽泣时手腕紧了紧
    [2.70, -0.06],
    [3.80, 0.0],
  ])

  add('Movement1', [[0, 0], [duration, 0]])
  add('Movement3', [[0, 0], [duration, 0]])
  add('Param56', [[0, 1], [duration, 1]])
  add('Param57', [[0, 0], [duration, 0]])

  // 3. 委屈泪痕：key2 (流泪)
  add('key2', [
    [0.00, 0],
    [0.65, 0],
    [0.90, 1],
    [3.80, 1],
    [4.30, 0],
    [duration, 0],
  ])

  // 4. 委屈面部五官：八字愁眉与嘴角大幅下撇
  add('ParamBrowLY', [
    [0.00, 0.04],
    [0.85, -0.55],
    [3.80, -0.55],
    [4.80, 0.04],
    [duration, 0.04],
  ])
  add('ParamBrowRY', [
    [0.00, 0.04],
    [0.85, -0.55],
    [3.80, -0.55],
    [4.80, 0.04],
    [duration, 0.04],
  ])
  add('ParamBrowLAngle', [
    [0.00, 0],
    [0.85, -0.45],
    [3.80, -0.45],
    [4.80, 0],
    [duration, 0],
  ])
  add('ParamBrowRAngle', [
    [0.00, 0],
    [0.85, -0.45],
    [3.80, -0.45],
    [4.80, 0],
    [duration, 0],
  ])

  // 嘴角大幅下撇委屈嘴（-0.75），抽噎时微张
  add('ParamMouthForm', [
    [0.00, 0.28],
    [0.85, -0.75],
    [3.80, -0.75],
    [4.80, 0.28],
    [duration, 0.28],
  ])
  add('ParamMouthOpenY', [
    [0.00, 0.025],
    [0.85, 0.05],
    // 抽噎微张口
    [1.70, 0.20],
    [1.95, 0.04],
    [2.70, 0.18],
    [2.95, 0.04],
    [3.80, 0.03],
    [duration, 0.025],
  ])

  // 眼睛半含泪微阖与低垂视线
  const eyelids: Key[] = [
    [0.00, 0.98],
    [0.90, 0.72],
    [1.70, 0.45], // 抽搐时眼角挤紧
    [1.95, 0.75],
    [2.70, 0.45],
    [2.95, 0.75],
    [3.80, 0.75],
    [4.10, 0.05], // 眨眼拭泪
    [4.25, 0.98],
    [duration, 0.98],
  ]
  add('ParamEyeLOpen', eyelids)
  add('ParamEyeROpen', eyelids)
  add('ParamEyeBallX', [[0, 0], [duration, 0]])
  add('ParamEyeBallY', [
    [0.00, 0],
    [0.90, -0.35], // 伤心低眸
    [3.80, -0.35],
    [4.80, 0],
    [duration, 0],
  ])

  return bakeDafishParameterMotion(parameters, tracks, duration)
}

export function createDafishBodyLedSadPreset(): ModelStatePreset {
  return {
    id: DAFISH_BODY_LED_SAD_PRESET,
    label: '委屈',
    group: '难过',
    emotion: 'sad',
    description: '',
    controls: [],
    parameters: {},
    motion: { group: DAFISH_BODY_LED_SAD_MOTION, index: 0 },
    steps: [
      {
        label: '塌肩蜷缩',
        durationMs: 200,
        holdMs: 1250,
        controls: [],
        parameters: {
          PositionZ: -10, LeanInput: 15, AngleY: -6, ParamBrowLY: -0.6, ParamBrowRY: -0.6, ParamMouthForm: -0.8, ParamEyeLOpen: 0.6, ParamEyeROpen: 0.6,
        },
      },
      {
        label: '抽泣颤动',
        durationMs: 1450,
        holdMs: 0,
        controls: [],
        parameters: {
          PositionZ: -8, LeanInput: 12, ParamBrowLY: -0.7, ParamMouthForm: -0.9,
        },
      },
      {
        label: '平复拭泪',
        durationMs: 1450,
        holdMs: 0,
        controls: [],
        parameters: {
          PositionZ: -4, LeanInput: 6, ParamBrowLY: -0.3, ParamMouthForm: -0.4,
        },
      },
      {
        label: '回位',
        durationMs: 1450,
        holdMs: 0,
        controls: [],
        parameters: {
          PositionZ: 0, LeanInput: 0, AngleY: 0, ParamBrowLY: 0, ParamBrowRY: 0, ParamMouthForm: 0, ParamEyeLOpen: 1.0, ParamEyeROpen: 1.0,
        },
      },
    ],
    finishMode: 'revert',
    revertHoldMs: 0,
    source: 'builtin',
    custom: true,
  }
}

export function installDafishBodyLedSadMotion(
  model: { internalModel?: any },
  parameters: DafishParameter[],
  physicsOutputIds: Iterable<string> = [],
): boolean {
  return registerDafishGeneratedMotion(
    model,
    DAFISH_BODY_LED_SAD_MOTION,
    buildDafishBodyLedSadMotion(parameters, physicsOutputIds),
  )
}
