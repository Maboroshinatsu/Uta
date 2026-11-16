<template>
  <!-- 位于窗口下 1/3 处的对话气泡（自动换行，不遮挡角色脸部） -->
  <div class="speech-bubbles-anchor">
    <Transition name="bubble-pop">
      <div v-if="completionSource && !floatingBubbles.some(bubble => bubble.type === 'choice')"
        class="speech-bubble choice completion-card" role="status">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12 2.3 2.4 4.7-5" />
        </svg>
        <div class="completion-copy">
          <span>宿主任务已完成</span>
          <span v-if="completionSourceLabel" class="completion-source" :title="completionSourceLabel">{{ completionSourceLabel }}</span>
        </div>
      </div>
    </Transition>
    <TransitionGroup name="bubble-pop">
      <div v-for="b in floatingBubbles" :key="b.id" class="speech-bubble" :class="[b.role, b.type]">
        <img v-if="b.imageSrc" :src="b.imageSrc" :alt="b.text" class="emoji-img" />
        <template v-else-if="b.type === 'choice'">
          <span class="choice-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.6 9.2a2.6 2.6 0 1 1 4.2 2.1c-.9.7-1.8 1.2-1.8 2.5" />
              <circle cx="12" cy="17.1" r=".9" fill="currentColor" stroke="none" />
            </svg>
            宿主在等你选择
          </span>
          <span class="choice-text">{{ b.text }}</span>
        </template>
        <template v-else-if="b.type === 'text'">
          <MarkdownText :text="b.text" />
          <span v-if="b.streaming" class="msg-cursor">|</span>
        </template>
        <template v-else>
          <span v-if="b.type === 'status'" class="status-mark" aria-hidden="true" />
          {{ b.text }}
        </template>
      </div>
    </TransitionGroup>
  </div>

  <!-- 独立消息记录伴随浮窗（四角方向自适应 + 阻尼滑入/滑出动画） -->
  <Transition name="companion-slide">
    <div
      v-if="panelOpen"
      class="companion-window message-companion"
      :class="[`pop-${popDirectionX}`, `align-${alignY}`]"
      @mousedown.stop
      @dblclick.stop
      @wheel.stop
      @contextmenu.stop.prevent
    >
      <div class="comp-header">
        <div class="comp-title">
          <span class="comp-title-dot" />
          <span>消息记录</span>
          <span v-if="filteredMessages.length > 0" class="comp-count">{{ filteredMessages.length }}</span>
        </div>
        <button class="icon-close-btn" @click="emit('close')" title="收起消息记录">
          <svg viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="history-tools">
        <input
          v-model="searchTerm"
          class="history-search"
          type="search"
          placeholder="搜索消息"
          aria-label="搜索消息"
          @keydown.esc.stop.prevent="onSearchEscape"
        />
        <button type="button" class="history-action" :disabled="historyState !== 'ready'" @click="emit('export-history')">导出</button>
        <button v-if="filteredMessages.length && !clearConfirm" type="button" class="history-action" :disabled="historyState !== 'ready'" @click="clearConfirm = true">清空</button>
      </div>
      <div class="history-tools history-filters">
        <select v-model="sourceFilter" class="history-search" aria-label="筛选消息来源">
          <option value="">全部来源</option>
          <option v-for="source in sourceChoices" :key="source.key" :value="source.key">{{ source.label }}</option>
        </select>
        <select v-model="historyFilter" class="history-search" aria-label="筛选记录类型">
          <option value="all">全部记录</option>
          <option value="failed">发送失败</option>
        </select>
      </div>
      <div v-if="clearConfirm" class="history-confirm" role="alert">
        <span>清空全部消息记录？</span>
        <button type="button" class="history-action is-danger" @click="clearConfirm = false; emit('clear-history')">确认清空</button>
        <button type="button" class="history-action" @click="clearConfirm = false">取消</button>
      </div>
      <div class="history-note" role="status">
        <span>{{ historyMessage || (historyState === 'ready' ? '本机记录 · 最多 1000 条' : historyState === 'loading' ? '正在读取记录…' : '消息仅在本次运行中显示。') }}</span>
        <button v-if="historyState === 'error'" type="button" class="history-action" @click="emit('retry-history')">重试</button>
      </div>

      <div class="comp-body" ref="messagesRef" @scroll="onBodyScroll">
        <button
          v-if="hiddenCount > 0"
          type="button"
          class="history-more"
          @click="renderLimit += RENDER_STEP"
        >显示更早的 {{ Math.min(RENDER_STEP, hiddenCount) }} 条（还有 {{ hiddenCount }} 条）</button>
        <div v-for="msg in visibleMessages" :key="msg.id" :class="['msg-row', msg.role]">
          <div class="msg-label">
            <span>{{ msg.role === 'user' ? '你' : msg.type === 'choice' ? '宿主待选择' : speakerLabel(msg) }}</span>
            <span
              v-if="isHistoryMessage(msg) && sourceLabel(msg) && (msg.role === 'user' || sourceLabel(msg) !== speakerLabel(msg))"
              class="msg-source"
              :title="sourceTitle(msg)"
            >{{ sourceLabel(msg) }}</span>
            <span
              v-if="isHistoryMessage(msg) && (msg.sessionId || (msg.hostId && msg.hostId !== 'none'))"
              class="msg-session-tag"
              :title="messageSessionTitle(msg)"
            >{{ messageSessionTitle(msg) }}</span>
            <span
              v-if="msg.type === 'text' && msg.role === 'user' && msg.delivery"
              class="msg-delivery"
              :class="`is-${msg.delivery}`"
            >{{ deliveryLabel(msg.delivery, msg.deliveryStage) }}</span>
            <time class="msg-time">{{ formatTime(msg.timestamp) }}</time>
          </div>
          <div
            class="msg-bubble"
            :class="{
              streaming: msg.type === 'text' && msg.streaming,
              status: msg.type === 'status',
              choice: msg.type === 'choice',
            }"
          >
            <img v-if="msg.type === 'emoji'" :src="chatImageSrc(msg.image)" :alt="msg.description" class="emoji-img" loading="lazy" />
            <template v-else-if="msg.type === 'choice'">
              <span class="choice-label">宿主在等你选择</span>
              <span class="choice-text">{{ msg.text }}</span>
            </template>
            <template v-else-if="msg.type === 'text' && msg.role === 'assistant'">
              <MarkdownText :text="msg.text" links-clickable />
              <span v-if="msg.streaming" class="msg-cursor">|</span>
            </template>
            <template v-else>{{ msg.text }}</template>
          </div>
          <div v-if="msg.type === 'text' && msg.role === 'user' && msg.delivery === 'failed'" class="msg-actions">
            <button type="button" class="msg-action" @click="emit('retry-message', msg)">放回输入框</button>
            <button type="button" class="msg-action" @click="copyMessage(msg)">{{ copiedId === msg.id ? '已复制' : '复制' }}</button>
          </div>
        </div>
        <div v-if="filteredMessages.length === 0" class="msg-empty">
          <div class="msg-empty-title">{{ hasHistoryFilter ? '没有匹配的记录' : '暂无消息记录' }}</div>
          <div v-if="!hasHistoryFilter" class="msg-empty-hint">双击桌宠唤出输入框<br />或点击侧边麦克风开启语音</div>
        </div>
      </div>
      <button v-if="unseenCount > 0" type="button" class="history-unseen" @click="jumpToLatest">
        有新消息 · {{ unseenCount }}
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { isHistoryMessage, type ChatMessage, type MessageSource, type TaskCompletionSource, type TextMessage } from '@/stores/chat'
import { deliveryLabel } from '../../shared/host-delivery'
import {
  MAX_BUBBLES,
  estimateBubbleTtl,
  planBubbleAdmission,
  type BubbleType,
} from '@/services/bubble-policy'
import { useSessionTitles } from '@/composables/useSessionTitles'
import { cleanSessionTitle, UNATTRIBUTED_SESSION, UNTITLED_SESSION } from '../../shared/session-title'
import MarkdownText from './MarkdownText.vue'
import type { ChatImage } from '../../shared/chat-history-contracts'

