<template>
  <div
    class="deskpet-stage"
    :class="{
      hovered: isHovered,
      'click-through-locked': store.clickThroughLocked,
      'hover-fade-enabled': store.hoverFadeEnabled,
      'model-faded': shouldFadeModel,
    }"
    :style="{ '--stage-shift-x': `${stageShiftX}px`, '--stage-bubble-width': `${bubbleWidth}px`, '--stage-bubble-shift-x': `${bubbleShiftX}px`, '--stage-bubble-min-left': `${bubbleMinLeft}px`, '--stage-bubble-ms': isDragging ? '0ms' : '560ms' }"
    @dblclick="onDoubleClick"
    @click="onStageClick"
    @mousedown.left="onModelMouseDown"
    @contextmenu.prevent="onStageRightClick"
  >
    <div class="stage-actor-layer">
      <div v-show="modelKind === 'live2d'" ref="stageRef" class="live2d-stage" />
      <StaticStage
        ref="staticStageRef"
        v-if="modelKind === 'image-set'"
        :hovered="shouldFadeModel"
        :idle-allowed="!store.focusActive && !showSettings && !chatPanelOpen && !todoPanelOpen && !showInput"
        @dragging-change="staticDragging = $event"
        @drag-end="reactToInteraction('placed')"
        @notice="onModelNotice"
        @open-models="openModelsFolderFromError"
        @open-settings="openSettingsFromError"
      />
    </div>
    <div
      v-show="!store.clickThroughLocked"
      class="nav-bar"
      title="拖动窗口；双击重置模型位置和缩放；右键循环切换情绪"
      @mousedown.stop="onNavMouseDown"
      @dblclick.stop="resetModelView"
      @mouseenter="isUiHovered = true"
      @mouseleave="isUiHovered = false"
    />

    <!-- Agent 实时工作状态胶囊指示器 -->
    <Transition name="state-pill-fade">
      <div v-if="voiceRecording || voiceStarting" class="voice-input-pill" :class="{ 'is-over-approval': !!store.currentApproval }">
        <span class="voice-input-dot" />
        {{ voiceStarting ? '正在准备麦克风…' : '正在听…' }}
        <button type="button" class="voice-pill-action" @mousedown.stop @click.stop="cancelVoiceInput">取消</button>
      </div>
      <div v-else-if="voiceTranscribing" class="voice-input-pill" :class="{ 'is-over-approval': !!store.currentApproval }">
        <span class="voice-input-dot is-busy" />
        正在识别…
        <button type="button" class="voice-pill-action" @mousedown.stop @click.stop="cancelVoiceInput">取消</button>
      </div>
      <div v-else-if="voiceRetry" class="voice-input-pill is-error" :class="{ 'is-over-approval': !!store.currentApproval }" role="alert">
        <span class="voice-input-dot is-error" />
        识别没有成功
        <button type="button" class="voice-pill-action is-primary" @mousedown.stop @click.stop="retryVoiceInput">重试</button>
        <button type="button" class="voice-pill-action" @mousedown.stop @click.stop="dismissVoiceRetry">放弃</button>
      </div>
    </Transition>

    <Transition name="state-pill-fade">
      <div
        v-if="agentStatusBadgeText"
        class="agent-state-pill pressable"
        :class="[`state-${store.agentWorkingState}`, `dock-${popDirectionX}`]"
        :title="store.currentApproval ? '请在审批卡片中处理' : '点击隐藏提示，不会取消宿主任务'"
        @click="dismissAgentStatus"
      >
        <span class="agent-state-dot" />
        <span class="agent-state-text">{{ agentStatusBadgeText }}</span>
      </div>
    </Transition>

    <Transition name="state-pill-fade">
      <div
        v-if="reminderCard"
        class="reminder-card"
        :class="`dock-${popDirectionX}`"
        role="dialog"
        aria-label="日常提醒"
        @mousedown.stop
        @dblclick.stop
        @contextmenu.stop.prevent
        @keydown.esc.stop.prevent="dismissReminder"
        @focusin="pauseReminderTimer"
        @focusout="resumeReminderTimer"
      >
        <div class="reminder-card-copy">
          <span class="reminder-card-title">{{ reminderCard.title }}</span>
          <span v-if="reminderCard.detail" class="reminder-card-detail">{{ reminderCard.detail }}</span>
        </div>
        <div class="reminder-card-actions">
          <button
            v-if="reminderCard.canComplete"
            type="button"
            class="reminder-action is-primary"
            :disabled="reminderBusy"
            @click="completeReminder"
          >{{ reminderBusy ? '处理中…' : '完成' }}</button>
          <button type="button" class="reminder-action" :disabled="reminderBusy" @click="snoozeReminder">10 分钟后</button>
          <button type="button" class="reminder-action" @click="openReminderTodos">打开待办</button>
          <button type="button" class="reminder-action is-ghost" title="关掉提醒" @click="dismissReminder">×</button>
        </div>
        <p v-if="reminderError" class="reminder-card-error" role="alert">{{ reminderError }}</p>
      </div>
    </Transition>

    <!-- 侧边悬浮工具栏：悬停窗口才浮现（伴随浮窗打开时常驻） -->
    <div
      class="btn-bar"
      :class="[{ visible: controlsVisible }, `dock-${popDirectionX}`]"
      @mouseenter="isUiHovered = true"
      @mouseleave="isUiHovered = false"
      @dblclick.stop
    >
      <button
        class="btn-bar-item"
        :class="{ active: showSettings }"
        @mousedown.stop
        @click.stop="toggleSettings"
        title="快捷设置：角色、外观与桌面交互"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="17" x2="20" y2="17" />
          <circle cx="9" cy="7" r="2.5" />
          <circle cx="15" cy="17" r="2.5" />
        </svg>
      </button>
      <button
        class="btn-bar-item"
        :class="{ active: chatPanelOpen }"
        @mousedown.stop
        @click.stop="toggleChatPanel"
        title="消息记录"
        :aria-label="failedMessageCount > 0 ? `消息记录（${failedMessageCount} 条未发送）` : '消息记录'"
      >
        <span v-if="failedMessageCount > 0" class="btn-bar-badge is-error" aria-hidden="true">{{ failedMessageCount }}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a8.5 8.5 0 0 1-8.5 8.5 8.8 8.8 0 0 1-3.8-.85L3 21l1.45-5.2A8.45 8.45 0 0 1 3.5 12 8.5 8.5 0 0 1 12 3.5 8.5 8.5 0 0 1 21 12Z" />
          <line x1="8.5" y1="11" x2="15.5" y2="11" />
          <line x1="8.5" y1="14.5" x2="13" y2="14.5" />
        </svg>
      </button>
      <button
        class="btn-bar-item"
        :class="{ active: todoPanelOpen }"
        @mousedown.stop
        @click.stop="toggleTodoPanel"
        :title="unhandledCount > 0 ? `待办（${unhandledCount} 件到点未处理）` : '待办'"
      >
        <span v-if="unhandledCount > 0" class="btn-bar-badge" aria-hidden="true">{{ unhandledCount }}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="5" y="3.8" width="14" height="16.4" rx="3" />
          <path d="M9.4 3.8v16.4" />
          <path d="M12.6 10h3.6" />
          <path d="M12.6 14h3.6" />
        </svg>
      </button>
      <button
        class="btn-bar-item"
        :class="{ active: voiceRecording }"
        @mousedown.stop
        @click.stop="toggleVoiceInput"
        :title="voiceStarting ? '正在准备麦克风…' : voiceRecording ? '停止录音' : '语音输入（快捷键见设置）'"
        :disabled="voiceTranscribing || voiceStarting"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" />
        </svg>
      </button>
    </div>

    <!-- 宿主工具审批交互卡片（直接在桌宠窗口提供「批准 / 拒绝」按钮） -->
    <ApprovalCard
      :approval="store.currentApproval"
      :key="approvalAttempt"
      :queue-length="store.pendingApprovals.length"
      @decide="onApprovalDecide"
    />

    <div v-if="modelError" class="model-error" role="alert">
      <div class="error-icon">!</div>
      <p>{{ modelError }}</p>
      <p class="error-hint" v-if="modelError.includes('Cubism')">
        缺少 Live2D 运行库，暂时无法显示这个角色。可以先换一个角色继续，或重新安装一份完整的 Uta。
      </p>
      <p class="error-hint" v-else>打开模型目录把角色文件放回去，或在设置里重新选择角色。</p>
      <details v-if="modelError.includes('Cubism')" class="error-more">
        <summary>安装说明（开发者）</summary>
        <p>
          从 Live2D 官网下载 Cubism SDK for Web，把 <code>Core/live2dcubismcore.min.js</code>
          放到 <code>src/renderer/public/</code>（开发）或随包资源目录后重新启动。
        </p>
      </details>
      <div class="model-error-actions">
        <button type="button" class="model-error-btn" @click.stop="openModelsFolderFromError">打开模型目录</button>
        <button type="button" class="model-error-btn is-primary" @click.stop="openSettingsFromError">去设置里更换角色</button>
      </div>
    </div>

    <ChatBubble
      :messages="chatStore.messages"
      :completion-source="store.currentApproval || reminderCard ? null : completionSource"
      :panel-open="chatPanelOpen"
      :display-name="store.chatDisplayName"
      :pop-direction-x="popDirectionX"
      :align-y="alignY"
      :history-state="chatStore.historyState"
      :history-message="chatStore.historyMessage"
      @bubbles-cleared="onDraftCleared"
      @close="chatPanelOpen = false"
      @clear-history="chatStore.clearHistory()"
      @retry-history="chatStore.initializeHistory()"
      @export-history="exportChatHistory"
      @retry-message="retryMessage"
    />

    <TodoBoard
      :open="todoPanelOpen"
      :pop-direction-x="popDirectionX"
      :align-y="alignY"
      @close="todoPanelOpen = false"
    />

    <QuickInput
      :model-value="inputText"
      :visible="showInput"
      :target="inputTargetLabel"
      :hint="inputHint"
      :disabled="!inputSupported"
      :max-chars="inputUsesHostBridge ? 1000 : undefined"
      @update:model-value="onDraftInput"
      @submit="sendText"
      @close="showInput = false"
      @blur="showInput = false"
    />

    <QuickSettingsPanel
      :open="showSettings"
      :pop-direction-x="popDirectionX"
      :align-y="alignY"
      @close="showSettings = false"
      @open-full-settings="openFullSettings"
    />
  </div>
</template>

