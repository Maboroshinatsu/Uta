<template>
  <div
    class="uta-settings-row"
    :class="[
      `layout-${layout}`,
      { 'is-disabled': disabled }
    ]"
  >
    <div class="row-meta">
      <label v-if="label" class="row-label" :for="htmlFor">{{ label }}</label>
      <p v-if="description" class="row-description">{{ description }}</p>
      <p v-if="disabled && disabledReason" class="row-disabled-reason">
        {{ disabledReason }}
      </p>
      <slot name="extra" />
    </div>

    <div class="row-controls">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string
    htmlFor?: string
    description?: string
    disabledReason?: string
    disabled?: boolean
    layout?: 'row' | 'column'
  }>(),
  {
    layout: 'row',
    disabled: false,
  }
)
</script>

<style scoped>
.uta-settings-row {
  display: flex;
  padding: 16px 0;
  border-bottom: 1px solid var(--uta-separator);
  transition: opacity var(--uta-transition-fast);
}

.uta-settings-row:last-child {
  border-bottom: none;
}

.uta-settings-row.layout-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.uta-settings-row.layout-column {
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}

.uta-settings-row.is-disabled {
  opacity: 0.7;
}

.row-meta {
  flex: 1;
  min-width: 0;
}

.row-label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--uta-ink);
  line-height: 1.4;
}

.row-description {
  margin: 3px 0 0;
  font-size: 13px;
  color: var(--uta-secondary);
  line-height: 1.5;
  word-break: break-word;
}

.row-disabled-reason {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--uta-warning);
  line-height: 1.4;
}

.row-controls {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}

.uta-settings-row.layout-column .row-controls {
  width: 100%;
}
</style>
