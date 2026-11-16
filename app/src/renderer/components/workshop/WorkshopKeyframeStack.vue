<!--
  WorkshopKeyframeStack: presentational vertical keyframe stack. Props: steps[], activeIndex, creating?;
  emits select(index) and add(). It reads no store state; the parent owns all workshop state and mutations.
-->
<template>
  <section class="kf-stack" aria-label="动作关键帧">
    <header class="kf-head">
      <span class="kf-kicker">KEYFRAMES · 动作分镜</span>
      <span v-if="creating" class="kf-creating">新建中</span>
    </header>

    <TransitionGroup name="kf" tag="div" class="kf-list" role="group" aria-label="动作帧列表">
      <button
        v-for="(step, index) in stack"
        :key="index"
        type="button"
        class="kf-card"
        :class="[`is-accent-${index % 6}`, { 'is-active': index === activeIndex }]"
        :aria-current="index === activeIndex ? 'step' : undefined"
        :title="stepTitle(step, index)"
        @click="emit('select', index)"
      >
        <div class="kf-card-content">
          <div class="kf-card-meta">
            <span class="kf-step-no">STEP {{ stepNumber(index) }}</span>
            <span class="kf-dot-sep" aria-hidden="true">·</span>
            <span class="kf-time">{{ formatSeconds(step.durationMs) }}</span>
            <span v-if="hasHold(step)" class="kf-hold">/ 停留 {{ formatSeconds(step.holdMs) }}</span>
          </div>
          <div class="kf-card-title">
            <span class="kf-label">{{ stepLabel(step, index) }}</span>
            <span v-if="stepBadgeSummary(step)" class="kf-badges">
              <span v-if="step.controls && step.controls.length > 0" class="kf-pill-badge is-ctrl">
                {{ step.controls.length }}部件
              </span>
              <span v-if="stepParamCount(step) > 0" class="kf-pill-badge is-param">
                {{ stepParamCount(step) }}参数
              </span>
              <span v-if="step.motion" class="kf-pill-badge is-motion">
                动作
              </span>
            </span>
          </div>
        </div>

        <div class="kf-card-side" @click.stop>
          <button
            v-if="stack.length > 1"
            type="button"
            class="kf-del-btn pressable"
            title="删除此分镜步骤"
            aria-label="删除此分镜步骤"
            @click.stop="emit('remove', index)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <span v-else-if="index === activeIndex" class="kf-active-indicator" aria-hidden="true" />
        </div>
      </button>
    </TransitionGroup>

    <p v-if="stack.length === 0" class="kf-empty">{{ emptyText }}</p>

    <button type="button" class="kf-add" @click="emit('add')">
      <span class="kf-add-mark" aria-hidden="true">+</span>
      <span>新增动作帧</span>
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type WorkshopKeyframeStep = {
  label?: string
  durationMs: number
  holdMs: number
  controls?: string[]
  parameters?: Record<string, number>
  motion?: { group: string; index?: number } | 'none'
}

const props = withDefaults(
  defineProps<{
    steps: WorkshopKeyframeStep[]
    activeIndex: number
    creating?: boolean
  }>(),
  { creating: false },
)

const emit = defineEmits<{
  (event: 'select', index: number): void
  (event: 'add'): void
  (event: 'remove', index: number): void
}>()

const stack = computed<WorkshopKeyframeStep[]>(() =>
  Array.isArray(props.steps) ? props.steps : [],
)

const emptyText = computed(() =>
  props.creating
    ? '正在新建预设，先新增一帧动作开始编排。'
    : '还没有动作帧，先新增一帧开始编排。',
)

function stepNumber(index: number): string {
  return String(index + 1).padStart(2, '0')
}

function stepLabel(step: WorkshopKeyframeStep, index: number): string {
  return step.label?.trim() || `步骤 ${index + 1}`
}

function stepParamCount(step: WorkshopKeyframeStep): number {
  return step.parameters ? Object.keys(step.parameters).length : 0
}

function stepBadgeSummary(step: WorkshopKeyframeStep): boolean {
  return (step.controls && step.controls.length > 0) || stepParamCount(step) > 0 || (!!step.motion && step.motion !== 'none')
}

