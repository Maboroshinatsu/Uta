<template>
  <section class="settings-panel transfer-panel" aria-label="数据备份与迁移">
    <div class="panel-head">
      <div class="panel-head-copy">
        <span class="panel-kicker">数据备份</span>
        <h3 class="panel-title">备份和迁移</h3>
        <p class="panel-hint">打包公开偏好、自定义预设和模型校准。模型文件、语音密钥、连接地址与聊天记录不包含在内。</p>
      </div>
    </div>
    <div class="transfer-actions">
      <button type="button" class="uta-button is-secondary" :disabled="blocked || busy" @click="exportData">导出数据</button>
      <button type="button" class="uta-button is-secondary" :disabled="blocked || busy" @click="chooseData">选择数据文件</button>
    </div>
    <p v-if="blocked" class="settings-note">请先完成正在保存的设置或保存工坊草稿。</p>
    <p v-if="message" class="settings-note" role="status">{{ message }}</p>
    <template v-if="bundle">
      <p class="settings-note">逐项确认要恢复的偏好。自定义动作只加入新名称，不覆盖当前动作；目标角色需要先在本实例选择过一次。</p>
      <div class="transfer-list">
        <label v-for="key in settingsKeys" :key="key" class="transfer-row">
          <input v-model="selectedSettings[key]" class="transfer-check" type="checkbox" :disabled="busy" />
          <span>{{ PREFERENCE_LABELS[key] }}</span>
          <small>当前 {{ displayPreference(key, currentSettings![key]) }} → 备份 {{ displayPreference(key, bundle.settings[key]) }}</small>
        </label>
      </div>
      <div v-for="source in sourceModels" :key="source" class="transfer-model">
        <label :for="`transfer-model-${sourceModels.indexOf(source)}`">{{ modelLabel(source) }} · {{ bundle.presets[source].length }} 个自定义动作</label>
        <select
          :id="`transfer-model-${sourceModels.indexOf(source)}`"
          v-model="targets[source]"
          class="transfer-select"
          :disabled="busy"
        >
          <option value="">暂不导入这个角色的动作</option>
          <option v-for="model in models" :key="model.url" :value="model.url">{{ model.name }}</option>
        </select>
      </div>
      <label v-if="Object.keys(bundle.calibrations).length" class="transfer-row">
        <input v-model="selectedCalibrations" class="transfer-check" type="checkbox" :disabled="busy" />
        <span>模型校准</span>
        <small>导入 {{ Object.keys(bundle.calibrations).length }} 个模型版本的校准；同版本已有记录会保留。</small>
      </label>
      <p v-if="sourceModels.length" class="settings-note">更换模型时请确认动作适合目标模型，再在工坊中预览。</p>
      <div class="transfer-actions">
        <button type="button" class="uta-button is-primary" :disabled="blocked || busy || !hasSelection" @click="applyData">确认导入所选内容</button>
        <button type="button" class="uta-button is-ghost" :disabled="busy" @click="cancel">取消</button>
      </div>
    </template>
    <div class="todo-recovery">
      <h4>待办备份与恢复</h4>
      <p class="settings-note">项目和日常待办分别备份。恢复前先检查文件，确认后会保留当前原文件；聊天记录可在消息记录中单独导出。</p>
      <label class="transfer-row">
        <span>待办类型</span>
        <select v-model="todoKind" class="transfer-select" :disabled="busy" @change="todoPreview = null">
          <option value="project">项目待办</option>
          <option value="daily">日常待办</option>
        </select>
      </label>
      <div class="transfer-actions">
        <button type="button" class="uta-button is-secondary" :disabled="busy" @click="exportTodos">导出待办</button>
        <button type="button" class="uta-button is-secondary" :disabled="busy" @click="exportOriginalTodo">导出原文件</button>
        <button type="button" class="uta-button is-secondary" :disabled="busy" @click="chooseTodos">选择待办备份</button>
      </div>
      <div v-if="todoPreview" class="settings-note" role="alert">
        <p>备份包含 {{ todoPreview.count }} 项，将替换当前{{ todoKind === 'daily' ? '日常' : '项目' }}待办。如有原文件会先保留。</p>
        <div class="transfer-actions">
          <button type="button" class="uta-button is-primary" :disabled="busy" @click="restoreTodos">确认恢复</button>
          <button type="button" class="uta-button is-ghost" :disabled="busy" @click="todoPreview = null">取消</button>
        </div>
      </div>
      <p v-if="todoMessage" class="settings-note" role="status">{{ todoMessage }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { PUBLIC_SETTINGS_DEFAULTS, type PublicSettings, type SettingsKey } from '../../shared/settings-contracts'
import { sanitizePresetObject, useDeskpetStore } from '../stores/deskpet'
import { settingsClient } from '../services/settings-client'
import { PRESET_STORAGE_KEY } from '../services/preset-persistence'
import { availablePresetTargets, buildDataTransfer, parseDataTransfer, mergeDataTransferPresets, type TransferBundle } from '../services/data-transfer'
import { listAvailableModels } from '../services/live2d/model-discovery'
import { hasUnsavedDraft } from '../services/unsaved-drafts'
import { displayPreference, PREFERENCE_LABELS } from './legacy-preferences'
import type { ModelCalibration } from '../../shared/model-calibration-contracts'

const props = defineProps<{ disabled: boolean }>()
const store = useDeskpetStore()
const busy = ref(false), message = ref('')
const bundle = ref<TransferBundle | null>(null)
const currentSettings = ref<PublicSettings | null>(null)
const selectedSettings = ref<Partial<Record<SettingsKey, boolean>>>({})
const selectedCalibrations = ref(false)
const targets = ref<Record<string, string>>({})
const models = ref<ModelEntry[]>([])
const todoKind = ref<'project' | 'daily'>('project')
const todoPreview = ref<{ token: string; count: number } | null>(null)
const todoMessage = ref('')
let previewRevision: number | null = null
let previewPresetRaw: string | null = null
let previewCalibrations: Record<string, ModelCalibration[]> = {}
const blocked = computed(() => props.disabled || hasUnsavedDraft.value)
const settingsKeys = Object.keys(PUBLIC_SETTINGS_DEFAULTS) as SettingsKey[]
const sourceModels = computed(() => Object.keys(bundle.value?.presets ?? {}))
const hasSelection = computed(() => selectedCalibrations.value || Object.values(selectedSettings.value).some(Boolean) || Object.values(targets.value).some(Boolean))
function modelLabel(value: string): string {
  const known = models.value.find(model => model.url === value)
  if (known?.name) return known.name
  try { value = decodeURIComponent(value) } catch { /* keep original */ }
  const path = value
    .replace(/^uta:\/\/models\//i, '')
    .replace(/^deskpet:\/\/models\//i, '')
  return path.split(/[\\/]/).filter(Boolean).slice(-2).join(' / ') || '未知角色'
}
function cancel() { bundle.value = null; targets.value = {}; selectedSettings.value = {}; selectedCalibrations.value = false; message.value = '' }

async function exportTodos() {
  if (busy.value) return
  busy.value = true; todoMessage.value = ''; todoPreview.value = null
  try {
    let doc: unknown
    if (todoKind.value === 'daily') {
      const state = await window.utaAPI?.getDailyState?.()
      if (!state || state.error) { todoMessage.value = '日常待办无法读取，未导出。'; return }
      doc = { version: 1, items: state.items, reminderSound: state.reminderSound }
    } else {
      const state = await window.utaAPI?.getTodoState?.()
      if (!state || state.projectsError) { todoMessage.value = '项目待办无法读取，未导出。'; return }
      doc = { version: 1, projects: state.projects }
    }
    const result = await window.utaAPI?.exportSettingsTransfer?.(JSON.stringify(doc))
    if (result?.ok) todoMessage.value = '待办备份已导出，请妥善保管。'
    else if (result?.error !== 'cancelled') todoMessage.value = '导出失败。'
  } catch { todoMessage.value = '导出失败。' }
  finally { busy.value = false }
}
async function chooseTodos() {
  if (busy.value) return
  busy.value = true; todoMessage.value = ''; todoPreview.value = null
  try {
    const file = await window.utaAPI?.importSettingsTransfer?.()
    if (!file?.ok || !file.text) { if (file?.error !== 'cancelled') todoMessage.value = '无法读取备份。'; return }
    const preview = await window.utaAPI?.previewTodoRecovery?.({ kind: todoKind.value, text: file.text })
    if (!preview?.ok || !preview.token || preview.count === undefined) { todoMessage.value = '备份无效，或当前文件无法安全恢复；原文件保持不变。'; return }
    todoPreview.value = { token: preview.token, count: preview.count }
  } catch { todoMessage.value = '预检失败，原文件保持不变。' }
  finally { busy.value = false }
}
async function exportOriginalTodo() {
  if (busy.value) return
  busy.value = true; todoMessage.value = ''
  try {
    const result = await window.utaAPI?.exportTodoOriginal?.(todoKind.value)
    if (result?.ok) todoMessage.value = '原文件已导出，请妥善保管。'
    else if (result?.error !== 'cancelled') todoMessage.value = '无法导出原文件，请检查文件和保存位置。'
  } catch { todoMessage.value = '无法导出原文件。' }
  finally { busy.value = false }
}
async function restoreTodos() {
  if (busy.value || !todoPreview.value) return
  busy.value = true; todoMessage.value = ''
  try {
    const result = await window.utaAPI?.applyTodoRecovery?.(todoPreview.value.token)
    todoPreview.value = null
    todoMessage.value = result?.ok ? '待办已恢复；恢复前的原文件已保留。' : '恢复未完成，数据可能已变化，请重新选择备份。'
  } catch { todoMessage.value = '恢复未完成，请重新检查。' }
  finally { busy.value = false }
}

async function exportData() {
  if (blocked.value || busy.value) return
  busy.value = true; message.value = ''
  try {
    const settings = settingsClient.getCurrentSettings()
    const calibration = await window.utaAPI?.readModelCalibrations?.()
    if (!calibration?.ok) { message.value = '无法读取模型校准，原数据保持不变。'; return }
    const text = buildDataTransfer(settings, localStorage.getItem(PRESET_STORAGE_KEY), sanitizePresetObject, calibration.models)
    if (!text) { message.value = '无法读取完整偏好、动作或校准，原数据保持不变。'; return }
    const result = await window.utaAPI?.exportSettingsTransfer?.(text)
    if (result?.ok) message.value = '数据文件已导出。请自行保管；其中不包含模型文件和密钥。'
    else if (result?.error !== 'cancelled') message.value = '导出失败，请检查保存位置后重试。'
  } catch { message.value = '导出失败，原数据保持不变。' }
  finally { busy.value = false }
}

async function chooseData() {
  if (blocked.value || busy.value) return
  busy.value = true; message.value = ''; bundle.value = null
  try {
    const result = await window.utaAPI?.importSettingsTransfer?.()
    if (!result?.ok || !result.text) {
      if (result?.error !== 'cancelled') message.value = '无法读取数据文件，请检查文件后重试。'
      return
    }
    const parsed = parseDataTransfer(result.text, sanitizePresetObject)
    const settings = settingsClient.getCurrentSettings()
    const revision = settingsClient.getCurrentRevision()
    const raw = localStorage.getItem(PRESET_STORAGE_KEY)
    const calibration = await window.utaAPI?.readModelCalibrations?.()
    if (!parsed || !settings || revision === null || !calibration?.ok || !buildDataTransfer(settings, raw, sanitizePresetObject, calibration.models)) {
      message.value = '数据文件或当前数据无法识别，未做任何修改。'; return
    }
    const initialized = availablePresetTargets(raw, sanitizePresetObject)
    if (!initialized) { message.value = '当前动作记录无法读取，原数据保持不变。'; return }
    models.value = (await listAvailableModels(true)).filter(model => initialized.includes(model.url))
    previewRevision = revision
    previewPresetRaw = raw
    previewCalibrations = calibration.models
    currentSettings.value = settings
    selectedSettings.value = {}
    selectedCalibrations.value = false
    targets.value = Object.fromEntries(Object.keys(parsed.presets).map(key => [key, models.value.some(model => model.url === key) ? key : '']))
    bundle.value = parsed
  } catch { message.value = '预检失败，原数据保持不变。' }
  finally { busy.value = false }
}

async function applyData() {
  if (!bundle.value || !currentSettings.value || blocked.value || busy.value || !hasSelection.value) return
  busy.value = true; message.value = ''
  try {
    const latestRaw = localStorage.getItem(PRESET_STORAGE_KEY)
    if (settingsClient.getCurrentRevision() !== previewRevision || latestRaw !== previewPresetRaw) {
      bundle.value = null; message.value = '当前设置或动作已变化，请重新选择文件并检查。'; return
    }
    const merge = mergeDataTransferPresets(latestRaw, bundle.value.presets, targets.value, new Set(models.value.map(m => m.url)), sanitizePresetObject)
    if (!merge) { message.value = '动作无法安全合并，未做任何修改。'; return }
    const calibration = await window.utaAPI?.readModelCalibrations?.()
    if (!calibration?.ok || JSON.stringify(calibration.models) !== JSON.stringify(previewCalibrations)) {
      bundle.value = null; message.value = '模型校准已变化或无法读取，请重新检查。'; return
    }
    const backupText = JSON.stringify({ kind: 'uta-before-import', version: 1, settings: currentSettings.value, presetRaw: latestRaw, calibrations: previewCalibrations })
    if (!(await window.utaAPI?.backupSettingsTransfer?.(backupText))?.ok) {
      message.value = '无法创建导入前备份，未做任何修改。'; return
    }
    const afterBackup = await window.utaAPI?.readModelCalibrations?.()
    if (!afterBackup?.ok || JSON.stringify(afterBackup.models) !== JSON.stringify(previewCalibrations) ||
      settingsClient.getCurrentRevision() !== previewRevision || localStorage.getItem(PRESET_STORAGE_KEY) !== previewPresetRaw || blocked.value) {
      bundle.value = null; message.value = '数据在预检后发生变化，请重新检查。'; return
    }
    const changes: Partial<PublicSettings> = {}
    for (const key of settingsKeys) if (selectedSettings.value[key]) (changes as Record<string, unknown>)[key] = bundle.value.settings[key]
    if (Object.keys(changes).length) {
      const result = await settingsClient.patch(changes)
      if (!result.ok) { message.value = '偏好未导入，请重新检查设置后重试。'; return }
    }
    if (merge.imported) {
      // A concurrent change after the settings transaction is never overwritten.
      if (localStorage.getItem(PRESET_STORAGE_KEY) !== previewPresetRaw) {
        bundle.value = null; message.value = '偏好已导入，但动作已变化，未写入动作；导入前备份已保留。'; return
      }
      try { localStorage.setItem(PRESET_STORAGE_KEY, merge.text) }
      catch { bundle.value = null; message.value = '偏好已导入，但动作写入失败；导入前备份已保留。'; return }
      store.reloadPersistedUiState()
    }
    let calibrationText = ''
    if (selectedCalibrations.value) {
      const models = JSON.parse(JSON.stringify(bundle.value.calibrations)) as Record<string, ModelCalibration[]>
      const expected = JSON.parse(JSON.stringify(previewCalibrations)) as Record<string, ModelCalibration[]>
      const result = await window.utaAPI?.mergeModelCalibrations?.({ models, expected })
      if (!result?.ok) {
        bundle.value = null; message.value = '偏好或动作可能已导入，但校准未导入；导入前备份已保留。'; return
      }
      calibrationText = result.imported > 0
        ? `；新增 ${result.imported} 份校准，保留 ${result.skipped} 份已有校准，重新加载桌宠窗口或重新选择模型后生效`
        : `；没有新增校准，${result.skipped} 份同版本已有校准保持不变`
    }
    bundle.value = null
    message.value = `导入完成：新增 ${merge.imported} 个动作，跳过 ${merge.skipped} 个未选择或重复的动作${calibrationText}；导入前备份已保留。`
  } catch { message.value = '导入未确认完成，请检查当前设置；导入前备份已保留。' }
  finally { busy.value = false }
}
</script>

<style scoped>
.transfer-panel { padding: 18px 20px; }
.todo-recovery { margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--uta-input-border); }
.todo-recovery h4 { margin: 0; font-size: 14px; }
.transfer-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.transfer-list { margin-top: 12px; }
.transfer-row {
  display: grid;
  grid-template-columns: auto minmax(90px, 1fr) minmax(130px, 1.5fr);
  gap: 8px;
  align-items: center;
  min-height: 36px;
  padding: 7px 0;
  border-top: 1px solid var(--uta-separator);
  font-size: 12.5px;
  cursor: pointer;
}
.transfer-row small { color: var(--uta-secondary); font-size: 11.5px; overflow-wrap: anywhere; }
.transfer-check { width: 16px; height: 16px; margin: 0; accent-color: var(--uta-accent); flex-shrink: 0; }
.transfer-model { display: grid; gap: 6px; margin-top: 12px; font-size: 12.5px; }
.transfer-select {
  width: 100%;
  min-height: 36px;
  box-sizing: border-box;
  border: 1px solid var(--uta-input-border);
  border-radius: 9px;
  padding: 0 12px;
  background: var(--uta-input);
  color: var(--uta-ink);
  font: inherit;
  font-size: 13px;
}
.transfer-select:focus-visible { outline: 2px solid var(--uta-focus); outline-offset: 2px; }
@media (max-width: 720px) {
  .transfer-row { grid-template-columns: auto minmax(0, 1fr); }
  .transfer-row small { grid-column: 2; }
}
</style>
