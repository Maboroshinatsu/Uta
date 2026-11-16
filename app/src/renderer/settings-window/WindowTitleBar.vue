<template>
  <div class="uta-titlebar" @dblclick="toggleMaximize">
    <div class="titlebar-brand">
      <img src="/uta-icon.svg" class="titlebar-mark" alt="" aria-hidden="true" />
      <span class="titlebar-name">{{ title }}</span>
      <span v-if="environment" class="titlebar-env">{{ environment }}</span>
    </div>
    <div class="titlebar-controls" @dblclick.stop>
      <button
        type="button"
        class="titlebar-button"
        aria-label="最小化"
        title="最小化"
        @click="control('minimize')"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" /></svg>
      </button>
      <button
        type="button"
        class="titlebar-button"
        :aria-label="maximized ? '还原窗口' : '最大化'"
        :title="maximized ? '还原窗口' : '最大化'"
        @click="toggleMaximize"
      >
        <svg v-if="!maximized" viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="4.5" width="7" height="7" rx="1" /></svg>
        <svg v-else viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="5.5" width="7" height="7" rx="1" /><path d="M6 5.5V4a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1.5" /></svg>
      </button>
      <button
        type="button"
        class="titlebar-button is-close"
        aria-label="关闭"
        title="关闭"
        @click="control('close')"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7m0-7l-7 7" /></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

defineProps<{ title: string; environment?: string }>()

const maximized = ref(false)
let resizeTimer: ReturnType<typeof setTimeout> | null = null
let dragInitTimer: ReturnType<typeof setTimeout> | null = null

async function readState(): Promise<void> {
  const state = await window.utaAPI?.controlWindow?.('state')
  if (typeof state?.maximized === 'boolean') maximized.value = state.maximized
}

async function control(action: 'minimize' | 'toggle-maximize' | 'close'): Promise<void> {
  const result = await window.utaAPI?.controlWindow?.(action)
  if (typeof result?.maximized === 'boolean') maximized.value = result.maximized
}

async function toggleMaximize(): Promise<void> {
  await control('toggle-maximize')
}

function onResize(): void {
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    resizeTimer = null
    void readState()
  }, 140)
}

onMounted(() => {
  void readState()
  window.addEventListener?.('resize', onResize)

  // 保证初次挂载时 Chromium 立即计算并向主进程提交非客户区可拖拽矩形（-webkit-app-region: drag）
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      const bar = document?.querySelector?.('.uta-titlebar') as HTMLElement | null
      if (bar) void bar.offsetHeight
      window.requestAnimationFrame?.(() => {
        if (bar) void bar.offsetHeight
      })
    })
  }
  if (typeof window !== 'undefined') {
    dragInitTimer = setTimeout(() => {
      dragInitTimer = null
      const bar = document?.querySelector?.('.uta-titlebar') as HTMLElement | null
      if (bar) {
        bar.style.paddingRight = '0.1px'
        void bar.offsetHeight
        bar.style.paddingRight = ''
      }
    }, 80)
  }
})

onUnmounted(() => {
  window.removeEventListener?.('resize', onResize)
  if (resizeTimer) {
    clearTimeout(resizeTimer)
    resizeTimer = null
  }
  if (dragInitTimer) {
    clearTimeout(dragInitTimer)
    dragInitTimer = null
  }
})
</script>

<style scoped>
.uta-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  box-sizing: border-box;
  height: 38px;
  flex: 0 0 38px;
  padding-left: 14px;
  border-bottom: 1px solid var(--uta-separator);
  background: var(--uta-canvas);
  color: var(--uta-ink);
  -webkit-app-region: drag;
  user-select: none;
  position: relative;
  z-index: 50;
  transition:
    background-color 0.28s ease,
    color 0.28s ease,
    border-color 0.28s ease;
}

.titlebar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  -webkit-app-region: drag;
}

.titlebar-mark {
  width: 18px;
  height: 18px;
  object-fit: contain;
  display: block;
  flex-shrink: 0;
}

.titlebar-name {
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.01em;
  white-space: nowrap;
  -webkit-app-region: drag;
}

.titlebar-env {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--uta-secondary);
  letter-spacing: 0.03em;
  -webkit-app-region: drag;
}

.titlebar-controls {
  display: flex;
  align-items: stretch;
  height: 100%;
  -webkit-app-region: no-drag;
}

.titlebar-button {
  display: grid;
  place-items: center;
  width: 44px;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--uta-secondary);
  cursor: default;
}

.titlebar-button svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
}

.titlebar-button:hover {
  background: var(--uta-surface-subtle);
  color: var(--uta-ink);
}

.titlebar-button.is-close:hover {
  background: #8F3A33;
  color: #fff;
}

.titlebar-button:focus-visible {
  outline: 2px solid var(--uta-focus);
  outline-offset: -2px;
}

@media (max-width: 620px) {
  .titlebar-env {
    display: none;
  }
}
</style>