<script setup lang="ts">
import { createPetSettingsExecutor } from '../settings-window/pet-executor'
import { canRestoreFailedDraft } from '@/services/draft-ownership'
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import ApprovalCard from './ApprovalCard.vue'
import ChatBubble from './ChatBubble.vue'
import TodoBoard from './TodoBoard.vue'
import { playReminderChime } from '@/services/reminder-chime'
import { legacySoundDisabled, loadTodoSettings, migrateLegacySoundSetting } from '@/services/todo-settings'
import QuickInput from './QuickInput.vue'
import QuickSettingsPanel from './QuickSettingsPanel.vue'
import StaticStage from './StaticStage.vue'
import { useDeskpetStore } from '@/stores/deskpet'
import { useChatStore, type TaskCompletionSource, type TextMessage } from '@/stores/chat'
import { UNTITLED_SESSION } from '../../shared/session-title'
import {
  getActiveAdapter,
  getActiveHostId,
  getHostPreference,
  onHostChanged,
  reconnectActiveHost,
  setBoundHostPreference,
  setHostPreference,
  switchActiveHost,
  toHostId,
} from '@/services/adapters/active'
import { findHost, type HostPreference } from '@/services/adapters'
import { useLive2DAnimation } from '@/composables/useLive2DAnimation'
import { useWindowDrag } from '@/composables/useWindowDrag'
import { useModelZoom } from '@/composables/useModelZoom'
import { useModelDrag } from '@/composables/useModelDrag'
import { useExpressionState } from '@/composables/useExpressionState'
import { useMotionPriority, MotionLayer } from '@/composables/useMotionPriority'
import { useIdleScheduler } from '@/composables/useIdleScheduler'
import { usePresetController } from '@/composables/usePresetController'
import { useCompanionDirector } from '@/composables/useCompanionDirector'
import { useStageModelLifecycle } from '@/composables/useStageModelLifecycle'
import { useStageRenderLoop } from '@/composables/useStageRenderLoop'
import { useDailyState } from '@/composables/useDailyState'
import { dueUnhandledIds } from '@/services/daily-due'
import { pickNarration } from '@/services/narration'
import { canRespondToInteraction } from '@/services/interaction-policy'
import { deliveryPresentation, type HostDeliveryState } from '../../shared/host-delivery'
import { createTtsController, summarizeSpeechText, type TtsSettings } from '@/services/tts'
import {
  cssPointToModelSpace,
  isCssPointOverModelInk,
  resetTransientParametersToHome,
  resizeModelFit,
} from '@/services/live2d/loader'
import { getEmotionTarget } from '@/services/live2d/emotion-adapter'
import { ReplySpeechTracker, isRecapPayload, resolveSpeechStyle } from '@/services/reply-speech'
import { RuntimeCommandController } from '@/services/runtime-command-controller'
import { createMotionChoreography } from '@/services/motion-choreography'
import { compileDirectorPlan, parseNaturalActionPrompt, type DirectorPlan } from '@/services/live2d/natural-action-planner'
import { listPairedGestures } from '@/services/live2d/gesture-pairing'
import type { ModelStatePreset } from '@/services/live2d/emotion-adapter'
import { AgentPresentationController, type AgentStatusPresentation } from '@/services/agent-presentation-controller'
import { setAmbientPerformance } from '@/services/performance/model-runtime'
import { selectAmbientPerformanceState } from '@/services/performance/ambient-state'
import type { DeskpetControlAction } from '@/services/host/contracts'
import type { AmbientPerformanceState } from '../../shared/model-performance-contracts'

const store = useDeskpetStore()
const chatStore = useChatStore()
const completionSource = ref<TaskCompletionSource | null>(null)
let completionTimer: ReturnType<typeof setTimeout> | undefined
let completionSoundTimer: ReturnType<typeof setTimeout> | undefined

function clearTaskCompletion(): void {
  completionSource.value = null
  clearTimeout(completionTimer)
  clearTimeout(completionSoundTimer)
}

function showTaskCompletion(source: TaskCompletionSource): void {
  if (!chatStore.recordTaskCompletion(source)) return
  clearTaskCompletion()
  completionSource.value = source
  completionTimer = setTimeout(clearTaskCompletion, 6500)
  if (store.focusActive || store.quietMode) return
  const playWhenQuiet = () => {
    if (!completionSource.value || store.focusActive || store.quietMode || store.currentApproval) return
    if (ttsController.isBusy() || runtimeCommands.hasActiveStreams()) {
      completionSoundTimer = setTimeout(playWhenQuiet, 200)
    } else {
      playReminderChime('ding')
    }
  }
  // Let the final reply enqueue its speech before considering the chime.
  completionSoundTimer = setTimeout(playWhenQuiet, 200)
}

/** TTS 播报期间驱动口型；与流式回复共用现有 tick */
const ttsSpeaking = ref(false)
const ttsSettings = computed<TtsSettings>(() => ({
  enabled: store.ttsEnabled && !store.focusActive,
  provider: store.ttsProvider,
  endpoint: store.ttsEndpoint,
  cloudEndpoint: store.ttsCloudEndpoint,
  voice: store.ttsVoice,
  rate: store.ttsRate,
  volume: store.ttsVolume,
  speakNarration: store.ttsSpeakNarration,
  speakReplies: store.ttsSpeakReplies,
}))
const ttsController = createTtsController(
  () => ttsSettings.value,
  (speaking) => {
    ttsSpeaking.value = speaking
    if (speaking) noteRenderActivity()
  },
)
watch(() => store.focusActive, active => { if (active) ttsController.cancel() })
/** 流式回复原文缓冲与最终回复去重；完整逻辑在 services/reply-speech.ts。 */
const replySpeech = new ReplySpeechTracker({ summarize: summarizeSpeechText })

function speakWithStyleResolution(text: string, options: { kind: 'narration' | 'reply'; style?: string }) {
  const resolved = resolveSpeechStyle(
    text,
    options.style,
    store.ttsAutoStyleFromHost,
    store.ttsCloudStyle,
  )
  ttsController.speak(text, { ...options, style: resolved || undefined })
}

/** Agent 工作状态、解说节流与流式看门狗；状态与定时器由控制器独占。 */
const agentStatusPresentation = ref<AgentStatusPresentation>('visible')
const agentPresentation = new AgentPresentationController({
  store,
  triggerPresetOrGroup: (query, mode) => presetController.hasTrackedSequence() || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? false : triggerPresetOrGroup(query, mode),
  pickNarration: (intent, options) => pickNarration(intent, options),
  showStatusMessage: (text, ttlMs) => { if (!store.focusActive) chatStore.showStatusMessage(text, ttlMs) },
  speakNarration: (text, style) => speakWithStyleResolution(text, { kind: 'narration', style }),
  beginTtsTurn: () => ttsController.beginTurn(),
  resetReplyDedupe: () => replySpeech.resetDedupe(),
  onStreamingTimeout: () => runtimeCommands.finishReplyStreams(),
  onStatusPresentationChange: presentation => { agentStatusPresentation.value = presentation },
  lastFinalReplyAt: () => replySpeech.lastFinalAt,
  noteRenderActivity: () => noteRenderActivity(),
  resetAgentVisualToHold: () => {
    if (presetController.hasTrackedSequence()) return
    const token = cancelPresetSequence()
    revertToActiveHoldPreset(token)
  },
})

/** 宿主指令统一经过控制器，作用域判定与分发逻辑可独立单测。 */
const runtimeCommands = new RuntimeCommandController({
  getModelRevision: () => modelLifecycle.getModelRevision(),
  getActiveHostId,
  resetSessionTurnState: () => resetSessionTurnState(),
  showTaskCompletion,
  noteRenderActivity: () => noteRenderActivity(),
  markModelNarrated: () => markModelNarrated(),
  summarizeSpeechText,
  replySpeech,
  chat: {
    addChatImage: chatStore.addChatImage,
    showChatMessage: (text, source) => chatStore.showChatMessage(text, source),
    showChoiceMessage: (text, ttlMs) => chatStore.showChoiceMessage(text, ttlMs),
    appendChatText: (delta, requestId, replace, source) =>
      chatStore.appendChatText(delta, requestId, replace === true, source),
    finishChatStream: (requestId) => chatStore.finishChatStream(requestId),
    finishAllStreams: () => chatStore.finishAllStreams(),
  },
  tts: {
    speak: (text, options) => speakWithStyleResolution(text, options),
    beginTurn: () => ttsController.beginTurn(),
    cancel: () => ttsController.cancel(),
  },
  pulseBubbleSpeaking: (durationMs) => companion.pulseBubbleSpeaking(durationMs),
  cancelSpeakingPulse: () => companion.cancelSpeakingPulse(),
  applyAgentWorkingState: (state, label, toolName, narrate) =>
    applyAgentWorkingState(state, label, toolName, narrate),
  triggerPresetOrGroup: (query, mode) => triggerPresetOrGroup(query, mode),
  playNarration: (intent, immediate, options) => playNarration(intent, immediate, options),
  resetAgentStateForReply: () => resetAgentStateForReply(),
  clearThinkingTimeout: () => clearThinkingTimeout(),
  armStreamingWatchdog: () => armStreamingWatchdog(),
  setPendingAnimation: (name, loop) => {
    store.pendingAnimation = name
    store.pendingAnimationLoop = loop
  },
  getAgentWorkingState: () => store.agentWorkingState,
  setSpeaking: (value) => {
    store.isSpeaking = value
  },
  setThinking: (value) => {
    store.isThinking = value
  },
  executeDirectActions: (plan, prompt) => {
    let directorPlan = (plan && typeof plan === 'object' ? plan : undefined) as DirectorPlan | undefined
    if (!directorPlan && prompt && typeof prompt === 'string') {
      directorPlan = parseNaturalActionPrompt(prompt, { parameters: store.modelCapabilities?.parameters, modelEmotions: store.modelEmotions, modelControls: store.modelControls }, listPairedGestures(store.modelCapabilities?.motionGroups, store.modelCapabilities?.motionDetails))
    }
    if (!directorPlan) return false
    const compiled = compileDirectorPlan(
      directorPlan,
      {
        parameters: store.modelCapabilities?.parameters,
        modelEmotions: store.modelEmotions,
        modelControls: store.modelControls,
      },
      listPairedGestures(store.modelCapabilities?.motionGroups, store.modelCapabilities?.motionDetails),
      { controls: [], parameters: {} },
    )
    if (compiled.length === 0) return false
    const directPreset: ModelStatePreset = {
      id: `direct_actions_${Date.now()}`,
      label: (directorPlan.summary || prompt || '动作指令').slice(0, 20),
      description: directorPlan.summary || '',
      emotion: 'neutral',
      group: '动作指令',
      controls: [],
      parameters: {},
      steps: compiled,
      finishMode: 'revert',
    }
    return presetController.handlePresetTrigger(directPreset, 'revert')
  },
})
const { start: startAnim, stop: stopAnim } = useLive2DAnimation()
const { onNavMouseDown } = useWindowDrag()

const stageRef = ref<HTMLDivElement>()
const staticStageRef = ref<{ isCursorOverFigure?: (x: number, y: number) => boolean; isTapGesture?: () => boolean } | null>(null)
const staticDragging = ref(false)
const INPUT_DRAFT_KEY = 'uta/pet-input-draft'
function readInputDraft(): string {
  try { return sessionStorage.getItem(INPUT_DRAFT_KEY) ?? '' } catch { return '' }
}
const inputText = ref(readInputDraft())
// 宿主切换会重载渲染层；未发送的文字放进会话存储，避免一次切换就丢掉
watch(inputText, value => {
  try {
    if (value) sessionStorage.setItem(INPUT_DRAFT_KEY, value)
    else sessionStorage.removeItem(INPUT_DRAFT_KEY)
  } catch { /* 草稿仍保留在内存中 */ }
})
const showInput = ref(false)
const inputHostId = ref(getActiveHostId())
const hostInputStatus = ref<import('../../shared/host-input-status').HostInputStatus | null>(null)
let hostInputRequest = 0
async function refreshHostInput(): Promise<void> {
  const request = ++hostInputRequest
  const host = inputHostId.value
  try {
    const result = await window.utaAPI?.getHostInputStatus?.(host) ?? null
    if (request === hostInputRequest && host === inputHostId.value) hostInputStatus.value = result
  } catch { if (request === hostInputRequest) hostInputStatus.value = null }
}
watch(inputHostId, () => { hostInputStatus.value = null; void refreshHostInput() }, { immediate: true })
watch(showInput, visible => { if (visible) void refreshHostInput() })
const inputReadinessTimer = setInterval(() => { if (showInput.value) void refreshHostInput() }, 2000)
const inputUsesHostBridge = computed(() => hostInputStatus.value?.supported === true)
const inputSupported = computed(() => inputUsesHostBridge.value
  ? hostInputStatus.value?.ready === true && !!hostInputStatus.value.targetSession
  : getActiveAdapter().getCapabilities().sendInput)
