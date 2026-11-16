import type { ModelStatePreset } from './emotion-adapter'
import { authoredTrack, bakeDafishParameterMotion } from './dafish-authored-happy'
import { registerDafishGeneratedMotion, type DafishParameter } from './dafish-happy-performance'

export const DAFISH_BODY_LED_SURPRISED_MOTION = '惊讶·战术后仰'
export const DAFISH_BODY_LED_SURPRISED_PRESET = 'dafish_body_led_surprised'
export const DAFISH_BODY_LED_SURPRISED_DURATION = 5.4

type Key = readonly [seconds: number, value: number]

/**
 * 惊讶·战术后仰（5.4 秒）：
 * 1. 0.0s ~ 0.6s【受惊猛烈战术后仰】：身体瞬间大幅向后撤步后仰（LeanInput: +25, PositionZ: 16, PositionY: 4.8, PositionX: -6），
 *    发丝与裙摆在惯性驱动下剧烈前冲；双目圆睁，嘴巴瞬间大张受惊（MouthOpen: 0.70, MouthForm: -0.55 受惊圆嘴）；
 * 2. 0.6s ~ 2.6s【惊魂未定·胸脯急喘】：在后仰位伴随两次惊魂未定的急促呼吸起伏（PositionY: 4.8 -> 3.2 -> 4.5 -> 3.0），
 *    嘴巴随喘息微开合；
 * 3. 2.6s ~ 4.2s【缓过神来·长吁一口气】：身体重心平缓前移归正，后仰平复，大嘴合拢吐气并完成生理眨眼；
 * 4. 4.2s ~ 5.4s【平滑归零与无缝 C1 循环】。
 */
export function buildDafishBodyLedSurprisedMotion(
  parameters: DafishParameter[],
  physicsOutputIds: Iterable<string> = [],
) {
  const byId = new Map(parameters.map(p => [p.id, p]))
  const physics = new Set(physicsOutputIds)
  const required = [
    'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput',
  ]
  if (!required.every(id => byId.has(id) && !physics.has(id))) return null

  const duration = DAFISH_BODY_LED_SURPRISED_DURATION
  const tracks = new Map<string, (t: number) => number>()

  const add = (id: string, keys: Key[]) => {
    if (!byId.has(id) || physics.has(id)) return
    tracks.set(id, authoredTrack(keys))
  }
  const body = (id: string, keys: Key[]) => add(id, [[0, 0], ...keys, [duration, 0]])

  // 1. 身体主控：瞬间战术后仰与后撤避让（身体主导）
  body('LeanInput', [
    [0.18, -2.0], // 微弱反向预备
    [0.60, 25.0], // 战术后仰峰值
    [1.30, 21.0],
    [2.00, 24.0],
    [2.80, 15.0],
    [3.80, 0.0],
  ])
  body('PositionZ', [
    [0.18, -2.0],
    [0.60, 16.0],
    [1.30, 13.0],
    [2.00, 15.0],
    [2.80, 8.0],
    [3.80, 0.0],
  ])
  body('PositionX', [
    [0.18, 1.0],
    [0.60, -7.0],
    [1.30, -5.5],
    [2.00, -6.8],
    [2.80, -3.0],
    [3.80, 0.0],
  ])
  body('PositionY', [
    [0.18, -1.0],
    [0.60, 4.8],  // 猛然上提拔高
    [1.20, 2.8],  // 受惊急喘 1
    [1.65, 4.5],
    [2.15, 3.0],  // 受惊急喘 2
    [2.65, 4.2],
    [3.40, 1.5],
    [4.00, 0.0],
  ])

  // 头部动作：惊慌后退仰角
  body('AngleY', [
    [0.18, 1.0],
    [0.60, -8.0], // 惊骇收下巴/后缩
    [1.30, -5.0],
    [2.00, -7.5],
    [2.80, -2.0],
    [3.80, 0.0],
  ])
  body('AngleZ', [
    [0.60, -4.5],
    [1.40, -2.5],
    [2.20, -4.0],
    [3.60, 0.0],
  ])
  body('AngleX', [
    [0.60, 2.5],
    [1.40, -1.5],
    [2.20, 2.0],
    [3.60, 0.0],
  ])

  // 2. 双手自然避让垂落（零道具）
  add('Movement1', [[0, 0], [duration, 0]])
  add('Movement2', [[0, 0], [duration, 0]])
  add('Movement3', [[0, 0], [duration, 0]])
  add('Param56', [[0, 1], [duration, 1]])
  add('Param57', [[0, 0], [duration, 0]])

  // 3. 惊讶面部五官：受惊大张口与惊慌挑眉
  add('ParamMouthOpenY', [
    [0.00, 0.025],
    [0.55, 0.70], // 瞬间大张受惊
    [1.20, 0.40], // 喘息收缩
    [1.65, 0.65],
    [2.15, 0.35],
    [2.65, 0.55],
    [3.40, 0.15],
    [4.00, 0.025],
    [duration, 0.025],
  ])
  add('ParamMouthForm', [
    [0.00, 0.28],
    [0.55, -0.55], // 纯正受惊 O 嘴
    [2.80, -0.50],
    [3.60, 0.35],  // 平复后舒缓微合
    [4.40, 0.28],
    [duration, 0.28],
  ])

  // 挑眉惊慌
  add('ParamBrowLY', [
    [0.00, 0.04],
    [0.55, 0.45],
    [2.80, 0.45],
    [3.80, 0.04],
    [duration, 0.04],
  ])
  add('ParamBrowRY', [
    [0.00, 0.04],
    [0.55, 0.45],
    [2.80, 0.45],
    [3.80, 0.04],
    [duration, 0.04],
  ])
  add('ParamBrowLAngle', [
    [0.00, 0],
    [0.55, 0.35],
    [2.80, 0.35],
    [3.80, 0],
    [duration, 0],
  ])
  add('ParamBrowRAngle', [
    [0.00, 0],
    [0.55, 0.35],
    [2.80, 0.35],
    [3.80, 0],
    [duration, 0],
  ])

  // 眼睛与视线：双目圆睁，平复时长舒一口气并眨眼
  const blink: Key[] = [
    [0.00, 0.98],
    [3.50, 0.98],
    [3.58, 0.05],
    [3.72, 0.98],
    [duration, 0.98],
  ]
  add('ParamEyeLOpen', blink)
  add('ParamEyeROpen', blink)
  add('ParamEyeBallX', [[0, 0], [duration, 0]])
  add('ParamEyeBallY', [[0, 0], [duration, 0]])

  return bakeDafishParameterMotion(parameters, tracks, duration)
}

