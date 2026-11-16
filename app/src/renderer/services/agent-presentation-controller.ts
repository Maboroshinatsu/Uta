import type { NarrationIntent, NarrationReaction } from './narration'

type PresetMode = 'revert' | 'hold' | 'loop'
type TimerHandle = ReturnType<typeof setTimeout>
export type AgentStatusPresentation = 'visible' | 'hidden' | 'stale'

/** 控制器只依赖 store 的这几个可读写字段，测试里用普通对象即可 */
export interface AgentPresentationStore {
  agentWorkingState: AgentWorkingState
  agentStateLabel: string
  agentActiveToolName: string
  isThinking: boolean
  isSpeaking: boolean
  presetEditingLocked: boolean
  currentApproval: unknown | null
  live2dModel: unknown | null
}

export interface PickedNarration extends NarrationReaction {
  intent: NarrationIntent
  phrase: string
}

export interface AgentPresentationDeps {
  store: AgentPresentationStore
  /** 智能预设/情绪触发；模型没有对应分组时返回 false，由控制器走回退 */
  triggerPresetOrGroup: (query: string, mode?: PresetMode) => boolean
  pickNarration: (
    intent: NarrationIntent,
    options: { lastPhrase?: string },
  ) => PickedNarration | null
  showStatusMessage: (text: string, ttlMs: number) => void
  speakNarration: (text: string, style?: string) => void
  beginTtsTurn: () => void
  resetReplyDedupe: () => void
  /** 最终回复播报时间戳；用于 success 解说的 8 秒抑制 */
  lastFinalReplyAt: () => number
  noteRenderActivity: () => void
  /** 取消预设序列并回到当前 hold 预设（DeskpetStage 内部视觉复位） */
  resetAgentVisualToHold: () => void
  onStreamingTimeout?: () => void
  onStatusPresentationChange?: (presentation: AgentStatusPresentation) => void
  now?: () => number
  setTimeout?: (handler: () => void, delayMs: number) => TimerHandle
  clearTimeout?: (timer: TimerHandle) => void
}

const NARRATION_SAME_INTENT_MS = 3500
const NARRATION_MIN_GAP_MS = 900
const REASONING_VISUAL_MIN_GAP_MS = 2500
const REASONING_PHRASE_MIN_GAP_MS = 20000
const NARRATION_BUBBLE_DELAY_MS = 1200
const STREAMING_WATCHDOG_MS = 30000
const THINKING_TIMEOUT_MS = 30000
const TOOL_TIMEOUT_MS = 45000
const ERROR_TIMEOUT_MS = 5000
const SUCCESS_NARRATION_SUPPRESS_MS = 8000
export const REASONING_PHRASE_TTL_MS = 2800

/** 工作型解说对应的 hold 预设；模型没有时回退到专注/好奇 */
const TOOL_NARRATION_PRESETS: Partial<Record<NarrationIntent, string>> = {
  looking: '思考',
  reading: '思考',
  searching: '好奇',
  researching: '好奇',
  defining: '专注',
  editing: '专注',
  testing: '测试',
  running: '专注',
  waiting: '等待',
}

/**
 * Agent 工作状态、状态解说与流式看门狗的纯表现层控制器。
 *
 * 所有 store 写入、预设触发、气泡/TTS 都通过构造时注入的回调完成，
 * 因此可以用假时钟和假 store 单测，不依赖 Vue / Pinia / Live2D。
 */
export class AgentPresentationController {
  private readonly store: AgentPresentationStore
  private readonly now: () => number
  private readonly setTimer: (handler: () => void, delayMs: number) => TimerHandle
  private readonly clearTimer: (timer: TimerHandle) => void

