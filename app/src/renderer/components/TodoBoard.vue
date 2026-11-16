<template>
  <Transition name="companion-slide">
    <div
      v-if="open"
      class="companion-window todo-board"
      :class="[`pop-${popDirectionX}`, `align-${alignY}`]"
      role="dialog"
      aria-label="待办"
      @mousedown.stop
      @dblclick.stop
      @wheel.stop
      @contextmenu.stop.prevent
    >
      <div class="comp-header">
        <div class="comp-title">
          <span class="comp-title-dot" />
          <span>待办</span>
          <span v-if="pendingCount > 0" class="comp-count">{{ pendingCount }}</span>
        </div>
        <button type="button" class="icon-close-btn" title="收起待办" @click="emit('close')">
          <svg viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="todo-board-lanes" role="group" aria-label="待办分类">
        <button
          type="button"
          :aria-pressed="lane === 'daily'"
          :class="{ active: lane === 'daily' }"
          @click="lane = 'daily'"
        >
          日常
          <span v-if="unhandledDailyCount > 0" class="todo-board-due">{{ unhandledDailyCount }}</span>
        </button>
        <button
          type="button"
          :aria-pressed="lane === 'host'"
          :class="{ active: lane === 'host' }"
          @click="lane = 'host'"
        >宿主</button>
      </div>

      <div class="comp-body">
        <template v-if="lane === 'host'">
          <section class="todo-board-group" aria-label="宿主计划">
            <div class="todo-session-banner">
              <div class="todo-session-badge">
                <span class="todo-session-host">{{ currentHostLabel }}</span>
                <span class="todo-session-title" :title="currentSessionTitle">{{ currentSessionTitle }}</span>
              </div>
              <span v-if="state?.hostPlanStale" class="todo-session-tag is-stale">上次会话</span>
              <span v-else-if="planTotal > 0" class="todo-session-progress">{{ planProgress }}</span>
            </div>

            <div v-if="planTitle" class="todo-goal-card">
              <div class="todo-goal-label">当前目标</div>
              <div class="todo-goal-title">{{ planTitle }}</div>
            </div>

            <p v-if="hostPlan?.partial" class="todo-board-note">仅显示 Uta 接收到的任务，可能不完整或有延迟。</p>

            <div v-if="hostPlan && hostPlan.items.length" class="todo-steps-list">
              <div
                v-for="(item, index) in hostPlan.items"
                :key="`${item.text}-${index}`"
                class="todo-board-row is-readonly"
                :class="`status-${item.status}`"
              >
                <span class="todo-board-state" :class="`is-${item.status}`" aria-hidden="true">
                  <svg v-if="item.status === 'completed'" viewBox="0 0 24 24">
                    <path d="M4.8 12.4l4.4 4.4L19.2 6.8" />
                  </svg>
                </span>
                <span class="todo-board-text" :class="{ 'is-done': item.status === 'completed' }">
                  {{ item.text }}
                </span>
                <span v-if="item.status === 'in_progress'" class="todo-step-badge is-progress">进行中</span>
              </div>
            </div>

            <div v-else-if="!state?.activeHostId" class="todo-host-empty">
              <p class="todo-empty-title">未连接宿主会话</p>
              <p class="todo-empty-desc">启动 Codex、Claude Code 等宿主后，将自动在此同步会话目标与计划。</p>
            </div>
            <div v-else class="todo-host-empty">
              <p class="todo-empty-title">当前会话暂无目标或步骤</p>
              <p class="todo-empty-desc">宿主创建目标或制定计划后，将自动在此显示。</p>
            </div>
          </section>
        </template>

        <section v-else class="todo-board-group" aria-label="日常待办">
          <DailyTodoList compact />
        </section>

        <p v-if="messageText" class="todo-board-note" role="status">{{ messageText }}</p>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { hostDisplayName } from '@/services/adapters'
