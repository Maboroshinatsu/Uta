<template>
  <div class="daily-todo" :class="{ 'is-compact': compact }">
    <div class="daily-todo-list">
      <div
        v-for="item in items"
        :key="item.id"
        class="daily-todo-row"
        :class="{ 'is-completed': item.status === 'completed' }"
      >
        <button
          type="button"
          class="daily-todo-check"
          :class="{ 'is-done': item.status === 'completed' }"
          :aria-label="item.status === 'completed' ? '标记为未完成' : '标记为完成'"
          :aria-pressed="item.status === 'completed'"
          :disabled="busy"
          @click="toggleItem(item)"
        >
          <svg v-if="item.status === 'completed'" viewBox="0 0 24 24">
            <path d="M4.8 12.4l4.4 4.4L19.2 6.8" />
          </svg>
        </button>

        <div class="daily-todo-body">
          <input
            v-if="editingTextId === item.id"
            v-model="editingText"
            class="daily-todo-input is-inline"
            maxlength="200"
            aria-label="编辑待办内容"
            @keydown.enter.prevent="saveText(item)"
            @keydown.esc.stop.prevent="cancelTextEdit"
          />
          <template v-else>
            <span class="daily-todo-text" :class="{ 'is-done': item.status === 'completed' }">{{ item.text }}</span>
            <div v-if="isUnhandled(item) || reminderLabel(item)" class="daily-todo-meta">
              <span v-if="isUnhandled(item)" class="daily-todo-due">到点</span>
              <span v-if="reminderLabel(item)" class="daily-todo-remind">{{ reminderLabel(item) }}</span>
            </div>
          </template>
        </div>

        <div class="daily-todo-actions">
          <template v-if="editingTextId === item.id">
            <button type="button" class="daily-todo-action" :disabled="busy" @click="saveText(item)">保存</button>
            <button type="button" class="daily-todo-action" :disabled="busy" @click="cancelTextEdit">取消</button>
          </template>
          <template v-else>
            <button
              v-if="isUnhandled(item)"
              type="button"
              class="daily-todo-action"
              :disabled="busy"
              @click="snooze(item)"
            >稍后</button>
            <button type="button" class="daily-todo-action" :disabled="busy" @click="openReminder(item)">
              {{ item.remindAt ? '改提醒' : '提醒' }}
            </button>
            <button type="button" class="daily-todo-action" :disabled="busy" @click="startTextEdit(item)">编辑</button>
            <button
              v-if="confirmId !== item.id"
              type="button"
              class="daily-todo-action is-danger"
              :disabled="busy"
              @click="requestDelete(item)"
            >删除</button>
            <template v-else>
              <button type="button" class="daily-todo-action is-danger" :disabled="busy" @click="requestDelete(item)">确认删除</button>
              <button type="button" class="daily-todo-action" :disabled="busy" @click="cancelConfirm">取消</button>
            </template>
          </template>
        </div>

        <div
          v-if="editingReminderId === item.id"
          class="daily-todo-editor"
          @keydown.esc.stop.prevent="cancelReminder"
        >
          <label class="daily-todo-field">
            <span>提醒时间</span>
            <input v-model="editingRemindAt" class="daily-todo-input" type="datetime-local" />
          </label>
          <label class="daily-todo-field">
            <span>重复</span>
            <select v-model="editingRepeat" class="daily-todo-select">
              <option value="none">只提醒一次</option>
              <option value="daily">每天这个时间</option>
            </select>
          </label>
          <label v-if="editingRepeat === 'daily'" class="daily-todo-sound">
            <input v-model="editingResetDaily" type="checkbox" />
            <span>第二天重新出现</span>
          </label>
          <div class="daily-todo-editor-actions">
            <button type="button" class="daily-todo-action is-primary" :disabled="busy" @click="saveReminder(item)">保存提醒</button>
            <button type="button" class="daily-todo-action" :disabled="busy" @click="clearReminder(item)">清除提醒</button>
            <button type="button" class="daily-todo-action" :disabled="busy" @click="cancelReminder">取消</button>
          </div>
        </div>
      </div>

      <p v-if="items.length === 0 && !state?.error" class="daily-todo-empty">还没有待办事项。添加一项待办吧。</p>
    </div>

    <form class="daily-todo-add" @submit.prevent="addItem">
      <input
        v-model="draft"
        class="daily-todo-input"
        maxlength="200"
        placeholder="添加一项待办…"
        aria-label="添加待办"
        :disabled="busy || !canEdit"
      />
      <button type="submit" class="daily-todo-add-btn" :disabled="busy || !canEdit || !draft.trim()">添加</button>
    </form>
    <div class="daily-todo-add-reminder">
      <label class="daily-todo-sound">
        <input v-model="addReminderOn" type="checkbox" />
        <span>同时设置提醒</span>
      </label>
      <template v-if="addReminderOn">
        <label class="daily-todo-field">
          <span>提醒时间</span>
          <input v-model="addRemindAt" class="daily-todo-input" type="datetime-local" />
        </label>
        <label class="daily-todo-field">
          <span>重复</span>
          <select v-model="addRepeat" class="daily-todo-select">
            <option value="none">只提醒一次</option>
            <option value="daily">每天这个时间</option>
          </select>
        </label>
        <label v-if="addRepeat === 'daily'" class="daily-todo-sound">
          <input v-model="addResetDaily" type="checkbox" />
          <span>第二天重新出现</span>
        </label>
      </template>
    </div>

    <div v-if="completedCount > 0" class="daily-todo-footer">
      <button
        type="button"
        class="daily-todo-action"
        :disabled="busy"
        @click="requestClearCompleted"
      >{{ confirmId === CLEAR_KEY ? '确认清除？' : `清除已完成（${completedCount}）` }}</button>
    </div>

    <p v-if="state?.error" class="daily-todo-note" role="alert">待办文件无法读取，已停止写入；原文件不会被覆盖。请检查本机数据。</p>
    <p v-else-if="messageText" class="daily-todo-note" role="status">{{ messageText }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDailyState } from '@/composables/useDailyState'
