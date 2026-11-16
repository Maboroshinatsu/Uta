import type { ModelStatePreset } from './emotion-adapter'
import { authoredTrack, bakeDafishParameterMotion } from './dafish-authored-happy'
import { registerDafishGeneratedMotion, type DafishParameter } from './dafish-happy-performance'

export const DAFISH_WELL_ACTUALLY_MOTION = '趣味·Well actually'
export const DAFISH_WELL_ACTUALLY_PRESET = 'well_actually'
export const DAFISH_WELL_ACTUALLY_DURATION = 5.6

type Key = readonly [seconds: number, value: number]

/**
 * 经典 Nerd 说教梗（🤓☝️ Erm, actually... / Well, actually...）：
 * 1. 0.0s ~ 0.8s【起手与摆架子】：身体大幅度向一侧挺拔支棱（PositionZ: 14, PositionX: -9），
 *    右臂顺着内侧腰身快速抬至脸侧，在 0.2s 切换 Movement3=1，食指挺立（☝️）；
 * 2. 0.8s ~ 3.5s【🤓☝️ 经典名场面爆发】：
 *    - 黑框眼镜（key11: 1）与大牙（key9: 1）瞬间亮相！
 *    - 挑起八字眉，眼神认真直视用户；
 *    - 身体探身前倾（LeanInput: -20），手指在空中随说教节奏卡点轻点两次（打节拍），
 *      嘴巴露出大门牙配合两次说教开合；
 * 3. 3.5s ~ 4.6s【说教完毕·得意收手】：
 *    - 食指缓缓放下，右臂顺自然弧线滑落身侧，Movement3 切回 0；
 *    - 黑框眼镜与大门牙淡出，嘴角露出一抹纠错得逞的浅笑，伴随干脆的生理眨眼；
 * 4. 4.6s ~ 5.6s【平滑归零与无缝 C1 循环】。
 */
export function buildDafishWellActuallyMotion(
  parameters: DafishParameter[],
  physicsOutputIds: Iterable<string> = [],
) {
  const byId = new Map(parameters.map(p => [p.id, p]))
  const physics = new Set(physicsOutputIds)
  const required = [
    'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ',
    'Movement3', 'Param39', 'Param40', 'Param41', 'Param42', 'Param43',
  ]
  if (!required.every(id => byId.has(id) && !physics.has(id))) return null

  const duration = DAFISH_WELL_ACTUALLY_DURATION
  const tracks = new Map<string, (t: number) => number>()

  const add = (id: string, keys: Key[]) => {
    if (!byId.has(id) || physics.has(id)) return
    tracks.set(id, authoredTrack(keys))
  }
  const body = (id: string, keys: Key[]) => add(id, [[0, 0], ...keys, [duration, 0]])

  // 1. 身体主控：大幅度身体侧转与端架子（身体主导）
  body('PositionZ', [
    [0.25, -3.0],
    [0.80, 14.0],
    [1.60, 16.0],
    [2.50, 14.0],
    [3.50, 9.0],
    [4.40, 0.0],
  ])
  body('PositionX', [
    [0.25, 2.0],
    [0.80, -9.0],
    [1.60, -10.5],
    [2.50, -9.0],
    [3.50, -4.0],
    [4.40, 0.0],
  ])
  body('PositionY', [
    [0.25, -1.5],
    [0.80, 4.2],
    [1.40, 2.6],
    [1.80, 4.5],
    [2.40, 2.8],
    [2.90, 4.2],
    [3.60, 1.8],
    [4.40, 0.0],
  ])
  body('LeanInput', [
    [0.25, 2.0],
    [0.80, -18.0],
    [1.60, -22.0],
    [2.50, -19.0],
    [3.50, -10.0],
    [4.40, 0.0],
  ])

  // 头部小幅跟从：傲娇仰下巴与偏头
  body('AngleY', [
    [0.25, -1.5],
    [0.80, 4.8],
    [1.50, 3.2],
    [2.50, 5.0],
    [3.50, 1.6],
    [4.30, 0.0],
  ])
  body('AngleZ', [
    [0.80, 4.0],
    [1.60, 6.2],
    [2.50, 4.2],
    [3.50, 1.0],
    [4.30, 0.0],
  ])
  body('AngleX', [
    [0.80, -3.2],
    [1.60, -4.5],
    [2.50, -2.5],
    [3.50, 0.0],
  ])

  // 2. 右臂手势（Movement3 + 竖食指控制链）
  // 抬手升到脸侧：0.2s 换手型，0.8s 食指就位
  add('Movement3', [
    [0.00, 0],
    [0.18, 0],
    [0.22, 1],
    [3.85, 1],
    [4.15, 0],
    [duration, 0],
  ])
  add('Param40', [
    [0.00, 0],
    [0.22, 0],
    [0.78, 1.0],
    [3.50, 1.0],
    [3.90, 0.4],
    [4.25, 0.0],
    [duration, 0],
  ])
  add('Param39', [
    [0.00, 0],
    [0.22, 0],
    [0.78, 0.322],
    [3.50, 0.322],
    [3.95, 0.12],
    [4.30, 0.0],
    [duration, 0],
  ])
  // 小臂角度与手腕打节拍（两次有节奏的说教点动）
  add('Param41', [
    [0.00, 0],
    [0.22, 0],
    [0.78, 0.702],
    [1.35, 0.702],
    [1.55, 0.770],
    [1.75, 0.675],
    [1.95, 0.702],
    [2.35, 0.702],
    [2.55, 0.785],
    [2.75, 0.665],
    [2.95, 0.702],
    [3.50, 0.702],
    [3.95, 0.35],
    [4.35, 0.0],
    [duration, 0],
  ])
  body('Param42', [
    [1.35, 0.0],
    [1.55, -0.12],
    [1.75, 0.08],
    [1.95, 0.0],
    [2.35, 0.0],
    [2.55, -0.14],
    [2.75, 0.09],
    [2.95, 0.0],
  ])
  add('Param36', [[0, 0], [duration, 0]])
  add('Param43', [[0, 0], [duration, 0]])

  // 确保排他手型置零，避免重叠
  add('Movement1', [[0, 0], [duration, 0]])
  add('Movement2', [[0, 0], [duration, 0]])
  add('Param56', [[0, 1], [duration, 1]])
  add('Param57', [[0, 0], [duration, 0]])

  // 3. Nerd 梗图核心配件（黑框眼镜 key11 + 大牙 key9）
  add('key11', [
    [0.00, 0],
    [0.55, 0],
    [0.78, 1],
    [3.55, 1],
    [3.90, 0],
    [duration, 0],
  ])
  add('key9', [
    [0.00, 0],
    [0.60, 0],
    [0.80, 1],
    [3.55, 1],
    [3.90, 0],
    [duration, 0],
  ])

  // 4. 面部神态与说教开合
  // 挑眉八字眉（Nerd 经典严肃说教表情）
  add('ParamBrowLY', [
    [0.00, 0.04],
    [0.75, 0.35],
    [3.55, 0.35],
    [4.30, 0.04],
    [duration, 0.04],
  ])
  add('ParamBrowRY', [
    [0.00, 0.04],
    [0.75, 0.35],
    [3.55, 0.35],
    [4.30, 0.04],
    [duration, 0.04],
  ])
  add('ParamBrowLAngle', [
    [0.00, 0],
    [0.75, 0.22],
    [3.55, 0.22],
    [4.30, 0],
    [duration, 0],
  ])
  add('ParamBrowRAngle', [
    [0.00, 0],
    [0.75, 0.22],
    [3.55, 0.22],
    [4.30, 0],
    [duration, 0],
  ])

  // 嘴巴配合大门牙说教开合（"Well, actually... according to..."）
  add('ParamMouthOpenY', [
    [0.00, 0.025],
    [0.75, 0.06],
    [1.40, 0.28],
    [1.75, 0.06],
    [2.40, 0.32],
    [2.85, 0.08],
    [3.55, 0.03],
    [duration, 0.025],
  ])
  add('ParamMouthForm', [
    [0.00, 0.28],
    [0.80, 0.15],
    [3.50, 0.15],
    [4.10, 0.52],
    [4.90, 0.28],
    [duration, 0.28],
  ])

  // 视线：直视用户；在收手时插入一次干脆的 140ms 生理眨眼
  add('ParamEyeBallX', [[0, 0], [duration, 0]])
  add('ParamEyeBallY', [[0, 0], [duration, 0]])
  const blink: Key[] = [
    [0.00, 0.98],
    [3.95, 0.98],
    [4.02, 0.05],
    [4.16, 0.98],
    [duration, 0.98],
  ]
  add('ParamEyeLOpen', blink)
  add('ParamEyeROpen', blink)

  return bakeDafishParameterMotion(parameters, tracks, duration)
}

