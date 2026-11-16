import { watch } from 'vue'
import { useDeskpetStore } from '@/stores/deskpet'
import { applyParameters, clearExpression, setExpression } from '@/services/live2d/loader'
import { getEmotionTarget } from '@/services/live2d/emotion-adapter'
import { planEmotionEnvelope, type EmotionEnvelopeState } from '@/services/performance/emotion-envelope'

const HOLD_RECHECK_MS = 400
/** 没有 exp3 的模型靠参数做情绪；瞬切会显得跳，给一个短过渡。 */
const EMOTION_PARAM_TRANSITION_MS = 180

export interface ExpressionHoldOptions {
  /** 说话或工坊预览还在进行时延后回退；每 400ms 复查一次。 */
  shouldHold?: () => boolean
}

export function useExpressionState(
  store: ReturnType<typeof useDeskpetStore>,
  options: ExpressionHoldOptions = {},
) {
  let revertTimer: ReturnType<typeof setTimeout> | null = null
  let expressionActive = false
  let envelope: EmotionEnvelopeState | null = null

  function applyEmotionState(emotion: string) {
    const model = store.live2dModel
    if (!model) return

    const target = getEmotionTarget(store.emotionAdapter, emotion)

    if (target?.expression) {
      setExpression(model, target.expression)
      expressionActive = true
    } else if (expressionActive) {
      // 目标情绪不带表情（含未映射的 neutral）时必须显式淡出，
      // 否则上一个表情会永久残留
      clearExpression(model)
      expressionActive = false
    }
    if (emotion !== 'neutral' && emotion !== 'idle' && target?.parameters) {
      applyParameters(model, target.parameters, { transitionMs: EMOTION_PARAM_TRANSITION_MS })
    } else {
      // neutral/idle 常态或目标情绪没有声明参数时必须显式清空 stack.emotion，
      // 否则 neutral 的默认参数会常驻在 stack.emotion 层并覆盖 stack.controls（预设与面捕滑块）
      applyParameters(model, {}, { transitionMs: EMOTION_PARAM_TRANSITION_MS })
    }
  }

  function clearRevertTimer() {
    if (revertTimer) {
      clearTimeout(revertTimer)
      revertTimer = null
    }
  }

  function scheduleRevert(delayMs: number) {
    clearRevertTimer()
    revertTimer = setTimeout(() => {
      revertTimer = null
      if (options.shouldHold?.()) {
        scheduleRevert(HOLD_RECHECK_MS)
        return
      }
      store.currentEmotion = store.defaultEmotion || 'neutral'
    }, delayMs)
  }

  // 同时观察 pulse：相同情绪连发也要续住，但冷却窗内不重复贴同一张脸。
  watch(
    () => [store.currentEmotion, store.emotionPulse] as const,
    ([emotion]) => {
      clearRevertTimer()
      const transient = emotion !== store.defaultEmotion && emotion !== 'neutral' && emotion !== 'idle'
      const plan = planEmotionEnvelope(envelope, emotion, Date.now())
      envelope = plan.state
      if (plan.restart) applyEmotionState(emotion)

      // 回退归属：本控制器只负责 Live2D 模型。立绘包的回退由 StaticStage 负责，
      // 否则同一情绪会有两个定时器重复回退（DP-014）
      if (!store.live2dModel) return
      if (transient) scheduleRevert(plan.holdMs)
    },
  )

  function cleanup() {
    clearRevertTimer()
  }

  return { cleanup }
}