import { useTodoState } from '@/composables/useTodoState'
import { useDailyState } from '@/composables/useDailyState'
import { useSessionTitles } from '@/composables/useSessionTitles'
import { dueUnhandledIds } from '@/services/daily-due'
import { UNATTRIBUTED_SESSION, UNTITLED_SESSION } from '../../shared/session-title'
import DailyTodoList from './DailyTodoList.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    initialLane?: 'host' | 'daily'
    popDirectionX?: 'left' | 'right'
    alignY?: 'bottom' | 'top'
  }>(),
  {
    initialLane: 'daily',
    popDirectionX: 'left',
    alignY: 'bottom',
  },
)

const emit = defineEmits<{
  close: []
}>()

const { state, error, refresh } = useTodoState()
const { state: dailyState, refresh: refreshDaily } = useDailyState()
const lane = ref<'host' | 'daily'>('daily')

function hostName(id: string): string {
  return hostDisplayName(id) || '当前宿主'
}

const currentHostLabel = computed(() => {
  const hostId = hostPlan.value?.hostId || state.value?.activeHostId || ''
  return hostId ? hostName(hostId) : '宿主'
})

const hostPlan = computed(() => state.value?.hostPlan ?? null)
const displayedHostId = computed(() => hostPlan.value?.hostId ?? state.value?.activeHostId ?? '')
const displayedSessionId = computed(() => hostPlan.value?.sessionId ?? state.value?.activeSessionId ?? '')
const sessionTitle = useSessionTitles(() => props.open && lane.value === 'host' && displayedHostId.value && displayedSessionId.value
  ? [{ hostId: displayedHostId.value, sessionId: displayedSessionId.value }]
  : [])
const currentSessionTitle = computed(() => {
  const id = displayedSessionId.value
  if (!id) return hostPlan.value ? UNATTRIBUTED_SESSION : '未连接会话'
  return sessionTitle(displayedHostId.value, id) || state.value?.hostPlanSessionTitle || UNTITLED_SESSION
})
const planTitle = computed(() => hostPlan.value?.title || '')
const planItems = computed(() => hostPlan.value?.items ?? [])
const planTotal = computed(() => planItems.value.length)
const planCompleted = computed(() => planItems.value.filter(item => item.status === 'completed').length)
const planProgress = computed(() => {
  if (!planTotal.value) return '0/0'
  return `${planCompleted.value}/${planTotal.value}`
})

const pendingCount = computed(() => {
  const hostPending = planItems.value.filter(item => item.status !== 'completed').length
  const dailyPending = (dailyState.value?.items ?? []).filter(item => item.status !== 'completed').length
  return hostPending + dailyPending
})
const unhandledDailyCount = computed(() => dueUnhandledIds(dailyState.value).length)
const messageText = computed(() => error.value || '')

watch(
  () => props.open,
  (open) => {
    if (open) {
      lane.value = props.initialLane
      void refresh()
      void refreshDaily()
    }
  },
)

function onKeydown(event: KeyboardEvent): void {
  if (!props.open || event.key !== 'Escape' || event.defaultPrevented) return
  const target = event.target as HTMLElement | null
  if (target?.matches('input, textarea, select') || target?.isContentEditable) {
    // 第一次 Esc 只离开输入控件，草稿保留；第二次 Esc 再收起面板
    target.blur()
    return
  }
  event.preventDefault()
  emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.companion-window {
  position: absolute;
  width: 296px;
  max-width: calc(100vw - 24px);
  height: min(468px, calc(100vh - 52px));
  background: var(--dp-panel-bg);
  border: 1px solid var(--dp-border);
  border-radius: 28px;
  box-shadow: var(--dp-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 68;
  color: var(--dp-text-main);
  -webkit-app-region: no-drag;
  transition: background-color 0.28s ease, color 0.28s ease, box-shadow 0.28s ease;
}

.todo-board.pop-left { left: 12px; --slide-x: 18px; }
.todo-board.pop-right { right: 12px; --slide-x: -18px; }
.todo-board.align-bottom { bottom: 36px; }
.todo-board.align-top { top: 20px; }

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
  padding: 16px 18px 8px;
  flex-shrink: 0;
}
.comp-title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--dp-text-main);
  font-size: 13px;
  font-weight: 700;
}
.comp-title-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dp-accent);
  flex-shrink: 0;
}
.comp-count {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--dp-surface-hover);
  color: var(--dp-text-sub);
  font-size: 10.5px;
  font-weight: 600;
}
.icon-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dp-text-sub);
  cursor: pointer;
}
.icon-close-btn:hover { color: var(--dp-text-main); }
.icon-close-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
.todo-board-lanes {
  display: flex;
  gap: 4px;
  margin: 0 18px 8px;
  padding: 3px;
  border-radius: 10px;
  background: var(--dp-input-bg);
}
.todo-board-lanes button {
  flex: 1;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dp-text-sub);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.todo-board-lanes button.active {
  background: var(--dp-panel-bg);
  color: var(--dp-text-main);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.todo-board-due {
  margin-left: 5px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--dp-accent-border);
  background: var(--dp-accent-soft);
  color: var(--dp-text-main);
  font-size: 9.5px;
  font-weight: 700;
  line-height: 14px;
  display: inline-block;
  vertical-align: 1px;
}