const inputTargetLabel = computed(() => {
  const hostId = inputHostId.value
  if (!hostId || hostId === 'none') return ''
  const host = findHost(hostId)?.label || hostId
  const target = hostInputStatus.value?.targetSession
  if (target) return `${host} · ${target.title || UNTITLED_SESSION}`
  return inputSupported.value && !inputUsesHostBridge.value ? host : ''
})
const inputHint = computed(() => {
  if (inputHostId.value === 'none' || !inputHostId.value) {
    return '当前未绑定宿主，请在快捷设置中选择宿主。'
  }
  if (!inputSupported.value) return hostInputStatus.value?.detail || '正在确认发送通道；若一直不可用，请完全退出后重新启动 Uta。'
  if (hostInputStatus.value?.mode === 'queue') return '宿主会排队处理。'
  return hostInputStatus.value?.mode === 'resume' ? '请等该聊天空闲后发送。' : ''
})
const isUiHovered = ref(false)
const chatPanelOpen = ref(false)
const todoPanelOpen = ref(false)
const todoBoardLane = ref<'host' | 'daily'>('daily')
const { state: dailyState } = useDailyState()
const unhandledCount = computed(() => dueUnhandledIds(dailyState.value).length)
const failedMessageCount = computed(() => chatStore.messages.filter(message =>
  message.type === 'text' && message.role === 'user' && message.delivery === 'failed').length)

interface ReminderCardState {
  ids: string[]
  title: string
  detail: string
  canComplete: boolean
}
const reminderCard = ref<ReminderCardState | null>(null)
const reminderBusy = ref(false)
const reminderError = ref('')
let reminderCardTimer: ReturnType<typeof setTimeout> | null = null
let reminderCardDeadline = 0
const showSettings = ref(false)
let hostBindingEpoch = 0
let sendSequence = 0
let draftRevision = 0

/** 桌宠所在屏幕角落自适应方向：默认右下角（向左弹出 + 底部对齐） */
const popDirectionX = ref<'left' | 'right'>('left')
const alignY = ref<'bottom' | 'top'>('bottom')

function applyWindowPlacement(placement: {
  windowX: number
  windowY: number
  windowWidth: number
  windowHeight: number
  workAreaX: number
  workAreaY: number
  workAreaWidth: number
  workAreaHeight: number
}) {
  const centerX = placement.windowX + placement.windowWidth / 2
  const centerY = placement.windowY + placement.windowHeight / 2
  const midX = placement.workAreaX + placement.workAreaWidth / 2
  const midY = placement.workAreaY + placement.workAreaHeight / 2
  popDirectionX.value = centerX >= midX ? 'left' : 'right'
  alignY.value = centerY >= midY ? 'bottom' : 'top'
}

/** 伴随浮窗打开时，角色舞台向另一侧平滑偏移，彻底避免浮窗遮挡模型 */
const sidePanelOpen = computed(() => showSettings.value || chatPanelOpen.value || todoPanelOpen.value)
/** 面板宽度：快捷设置 316px，消息/待办浮窗 296px；再加左右留白 12px 与右侧工具栏 46px + 14px */
const PANEL_BUBBLE_RESERVE = 296
const QUICK_PANEL_BUBBLE_RESERVE = 316
const BUBBLE_GUTTER = 12 + 12 + 46 + 14
const bubbleWidth = computed(() => {
  if (!sidePanelOpen.value) return 256
  const reserve = showSettings.value ? QUICK_PANEL_BUBBLE_RESERVE : PANEL_BUBBLE_RESERVE
  return Math.max(180, Math.min(256, window.innerWidth - reserve - BUBBLE_GUTTER))
})
const stageShiftX = computed(() => {
  if (!sidePanelOpen.value) return 0
  const bubbleFit = window.innerWidth / 2 - bubbleWidth.value / 2 - (46 + 14)
  const shiftMagnitude = Math.round(Math.min(142, window.innerWidth * 0.24, Math.max(62, bubbleFit)))
  return popDirectionX.value === 'left' ? shiftMagnitude : -shiftMagnitude
})
/** 气泡跟着角色走：角色在窗口内被拖动后，说话气泡不能还停在窗口正中。 */
const bubbleShiftX = computed(() => stageShiftX.value + store.modelOffsetX)
const bubbleMinLeft = computed(() => {
  if (!sidePanelOpen.value) return 8
  const panelWidth = showSettings.value ? QUICK_PANEL_BUBBLE_RESERVE : PANEL_BUBBLE_RESERVE
  const besidePanel = 12 + panelWidth + 12
  // 窗口比“面板 + 气泡 + 工具栏”还窄时，优先保证气泡仍在窗口内
  const roomForBubble = Math.max(8, window.innerWidth - bubbleWidth.value - 60 - 8)
  return Math.min(besidePanel, roomForBubble)
})

const agentStatusBadgeText = computed(() => {
  if (store.currentApproval) {
    return `等待审批: ${store.currentApproval.toolName}`
  }
  if (agentStatusPresentation.value === 'hidden') return ''
  if (agentStatusPresentation.value === 'stale') return '仍在等待宿主更新…'
  switch (store.agentWorkingState) {
    case 'thinking':
      return store.agentStateLabel || '正在思考...'
    case 'streaming':
      return store.agentStateLabel || '正在回复...'
    case 'tool_running':
      return store.agentStateLabel || (store.agentActiveToolName ? `执行工具: ${store.agentActiveToolName}` : '正在执行工具...')
    case 'error':
      return store.agentStateLabel || '执行遇到错误'
    default:
      return ''
  }
})

function toggleSettings() {
  chatPanelOpen.value = false
  todoPanelOpen.value = false
  showSettings.value = !showSettings.value
  if (showSettings.value) showInput.value = false
}

function openFullSettings(domain?: string) {
  showSettings.value = false
  todoPanelOpen.value = false
  void window.utaAPI?.openSettingsWindow?.(domain)
}

function toggleChatPanel() {
  if (chatPanelOpen.value) {
    chatPanelOpen.value = false
  } else {
    showSettings.value = false
    todoPanelOpen.value = false
    showInput.value = false
    chatPanelOpen.value = true
  }
}

function toggleTodoPanel() {
  if (todoPanelOpen.value) {
    todoPanelOpen.value = false
  } else {
    showSettings.value = false
    chatPanelOpen.value = false
    showInput.value = false
    todoBoardLane.value = 'daily'
    todoPanelOpen.value = true
  }
}

function dismissReminder(): void {
  if (reminderCardTimer) {
    clearTimeout(reminderCardTimer)
    reminderCardTimer = null
  }
  reminderCardDeadline = 0
  reminderBusy.value = false
  reminderError.value = ''
  reminderCard.value = null
}

/** 键盘焦点进入提醒卡时暂停自动消失，避免读屏/键盘用户操作到一半卡片被抽走。 */
function pauseReminderTimer(): void {
  if (!reminderCardTimer) return
  clearTimeout(reminderCardTimer)
  reminderCardTimer = null
}

function resumeReminderTimer(): void {
  if (!reminderCard.value || reminderCardTimer) return
  const remaining = Math.max(1000, reminderCardDeadline - Date.now())
  reminderCardTimer = setTimeout(dismissReminder, remaining)
}

async function completeReminder(): Promise<void> {
  const card = reminderCard.value
  if (!card || card.ids.length !== 1 || reminderBusy.value) return
  reminderBusy.value = true
  reminderError.value = ''
  try {
    const result = await window.utaAPI?.dailyUpdateItem?.({ id: card.ids[0], status: 'completed' })
    if (result?.ok) dismissReminder()
    else keepReminderAfterFailure(result?.error || '待办没有更新成功，请稍后再试。')
  } catch {
    keepReminderAfterFailure('待办没有更新成功，请稍后再试。')
  } finally {
    reminderBusy.value = false
  }
}

async function snoozeReminder(): Promise<void> {
  const card = reminderCard.value
  if (!card || reminderBusy.value) return
  reminderBusy.value = true
  reminderError.value = ''
  let failed = false
  try {
    for (const id of card.ids) {
      const result = await window.utaAPI?.dailySnoozeItem?.({ id, minutes: 10 })
      if (!result?.ok) failed = true
    }
  } catch {
    failed = true
  }
  reminderBusy.value = false
  if (failed) keepReminderAfterFailure('稍后提醒没有设置成功，请重试。')
  else dismissReminder()
}

/** 操作失败时保住卡片并给足阅读时间，避免用户刚看到报错就被自动收起。 */
function keepReminderAfterFailure(message: string): void {
  reminderError.value = message
  if (reminderCardTimer) {
    clearTimeout(reminderCardTimer)
    reminderCardTimer = null
  }
  reminderCardDeadline = Date.now() + 12_000
  // 焦点仍在卡内时不启动计时，沿用键盘用户“聚焦即暂停”的规则
  if (document.activeElement?.closest('.reminder-card')) return
  reminderCardTimer = setTimeout(dismissReminder, 12_000)
}

function onReminderKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !reminderCard.value || event.defaultPrevented || store.currentApproval) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  event.preventDefault()
  dismissReminder()
}

function openReminderTodos(): void {
  dismissReminder()
  showSettings.value = false
  chatPanelOpen.value = false
  todoBoardLane.value = 'daily'
  todoPanelOpen.value = true
}

/** 悬停窗口才显示工具条；但面板开着时常驻；锁定穿透开启时完全隐藏不可点击的按钮 */
const controlsVisible = computed(
  () =>
    !store.clickThroughLocked &&
    (isHovered.value || showSettings.value || chatPanelOpen.value || todoPanelOpen.value),
)

let unsubscribeGlobalCursor: (() => void) | null = null
let unsubscribeWindowPlacement: (() => void) | null = null
let unsubscribeSettingsCommand: (() => void) | null = null
let unsubscribeResetModelView: (() => void) | null = null
let unsubscribeSetHoverFade: (() => void) | null = null
let unsubscribeSetClickThrough: (() => void) | null = null
let unsubscribeVoiceToggle: (() => void) | null = null
let unsubscribeRuntimeCommand: (() => void) | null = null
let unsubscribeMotionRequest: (() => void) | null = null
let unsubscribeApprovalRequest: (() => void) | null = null
let unsubscribeApprovalCancel: (() => void) | null = null
let unsubscribeDailyReminder: (() => void) | null = null
let stageClickTimer: ReturnType<typeof setTimeout> | null = null
let hoverReactionTimer: ReturnType<typeof setTimeout> | null = null
let lastInteractionAt = 0

/**
 * 控件 / 预设上报由模型生命周期 composable 独占；
 * 保留同名入口，供预设控制器与调试入口继续按原方式注入。
 */
function reportControlsAndPresetsToHost(): void {
  modelLifecycle.reportControlsAndPresetsToHost()
}

/**
 * 预设序列 / 控件层 / 情绪分组触发全部交给控制器；
 * 这里只注入舞台独占的能力（底层隐藏部件、动作优先级、待机计时、宿主上报）。
 */
