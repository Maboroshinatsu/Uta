<template>
  <div class="settings-stack">
    <section class="settings-panel character-hero" aria-label="当前模型">
      <div class="hero-head">
        <div class="hero-copy">
          <span class="panel-kicker">当前模型</span>
          <h3 class="hero-name" :title="store.modelUrl">{{ currentModelName }}</h3>
          <p class="hero-meta">
            <span>{{ displayModeLabel }}</span>
            <span class="meta-dot" aria-hidden="true" />
            <span>{{ store.modelLoaded ? '已在桌面载入' : '桌宠尚未报告载入状态' }}</span>
          </p>
        </div>
        <span class="panel-badge" :class="store.modelLoaded ? 'is-positive' : 'is-warning'">
          <span class="status-dot" :class="{ 'is-on': store.modelLoaded, 'is-warn': !store.modelLoaded }" />
          {{ store.modelLoaded ? '模型在线' : '等待桌宠' }}
        </span>
      </div>

      <div class="hero-actions">
        <button type="button" class="uta-button is-primary" :aria-expanded="pickerOpen" @click="pickerOpen = !pickerOpen">
          更换模型
        </button>
        <button type="button" class="uta-button is-secondary" :disabled="scanning" @click="rescan">
          {{ scanning ? '正在扫描…' : '刷新模型列表' }}
        </button>
        <button type="button" class="uta-button is-ghost" @click="openModelsFolder">打开模型目录</button>
        <button type="button" class="uta-button is-ghost" :disabled="importBusy" @click="pickImport('folder')">导入文件夹</button>
        <button type="button" class="uta-button is-ghost" :disabled="importBusy" @click="pickImport('zip')">导入 ZIP</button>
        <button type="button" class="uta-button is-ghost" @click="reloadPetWindow">重新加载桌宠窗口</button>
      </div>

      <Transition name="model-picker-drawer">
        <div v-if="pickerOpen" class="model-picker-drawer">
          <div class="model-picker-clip">
            <div class="model-picker">
              <div class="model-picker-head">
                <span class="field-label">选择展示方式</span>
                <div class="segmented" role="group" aria-label="模型展示方式">
                  <button
                    type="button"
                    class="segmented-btn"
                    :class="{ 'is-active': displayMode === 'live2d' }"
                    :disabled="switching || !models.some(model => model.kind === 'live2d')"
                    @click="setDisplayMode('live2d')"
                  >
                    Live2D 模型
                  </button>
                  <button
                    type="button"
                    class="segmented-btn"
                    :class="{ 'is-active': displayMode === 'image-set' }"
                    :disabled="switching || !models.some(model => model.kind === 'image-set')"
                    @click="setDisplayMode('image-set')"
                  >
                    静态立绘
                  </button>
                </div>
              </div>

              <div v-if="filteredModels.length" class="model-list">
                <button
                  v-for="model in filteredModels"
                  :key="model.url"
                  type="button"
                  class="model-row"
                  :class="{ 'is-active': store.modelUrl === model.url }"
                  :disabled="switching"
                  :aria-current="store.modelUrl === model.url ? 'true' : undefined"
                  @click="selectModel(model.url)"
                >
                  <span class="model-row-name" :title="model.name">{{ modelDisplayLabel(model) }}</span>
                  <span class="model-row-tag">{{ store.modelUrl === model.url ? '当前使用' : '切换' }}</span>
                </button>
              </div>
              <p v-else class="settings-empty">
                未发现{{ displayMode === 'live2d' ? ' Live2D 模型' : '静态立绘包' }}。可以把模型资源放进模型目录后刷新。
              </p>
            </div>
          </div>
        </div>
      </Transition>

      <p v-if="modelSwitchError" class="hero-error" role="alert">{{ modelSwitchError }}</p>
      <p v-else-if="store.modelActionStatus === 'error' && store.modelActionMessage" class="hero-error" role="status">
        {{ store.modelActionMessage }}
      </p>
      <p v-if="loadSettled && !store.modelLoaded" class="hero-warning" role="status">
        桌宠还没有载入模型。模型文件可能被移动或删除；点“打开模型目录”检查，或“重新加载桌宠窗口”后再试。
      </p>

      <div class="daily-status">
        <div class="status-cell">
          <span class="status-label">正在表现</span>
          <strong class="status-value">{{ runningLabel }}</strong>
        </div>
        <div class="status-cell">
          <span class="status-label">常驻基准</span>
          <strong class="status-value">{{ holdLabel }}</strong>
        </div>
        <div class="status-cell">
          <span class="status-label">动作编辑</span>
          <strong class="status-value">{{ store.presetEditingLocked ? '工坊编辑中' : '跟随桌面状态' }}</strong>
        </div>
      </div>
    </section>

    <section v-if="importBusy || importPreview || importMessage" class="settings-panel model-import-panel" aria-label="导入模型">
      <h3 class="panel-title">导入模型</h3>
      <p class="panel-hint">先检查和预览，再保存到当前实例的模型目录。原始文件和当前桌宠保持原样。</p>
      <p v-if="importMessage" class="settings-note" role="status">{{ importMessage }}</p>
      <p v-if="importBusy" class="settings-note" role="status">正在处理模型资源…</p>
      <template v-if="importPreview && importCandidate">
        <label class="import-select-label">包内模型
          <select v-model="importCandidateId" class="import-select" :disabled="importBusy">
            <option v-for="candidate in importPreview.candidates" :key="candidate.id" :value="candidate.id">{{ candidate.name }} · {{ candidate.kind === 'live2d' ? 'Live2D' : '静态立绘' }}</option>
          </select>
        </label>
        <p class="settings-note">{{ importCandidate.summary }} · {{ (importCandidate.bytes / 1024 / 1024).toFixed(1) }} MB</p>
        <p v-for="error in importCandidate.errors" :key="error" class="hero-error" role="alert">{{ error }}</p>
        <p v-for="warning in importCandidate.warnings" :key="warning" class="hero-warning">{{ warning }}</p>
        <ModelImportPreview v-if="!importCandidate.errors.length" :key="importCandidate.id" :candidate="importCandidate" @ready="importPreviewReady = $event" />
        <label v-if="importCandidate.replaces" class="import-replace"><input v-model="importReplace" type="checkbox" :disabled="importBusy" />已存在同名导入模型，确认替换其资源</label>
        <div class="hero-actions import-actions">
          <button type="button" class="uta-button is-ghost" :disabled="importBusy" @click="cancelImport">取消导入</button>
          <button type="button" class="uta-button is-primary" :disabled="importBusy || !importPreviewReady || !!importCandidate.errors.length || (importCandidate.replaces && !importReplace)" @click="saveImport">确认保存模型</button>
        </div>
      </template>
      <button v-if="importedModelUrl" type="button" class="uta-button is-primary" @click="useImportedModel">使用刚导入的模型</button>
    </section>

    <section class="settings-panel is-flush workshop-panel" aria-label="动作库与预设工坊">
      <div class="workshop-head">
        <div>
          <h3 class="panel-title">动作库与预设工坊</h3>
          <p class="panel-hint">动作库用于日常点选；预设工坊用于编排步骤、部件与表情，保存后仍留在当前模型。</p>
        </div>
        <div class="segmented" role="group" aria-label="动作工作区">
          <button
            type="button"
            class="segmented-btn"
            :class="{ 'is-active': workshopTab === 'states' }"
            :aria-pressed="workshopTab === 'states'"
            @click="workshopTab = 'states'"
          >
            动作库
          </button>
          <button
            v-if="displayMode === 'live2d'"
            type="button"
            class="segmented-btn"
            :class="{ 'is-active': workshopTab === 'studio' }"
            :aria-pressed="workshopTab === 'studio'"
            @click="workshopTab = 'studio'"
          >
            预设工坊
          </button>
        </div>
      </div>

      <div class="preset-transfer-row">
        <div class="preset-transfer-copy">
          <span class="preset-transfer-title">用户预设</span>
          <span class="preset-transfer-hint" role="status" aria-live="polite">
            {{ presetMessage || '只导入导出当前模型的自定义预设，按模型文件名识别；导入时同名预设会被覆盖。' }}
          </span>
        </div>
        <div class="preset-transfer-actions">
          <button type="button" class="uta-button is-ghost" @click="exportPresets">导出</button>
          <button type="button" class="uta-button is-ghost" @click="importPresets">导入</button>
        </div>
      </div>

      <div class="workshop-embed">
        <SettingsPanel
          :open="true"
          :embedded="true"
          :hide-chrome="true"
          :active="props.active"
          :tab="workshopTab"
          @update:tab="tab => { if (tab !== 'settings') workshopTab = tab }"
        />
      </div>
    </section>

    <ModelCalibrationPanel v-if="displayMode === 'live2d'" />

    <div
      v-if="draftSwitchOpen"
      ref="draftSwitchOverlayRef"
      class="model-draft-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="model-draft-title"
      aria-describedby="model-draft-desc"
      @keydown.esc.stop.prevent="cancelDraftSwitch"
    >
      <section class="model-draft-prompt">
        <h3 id="model-draft-title">换模型前保存工坊草稿？</h3>
        <p id="model-draft-desc">
          当前工坊有未保存的改动。换模型会清空这份草稿和撤销历史；可以先保存，再切换。
        </p>
        <p v-if="draftSwitchError" class="model-draft-error" role="alert">{{ draftSwitchError }}</p>
        <div class="model-draft-actions">
          <button type="button" class="uta-button is-ghost" :disabled="draftSwitchBusy" @click="cancelDraftSwitch">
            继续编辑
          </button>
          <button type="button" class="uta-button is-secondary" :disabled="draftSwitchBusy" @click="discardDraftAndSwitch">
            放弃草稿并换模型
          </button>
          <button
            ref="draftSwitchSaveRef"
            type="button"
            class="uta-button is-primary"
            :disabled="draftSwitchBusy"
            @click="saveDraftAndSwitch"
          >
            {{ draftSwitchBusy ? '正在保存…' : '保存草稿并换模型' }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import ModelCalibrationPanel from '../ModelCalibrationPanel.vue'
import ModelImportPreview from '../ModelImportPreview.vue'
import type { ModelImportPreview as ImportPreview } from '../../../shared/model-import-contracts'
import { useDeskpetStore } from '@/stores/deskpet'
import {
  getStoredModelForKind,
  getStoredModelPath,
  kindOfModelUrl,
  listAvailableModels,
  normalizeModelKey,
  type ModelKind,
} from '@/services/live2d/model-discovery'
import SettingsIcon from '../../components/settings-v2/SettingsIcon.vue'
import SettingsPanel from '../../components/SettingsPanel.vue'
import { hasUnsavedWorkshopDraft, saveUnsavedDrafts } from '../../services/unsaved-drafts'

const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const store = useDeskpetStore()
const models = ref<Awaited<ReturnType<typeof listAvailableModels>>>([])
const selectedModel = ref('')
const switching = ref(false)
const scanning = ref(false)
const pickerOpen = ref(false)
const workshopTab = ref<'states' | 'studio'>('states')
const modelSwitchError = ref('')
const presetMessage = ref('')
const loadSettled = ref(false)
const importBusy = ref(false)
const importPreview = ref<ImportPreview | null>(null)
const importCandidateId = ref('')
const importCandidate = computed(() => importPreview.value?.candidates.find(candidate => candidate.id === importCandidateId.value))
const importPreviewReady = ref(false)
const importReplace = ref(false)
const importMessage = ref('')
const importedModelUrl = ref('')
let importRequest = 0
watch(importCandidateId, () => { importPreviewReady.value = false; importReplace.value = false })
function cancelImport(): void {
  if (importBusy.value) return
  if (importPreview.value) void window.utaAPI?.cancelModelImport(importPreview.value.token).catch(() => {})
  importPreview.value = null
  importMessage.value = '已取消导入，当前模型未更改。'
}
async function pickImport(kind: 'folder' | 'zip'): Promise<void> {
  if (importBusy.value) return
  cancelImport()
  const request = ++importRequest
  importBusy.value = true; importMessage.value = ''; importedModelUrl.value = ''
  try {
    const result = await window.utaAPI?.pickModelImport(kind)
    if (request !== importRequest || !props.active) {
      if (result?.ok) void window.utaAPI?.cancelModelImport(result.preview.token).catch(() => {})
      return
    }
    if (!result?.ok) { importMessage.value = result?.error || '导入检查不可用。'; return }
    importPreview.value = result.preview
    importCandidateId.value = result.preview.candidates.find(candidate => !candidate.errors.length)?.id || result.preview.candidates[0]?.id || ''
    importMessage.value = '检查完成。预览成功后可确认保存。'
  } catch { importMessage.value = '模型包无法读取，请重新选择。' }
  finally { importBusy.value = false }
}
async function saveImport(): Promise<void> {
  const preview = importPreview.value, candidate = importCandidate.value
  if (importBusy.value || !preview || !candidate || !importPreviewReady.value) return
  importBusy.value = true
  try {
    const result = await window.utaAPI?.installModelImport({ token: preview.token, candidateId: candidate.id, replace: importReplace.value })
    if (!result?.ok || !result.url) { importMessage.value = result?.error || '模型保存失败，原模型已保留。'; return }
    importedModelUrl.value = result.url
    importPreview.value = null
    importMessage.value = '模型已保存。可以继续使用当前模型，或点击下方按钮切换。'
    await loadModels(true)
  } catch { importMessage.value = '模型保存未完成，请检查资源后重试。' }
  finally { importBusy.value = false }
}
async function useImportedModel(): Promise<void> {
  if (!importedModelUrl.value) return
  if (store.modelUrl === importedModelUrl.value) { reloadPetWindow(); return }
  await selectModel(importedModelUrl.value)
}
watch(() => props.active, active => { if (!active && !importBusy.value && importPreview.value) cancelImport() })
let loadSettleTimer: ReturnType<typeof setTimeout> | null = null

const PRESET_IMPORT_ERRORS: Record<string, string> = {
  'missing-motion': '当前模型没有预设引用的原生动作，整个文件未导入。',
  'model-mismatch': '这个文件属于另一个模型，未导入，避免不同模型混用预设。',
  'invalid-json': '文件格式无法识别，未导入。',
  'invalid-envelope': '文件不是 Uta 用户预设文件，或版本不受支持。',
  'too-large': '文件太大，未导入。',
  empty: '文件里没有用户预设。',
  'invalid-preset': '文件中有无法识别的预设，整个文件未导入。',
  'duplicate-id': '文件中有重复的预设 ID，未导入。',
  unreadable: '本机预设记录无法读取，未导入，也未改动原记录。',
  'write-failed': '写入本机预设存储失败，未导入。',
}

const displayMode = computed<ModelKind>(() => {
  const current = store.modelUrl || selectedModel.value
  return current ? kindOfModelUrl(current) : 'live2d'
})
const displayModeLabel = computed(() => displayMode.value === 'live2d' ? 'Live2D 模型' : '静态立绘')
const filteredModels = computed(() => models.value.filter(model => model.kind === displayMode.value))
const ambiguousModelNames = computed(() => {
  const counts = new Map<string, number>()
  for (const model of filteredModels.value) {
    const label = model.displayName || model.name
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([label]) => label))
})
function modelDisplayLabel(model: { name: string; displayName?: string }): string {
  const label = model.displayName || model.name
  return ambiguousModelNames.value.has(label) ? model.name : label
}
const currentModelName = computed(() => {
  const adapterName = store.emotionAdapter?.name?.trim()
  if (adapterName) return adapterName
  const matched = models.value.find(model => model.url === store.modelUrl) ??
    models.value.find(model => model.url === selectedModel.value)
  if (matched) return matched.displayName || matched.name
  if (store.modelUrl) {
    const tail = store.modelUrl.split(/[\\/]/).filter(Boolean).pop() ?? ''
    return tail.replace(/\.[^.]+$/, '') || '当前模型'
  }
  return '正在读取模型…'
})