import { useConfirmAction } from '@/composables/useConfirmAction'
import { readDraft, writeDraft } from '@/services/draft-storage'
import { dueUnhandledIds } from '@/services/daily-due'
import { hostDisplayName } from '@/services/adapters'
import type { DailyRepeat, DailyTodoItem } from '../../shared/daily-todo-contracts'

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const { state, error, available, refresh } = useDailyState()
const draft = ref(readDraft(props.compact ? 'todo-daily-compact' : 'todo-daily'))
watch(draft, value => writeDraft(props.compact ? 'todo-daily-compact' : 'todo-daily', value))
const addReminderOn = ref(false)
const addRemindAt = ref(defaultRemindAt())
const addRepeat = ref<DailyRepeat>('none')
const addResetDaily = ref(false)
const busy = ref(false)
const actionMessage = ref('')
const editingTextId = ref('')
const editingText = ref('')
const editingReminderId = ref('')
const editingRemindAt = ref('')
const editingRepeat = ref<DailyRepeat>('none')
const editingResetDaily = ref(false)

const items = computed(() => state.value?.items ?? [])
const completedCount = computed(() => items.value.filter(item => item.status === 'completed').length)
const pendingItems = computed(() => items.value.filter(item => item.status === 'pending'))
const canEdit = computed(() => available.value && !state.value?.error)
const messageText = computed(() => actionMessage.value || error.value)

const CLEAR_KEY = '__clear__'
const { armed: confirmId, arm: armConfirm, cancel: cancelConfirm } = useConfirmAction()

function requestDelete(item: DailyTodoItem): void {
  if (busy.value || !canEdit.value) return
  if (armConfirm(item.id)) void deleteItem(item)
}

function requestClearCompleted(): void {
  if (busy.value || !canEdit.value) return
  if (armConfirm(CLEAR_KEY)) void clearCompleted()
}

const dueIds = computed(() => new Set(dueUnhandledIds(state.value)))

function isUnhandled(item: DailyTodoItem): boolean {
  return dueIds.value.has(item.id)
}

onMounted(() => {
  if (!addRemindAt.value) addRemindAt.value = defaultRemindAt()
})