const presetController = usePresetController({
  getBaseHiddenParts: () => modelLifecycle.getBaseHiddenParts(),
  playMotionWithPriority: (group, layer, index, options) =>
    playMotionWithPriority(group, layer, index, options),
  stopMotion: (opts) => stopMotion(opts),
  releaseMotionLayer: () => releaseMotionPriority(),
  notifyIdleInteraction: () => idleScheduler.notifyInteraction(),
  reportControlsAndPresetsToHost,
  isLive2dAvailable: () => modelKind.value === 'live2d' && !!store.live2dModel,
})
const {
  cancelPresetSequence,
  handlePresetTrigger,
  triggerPresetOrGroup,
  handleControlAction,
  previewPresetStepOnModel,
  revertToActiveHoldPreset,
  syncControlsToModelAndHost,
  syncSlidersFromWorkshop,
  handleSettingsPanelClosed,
  resetAppliedControls,
} = presetController

const motionChoreography = createMotionChoreography({
  getHost: getActiveHostId,
  getModel: () => {
    if (modelKind.value !== 'live2d' || !store.modelLoaded || !store.live2dModel || !store.modelCapabilities) return null
    const caps = store.modelCapabilities
    const parameters = new Map(caps.parameters.map(p => [p.id, p]))
    return {
      name: modelLifecycle.resolveModelDisplayName(),
      revision: modelLifecycle.getModelRevision(),
      signature: caps.assetSignature,
      url: store.modelUrl,
      controls: store.modelControls.flatMap(control => {
        const stages = control.stages?.length ? control.stages : [null]
        return stages.map((stage, index) => ({
          id: stage ? `${control.id}:${index}` : control.id,
          baseId: control.id, label: stage ? `${control.label} · ${stage.label}` : control.label, category: control.category,
          held: control.held === true,
          parameters: Object.keys(stage?.parameters ?? control.parameters),
          parts: [...new Set([...control.hiddenParts, ...(control.shownParts ?? [])])],
        }))
      }),
      nativeMotions: Object.entries(caps.motionGroups).flatMap(([group, count]) => {
        return Array.from({ length: count }, (_, index) => {
          const detail = caps.motionDetails?.[`${group}#${index}`]
          const durationMs = detail?.durationMs ?? 0
          return detail?.native && Number.isFinite(durationMs) && durationMs >= 40
            ? [{ group, index, durationMs, label: detail.label, writes: detail.writes }] : []
        }).flat()
      }),
      presetSlots: store.defaultStatePresets.map(p => ({
        id: p.id, label: p.label, group: p.group ?? '', emotion: p.emotion, finishMode: p.finishMode ?? 'revert',
      })),
      parameters: store.modelSliders.flatMap(slider => {
        const p = parameters.get(slider.id)
        return p && !p.isPhysicsOutput && p.min < p.max ? [{
          id: p.id, label: slider.label.slice(0, 80), min: p.min, max: p.max, default: p.default,
        }] : []
      }),
    }
  },
  isEditing: () => store.presetEditingLocked || store.presetPreviewActive,
  play: (preset, onEnd, onStarted) => {
    const played = handlePresetTrigger(preset, 'revert', onEnd, onStarted)
    if (played) noteRenderActivity((preset.steps ?? []).reduce((sum, step) => sum + step.durationMs + step.holdMs, 600))
    return played
  },
  stop: presetController.stopSequence,
})

/**
 * 触摸 / 空闲行为交给 useCompanionDirector，状态与定时器由它独占；
 * 这里只注入舞台独占能力。模型提交、hover 淡出、拖拽缩放、视线跟随与点击命中
 * 仍留在组件内，因为它们直接操作 Pixi canvas、窗口几何与模型实体。
 */
const companion = useCompanionDirector({
  isReplyStreaming: () => runtimeCommands.hasActiveStreams(),
  isDragging: () => isDragging.value,
  isPanelOpen: () => showSettings.value || chatPanelOpen.value || todoPanelOpen.value,
  isInputOpen: () => showInput.value,
  isTtsSpeaking: () => ttsSpeaking.value,
  getIdleGroups: () => modelLifecycle.getIdleGroups(),
  playMotionWithPriority: (group, layer, index, options) =>
    playMotionWithPriority(group, layer, index, options),
  resetMotionPriority: () => resetMotionPriority(),
  triggerPresetOrGroup: (query, mode) => triggerPresetOrGroup(query, mode),
  cancelPresetSequence: () => cancelPresetSequence(),
  noteRenderActivity: (holdMs) => noteRenderActivity(holdMs),
  showStatusMessage: (text, ttlMs) => chatStore.showStatusMessage(text, ttlMs),
  speak: (text, options) => speakWithStyleResolution(text, options),
})

/**
 * 模型生命周期（初始加载 / 热切换 / 提交回滚 / 调试挂钩 / 宿主上下文上报）
 * 交给 composable 独占；这里只注入舞台自己的能力：
 * - 容器与滚轮绑定（缩放实现仍由 useModelZoom 提供）；
 * - 预设控制器、动作优先级、动画与待机调度；
 * - 宿主适配器上报。
 */
const modelLifecycle = useStageModelLifecycle({
  getStageContainer: () => stageRef.value,
  bindCanvasWheel: (canvas) => {
    const handler = (event: WheelEvent) => onWheel(event)
    canvas.addEventListener('wheel', handler, { passive: false })
    return () => canvas.removeEventListener('wheel', handler)
  },
  cancelPresetSequence,
  resetAppliedControls,
  syncControlsToModelAndHost,
  resetMotionPriority: () => resetMotionPriority(),
  playMotionWithPriority: (group, layer, index, options) =>
    playMotionWithPriority(group, layer, index, options),
  startAnimation: (model) => startAnim(model),
  stopAnimation: () => stopAnim(),
  startAnimationPoll: () => renderLoop.startAnimationPoll(),
  stopAnimationPoll: () => renderLoop.stopAnimationPoll(),
  startIdleScheduler: () => idleScheduler.start(),
  stopIdleScheduler: () => idleScheduler.stop(),
  sendModelControls: (controls, presets) => {
    getActiveAdapter().sendModelControls?.(controls, presets)
  },
  sendModelEmotions: (emotions) => {
    getActiveAdapter().sendModelEmotions(emotions)
  },
})
const { modelKind, modelError, modelNotice } = modelLifecycle

const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)')
const reducedMotion = ref(reducedMotionMedia.matches)
const documentVisible = ref(document.visibilityState !== 'hidden')
const onReducedMotionChange = () => {
  reducedMotion.value = reducedMotionMedia.matches
  if (reducedMotion.value && !store.presetEditingLocked && !store.presetPreviewActive &&
      (store.agentWorkingState === 'thinking' || store.agentWorkingState === 'tool_running')) {
    cancelPresetSequence(true)
    stopMotion({ resetTransientParams: false })
  }
}
const onVisibilityChange = () => { documentVisible.value = document.visibilityState !== 'hidden' }
reducedMotionMedia.addEventListener('change', onReducedMotionChange)
document.addEventListener('visibilitychange', onVisibilityChange)

/**
 * 日常微表现使用真实宿主状态，不新建第二套状态机：
 * 待机/思考/工作/回复/等待审批。设置预览、工坊编辑、减少动画和隐藏窗口都让路。
 */
const ambientState = computed<AmbientPerformanceState | null>(() => selectAmbientPerformanceState({
  idleActionsEnabled: store.idleActionsEnabled,
  focusActive: store.focusActive,
  reducedMotion: reducedMotion.value,
  documentVisible: documentVisible.value,
  modelLoaded: store.modelLoaded,
  hasModel: !!store.live2dModel,
  presetEditingLocked: store.presetEditingLocked,
  presetPreviewActive: store.presetPreviewActive,
  // "neutral" is written by a control reset, not a user-pinned pose.
  holdPresetPinned: !!store.activeHoldPresetId && store.activeHoldPresetId !== 'neutral',
  approvalPending: !!store.currentApproval,
  ttsSpeaking: ttsSpeaking.value,
  isSpeaking: store.isSpeaking,
  agentWorkingState: store.agentWorkingState,
}))
watch(
  () => [store.live2dModel, ambientState.value] as const,
  ([model, state], previous) => {
    const previousModel = previous?.[0]
    if (previousModel && previousModel !== model) setAmbientPerformance(previousModel, null)
    setAmbientPerformance(model, state)
  },
  { immediate: true },
)

watch(modelNotice, (notice) => {
  if (notice) chatStore.showStatusMessage(notice, 9000)
})

watch(showSettings, (open) => {
  if (!open) handleSettingsPanelClosed()
})

watch(
  () => store.currentApproval?.requestId ?? '',
  (requestId) => {
    if (!requestId) return
    // 审批需要完整可点击：收起侧栏与输入框，输入文字仍留在草稿里
    showSettings.value = false
    chatPanelOpen.value = false
    todoPanelOpen.value = false
    showInput.value = false
  },
)

store.registerControlHandler(handleControlAction)
store.registerSliderSyncHandler(syncSlidersFromWorkshop)
store.registerPresetTriggerHandler(handlePresetTrigger)
store.registerStepPreviewHandler(previewPresetStepOnModel)

