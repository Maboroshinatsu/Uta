import type { ModelStatePreset } from './emotion-adapter'
import { authoredTrack, bakeDafishParameterMotion } from './dafish-authored-happy'
import { registerDafishGeneratedMotion, type DafishParameter } from './dafish-happy-performance'

export const DAFISH_BODY_LED_SHY_MOTION = '害羞·羞赧偷看'
export const DAFISH_BODY_LED_SHY_PRESET = 'dafish_body_led_shy'
export const DAFISH_BODY_LED_SHY_DURATION = 5.6

type Key = readonly [seconds: number, value: number]

/**
 * 害羞·羞赧偷看（5.6 秒）：
 * 1. 0.0s ~ 0.8s【侧身掩面·满脸通红】：单手轻抚心口，身体向后微缩侧掩（PositionZ: 10, PositionX: -8），满脸通红（key7: 0.92），低头垂眸羞赧；
 * 2. 0.8s ~ 3.6s【羞涩垂眸与怯生生偷瞄】：先害羞下视，随后忍不住偷偷抬眼瞄向屏幕看用户，嘴角泛起娇羞甜笑；视线对上后慌乱眨眼（140ms 眨眼）；
 * 3. 3.6s ~ 4.6s【羞涩平复·收手归位】：脸红徐徐淡出，抚胸手顺势滑落身侧，Movement2 切回 0；
 * 4. 4.6s ~ 5.6s【平滑归零与无缝 C1 循环】。
 */
export function buildDafishBodyLedShyMotion(
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

  const duration = DAFISH_BODY_LED_SHY_DURATION
  const tracks = new Map<string, (t: number) => number>()

  const add = (id: string, keys: Key[]) => {
    if (!byId.has(id) || physics.has(id)) return
    tracks.set(id, authoredTrack(keys))
  }
  const body = (id: string, keys: Key[]) => add(id, [[0, 0], ...keys, [duration, 0]])

  // 1. 身体主控：向后微缩侧掩与轻柔呼吸
  body('PositionZ', [
    [0.25, -1.0],
    [0.85, 10.0],
    [2.40, 11.5],
    [3.60, 5.0],
    [4.60, 0.0],
  ])
  body('PositionX', [
    [0.25, 1.0],
    [0.85, -8.0],
    [2.40, -9.0],
    [3.60, -3.5],
    [4.60, 0.0],
  ])
  body('PositionY', [
    [0.25, -0.5],
    [0.85, 1.8],
    [1.80, 0.8],
    [2.40, 2.2], // 偷看时呼吸微促
    [3.20, 1.0],
    [4.00, 0.5],
    [4.60, 0.0],
  ])
  body('LeanInput', [
    [0.85, 6.0], // 羞涩微缩
    [2.40, 5.0],
    [4.00, 0.0],
  ])

  // 头部低垂微侧
  body('AngleY', [
    [0.85, -5.0], // 垂首含羞
    [2.00, -5.0],
    [2.40, -2.0], // 偷瞄时微微扬起
    [3.00, -5.0],
    [4.20, 0.0],
  ])
  body('AngleZ', [
    [0.85, 7.5],  // 侧首含羞
    [2.40, 8.5],
    [3.60, 2.5],
    [4.60, 0.0],
  ])
  body('AngleX', [
    [0.85, -3.0],
    [2.40, -4.0],
    [4.00, 0.0],
  ])

  // 2. 抚胸手（轻柔掩身）
  add('Movement2', [
    [0.00, 0],
    [0.20, 0],
    [0.25, 1],
    [3.90, 1],
    [4.25, 0],
    [duration, 0],
  ])
  const handLift = authoredTrack([
    [0.00, 0],
    [0.25, 0],
    [0.85, 1],
    [3.60, 1],
    [4.20, 0],
    [duration, 0],
  ])
  tracks.set('Param62', t => 0.017 * handLift(t))
  tracks.set('Param59', t => 0.119 * handLift(t) ** 2)
  tracks.set('Param60', t => -(1 - (1 - 0.5 * handLift(t)) ** 1.7))
  body('Param61', [[3.60, 0.0]])

  add('Movement1', [[0, 0], [duration, 0]])
  add('Movement3', [[0, 0], [duration, 0]])
  add('Param56', [[0, 1], [duration, 1]])
  add('Param57', [[0, 0], [duration, 0]])

  // 3. 满脸通红：key7 (脸红)
  add('key7', [
    [0.00, 0],
    [0.50, 0],
    [0.85, 0.92],
    [3.60, 0.92],
    [4.40, 0.0],
    [duration, 0],
  ])

  // 4. 面部神态与偷看视线
  add('ParamBrowLY', [
    [0.00, 0.04],
    [0.85, -0.15],
    [3.60, -0.15],
    [4.40, 0.04],
    [duration, 0.04],
  ])
  add('ParamBrowRY', [
    [0.00, 0.04],
    [0.85, -0.15],
    [3.60, -0.15],
    [4.40, 0.04],
    [duration, 0.04],
  ])

  // 娇羞甜笑（偷瞄时绽放微笑）
  add('ParamMouthForm', [
    [0.00, 0.28],
    [0.85, 0.40],
    [2.30, 0.68], // 偷看时露出甜笑
    [3.60, 0.50],
    [4.60, 0.28],
    [duration, 0.28],
  ])
  add('ParamMouthOpenY', [
    [0.00, 0.025],
    [2.30, 0.10], // 偷看轻吸气
    [2.90, 0.03],
    [duration, 0.025],
  ])
  add('EyeSmile', [
    [0.00, 0.0],
    [0.85, 0.25],
    [2.30, 0.75], // 偷看笑眼
    [3.60, 0.25],
    [4.40, 0.0],
    [duration, 0.0],
  ])

  // 视线偷看：先向下垂眸（-0.35），然后在 1.8s~2.6s 偷偷往上看屏幕（+0.25）！
  add('ParamEyeBallY', [
    [0.00, 0.0],
    [0.85, -0.35], // 羞涩垂眸
    [1.80, -0.35],
    [2.30, 0.25],  // 怯生生偷瞄！
    [2.80, 0.25],
    [3.10, -0.25], // 撞上视线慌忙收回
    [4.40, 0.0],
    [duration, 0.0],
  ])
  add('ParamEyeBallX', [
    [0.00, 0.0],
    [2.30, 0.10],
    [3.10, 0.0],
    [duration, 0.0],
  ])

  // 慌乱眨眼（偷瞄被发现）：在 2.95s 处干脆眨眼
  const eyelids: Key[] = [
    [0.00, 0.98],
    [0.85, 0.85],
    [2.85, 0.85],
    [2.92, 0.05], // 慌乱眨眼
    [3.05, 0.85],
    [4.40, 0.98],
    [duration, 0.98],
  ]
  add('ParamEyeLOpen', eyelids)
  add('ParamEyeROpen', eyelids)

  return bakeDafishParameterMotion(parameters, tracks, duration)
}

