import { SessionScope } from './session-scope'
import { isRecapPayload, type ReplySpeechTracker } from './reply-speech'
import type { MessageSource, TaskCompletionSource } from '../stores/chat'
import type { ChatImage } from '../../shared/chat-history-contracts'

export interface RuntimeCommandDeps {
  getModelRevision?: () => string
  getActiveHostId: () => string
  resetSessionTurnState: () => void
  showTaskCompletion?: (source: TaskCompletionSource) => void
  noteRenderActivity: () => void
  markModelNarrated: () => void
  summarizeSpeechText: (text: string, maxChars: number) => string
  replySpeech: ReplySpeechTracker
  chat: {
    addChatImage: (image: ChatImage, description: string, source?: MessageSource) => void
    showChatMessage: (text: string, source?: MessageSource) => void
    showChoiceMessage: (text: string, ttlMs: number) => void
    appendChatText: (delta: string, requestId: string, replace?: boolean, source?: MessageSource) => void
    finishChatStream: (requestId: string) => void
    finishAllStreams: () => void
  }
  tts: {
    speak: (text: string, options: { kind: 'reply' | 'narration'; style?: string }) => void
    beginTurn: () => void
    cancel: () => void
  }
  pulseBubbleSpeaking: (durationMs: number) => void
  cancelSpeakingPulse: () => void
  applyAgentWorkingState: (
    state: AgentWorkingState,
    label?: string,
    toolName?: string,
    narrate?: NarrationIntent,
  ) => void
  triggerPresetOrGroup: (query: string, mode?: 'revert' | 'hold' | 'loop') => boolean
  playNarration: (
    intent: NarrationIntent,
    immediate?: boolean,
    options?: { reasoning?: boolean },
  ) => void
  resetAgentStateForReply: () => void
  clearThinkingTimeout: () => void
  armStreamingWatchdog: () => void
  setPendingAnimation: (name: string, loop: boolean) => void
  getAgentWorkingState: () => AgentWorkingState
  setSpeaking: (value: boolean) => void
  setThinking: (value: boolean) => void
  executeDirectActions?: (plan?: unknown, prompt?: string) => boolean
}

/**
 * 宿主指令的唯一分发点：先做 host/session 作用域判定，再调用注入的表现层回调。
 * 不直接持有 Pinia/Vue 状态，便于单测和后续替换宿主。
 */
export class RuntimeCommandController {
  private readonly scope = new SessionScope()
  private readonly activeStreams = new Set<string>()
  private readonly completedSessions = new Set<string>()
  private activeHostId: string

  constructor(private readonly deps: RuntimeCommandDeps) {
    this.activeHostId = deps.getActiveHostId()
  }

  /** 连接健康状态更新不等于切换宿主。会话绑定仍按宿主保留。 */
  syncActiveHost(): void {
    const next = this.deps.getActiveHostId()
    if (next === this.activeHostId) return
    this.activeHostId = next
    this.completedSessions.clear()
    this.resetTurnState()
  }

  hasActiveStreams(): boolean {
    return this.activeStreams.size > 0
  }

  /** 流超时/会话切换只结束旧消息，不清除聊天历史。 */
  finishReplyStreams(): void {
    for (const key of this.activeStreams) this.deps.chat.finishChatStream(key)
    this.activeStreams.clear()
    this.deps.replySpeech.clearBuffers()
  }

  private resetTurnState(): void {
    this.finishReplyStreams()
    this.deps.chat.finishAllStreams()
    this.deps.replySpeech.resetDedupe()
    this.deps.tts.cancel()
    this.deps.cancelSpeakingPulse()
    this.deps.setSpeaking(false)
    this.deps.setThinking(false)
    this.deps.setPendingAnimation('', false)
    this.deps.resetSessionTurnState()
  }

  private streamKey(requestId: string | undefined, meta?: RuntimeEventMetaPayload): string {
    return JSON.stringify([meta?.hostId || this.activeHostId, meta?.sessionId || '', requestId ?? null])
  }

  private finishStream(key: string): void {
    this.deps.chat.finishChatStream(key)
    this.activeStreams.delete(key)
    this.deps.setSpeaking(this.hasActiveStreams())
    if (this.hasActiveStreams()) this.deps.armStreamingWatchdog()
    else this.deps.clearThinkingTimeout()
  }

