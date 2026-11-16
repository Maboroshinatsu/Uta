<script setup lang="ts">
import DeskpetStage from './components/DeskpetStage.vue'
</script>

<template>
  <DeskpetStage />
</template>

<style>
:root,
:root[data-theme='light'] {
  color-scheme: light;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-expo: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.76, 0, 0.24, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
  --spring-snappy: linear(0, 0.45 8%, 0.91 19%, 1.06 30%, 1.02 44%, 0.995 62%, 1);
  --spring-bouncy: linear(0, 0.39 7%, 0.89 17%, 1.13 27%, 1.05 38%, 0.97 52%, 1.01 68%, 1);
  --spring-gentle: linear(0, 0.34 8%, 0.82 20%, 1.04 33%, 1.01 50%, 1);

  --dp-accent: #3D6A8E;
  --dp-accent-rgb: 61, 106, 142;
  --dp-accent-soft: rgba(var(--dp-accent-rgb), 0.13);
  --dp-accent-fill: rgba(var(--dp-accent-rgb), 0.22);
  --dp-accent-border: rgba(var(--dp-accent-rgb), 0.35);
  --dp-accent-glow: rgba(var(--dp-accent-rgb), 0.28);
  --dp-orb-grad: linear-gradient(135deg, var(--dp-accent) 0%, rgba(var(--dp-accent-rgb), 0.55) 100%);
  --dp-clay: #D9C5AC;

  /* Porcelain & Oat (Day Mode) */
  --dp-panel-bg: #FFFCF6;
  --dp-bg: #FFFCF6;
  --dp-bg-elevated: #F7F3EA;
  --dp-card-bg: #F7F3EA;
  --dp-surface: #F7F3EA;
  --dp-card-hover: #EFE9DD;
  --dp-surface-hover: #EFE9DD;
  --dp-pill-inner: rgba(255, 255, 255, 0.8);
  --dp-input-bg: rgba(255, 255, 255, 0.82);
  --dp-border: rgba(28, 42, 49, 0.08);
  --dp-border-subtle: rgba(28, 42, 49, 0.05);
  --dp-border-strong: rgba(28, 42, 49, 0.16);
  --dp-text-main: #1C2A31;
  --dp-text-primary: #1C2A31;
  --dp-text-sub: #566863;
  --dp-text-secondary: #566863;
  --dp-text-dim: #596A67;
  --dp-text-muted: #596A67;
  --dp-accent-vivid: var(--dp-accent);
  --dp-accent-text: #ffffff;
  --dp-accent-read: var(--dp-accent);
  --dp-danger: #8F3A33;
  --dp-icon: #1C2A31;
  --dp-icon-muted: #647674;
  --dp-bubble-bg: rgba(255, 252, 246, 0.96);
  --dp-bubble-text: #1C2A31;
  --dp-shadow:
    0 26px 60px -12px rgba(24, 48, 28, 0.16),
    0 6px 20px -4px rgba(24, 48, 28, 0.08),
    0 0 0 1px rgba(23, 43, 26, 0.06);
  --dp-dock-bg: rgba(255, 255, 255, 0.92);
  --dp-scrollbar: rgba(23, 43, 26, 0.16);
}

:root[data-theme='dark'] {
  color-scheme: dark;
  /* Clean Deep Matte Dark Mode (no muddy sRGB green mixing) */
  --dp-accent-soft: rgba(var(--dp-accent-rgb), 0.22);
  --dp-accent-fill: rgba(var(--dp-accent-rgb), 0.32);
  --dp-accent-border: rgba(var(--dp-accent-rgb), 0.48);
  --dp-accent-glow: rgba(var(--dp-accent-rgb), 0.34);
  --dp-accent-read: color-mix(in srgb, var(--dp-accent) 55%, #ffffff);
  --dp-danger: #F0A69C;

  --dp-panel-bg: #161D21;
  --dp-bg: #161D21;
  --dp-bg-elevated: #202A2F;
  --dp-card-bg: #202A2F;
  --dp-surface: #202A2F;
  --dp-card-hover: #2A353A;
  --dp-surface-hover: #2A353A;
  --dp-pill-inner: #2b2f33;
  --dp-input-bg: #121415;
  --dp-border: rgba(255, 255, 255, 0.07);
  --dp-border-subtle: rgba(255, 255, 255, 0.05);
  --dp-border-strong: rgba(255, 255, 255, 0.12);
  --dp-text-main: #F3EFE6;
  --dp-text-primary: #F3EFE6;
  --dp-text-sub: #A9B7B4;
  --dp-text-secondary: #A9B7B4;
  --dp-text-dim: #8E9D9A;
  --dp-text-muted: #8E9D9A;
  --dp-accent-vivid: var(--dp-accent, var(--uta-accent, #7FA9C9));
  --dp-accent-text: #ffffff;
  --dp-icon: #F3EFE6;
  --dp-icon-muted: #A9B7B4;
  --dp-bubble-bg: rgba(22, 29, 33, 0.96);
  --dp-bubble-text: #F3EFE6;
  --dp-shadow:
    0 28px 64px -12px rgba(0, 0, 0, 0.62),
    0 0 0 1px rgba(255, 255, 255, 0.07) inset;
  --dp-dock-bg: rgba(22, 29, 33, 0.92);
  --dp-scrollbar: rgba(255, 255, 255, 0.18);
}

html, body {
  background: transparent !important;
  margin: 0;
  padding: 0;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
</style>
