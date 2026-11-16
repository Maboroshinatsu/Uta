import type { ModelStatePreset } from './emotion-adapter'
import { authoredTrack, bakeDafishParameterMotion } from './dafish-authored-happy'
import { registerDafishGeneratedMotion, type DafishParameter } from './dafish-happy-performance'

export const DAFISH_BODY_LED_THINKING_MOTION = '思考·托腮沉思'
export const DAFISH_BODY_LED_THINKING_PRESET = 'dafish_body_led_thinking'
export const DAFISH_BODY_LED_THINKING_DURATION = 5.6

type Key = readonly [seconds: number, value: number]

/**
 * 思考·托腮沉思（5.6 秒）：
 * 1. 0.0s ~ 0.8s【佩戴单片镜·沉静思索】：单片眼镜佩戴亮相（key12: 1），身体微侧微扬（PositionZ: 10, PositionX: -6, AngleY: 5.5, AngleZ: -7），抿唇凝神；
 * 2. 0.8s ~ 3.2s【斜上方游移扫视·深沉呼吸】：眼神在斜上方缓慢来回游移寻找线索，胸膛伴随深沉起伏，沉浸在专注思考中；
 * 3. 3.2s ~ 4.2s【灵光一闪·自信微笑】：视线突然落回收回屏幕，下巴微点，嘴角勾起想通线索的自信微笑，伴随 140ms 干脆眨眼；
 * 4. 4.2s ~ 5.6s【平滑归零与无缝 C1 循环】。
 */
export function buildDafishBodyLedThinkingMotion(
  parameters: DafishParameter[],
  physicsOutputIds: Iterable<string> = [],
) {
  const byId = new Map(parameters.map(p => [p.id, p]))
  const physics = new Set(physicsOutputIds)
  const required = [
    'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput',
  ]
  if (!required.every(id => byId.has(id) && !physics.has(id))) return null

  const duration = DAFISH_BODY_LED_THINKING_DURATION
  const tracks = new Map<string, (t: number) => number>()

  const add = (id: string, keys: Key[]) => {
    if (!byId.has(id) || physics.has(id)) return
    tracks.set(id, authoredTrack(keys))
  }
  const body = (id: string, keys: Key[]) => add(id, [[0, 0], ...keys, [duration, 0]])

  // 1. 身体主控：侧身凝神与深沉呼吸起伏
  body('PositionZ', [
    [0.25, -1.0],
    [0.85, 10.0],
    [2.20, 11.5],
    [3.20, 8.0],
    [4.40, 0.0],
  ])
  body('PositionX', [
    [0.25, 1.0],
    [0.85, -6.0],
    [2.20, -7.0],
    [3.20, -4.0],
    [4.40, 0.0],
  ])
  body('PositionY', [
    [0.25, -0.5],
    [0.85, 2.5],
    [1.70, 0.5], // 深沉深呼吸
    [2.40, 2.8],
    [3.20, 1.2],
    [4.40, 0.0],
  ])
  body('LeanInput', [
    [0.85, -8.0], // 探身凝神
    [2.20, -10.0],
    [3.20, -5.0],
    [4.40, 0.0],
  ])

  // 头部角度：下巴微扬思索与偏头
  body('AngleY', [
    [0.85, 5.5],  // 扬起下巴思索
    [2.20, 6.2],
    [3.20, 1.0],  // 灵光一闪下巴微点
    [4.40, 0.0],
  ])
  body('AngleZ', [
    [0.85, -7.0], // 歪头思索
    [2.20, -8.0],
    [3.20, 2.0],  // 点头时微晃
    [4.40, 0.0],
  ])
  body('AngleX', [
    [0.85, -4.0],
    [2.20, 3.0],  // 左右打量线索
    [3.20, 0.0],
  ])

  // 双手自然下垂
  add('Movement1', [[0, 0], [duration, 0]])
  add('Movement2', [[0, 0], [duration, 0]])
  add('Movement3', [[0, 0], [duration, 0]])
  add('Param56', [[0, 1], [duration, 1]])
  add('Param57', [[0, 0], [duration, 0]])

  // 2. 单片眼镜配件：key12
  add('key12', [
    [0.00, 0],
    [0.50, 0],
    [0.85, 1],
    [3.60, 1],
    [4.20, 0],
    [duration, 0],
  ])

  // 3. 面部五官与眼神游移
  add('ParamBrowLY', [
    [0.00, 0.04],
    [0.85, 0.20],
    [3.20, 0.20],
    [3.60, 0.35], // 灵光一闪挑眉
    [4.40, 0.04],
    [duration, 0.04],
  ])
  add('ParamBrowRY', [
    [0.00, 0.04],
    [0.85, 0.20],
    [3.20, 0.20],
    [3.60, 0.35],
    [4.40, 0.04],
    [duration, 0.04],
  ])

  // 嘴角：沉思微抿，想通后自信浅笑
  add('ParamMouthForm', [
    [0.00, 0.28],
    [0.85, 0.15], // 抿嘴沉思
    [3.00, 0.15],
    [3.40, 0.65], // 自信浅笑
    [4.60, 0.28],
    [duration, 0.28],
  ])
  add('ParamMouthOpenY', [
    [0.00, 0.025],
    [3.40, 0.08],
    [4.00, 0.025],
    [duration, 0.025],
  ])

  // 斜上方眼神游移与收回直视
  add('ParamEyeBallX', [
    [0.00, 0.0],
    [0.85, -0.35], // 眼神往左上方看
    [1.60, 0.25],  // 游移到右上方
    [2.40, -0.20],
    [3.20, 0.0],   // 灵光一闪，收回直视用户！
    [duration, 0.0],
  ])
  add('ParamEyeBallY', [
    [0.00, 0.0],
    [0.85, 0.45],  // 往上看思索
    [1.60, 0.60],
    [2.40, 0.40],
    [3.20, 0.0],   // 收回平视
    [duration, 0.0],
  ])

  // 灵光一闪干脆生理眨眼（在 3.35s 处）
  const blink: Key[] = [
    [0.00, 0.98],
    [3.25, 0.98],
    [3.32, 0.05],
    [3.46, 0.98],
    [duration, 0.98],
  ]
  add('ParamEyeLOpen', blink)
  add('ParamEyeROpen', blink)

  return bakeDafishParameterMotion(parameters, tracks, duration)
}

