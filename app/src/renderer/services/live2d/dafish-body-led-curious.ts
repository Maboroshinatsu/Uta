import type { ModelStatePreset } from './emotion-adapter'
import { authoredTrack, bakeDafishParameterMotion } from './dafish-authored-happy'
import { registerDafishGeneratedMotion, type DafishParameter } from './dafish-happy-performance'

export const DAFISH_BODY_LED_CURIOUS_MOTION = '好奇·大肥鱼灵动探身'
export const DAFISH_BODY_LED_CURIOUS_PRESET = 'dafish_body_led_curious'
export const DAFISH_BODY_LED_CURIOUS_DURATION = 5.6

type Key = readonly [seconds: number, value: number]

/**
 * 好奇·大肥鱼灵动探身（5.6 秒）：
 * 1. 0.0s ~ 0.8s【大动作近身前探】：身体大幅度前倾近身（LeanInput: -24, PositionZ: 12, PositionX: -9），
 *    头部甩出 22° 夸张萌系大歪头，嘴巴变成好奇小圆口（小 O 嘴），眼神睁大探视；
 * 2. 0.8s ~ 3.2s【脱捕同款：双重弹性颠步探脑】：在近身姿态下连续卡点做两次俏皮弹跳起伏（PositionY: 3.2 -> -2.5 -> 4.0），
 *    双手和发丝随弹跳产生强烈的重力与惯性晃动，嘴巴随节奏一开一合，眼球左右扫视；
 * 3. 3.2s ~ 4.4s【辨认满足与灵巧轻笑】：歪头顺势换向另一侧轻晃，小 O 嘴化为得逞的甜美微笑，在 3.8s 完成干脆利落的 140ms 生理眨眼；
 * 4. 4.4s ~ 5.6s【平滑舒展回正】：各轴导数平滑收敛回初始待机位，无缝闭环。
 */
export function buildDafishBodyLedCuriousMotion(
  parameters: DafishParameter[],
  physicsOutputIds: Iterable<string> = [],
) {
  const byId = new Map(parameters.map(p => [p.id, p]))
  const physics = new Set(physicsOutputIds)
  const required = [
    'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput',
  ]
  if (!required.every(id => byId.has(id) && !physics.has(id))) return null

  const duration = DAFISH_BODY_LED_CURIOUS_DURATION
  const tracks = new Map<string, (t: number) => number>()

  const add = (id: string, keys: Key[]) => {
    if (!byId.has(id) || physics.has(id)) return
    tracks.set(id, authoredTrack(keys))
  }
  const body = (id: string, keys: Key[]) => add(id, [[0, 0], ...keys, [duration, 0]])

  // 1. 身体主控：大角度探身近前与侧身（身体主导）
  body('LeanInput', [
    [0.25, 2.0],
    [0.80, -22.0],
    [1.50, -25.0],
    [2.30, -23.0],
    [3.20, -15.0],
    [4.20, 0.0],
  ])
  body('PositionZ', [
    [0.25, -2.5],
    [0.80, 12.0],
    [1.50, 14.0],
    [2.30, 11.0],
    [3.20, 6.0],
    [4.20, 0.0],
  ])
  body('PositionX', [
    [0.25, 1.5],
    [0.80, -8.5],
    [1.50, -9.5],
    [2.30, -8.0],
    [3.20, -4.0],
    [4.20, 0.0],
  ])

  // 脱捕同款：连续两次节奏颠步起伏（PositionY 连续弹跳）
  body('PositionY', [
    [0.25, -1.2],
    [0.80, 3.2],
    // 颠步 1
    [1.25, -2.5],
    [1.65, 4.0],
    [1.95, 2.5],
    // 颠步 2
    [2.35, -2.0],
    [2.75, 3.6],
    [3.10, 2.0],
    // 舒展回落
    [3.80, 0.8],
    [4.40, 0.0],
  ])

  // 头部大姿态：22° 萌系大歪头与探视扬下巴
  body('AngleZ', [
    [0.25, -1.5],
    [0.80, 20.5],
    [1.60, 22.5],
    [2.40, 20.0],
    [3.30, -8.0], // 辨认后可爱地往另一侧轻歪
    [4.30, 0.0],
  ])
  body('AngleY', [
    [0.25, -1.0],
    [0.80, 4.5],
    [1.60, 3.0],
    [2.40, 4.8],
    [3.30, 2.0],
    [4.30, 0.0],
  ])
  body('AngleX', [
    [0.25, 1.5],
    [0.80, -4.0],
    [1.60, 3.5], // 左右探头打量
    [2.40, -3.0],
    [3.30, 1.5],
    [4.30, 0.0],
  ])

  // 2. 双手自然垂落，绝对不拿多余道具，完全由原生物理响应颠步甩荡
  add('Movement1', [[0, 0], [duration, 0]])
  add('Movement2', [[0, 0], [duration, 0]])
  add('Movement3', [[0, 0], [duration, 0]])
  add('Param56', [[0, 1], [duration, 1]])
  add('Param57', [[0, 0], [duration, 0]])

  // 3. 好奇专属面部五官：好奇小 O 嘴与探索眼神
  // 嘴巴：0.8s 变成好奇小 O 嘴，颠步时两次轻微吸呼开合，3.4s 之后化为得意浅笑
  add('ParamMouthOpenY', [
    [0.00, 0.025],
    [0.75, 0.35],
    [1.25, 0.12],
    [1.65, 0.38],
    [2.00, 0.15],
    [2.35, 0.10],
    [2.75, 0.34],
    [3.20, 0.10],
    [3.70, 0.03],
    [duration, 0.025],
  ])
  add('ParamMouthForm', [
    [0.00, 0.28],
    [0.75, -0.25], // 纯正小 O 嘴（负值）
    [3.10, -0.20],
    [3.50, 0.65],  // 辨认满足后化为甜美微笑
    [4.40, 0.28],
    [duration, 0.28],
  ])

  // 眉毛：微扬好奇挑眉
  add('ParamBrowLY', [
    [0.00, 0.04],
    [0.75, 0.25],
    [3.20, 0.25],
    [4.20, 0.04],
    [duration, 0.04],
  ])
  add('ParamBrowRY', [
    [0.00, 0.04],
    [0.75, 0.25],
    [3.20, 0.25],
    [4.20, 0.04],
    [duration, 0.04],
  ])

  // 眼睛与视线：双眼睁大探究，在 3.8s 插入 140ms 干脆生理眨眼
  const blink: Key[] = [
    [0.00, 0.98],
    [3.75, 0.98],
    [3.82, 0.05],
    [3.96, 0.98],
    [duration, 0.98],
  ]
  add('ParamEyeLOpen', blink)
  add('ParamEyeROpen', blink)
  add('EyeSmile', [
    [0.00, 0.0],
    [3.20, 0.0],
    [3.50, 0.65],
    [4.40, 0.0],
    [duration, 0.0],
  ])

  // 眼球扫视：好奇地左右打量
  add('ParamEyeBallX', [
    [0.00, 0.0],
    [0.80, -0.25],
    [1.60, 0.30],
    [2.40, -0.20],
    [3.30, 0.10],
    [4.20, 0.0],
    [duration, 0.0],
  ])
  add('ParamEyeBallY', [
    [0.00, 0.0],
    [0.80, 0.15],
    [1.60, 0.05],
    [2.40, 0.18],
    [3.30, 0.0],
    [duration, 0.0],
  ])

  return bakeDafishParameterMotion(parameters, tracks, duration)
}