const BUBBLE_TTL = 5000

interface FloatingBubble {
  id: string
  role: 'user' | 'assistant'
  text: string
  streaming: boolean
  type: BubbleType
  imageSrc?: string
  ttlMs?: number
}

const props = withDefaults(
  defineProps<{
    messages: ChatMessage[]
    completionSource?: TaskCompletionSource | null
    panelOpen: boolean
    displayName?: string
    popDirectionX?: 'left' | 'right'
    alignY?: 'bottom' | 'top'
    historyState?: 'loading' | 'ready' | 'error' | 'unavailable'
    historyMessage?: string
  }>(),
  {
    displayName: '',
    popDirectionX: 'left',
    alignY: 'bottom',
    historyState: 'unavailable',
    historyMessage: '',
  },
)

const emit = defineEmits<{ 'bubbles-cleared': []; close: []; 'clear-history': []; 'retry-history': []; 'export-history': []; 'retry-message': [message: TextMessage] }>()

const searchTerm = ref('')
const sourceFilter = ref('')
const historyFilter = ref<'all' | 'failed'>('all')
const hasHistoryFilter = computed(() => !!(searchTerm.value.trim() || sourceFilter.value || historyFilter.value !== 'all'))
const clearConfirm = ref(false)
const copiedId = ref('')
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function copyMessage(message: TextMessage): Promise<void> {
  let copied = false
  try {
    await navigator.clipboard.writeText(message.text)
    copied = true
  } catch {
    /* 窗口未聚焦时回退到 execCommand */
  }
  if (!copied) {
    try {
      const area = document.createElement('textarea')
      area.value = message.text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      copied = document.execCommand('copy')
      area.remove()
    } catch {
      copied = false
    }
  }
  if (!copied) return
  copiedId.value = message.id
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => { copiedId.value = '' }, 1500)
}

onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})
const filteredMessages = computed(() => {
  const term = searchTerm.value.trim().toLocaleLowerCase()
  return props.messages.filter(message => {
    if (message.type === 'status' || message.type === 'completion') return false
    if (sourceFilter.value && (!isHistoryMessage(message) || sourceKey(message) !== sourceFilter.value)) return false
    if (historyFilter.value === 'failed' && (message.type !== 'text' || message.delivery !== 'failed')) return false
    const content = message.type === 'emoji' ? message.description : message.text
    const source = isHistoryMessage(message) ? `${sourceTitle(message)} ${message.sessionId || ''}` : ''
    return `${content} ${source}`.toLocaleLowerCase().includes(term)
  })
})

/** 记录最多 1000 条；一次只渲染最近的若干条，往上翻时再追加。 */
const RENDER_STEP = 120
const renderLimit = ref(RENDER_STEP)
const visibleMessages = computed(() => {
  const list = filteredMessages.value
  return list.length > renderLimit.value ? list.slice(-renderLimit.value) : list
})
const hiddenCount = computed(() => Math.max(0, filteredMessages.value.length - visibleMessages.value.length))
watch([searchTerm, sourceFilter, historyFilter], () => {
  renderLimit.value = RENDER_STEP
})
const HOST_LABELS: Record<string, string> = {
  codex: 'Codex',
  'deepseek-harness': 'DeepSeek Harness',
  harness: 'DeepSeek Harness',
  qoder: 'Qoder',
  antigravity: 'Antigravity',
  'claude-code': 'Claude Code',
  zcode: 'ZCode',
  opencode: 'OpenCode',
  maibot: 'MaiBot',
  astrbot: 'AstrBot',
}
function sourceLabel(message: MessageSource): string {
  if (!message.hostId || message.hostId === 'none' || message.hostId === 'standalone') return ''
  return HOST_LABELS[message.hostId] || message.hostId
}
function speakerLabel(message: ChatMessage): string {
  return props.displayName?.trim() || (isHistoryMessage(message) ? sourceLabel(message) : '') || 'Uta'
}
function sourceKey(message: MessageSource): string {
  return JSON.stringify([message.hostId || '', message.sessionId || ''])
}
const sessionTitle = useSessionTitles(() => {
  const references = props.panelOpen ? props.messages.flatMap(message =>
    isHistoryMessage(message) && message.hostId && message.sessionId
      ? [{ hostId: message.hostId, sessionId: message.sessionId }]
      : []) : []
  const source = props.completionSource
  if (source?.hostId && source.sessionId) references.push({ hostId: source.hostId, sessionId: source.sessionId })
  return references
})