onMounted(async () => {
  void chatStore.initializeHistory()
  window.addEventListener('pagehide', flushChatHistory)
  window.addEventListener('keydown', onReminderKeydown)
  // Alpha.11 and older stored the host only in renderer preferences. Promote
  // that single choice to the main-process binding once. After an explicit
  // unbind, the marker prevents the stale preference from re-binding itself.
  const bindingMigrationKey = 'uta/binding-migration-v1'
  if (window.utaAPI?.petBinding?.binding) {
    try { localStorage.setItem(bindingMigrationKey, '1') } catch { /* ignore */ }
  } else {
    let migrated = false
    try { migrated = localStorage.getItem(bindingMigrationKey) === '1' } catch { /* ignore */ }
    if (!migrated) {
      const preferred = getHostPreference()
      if (preferred !== 'standalone' && preferred !== 'fake') {
        await window.utaAPI?.bindPetHost?.(preferred).catch(() => null)
      }
      try { localStorage.setItem(bindingMigrationKey, '1') } catch { /* ignore */ }
    } else {
      setHostPreference('standalone')
    }
  }
  renderLoop.applyFpsMode()
  const executeSettingsCommand = createPetSettingsExecutor({
    store, getModelKind: () => modelKind.value,
    switchModel: url => modelLifecycle.switchModel(url), releaseWorkshop: handleSettingsPanelClosed,
    resetTransientParametersToHome: model => {
      if (model) resetTransientParametersToHome(model)
    },
    host: {
      getPreference: () => getHostPreference(),
      getActiveHostId: () => getActiveHostId(),
      getConnectionState: () => getActiveAdapter().getConnectionState(),
      isKnownPreference: preference =>
        preference === 'standalone' || !!findHost(preference as never)?.available,
      switchPreference: async preference => {
        if (preference === 'standalone') {
          const current = await window.utaAPI?.getPetBinding?.().catch(() => null)
          if (current?.binding) return false
          setHostPreference('standalone')
          setBoundHostPreference('standalone')
          switchActiveHost('fake')
          return true
        }
        const result = await window.utaAPI?.switchPetHost?.(preference)
        if (!result?.ok) return false
        // 热切换：直接无缝切换活动适配器，无需重启或重新加载窗口
        setBoundHostPreference(preference as HostPreference)
        switchActiveHost(toHostId(preference as HostPreference))
        return true
      },
      reconnect: async () => {
        await reconnectActiveHost()
        return true
      },
    },
  })
  unsubscribeSettingsCommand = window.utaAPI?.onPetSettingsCommand?.((dispatch) => {
    const { id } = dispatch
    void executeSettingsCommand(dispatch).then((reply) => {
      window.utaAPI?.respondPetSettingsCommand?.(id, reply)
    })
  }) ?? null
  // 模型加载部分由生命周期 composable 独占；容器缺失或模型已加载时保持原行为，
  // 跳过后续宿主订阅（拆分前 onMounted 就是在这里 return 的）。
  if (!(await modelLifecycle.bootstrapInitialModel())) return

  unsubscribeGlobalCursor = window.utaAPI?.onGlobalCursorPosition?.((position) => {
    // 全屏任意鼠标移动都立即回到高帧，保证视线跟随不卡顿
    renderLoop.handleGlobalCursor(position.x, position.y)
  }) ?? null
  unsubscribeWindowPlacement = window.utaAPI?.onWindowPlacement?.((placement) => {
    applyWindowPlacement(placement)
  }) ?? null
  void window.utaAPI?.getWindowPlacement?.().then((placement) => {
    if (placement) applyWindowPlacement(placement)
  }).catch(() => {})
  unsubscribeResetModelView = window.utaAPI?.onResetModelView?.(() => {
    resetModelView()
  }) ?? null
  unsubscribeSetHoverFade = window.utaAPI?.onSetHoverFade?.((enabled) => {
    store.applyLegacyHoverFade(enabled)
  }) ?? null
  const applyClickThroughLocked = (locked: boolean) => {
    store.clickThroughLocked = locked
    if (locked) {
      showSettings.value = false
      chatPanelOpen.value = false
      todoPanelOpen.value = false
      showInput.value = false
    }
  }
  unsubscribeSetClickThrough = window.utaAPI?.onSetClickThroughLocked?.((locked) => {
    applyClickThroughLocked(locked)
  }) ?? null
  // 主进程的 did-finish-load 广播早于这里注册（模型加载越慢越必然），补一次主动拉取；
  // 否则重启后系统层面已锁定穿透，界面仍按未锁定渲染，底衬和按钮会跟着 hover 闪烁。
  void window.utaAPI?.getUiState?.()
    .then((state) => {
      if (!state) return
      store.applyLegacyHoverFade(state.hoverFadeEnabled)
      applyClickThroughLocked(state.clickThroughLocked)
    })
    .catch(() => {})

  unsubscribeVoiceToggle = window.utaAPI?.onVoiceInputToggle?.(() => {
    void toggleVoiceInput()
  }) ?? null

  // 订阅宿主角色指令（通知、情绪、动作、工作状态反射、RP 回复同步、预设切换）
  unsubscribeRuntimeCommand = window.utaAPI?.onRuntimeCommand?.((payload) => {
    runtimeCommands.apply(payload.command, payload.meta)
  }) ?? null
  unsubscribeMotionRequest = window.utaAPI?.onMotionRequest?.(({ request }) => motionChoreography(request)) ?? null

  // 订阅交互式工具审批请求与取消事件
  unsubscribeApprovalRequest = window.utaAPI?.onApprovalRequest?.((req) => {
    store.enqueueApprovalRequest(req)
    triggerPresetOrGroup('好奇', 'revert')
  }) ?? null

  unsubscribeApprovalCancel = window.utaAPI?.onApprovalCancel?.((requestId) => {
    store.removeApprovalRequest(requestId)
  }) ?? null

  // 日常待办到点：气泡 + 轻神态；提示音是可选项，默认不响
  unsubscribeDailyReminder = window.utaAPI?.onDailyReminder?.((payload) => {
    const items = Array.isArray(payload?.items)
      ? payload.items.filter(item => item && typeof item.text === 'string' && item.text.trim())
      : []
    if (items.length === 0) return
    const todoCfg = loadTodoSettings()
    const first = items[0].text.trim().slice(0, 60)
    const text = items.length === 1
      ? `该做「${first}」了`
      : `有 ${items.length} 件待办到点了：${first}…`
    chatStore.showStatusMessage(text, (todoCfg.bubbleDurationSec || 10) * 1000)
    if (!triggerPresetOrGroup(todoCfg.reminderPreset || '好奇', 'revert')) triggerPresetOrGroup('好奇', 'revert')
    if (payload?.sound === true && !legacySoundDisabled()) playReminderChime(todoCfg.soundType)
    if (reminderCardTimer) clearTimeout(reminderCardTimer)
    reminderError.value = ''
    reminderBusy.value = false
    reminderCard.value = {
      ids: items.map(item => item.id),
      title: items.length === 1 ? first : `有 ${items.length} 件日常待办到点了`,
      detail: items.length > 1
        ? `${items.slice(0, 2).map(item => item.text.trim().slice(0, 30)).join('、')}${items.length > 2 ? '…' : ''}`
        : '',
      canComplete: items.length === 1,
    }
    reminderCardDeadline = Date.now() + 30_000
    reminderCardTimer = setTimeout(dismissReminder, 30_000)
    // 新提醒替换同一张卡片时焦点不会再次 focusin；若仍在卡内，新卡也要暂停计时
    if (document.activeElement?.closest('.reminder-card')) pauseReminderTimer()
  }) ?? null

  // 订阅完成后告知主进程：此后投递的角色指令与审批请求才真正可达
  await migrateLegacySoundSetting(window.utaAPI)
  window.utaAPI?.notifyRuntimeReady?.()
})

watch(() => [store.currentEmotion, store.emotionPulse] as const, ([emotion]) => {
  if (!store.live2dModel || emotion === 'neutral' || emotion === 'idle') return
  const target = getEmotionTarget(store.emotionAdapter, emotion)
  if (target?.motion) {
    playMotionWithPriority(target.motion.group, MotionLayer.Reply, target.motion.index ?? 0)
    idleScheduler.notifyInteraction()
  }
})

const renderLoop = useStageRenderLoop({
  getModelKind: () => modelKind.value,
  getStageShiftX: () => stageShiftX.value,
  getStaticStage: () => staticStageRef.value ?? null,
  isOverlayOpen: () => showSettings.value || chatPanelOpen.value || todoPanelOpen.value || showInput.value,
  isUiHovered: () => isUiHovered.value,
  resetUiHover: () => {
    isUiHovered.value = false
  },
  isDragging: () => isDragging.value,
  consumeDragOffsets: () => consumeDragOffsets(),
  playMotionWithPriority: (group, layer, index, options) =>
    playMotionWithPriority(group, layer, index, options),
  notifyIdleInteraction: () => idleScheduler.notifyInteraction(),
  isTtsSpeaking: () => ttsSpeaking.value,
  getTtsLevel: () => ttsController.getLevel(),
})
const { isHovered, isModelHovered, shouldFadeModel } = renderLoop

function clearHoverReaction(): void {
  if (hoverReactionTimer) {
    clearTimeout(hoverReactionTimer)
    hoverReactionTimer = null
  }
}

watch(isModelHovered, (hovered) => {
  clearHoverReaction()
  if (hovered) {
    hoverReactionTimer = setTimeout(() => {
      hoverReactionTimer = null
      const isPresetActive = store.presetSequenceActive
      if (isModelHovered.value && !store.focusActive && !isPresetActive) {
        reactToInteraction('hover')
      }
    }, 8000)
  }
})

const { onWheel } = useModelZoom(
  store,
  () => {
    const cursor = renderLoop.getMousePosition()
    return { x: cursor.x - stageShiftX.value, y: cursor.y }
  },
  () => ({ width: window.innerWidth, height: window.innerHeight }),
  (zoom) => renderLoop.setZoomBaseline(zoom),
)
const { onModelMouseDown, consumeDragOffsets, isDragging, isTapGesture } = useModelDrag(target => {
  clearHoverReaction()
  if (target instanceof HTMLElement && target.closest('.live2d-stage, .static-stage')) reactToInteraction('placed')
})

/**
 * hover 去抖、模型轮廓命中、悬停淡出偏好与全屏光标处理
 * 已迁移到 useStageRenderLoop；舞台只保留 isUiHovered 这一 UI 状态。
 */
const { cleanup: cleanupExpression } = useExpressionState(store, {
  shouldHold: () =>
    store.isSpeaking ||
    ttsSpeaking.value ||
    store.presetEditingLocked ||
    store.presetPreviewActive,
})
const { playMotionWithPriority, stopMotion, releaseMotionLayer: releaseMotionPriority, reset: resetMotionPriority } = useMotionPriority(store)

/** 短暂把渲染拉回高帧：计时器由渲染循环 composable 独占，这里保留同名入口供控制器注入 */
function noteRenderActivity(holdMs = 3500): void {
  renderLoop.noteRenderActivity(holdMs)
}

const idleScheduler = useIdleScheduler(
  (motion, layer, index) => {
    noteRenderActivity(5000)
    return playMotionWithPriority(motion, layer, index)
  },
  () => modelLifecycle.getIdleGroups(),
  { shouldAct: companion.canRunIdleAction, onIdle: companion.runIdleAction },
)

// 待机调度就绪后，按拆分前的顺序开启 renderActive 监听与窗口 mousemove 采样。
renderLoop.activate()
const unsubscribeHostChange = onHostChanged(() => {
  if (store.activeRunningPresetId) presetController.stopSequence(store.activeRunningPresetId)
  inputHostId.value = getActiveHostId()
  hostBindingEpoch += 1
  runtimeCommands.syncActiveHost()
  abortVoiceWork('宿主已切换，已取消本次语音输入。')
  store.clearApprovalRequests?.()
  getActiveAdapter().sendModelControls?.(store.modelControls, store.statePresets)
  getActiveAdapter().sendModelEmotions(store.modelEmotions)
})
onUnmounted(() => {
  clearTaskCompletion()
  clearInterval(inputReadinessTimer)
  hostInputRequest += 1
  window.removeEventListener('pagehide', flushChatHistory)
  window.removeEventListener('keydown', onReminderKeydown)
  void chatStore.flushHistory()
  if (stageClickTimer) {
    clearTimeout(stageClickTimer)
    stageClickTimer = null
  }
  if (hoverReactionTimer) clearTimeout(hoverReactionTimer)
  setAmbientPerformance(store.live2dModel, null)
  reducedMotionMedia.removeEventListener('change', onReducedMotionChange)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  unsubscribeHostChange()
  agentPresentation.dispose()
  companion.dispose()
  ttsController.dispose()
  replySpeech.clearBuffers()
  modelLifecycle.invalidatePendingLoads()
  stopAnim()
  renderLoop.dispose()
  unsubscribeGlobalCursor?.()
  unsubscribeGlobalCursor = null
  unsubscribeWindowPlacement?.()
  unsubscribeWindowPlacement = null
  unsubscribeSettingsCommand?.()
  unsubscribeSettingsCommand = null
  unsubscribeResetModelView?.()
  unsubscribeResetModelView = null
  unsubscribeSetHoverFade?.()
  unsubscribeSetHoverFade = null
  unsubscribeSetClickThrough?.()
  unsubscribeSetClickThrough = null
  unsubscribeVoiceToggle?.()
  unsubscribeVoiceToggle = null
  abortVoiceWork()
  unsubscribeRuntimeCommand?.()
  unsubscribeRuntimeCommand = null
  unsubscribeMotionRequest?.()
  unsubscribeMotionRequest = null
  unsubscribeApprovalRequest?.()
  unsubscribeApprovalRequest = null
  unsubscribeApprovalCancel?.()
  unsubscribeApprovalCancel = null
  unsubscribeDailyReminder?.()
  unsubscribeDailyReminder = null
  if (reminderCardTimer) {
    clearTimeout(reminderCardTimer)
    reminderCardTimer = null
  }
  cleanupExpression()
  idleScheduler.stop()
  modelLifecycle.disposeRenderer()
})