export function createDafishBodyLedThinkingPreset(): ModelStatePreset {
  return {
    id: DAFISH_BODY_LED_THINKING_PRESET,
    label: '思考',
    group: '思考',
    emotion: 'thinking',
    description: '',
    controls: [],
    parameters: {},
    motion: { group: DAFISH_BODY_LED_THINKING_MOTION, index: 0 },
    steps: [
      {
        label: '凝神沉思',
        durationMs: 200,
        holdMs: 1150,
        controls: [],
        parameters: {
          PositionZ: 10, PositionX: -6, AngleZ: 14, AngleY: -8, ParamBrowLY: 0.5, ParamBrowRY: 0.5, ParamEyeLOpen: 0.85, ParamEyeROpen: 0.85,
        },
      },
      {
        label: '游移打量',
        durationMs: 1350,
        holdMs: 0,
        controls: [],
        parameters: {
          PositionZ: 8, AngleZ: 10, AngleY: 6, ParamEyeLOpen: 0.9, ParamEyeROpen: 0.9,
        },
      },
      {
        label: '灵光一闪',
        durationMs: 1350,
        holdMs: 0,
        controls: [],
        parameters: {
          PositionZ: 12, AngleZ: -4, AngleY: 0, ParamEyeLOpen: 1.15, ParamEyeROpen: 1.15, ParamMouthForm: 0.6,
        },
      },
      {
        label: '回位',
        durationMs: 1350,
        holdMs: 0,
        controls: [],
        parameters: {
          PositionZ: 0, PositionX: 0, AngleZ: 0, AngleY: 0, ParamBrowLY: 0, ParamBrowRY: 0, ParamEyeLOpen: 1.0, ParamEyeROpen: 1.0, ParamMouthForm: 0,
        },
      },
    ],
    finishMode: 'revert',
    revertHoldMs: 0,
    source: 'builtin',
    custom: true,
  }
}

export function installDafishBodyLedThinkingMotion(
  model: { internalModel?: any },
  parameters: DafishParameter[],
  physicsOutputIds: Iterable<string> = [],
): boolean {
  return registerDafishGeneratedMotion(
    model,
    DAFISH_BODY_LED_THINKING_MOTION,
    buildDafishBodyLedThinkingMotion(parameters, physicsOutputIds),
  )
}