function presetLabel(id: string | null | undefined, fallback: string): string {
  if (!id) return fallback
  return store.statePresets.find(preset => preset.id === id)?.label || fallback
}
const runningLabel = computed(() => presetLabel(store.activeRunningPresetId, '日常待机'))
const holdLabel = computed(() => presetLabel(store.effectiveHoldPresetId, '日常待机'))

async function loadModels(forceRescan = false): Promise<void> {
  scanning.value = true
  try {
    models.value = await listAvailableModels(forceRescan)
    selectedModel.value = store.modelUrl || getStoredModelPath() || models.value[0]?.url || ''
  } catch {
    models.value = []
  } finally {
    scanning.value = false
  }
}

async function performModelSwitch(url: string): Promise<void> {
  if (!url || url === store.modelUrl || switching.value) return
  switching.value = true
  modelSwitchError.value = ''
  try {
    await store.requestModelSwitch(url)
    if (store.modelUrl !== url) {
      modelSwitchError.value = '没有切换到这个模型。模型文件可能缺失或无法读取；请打开模型目录检查，或刷新模型列表后重试。'
    }
  } catch {
    modelSwitchError.value = '模型切换失败。请检查模型文件是否完整，然后重试。'
  } finally {
    switching.value = false
    selectedModel.value = store.modelUrl || url
    pickerOpen.value = false
  }
}

