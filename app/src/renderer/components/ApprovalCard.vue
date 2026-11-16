<template>
  <Transition name="approval-pop">
    <div
      v-if="approval"
      ref="cardRef"
      class="approval-card"
      role="alertdialog"
      aria-label="工具执行审批"
      tabindex="-1"
      @mousedown.stop
      @dblclick.stop
      @wheel.stop
      @contextmenu.stop.prevent
    >
      <div class="approval-header">
        <div class="approval-badge-row">
          <span class="approval-pulse-dot" />
          <span class="approval-title">工具执行审批</span>
        </div>
        <span
          class="approval-host-tag"
          :title="approval.sessionId ? approvalSessionTitle : undefined"
        >
          {{ formatHostLabel(approval.host) }}<template v-if="approval.sessionId"> · {{ approvalSessionTitle }}</template>
        </span>
        <span v-if="queueLength > 1" class="approval-queue-count">待处理 {{ queueLength }}</span>
      </div>

      <p class="approval-question">
        准备执行 <strong>{{ approval.toolName }}</strong>，要批准这次操作吗？
      </p>

      <div class="approval-detail-box">
        <div class="approval-tool-row">
          <span class="approval-tool-label">工具</span>
          <code class="approval-tool-code" :title="approval.toolName">{{ approval.toolName }}</code>
        </div>
        <div v-if="approval.displayReason || approval.reason" class="approval-reason-text">
          {{ approval.displayReason || approval.reason }}
        </div>
      </div>

      <div class="approval-actions">
        <button
          type="button"
          class="approval-btn approve"
          :disabled="submitting"
          @click.stop="onDecide('allowed-once')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>批准</span>
        </button>

        <button
          type="button"
          class="approval-btn reject"
          :disabled="submitting"
          @click.stop="onDecide('rejected')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          <span>拒绝</span>
        </button>
      </div>

      <button
        type="button"
        class="approval-delegate"
        title="不在桌宠决定，转交回宿主主窗口处理"
        :disabled="submitting"
        @click.stop="onDecide('unavailable')"
      >
        不在桌宠决定，转交宿主处理
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { PendingApprovalItem } from '@/stores/deskpet'
import { useSessionTitles } from '@/composables/useSessionTitles'
import { UNTITLED_SESSION } from '../../shared/session-title'

const props = withDefaults(
  defineProps<{
    approval: PendingApprovalItem | null
    queueLength?: number
  }>(),
  {
    queueLength: 1,
  },
)

const emit = defineEmits<{
  decide: [requestId: string, decision: 'allowed-once' | 'rejected' | 'unavailable']
}>()

const submitting = ref(false)
const cardRef = ref<HTMLElement>()
const sessionTitle = useSessionTitles(() => props.approval?.sessionId
  ? [{ hostId: props.approval.host, sessionId: props.approval.sessionId }]
  : [])
const approvalSessionTitle = computed(() => {
  const approval = props.approval
  return approval?.sessionId ? sessionTitle(approval.host, approval.sessionId) || UNTITLED_SESSION : ''
})

/** 聚焦卡片本身而不是“批准”按钮，避免用户接着按 Enter/Space 时误批准。 */
function focusCard(): void {
  void nextTick(() => cardRef.value?.focus({ preventScroll: true }))
}

watch(
  () => props.approval?.requestId,
  () => {
    submitting.value = false
    focusCard()
  },
)