const completionSourceLabel = computed(() => {
  const source = props.completionSource
  if (!source?.hostId || source.hostId === 'none') return ''
  const title = messageSessionTitle(source)
  return [sourceLabel(source), title].filter(Boolean).join(' · ')
})

function messageSessionTitle(message: MessageSource & { sessionTitle?: string }): string {
  if (!message.sessionId) return message.hostId && message.hostId !== 'none' ? UNATTRIBUTED_SESSION : ''
  const host = message.hostId || ''
  return sessionTitle(host, message.sessionId) || cleanSessionTitle(message.sessionTitle, host, message.sessionId) || UNTITLED_SESSION
}

const sourceChoices = computed(() => {
  const choices = new Map<string, string>()
  for (const message of props.messages) {
    if (!isHistoryMessage(message) || (!message.hostId && !message.sessionId)) continue
    const key = sourceKey(message)
    const title = messageSessionTitle(message)
    const context = title === UNTITLED_SESSION ? formatTime(message.timestamp) : ''
    choices.set(key, [sourceLabel(message) || '未知来源', title, context].filter(Boolean).join(' · '))
  }
  return [...choices].map(([key, label]) => ({ key, label }))
})
function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '时间未知'
}
function sourceTitle(message: MessageSource & { sessionTitle?: string }): string {
  return [sourceLabel(message) || message.hostId, messageSessionTitle(message)]
    .filter(Boolean)
    .join(' · ')
}

const floatingBubbles = ref<FloatingBubble[]>([])
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const seenMessageIds = new Set(props.messages.map((message) => message.id))

function removeBubble(id: string, notify = true): void {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  const before = floatingBubbles.value.length
  floatingBubbles.value = floatingBubbles.value.filter((bubble) => bubble.id !== id)
  if (notify && before > 0 && floatingBubbles.value.length === 0) emit('bubbles-cleared')
}

function scheduleDismiss(msgId: string, ttl = BUBBLE_TTL, replace = false): void {
  const existing = timers.get(msgId)
  if (existing) {
    if (!replace) return
    clearTimeout(existing)
  }
  const t = setTimeout(() => {
    timers.delete(msgId)
    removeBubble(msgId)
  }, ttl)
  timers.set(msgId, t)
}

function messageTtl(message: ChatMessage): number {
  if (message.type === 'text') return estimateBubbleTtl(message.text)
  if (message.type === 'status' || message.type === 'choice') return message.ttlMs ?? BUBBLE_TTL
  return BUBBLE_TTL
}

function chatImageSrc(image: ChatImage): string {
  return `data:${image.mimeType};base64,${image.base64}`
}

function toFloatingBubble(message: ChatMessage): FloatingBubble | null {
  if (message.role !== 'assistant' || message.type === 'completion') return null
  if (message.type === 'emoji') {
    return {
      id: message.id,
      role: 'assistant',
      text: message.description,
      streaming: false,
      type: 'emoji',
      imageSrc: chatImageSrc(message.image),
    }
  }
  if (message.type === 'status') {
    return {
      id: message.id,
      role: 'assistant',
      text: message.text,
      streaming: false,
      type: 'status',
      ttlMs: message.ttlMs,
    }
  }
  if (message.type === 'choice') {
    return {
      id: message.id,
      role: 'assistant',
      text: message.text,
      streaming: false,
      type: 'choice',
      ttlMs: message.ttlMs,
    }
  }
  return {
    id: message.id,
    role: 'assistant',
    text: message.text,
    streaming: message.streaming,
    type: 'text',
  }
}

