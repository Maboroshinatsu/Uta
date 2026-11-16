import { useDeskpetStore } from '@/stores/deskpet'
import {
  applyParameters,
  clearExpression,
  hasPresetMotionOwnership,
  resetTransientParameters,
  setFocusWeight,
} from '@/services/live2d/loader'
import type { PresetFinishMode } from '@/services/live2d/emotion-adapter'
import { RETURN_GAZE_MS } from '@/services/preset-sequence'
import { canRunIdleActions } from '@/services/idle-gate'
import { MotionLayer } from './useMotionPriority'
import { getDafishHappyOwnedParameters } from '@/services/live2d/dafish-happy-performance'

/** 空闲自言自语池：与舞台拆分前保持一致，随机时机由 idleScheduler 决定。 */
export const IDLE_PHRASES = [
  '要不要休息一下？',
  '我在这儿呢。',
  '需要我帮忙吗？',
  '呼……发会儿呆。',
  '肩膀有点酸，活动一下。',
  '有进展的话记得叫我。',
]

/** 从空闲台词池随机取一句；random 可注入，便于单测锁定边界行为。 */
export function pickIdlePhrase(random: () => number = Math.random): string {
  return IDLE_PHRASES[Math.floor(random() * IDLE_PHRASES.length)]
}

/**
 * 舞台侧无法由 store 直接拿到的能力，全部显式注入：
 * - 拖拽 / 浮层 / TTS 属于组件生命周期与 UI 状态；
 * - 动作优先级、待机计时、预设与控件同步由舞台创建的控制器负责；
 * - 状态气泡与解说标记由组件持有的 chatStore / agentPresentation 提供。
 */
export interface CompanionDirectorDeps {
  /** 正在拖拽模型：待机行为要让路 */
  isDragging: () => boolean
  /** 设置面板 / 消息面板是否展开 */
  isPanelOpen: () => boolean
  /** 快速输入框是否展开 */
  isInputOpen: () => boolean
  /** TTS 是否正在播报（组件内 ttsSpeaking 的实时值） */
  isTtsSpeaking: () => boolean
  /** 真正的回复流归属独立于 agentWorkingState 的视觉状态。 */
  isReplyStreaming: () => boolean
  /** 当前模型可用的待机动作组，由模型提交阶段维护 */
  getIdleGroups: () => string[]
  /** 动作层级播放入口 */
  playMotionWithPriority: (
    group: string,
    layer: MotionLayer,
    index?: number,
    options?: { loop?: boolean },
  ) => boolean
  /** 模型热切换 / 场景重置时清空动作层级 */
  resetMotionPriority: () => void
  /** 预设 / 情绪分组触发（可回退模式） */
  triggerPresetOrGroup: (query: string, mode?: PresetFinishMode) => boolean
  /** 取消在途预设序列 */
  cancelPresetSequence: () => number
  /** 短暂拉高渲染帧率 */
  noteRenderActivity: (holdMs?: number) => void
  /** 状态气泡（空闲自言自语） */
  showStatusMessage: (text: string, ttlMs: number) => void
  /** TTS 播报 */
  speak: (text: string, options: { kind: 'narration' | 'reply'; style?: string }) => void
}

/**
 * 空闲行为的唯一实现，迁移自 DeskpetStage.vue。
 *
 * 负责空闲自言自语与随机待机动作的判定、执行；
 * 鼠标点击 / 双击、hover、拖拽、缩放、视线跟随与模型加载仍留在舞台。
 */
export function useCompanionDirector(deps: CompanionDirectorDeps) {
  const store = useDeskpetStore()

  /** 气泡“正在说话”脉冲；运行期与组件同生命周期，卸载时由 dispose 清理 */
  let speakingPulseTimer: ReturnType<typeof setTimeout> | null = null

  function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  }

  function canRunIdleAction(): boolean {
    return (
      !store.focusActive && store.modelLoaded &&
      store.live2dModel !== null &&
      getDafishHappyOwnedParameters(store.live2dModel).size === 0 &&
      canRunIdleActions({
        idleActionsEnabled: store.idleActionsEnabled,
        reducedMotion: prefersReducedMotion(),
        documentVisible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
        agentWorkingState: store.agentWorkingState,
        speaking: store.isSpeaking || deps.isTtsSpeaking(),
        thinking: store.isThinking,
        approvals: store.pendingApprovals.length,
        editingLocked: store.presetEditingLocked,
        previewActive: store.presetPreviewActive,
        // 预设正在播放时不允许空闲动作抢占：否则会中途 cancel 当前序列并触发回退清理
        presetRunning: store.presetSequenceActive || hasPresetMotionOwnership(store.live2dModel),
        uiBlocked: deps.isDragging() || deps.isPanelOpen() || deps.isInputOpen(),
      })
    )
  }

  function runIdleAction(): void {
    if (Math.random() < 0.2) {
      const phrase = pickIdlePhrase()
      deps.showStatusMessage(phrase, 4200)
      deps.speak(phrase, { kind: 'narration', style: 'gentle' })
      deps.noteRenderActivity(4000)
      return
    }

    if (Math.random() < 0.35 && !store.activeHoldPresetId) {
      const groups = ['空闲', '好奇', '害羞', '开心']
      const group = groups[Math.floor(Math.random() * groups.length)]
      if (deps.triggerPresetOrGroup(group, 'revert')) {
        deps.noteRenderActivity(5000)
        return
      }
    }

    const groups = deps.getIdleGroups()
    if (groups.length > 0) {
      const group = groups[Math.floor(Math.random() * groups.length)]
      deps.playMotionWithPriority(group, MotionLayer.Idle)
      deps.noteRenderActivity(5000)
    }
  }

  function pulseBubbleSpeaking(durationMs = 1800): void {
    store.isSpeaking = true
    cancelSpeakingPulse()
    speakingPulseTimer = setTimeout(() => {
      speakingPulseTimer = null
      if (!deps.isReplyStreaming() && store.agentWorkingState !== 'streaming') {
        store.isSpeaking = false
      }
    }, durationMs)
  }

  function cancelSpeakingPulse(): void {
    if (speakingPulseTimer !== null) clearTimeout(speakingPulseTimer)
    speakingPulseTimer = null
  }

  function resetPerformanceScene(): void {
    deps.cancelPresetSequence()
    deps.resetMotionPriority()
    if (!store.live2dModel) return
    setFocusWeight(store.live2dModel, 1, { transitionMs: RETURN_GAZE_MS })
    // Start the expression fade before clearing scene parameters; resetTransientParameters
    // now leaves active transitions alone so the face can ease back instead of snapping.
    clearExpression(store.live2dModel)
    resetTransientParameters(store.live2dModel)
    applyParameters(store.live2dModel, {})
  }

  /** 组件卸载时清理气泡脉冲定时器 */
  function dispose(): void {
    cancelSpeakingPulse()
  }

  return {
    canRunIdleAction,
    runIdleAction,
    pulseBubbleSpeaking,
    cancelSpeakingPulse,
    resetPerformanceScene,
    dispose,
  }
}
