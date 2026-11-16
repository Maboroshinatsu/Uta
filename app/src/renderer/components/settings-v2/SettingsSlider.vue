<template>
  <div class="uta-slider-container" :class="{ 'is-disabled': disabled }">
    <input
      type="range"
      :id="id"
      :value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      class="uta-slider"
      @input="handleInput"
    />
    <div class="slider-val-badge">
      <span>{{ modelValue }}</span>
      <span v-if="unit" class="unit">{{ unit }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue: number
    id?: string
    min?: number
    max?: number
    step?: number
    disabled?: boolean
    unit?: string
  }>(),
  {
    min: 0,
    max: 100,
    step: 1,
    disabled: false,
    unit: '',
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void
}>()

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', Number(target.value))
}
</script>

<style scoped>
.uta-slider-container {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  max-width: 300px;
}

.uta-slider-container.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.uta-slider {
  flex: 1;
  height: 6px;
  border-radius: var(--uta-radius-full);
  background: var(--uta-separator);
  outline: none;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
}

.uta-slider:disabled {
  cursor: not-allowed;
}

.uta-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: var(--uta-radius-full);
  background: #FFFFFF;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  transition: transform var(--uta-transition-fast), box-shadow var(--uta-transition-fast);
}

.uta-slider::-webkit-slider-thumb:hover {
  transform: scale(1.1);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2);
}

.uta-slider:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 3px var(--uta-focus-ring);
}

.slider-val-badge {
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  min-width: 46px;
  padding: 3px 8px;
  background-color: var(--uta-input);
  border-radius: var(--uta-radius-sm);
  color: var(--uta-ink);
  font-family: var(--uta-font-mono);
  font-size: 13px;
  font-weight: 600;
}

.unit {
  font-size: 11px;
  margin-left: 2px;
  color: var(--uta-secondary);
}
</style>