function onDoubleClick(event: MouseEvent) {
  clearHoverReaction()
  // 面板内的双击属于面板自己；不能再触发“关面板 / 开输入框”的舞台行为。
  const target = event.target as HTMLElement | null
  if (target?.closest('.quick-settings, .quick-input, .companion-window')) return
  if (stageClickTimer) {
    clearTimeout(stageClickTimer)
    stageClickTimer = null
  }
  if (showSettings.value) {
    showSettings.value = false
    return
  }
  // 输入框与伴随浮窗互斥：面板占着左侧时，输入框的发送键会落到工具栏上
  chatPanelOpen.value = false
  todoPanelOpen.value = false
  showInput.value = true
}

let lastRandomPresetId: string | null = null
let lastRandomPresetTriggerAt = 0

/** 右键：从可用预设中随机抽取并播放一个，播放完毕自动恢复 */
function triggerRandomPreset(): void {
  if (store.clickThroughLocked) return
  clearHoverReaction()
  const now = Date.now()
  if (now - lastRandomPresetTriggerAt < 350) return
  if (!canRespondToInteraction({
      enabled: store.interactionEnabled,
      modelLoaded: store.modelLoaded,
      overlayOpen: showSettings.value || showInput.value || chatPanelOpen.value || todoPanelOpen.value || isDragging.value || staticDragging.value || isUiHovered.value,
      busy: !!(store.isSpeaking || ttsSpeaking.value || store.agentWorkingState !== 'idle' ||
        store.pendingApprovals.length || store.presetEditingLocked || store.presetPreviewActive ||
        runtimeCommands.hasActiveStreams()),
      now,
      lastInteractionAt,
  })) return
  lastRandomPresetTriggerAt = now
  lastInteractionAt = now
  idleScheduler.notifyInteraction()

  if (modelKind.value === 'image-set') {
    const pool = store.modelEmotions.filter(
      (e) => e !== store.defaultEmotion && e !== 'neutral' && e !== 'idle',
    )
    if (pool.length === 0) return
    const candidate = pool.filter((e) => e !== store.currentEmotion)
    const next = candidate.length > 0
      ? candidate[Math.floor(Math.random() * candidate.length)]
      : pool[Math.floor(Math.random() * pool.length)]
    store.currentEmotion = next
    store.emotionPulse++
  } else {
    const pool = store.statePresets.filter(
      (p) => p.id !== 'neutral' && p.id !== store.activeHoldPresetId && p.group !== '日常',
    )
    const targetPool = pool.length > 0 ? pool : store.statePresets.filter((p) => p.id !== 'neutral')
    if (targetPool.length === 0) return
    const candidate = targetPool.filter((p) => p.id !== lastRandomPresetId)
    const picked = candidate.length > 0
      ? candidate[Math.floor(Math.random() * candidate.length)]
      : targetPool[Math.floor(Math.random() * targetPool.length)]
    lastRandomPresetId = picked.id
    triggerPresetOrGroup(picked.id, 'revert')
    const presetDuration = Array.isArray(picked.steps)
      ? picked.steps.reduce((sum, s) => sum + (s.durationMs ?? 0) + (s.holdMs ?? 0), 0)
      : 0
    noteRenderActivity(presetDuration > 0 ? presetDuration + 500 : 4000)
  }
  chatStore.showStatusMessage('我在呢。', 3000)
}

function onStageRightClick() {
  clearHoverReaction()
  if (stageClickTimer) {
    clearTimeout(stageClickTimer)
    stageClickTimer = null
  }
  triggerRandomPreset()
}

const approvalAttempt = ref(0)

async function onApprovalDecide(
  requestId: string,
  decision: 'allowed-once' | 'rejected' | 'unavailable',
) {
  try {
    await window.utaAPI?.resolveApproval?.(requestId, decision)
    store.removeApprovalRequest(requestId)
  } catch {
    // 保留卡片，重建组件以解除按钮的提交中状态，让用户可以直接再试
    approvalAttempt.value += 1
    chatStore.showStatusMessage('审批没能送达宿主，请再点一次。', 6000)
    return
  }
  if (decision === 'allowed-once') {
    triggerPresetOrGroup('开心', 'revert')
  } else if (decision === 'rejected') {
    triggerPresetOrGroup('专注', 'revert')
  }
}

/**
 * 舞台点击负责命中测试；没有明确头部区域时使用通用反馈。
 */
function onStageClick(event: MouseEvent): void {
  clearHoverReaction()
  if (event.detail > 1 || store.clickThroughLocked) return
  const target = event.target as HTMLElement | null
  if (!target?.closest('.live2d-stage') && !target?.closest('.static-stage')) return
  if (showSettings.value) {
    showSettings.value = false
    return
  }
  if (showInput.value) {
    showInput.value = false
    return
  }
  if (todoPanelOpen.value) {
    todoPanelOpen.value = false
    return
  }
  if (chatPanelOpen.value) {
    chatPanelOpen.value = false
    return
  }
}

function reactToInteraction(kind: 'head' | 'tap' | 'hover' | 'placed'): void {
  if (store.clickThroughLocked) return
  const isPresetActive = store.presetSequenceActive
  if (kind === 'hover' && isPresetActive) return
  const now = Date.now()
  if (!canRespondToInteraction({
      enabled: store.interactionEnabled,
      modelLoaded: store.modelLoaded,
      overlayOpen: showSettings.value || showInput.value || chatPanelOpen.value || todoPanelOpen.value || isDragging.value || staticDragging.value || isUiHovered.value,
      busy: !!(store.isSpeaking || ttsSpeaking.value || store.agentWorkingState !== 'idle' ||
        store.pendingApprovals.length || store.presetEditingLocked || store.presetPreviewActive ||
        runtimeCommands.hasActiveStreams() ||
        (kind === 'hover' && isPresetActive)),
      now,
      lastInteractionAt,
  })) return
  lastInteractionAt = now
  idleScheduler.notifyInteraction()
  if (!reducedMotion.value) {
    if (modelKind.value === 'image-set') {
      const emotion = kind === 'hover' && store.modelEmotions.includes('curious') ? 'curious' : 'happy'
      if (store.modelEmotions.includes(emotion)) { store.currentEmotion = emotion; store.emotionPulse++ }
    } else {
      triggerPresetOrGroup(kind === 'head' ? '开心' : '好奇', 'revert')
    }
  }
  const text = kind === 'head' ? '嗯，在呢。' : kind === 'placed' ? '好啦。' : '我在呢。'
  chatStore.showStatusMessage(text, 3000)
  noteRenderActivity(3000)
}

/**
 * 以下薄包装保留原函数名，供模板与 RuntimeCommandController 继续调用；
 * 状态、节流与定时器全部由 AgentPresentationController 独占。
 */
function markModelNarrated() {
  agentPresentation.markModelNarrated()
}

function playNarration(
  intent: NarrationIntent,
  applyVisual = true,
  options: { reasoning?: boolean } = {},
): void {
  agentPresentation.playNarration(intent, applyVisual, options)
}

function clearThinkingTimeout() {
  agentPresentation.clearThinkingTimeout()
}

function resetAgentStateForReply() {
  agentPresentation.resetAgentStateForReply()
}

function dismissAgentStatus() {
  agentPresentation.dismissAgentStatus()
}

function armStreamingWatchdog() {
  agentPresentation.armStreamingWatchdog()
}

function applyAgentWorkingState(
  state: AgentWorkingState,
  label?: string,
  toolName?: string,
  narrate?: NarrationIntent,
) {
  if (state === 'thinking' || state === 'tool_running' || state === 'streaming' || state === 'error') {
    clearTaskCompletion()
  }
  agentPresentation.applyAgentWorkingState(state, label, toolName, narrate)
}

/** 切换可见会话时清掉上一会话的“本轮”标记，避免去重或完成提示串台。 */
function resetSessionTurnState() {
  clearTaskCompletion()
  hostBindingEpoch += 1
  agentPresentation.resetSessionTurnState()
}

function onDraftInput(value: string): void {
  inputText.value = value
  draftRevision += 1
}

function flushChatHistory(): void { void chatStore.flushHistory() }

async function exportChatHistory(): Promise<void> {
  await chatStore.flushHistory()
  if (chatStore.historyState !== 'ready') return
  try {
    const result = await window.utaAPI?.exportChatHistory?.()
    if (result?.ok) chatStore.showStatusMessage('消息记录已导出。', 4000)
    else if (result?.error !== 'cancelled') chatStore.showStatusMessage('消息记录导出失败，请重试。', 5000)
  } catch { chatStore.showStatusMessage('消息记录导出失败，请重试。', 5000) }
}

function onModelNotice(text: string): void {
  chatStore.showStatusMessage(text, 8000)
}

watch(
  () => store.settingsSaveError?.timestamp ?? 0,
  (stamp, previous) => {
    if (!stamp || stamp === previous) return
    chatStore.showStatusMessage('设置未保存到本机，请重新调整一次，或稍后再试。', 8000)
  },
)

function onDraftCleared(): void {
  // 气泡到期只结束“这一轮视觉”，绝不能清掉用户正在写的内容
  draftRevision += 1
  if (!inputText.value.trim()) showInput.value = false
}

function restoreUnsentDraft(
  text: string,
  message: string,
  context: { sendSequence: number; draftRevision: number },
): void {
  if (!canRestoreFailedDraft(context, {
    inputText: inputText.value,
    sendSequence,
    draftRevision,
  })) {
    chatStore.showStatusMessage(`${message}；已有更新的输入或发送，未回填旧草稿。`, 6000)
    return
  }
  inputText.value = text
  showInput.value = true
  chatStore.showStatusMessage(message, 6000)
}

function retryMessage(message: TextMessage): void {
  if (!inputSupported.value) {
    chatStore.showStatusMessage('当前宿主没有可用的发送通道，请在宿主窗口输入。', 6000)
    return
  }
  chatPanelOpen.value = false
  todoPanelOpen.value = false
  showSettings.value = false
  if (inputText.value.trim() && inputText.value !== message.text) {
    showInput.value = true
    chatStore.showStatusMessage('输入框里已有草稿，没有覆盖；清空后可从消息记录放回旧消息。', 6000)
    return
  }
  inputText.value = message.text
  showInput.value = true
  chatStore.showStatusMessage('已放回输入框，确认后再发送。', 4000)
}