  apply(cmd: RuntimeCommandPayload, meta?: RuntimeEventMetaPayload): void {
    if (meta?.modelRevision && this.deps.getModelRevision && meta.modelRevision !== this.deps.getModelRevision()) return
    this.syncActiveHost()
    if (cmd.command === 'session_bind') {
      // Sessions share one pet, but binding a session should finish the
      // previous stream instead of leaving two chats mixed on stage.
      if (meta?.hostId && meta.hostId === this.deps.getActiveHostId()) {
        this.scope.bind(meta.hostId, meta.sessionId)
        this.resetTurnState()
      }
      return
    }

    const scope = this.scope.allows(this.deps.getActiveHostId(), meta)
    if (!scope.allowed) return
    if (scope.bound) this.resetTurnState()

    this.deps.noteRenderActivity()
    switch (cmd.command) {
      case 'chat_image':
        this.deps.chat.addChatImage(cmd.image, cmd.description, { hostId: meta?.hostId, sessionId: meta?.sessionId })
        break

      case 'notify': {
        if (isRecapPayload(cmd.text)) break
        const notice = this.deps.summarizeSpeechText(cmd.text, 160)
        if (!notice) break
        this.deps.markModelNarrated()
        this.deps.chat.showChatMessage(notice, meta)
        this.deps.pulseBubbleSpeaking(Math.min(3200, Math.max(1200, notice.length * 55)))
        if (cmd.speak && this.deps.replySpeech.consume(notice)) {
          this.deps.tts.speak(notice, { kind: 'reply', style: 'gentle' })
        }
        break
      }

      case 'choice_hint':
        this.deps.markModelNarrated()
        // 选项按行展示，不能被朗读摘要压成一行；每多一行选项就多留 3 秒阅读时间
        const lines = cmd.text.split('\n').length
        this.deps.chat.showChoiceMessage(cmd.text, Math.min(30000, 15000 + (lines - 1) * 3000))
        this.deps.noteRenderActivity()
        break

      case 'set_emotion':
        if (!this.deps.triggerPresetOrGroup(cmd.emotion, 'revert')) {
          console.debug('[Deskpet] Ignore runtime emotion not supported by current model:', cmd.emotion)
        }
        break

      case 'set_preset':
        if (!this.deps.triggerPresetOrGroup(cmd.preset, cmd.mode)) {
          console.debug('[Deskpet] Ignore runtime preset not found:', cmd.preset)
        }
        break

      case 'play_animation':
        this.deps.setPendingAnimation(cmd.name, cmd.loop)
        break

      case 'direct_actions':
        if (this.deps.executeDirectActions) {
          this.deps.executeDirectActions(cmd.plan, cmd.prompt)
        }
        break

      case 'agent_state': {
        if (cmd.state === 'streaming') this.deps.cancelSpeakingPulse()
        this.deps.applyAgentWorkingState(cmd.state, cmd.label, cmd.toolName, cmd.narrate)
        const session = meta?.sessionId || ''
        if (cmd.state === 'thinking' || cmd.state === 'tool_running' || cmd.state === 'streaming') {
          this.completedSessions.delete(session)
        } else if (cmd.state === 'completed' && !this.completedSessions.has(session)) {
          this.completedSessions.add(session)
          const oldest = this.completedSessions.values().next().value
          if (this.completedSessions.size > 128 && oldest !== undefined) this.completedSessions.delete(oldest)
          this.deps.showTaskCompletion?.({ hostId: meta?.hostId || this.activeHostId, sessionId: meta?.sessionId, ...meta?.completion })
        }
        break
      }

      case 'agent_narrate':
        this.deps.playNarration(cmd.intent, true, { reasoning: cmd.reasoning === true })
        break

      case 'rp_reply': {
        const streamKey = this.streamKey(cmd.requestId, meta)
        if (isRecapPayload(cmd.text)) {
          if (cmd.done && cmd.requestId) {
            this.finishStream(streamKey)
            this.deps.replySpeech.dropBuffer(streamKey)
          }
          break
        }
        if (cmd.text) this.deps.markModelNarrated()
        if (this.deps.getAgentWorkingState() !== 'idle') {
          this.deps.resetAgentStateForReply()
        } else {
          this.deps.clearThinkingTimeout()
        }
        const targetPresetOrEmotion = cmd.preset || cmd.emotion
        if (targetPresetOrEmotion) {
          this.deps.triggerPresetOrGroup(targetPresetOrEmotion, 'revert')
        }
        const speechKey = streamKey
        if (cmd.replace) {
          if (cmd.text) this.deps.replySpeech.setBuffer(speechKey, cmd.text)
        } else if (cmd.text && (cmd.streaming || cmd.requestId)) {
          this.deps.replySpeech.appendBuffer(speechKey, cmd.text)
        }
        if (cmd.streaming && cmd.requestId) {
          this.deps.cancelSpeakingPulse()
          this.activeStreams.add(streamKey)
          this.deps.setSpeaking(true)
          if (cmd.text) {
            this.deps.chat.appendChatText(cmd.text, streamKey, cmd.replace === true, meta)
          }
          if (cmd.done) {
            this.finishStream(streamKey)
            const fullReply = this.deps.replySpeech.takeBuffer(speechKey) || cmd.text
            if (fullReply && this.deps.replySpeech.consume(fullReply)) {
              this.deps.tts.speak(fullReply, { kind: 'reply', style: cmd.emotion })
            }
          } else {
            this.deps.armStreamingWatchdog()
          }
        } else if (cmd.done && cmd.requestId) {
          if (cmd.text) {
            this.deps.chat.appendChatText(cmd.text, streamKey, cmd.replace === true, meta)
          }
          this.finishStream(streamKey)
          const fullReply = this.deps.replySpeech.takeBuffer(speechKey) || cmd.text
          if (fullReply && this.deps.replySpeech.consume(fullReply)) {
            this.deps.tts.speak(fullReply, { kind: 'reply', style: cmd.emotion })
          }
        } else if (cmd.text) {
          this.deps.replySpeech.dropBuffer(speechKey)
          if (this.deps.replySpeech.consume(cmd.text)) {
            this.deps.setThinking(false)
            this.deps.chat.showChatMessage(cmd.text, meta)
            this.deps.pulseBubbleSpeaking(Math.min(3600, Math.max(1400, cmd.text.length * 50)))
            this.deps.tts.speak(cmd.text, { kind: 'reply', style: cmd.emotion })
          }
        }
        break
      }

      default:
        console.debug('[Deskpet] Unknown runtime command:', cmd)
    }
  }
}
