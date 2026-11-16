<template>
  <svg
    class="onb-glyph"
    :width="size"
    :height="size"
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="name === 'leaf'">
      <path d="M4.6 15.4C4.6 9.6 9.2 5 15.4 5c0 6.2-4.6 10.8-10.8 10.4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
      <path d="M5.2 14.8c2.8-1.6 5.2-4 6.8-6.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </template>
    <template v-else-if="name === 'check'">
      <path d="m4.4 10.4 3.6 3.6 7.6-8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <template v-else-if="name === 'clock'">
      <circle cx="10" cy="10" r="6.4" stroke="currentColor" stroke-width="1.6" />
      <path d="M10 5.9v4.4l3 1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <template v-else-if="name === 'hand'">
      <path d="M7.1 9.8V5.9a1.1 1.1 0 0 1 2.2 0v3.4m0-2.6a1.1 1.1 0 0 1 2.2 0v2.7m0-1.6a1.1 1.1 0 0 1 2.2 0v3.9c0 3.1-1.9 5.3-4.9 5.3-1.9 0-3.1-.9-4.1-2.5l-1.3-2.2a1.2 1.2 0 0 1 1.9-1.4l1.7 1.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <template v-else-if="name === 'alert'">
      <path d="M10 3.6 17 16.1H3L10 3.6Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
      <path d="M10 8.1v3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      <circle cx="10" cy="13.8" r=".85" fill="currentColor" />
    </template>
    <template v-else-if="name === 'dash'">
      <path d="M5.2 10h9.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
    </template>
    <template v-else-if="name === 'monitor'">
      <rect x="3" y="4.4" width="14" height="9.4" rx="2" stroke="currentColor" stroke-width="1.6" />
      <path d="M7 16.8h6M10 13.8v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </template>
    <template v-else-if="name === 'chevron'">
      <path d="m8 5.2 5 4.8-5 4.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <template v-else>
      <circle cx="10" cy="10" r="6.4" stroke="currentColor" stroke-width="1.6" />
    </template>
  </svg>
</template>

<script setup lang="ts">
type GlyphName =
  | 'leaf' | 'check' | 'clock' | 'hand' | 'alert' | 'dash' | 'monitor' | 'chevron'

withDefaults(defineProps<{ name: GlyphName; size?: number }>(), { size: 16 })
</script>