const draftSwitchOpen = ref(false)
const draftSwitchBusy = ref(false)
const draftSwitchError = ref('')
const pendingModelUrl = ref('')
const draftSwitchSaveRef = ref<HTMLButtonElement | null>(null)

const draftSwitchOverlayRef = ref<HTMLElement>()
let draftSwitchReturnFocus: HTMLElement | null = null

function onDraftSwitchKeys(event: KeyboardEvent): void {
  if (!props.active || !draftSwitchOpen.value) return
  const overlay = draftSwitchOverlayRef.value
  const active = document.activeElement as HTMLElement | null
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelDraftSwitch()
    return
  }
  if (event.key === 'Tab' && overlay) {
    const focusable = Array.from(
      overlay.querySelectorAll<HTMLElement>('button:not([disabled])'),
    )
    if (focusable.length > 0) {
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!active || !overlay.contains(active)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }
}

function cancelDraftSwitch(): void {
  if (draftSwitchBusy.value) return
  draftSwitchOpen.value = false
  draftSwitchError.value = ''
  pendingModelUrl.value = ''
  void nextTick(() => draftSwitchReturnFocus?.focus?.())
}

watch(
  () => props.active,
  (active) => {
    if (active || !draftSwitchOpen.value || draftSwitchBusy.value) return
    draftSwitchOpen.value = false
    draftSwitchError.value = ''
    pendingModelUrl.value = ''
    draftSwitchReturnFocus = null
  },
)