function hasHold(step: WorkshopKeyframeStep): boolean {
  return Number.isFinite(step.holdMs) && step.holdMs > 0
}

function formatSeconds(ms: number): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0
  const seconds = (safeMs / 1000).toFixed(2).replace(/0$/, '')
  return `${seconds}s`
}

function metaText(step: WorkshopKeyframeStep): string {
  const controlCount = Array.isArray(step.controls) ? step.controls.length : 0
  const parameterCount =
    step.parameters && typeof step.parameters === 'object'
      ? Object.keys(step.parameters).length
      : 0
  return `${controlCount} 部件 · ${parameterCount} 参数`
}

function stepTitle(step: WorkshopKeyframeStep, index: number): string {
  const hold = hasHold(step) ? ` · 停留 ${formatSeconds(step.holdMs)}` : ''
  return `${stepLabel(step, index)} · ${formatSeconds(step.durationMs)}${hold}`
}
</script>

<style scoped>
.kf-stack {
  --kf-motion: min(var(--uta-duration-fast, 140ms), 180ms);
  --kf-ease: var(--uta-ease-out, cubic-bezier(0.22, 1, 0.36, 1));
  --kf-line: var(--uta-line, var(--uta-separator, #e5dfd3));
  --kf-paper: var(--uta-surface, #fffcf6);
  --kf-ink: var(--uta-ink, #1c2a31);
  --kf-muted: var(--uta-secondary, #647674);
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  color: var(--kf-ink);
  font-family: var(--uta-font-sans, "Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei UI", sans-serif);
}

.kf-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 0 2px;
}

.kf-kicker {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.1em;
  line-height: 1.4;
  text-transform: uppercase;
  color: var(--kf-muted);
}

.kf-creating {
  flex: none;
  padding: 2px 8px;
  border-radius: var(--uta-radius-full, 9999px);
  background: var(--uta-accent-soft, #e4eef4);
  color: var(--uta-accent-strong, var(--uta-accent, #3d6a8e));
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.5;
}

.kf-list {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

/* ==================== 6 帧循环撞色体系：温润燕麦暖沙与深海蓝（大明度反差） ==================== */
.kf-card.is-accent-0 {
  --step-bg: #21486d;
  --step-border: rgba(255, 255, 255, 0.15);
  --step-text: #ffffff;
  --step-pill: rgba(255, 255, 255, 0.22);
  --step-pill-text: #ffffff;
  --step-del-color: rgba(255, 255, 255, 0.85);
}
.kf-card.is-accent-1 {
  --step-bg: #e7d9c6;
  --step-border: #d6c5af;
  --step-text: #1c2a31;
  --step-pill: rgba(28, 42, 49, 0.1);
  --step-pill-text: #1c2a31;
  --step-del-color: rgba(28, 42, 49, 0.7);
}
.kf-card.is-accent-2 {
  --step-bg: #29537d;
  --step-border: rgba(255, 255, 255, 0.15);
  --step-text: #ffffff;
  --step-pill: rgba(255, 255, 255, 0.22);
  --step-pill-text: #ffffff;
  --step-del-color: rgba(255, 255, 255, 0.85);
}
.kf-card.is-accent-3 {
  --step-bg: #dfceb7;
  --step-border: #ceba9f;
  --step-text: #1c2a31;
  --step-pill: rgba(28, 42, 49, 0.1);
  --step-pill-text: #1c2a31;
  --step-del-color: rgba(28, 42, 49, 0.7);
}
.kf-card.is-accent-4 {
  --step-bg: #1a3c5d;
  --step-border: rgba(255, 255, 255, 0.15);
  --step-text: #ffffff;
  --step-pill: rgba(255, 255, 255, 0.22);
  --step-pill-text: #ffffff;
  --step-del-color: rgba(255, 255, 255, 0.85);
}
.kf-card.is-accent-5 {
  --step-bg: #ede0cf;
  --step-border: #dccbba;
  --step-text: #1c2a31;
  --step-pill: rgba(28, 42, 49, 0.1);
  --step-pill-text: #1c2a31;
  --step-del-color: rgba(28, 42, 49, 0.7);
}

/* 深色模式下的撞色：沉稳深海蓝与暖沙燕麦 */
:root[data-theme='dark'] .kf-card.is-accent-0 {
  --step-bg: #1b3d5c;
  --step-border: rgba(255, 255, 255, 0.18);
  --step-text: #ffffff;
  --step-pill: rgba(255, 255, 255, 0.24);
  --step-pill-text: #ffffff;
  --step-del-color: rgba(255, 255, 255, 0.85);
}
:root[data-theme='dark'] .kf-card.is-accent-1 {
  --step-bg: #dfc8ad;
  --step-border: rgba(0, 0, 0, 0.15);
  --step-text: #1c2a31;
  --step-pill: rgba(28, 42, 49, 0.12);
  --step-pill-text: #1c2a31;
  --step-del-color: rgba(28, 42, 49, 0.75);
}
:root[data-theme='dark'] .kf-card.is-accent-2 {
  --step-bg: #244a6f;
  --step-border: rgba(255, 255, 255, 0.18);
  --step-text: #ffffff;
  --step-pill: rgba(255, 255, 255, 0.24);
  --step-pill-text: #ffffff;
  --step-del-color: rgba(255, 255, 255, 0.85);
}
:root[data-theme='dark'] .kf-card.is-accent-3 {
  --step-bg: #d7bfa2;
  --step-border: rgba(0, 0, 0, 0.15);
  --step-text: #1c2a31;
  --step-pill: rgba(28, 42, 49, 0.12);
  --step-pill-text: #1c2a31;
  --step-del-color: rgba(28, 42, 49, 0.75);
}
:root[data-theme='dark'] .kf-card.is-accent-4 {
  --step-bg: #15324d;
  --step-border: rgba(255, 255, 255, 0.18);
  --step-text: #ffffff;
  --step-pill: rgba(255, 255, 255, 0.24);
  --step-pill-text: #ffffff;
  --step-del-color: rgba(255, 255, 255, 0.85);
}
:root[data-theme='dark'] .kf-card.is-accent-5 {
  --step-bg: #e6d3bc;
  --step-border: rgba(0, 0, 0, 0.15);
  --step-text: #1c2a31;
  --step-pill: rgba(28, 42, 49, 0.12);
  --step-pill-text: #1c2a31;
  --step-del-color: rgba(28, 42, 49, 0.75);
}

.kf-card {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 10px 14px;
  box-sizing: border-box;
  border: 1.5px solid var(--step-border);
  border-radius: 14px;
  background: var(--step-bg);
  color: var(--step-text);
  font: inherit;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  appearance: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition:
    background-color 0.22s ease,
    color 0.22s ease,
    border-color 0.22s ease,
    transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.22s ease;
  -webkit-tap-highlight-color: transparent;
}

.kf-card:hover:not(.is-active) {
  transform: translateY(-1px);
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.16);
  border-color: rgba(0, 0, 0, 0.2);
}

.kf-card:active {
  transform: scale(0.975);
}

.kf-card.is-active {
  background: var(--step-bg);
  border-color: transparent;
  color: var(--step-text);
  box-shadow:
    0 0 0 2.5px #ffffff,
    0 0 0 4.5px var(--step-bg),
    0 8px 24px rgba(0, 0, 0, 0.28);
  transform: translateY(-1px) scale(1.01);
}

.kf-card.is-active .kf-card-meta {
  color: inherit;
  opacity: 0.9;
}

.kf-card-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1 1 auto;
}

.kf-card-side {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  align-self: center;
}

.kf-card:focus-visible,
.kf-add:focus-visible {
  outline: 2px solid var(--uta-focus, var(--uta-accent, #3d6a8e));
  outline-offset: 2px;
}

.kf-card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
  font-weight: 600;
  color: inherit;
  opacity: 0.88;
}

.kf-step-no {
  font-family: var(--uta-font-mono, "Cascadia Code", "JetBrains Mono", "SF Mono", Consolas, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--step-pill, rgba(0, 0, 0, 0.08));
  color: var(--step-pill-text, inherit);
}

.kf-card.is-active .kf-step-no {
  background: var(--step-pill);
  color: var(--step-pill-text);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08);
}

.kf-dot-sep {
  opacity: 0.5;
}

.kf-time {
  font-family: var(--uta-font-mono, "Cascadia Code", "JetBrains Mono", "SF Mono", Consolas, ui-monospace, monospace);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.kf-hold {
  font-size: 10.5px;
  opacity: 0.85;
}

.kf-del-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent !important;
  color: var(--step-del-color, inherit);
  opacity: 0.8;
  cursor: pointer;
  transition: color 0.16s ease, transform 0.14s ease, opacity 0.16s ease;
}

.kf-card:hover .kf-del-btn {
  opacity: 1;
}

.kf-del-btn:hover {
  background: transparent !important;
  color: #ff4d4f !important;
  opacity: 1;
  transform: scale(1.22);
}

.kf-del-btn:active {
  transform: scale(0.95);
}

.kf-card.is-active .kf-del-btn {
  background: transparent !important;
  color: var(--step-del-color, inherit);
  opacity: 0.85;
}

.kf-card.is-active .kf-del-btn:hover {
  background: transparent !important;
  color: #ff4d4f !important;
  opacity: 1;
}

.kf-del-btn svg {
  width: 14px;
  height: 14px;
  stroke: currentColor;
  stroke-width: 2.4;
  stroke-linecap: round;
}

.kf-active-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.8);
}

.kf-card.is-active .kf-card-meta {
  color: inherit;
  opacity: 0.88;
}

.kf-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.kf-badges {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.kf-pill-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  line-height: 1.3;
}

.kf-pill-badge.is-ctrl {
  background: var(--dp-accent-soft, rgba(46, 117, 182, 0.18));
  color: var(--dp-accent-vivid, #58a6ff);
}

.kf-pill-badge.is-param {
  background: rgba(255, 255, 255, 0.08);
  color: var(--dp-text, #e6edf3);
}

.kf-pill-badge.is-motion {
  background: rgba(180, 100, 255, 0.16);
  color: #d2a8ff;
}

.kf-label {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kf-empty {
  margin: 0;
  padding: 13px 14px;
  border: 1px dashed var(--kf-line);
  border-radius: 14px;
  background: var(--uta-surface-subtle, #f8f5ee);
  color: var(--kf-muted);
  font-size: 11.5px;
  line-height: 1.55;
  text-align: center;
}

.kf-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  min-height: 40px;
  margin: 0;
  padding: 9px 12px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: var(--uta-sand, #e7d9c6);
  color: var(--uta-ink, #1c2a31);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.35;
  text-align: center;
  cursor: pointer;
  appearance: none;
  box-shadow: 0 1px 2px rgba(28, 42, 49, 0.04);
  transition:
    transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    background-color 0.18s ease,
    box-shadow 0.18s ease;
  -webkit-tap-highlight-color: transparent;
}

.kf-add:hover {
  filter: brightness(0.97);
  transform: translateY(-1px);
  box-shadow: 0 3px 8px rgba(28, 42, 49, 0.08);
}

.kf-add:active {
  transform: scale(0.97) translateY(0);
}

.kf-add-mark {
  flex: none;
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
  transform: translateY(-0.5px);
}

.kf-enter-active,
.kf-leave-active,
.kf-move,
.kf-marker-enter-active,
.kf-marker-leave-active {
  transition:
    opacity var(--kf-motion) var(--kf-ease),
    transform var(--kf-motion) var(--kf-ease);
}

.kf-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}

.kf-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

.kf-marker-enter-from {
  opacity: 0;
  transform: translateX(5px);
}

.kf-marker-leave-to {
  opacity: 0;
  transform: translateX(-4px);
}

@media (max-width: 360px) {
  .kf-card {
    padding: 10px 12px 11px;
    border-radius: 16px;
  }

  .kf-label {
    font-size: 13px;
  }

  .kf-timing {
    gap: 2px 6px;
  }

  .kf-add {
    border-radius: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .kf-enter-active,
  .kf-leave-active,
  .kf-move,
  .kf-marker-enter-active,
  .kf-marker-leave-active {
    transition-duration: 0.01ms !important;
  }

  .kf-enter-from,
  .kf-leave-to,
  .kf-marker-enter-from,
  .kf-marker-leave-to {
    opacity: 1;
    transform: none;
  }
}
</style>