  private thinkingTimeoutTimer: TimerHandle | null = null
  private pendingNarrationTimer: TimerHandle | null = null
  private modelNarratedThisTurn = false
  private readonly lastNarrationPhrase: Partial<Record<NarrationIntent, string>> = {}
  private readonly lastNarrationAt: Partial<Record<NarrationIntent, number>> = {}
  private lastNarrationAnyAt = 0
  private lastReasoningVisualAt = 0
  private lastReasoningPreset = ''
  private lastReasoningPhraseAt = 0
  /** 聆听记录/工作循环拥有视觉时，不让工作解说临时预设抢走。 */
  private workingVisualOwns = false
  private statusPresentation: AgentStatusPresentation = 'visible'

  private setStatusPresentation(presentation: AgentStatusPresentation): void {
    this.statusPresentation = presentation
    this.deps.onStatusPresentationChange?.(presentation)
  }

  private markStatusStale(): void {
    this.thinkingTimeoutTimer = null
    // 没有新事件不代表宿主已完成；用户隐藏的胶囊也不因计时到期再次弹出。
    if (this.statusPresentation !== 'hidden') this.setStatusPresentation('stale')
  }

  constructor(private readonly deps: AgentPresentationDeps) {
    this.store = deps.store
    this.now = deps.now ?? (() => Date.now())
    this.setTimer = deps.setTimeout ?? ((handler, delayMs) => setTimeout(handler, delayMs))
    this.clearTimer = deps.clearTimeout ?? ((timer) => clearTimeout(timer))
  }

  private triggerWorkingVisual(fallback: () => boolean): boolean {
    if (
      this.deps.triggerPresetOrGroup('聆听记录', 'loop') ||
      this.deps.triggerPresetOrGroup('聆听', 'loop') ||
      this.deps.triggerPresetOrGroup('工作', 'loop')
    ) {
      this.workingVisualOwns = true
      return true
    }
    this.workingVisualOwns = fallback()
    return this.workingVisualOwns
  }

  clearPendingNarration(): void {
    if (!this.pendingNarrationTimer) return
    this.clearTimer(this.pendingNarrationTimer)
    this.pendingNarrationTimer = null
  }

  markModelNarrated(): void {
    this.modelNarratedThisTurn = true
    this.clearPendingNarration()
  }

  /**
   * 播放一条状态解说：短气泡 + 对应预设/情绪。
   * 固定解说延迟出现；模型本轮已经自己说话时直接跳过，避免两种气泡叠在一起。
   * `thinking` 这类纯状态由右上角胶囊承担，不再单独弹气泡。
   * reasoning=true 时来自宿主推理流：只切预设，偶尔说一句极短状态，不展示思考内容。
   */
  playNarration(
    intent: NarrationIntent,
    applyVisual = true,
    options: { reasoning?: boolean } = {},
  ): void {
    if (options.reasoning) {
      if (this.modelNarratedThisTurn) return
      const reaction = this.deps.pickNarration(intent, {
        lastPhrase: this.lastNarrationPhrase[intent],
      })
      if (!reaction) return
      this.lastNarrationPhrase[intent] = reaction.phrase

      if (
        applyVisual &&
        !this.workingVisualOwns &&
        !this.store.presetEditingLocked &&
        !this.store.currentApproval &&
        (this.store.agentWorkingState === 'thinking' ||
          this.store.agentWorkingState === 'tool_running' ||
          this.store.agentWorkingState === 'streaming')
      ) {
        const target = reaction.preset || reaction.emotion
        const now = this.now()
        if (
          target &&
          target !== this.lastReasoningPreset &&
          now - this.lastReasoningVisualAt >= REASONING_VISUAL_MIN_GAP_MS
        ) {
          this.lastReasoningVisualAt = now
          this.lastReasoningPreset = target
          this.deps.triggerPresetOrGroup(target, 'hold')
        }
      }

      const now = this.now()
      if (now - this.lastReasoningPhraseAt >= REASONING_PHRASE_MIN_GAP_MS) {
        this.lastReasoningPhraseAt = now
        this.deps.showStatusMessage(reaction.phrase, REASONING_PHRASE_TTL_MS)
        this.deps.speakNarration(reaction.phrase, reaction.ttsStyle)
      }
      this.deps.noteRenderActivity()
      return
    }

    if (intent === 'thinking') return
    // 最终回复已经显示/播报过时，不再补一条“完成”状态气泡
    if (
      intent === 'success' &&
      this.now() - this.deps.lastFinalReplyAt() < SUCCESS_NARRATION_SUPPRESS_MS
    ) {
      return
    }
    const now = this.now()
    if (now - this.lastNarrationAnyAt < NARRATION_MIN_GAP_MS) return
    if (now - (this.lastNarrationAt[intent] ?? 0) < NARRATION_SAME_INTENT_MS) return

    const reaction = this.deps.pickNarration(intent, {
      lastPhrase: this.lastNarrationPhrase[intent],
    })
    if (!reaction) return

    this.lastNarrationAnyAt = now
    this.lastNarrationAt[intent] = now
    this.lastNarrationPhrase[intent] = reaction.phrase

    if (applyVisual && !this.workingVisualOwns && this.store.agentWorkingState === 'idle') {
      const presetApplied = reaction.preset
        ? this.deps.triggerPresetOrGroup(reaction.preset, 'revert')
        : false
      if (!presetApplied && reaction.emotion) {
        this.deps.triggerPresetOrGroup(reaction.emotion, 'revert')
      }
    }
    this.deps.noteRenderActivity()

    if (this.modelNarratedThisTurn || this.pendingNarrationTimer) return
    this.pendingNarrationTimer = this.setTimer(() => {
      this.pendingNarrationTimer = null
      if (this.modelNarratedThisTurn) return
      this.deps.showStatusMessage(reaction.phrase, reaction.bubbleTtlMs)
      this.deps.speakNarration(reaction.phrase, reaction.ttsStyle)
    }, NARRATION_BUBBLE_DELAY_MS)
  }