async function discardDraftAndSwitch(): Promise<void> {
  if (draftSwitchBusy.value) return
  const url = pendingModelUrl.value
  draftSwitchOpen.value = false
  draftSwitchError.value = ''
  pendingModelUrl.value = ''
  await performModelSwitch(url)
}

async function saveDraftAndSwitch(): Promise<void> {
  if (draftSwitchBusy.value) return
  const url = pendingModelUrl.value
  draftSwitchBusy.value = true
  draftSwitchError.value = ''
  try {
    const saved = await saveUnsavedDrafts('workshop')
    if (!saved.ok) {
      draftSwitchError.value = store.presetSaveMessage || '保存工坊草稿失败，请检查名称后重试。'
      return
    }
    draftSwitchOpen.value = false
    pendingModelUrl.value = ''
    await performModelSwitch(url)
  } finally {
    draftSwitchBusy.value = false
  }
}

async function selectModel(url: string): Promise<void> {
  if (!url || url === store.modelUrl || switching.value) return
  if (hasUnsavedWorkshopDraft.value) {
    draftSwitchReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    pendingModelUrl.value = url
    draftSwitchError.value = ''
    draftSwitchOpen.value = true
    void nextTick(() => draftSwitchSaveRef.value?.focus())
    return
  }
  await performModelSwitch(url)
}