export function createDafishBodyLedSurprisedPreset(): ModelStatePreset {
  return {
    id: DAFISH_BODY_LED_SURPRISED_PRESET,
    label: '惊讶',
    group: '惊讶',
    emotion: 'surprise',
    description: '',
    controls: [],
    parameters: {},
    motion: { group: DAFISH_BODY_LED_SURPRISED_MOTION, index: 0 },
    steps: [
      {
        label: '战术后仰',
        durationMs: 200,
        holdMs: 1100,
        controls: [],
        parameters: {
          LeanInput: 28, PositionZ: 14, PositionY: -6, ParamEyeLOpen: 1.5, ParamEyeROpen: 1.5, ParamMouthOpenY: 0.9,
        },
      },
      {
        label: '受惊急喘',
        durationMs: 1300,
        holdMs: 0,
        controls: [],
        parameters: {
          LeanInput: 22, PositionZ: 10, ParamEyeLOpen: 1.3, ParamEyeROpen: 1.3, ParamMouthOpenY: 0.7,
        },
      },
      {
        label: '平复呼气',
        durationMs: 1300,
        holdMs: 0,
        controls: [],
        parameters: {
          LeanInput: 10, PositionZ: 4, ParamEyeLOpen: 1.1, ParamEyeROpen: 1.1, ParamMouthOpenY: 0.3,
        },
      },
      {
        label: '回位',
        durationMs: 1300,
        holdMs: 0,
        controls: [],
        parameters: {
          LeanInput: 0, PositionZ: 0, PositionY: 0, ParamEyeLOpen: 1.0, ParamEyeROpen: 1.0, ParamMouthOpenY: 0,
        },
      },
    ],
    finishMode: 'revert',
    revertHoldMs: 0,
    source: 'builtin',
    custom: true,
  }
}

export function installDafishBodyLedSurprisedMotion(
  model: { internalModel?: any },
  parameters: DafishParameter[],
  physicsOutputIds: Iterable<string> = [],
): boolean {
  return registerDafishGeneratedMotion(
    model,
    DAFISH_BODY_LED_SURPRISED_MOTION,
    buildDafishBodyLedSurprisedMotion(parameters, physicsOutputIds),
  )
}