function onKeydown(event: KeyboardEvent): void {
  if (!props.approval) return
  const active = document.activeElement
  const inside = !!active && (cardRef.value?.contains(active) ?? false)

  if (event.key === 'Escape') {
    if (!inside || submitting.value) return
    event.preventDefault()
    event.stopPropagation()
    onDecide('unavailable')
    return
  }

  if (event.key !== 'Tab' || !inside || !cardRef.value) return
  const buttons = Array.from(cardRef.value.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
  if (buttons.length === 0) return
  event.preventDefault()
  event.stopPropagation()
  const current = buttons.indexOf(active as HTMLButtonElement)
  const next = current < 0
    ? (event.shiftKey ? buttons.length - 1 : 0)
    : (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length
  buttons[next]?.focus()
}

onMounted(() => {
  focusCard()
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

function formatHostLabel(host: string): string {
  const clean = (host || '').trim().toLowerCase()
  if (!clean) return '宿主'
  if (clean === 'deepseek-harness' || clean === 'dsh') return 'DeepSeek Harness'
  if (clean === 'codex') return 'Codex'
  if (clean === 'claude-code') return 'Claude Code'
  if (clean === 'zcode') return 'ZCode'
  if (clean === 'opencode') return 'OpenCode'
  if (clean === 'antigravity') return 'Antigravity'
  if (clean === 'qoder') return 'Qoder'
  return host
}

function onDecide(decision: 'allowed-once' | 'rejected' | 'unavailable') {
  if (!props.approval || submitting.value) return
  submitting.value = true
  emit('decide', props.approval.requestId, decision)
}
</script>

<style scoped>
/* 与消息气泡共用同一套圆角矩形：同宽、同圆角、同边框与阴影，位置也落在下 1/3 */
.approval-card {
  position: absolute;
  z-index: 82;
  top: auto;
  bottom: 12px;
  left: calc(50% - 128px + var(--stage-shift-x, 0px));
  width: 256px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 11px 14px 10px;
  border-radius: 14px;
  background: var(--dp-panel-bg);
  color: var(--dp-text-main);
  border: 1px solid var(--dp-border-strong);
  box-shadow: var(--dp-shadow);
  pointer-events: auto;
  user-select: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.approval-header {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.approval-badge-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

/* 静态光晕：审批等待期间不持续合成 */
.approval-pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dp-accent);
  box-shadow: 0 0 0 3px var(--dp-accent-soft);
  flex-shrink: 0;
}

.approval-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--dp-text-main);
  white-space: nowrap;
}

.approval-host-tag {
  margin-left: auto;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 7px;
  background: var(--dp-accent-soft);
  color: var(--dp-accent-vivid, var(--dp-accent));
  white-space: nowrap;
}

.approval-queue-count {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 7px;
  background: var(--dp-card-bg);
  color: var(--dp-text-sub);
  white-space: nowrap;
}

.approval-question {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dp-text-main);
  overflow-wrap: anywhere;
}

.approval-question strong {
  color: var(--dp-accent-vivid, var(--dp-accent));
  font-weight: 700;
  overflow-wrap: anywhere;
}

.approval-detail-box {
  background: var(--dp-card-bg);
  border: 1px solid var(--dp-border-subtle, var(--dp-border-strong));
  border-radius: 10px;
  padding: 7px 9px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.approval-tool-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.approval-tool-label {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--dp-text-sub);
  flex-shrink: 0;
}

.approval-tool-code {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  font-family: var(--uta-font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--dp-text-main);
  background: var(--dp-pill-inner);
  padding: 1px 6px;
  border-radius: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.approval-reason-text {
  font-size: 11px;
  line-height: 1.45;
  color: var(--dp-text-sub);
  max-height: 60px;
  overflow-y: auto;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.approval-actions {
  display: flex;
  align-items: center;
  gap: 7px;
}

.approval-btn {
  border: 1px solid transparent;
  border-radius: 11px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  transition:
    transform 0.16s cubic-bezier(0.16, 1, 0.3, 1),
    background 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    opacity 0.16s ease;
}

.approval-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.approval-btn:not(:disabled):active {
  transform: scale(0.94) translateY(0);
  box-shadow: none;
}

.approval-btn svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}

.approval-btn.approve {
  flex: 1.15;
  background: var(--dp-accent);
  color: var(--dp-accent-text, #ffffff);
  box-shadow: 0 4px 12px -2px var(--dp-accent-glow);
}

.approval-btn.approve:hover:not(:disabled) {
  filter: brightness(1.06);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px -2px var(--dp-accent-glow);
}

.approval-btn.reject {
  flex: 1;
  background: rgba(220, 68, 60, 0.14);
  border-color: rgba(220, 68, 60, 0.34);
  color: #d9433a;
}

:root[data-theme='dark'] .approval-btn.reject {
  background: rgba(248, 113, 113, 0.18);
  border-color: rgba(248, 113, 113, 0.38);
  color: #fca5a5;
}

.approval-btn.reject:hover:not(:disabled) {
  background: rgba(220, 68, 60, 0.22);
  transform: translateY(-1px);
}

.approval-delegate {
  align-self: center;
  border: none;
  background: none;
  padding: 2px 6px;
  font-size: 10.5px;
  font-weight: 500;
  color: var(--dp-text-dim, var(--dp-text-sub));
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
  opacity: 0.85;
  transition: opacity 0.16s ease, color 0.16s ease, transform 0.14s cubic-bezier(0.16, 1, 0.3, 1);
}

.approval-delegate:hover:not(:disabled) {
  opacity: 1;
  color: var(--dp-text-sub);
}

.approval-delegate:not(:disabled):active {
  transform: scale(0.96);
}

.approval-delegate:disabled {
  opacity: 0.45;
  cursor: default;
}

.approval-pop-enter-active {
  transition:
    opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
  transform-origin: bottom center;
}

.approval-pop-leave-active {
  transition:
    opacity 0.15s cubic-bezier(0.4, 0, 1, 1),
    transform 0.16s cubic-bezier(0.4, 0, 1, 1);
  transform-origin: bottom center;
}

.approval-pop-enter-from,
.approval-pop-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.95);
}

/* 小窗口/近方形窗口：底部紧凑排版，先保证按钮和原因完整可见 */
@media (max-height: 560px), (max-aspect-ratio: 5/4) {
  .approval-card {
    bottom: 8px;
    max-height: calc(100vh - 16px);
    padding: 8px 11px;
    gap: 5px;
    border-radius: 12px;
  }

  .approval-title {
    font-size: 11.5px;
  }

  .approval-host-tag,
  .approval-queue-count {
    font-size: 9.5px;
    padding: 1px 6px;
  }

  .approval-question {
    font-size: 12px;
    line-height: 1.4;
  }

  .approval-detail-box {
    padding: 5px 7px;
    gap: 3px;
    border-radius: 8px;
  }

  .approval-reason-text {
    max-height: 34px;
    font-size: 10.5px;
    line-height: 1.4;
  }

  .approval-actions {
    gap: 6px;
  }

  .approval-btn {
    padding: 5px 10px;
    font-size: 11.5px;
    border-radius: 9px;
  }

  .approval-delegate {
    font-size: 10px;
  }
}

/* 极矮窗口：工具信息已经在问题句里，详情只保留原因，进一步让出角色空间 */
@media (max-height: 420px) {
  .approval-tool-row {
    display: none;
  }

  .approval-reason-text {
    max-height: 30px;
  }
}
</style>