async function setDisplayMode(kind: ModelKind): Promise<void> {
  if (kind === displayMode.value) return
  const remembered = getStoredModelForKind(kind)
  const memoryKey = remembered ? normalizeModelKey(remembered) : ''
  const target = remembered
    ? models.value.find(model => model.url === remembered || normalizeModelKey(model.url) === memoryKey)
    : undefined
  const first = target ?? models.value.find(model => model.kind === kind)
  if (first) await selectModel(first.url)
}

function rescan(): void {
  void loadModels(true)
}

function openModelsFolder(): void {
  void window.utaAPI?.openModelsFolder()
}

function reloadPetWindow(): void {
  void window.utaAPI?.reloadWindow()
}

async function exportPresets(): Promise<void> {
  const result = store.exportUserPresets()
  if (!result.ok) {
    presetMessage.value = result.error === 'empty'
      ? '当前模型还没有用户预设。先在工坊保存一个，再导出。'
      : '本机预设记录无法读取，未导出。'
    return
  }
  const safeName = currentModelName.value.replace(/[^\w\u4e00-\u9fa5-]+/g, '-').slice(0, 40) || 'model'
  const saved = await window.utaAPI?.exportPresetFile?.({
    suggestedName: `uta-user-presets-${safeName}.json`,
    text: result.text,
  })
  if (!saved) {
    presetMessage.value = '导出接口不可用，请重试。'
    return
  }
  if (!saved.ok) {
    presetMessage.value = saved.error === 'cancelled'
      ? '已取消导出。'
      : saved.error === 'write-failed'
        ? '写入文件失败，请检查保存位置后重试。'
        : '导出失败，请重试。'
    return
  }
  presetMessage.value = `已导出 ${result.count} 个用户预设。`
}