function defaultRemindAt(): string {
  const next = new Date(Date.now() + 60 * 60 * 1000)
  next.setMinutes(Math.ceil(next.getMinutes() / 5) * 5, 0, 0)
  return toInputValue(next.getTime())
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function toInputValue(timestamp?: number): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromInputValue(value: string): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function reminderLabel(item: DailyTodoItem): string {
  if (item.snoozedUntil !== undefined && item.snoozedUntil > Date.now()) {
    const snoozed = new Date(item.snoozedUntil)
    return `已推迟到 ${pad(snoozed.getHours())}:${pad(snoozed.getMinutes())}`
  }
  if (!item.remindAt) return ''
  const date = new Date(item.remindAt)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return item.repeat === 'daily'
    ? `每天 ${time}`
    : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`
}

async function snooze(item: DailyTodoItem): Promise<void> {
  if (busy.value || !canEdit.value) return
  busy.value = true
  actionMessage.value = ''
  try {
    const result = await window.utaAPI?.dailySnoozeItem?.({ id: item.id, minutes: 10 })
    if (!result?.ok) actionMessage.value = result?.error || '稍后提醒设置失败。'
    else await refresh()
  } catch {
    actionMessage.value = '稍后提醒设置失败。'
  } finally {
    busy.value = false
  }
}

async function addItem(): Promise<void> {
  const text = draft.value.trim()
  if (!text || busy.value || !canEdit.value) return
  const remindAt = addReminderOn.value ? fromInputValue(addRemindAt.value) : null
  const repeat: DailyRepeat = addReminderOn.value ? addRepeat.value : 'none'
  if (addReminderOn.value && remindAt === null) {
    actionMessage.value = repeat === 'daily' ? '每天重复需要设置提醒时间。' : '请选择提醒时间，或取消“同时设置提醒”。'
    return
  }
  busy.value = true
  actionMessage.value = ''
  try {
    const result = await window.utaAPI?.dailyAddItem?.({
      text,
      ...(remindAt !== null ? { remindAt } : {}),
      repeat,
      ...(repeat === 'daily' && addResetDaily.value ? { resetDaily: true } : {}),
    })
    if (!result?.ok) {
      actionMessage.value = result?.error || '日常待办添加失败。'
      return
    }
    draft.value = ''
    addReminderOn.value = false
    addRepeat.value = 'none'
    addResetDaily.value = false
    addRemindAt.value = defaultRemindAt()
    await refresh()
  } catch {
    actionMessage.value = '日常待办添加失败。'
  } finally {
    busy.value = false
  }
}

async function toggleItem(item: DailyTodoItem): Promise<void> {
  if (busy.value) return
  busy.value = true
  actionMessage.value = ''
  try {
    const result = await window.utaAPI?.dailyUpdateItem?.({
      id: item.id,
      status: item.status === 'completed' ? 'pending' : 'completed',
    })
    if (!result?.ok) actionMessage.value = result?.error || '日常待办更新失败。'
    else await refresh()
  } catch {
    actionMessage.value = '日常待办更新失败。'
  } finally {
    busy.value = false
  }
}

async function deleteItem(item: DailyTodoItem): Promise<void> {
  if (busy.value) return
  busy.value = true
  actionMessage.value = ''
  try {
    const result = await window.utaAPI?.dailyDeleteItem?.({ id: item.id })
    if (!result?.ok) actionMessage.value = result?.error || '日常待办删除失败。'
    else await refresh()
  } catch {
    actionMessage.value = '日常待办删除失败。'
  } finally {
    busy.value = false
  }
}

function startTextEdit(item: DailyTodoItem): void {
  editingTextId.value = item.id
  editingText.value = item.text
}

function cancelTextEdit(): void {
  editingTextId.value = ''
  editingText.value = ''
}

async function saveText(item: DailyTodoItem): Promise<void> {
  const text = editingText.value.trim()
  if (!text || busy.value) return
  busy.value = true
  actionMessage.value = ''
  try {
    const result = await window.utaAPI?.dailyUpdateItem?.({ id: item.id, text })
    if (!result?.ok) actionMessage.value = result?.error || '日常待办更新失败。'
    else {
      cancelTextEdit()
      await refresh()
    }
  } catch {
    actionMessage.value = '日常待办更新失败。'
  } finally {
    busy.value = false
  }
}

function openReminder(item: DailyTodoItem): void {
  editingReminderId.value = item.id
  editingRemindAt.value = item.remindAt ? toInputValue(item.remindAt) : defaultRemindAt()
  editingRepeat.value = item.repeat
  editingResetDaily.value = item.resetDaily === true
  actionMessage.value = ''
}

function cancelReminder(): void {
  editingReminderId.value = ''
  editingRemindAt.value = ''
  editingRepeat.value = 'none'
  editingResetDaily.value = false
}

async function saveReminder(item: DailyTodoItem): Promise<void> {
  if (busy.value) return
  const remindAt = fromInputValue(editingRemindAt.value)
  if (editingRepeat.value === 'daily' && remindAt === null) {
    actionMessage.value = '每天重复需要设置提醒时间。'
    return
  }
  busy.value = true
  actionMessage.value = ''
  try {
    const result = await window.utaAPI?.dailyUpdateItem?.({
      id: item.id,
      remindAt,
      repeat: editingRepeat.value,
      resetDaily: editingRepeat.value === 'daily' && editingResetDaily.value,
    })
    if (!result?.ok) actionMessage.value = result?.error || '提醒保存失败。'
    else {
      cancelReminder()
      await refresh()
    }
  } catch {
    actionMessage.value = '提醒保存失败。'
  } finally {
    busy.value = false
  }
}

async function clearReminder(item: DailyTodoItem): Promise<void> {
  if (busy.value) return
  busy.value = true
  actionMessage.value = ''
  try {
    const result = await window.utaAPI?.dailyUpdateItem?.({
      id: item.id,
      remindAt: null,
      repeat: 'none',
      resetDaily: false,
    })
    if (!result?.ok) actionMessage.value = result?.error || '提醒清除失败。'
    else {
      cancelReminder()
      await refresh()
    }
  } catch {
    actionMessage.value = '提醒清除失败。'
  } finally {
    busy.value = false
  }
}

async function clearCompleted(): Promise<void> {
  if (busy.value) return
  busy.value = true
  actionMessage.value = ''
  try {
    const result = await window.utaAPI?.dailyClearCompleted?.()
    if (!result?.ok) actionMessage.value = result?.error || '清除失败。'
    else await refresh()
  } catch {
    actionMessage.value = '清除失败。'
  } finally {
    busy.value = false
  }
}

</script>

<style scoped>
.daily-todo {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  color: var(--dp-text-main, var(--uta-ink));
  font-size: 13px;
}
.daily-todo.is-compact { font-size: 12px; }
.daily-todo-list { display: flex; flex-direction: column; }
.daily-todo-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 5px 0;
  border-top: 1px solid var(--dp-border-subtle, var(--uta-separator));
}
.daily-todo-row:first-child { border-top: 0; }
.daily-todo-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1.5px solid var(--dp-border-strong, var(--uta-input-border));
  border-radius: 6px;
  background: transparent;
  color: var(--dp-accent-text, var(--uta-on-accent, #fff));
  cursor: pointer;
  flex-shrink: 0;
}
.daily-todo-check.is-done {
  border-color: var(--dp-accent, var(--uta-accent));
  background: var(--dp-accent, var(--uta-accent));
}
.daily-todo-check svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.daily-todo-check:disabled { cursor: default; opacity: 0.55; }
.daily-todo-text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: 1.45;
}
.daily-todo-body {
  flex: 1 1 120px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.daily-todo-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.daily-todo-text.is-done {
  color: var(--dp-text-muted, var(--uta-muted));
  text-decoration: line-through;
}
.daily-todo-remind {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--dp-surface-hover, var(--uta-canvas));
  color: var(--dp-text-sub, var(--uta-secondary));
  font-size: 10.5px;
  white-space: nowrap;
}
.daily-todo-due {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--dp-accent-border, var(--uta-accent-soft));
  background: var(--dp-accent-soft, var(--uta-accent-soft));
  color: var(--dp-text-main, var(--uta-ink));
  font-size: 10.5px;
  font-weight: 600;
  white-space: nowrap;
}
.daily-todo-actions { display: flex; gap: 9px; flex-shrink: 0; }
.daily-todo-action {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dp-text-sub, var(--uta-secondary));
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.daily-todo-action:hover:not(:disabled) { color: var(--dp-accent, var(--uta-accent)); }
.daily-todo-action.is-danger:hover:not(:disabled) { color: var(--dp-danger, #8F3A33); }
.daily-todo-action.is-primary { color: var(--dp-accent, var(--uta-accent)); font-weight: 600; }
.daily-todo-action:disabled { cursor: default; opacity: 0.5; }
.daily-todo-editor {
  flex-basis: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0 4px 26px;
}
.daily-todo-field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--dp-text-sub, var(--uta-secondary));
}
.daily-todo-field span { flex-shrink: 0; }
.daily-todo-input,
.daily-todo-select {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 9px;
  border: 1px solid var(--dp-border, var(--uta-input-border));
  border-radius: 9px;
  background: var(--dp-input-bg, var(--uta-input));
  color: var(--dp-text-main, var(--uta-ink));
  font: inherit;
  font-size: 12px;
  box-sizing: border-box;
}
.daily-todo-input.is-inline { height: 28px; }
.daily-todo-input:focus-visible,
.daily-todo-select:focus-visible { outline: 2px solid var(--dp-accent, var(--uta-focus)); outline-offset: 1px; }
.daily-todo-editor-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.daily-todo-empty {
  margin: 6px 0 2px;
  color: var(--dp-text-muted, var(--uta-muted));
  font-size: 11.5px;
  line-height: 1.5;
}
.daily-todo-add { display: flex; gap: 6px; margin-top: 2px; }
.daily-todo-add-btn {
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 9px;
  background: var(--dp-accent, var(--uta-accent));
  color: var(--dp-accent-text, var(--uta-on-accent, #fff));
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}
.daily-todo-add-btn:disabled { cursor: default; opacity: 0.5; }
.daily-todo-add-reminder { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.daily-todo-add-reminder .daily-todo-field { flex: 1; min-width: 140px; }
.daily-todo-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 2px;
}
.daily-todo-sound {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--dp-text-sub, var(--uta-secondary));
  font-size: 11.5px;
  cursor: pointer;
}
.daily-todo-sound input { width: 15px; height: 15px; margin: 0; accent-color: var(--dp-accent, var(--uta-accent)); }
.daily-todo-note {
  margin: 0;
  color: var(--dp-text-sub, var(--uta-secondary));
  font-size: 11px;
  line-height: 1.45;
}
</style>
