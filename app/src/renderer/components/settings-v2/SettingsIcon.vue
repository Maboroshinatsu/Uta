<template>
  <svg
    class="uta-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="name === 'character'">
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 19.2c.7-3.3 3.2-5.2 6.5-5.2s5.8 1.9 6.5 5.2" />
      <path d="M9.4 5.2c.5-1.4 1.5-2.2 2.6-2.2s2.1.8 2.6 2.2" />
    </template>
    <template v-else-if="name === 'connections'">
      <path d="M9.4 14.6l5.2-5.2" />
      <path d="M7.1 17.9l-1.2 1.2a3.4 3.4 0 0 1-4.8-4.8l3-3a3.4 3.4 0 0 1 4.8 0" />
      <path d="M16.9 6.1l1.2-1.2a3.4 3.4 0 1 1 4.8 4.8l-3 3a3.4 3.4 0 0 1-4.8 0" />
    </template>
    <template v-else-if="name === 'todo'">
      <rect x="5" y="3.8" width="14" height="16.4" rx="3" />
      <path d="M9.4 3.8v16.4" />
      <path d="M12.6 10h3.6" />
      <path d="M12.6 14h3.6" />
    </template>
    <template v-else-if="name === 'voice'">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.8 11.5a6.2 6.2 0 0 0 12.4 0" />
      <path d="M12 17.7V21" />
    </template>
    <template v-else-if="name === 'desktop'">
      <rect x="3" y="4.5" width="18" height="12" rx="2.4" />
      <path d="M9 20h6" />
      <path d="M12 16.5V20" />
      <path d="M8.5 9.5l7 2.5-2.8 1.1-1.1 2.8z" />
    </template>
    <template v-else-if="name === 'appearance'">
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 3.8v3.1M12 17.1v3.1M3.8 12h3.1M17.1 12h3.1" />
      <path d="M12 8.1l1.2 2.7 2.7 1.2-2.7 1.2L12 15.9l-1.2-2.7L8.1 12l2.7-1.2z" />
    </template>
    <template v-else-if="name === 'about'">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 10.7v5.1" />
      <circle cx="12" cy="7.9" r=".7" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'sun'">
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 2.9v2.2M12 18.9v2.2M2.9 12h2.2M18.9 12h2.2M5.6 5.6l1.5 1.5M16.9 16.9l1.5 1.5M18.4 5.6l-1.5 1.5M7.1 16.9l-1.5 1.5" />
    </template>
    <template v-else-if="name === 'moon'">
      <path d="M19.4 14.4A7.8 7.8 0 0 1 9.6 4.6a7.8 7.8 0 1 0 9.8 9.8z" />
    </template>
    <template v-else-if="name === 'refresh'">
      <path d="M20 7.5V4m0 0h-3.5M20 4l-3 3a7 7 0 1 0 1.4 7.5" />
    </template>
    <template v-else-if="name === 'folder'">
      <path d="M3.5 7.5a2 2 0 0 1 2-2h3.2l1.8 2h8a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    </template>
    <template v-else-if="name === 'play'">
      <path d="M8.5 5.4v13.2L19 12z" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'check'">
      <path d="M4.8 12.4l4.4 4.4L19.2 6.8" />
    </template>
    <template v-else-if="name === 'chevron'">
      <path d="M9 6l6 6-6 6" />
    </template>
    <template v-else>
      <circle cx="12" cy="12" r="7.5" />
    </template>
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 })
</script>

<style scoped>
.uta-icon {
  flex-shrink: 0;
  display: block;
}
</style>