function admitMessageBubble(message: ChatMessage): void {
  if ((message.type === 'text' || message.type === 'emoji') && message.restored) return
  const bubble = toFloatingBubble(message)
  if (!bubble) return
  const admission = planBubbleAdmission(floatingBubbles.value, bubble, MAX_BUBBLES)
  if (!admission.admit) return
  for (const id of admission.removeIds) removeBubble(id, false)
  floatingBubbles.value.push(bubble)
  // 流的超时由运行时看门狗负责；正在输出时不启动阅读倒计时。
  if (!bubble.streaming) scheduleDismiss(bubble.id, messageTtl(message))
}

function isAssistantText(message: ChatMessage): message is TextMessage {
  return message.type === 'text' && message.role === 'assistant'
}

/** 一次可能进来多条（状态、回复、选择），逐条按优先级准入；不再只看最后一条。 */
watch(
  // 只关心“有新消息”，流式追加正文时不再整表拼接
  () => [props.messages.length, props.messages[props.messages.length - 1]?.id] as const,
  () => {
    for (const message of props.messages) {
      if (seenMessageIds.has(message.id)) continue
      seenMessageIds.add(message.id)
      admitMessageBubble(message)
    }
    if (seenMessageIds.size > 400) {
      const currentIds = new Set(props.messages.map((message) => message.id))
      for (const id of seenMessageIds) {
        if (!currentIds.has(id)) seenMessageIds.delete(id)
      }
    }
  },
)

/** 流式回复只更新已有气泡的正文；结束时按正文长度重排停留时间。 */
watch(
  () =>
    props.messages
      .filter(isAssistantText)
      .map((message) => `${message.id}:${message.text.length}:${message.streaming}`)
      .join('|'),
  () => {
    for (const message of props.messages) {
      if (!isAssistantText(message)) continue
      const bubble = floatingBubbles.value.find((candidate) => candidate.id === message.id)
      if (!bubble) continue
      const wasStreaming = bubble.streaming
      bubble.text = message.text
      bubble.streaming = message.streaming
      if (wasStreaming && !message.streaming) {
        scheduleDismiss(message.id, estimateBubbleTtl(message.text), true)
      }
    }
  },
)

const messagesRef = ref<HTMLElement>()
/** 距离底部不足这个距离时才算“正在看最新消息”；向上翻看旧记录时不被新消息打断。 */
const STICK_TO_BOTTOM_PX = 72
const unseenCount = ref(0)
watch([searchTerm, sourceFilter, historyFilter], () => {
  unseenCount.value = 0
})
function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_PX
}
function scrollToBottom(): void {
  nextTick(() => {
    if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  })
}
function jumpToLatest(): void {
  unseenCount.value = 0
  scrollToBottom()
}
function onBodyScroll(): void {
  if (messagesRef.value && isNearBottom(messagesRef.value)) unseenCount.value = 0
}
watch(
  () => props.panelOpen,
  (open) => {
    if (!open) return
    unseenCount.value = 0
    scrollToBottom()
  },
)
watch(
  () => filteredMessages.value.length,
  (next, previous) => {
    if (!props.panelOpen || !messagesRef.value) return
    const last = filteredMessages.value[filteredMessages.value.length - 1]
    const follow = next <= previous || last?.role === 'user' || isNearBottom(messagesRef.value)
    if (follow) {
      unseenCount.value = 0
      scrollToBottom()
    } else {
      unseenCount.value += Math.max(1, next - previous)
    }
  },
)

onUnmounted(() => {
  timers.forEach((t) => clearTimeout(t))
  timers.clear()
  window.removeEventListener('keydown', onKeydown)
})