  clearThinkingTimeout(): void {
    if (this.thinkingTimeoutTimer) {
      this.clearTimer(this.thinkingTimeoutTimer)
      this.thinkingTimeoutTimer = null
    }
  }

  resetAgentStateForReply(): void {
    this.clearThinkingTimeout()
    this.setStatusPresentation('visible')
    this.workingVisualOwns = false
    this.store.agentWorkingState = 'idle'
    this.store.agentStateLabel = ''
    this.store.agentActiveToolName = ''
    this.store.isThinking = false
    if (!this.store.presetEditingLocked && this.store.live2dModel) {
      this.deps.resetAgentVisualToHold()
    }
  }

  dismissAgentStatus(): void {
    this.setStatusPresentation('hidden')
  }

  /** 流式回复的防呆：任何一帧都会续期，30 秒没有新帧就复位 */
  armStreamingWatchdog(): void {
    this.clearThinkingTimeout()
    this.thinkingTimeoutTimer = this.setTimer(() => {
      this.deps.onStreamingTimeout?.()
      this.store.isSpeaking = false
      this.resetAgentStateForReply()
    }, STREAMING_WATCHDOG_MS)
  }

  applyAgentWorkingState(
    state: AgentWorkingState,
    label?: string,
    toolName?: string,
    narrate?: NarrationIntent,
  ): void {
    const previousState = this.store.agentWorkingState
    this.clearThinkingTimeout()
    this.setStatusPresentation('visible')
    if (state === 'idle' || state === 'completed' || state === 'error') {
      // 完成时保留“本轮已经说过话”的标记：有最终回复或工作汇报就不要再补完成气泡
      if (state !== 'completed') this.modelNarratedThisTurn = false
      this.clearPendingNarration()
      this.lastReasoningPreset = ''
      this.lastReasoningVisualAt = 0
      this.lastReasoningPhraseAt = 0
    } else if (state === 'thinking') {
      // 只有从空闲/完成/报错进入思考才算新一轮；工具之间的思考不重置本轮去重
      if (previousState === 'idle' || previousState === 'completed' || previousState === 'error') {
        this.modelNarratedThisTurn = false
        this.deps.resetReplyDedupe()
        this.deps.beginTtsTurn()
      }
      this.lastReasoningPreset = ''
      this.lastReasoningVisualAt = 0
    }
    this.store.agentWorkingState = state
    this.store.agentStateLabel = label ?? ''
    this.store.agentActiveToolName = toolName ?? ''

    switch (state) {
      case 'thinking':
        this.store.isThinking = true
        this.store.isSpeaking = false
        // 工作状态之间连续切换时不要重启循环；从空闲/完成/报错进入才换视觉。
        if (previousState !== 'thinking' && previousState !== 'tool_running') {
          this.triggerWorkingVisual(() => this.deps.triggerPresetOrGroup('思考', 'hold'))
        }
        // 过久没有新事件只提示等待更新，不伪造宿主的空闲状态。
        this.thinkingTimeoutTimer = this.setTimer(() => {
          this.markStatusStale()
        }, THINKING_TIMEOUT_MS)
        break

      case 'tool_running':
        this.store.isThinking = true
        this.store.isSpeaking = false
        if (previousState !== 'thinking' && previousState !== 'tool_running') {
          this.triggerWorkingVisual(() => {
            if (
              !this.deps.triggerPresetOrGroup(
                (narrate && TOOL_NARRATION_PRESETS[narrate]) || '专注',
                'hold',
              )
            ) {
              return this.deps.triggerPresetOrGroup('好奇', 'hold')
            }
            return true
          })
        }
        this.thinkingTimeoutTimer = this.setTimer(() => {
          this.markStatusStale()
        }, TOOL_TIMEOUT_MS)
        break

      case 'streaming':
        this.store.isThinking = false
        this.store.isSpeaking = true
        this.workingVisualOwns = false
        this.armStreamingWatchdog()
        break

      case 'error':
        this.store.isThinking = false
        this.store.isSpeaking = false
        this.workingVisualOwns = false
        if (!this.deps.triggerPresetOrGroup('惊讶', 'revert')) {
          this.deps.triggerPresetOrGroup('难过', 'revert')
        }
        this.thinkingTimeoutTimer = this.setTimer(() => {
          this.resetAgentStateForReply()
        }, ERROR_TIMEOUT_MS)
        break

      case 'completed':
        this.store.isThinking = false
        this.store.isSpeaking = false
        this.workingVisualOwns = false
        this.store.agentWorkingState = 'idle'
        this.store.agentStateLabel = ''
        this.store.agentActiveToolName = ''
        this.deps.triggerPresetOrGroup('开心', 'revert')
        break

      case 'idle':
      default:
        this.store.isSpeaking = false
        this.resetAgentStateForReply()
        break
    }

    if (narrate) this.playNarration(narrate)
  }

