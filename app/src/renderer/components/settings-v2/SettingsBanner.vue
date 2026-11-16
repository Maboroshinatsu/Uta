<template>
  <div
    class="uta-banner"
    :class="[`variant-${variant}`]"
    role="status"
  >
    <div class="banner-icon-mark" aria-hidden="true">
      <span v-if="variant === 'info'">ℹ</span>
      <span v-else-if="variant === 'success'">✓</span>
      <span v-else-if="variant === 'warning'">⚠</span>
      <span v-else-if="variant === 'error'">✕</span>
    </div>

    <div class="banner-body">
      <div v-if="title" class="banner-title">{{ title }}</div>
      <div class="banner-message">
        <slot>{{ message }}</slot>
      </div>
    </div>

    <div v-if="$slots.actions" class="banner-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'info' | 'success' | 'warning' | 'error'
    title?: string
    message?: string
  }>(),
  {
    variant: 'info',
  }
)
</script>

<style scoped>
.uta-banner {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 18px;
  border-radius: var(--uta-radius-md);
  border: 1px solid transparent;
  font-size: 13px;
  line-height: 1.5;
  transition: all var(--uta-transition-fast);
}

.variant-info {
  background-color: var(--uta-accent-soft);
  color: var(--uta-ink);
  border-color: rgba(var(--uta-accent-rgb), 0.15);
}

.variant-info .banner-icon-mark {
  background-color: var(--uta-accent);
  color: var(--uta-accent-text);
}

.variant-success {
  background-color: var(--uta-success-bg);
  color: var(--uta-ink);
  border-color: rgba(52, 199, 89, 0.2);
}

.variant-success .banner-icon-mark {
  background-color: var(--uta-success);
  color: var(--uta-status-on);
}

.variant-warning {
  background-color: var(--uta-warning-bg);
  color: var(--uta-ink);
  border-color: rgba(255, 149, 0, 0.2);
}

.variant-warning .banner-icon-mark {
  background-color: var(--uta-warning);
  color: var(--uta-status-on);
}

.variant-error {
  background-color: var(--uta-error-bg);
  color: var(--uta-ink);
  border-color: rgba(255, 59, 48, 0.2);
}

.variant-error .banner-icon-mark {
  background-color: var(--uta-error);
  color: var(--uta-status-on);
}

.banner-icon-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--uta-radius-full);
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 1px;
}

.banner-body {
  flex: 1;
  min-width: 0;
}

.banner-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--uta-ink);
  margin-bottom: 2px;
}

.banner-message {
  font-size: 12px;
  color: var(--uta-secondary);
  line-height: 1.5;
  word-break: break-word;
}

.banner-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