function onSearchEscape(): void {
  if (searchTerm.value) {
    searchTerm.value = ''
    return
  }
  emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.panelOpen || event.key !== 'Escape' || event.defaultPrevented) return
  const target = event.target as HTMLElement | null
  if (target?.matches('input, textarea, select') || target?.isContentEditable) return
  event.preventDefault()
  emit('close')
}

watch(
  () => props.panelOpen,
  (open) => {
    if (!open) clearConfirm.value = false
  },
)

onMounted(() => window.addEventListener('keydown', onKeydown))
</script>

<style scoped>
/* ── 位于窗口下 1/3 处的对话气泡（跟随角色水平偏移，自动换行，不遮挡脸部） ── */
.speech-bubbles-anchor {
  position: absolute;
  top: 58%;
  width: var(--stage-bubble-width, 256px);
  /* 右侧工具栏约 46px：窄窗下气泡缩窄，避免右缘被工具栏盖住 */
  max-width: calc(100vw - 92px);
  left: max(var(--stage-bubble-min-left, 8px), min(calc(50% - var(--stage-bubble-width, 256px) / 2 + var(--stage-bubble-shift-x, 0px)), calc(100% - var(--stage-bubble-width, 256px) - 60px)));
  z-index: 25;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  transition: left var(--stage-bubble-ms, 560ms) var(--spring-gentle);
}

.speech-bubble {
  max-width: 100%;
  padding: 9px 14px;
  border-radius: 14px;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.55;
  color: var(--dp-text-main);
  background: var(--dp-panel-bg);
  border: 1px solid var(--dp-border-strong);
  box-shadow: var(--dp-shadow);
  word-break: break-word;
  overflow-wrap: anywhere;
  text-align: left;
  position: relative;
}

.speech-bubble::before {
  content: '';
  position: absolute;
  top: -5px;
  left: calc(50% - 4px);
  transform: rotate(45deg);
  width: 8px;
  height: 8px;
  background: var(--dp-panel-bg);
  border-left: 1px solid var(--dp-border-strong);
  border-top: 1px solid var(--dp-border-strong);
}

.msg-cursor {
  color: var(--dp-accent-read);
}

.emoji-img {
  max-width: 150px;
  max-height: 150px;
  border-radius: 8px;
  display: block;
}

/* 状态解说气泡：比正式回复更轻，避免抢正文的视觉重量 */
.speech-bubble.status {
  padding: 6px 12px;
  font-size: 12.5px;
  font-weight: 450;
  color: var(--dp-text-sub, var(--dp-text-main));
  border-style: dashed;
  border-color: color-mix(in srgb, var(--dp-border-strong) 70%, transparent);
  opacity: 0.94;
}

.status-mark {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--dp-accent);
  vertical-align: 2px;
}

/* 需要用户选择：整块重点色，和普通回复/状态气泡拉开层级 */
.speech-bubble.choice {
  width: 100%;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: var(--dp-accent);
  border-color: var(--dp-accent);
  color: var(--dp-accent-text, #ffffff);
  font-weight: 600;
  box-shadow:
    0 14px 32px -12px var(--dp-accent-glow),
    0 0 0 4px var(--dp-accent-soft);
}

.speech-bubble.choice::before {
  background: var(--dp-accent);
  border-color: var(--dp-accent);
}

/* Reserve space above the reply stack without taking one of its bubble slots. */
.speech-bubble.completion-card {
  position: absolute;
  bottom: calc(100% + 12px);
  box-sizing: border-box;
  width: max-content;
  max-width: 100%;
  flex-direction: row;
  align-items: center;
  gap: 7px;
  padding: 7px 12px;
}

.completion-card::before {
  content: none;
}

.completion-card svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.completion-copy { min-width: 0; }

.completion-source {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 500;
}

@media (prefers-reduced-motion: reduce) {
  .completion-card.bubble-pop-enter-active,
  .completion-card.bubble-pop-leave-active {
    transition: none;
  }
}

.choice-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  opacity: 0.85;
}

