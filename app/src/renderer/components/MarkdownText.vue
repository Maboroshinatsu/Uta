<template>
  <div class="md-root">
    <template v-for="(block, index) in blocks" :key="index">
      <pre v-if="block.type === 'code'" class="md-code"><code>{{ block.text }}</code></pre>
      <hr v-else-if="block.type === 'rule'" class="md-rule" />
      <ol v-else-if="block.type === 'list' && block.ordered" class="md-list">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <MarkdownSegments :segments="item" :links-clickable="linksClickable" />
        </li>
      </ol>
      <ul v-else-if="block.type === 'list'" class="md-list">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <MarkdownSegments :segments="item" :links-clickable="linksClickable" />
        </li>
      </ul>
      <blockquote v-else-if="block.type === 'quote'" class="md-quote">
        <MarkdownSegments :segments="block.segments" :links-clickable="linksClickable" />
      </blockquote>
      <p
        v-else-if="block.type === 'heading'"
        class="md-heading"
        :class="`md-h${block.level}`"
      >
        <MarkdownSegments :segments="block.segments" :links-clickable="linksClickable" />
      </p>
      <p v-else class="md-paragraph">
        <MarkdownSegments :segments="block.segments" :links-clickable="linksClickable" />
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MarkdownBlock } from '@/services/markdown'
import { parseMarkdown } from '@/services/markdown'
import MarkdownSegments from './MarkdownSegments.vue'

const props = withDefaults(
  defineProps<{
    text: string
    linksClickable?: boolean
  }>(),
  { linksClickable: false },
)

const blocks = computed<MarkdownBlock[]>(() => parseMarkdown(props.text))
</script>

<style scoped>
.md-root {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  white-space: pre-wrap;
}

.md-paragraph,
.md-heading,
.md-quote {
  margin: 0;
}

.md-heading {
  font-weight: 700;
}

.md-h1 {
  font-size: 1.12em;
}

.md-h2 {
  font-size: 1.06em;
}

.md-h3 {
  font-size: 1em;
}

.md-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding-left: 16px;
}

.md-code {
  max-height: 180px;
  margin: 2px 0;
  padding: 6px 10px;
  overflow-y: auto;
  border-radius: 8px;
  background: var(--dp-surface);
  border: 1px solid var(--dp-border-subtle, var(--dp-border));
  font-family: 'Cascadia Code', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.86em;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  scrollbar-width: thin;
  scrollbar-color: var(--dp-scrollbar) transparent;
}

.md-code code {
  font: inherit;
}

.md-rule {
  width: 100%;
  margin: 4px 0;
  border: 0;
  border-top: 1px solid var(--dp-border);
}

.md-quote {
  padding: 4px 10px;
  margin: 2px 0;
  border-left: 3px solid var(--dp-accent-border);
  border-radius: 0 8px 8px 0;
  background: var(--dp-accent-soft);
  color: var(--dp-text-sub);
}
</style>
