import type { ModelStatePreset } from './emotion-adapter'
import { authoredTrack, bakeDafishParameterMotion } from './dafish-authored-happy'
import { registerDafishGeneratedMotion, type DafishParameter } from './dafish-happy-performance'

export const DAFISH_BODY_LED_NEUTRAL_MOTION = '待机·大肥鱼灵动呼吸'
export const DAFISH_BODY_LED_NEUTRAL_PRESET = 'neutral'
export const DAFISH_BODY_LED_NEUTRAL_DURATION = 6.0

type Key = readonly [seconds: number, value: number]

/**
 * 待机·大肥鱼灵动呼吸（6.0 秒）：
 * 1. 舒缓有律的待机深呼吸沉浮（PositionY: 1.4 <-> -1.2）；
 * 2. 真实人类站姿般的微小重心左右换力（PositionX: 1.2 <-> -1.4, PositionZ: -2.0 <-> 2.2）；
 * 3. 头部轻柔随动与恬静浅笑（ParamMouthForm: 0.35）；
 * 4. 在 1.8s 与 4.5s 分别插入干脆自然的 140ms 生理眨眼，陪伴舒适惬意。
 */
export function buildDafishBodyLedNeutralMotion(
  parameters: DafishParameter[],
  physicsOutputIds: Iterable<string> = [],
) {
  const byId = new Map(parameters.map(p => [p.id, p]))
  const physics = new Set(physicsOutputIds)
  const required = [
    'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ',
  ]
  if (!required.every(id => byId.has(id) && !physics.has(id))) return null

  const duration = DAFISH_BODY_LED_NEUTRAL_DURATION
  const tracks = new Map<string, (t: number) => number>()

  const add = (id: string, keys: Key[]) => {
    if (!byId.has(id) || physics.has(id)) return
    tracks.set(id, authoredTrack(keys))
  }
  const body = (id: string, keys: Key[]) => add(id, [[0, 0], ...keys, [duration, 0]])

  // 1. 身体舒缓深呼吸起伏（两组深呼吸）
  body('PositionY', [
    [1.50, 1.4],
    [3.00, -1.2],
    [4.50, 1.5],
  ])
  // 微小重心左右漂移
  body('PositionX', [
    [1.40, 1.2],
    [3.00, -1.4],
    [4.60, 0.8],
  ])
  body('PositionZ', [
    [1.50, -2.0],
    [3.20, 2.2],
    [4.80, -1.0],
  ])

  // 头部轻柔微晃
  body('AngleZ', [
    [1.60, 1.8],
    [3.20, -1.5],
    [4.70, 1.2],
  ])
  body('AngleY', [
    [1.50, 1.5],
    [3.00, -1.0],
    [4.50, 1.2],
  ])
  body('AngleX', [
    [1.80, -1.2],
    [3.40, 1.5],
    [4.80, -0.6],
  ])

  // 双手自然垂落
  add('Movement1', [[0, 0], [duration, 0]])
  add('Movement2', [[0, 0], [duration, 0]])
  add('Movement3', [[0, 0], [duration, 0]])
  add('Param56', [[0, 1], [duration, 1]])
  add('Param57', [[0, 0], [duration, 0]])

  // 恬静浅笑与常态五官
  add('ParamMouthForm', [[0, 0.35], [duration, 0.35]])
  add('ParamMouthOpenY', [[0, 0.025], [duration, 0.025]])
  add('ParamBrowLY', [[0, 0.04], [duration, 0.04]])
  add('ParamBrowRY', [[0, 0.04], [duration, 0.04]])
  add('ParamEyeBallX', [[0, 0], [duration, 0]])
  add('ParamEyeBallY', [[0, 0], [duration, 0]])

  // 规律自然的 140ms 生理眨眼（1.8s 与 4.5s 各一次）
  const eyelids: Key[] = [
    [0.00, 0.98],
    [1.75, 0.98],
    [1.82, 0.05],
    [1.96, 0.98],
    [4.45, 0.98],
    [4.52, 0.05],
    [4.66, 0.98],
    [duration, 0.98],
  ]
  add('ParamEyeLOpen', eyelids)
  add('ParamEyeROpen', eyelids)

  return bakeDafishParameterMotion(parameters, tracks, duration)
}

export function createDafishBodyLedNeutralPreset(): ModelStatePreset {
  return {
    id: DAFISH_BODY_LED_NEUTRAL_PRESET,
    label: '日常待机',
    group: '日常',
    emotion: 'neutral',
    description: '',
    controls: [],
    parameters: {},
    motion: { group: DAFISH_BODY_LED_NEUTRAL_MOTION, index: 0 },
    steps: [
      {
        label: '恬静呼吸',
        durationMs: 2000,
        holdMs: 0,
        controls: [],
        parameters: {
          PositionY: 1.4,
          PositionX: 1.2,
          PositionZ: -2.0,
          AngleZ: 1.8,
          AngleY: 1.5,
          AngleX: -1.2,
          ParamMouthForm: 0.35,
          ParamEyeLOpen: 0.98,
          ParamEyeROpen: 0.98,
        },
      },
      {
        label: '舒缓起伏',
        durationMs: 2000,
        holdMs: 0,
        controls: [],
        parameters: {
          PositionY: -1.2,
          PositionX: -1.4,
          PositionZ: 2.2,
          AngleZ: -1.5,
          AngleY: -1.0,
          AngleX: 1.5,
          ParamMouthForm: 0.35,
          ParamEyeLOpen: 0.98,
          ParamEyeROpen: 0.98,
        },
      },
      {
        label: '轻柔回正',
        durationMs: 2000,
        holdMs: 0,
        controls: [],
        parameters: {
          PositionY: 0,
          PositionX: 0,
          PositionZ: 0,
          AngleZ: 0,
          AngleY: 0,
          AngleX: 0,
          ParamMouthForm: 0.35,
          ParamEyeLOpen: 0.98,
          ParamEyeROpen: 0.98,
        },
      },
    ],
    finishMode: 'revert',
    revertHoldMs: 0,
    source: 'builtin',
    custom: true,
  }
}

export function installDafishBodyLedNeutralMotion(
  model: { internalModel?: any },
  parameters: DafishParameter[],
  physicsOutputIds: Iterable<string> = [],
): boolean {
  return registerDafishGeneratedMotion(
    model,
    DAFISH_BODY_LED_NEUTRAL_MOTION,
    buildDafishBodyLedNeutralMotion(parameters, physicsOutputIds),
  )
}
