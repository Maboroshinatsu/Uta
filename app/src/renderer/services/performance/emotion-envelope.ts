export interface EmotionEnvelopeState {
  emotion: string
  appliedAt: number
  repeats: number
}

export interface EmotionEnvelopePlan {
  restart: boolean
  holdMs: number
  state: EmotionEnvelopeState
}

export const EMOTION_BASE_HOLD_MS = 5200
export const EMOTION_REPEAT_WINDOW_MS = 3000
const EMOTION_MAX_EXTRA_HOLD_MS = 2400
const EMOTION_REPEAT_EXTRA_MS = 700

/**
 * 情绪包络：进入时重放一次表情，保持时长按同类意图的重复次数缓慢延长；
 * 冷却窗内重复到达只续住，不重新贴脸。真正的淡入淡出仍由模型原生表情负责。
 */
export function planEmotionEnvelope(
  previous: EmotionEnvelopeState | null,
  emotion: string,
  now: number,
): EmotionEnvelopePlan {
  const at = Number.isFinite(now) ? now : 0
  const same = !!previous && previous.emotion === emotion && at >= previous.appliedAt &&
    at - previous.appliedAt < EMOTION_REPEAT_WINDOW_MS
  if (!same) {
    return {
      restart: true,
      holdMs: EMOTION_BASE_HOLD_MS,
      state: { emotion, appliedAt: at, repeats: 1 },
    }
  }
  const repeats = previous.repeats + 1
  const holdMs = EMOTION_BASE_HOLD_MS + Math.min(EMOTION_MAX_EXTRA_HOLD_MS, repeats * EMOTION_REPEAT_EXTRA_MS)
  return {
    restart: false,
    holdMs,
    state: { emotion, appliedAt: at, repeats },
  }
}