.choice-label svg {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

.choice-text {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.5;
  white-space: pre-wrap;
}

/* 正在思考指示器：状态由右上角胶囊承担，气泡不再常驻 */
.bubble-pop-enter-active {
  transition:
    opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.26s cubic-bezier(0.16, 1, 0.3, 1);
  transform-origin: bottom center;
}
.bubble-pop-leave-active {
  transition:
    opacity 0.14s cubic-bezier(0.4, 0, 1, 1),
    transform 0.16s cubic-bezier(0.4, 0, 1, 1);
  transform-origin: bottom center;
}
.bubble-pop-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.93);
}
.bubble-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.96);
}

/* ── 独立消息记录伴随浮窗 ── */
.companion-window {
  position: absolute;
  width: 296px;
  max-width: calc(100vw - 24px);
  height: min(468px, calc(100vh - 52px));
  background: var(--dp-panel-bg);
  border: none;
  border-radius: 28px;
  box-shadow: var(--dp-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 66;
  color: var(--dp-text-main);
  -webkit-app-region: no-drag;
  transition: background-color 0.28s ease, color 0.28s ease, box-shadow 0.28s ease;
}

.companion-window.pop-left {
  left: 12px;
  --slide-x: 18px;
}

.companion-window.pop-right {
  right: 12px;
  --slide-x: -18px;
}

.companion-window.align-bottom {
  bottom: 36px;
}

.companion-window.align-top {
  top: 20px;
}

.companion-slide-enter-active {
  transition:
    opacity 220ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 260ms cubic-bezier(0.16, 1, 0.3, 1);
}

.companion-slide-leave-active {
  transition:
    opacity 140ms cubic-bezier(0.4, 0, 1, 1),
    transform 160ms cubic-bezier(0.4, 0, 1, 1);
}

.companion-slide-enter-from,
.companion-slide-leave-to {
  opacity: 0;
  transform: translateX(var(--slide-x, 18px)) scale(0.97);
}

.comp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 10px;
  flex-shrink: 0;
}

.history-tools { display: flex; align-items: center; gap: 6px; padding: 0 18px 6px; }
.history-filters select:last-child { flex: 0 0 auto; }
.history-search {
  min-width: 0;
  flex: 1;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--dp-border);
  border-radius: 9px;
  color: var(--dp-text-main);
  background: var(--dp-input-bg);
  font: inherit;
  font-size: 12px;
}
.history-search:focus-visible { outline: 2px solid var(--dp-accent); outline-offset: 1px; }
.history-action {
  flex-shrink: 0;
  border: 0;
  padding: 5px 7px;
  border-radius: 7px;
  background: transparent;
  color: var(--dp-accent-vivid);
  cursor: pointer;
  font-size: 11.5px;
}
.history-action:hover:not(:disabled) { background: var(--dp-card-hover); }
.history-action.is-danger { color: var(--dp-danger, #8F3A33); }
.history-action:disabled { opacity: 0.5; cursor: not-allowed; }
.history-confirm {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0 18px 6px;
  padding: 5px 6px 5px 9px;
  border-radius: 8px;
  background: var(--dp-card-bg);
  color: var(--dp-text-sub);
  font-size: 11px;
}
.history-confirm span { flex: 1; }
.history-note { display: flex; align-items: center; gap: 4px; padding: 0 18px 5px; color: var(--dp-text-sub); font-size: 10.5px; line-height: 1.35; }

.history-more {
  align-self: center;
  margin: 2px 0 8px;
  padding: 3px 10px;
  border: 1px dashed var(--dp-border-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--dp-text-sub);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}

.history-more:hover {
  border-color: var(--dp-accent-border);
  color: var(--dp-text-main);
}

.history-unseen {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 3;
  padding: 5px 12px;
  border: 1px solid var(--dp-accent-border);
  border-radius: 999px;
  background: var(--dp-panel-bg);
  color: var(--dp-accent-read);
  font: inherit;
  font-size: 11.5px;
  font-weight: 700;
  box-shadow: var(--dp-shadow);
  cursor: pointer;
}

.history-unseen:hover {
  background: var(--dp-surface-hover);
}

.comp-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--dp-text-main);
  display: flex;
  align-items: center;
  gap: 8px;
}