export function createDafishBodyLedShyPreset(): ModelStatePreset {
  return {
    id: DAFISH_BODY_LED_SHY_PRESET,
    label: '害羞',
    group: '害羞',
    emotion: 'shy',
    description: '',
    controls: [],
    parameters: {},
    motion: { group: DAFISH_BODY_LED_SHY_MOTION, index: 0 },
    steps: [
      {
        label: '侧身掩面',
        durationMs: 200,
        holdMs: 1150,
        controls: [],
        parameters: {
          PositionX: 6, PositionZ: 8, AngleZ: -12, AngleY: -10, ParamEyeLOpen: 0.7, ParamEyeROpen: 0.7,
        },
      },
      {
        label: '垂眸偷看',
        durationMs: 1350,
        holdMs: 0,
        controls: [],
        parameters: {
          PositionX: 5, AngleZ: -10, ParamMouthForm: 0.3,
        },
      },
      {
        label: '慌乱眨眼',
        durationMs: 1350,
        holdMs: 0,
        controls: [],
        parameters: {
          PositionX: 2, AngleZ: -4,
        },
      },
      {
        label: '回位',
        durationMs: 1350,
        holdMs: 0,
        controls: [],
        parameters: {
          PositionX: 0, PositionZ: 0, AngleZ: 0, AngleY: 0, ParamEyeLOpen: 1.0, ParamEyeROpen: 1.0,
        },
      },
    ],
    finishMode: 'revert',
    revertHoldMs: 0,
    source: 'builtin',
    custom: true,
  }
}

export function installDafishBodyLedShyMotion(
  model: { internalModel?: any },
  parameters: DafishParameter[],
  physicsOutputIds: Iterable<string> = [],
): boolean {
  return registerDafishGeneratedMotion(
    model,
    DAFISH_BODY_LED_SHY_MOTION,
    buildDafishBodyLedShyMotion(parameters, physicsOutputIds),
  )
}
