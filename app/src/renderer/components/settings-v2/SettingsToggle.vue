<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="ariaLabel"
    :disabled="disabled"
    class="uta-toggle"
    :class="{ 'is-checked': modelValue, 'is-disabled': disabled }"
    @click="toggle"
  >
    <span class="toggle-thumb" />
  </button>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue: boolean
    disabled?: boolean
    ariaLabel?: string
  }>(),
  {
    disabled: false,
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

function toggle() {
  if (props.disabled) return
  emit('update:modelValue', !props.modelValue)
}
</script>

<style scoped>
.uta-toggle {
  flex-shrink: 0;
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 46px;
  height: 26px;
  padding: 2px;
  border: 1px solid var(--uta-separator);
  border-radius: 8px;
  background-color: var(--uta-canvas);
  cursor: pointer;
  transition:
    background-color 0.22s ease,
    border-color 0.22s ease,
    box-shadow 0.22s ease;
}

.uta-toggle.is-checked {
  background-color: var(--uta-accent);
  border-color: var(--uta-accent);
}

.uta-toggle.is-disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.toggle-thumb {
  display: block;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background-color: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18), 0 1px 1px rgba(0, 0, 0, 0.08);
  transition:
    transform 0.24s cubic-bezier(0.2, 0.9, 0.3, 1),
    width 0.16s ease,
    background-color 0.2s ease;
  transform: translateX(0);
}

.uta-toggle:active:not(.is-disabled) .toggle-thumb {
  width: 24px;
}

.uta-toggle.is-checked .toggle-thumb {
  transform: translateX(20px);
}

.uta-toggle.is-checked:active:not(.is-disabled) .toggle-thumb {
  transform: translateX(16px);
  width: 24px;
}
</style>