async function sendText(voiceSessionId?: string | null) {
  const text = inputText.value.trim()
  if (!text) return
  if (!inputSupported.value) {
    showInput.value = true
    void refreshHostInput()
    return
  }
  const expectedSessionId = hostInputStatus.value?.targetSession?.sessionId
  if (inputUsesHostBridge.value && voiceSessionId !== undefined && voiceSessionId !== expectedSessionId) {
    showInput.value = true
    chatStore.showStatusMessage('请确认目标聊天后发送识别结果。', 5000)
    return
  }
  if (inputUsesHostBridge.value && text.length > 1000) {
    chatStore.showStatusMessage('消息超过 1000 字符，请缩短后重试。', 6000)
    return
  }
  const targetHost = getActiveHostId()
  const targetAdapter = getActiveAdapter()
  const binding = hostBindingEpoch
  const draftContext = { sendSequence: ++sendSequence, draftRevision }
  const stillCurrent = () => binding === hostBindingEpoch &&
    targetHost === getActiveHostId() &&
    targetAdapter === getActiveAdapter()

  companion.resetPerformanceScene()
  // 清场景参数后重新落地控件层：用户保持的部件在发消息后的工作状态里继续存在。
  syncControlsToModelAndHost(240)
  agentPresentation.beginUserTurn()
  const userMessageId = chatStore.addUserMessage(text, { hostId: targetHost, sessionId: expectedSessionId })
  inputText.value = ''
  showInput.value = false

  if (targetAdapter.sendUserTextReceipt) {
    let receipt: Awaited<ReturnType<NonNullable<typeof targetAdapter.sendUserTextReceipt>>>
    try {
      receipt = await targetAdapter.sendUserTextReceipt(text)
    } catch {
      receipt = { ok: false, delivery: 'unknown', error: 'failed', message: '宿主回执中断，消息是否送达尚未确认，请先查看宿主。' }
    }
    const presentation = deliveryPresentation(receipt)
    chatStore.setDelivery(userMessageId, presentation.delivery, undefined, presentation.deliveryStage)
    if (!stillCurrent()) return
    if (receipt.ok) return
    if (!presentation.restoreDraft) {
      chatStore.showStatusMessage(receipt.message || '投递结果未确认，消息已保留在记录中，请先查看宿主。', 8000)
      return
    }
    restoreUnsentDraft(text, receipt.message || '发送失败，草稿已保留。', draftContext)
    return
  }

  if (targetAdapter.sendUserText(text)) { chatStore.setDelivery(userMessageId, 'sent'); return }

  triggerPresetOrGroup('思考', 'revert')

  // Main resolves the selected target and distinguishes delivery from task completion.
  let bridge: {
    ok: boolean
    code?: string
    text?: string
    accepted?: boolean
    error?: string
    sessionId?: string
    delivery?: HostDeliveryState
  } | null = null
  try {
    bridge = await window.utaAPI?.sendHostMessage?.({ host: targetHost, text, expectedSessionId }) ?? null
  } catch {
    bridge = null
  }
  const presentation = deliveryPresentation(bridge)
  chatStore.setDelivery(userMessageId, presentation.delivery, { sessionId: bridge?.sessionId }, presentation.deliveryStage)
  if (!stillCurrent()) return
  if (bridge?.code === 'target-changed') {
    void refreshHostInput()
    restoreUnsentDraft(text, '目标聊天已变化，请确认后再发送。', draftContext)
    return
  }
  if (!bridge || bridge.delivery === 'unknown') {
    chatStore.showStatusMessage(bridge?.error || '宿主回执未确认，消息已保留在记录中，请先查看宿主，避免重复发送。', 8000)
    return
  }
  if (!bridge.ok && !presentation.restoreDraft) {
    chatStore.showStatusMessage(bridge.error || '宿主已经收到消息，但本轮处理失败，请在宿主查看详情。', 8000)
    return
  }
  if (bridge?.ok && bridge.accepted) {
    // Codex queue 只确认入队；最终回复由既有 hook 带回，不在这里伪造一条助手消息
    chatStore.showStatusMessage(bridge.text || '已发送给宿主，等回复。', 6000)
    return
  }
  if (bridge?.ok && bridge.text) {
    const raw = String(bridge.text).replace(/\s+/g, ' ').trim()
    if (isRecapPayload(raw)) return
    const display = summarizeSpeechText(raw, 160) || raw.slice(0, 160) || '已完成。'
    const speech = summarizeSpeechText(raw, 120)
    // 同一句可能已经由宿主 hook 的 rp_reply 带回；不要重复弹气泡/念第二遍
    if (replySpeech.consume(raw)) {
      chatStore.showChatMessage(display, { hostId: targetHost, sessionId: bridge.sessionId })
      if (speech) speakWithStyleResolution(speech, { kind: 'reply' })
      triggerPresetOrGroup('开心', 'revert')
    }
    return
  }
  if (bridge?.code === 'no-session' || bridge?.code === 'busy') {
    restoreUnsentDraft(text, bridge.error || '宿主暂时不可用，草稿已保留。', draftContext)
    return
  }
  if (bridge?.code === 'unsupported') {
    restoreUnsentDraft(text, '当前宿主没有官方文本注入通道，草稿已保留；请直接在宿主窗口里操作。', draftContext)
    return
  }
  restoreUnsentDraft(text, `${bridge?.error || '宿主暂时不可用'}，草稿已保留。`, draftContext)
}

const voiceRecording = ref(false)
const voiceTranscribing = ref(false)
const voiceStarting = ref(false)
interface VoiceTarget { host: string; epoch: number; sessionId: string | null }
interface VoiceAttempt {
  audioBase64: string
  target: VoiceTarget | null
  autoSend: boolean
  error?: string
}
const voiceRetry = ref<VoiceAttempt | null>(null)
let voiceTarget: VoiceTarget | null = null
let voiceStartToken = 0
let voiceTranscribeToken = 0
let voiceStream: MediaStream | null = null
let voiceContext: AudioContext | null = null
let voiceSource: MediaStreamAudioSourceNode | null = null
let voiceProcessor: ScriptProcessorNode | null = null
let voiceGain: GainNode | null = null
let voiceChunks: Float32Array[] = []
let voiceAutoStopTimer: ReturnType<typeof setTimeout> | null = null
let voiceSttConfig: { autoSend: boolean } | null = null

function releaseVoiceCapture(): void {
  voiceStartToken += 1
  voiceStarting.value = false
  voiceTarget = null
  if (voiceAutoStopTimer) {
    clearTimeout(voiceAutoStopTimer)
    voiceAutoStopTimer = null
  }
  try {
    voiceProcessor?.disconnect()
    voiceSource?.disconnect()
    voiceGain?.disconnect()
    voiceStream?.getTracks().forEach((track) => track.stop())
    void voiceContext?.close()
  } catch {
    /* ignore */
  }
  voiceProcessor = null
  voiceSource = null
  voiceGain = null
  voiceStream = null
  voiceContext = null
  voiceRecording.value = false
}

function resampleVoice(samples: Float32Array, from: number, to: number): Float32Array {
  if (!samples.length || from === to) return samples
  const ratio = from / to
  const length = Math.max(1, Math.round(samples.length / ratio))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const a = samples[idx] ?? 0
    const b = samples[idx + 1] ?? a
    out[i] = a + (b - a) * frac
  }
  return out
}

function encodeWavBase64(samples: Float32Array, sampleRate: number): string {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += 2
  }
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function startVoiceInput(): Promise<void> {
  if (voiceRecording.value || voiceTranscribing.value || voiceStarting.value) return
  voiceRetry.value = null
  voiceStarting.value = true
  const token = ++voiceStartToken
  let stream: MediaStream | null = null
  try {
    const config = await window.utaAPI?.getSttConfig?.()
    if (token !== voiceStartToken) return
    if (!config?.enabled) {
      chatStore.showStatusMessage('语音输入未开启，请先在设置里打开。', 4200)
      return
    }
    voiceSttConfig = { autoSend: config.autoSend }
    if (config.autoSend) await refreshHostInput()
    if (token !== voiceStartToken) return
    voiceTarget = { host: getActiveHostId(), epoch: hostBindingEpoch, sessionId: hostInputStatus.value?.targetSession?.sessionId ?? null }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    if (token !== voiceStartToken) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    voiceStream = stream
    const context = new AudioContext()
    voiceContext = context
    if (context.state === 'suspended') await context.resume()
    if (token !== voiceStartToken) {
      releaseVoiceCapture()
      return
    }
    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(4096, 1, 1)
    const gain = context.createGain()
    gain.gain.value = 0
    voiceChunks = []
    processor.onaudioprocess = (event) => {
      const data = event.inputBuffer.getChannelData(0)
      voiceChunks.push(new Float32Array(data))
    }
    source.connect(processor)
    processor.connect(gain)
    gain.connect(context.destination)
    voiceSource = source
    voiceProcessor = processor
    voiceGain = gain
    voiceRecording.value = true
    voiceAutoStopTimer = setTimeout(() => {
      void stopVoiceInput()
    }, 60_000)
  } catch (error) {
    if (stream && !voiceStream) stream.getTracks().forEach((track) => track.stop())
    releaseVoiceCapture()
    const message = String((error as Error)?.message || error)
    chatStore.showStatusMessage(`麦克风不可用：${message}`, 5000)
  } finally {
    voiceStarting.value = false
  }
}

async function stopVoiceInput(): Promise<void> {
  if (!voiceRecording.value) return
  const sampleRate = voiceContext?.sampleRate || 48_000
  const target = voiceTarget
  const autoSend = voiceSttConfig?.autoSend === true
  const chunks = voiceChunks
  voiceChunks = []
  releaseVoiceCapture()
  if (!chunks.length) {
    chatStore.showStatusMessage('没有录到声音，再试一次吧。', 3000)
    return
  }
  const merged = mergeVoiceChunksFrom(chunks)
  const samples = resampleVoice(merged, sampleRate, 16_000)
  if (!samples.length) {
    chatStore.showStatusMessage('没有录到声音，再试一次吧。', 3000)
    return
  }
  await transcribeVoiceAttempt({ audioBase64: encodeWavBase64(samples, 16_000), target, autoSend })
}

async function transcribeVoiceAttempt(attempt: VoiceAttempt): Promise<void> {
  const token = ++voiceTranscribeToken
  voiceTranscribing.value = true
  chatStore.showStatusMessage('识别中…', 8000)
  try {
    const result = await window.utaAPI?.transcribeAudio?.({ audioBase64: attempt.audioBase64 })
    if (token !== voiceTranscribeToken) return
    if (!result?.ok || !result.text) {
      const message = result?.error || '没有识别到文字。'
      voiceRetry.value = { ...attempt, error: message }
      chatStore.showStatusMessage(message, 5000)
      return
    }
    voiceRetry.value = null
    onDraftInput(result.text)
    if (attempt.autoSend) {
      if (attempt.target && (attempt.target.epoch !== hostBindingEpoch || attempt.target.host !== getActiveHostId())) {
        showInput.value = true
        chatStore.showStatusMessage('宿主已切换，识别结果已放回输入框。', 5000)
        return
      }
      await sendText(attempt.target?.sessionId ?? null)
    } else {
      showInput.value = true
    }
  } catch (error) {
    if (token !== voiceTranscribeToken) return
    const message = `语音识别失败：${String((error as Error)?.message || error)}`
    voiceRetry.value = { ...attempt, error: message }
    chatStore.showStatusMessage(message, 5000)
  } finally {
    if (token === voiceTranscribeToken) {
      voiceTranscribing.value = false
      voiceSttConfig = null
    }
  }
}

function cancelVoiceInput(): void {
  if (voiceRecording.value || voiceStarting.value) {
    releaseVoiceCapture()
    voiceChunks = []
    chatStore.showStatusMessage('已取消录音。', 2500)
    return
  }
  if (!voiceTranscribing.value) return
  voiceTranscribeToken += 1
  voiceTranscribing.value = false
  voiceSttConfig = null
  chatStore.showStatusMessage('已取消识别。', 2500)
}

async function retryVoiceInput(): Promise<void> {
  const attempt = voiceRetry.value
  if (!attempt || voiceRecording.value || voiceTranscribing.value || voiceStarting.value) return
  await transcribeVoiceAttempt(attempt)
}