  /** 切换可见会话时清掉上一会话的“本轮”标记，避免去重或完成提示串台。 */
  resetSessionTurnState(): void {
    this.setStatusPresentation('visible')
    this.modelNarratedThisTurn = false
    this.workingVisualOwns = false
    this.lastNarrationAnyAt = 0
    this.lastReasoningPreset = ''
    this.lastReasoningVisualAt = 0
    this.lastReasoningPhraseAt = 0
    for (const intent of Object.keys(this.lastNarrationAt) as NarrationIntent[]) {
      delete this.lastNarrationAt[intent]
    }
    this.clearPendingNarration()
    this.deps.resetReplyDedupe()
    this.deps.beginTtsTurn()
    this.store.agentWorkingState = 'idle'
    this.store.agentStateLabel = ''
    this.store.agentActiveToolName = ''
    this.store.isSpeaking = false
    this.store.isThinking = false
    this.clearThinkingTimeout()
  }

  dispose(): void {
    this.clearPendingNarration()
    this.clearThinkingTimeout()
  }

  /** 用户发出一条新消息：只清本轮解说/语音去重，不动右上角工作状态 */
  beginUserTurn(): void {
    this.modelNarratedThisTurn = false
    this.deps.resetReplyDedupe()
    this.deps.beginTtsTurn()
    this.clearPendingNarration()
  }
}