.comp-title-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dp-orb-grad);
  box-shadow: 0 2px 8px var(--dp-accent-glow);
}

.comp-count {
  color: var(--dp-text-sub);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 8px;
  background: var(--dp-card-bg);
}

.icon-close-btn {
  width: 30px;
  height: 30px;
  border-radius: 10px;
  border: none;
  background: var(--dp-card-bg);
  color: var(--dp-icon);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition:
    background 0.16s ease,
    color 0.16s ease,
    transform 460ms var(--spring-gentle) 45ms;
}

.icon-close-btn:hover {
  background: var(--dp-card-hover);
  color: var(--dp-text-main);
}

.icon-close-btn:active {
  transform: scale(0.92);
  transition: transform 95ms cubic-bezier(0.22, 1, 0.36, 1) 0ms;
}

.icon-close-btn svg {
  width: 14px;
  height: 14px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
}

.comp-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.comp-body::-webkit-scrollbar {
  width: 4px;
}
.comp-body::-webkit-scrollbar-thumb {
  background: var(--dp-scrollbar);
  border-radius: 999px;
}

.msg-row {
  display: flex;
  flex-direction: column;
  animation: msg-row-pop 0.24s var(--ease-out-expo);
}

@keyframes msg-row-pop {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.msg-label {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--dp-text-dim);
  margin-bottom: 4px;
  padding: 0 4px;
}
.msg-source,
.msg-delivery {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--dp-text-sub);
}
.msg-source::before,
.msg-delivery::before {
  content: '·';
  margin: 0 4px;
  opacity: 0.6;
}
.msg-session-tag {
  min-width: 0;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--dp-surface-hover);
  color: var(--dp-text-sub);
  font-size: 10px;
  font-weight: 600;
  line-height: 1.5;
}
.msg-time {
  flex-shrink: 0;
  margin-left: 6px;
  color: var(--dp-text-sub);
  font-weight: 500;
  letter-spacing: 0;
}
.msg-delivery.is-failed { color: var(--dp-danger, #8F3A33); }
.msg-delivery.is-pending { color: var(--dp-accent-vivid); }

.msg-actions {
  display: flex;
  gap: 10px;
  margin: 2px 2px 0;
}

.msg-row.user .msg-actions {
  justify-content: flex-end;
}

.msg-action {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dp-text-sub);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.msg-action:hover {
  color: var(--dp-text-main);
}

.msg-row.user {
  align-items: flex-end;
}

.msg-row.user .msg-label {
  color: var(--dp-accent-vivid);
}

.msg-row.assistant {
  align-items: flex-start;
}

.msg-bubble {
  max-width: 90%;
  padding: 9px 13px;
  border-radius: 16px;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.55;
  word-break: break-word;
  overflow-wrap: anywhere;
  color: var(--dp-text-main);
  user-select: text;
}

.msg-row.user .msg-bubble {
  background: var(--dp-accent);
  color: var(--dp-accent-text);
  border-bottom-right-radius: 5px;
  box-shadow: 0 4px 12px -2px var(--dp-accent-glow);
}

.msg-row.assistant .msg-bubble {
  background: var(--dp-card-bg);
  border: none;
  border-bottom-left-radius: 5px;
}

.msg-row.assistant .msg-bubble.choice {
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: var(--dp-accent-soft);
  border: 1px solid var(--dp-accent-border);
  border-bottom-left-radius: 5px;
  color: var(--dp-text-main);
}

.msg-bubble.choice .choice-label {
  color: var(--dp-accent-vivid);
  opacity: 1;
}

.msg-empty {
  text-align: center;
  margin-top: 42px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.msg-empty-title {
  color: var(--dp-text-main);
  font-size: 13px;
  font-weight: 600;
}

.msg-empty-hint {
  color: var(--dp-text-sub);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.65;
}
</style>