async function importPresets(): Promise<void> {
  const picked = await window.utaAPI?.importPresetFile?.()
  if (!picked) {
    presetMessage.value = '导入接口不可用，请重试。'
    return
  }
  if (!picked.ok || typeof picked.text !== 'string') {
    presetMessage.value = picked.error === 'cancelled'
      ? '已取消导入。'
      : picked.error === 'too-large'
        ? '文件太大，未导入。'
        : picked.error === 'read-failed'
          ? '读取文件失败，未导入。'
          : '导入失败，请重试。'
    return
  }
  const result = store.importUserPresets(picked.text)
  if (result.ok) {
    presetMessage.value = result.replaced > 0
      ? `已导入 ${result.imported} 个用户预设，覆盖 ${result.replaced} 个同名或同 ID 预设。`
      : `已导入 ${result.imported} 个用户预设。`
    return
  }
  presetMessage.value = PRESET_IMPORT_ERRORS[result.error] ?? '导入失败，现有预设未被改动。'
}

onMounted(() => {
  void loadModels()
  window.addEventListener?.('keydown', onDraftSwitchKeys)
  loadSettleTimer = setTimeout(() => {
    loadSettleTimer = null
    loadSettled.value = true
  }, 2500)
})

onUnmounted(() => {
  importRequest += 1
  if (importPreview.value) void window.utaAPI?.cancelModelImport(importPreview.value.token).catch(() => {})
  window.removeEventListener?.('keydown', onDraftSwitchKeys)
  if (loadSettleTimer) {
    clearTimeout(loadSettleTimer)
    loadSettleTimer = null
  }
})

watch(() => store.modelUrl, url => {
  if (url) {
    selectedModel.value = url
    modelSwitchError.value = ''
    presetMessage.value = ''
  }
})

watch(displayMode, mode => {
  if (mode !== 'live2d' && workshopTab.value === 'studio') workshopTab.value = 'states'
})
</script>

<style scoped>
.character-hero {
  padding: 20px;
}
.model-import-panel { display: grid; gap: 12px; }
.import-select-label { display: grid; gap: 6px; color: var(--uta-secondary); font-size: 13px; }
.import-select { max-width: 100%; padding: 9px; background: var(--uta-surface); color: var(--uta-ink); border: 1px solid var(--uta-separator); border-radius: var(--uta-radius-sm); }
.import-replace { display: flex; gap: 8px; align-items: center; font-size: 13px; color: var(--uta-ink); }
.import-actions { justify-content: flex-end; }

.hero-head {
  display: flex;
  align-items: flex-start;
  gap: 13px;
}

.hero-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background: linear-gradient(150deg, var(--uta-accent-soft), var(--uta-surface));
  border: 1px solid var(--uta-separator);
  color: var(--uta-accent-read);
  flex-shrink: 0;
}

.hero-copy {
  flex: 1;
  min-width: 0;
}

.hero-name {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--uta-ink);
  overflow-wrap: anywhere;
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 5px 0 0;
  font-size: 12px;
  color: var(--uta-secondary);
}

