<template>
  <template v-for="(segment, index) in segments" :key="index">
    <a
      v-if="segment.href && linksClickable"
      class="md-link"
      :href="segment.href"
      target="_blank"
      rel="noopener noreferrer"
      @click.stop
    >{{ segment.text }}</a>
    <code v-else-if="segment.code" class="md-code-inline">{{ segment.text }}</code>
    <span
      v-else
      :class="{
        'md-strong': segment.bold,
        'md-em': segment.italic,
        'md-del': segment.strike,
        'md-link': segment.href,
      }"
    >{{ segment.text }}</span>
  </template>
</template>

<script setup lang="ts">
import type { MarkdownSegment } from '@/services/markdown'

withDefaults(
  defineProps<{
    segments: MarkdownSegment[]
    linksClickable?: boolean
  }>(),
  { linksClickable: false },
)
</script>

<style scoped>
.md-strong {
  font-weight: 700;
}

.md-em {
  font-style: italic;
}

.md-del {
  text-decoration: line-through;
  opacity: 0.8;
}

.md-link {
  color: var(--dp-accent-vivid, var(--dp-accent));
  text-decoration: underline;
  text-underline-offset: 2px;
  transition: opacity 0.16s ease, color 0.16s ease;
}

a.md-link {
  cursor: pointer;
}

a.md-link:hover {
  opacity: 0.8;
}

.md-code-inline {
  padding: 1px 5px;
  border-radius: 6px;
  background: var(--dp-surface);
  border: 1px solid var(--dp-border-subtle, rgba(0, 0, 0, 0.06));
  font-family: 'Cascadia Code', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.88em;
}
</style>
