import type { ModelStatePreset } from './emotion-adapter'
import { authoredTrack, bakeDafishParameterMotion } from './dafish-authored-happy'
import { registerDafishGeneratedMotion, type DafishParameter } from './dafish-happy-performance'

export const DAFISH_BODY_LED_ANGRY_MOTION = '生气·身体前倾'
export const DAFISH_BODY_LED_ANGRY_PRESET = 'dafish_body_led_angry'
export const DAFISH_BODY_LED_ANGRY_DURATION = 5.6

type Key = readonly [seconds: number, value: number]

/**
 * 生气·身体前倾（5.6 秒）：
 * 1. 0.0s ~ 0.8s【身体前倾逼近·正面直视】：正对屏幕不偏头不斜瞄（AngleX: 0, AngleZ: 0），身体大开大合猛烈前倾逼近用户（LeanInput: -25, PositionZ: 15），下巴微压锁定视线；
 * 2. 0.8s ~ 3.6s【怒意爆发·气红脸紧绷喘息】：满面气红（key7: 0.90），严厉倒八字倒竖眉（LAngle/RAngle: -0.55），紧绷下撇抿嘴怒目直视，胸腔伴随剧烈起伏气愤喘息；
 * 3. 3.6s ~ 4.6s【气消缓和·平稳后撤】：怒意散去，脸红淡出，身体缓缓直起回正，并在 4.0s 处完成一次平静眨眼；
 * 4. 4.6s ~ 5.6s【平滑归零与无缝 C1 循环】。
 */
export function buildDafishBodyLedAngryMotion(
  parameters: DafishParameter[],
  physicsOutputIds: Iterable<string> = [],
) {
  const byId = new Map(parameters.map(p => [p.id, p]))
  const physics = new Set(physicsOutputIds)
  const required = [
    'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput',
  ]
  if (!required.every(id => byId.has(id) && !physics.has(id))) return null

  const duration = DAFISH_BODY_LED_ANGRY_DURATION
  const tracks = new Map<string, (t: number) => number>()

  const add = (id: string, keys: Key[]) => {
    if (!byId.has(id) || physics.has(id)) return
    tracks.set(id, authoredTrack(keys))
  }
  const body = (id: string, keys: Key[]) => add(id, [[0, 0], ...keys, [duration, 0]])

  // 1. 身体主控：大开大合前倾逼近用户，重心始终正中
  body('LeanInput', [
    [0.20, -3.0],
    [0.80, -22.0], // 猛烈前倾
    [1.80, -25.0],
    [2.80, -23.0],
    [3.60, -12.0],
    [4.60, 0.0],
  ])
  body('PositionZ', [
    [0.20, 2.0],
    [0.80, 13.0],  // 向前压近屏幕
    [1.80, 15.0],
    [2.80, 14.0],
    [3.60, 10.0],
    [4.60, 0.0],
  ])
  body('PositionY', [
    [0.20, -0.5],
    [0.80, -1.5],  // 沉身蓄怒
    // 气愤剧烈呼吸起伏
    [1.30, 0.5],
    [1.65, -2.0],
    [2.10, 0.8],
    [2.50, -2.0],
    [2.95, 0.6],
    [3.35, -1.6],
    [4.20, -0.5],
    [4.80, 0.0],
  ])
  body('PositionX', [
    [0.80, 0.0],
    [3.60, 0.0],
    [4.60, 0.0],
  ])

  // 头部姿态：面向正前方，不偏头不斜侧，下巴微收瞪视
  body('AngleX', [
    [0.80, 0.0],
    [3.60, 0.0],
    [4.60, 0.0],
  ])
  body('AngleZ', [
    [0.80, 0.0],
    [3.60, 0.0],
    [4.60, 0.0],
  ])
  body('AngleY', [
    [0.80, -3.0],  // 下巴微压紧盯
    [1.80, -3.5],
    [2.80, -3.5],
    [3.60, -1.0],
    [4.60, 0.0],
  ])

  // 2. 双手自然紧绷垂立身侧
  add('Movement1', [[0, 0], [duration, 0]])
  add('Movement2', [[0, 0], [duration, 0]])
  add('Movement3', [[0, 0], [duration, 0]])
  add('Param56', [[0, 1], [duration, 1]])
  add('Param57', [[0, 0], [duration, 0]])

  // 3. 生气配件与气红脸：仅保留脸红 (key7)，严禁搞怪兔牙 (key9 置 0)
  add('key7', [
    [0.00, 0.0],
    [0.50, 0.0],
    [0.80, 0.90],
    [3.60, 0.90],
    [4.40, 0.0],
    [duration, 0.0],
  ])
  add('key9', [[0, 0], [duration, 0]])

  // 4. 严厉倒八字倒竖眉与怒视嘴角
  add('ParamBrowLY', [
    [0.00, 0.04],
    [0.80, 0.20],
    [3.60, 0.20],
    [4.50, 0.04],
    [duration, 0.04],
  ])
  add('ParamBrowRY', [
    [0.00, 0.04],
    [0.80, 0.20],
    [3.60, 0.20],
    [4.50, 0.04],
    [duration, 0.04],
  ])
  add('ParamBrowLAngle', [
    [0.00, 0.0],
    [0.80, -0.55], // 严厉下压倒竖眉
    [3.60, -0.55],
    [4.50, 0.0],
    [duration, 0.0],
  ])
  add('ParamBrowRAngle', [
    [0.00, 0.0],
    [0.80, -0.55],
    [3.60, -0.55],
    [4.50, 0.0],
    [duration, 0.0],
  ])

  // 紧绷下撇抿嘴（闭口紧绷怒意，无搞怪露齿）
  add('ParamMouthForm', [
    [0.00, 0.28],
    [0.80, -0.65],
    [3.60, -0.65],
    [4.60, 0.28],
    [duration, 0.28],
  ])
  add('ParamMouthOpenY', [[0, 0], [duration, 0]])

  // 视线死死正视用户眼睛
  add('ParamEyeBallX', [[0, 0], [duration, 0]])
  add('ParamEyeBallY', [
    [0.00, 0.0],
    [0.80, 0.12], // 下巴收拢时微向上翻眸锁定直视用户
    [3.60, 0.12],
    [4.60, 0.0],
    [duration, 0.0],
  ])

  // 怒气冲天时全程不眨眼，直到气消平复在 4.0s 自然眨眼
  const eyelids: Key[] = [
    [0.00, 0.98],
    [3.90, 0.98],
    [3.98, 0.05], // 气消眨眼
    [4.12, 0.98],
    [duration, 0.98],
  ]
  add('ParamEyeLOpen', eyelids)
  add('ParamEyeROpen', eyelids)

  return bakeDafishParameterMotion(parameters, tracks, duration)
}

