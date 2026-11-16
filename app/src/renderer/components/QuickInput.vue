<template>
  <Transition name="input-fade">
    <div v-if="visible" class="quick-input" @mousedown.stop @dblclick.stop @contextmenu.stop.prevent>
      <div class="input-content">
        <div v-if="target" class="input-target" :title="target" role="status">发送到 {{ target }}</div>
        <textarea
          ref="inputRef"
          :value="modelValue"
          class="input-field"
          placeholder="输入消息…"
          aria-label="输入消息"
          rows="1"
          @input="autoResize"
          @keydown.enter="onEnter"
          @keydown.esc.prevent="emit('close')"
          @blur="onBlur"
        />
        <div v-if="hint || showCounter" class="input-hint" role="status">
          <span>{{ hint }}</span>
          <span v-if="showCounter && maxChars" :class="{ 'is-over': modelValue.trim().length > maxChars }">{{ modelValue.trim().length }}/{{ maxChars }}</span>
        </div>
      </div>
      <button class="close-btn" type="button" title="收起（草稿会保留）" aria-label="收起输入框" @mousedown.prevent @click="emit('close')">
        <svg viewBox="0 0 24 24">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <button class="send-btn" :disabled="!canSubmit" @mousedown.prevent @click="emit('submit')" aria-label="发送" :title="canSubmit ? '发送' : hint">
        <svg viewBox="0 0 24 24">
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  modelValue: string
  hint?: string
  target?: string
  disabled?: boolean
  maxChars?: number
}>()

const canSubmit = computed(() => !props.disabled && !!props.modelValue.trim() &&
  (!props.maxChars || props.modelValue.trim().length <= props.maxChars))
const showCounter = computed(() => !!props.maxChars && props.modelValue.trim().length > 0)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  blur: []
  close: []
}>()

const inputRef = ref<HTMLTextAreaElement>()

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) return
    await nextTick()
    const el = inputRef.value
    if (el) {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
      el.focus()
    }
  },
)

watch(
  () => props.modelValue,
  async () => {
    await nextTick()
    const el = inputRef.value
    if (el) {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
  },
)

function autoResize(event: Event) {
  const el = event.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
  emit('update:modelValue', el.value)
}

function onEnter(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.shiftKey) return
  event.preventDefault()
  if (canSubmit.value) emit('submit')
}

function onBlur() {
  if (!props.modelValue.trim()) {
    emit('blur')
  }
}
</script>

<style scoped>
.quick-input {
  position: absolute;
  bottom: 42px;
  width: 320px;
  max-width: calc(100vw - 24px);
  /* 窄窗下宽度被 max-width 收窄，left 仍按 320px 中点算会把左缘推到屏外 */
  left: max(12px, calc(50% - 160px + var(--stage-shift-x, 0px)));
  z-index: 70;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px 9px 16px;
  border-radius: 16px;
  background: var(--dp-panel-bg);
  border: 1px solid var(--dp-border-strong);
  box-shadow: var(--dp-shadow);
  transition:
    left 0.56s var(--spring-gentle),
    border-color 0.18s ease,
    box-shadow 0.18s ease;
  -webkit-app-region: no-drag;
}

.quick-input:focus-within {
  border-color: var(--dp-accent-border);
  box-shadow:
    0 0 0 2px var(--dp-accent-soft),
    var(--dp-shadow);
}

.input-content {
  flex: 1;
  min-width: 0;
}

.input-target {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  color: var(--dp-text-sub);
}

.input-field {
  display: block;
  width: 100%;
  max-height: 112px;
  padding: 4px 0;
  border: none;
  background: transparent;
  font-size: 14.5px;
  font-weight: 500;
  font-family: inherit;
  line-height: 1.5;
  outline: none;
  color: var(--dp-text-main);
  resize: none;
  overflow-y: auto;
}

.input-hint {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 3px;
  font-size: 11px;
  line-height: 1.35;
  color: var(--dp-text-sub);
}

.input-hint .is-over { color: var(--dp-danger, #8F3A33); }

.input-field::placeholder {
  color: var(--dp-text-dim);
}

.send-btn {
  width: 34px;
  height: 34px;
  border-radius: 11px;
  border: none;
  background: var(--dp-accent);
  color: var(--dp-accent-text, #fff);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  transition:
    transform 520ms var(--spring-gentle) 55ms,
    filter 180ms ease,
    opacity 180ms ease;
}

.send-btn:hover {
  filter: brightness(1.06);
}

.send-btn:disabled { opacity: 0.45; cursor: not-allowed; filter: none; }

.close-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--dp-text-sub);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
}

.close-btn:hover {
  background: var(--dp-surface-hover);
  color: var(--dp-text-main);
}

.close-btn svg {
  width: 14px;
  height: 14px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
}

.send-btn:active {
  transform: translateY(1px) scale(0.94);
  transition: transform 105ms cubic-bezier(0.22, 1, 0.36, 1) 0ms;
}

.send-btn svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2.1;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.input-fade-enter-active {
  transition:
    opacity 0.2s var(--ease-out-expo),
    transform 0.24s var(--ease-out-expo);
}
.input-fade-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}
.input-fade-enter-from,
.input-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
