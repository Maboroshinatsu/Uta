<template>
  <section class="settings-panel settings-import-panel" aria-label="旧偏好导入">
    <div class="panel-head">
      <div class="panel-head-copy">
        <span class="panel-kicker">数据与迁移</span>
        <h3 class="panel-title">{{ migration ? '确认日常偏好' : '旧偏好导入' }}</h3>
        <p class="panel-hint">检查当前实例留在旧页面中的公开偏好。不会读取其他实例、密钥、模型或预设，也不会删除旧记录。</p>
      </div>
    </div>
    <p v-if="disabled" class="import-message">请先保存或放弃顶部偏好草稿，再检查旧设置。</p>
    <button type="button" :disabled="disabled || busy || finished" @click="scan">{{ busy ? '处理中…' : '检查旧偏好' }}</button>
    <p v-if="message" class="import-message" :data-status="status" role="status" aria-live="polite">{{ message }}</p>
    <ul v-if="notes.length" class="import-notes"><li v-for="note in notes" :key="note">{{ note }}</li></ul>
    <button v-if="migration && blocked" type="button" :disabled="busy" @click="emit('recover')">检查待迁移偏好文件与备份</button>
    <template v-if="preview && (preview.rows.length || migration)">
      <p>当前已保存的设置默认保留；尚未设置的项目可从旧记录补入。逐项确认后再导入，写入前保留当前偏好备份。</p>
      <div v-for="row in preview.rows" :key="row.key" class="import-row">
        <label :for="`import-${row.key}`">{{ PREFERENCE_LABELS[row.key] }}<span>当前：{{ displayPreference(row.key, row.current) }}{{ row.claimed ? '' : '（默认值）' }}</span></label>
        <select :id="`import-${row.key}`" v-model="selections[row.key]" :disabled="busy || disabled">
          <option value="current">保留当前值</option>
          <option v-for="option in row.options" :key="option.sourceId" :value="option.sourceId">{{ LEGACY_SOURCE_LABELS[option.sourceId] || '旧来源' }}：{{ displayPreference(row.key, option.value) }}</option>
        </select>
      </div>
      <p v-if="preview.existingConflictCount">另有 {{ preview.existingConflictCount }} 条历史冲突记录；本次不会清除未展示的旧冲突。</p>
      <p v-if="!preview.rows.length">{{ emptySources ? '没有找到旧偏好。确认后使用下方当前值，尚未设置的项目使用默认值。' : '相同来源已处理。确认后沿用下方已保存的偏好，完成迁移。' }}</p>
      <dl v-if="migration && !preview.rows.length && currentValues" class="current-values"><template v-for="(value, key) in currentValues" :key="key"><dt>{{ PREFERENCE_LABELS[key] }}</dt><dd>{{ displayPreference(key, value) }}</dd></template></dl>
      <button type="button" class="import-primary" :disabled="disabled || busy" @click="apply">{{ migration ? '确认这些偏好并完成迁移' : '导入已确认的选择' }}</button>
      <button type="button" :disabled="busy" @click="cancel">取消</button>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import type { SettingsKey, PublicSettings } from '../../shared/settings-contracts'