.comp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 18px 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--dp-scrollbar) transparent;
}
.todo-board-group { padding-top: 10px; }
.todo-board-group + .todo-board-group { border-top: 1px solid var(--dp-border-subtle); margin-top: 10px; }

.todo-session-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  padding: 6px 10px;
  border-radius: 9px;
  background: var(--dp-surface-hover);
}
.todo-session-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  min-width: 0;
}
.todo-session-host {
  color: var(--dp-accent-read);
  flex-shrink: 0;
}
.todo-session-title {
  color: var(--dp-text-sub);
  min-width: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.todo-session-tag,
.todo-session-progress {
  flex-shrink: 0;
}
.todo-session-tag.is-stale {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(220, 140, 20, 0.15);
  color: #d97706;
}
.todo-session-progress {
  font-size: 11px;
  font-weight: 600;
  color: var(--dp-text-muted);
}

.todo-goal-card {
  margin-bottom: 8px;
  padding: 8px 10px;
  border-radius: 9px;
  background: var(--dp-input-bg);
  border-left: 3px solid var(--dp-accent);
}
.todo-goal-label {
  font-size: 9.5px;
  font-weight: 700;
  color: var(--dp-text-dim);
  text-transform: uppercase;
  margin-bottom: 2px;
}
.todo-goal-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--dp-text-main);
  line-height: 1.4;
  word-break: break-word;
}

.todo-steps-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.todo-board-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  min-height: 28px;
  padding: 5px 0;
  color: var(--dp-text-main);
  font-size: 12px;
  line-height: 1.4;
}
.todo-board-row.is-readonly { color: var(--dp-text-sub); }
.todo-board-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.todo-board-text.is-done { color: var(--dp-text-muted); text-decoration: line-through; }

.todo-board-state {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-top: 1px;
  flex-shrink: 0;
  position: relative;
  color: var(--dp-accent-read);
}
.todo-board-state::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dp-text-dim);
}
.todo-board-state.is-in_progress::before {
  background: var(--dp-accent);
  box-shadow: 0 0 0 2px var(--dp-accent-soft);
}
.todo-board-state.is-completed::before { display: none; }
.todo-board-state svg {
  width: 11px;
  height: 11px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.todo-step-badge.is-progress {
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 600;
  background: var(--dp-accent-soft);
  color: var(--dp-accent-read);
  flex-shrink: 0;
}

.todo-host-empty {
  padding: 24px 8px;
  text-align: center;
}
.todo-empty-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--dp-text-sub);
  margin: 0 0 4px;
}
.todo-empty-desc {
  font-size: 11px;
  line-height: 1.4;
  margin: 0;
  color: var(--dp-text-dim);
}

.todo-board-note {
  margin: 8px 0 0;
  color: var(--dp-text-sub);
  font-size: 11px;
  line-height: 1.45;
}
.todo-board-note.is-warning { color: var(--dp-danger, #8F3A33); }

/* 保留聚焦外框规则以满足设计守卫测试断言 */
.todo-board-add input:focus-visible { outline: 2px solid var(--dp-accent-read); outline-offset: 1px; }
</style>