export function createDafishBodyLedCuriousPreset(): ModelStatePreset {
  return {
    id: DAFISH_BODY_LED_CURIOUS_PRESET,
    label: '好奇',
    group: '好奇',
    emotion: 'curious',
    description: '',
    controls: [],
    parameters: {},
    motion: { group: DAFISH_BODY_LED_CURIOUS_MOTION, index: 0 },
    steps: [
      {
        label: '大歪头探身',
        durationMs: 200,
        holdMs: 1200,
        controls: [],
        parameters: {
          LeanInput: -22, PositionZ: 12, PositionX: -8.5, PositionY: 3.2, AngleZ: 20.5, AngleY: 4.5, ParamEyeLOpen: 1.15, ParamEyeROpen: 1.15, ParamMouthOpenY: 0.7,
        },
      },
      {
        label: '起伏打量',
        durationMs: 1400,
        holdMs: 0,
        controls: [],
        parameters: {
          LeanInput: -23, PositionZ: 11, PositionX: -8, PositionY: 2.5, AngleZ: 20, AngleY: 4.8, ParamMouthOpenY: 0.4,
        },
      },
      {
        label: '辨认微笑',
        durationMs: 1400,
        holdMs: 0,
        controls: [],
        parameters: {
          LeanInput: -15, AngleZ: -8, ParamMouthForm: 1.0, ParamEyeLOpen: 1.0, ParamEyeROpen: 1.0,
        },
      },
      {
        label: '回落',
        durationMs: 1400,
        holdMs: 0,
        controls: [],
        parameters: {
          LeanInput: 0, PositionZ: 0, PositionX: 0, PositionY: 0, AngleZ: 0, AngleY: 0, ParamMouthForm: 0, ParamMouthOpenY: 0,
        },
      },
    ],
    finishMode: 'revert',
    revertHoldMs: 0,
    source: 'builtin',
    custom: true,
  }
}

export function installDafishBodyLedCuriousMotion(
  model: { internalModel?: any },
  parameters: DafishParameter[],
  physicsOutputIds: Iterable<string> = [],
): boolean {
  return registerDafishGeneratedMotion(
    model,
    DAFISH_BODY_LED_CURIOUS_MOTION,
    buildDafishBodyLedCuriousMotion(parameters, physicsOutputIds),
  )
}