import type { SettingsImportPreview } from '../../shared/settings-import-contracts'
import { collectLegacyPreferences, displayPreference, PREFERENCE_LABELS, LEGACY_SOURCE_LABELS } from './legacy-preferences'
const props = defineProps<{ disabled: boolean; migration?: boolean }>()
const emit = defineEmits<{ recover: [] }>()
const blocked = ref(false)
const finished = ref(false), emptySources = ref(false), currentValues = ref<PublicSettings | null>(null)
let sourceSnapshot = ''
const preview = ref<SettingsImportPreview | null>(null), selections = ref<Partial<Record<SettingsKey, string>>>({})
const notes = ref<string[]>([]), message = ref(''), status = ref<'idle' | 'success' | 'error'>('idle'), busy = ref(false)
let disposed = false, version = 0
async function scan() {
  if (busy.value) return
  const current = ++version
  preview.value = null; message.value = ''; status.value = 'idle'; busy.value = true
  blocked.value = false
  try {
    const collected = collectLegacyPreferences(localStorage)
    sourceSnapshot = JSON.stringify(collected.sources)
    emptySources.value = collected.sources.length === 0
    notes.value = collected.notes
    if (!collected.sources.length && !props.migration) { message.value = '未找到可导入的旧公开偏好。'; return }
    const result = await window.utaAPI?.settingsImport.preview(collected.sources)
    if (disposed || current !== version) return
    if (!result?.ok) { blocked.value = result?.error === 'store-blocked'; throw new Error('preview-failed') }
    preview.value = result.preview
    currentValues.value = result.preview.currentValues ?? null
    selections.value = Object.fromEntries(result.preview.rows.map(row => [row.key, row.claimed ? 'current' : row.options.length === 1 ? row.options[0].sourceId : 'current']))
    if (!result.preview.rows.length) message.value = '这些旧偏好已处理，无需重复导入。'
    if (result.preview.processedSources.length) notes.value.push(`有 ${result.preview.processedSources.length} 份相同旧记录已处理，已跳过。`)
  } catch { if (!disposed) { status.value = 'error'; message.value = '旧偏好预检失败，尚未切换设置来源。请检查权限后重试；若有损坏或较新版本的设置，请先保留文件并处理。' } }
  finally { if (!disposed && current === version) busy.value = false }
}
async function apply() {
  if (busy.value || !preview.value) return
  busy.value = true
  try {
    if (JSON.stringify(collectLegacyPreferences(localStorage).sources) !== sourceSnapshot) {
      preview.value = null; status.value = 'error'; message.value = '旧页面中的偏好已经变化，请重新检查后确认。'; return
    }
    const result = await window.utaAPI?.settingsImport.apply({ token: preview.value.token, selections: { ...selections.value } })
    if (disposed) return
    preview.value = null
    status.value = result?.ok ? 'success' : 'error'
    finished.value = !!(result?.ok && result.restartRequired)
    message.value = finished.value ? '偏好迁移已完成，旧记录保留。请从托盘退出 Uta 后重新打开，新设置将在重启后生效。'
      : result?.ok ? '选择已导入，旧记录保留，当前偏好备份已保留。' : result?.code === 'revision-conflict' || result?.code === 'preview-expired'
      ? '设置或预检已变化，请重新检查后再确认。' : props.migration ? '迁移未完成，尚未切换设置来源。部分偏好可能已保存；重新检查可继续，旧记录仍保留。' : '导入失败，当前偏好未被替换。请重试。'
  } catch { if (!disposed) { preview.value = null; status.value = 'error'; message.value = '导入未确认成功，请重新检查当前设置。' } }
  finally { if (!disposed) busy.value = false }
}
function cancel() {
  preview.value = null
  void window.utaAPI?.settingsImport?.cancel?.().catch(() => {})
}
onUnmounted(() => { disposed = true; version++; cancel() })
</script>

<style scoped>
.settings-import-panel { padding: 18px 20px; }
p, .import-notes { font-size: 12.5px; color: var(--uta-secondary); line-height: 1.6; }
.import-row { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(180px, 1.4fr); align-items: center; gap: 16px; padding: 13px 0; border-top: 1px solid var(--uta-separator); }
label { font-size: 13px; font-weight: 600; }
label span { display: block; color: var(--uta-secondary); font-size: 12px; font-weight: 400; margin-top: 5px; }
button, select { border: 1px solid var(--uta-input-border); border-radius: 9px; background: var(--uta-input); color: var(--uta-ink); min-height: 36px; padding: 0 13px; font: inherit; font-size: 13px; max-width: 100%; box-sizing: border-box; }
button { cursor: pointer; margin: 4px 8px 4px 0; }
button.import-primary { background: var(--uta-accent); border-color: var(--uta-accent); color: var(--uta-accent-text); font-weight: 600; }
button:disabled { opacity: .45; cursor: default; }
button:focus-visible, select:focus-visible { outline: 2px solid var(--uta-focus); outline-offset: 2px; }
.import-message[data-status="error"] { color: var(--uta-error); }
.current-values { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 14px; background: var(--uta-canvas); border-radius: 10px; font-size: 13px; }
.current-values dt { color: var(--uta-secondary); }
.current-values dd { margin: 0; text-align: right; }
@media (max-width: 760px) { .import-row { grid-template-columns: 1fr; gap: 8px; } }
</style>