function dismissVoiceRetry(): void {
  voiceRetry.value = null
}

function abortVoiceWork(message?: string): void {
  const wasActive = voiceRecording.value || voiceStarting.value || voiceTranscribing.value
  voiceTranscribeToken += 1
  releaseVoiceCapture()
  voiceChunks = []
  voiceTranscribing.value = false
  voiceSttConfig = null
  voiceRetry.value = null
  if (wasActive && message) chatStore.showStatusMessage(message, 4000)
}

function mergeVoiceChunksFrom(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

async function toggleVoiceInput(): Promise<void> {
  if (voiceTranscribing.value || voiceStarting.value) return
  if (voiceRecording.value) await stopVoiceInput()
  else await startVoiceInput()
}

function openModelsFolderFromError(): void {
  void window.utaAPI?.openModelsFolder?.()
}

function openSettingsFromError(): void {
  void window.utaAPI?.openSettingsWindow?.('character')
}

function resetModelView() {
  store.resetModelView()
  if (store.live2dModel) {
    resizeModelFit(store.live2dModel, window.innerWidth, window.innerHeight, store.modelZoom)
    renderLoop.setZoomBaseline(store.modelZoom)
  }
}
</script>

<style scoped>
.deskpet-stage {
  width: 100vw;
  height: 100vh;
  position: relative;
  -webkit-app-region: no-drag;
  user-select: none;
  overflow: hidden;
  border-radius: 28px;
  /* 悬停底衬载体：作为 stage 自身背景，天然位于所有子元素（角色层）下方 */
  background-color: transparent;
  transition: background-color 0.25s ease;
}

/* 悬停底衬（hover backdrop）
   鼠标进入窗口时，在角色层「下方」铺一层灰色背景，用于指示窗口边界。
   改用纯色填充而非渐变暗角，原因有二：
   1) 铺在角色下方，角色本身不会被蒙灰（旧暗角在角色上方，会把角色边缘一起压暗）；
   2) 纯色没有渐变台阶，天然不存在低色深屏幕的色带问题，故不再需要噪点抖动层。 */
.deskpet-stage:not(.click-through-locked).hovered {
  background-color: rgba(70, 70, 70, 0.42);
}

.stage-actor-layer {
  width: 100%;
  height: 100%;
  transform: translate3d(var(--stage-shift-x, 0px), 0, 0);
  transition: transform 0.56s var(--spring-gentle);
  will-change: transform;
}

.live2d-stage {
  width: 100%;
  height: 100%;
  display: block;
  transition: opacity 0.18s ease;
}

.deskpet-stage.hover-fade-enabled.model-faded .live2d-stage {
  opacity: 0.15;
}

.nav-bar {
  position: absolute;
  bottom: 4px;
  left: calc(50% + var(--stage-shift-x, 0px));
  transform: translateX(-50%);
  width: 160px;
  height: 32px;
  -webkit-app-region: no-drag;
  z-index: 50;
  cursor: move;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: left 0.56s var(--spring-gentle), opacity 0.22s ease;
}

.deskpet-stage:not(.click-through-locked).hovered .nav-bar {
  opacity: 1;
  pointer-events: auto;
}

.nav-bar::after {
  content: '';
  width: 140px;
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.5);
}

/* ── Agent 工作状态指示胶囊 ── */
.voice-input-pill {
  position: absolute;
  z-index: 80;
  bottom: 56px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 999px;
  background: var(--dp-panel-bg);
  border: 1px solid var(--dp-border-strong);
  color: var(--dp-text-main);
  font-size: 11px;
  font-weight: 700;
  box-shadow: var(--dp-shadow);
  pointer-events: none;
  white-space: nowrap;
}
.voice-input-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dp-danger, #8F3A33);
  animation: voice-input-pulse 1.1s ease-in-out infinite;
}
.voice-input-dot.is-busy {
  background: #d97706;
}
.voice-input-dot.is-error {
  background: var(--dp-danger, #8F3A33);
  animation: none;
}
.voice-input-pill.is-error {
  border-color: var(--dp-danger, #8F3A33);
}
/* 审批卡占据底部时，把录音胶囊移到顶部，避免取消按钮被完全盖住 */
.voice-input-pill.is-over-approval {
  top: 12px;
  bottom: auto;
  z-index: 83;
}
.voice-pill-action {
  margin-left: 3px;
  padding: 2px 8px;
  border: 1px solid var(--dp-border-strong);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 10.5px;
  font-weight: 650;
  cursor: pointer;
  pointer-events: auto;
}
.voice-pill-action:hover {
  background: var(--dp-surface-hover);
}
.voice-pill-action:active {
  transform: scale(0.93);
}
.voice-pill-action.is-primary {
  border-color: var(--dp-danger, #8F3A33);
  color: var(--dp-danger, #8F3A33);
}
.voice-pill-action:focus-visible {
  outline: 2px solid var(--dp-accent, currentColor);
  outline-offset: 1px;
}
@keyframes voice-input-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
}

.agent-state-pill {
  position: absolute;
  top: 14px;
  transition: transform 0.16s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.16s ease;
  z-index: 64;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 11px;
  border-radius: 999px;
  background: var(--dp-bubble-bg, var(--dp-panel-bg));
  border: 1px solid var(--dp-border-strong);
  box-shadow: var(--dp-shadow);
  color: var(--dp-text-main);
  font-size: 11.5px;
  font-weight: 600;
  max-width: 220px;
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
}

.agent-state-pill.pressable:active {
  transform: scale(0.96);
}

.agent-state-pill.dock-left {
  right: 14px;
}

.agent-state-pill.dock-right {
  left: 14px;
}

/* 保持静态：常驻无限动画会让透明窗口的合成器按显示器刷新率持续出帧 */
.agent-state-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dp-accent);
  box-shadow: 0 0 0 3px var(--dp-accent-soft);
  flex-shrink: 0;
}

.agent-state-pill.state-error .agent-state-dot {
  background: #ef4444;
}

.agent-state-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reminder-card {
  position: absolute;
  top: 52px;
  z-index: 72;
  width: 238px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 11px 12px 10px;
  border-radius: 14px;
  background: var(--dp-bubble-bg, var(--dp-panel-bg));
  border: 1px solid var(--dp-border-strong);
  box-shadow: var(--dp-shadow);
  color: var(--dp-text-main);
  pointer-events: auto;
  user-select: none;
}

.reminder-card.dock-left {
  right: 14px;
}

.reminder-card.dock-right {
  left: 14px;
}

.reminder-card-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.reminder-card-title {
  padding-right: 16px;
  font-size: 12px;
  font-weight: 650;
  line-height: 1.35;
}

.reminder-card-detail {
  font-size: 11px;
  color: var(--dp-text-sub);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reminder-card-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.reminder-action {
  border: 1px solid var(--dp-border-strong);
  background: var(--dp-card-bg);
  color: var(--dp-text-main);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease, transform 0.16s ease;
}

.reminder-action:hover {
  background: var(--dp-card-hover);
}

.reminder-action:active {
  transform: scale(0.95);
}

.reminder-action.is-primary {
  background: var(--dp-accent-soft);
  border-color: var(--dp-accent-border);
}

.reminder-action.is-ghost {
  position: absolute;
  top: 6px;
  right: 6px;
  margin-left: 0;
  padding: 2px 6px;
  border-color: transparent;
  background: transparent;
  color: var(--dp-text-sub);
}

.reminder-action:disabled {
  opacity: 0.55;
  cursor: default;
}

.reminder-card-error {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--dp-danger, #8F3A33);
}

.state-pill-fade-enter-active {
  transition:
    opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.26s cubic-bezier(0.16, 1, 0.3, 1);
}

.state-pill-fade-leave-active {
  transition:
    opacity 0.15s cubic-bezier(0.4, 0, 1, 1),
    transform 0.16s cubic-bezier(0.4, 0, 1, 1);
}

.state-pill-fade-enter-from,
.state-pill-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.96);
}

/* ── 边缘竖排伴随工具条：随角落方位吸附在窗口外侧边缘 ── */
.btn-bar {
  position: absolute;
  bottom: 44px;
  z-index: 65;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 5px;
  border-radius: 14px;
  background: var(--dp-panel-bg, var(--dp-dock-bg));
  border: 1px solid var(--dp-border-strong);
  box-shadow: var(--dp-shadow);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    background 0.22s ease,
    border-color 0.22s ease;
}

.btn-bar.dock-left {
  right: 12px;
  transform: translateX(8px);
}

.btn-bar.dock-right {
  left: 12px;
  transform: translateX(-8px);
}

.btn-bar.visible,
.btn-bar:focus-within {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
}

.btn-bar-item {
  position: relative;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  padding: 0;
  color: var(--dp-icon);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.16s ease,
    color 0.16s ease,
    border-color 0.16s ease,
    transform 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
}

.btn-bar-item:hover {
  background: var(--dp-card-hover);
  color: var(--dp-text-main);
  transform: translateY(-1px);
}

.btn-bar-item:active {
  transform: scale(0.90) translateY(0);
}

.btn-bar-item.active {
  background: var(--dp-accent-soft);
  border-color: var(--dp-accent-border);
  color: var(--dp-text-main);
}

.btn-bar-item svg {
  width: 17px;
  height: 17px;
  stroke: currentColor;
  stroke-width: 2;
}

.btn-bar-badge {
  position: absolute;
  top: 2px;
  right: 1px;
  min-width: 13px;
  height: 13px;
  padding: 0 3px;
  border-radius: 999px;
  border: 1px solid var(--dp-accent-border);
  background: var(--dp-accent-soft);
  color: var(--dp-text-main);
  font-size: 9px;
  font-weight: 700;
  line-height: 11px;
  text-align: center;
  pointer-events: none;
}

.btn-bar-badge.is-error {
  border-color: var(--dp-danger, #8F3A33);
  background: var(--dp-panel-bg);
  color: var(--dp-danger, #8F3A33);
}

.model-error {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  box-sizing: border-box;
  width: min(340px, calc(100vw - 32px));
  padding: 28px;
  text-align: center;
  color: var(--dp-text-primary);
  background: var(--dp-panel-bg, var(--dp-bg));
  border: 1px solid var(--dp-border);
  border-radius: 18px;
  -webkit-app-region: no-drag;
}
.model-error p {
  font-size: 14px;
  margin: 8px 0;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.model-error .error-icon {
  font-size: 36px;
  font-weight: 700;
  margin-bottom: 10px;
  color: var(--dp-accent-read);
}
.model-error .error-hint {
  font-size: 12px;
  color: var(--dp-text-secondary);
}
.model-error .error-more {
  margin: 4px 0 2px;
  font-size: 11.5px;
  color: var(--dp-text-sub);
  text-align: left;
}
.model-error .error-more summary {
  cursor: pointer;
  text-align: center;
  color: var(--dp-text-secondary);
}
.model-error .error-more p {
  margin: 6px 0 0;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--dp-text-sub);
}
.model-error code {
  background: var(--dp-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.model-error-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.model-error-btn {
  padding: 6px 12px;
  border: 1px solid var(--dp-border-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--dp-text-primary);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.model-error-btn.is-primary {
  border-color: var(--dp-accent);
  background: var(--dp-accent);
  color: #fff;
}

.model-error-btn:focus-visible {
  outline: 2px solid var(--dp-accent);
  outline-offset: 2px;
}
</style>