.meta-dot {
  width: 3px;
  height: 3px;
  border-radius: 999px;
  background-color: var(--uta-muted);
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 15px;
}

.model-picker-drawer {
  display: grid;
  grid-template-rows: 1fr;
}

.model-picker-drawer-enter-active,
.model-picker-drawer-leave-active {
  transition: grid-template-rows 240ms ease-in-out, opacity 200ms ease-in-out;
}

.model-picker-clip {
  min-height: 0;
}

.model-picker-drawer-enter-active .model-picker-clip,
.model-picker-drawer-leave-active .model-picker-clip {
  overflow: hidden;
}

.model-picker-drawer-enter-from,
.model-picker-drawer-leave-to {
  opacity: 0;
  grid-template-rows: 0fr;
}

@media (prefers-reduced-motion: reduce) {
  .model-picker-drawer-enter-active,
  .model-picker-drawer-leave-active {
    transition: none;
  }
}

.model-picker {
  margin-top: 14px;
  padding: 14px;
  border-radius: 12px;
  background-color: var(--uta-canvas);
  border: 1px solid var(--uta-separator);
}

.model-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.model-picker-head .field-label {
  margin: 0;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 12px;
}

.model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 9px;
  background-color: var(--uta-surface);
  color: var(--uta-ink);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.model-row:hover:not(:disabled) {
  border-color: var(--uta-separator);
}

.model-row.is-active {
  border-color: var(--uta-accent);
  background-color: var(--uta-accent-soft);
  color: var(--uta-accent-read);
  font-weight: 650;
}

.model-row:disabled {
  opacity: 0.5;
  cursor: default;
}

.model-row-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-row-tag {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--uta-secondary);
}

.hero-error {
  margin: 10px 0 0;
  color: var(--uta-error);
  font-size: 12px;
}

.hero-warning {
  margin: 10px 0 0;
  padding: 9px 11px;
  border-radius: 9px;
  background-color: var(--uta-warning-bg);
  color: var(--uta-warning);
  font-size: 12px;
  line-height: 1.55;
}

.preset-transfer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 0 2px 12px;
}

.preset-transfer-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.preset-transfer-title {
  font-size: 12px;
  font-weight: 650;
  color: var(--uta-ink);
}

.preset-transfer-hint {
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--uta-secondary);
}

.preset-transfer-actions {
  display: flex;
  gap: 6px;
}

.daily-status {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin-top: 16px;
  border-radius: 12px;
  overflow: hidden;
  background-color: var(--uta-separator);
  border: 1px solid var(--uta-separator);
}

.status-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 11px 13px;
  background-color: var(--uta-surface-subtle);
  min-width: 0;
}

.status-label {
  font-size: 11px;
  color: var(--uta-secondary);
}

.status-value {
  font-size: 13px;
  font-weight: 650;
  color: var(--uta-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workshop-panel {
  padding: 17px 18px 12px;
}

.workshop-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 0 2px 13px;
}

.workshop-embed {
  min-width: 0;
}

.model-draft-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(13, 26, 32, 0.3);
  backdrop-filter: blur(3px);
}

.model-draft-prompt {
  width: min(480px, 100%);
  padding: 24px;
  border: 1px solid var(--uta-separator);
  border-radius: var(--uta-radius-lg);
  background: var(--uta-surface);
  box-shadow: var(--uta-shadow-card);
  color: var(--uta-ink);
}

.model-draft-prompt h3 {
  margin: 0 0 10px;
  font-size: 17px;
  line-height: 1.3;
}

.model-draft-prompt p {
  margin: 0;
  color: var(--uta-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.model-draft-error {
  margin-top: 12px !important;
  color: var(--uta-error) !important;
}

.model-draft-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 22px;
}

@media (max-width: 800px) {
  .daily-status {
    grid-template-columns: 1fr;
  }
  .status-cell {
    flex-direction: row;
    align-items: baseline;
    justify-content: space-between;
  }
}

@media (max-width: 620px) {
  .hero-head {
    flex-wrap: wrap;
  }
  .hero-actions .uta-button {
    flex: 1 1 auto;
  }
}
</style>