export function createDafishWellActuallyPreset(): ModelStatePreset {
  return {
    id: DAFISH_WELL_ACTUALLY_PRESET,
    label: 'well actually......',
    group: '趣味表演',
    emotion: 'thinking',
    description: '',
    controls: [],
    parameters: {},
    motion: { group: DAFISH_WELL_ACTUALLY_MOTION, index: 0 },
    steps: [
      {
        label: '端起架子',
        durationMs: 200,
        holdMs: 1200,
        controls: ['竖食指', '黑框眼镜', '大牙'],
        parameters: {
          Movement3: 1, Param40: 1, Param42: 1, PositionZ: 14, PositionX: -9, AngleY: 10, AngleZ: -8, ParamBrowLY: 0.6, ParamBrowRY: 0.6,
        },
      },
      {
        label: '认真说教',
        durationMs: 1400,
        holdMs: 0,
        controls: ['竖食指', '黑框眼镜', '大牙'],
        parameters: {
          Movement3: 1, Param40: 1, Param42: 1, LeanInput: -20, PositionZ: 16, PositionX: -10.5, AngleY: 12, ParamMouthOpenY: 0.8, ParamEyeLOpen: 1.1, ParamEyeROpen: 1.1,
        },
      },
      {
        label: '得意收手',
        durationMs: 1400,
        holdMs: 0,
        controls: [],
        parameters: {
          Movement3: 0, Param40: 0, Param42: 0, PositionZ: 9, PositionX: -4, AngleZ: 5, ParamMouthForm: 1.0,
        },
      },
      {
        label: '停歇',
        durationMs: 1400,
        holdMs: 0,
        controls: [],
        parameters: {
          PositionZ: 0, PositionX: 0, LeanInput: 0, AngleY: 0, AngleZ: 0, ParamMouthForm: 0,
        },
      },
    ],
    finishMode: 'revert',
    revertHoldMs: 0,
    source: 'builtin',
    custom: true,
  }
}

export function installDafishWellActuallyMotion(
  model: { internalModel?: any },
  parameters: DafishParameter[],
  physicsOutputIds: Iterable<string> = [],
): boolean {
  return registerDafishGeneratedMotion(
    model,
    DAFISH_WELL_ACTUALLY_MOTION,
    buildDafishWellActuallyMotion(parameters, physicsOutputIds),
  )
}
