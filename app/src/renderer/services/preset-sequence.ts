/**
 * 预设序列的纯调度规则：只回答「这一步过渡多久、下一步何时触发、演完怎么收尾」，
 * 不碰 Vue / Live2D / 定时器，方便单测，也让舞台与控制器共用同一套时长常量。
 */
import type { ModelStatePreset, PresetFinishMode, PresetKeyframeStep } from './live2d/emotion-adapter'

export const PRESET_TRANSITION_MS = 600

/**
 * 「有一次非常驻的预设正在播放」的唯一判定：活动 id 既不是待机也不是常驻预设。
 * 空闲调度、悬停反应、控件与滑块路径都依赖它，因此终止序列时必须把活动 id 写回终值，
 * 否则这里会永久为真，桌宠再也不会有任何待机微动作。
 */
export function isPresetSequenceActive(
  runningId: string | null | undefined,
  holdId: string | null | undefined,
): boolean {
  if (!runningId || runningId === 'neutral') return false
  return runningId !== (holdId || '')
}

/**
 * 「常驻基准」的有效值：用户没手动钉选时，日常待机就是默认基准。
 * 只用于展示与回退目标；空闲随机反应、性能层闸门仍看用户是否真的钉过（原始 id）。
 */
export function resolveHoldPresetId(activeHoldPresetId: string | null | undefined): string {
  return activeHoldPresetId || 'neutral'
}
export const REVERT_TRANSITION_MS = 320
export const CONTROL_TRANSITION_MS = 300
/**
 * 播完后回到鼠标跟随的时长。320ms 是从「完全锁住」直接弹回满幅跟随，
 * 用户反馈为「静止一下再猛地切过去」；拉长到 600ms 让交接可感知但不突兀。
 */
export const RETURN_GAZE_MS = 600
/** finishMode='revert' 时终态保持时长缺省值 */
export const PRESET_REVERT_HOLD_MS = 1600

export interface PresetStepTiming {
  /** 参数/控件过渡时长 */
  transitionMs: number
  /** 过渡完成后保持多久再进入下一步 */
  holdMs: number
  /** 从本步开始到下一步（或收尾）触发的总延迟 */
  delayMs: number
}

/**
 * 单步时间线。步骤可能来自运行期手工拼装的对象，duration/hold 缺失时按原逻辑兜底：
 * 过渡 600ms、保持 0ms。
 */
export function resolvePresetStepTiming(
  step: Pick<PresetKeyframeStep, 'durationMs' | 'holdMs'> | undefined,
  fallbackTransitionMs = PRESET_TRANSITION_MS,
): PresetStepTiming {
  const transitionMs = step?.durationMs ?? fallbackTransitionMs
  const holdMs = step?.holdMs ?? 0
  return { transitionMs, holdMs, delayMs: transitionMs + holdMs }
}

export type PresetFinishAction = 'loop' | 'revert' | 'settle'

/**
 * 序列播完最后一步后的去向：
 * - loop 只在多步序列下有效，单步循环没有意义，退回 settle；
 * - 工坊编辑锁定时绝不自动回退，保持编辑中的画面；
 * - 其余情况（含 hold）只做视线/控件恢复，不改变预设状态。
 */
export function resolvePresetFinishAction(
  finishMode: PresetFinishMode,
  stepCount: number,
  editingLocked: boolean,
): PresetFinishAction {
  if (finishMode === 'loop' && stepCount > 1) return 'loop'
  if (finishMode === 'revert' && !editingLocked) return 'revert'
  return 'settle'
}

export function resolvePresetRevertDelayMs(
  preset: Pick<ModelStatePreset, 'revertHoldMs'>,
): number {
  return preset.revertHoldMs ?? PRESET_REVERT_HOLD_MS
}


