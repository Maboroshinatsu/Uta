<template>
  <div class="adapter-plugin-config">
    <div class="plugin-config-head">
      <span class="plugin-config-title">{{ manifest.name }} 设置</span>
      <span class="plugin-config-version">v{{ manifest.version }}</span>
    </div>

    <div v-for="field in manifest.settings" :key="field.key" class="plugin-field">
      <label class="plugin-field-label">{{ field.label }}</label>

      <input
        v-if="field.type === 'text' || field.type === 'password'"
        class="plugin-input"
        :type="field.type === 'password' ? 'password' : 'text'"
        :value="String(values[field.key] ?? '')"
        :placeholder="field.placeholder || ''"
        autocomplete="off"
        @input="updateText(field, $event)"
      />

      <input
        v-else-if="field.type === 'number'"
        class="plugin-input"
        type="number"
        :value="Number(values[field.key] ?? 0)"
        :min="field.min"
        :max="field.max"
        :step="field.step"
        @input="updateNumber(field, $event)"
      />

      <select
        v-else-if="field.type === 'select'"
        class="plugin-input"
        :value="String(values[field.key] ?? '')"
        @change="updateSelect(field, $event)"
      >
        <option v-for="option in field.options" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>

      <button
        v-else
        type="button"
        class="plugin-toggle pressable"
        :class="{ active: values[field.key] === true }"
        @click="updateBoolean(field)"
      >
        {{ values[field.key] === true ? '已开启' : '已关闭' }}
      </button>

      <p v-if="field.description" class="plugin-field-help">{{ field.description }}</p>
    </div>

    <div class="plugin-config-footer">
      <span v-if="baseUrlInvalid" class="plugin-warning">地址需要以 http:// 或 https:// 开头</span>
      <button type="button" class="plugin-apply pressable" @click="emit('apply')">
        应用并重新连接
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  getPluginSettings,
  isHttpBaseUrl,
  setPluginSetting,
  type PluginSettingValue,
} from '@/services/adapters/adapter-plugin-settings'
import type { AdapterPluginManifest, PluginSettingField } from '@/services/adapters/plugin-manifest'

const props = defineProps<{ manifest: AdapterPluginManifest }>()
const emit = defineEmits<{ apply: [] }>()

const values = ref<Record<string, PluginSettingValue>>({})

function reload() {
  values.value = getPluginSettings(props.manifest)
}

watch(() => props.manifest, reload, { immediate: true })

function update(field: PluginSettingField, value: PluginSettingValue) {
  setPluginSetting(props.manifest, field.key, value)
  values.value = { ...values.value, [field.key]: value }
}

function updateText(field: PluginSettingField, event: Event) {
  update(field, (event.target as HTMLInputElement).value)
}

function updateNumber(field: PluginSettingField, event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  update(field, value)
}

function updateSelect(field: PluginSettingField, event: Event) {
  update(field, (event.target as HTMLSelectElement).value)
}

function updateBoolean(field: PluginSettingField) {
  update(field, values.value[field.key] !== true)
}

const baseUrlInvalid = computed(() => {
  const raw = String(values.value[props.manifest.baseUrlSetting] ?? '').trim()
  return !!raw && !isHttpBaseUrl(raw)
})
</script>

<style scoped>
.adapter-plugin-config {
  margin-top: 10px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid var(--dp-border-strong);
  background: var(--dp-panel-bg);
}

.plugin-config-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.plugin-config-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--dp-text-main);
}

.plugin-config-version {
  font-size: 10.5px;
  color: var(--dp-text-muted);
}

.plugin-field + .plugin-field {
  margin-top: 10px;
}

.plugin-field-label {
  display: block;
  margin-bottom: 5px;
  font-size: 11.5px;
  color: var(--dp-text-sub);
}

.plugin-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--dp-border-strong);
  background: var(--dp-input-bg);
  color: var(--dp-text-main);
  font-size: 12px;
  outline: none;
}

.plugin-input:focus {
  border-color: var(--dp-accent-border);
  box-shadow: 0 0 0 2px var(--dp-accent-soft);
}

.plugin-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  padding: 7px 12px;
  border-radius: 10px;
  border: 1px solid var(--dp-border-strong);
  background: var(--dp-card-bg);
  color: var(--dp-text-sub);
  font-size: 11.5px;
  cursor: pointer;
}

.plugin-toggle.active {
  border-color: var(--dp-accent-border);
  background: var(--dp-accent-soft);
  color: var(--dp-text-main);
}

.plugin-field-help {
  margin: 5px 1px 0;
  font-size: 10.5px;
  line-height: 1.45;
  color: var(--dp-text-muted);
}

.plugin-config-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.plugin-warning {
  margin-right: auto;
  font-size: 10.5px;
  color: #ef4444;
}

.plugin-apply {
  padding: 7px 12px;
  border-radius: 11px;
  border: 1px solid var(--dp-accent-border);
  background: var(--dp-accent-soft);
  color: var(--dp-text-main);
  font-size: 11.5px;
  cursor: pointer;
}
</style>