export function createDafishBodyLedAngryPreset(): ModelStatePreset {
  return {
    id: DAFISH_BODY_LED_ANGRY_PRESET,
    label: '生气',
    group: '生气',
    emotion: 'angry',
    description: '',
    controls: [],
    parameters: {},
    motion: { group: DAFISH_BODY_LED_ANGRY_MOTION, index: 0 },
    steps: [
      {
        label: '前倾逼近',
        durationMs: 800,
        holdMs: 0,
        controls: [],
        parameters: {
          LeanInput: -30, AngleY: -8, ParamBrowLY: -0.8, ParamBrowRY: -0.8, ParamBrowLAngle: -0.7, ParamBrowRAngle: -0.7, ParamEyeLOpen: 1.2, ParamEyeROpen: 1.2, ParamMouthOpenY: 0.6,
        },
      },
      {
        label: '气愤喘息',
        durationMs: 2400,
        holdMs: 0,
        controls: [],
        parameters: {
          LeanInput: -24, PositionZ: -12, ParamBrowLY: -0.9, ParamBrowRY: -0.9, ParamMouthOpenY: 0.8,
        },
      },
      {
        label: '平复回位',
        durationMs: 2400,
        holdMs: 0,
        controls: [],
        parameters: {
          LeanInput: 0, PositionZ: 0, ParamBrowLY: 0, ParamBrowRY: 0, ParamMouthOpenY: 0,
        },
      },
    ],
    finishMode: 'revert',
    revertHoldMs: 0,
    source: 'builtin',
    custom: true,
  }
}

export function installDafishBodyLedAngryMotion(
  model: { internalModel?: any },
  parameters: DafishParameter[],
  physicsOutputIds: Iterable<string> = [],
): boolean {
  return registerDafishGeneratedMotion(
    model,
    DAFISH_BODY_LED_ANGRY_MOTION,
    buildDafishBodyLedAngryMotion(parameters, physicsOutputIds),
  )
}
