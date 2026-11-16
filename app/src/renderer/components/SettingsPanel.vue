<template>
  <Transition name="companion-slide">
    <div
      v-if="open"
      ref="companionRootRef"
      class="companion-window settings-companion"
      :class="[`pop-${popDirectionX}`, `align-${alignY}`, { embedded }]"
      @mousedown.stop
      @wheel="embedded ? undefined : $event.stopPropagation()"
    >
      <!-- 顶部有机导航栏：左侧自定义功能圆点 + 居中胶囊导航 + 右侧独立关闭按钮 -->
      <div v-if="!hideChrome" class="bio-header" @mousedown="onBioHeaderMouseDown">
        <button
          ref="orbBtnRef"
          type="button"
          class="bio-orb-btn"
          :class="{ active: quickModelBarOpen && store.orbAction === 'model_picker' }"
          :title="orbTooltip"
          @mousemove="onOrbMouseMove"
          @mouseleave="onOrbMouseLeave"
          @click="onOrbClick"
        >
          <input
            ref="orbColorInputRef"
            type="color"
            class="bio-orb-color-input"
            :value="store.accentColor"
            tabindex="-1"
            @click.stop
            @input="onAccentColorInput"
          />
        </button>

        <div ref="navBarRef" class="bio-nav">
          <span class="bio-nav-slider" aria-hidden="true" />
          <button
            type="button"
            class="bio-tab"
            :class="{ active: activeTab === 'states' }"
            @click="switchTab('states')"
          >
            状态预设
          </button>
          <button
            v-if="displayMode === 'live2d'"
            type="button"
            class="bio-tab"
            :class="{ active: activeTab === 'studio' }"
            @click="switchTab('studio')"
          >
            预设工坊
          </button>
          <button
            type="button"
            class="bio-tab"
            :class="{ active: activeTab === 'settings' }"
            @click="switchTab('settings')"
          >
            面板设置
          </button>
        </div>

        <button
          v-if="!embedded"
          type="button"
          class="bio-icon-btn"
          title="收起面板"
          @click="$emit('close')"
        >
          <svg viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div v-if="!hideChrome && store.modelActionStatus !== 'idle'" class="model-action-feedback" :data-status="store.modelActionStatus" role="status" aria-live="polite">
        {{ store.modelActionMessage }}
      </div>

      <!-- 左上角圆点快捷呼出的模型选择栏（0fr <-> 1fr 弹簧抽屉 + 错峰弹入列表） -->
      <div
        v-if="!hideChrome"
        class="quick-drawer-collapse"
        :class="{ open: quickModelBarOpen }"
        :inert="!quickModelBarOpen"
      >
        <div class="quick-drawer-inner">
          <div class="bio-quick-model-drawer">
            <div class="quick-drawer-head">
              <div class="studio-mode-strip quick-mode-strip">
                <button
                  type="button"
                  class="studio-mode-btn pressable"
                  :class="{ active: displayMode === 'live2d' }"
                  :disabled="switching || !models.some((m) => m.kind === 'live2d')"
                  @click="setDisplayMode('live2d')"
                >
                  Live2D 模型
                </button>
                <button
                  type="button"
                  class="studio-mode-btn pressable"
                  :class="{ active: displayMode === 'image-set' }"
                  :disabled="switching || !models.some((m) => m.kind === 'image-set')"
                  @click="setDisplayMode('image-set')"
                >
                  静态立绘
                </button>
              </div>
              <button
                type="button"
                class="bio-btn-pill pressable"
                :disabled="switching"
                title="重新扫描模型目录"
                @click="rescan"
              >
                刷新
              </button>
            </div>

            <div v-if="filteredModels.length === 0" class="bio-model-empty">
              未发现{{ displayMode === 'live2d' ? ' Live2D 模型' : '静态立绘包' }}
            </div>
            <div v-else :key="displayMode" class="bio-model-list">
              <button
                v-for="(m, mIdx) in filteredModels"
                :key="m.url"
                type="button"
                class="bio-model-item pressable"
                :class="{ active: selectedModel === m.url }"
                :style="{ '--model-i': Math.min(mIdx, 8) }"
                :disabled="switching"
                @click="selectModelUrl(m.url)"
              >
                <span class="ctrl-dot" />
                <span class="bio-model-item-name">{{ m.name }}</span>
                <span v-if="selectedModel === m.url" class="bio-model-item-tag">当前</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <Transition name="bio-tab-switch" mode="out-in">
        <!-- ==================== 页签 1：状态预设（日常纯净点选 + 统一等宽胶囊） ==================== -->
        <div
          v-if="activeTab === 'states'"
          key="states"
          class="bio-scroll"
          @scroll.passive="onPanelScroll"
        >
          <SettingsStatesTab />
        </div>

        <!-- ==================== 页签 2：预设工坊（全折叠分组菜单：分镜保存 + 分类部件框 + 面捕滑块） ==================== -->
        <div
          v-else-if="activeTab === 'studio' && displayMode === 'live2d'"
          key="studio"
          class="bio-scroll"
          @scroll.passive="onPanelScroll"
        >
          <SettingsStudioTab />
        </div>

        <!-- ==================== 页签 3：面板设置（外观取色、模型、连接与热键） ==================== -->
        <div v-else key="settings" class="bio-scroll" @scroll.passive="onPanelScroll">
          <SettingsTab
            @open-voice="emit('open-voice')"
            :models="models"
            :filtered-models="filteredModels"
            :selected-model="selectedModel"
            :switching="switching"
            :display-mode="displayMode"
            :current-model-display-name="currentModelDisplayName"
            @select-model="selectModelUrl"
            @set-display-mode="setDisplayMode"
            @rescan="rescan"
            @open-models-folder="openModelsFolder"
            @reload="reload"
          />
        </div>
      </Transition>

      <div
        v-if="presetDraftGuardOpen"
        class="preset-draft-guard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preset-draft-guard-title"
        @mousedown.self="continuePresetDraftEditing"
        @keydown.esc.stop.prevent="continuePresetDraftEditing"
      >
        <div class="preset-draft-guard-card">
          <span class="preset-draft-guard-kicker">预设工坊</span>
          <h3 id="preset-draft-guard-title">先处理未保存的草稿</h3>
          <p>{{ presetDraftGuardTitle }}</p>
          <p v-if="presetDraftGuardError" class="preset-draft-guard-error" role="alert">
            {{ presetDraftGuardError }}
          </p>
          <div class="preset-draft-guard-actions">
            <button
              type="button"
              class="bio-btn-pill pressable"
              :disabled="presetDraftGuardBusy"
              @click="continuePresetDraftEditing"
            >
              继续编辑
            </button>
            <button
              type="button"
              class="bio-btn-pill pressable"
              :disabled="presetDraftGuardBusy"
              @click="discardPresetDraftAndContinue"
            >
              放弃并继续
            </button>
            <button
              ref="presetDraftGuardSaveRef"
              type="button"
              class="bio-btn-pill accent pressable"
              :disabled="presetDraftGuardBusy"
              @click="savePresetDraftAndContinue"
            >
              {{ presetDraftGuardBusy ? '正在保存…' : '保存并继续' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, provide, reactive, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { setWorkshopDraftSignal } from '@/services/workshop-draft-signal'
import {
  listAvailableModels,
  getStoredModelForKind,
  getStoredModelPath,
  kindOfModelUrl,
  normalizeModelKey,
  type ModelKind,
} from '@/services/live2d/model-discovery'
import { exportPresetStepsToMotion3, formatMotionFilename } from '@/services/live2d/motion-exporter'
import { isNativeMotionBinding } from '../../shared/native-motion'
import {
  PRESET_EMOTION_GROUPS,
  applyControlActionToList,
  getPresetDefaultFinishMode,
  isPersistentControlCategory,
  normalizePresetSteps,
  pickRandomPresetInGroup,
  resolvePresetGroup,
  resolvePresetMotion,
  derivePresetGroupOptions,
  type ModelStatePreset,
  type PresetFinishMode,
  type PresetKeyframeStep,
  type ResolvedModelControl,
  type ResolvedModelSlider,
} from '@/services/live2d/emotion-adapter'
import {
  listPresetMotionOptions,
  listNativeMotionLibrary,
  type PresetMotionOption,
  type NativeMotionOption,
} from '@/services/live2d/preset-motion-options'
import {
  listPairedGestures,
  buildPairedGestureSteps,
  buildPairedGesturePreset,
  type PairedGesture,
} from '@/services/live2d/gesture-pairing'
import {
  parseNaturalActionPrompt,
  compileDirectorPlan,
  buildHostDirectorPrompt,
  extractJsonFromHostReply,
  type DirectorPlan,
} from '@/services/live2d/natural-action-planner'
import { createSnapshotHistory } from '@/services/workshop-history'
import { registerUnsavedDraft } from '@/services/unsaved-drafts'
import { useDeskpetStore } from '@/stores/deskpet'
import { useWindowDrag } from '@/composables/useWindowDrag'
import SettingsTab from './SettingsTab.vue'
import SettingsStatesTab from './SettingsStatesTab.vue'
import SettingsStudioTab from './SettingsStudioTab.vue'
import {
  buildQuickSnippet,
  canBuildQuickSnippet,
  QUICK_SNIPPET_LABELS,
  QUICK_SNIPPET_REASONS,
} from '@/services/preset-snippets'
import type { QuickSnippetType } from '@/services/preset-snippets'
import type { SettingsWorkshop } from './settings-workshop'

const props = withDefaults(
  defineProps<{
    open: boolean
    popDirectionX?: 'left' | 'right'
    alignY?: 'bottom' | 'top'
    /** Fills an embedding container instead of floating over the pet stage. */
    embedded?: boolean
    initialTab?: 'states' | 'studio' | 'settings'
    /** The settings centre owns the page title and sub-navigation. */
    hideChrome?: boolean
    /** Controlled sub-tab for embedding; internal switches still emit updates. */
    tab?: 'states' | 'studio' | 'settings'
    /** The embedded page can be hidden while its draft stays alive. */
    active?: boolean
  }>(),
  {
    popDirectionX: 'left',
    alignY: 'bottom',
    embedded: false,
    initialTab: 'states',
    hideChrome: false,
    tab: undefined,
    active: true,
  },
)
const emit = defineEmits<{ close: []; 'open-voice': []; 'update:tab': [tab: 'states' | 'studio' | 'settings'] }>()

const store = useDeskpetStore()
const dragHelper = typeof useWindowDrag === 'function' ? useWindowDrag() : null
function onBioHeaderMouseDown(e: MouseEvent) {
  if (props.embedded || !dragHelper) return
  const target = e.target as HTMLElement | null
  if (target?.closest('button, input, select, textarea, .bio-tab, .bio-orb-btn, .bio-icon-btn')) return
  dragHelper.onNavMouseDown(e)
}
function previewStep(step: PresetKeyframeStep, gaze = true): void {
  void store.requestModelAction({ type: 'preview-step', step, gaze })
}
function syncSliders(transitionMs = 0): void {
  void store.requestModelAction({
    type: 'sync-sliders', transitionMs,
    sliders: JSON.parse(JSON.stringify(store.modelSliders)),
    controls: JSON.parse(JSON.stringify(store.modelControls)),
  })
}
function playPreset(preset: string | ModelStatePreset, mode?: PresetFinishMode): void {
  void store.requestModelAction({ type: 'trigger-preset',
    preset: typeof preset === 'string' ? preset : preset as unknown as Record<string, unknown>, mode })
}
/** The pet owns the runtime hold slot; the settings store only mirrors it for the UI. */
function setPetHoldPreset(presetId: string): void {
  void store.requestModelAction({ type: 'set-hold-preset', presetId })
}
const companionRootRef = ref<HTMLElement | null>(null)
const navBarRef = ref<HTMLElement | null>(null)
const orbBtnRef = ref<HTMLElement | null>(null)
const pebbleRef = ref<HTMLElement | null>(null)
const activeTab = ref<'states' | 'studio' | 'settings'>(props.tab ?? props.initialTab)
watch(() => props.tab, tab => {
  if (tab) switchTab(tab)
})
watch(activeTab, tab => emit('update:tab', tab))
const activePresetId = ref('neutral')
const previousPresetId = ref('neutral')
const isCreatingNewPreset = ref(false)
const customPresetName = ref('')
const presetNameInputRef = ref<HTMLInputElement | null>(null)

/** 子页签模板 ref 通过函数绑定回父组件同一个 ref，父级手感/聚焦逻辑无需改动 */
function bindPebbleRef(el: Element | ComponentPublicInstance | null) {
  pebbleRef.value = el instanceof HTMLElement ? el : null
}

function bindPresetNameInput(el: Element | ComponentPublicInstance | null) {
  presetNameInputRef.value = el instanceof HTMLInputElement ? el : null
}

/** 预设工坊内各模块的展开/收起状态 */
const expandedSections = reactive({
  sequence: true,
  controls: false,
  face: true,
  pose: false,
  extra: false,
})

function toggleSection(key: keyof typeof expandedSections) {
  expandedSections[key] = !expandedSections[key]
}

const editingSteps = ref<PresetKeyframeStep[]>([
  { label: '步骤 1', durationMs: 600, holdMs: 0, controls: [], parameters: {} },
])
const editingStepIndex = ref(0)
const editingFinishMode = ref<PresetFinishMode>('revert')
const editingEmotion = ref('neutral')
const editingGroup = ref('日常待机')
const editingMotion = ref<{ group: string; index?: number } | 'none' | undefined>(undefined)

const presetMotionOptions = computed<PresetMotionOption[]>(() => {
  const current =
    editingMotion.value && typeof editingMotion.value === 'object' ? editingMotion.value : null
  return listPresetMotionOptions(store.modelCapabilities?.motionGroups, current, store.modelCapabilities?.motionDetails)
})
const wholeMotionLabel = computed(() => {
  if (isNativeMotionBinding(editingMotion.value)) {
    const motion = editingMotion.value
    return store.modelCapabilities?.motionDetails?.[`${motion.group}#${motion.index ?? 0}`]?.label || motion.group || '未命名动作组'
  }
  const last = editingSteps.value[editingSteps.value.length - 1]
  if (editingSteps.value.length > 1 || last?.controls.length || Object.keys(last?.parameters ?? {}).length) return ''
  // 与实际播放器的自动动作解析一致，纯情绪预设也可能依赖原生资源。
  return resolvePresetMotion({ id: activePresetId.value, label: customPresetName.value,
    emotion: editingEmotion.value, motion: editingMotion.value }, store.emotionAdapter, store.modelCapabilities)?.group ?? ''
})
function clearWholeMotion(): void { editingMotion.value = 'none' }
const nativeMotionName = ref('')
const nativeMotionOptions = computed<NativeMotionOption[]>(() => {
  return listNativeMotionLibrary(
    store.modelCapabilities?.motionGroups,
    store.modelCapabilities?.motionDetails,
  )
})
function saveNativeMotionPreset(motion: NativeMotionOption): void {
  const label = nativeMotionName.value.trim() || motion.label || motion.name || motion.group
  const preset = store.saveCustomPreset(label, [], {}, 'neutral', {
    group: '动作库',
    finishMode: 'hold',
    motion: { group: motion.group, index: motion.index },
    steps: [{ label: '动作', durationMs: 0, holdMs: 0, controls: [], parameters: {} }],
  })
  if (preset) {
    nativeMotionName.value = ''
    store.presetSaveMessage = `已将动作「${label}」存入「动作库」预设`
    store.presetSaveStatus = 'success'
  }
}
function saveAllNativeMotionPresets(): void {
  const list = nativeMotionOptions.value
  if (list.length === 0) return
  let count = 0
  for (const motion of list) {
    const label = motion.label || motion.name || motion.group
    const preset = store.saveCustomPreset(label, [], {}, 'neutral', {
      group: '动作库',
      finishMode: 'hold',
      motion: { group: motion.group, index: motion.index },
      steps: [{ label: '动作', durationMs: 0, holdMs: 0, controls: [], parameters: {} }],
    })
    if (preset) count += 1
  }
  store.presetSaveMessage = `已成功将 ${count} 个原生动作生成到「动作库」预设`
  store.presetSaveStatus = 'success'
}
function previewNativeMotionPreset(motion: NativeMotionOption): void {
  playPreset({
    id: `preview_motion_${motion.group}_${motion.index}`,
    label: motion.label || motion.name || motion.group,
    description: '',
    emotion: 'neutral',
    group: '动作库',
    controls: [],
    parameters: {},
    steps: [{ label: '试听', durationMs: 0, holdMs: 0, controls: [], parameters: {} }],
    finishMode: 'hold',
    motion: { group: motion.group, index: motion.index },
    preview: true,
  }, 'hold')
}

const pairedGestures = computed<PairedGesture[]>(() => {
  return listPairedGestures(
    store.modelCapabilities?.motionGroups,
    store.modelCapabilities?.motionDetails,
    store.modelCapabilities?.parameters,
  )
})

function addPairedGestureSnippet(gesture: PairedGesture): boolean {
  const steps = buildPairedGestureSteps(gesture, currentEditingStep.value)
  if (!steps || steps.length === 0) return false
  store.presetEditingLocked = true
  editingSteps.value.push(...steps)
  editingStepIndex.value = Math.max(0, editingSteps.value.length - 2)
  previewStep(editingSteps.value[editingStepIndex.value], true)
  store.presetSaveMessage = `已追加「${gesture.label}」三段闭环分镜（起/驻/收）`
  store.presetSaveStatus = 'success'
  return true
}

function savePairedGesturePreset(gesture: PairedGesture): void {
  const preset = buildPairedGesturePreset(gesture, currentEditingStep.value)
  const saved = store.saveCustomPreset(
    preset.label,
    preset.controls,
    preset.parameters || {},
    'neutral',
    {
      group: '动作库',
      finishMode: 'hold',
      steps: preset.steps,
    },
  )
  if (saved) {
    store.presetSaveMessage = `已将「${gesture.label}（闭环）」存入动作库预设`
    store.presetSaveStatus = 'success'
  }
}

function previewPairedGesture(gesture: PairedGesture): void {
  const preset = buildPairedGesturePreset(gesture, currentEditingStep.value)
  playPreset(
    {
      ...preset,
      preview: true,
    },
    'hold',
  )
}


const directorPrompt = ref('')
const directorRunning = ref(false)
const directorMessage = ref('')
const directorEngine = ref<'local' | 'host'>('local')

const boundHostId = computed(() => {
  if (typeof window !== 'undefined' && window.utaAPI?.petBinding?.binding?.hostId) {
    return window.utaAPI.petBinding.binding.hostId
  }
  return 'antigravity'
})

const HOST_DISPLAY_NAMES: Record<string, string> = {
  antigravity: 'Antigravity',
  'deepseek-harness': 'DeepSeek Harness',
  harness: 'DeepSeek Harness',
  'claude-code': 'Claude Code',
  qoder: 'Qoder',
  codex: 'Codex',
  opencode: 'OpenCode',
  zcode: 'ZCode',
  maibot: 'MaiBot',
  astrbot: 'AstrBot',
  standalone: '独立待命',
}

const boundHostLabel = computed(() => HOST_DISPLAY_NAMES[boundHostId.value] || boundHostId.value || '当前宿主')

function applyDirectorPromptSample(sample: string): void {
  directorPrompt.value = sample
}

function copyHostDirectorPrompt(): void {
  const prompt = directorPrompt.value.trim()
  if (!prompt) {
    directorMessage.value = '请先输入想编排的动作指令'
    return
  }
  const fullPrompt = buildHostDirectorPrompt(
    prompt,
    '大肥鱼',
    {
      parameters: store.modelCapabilities?.parameters,
      modelEmotions: store.modelEmotions,
      modelControls: store.modelControls,
    },
    pairedGestures.value,
  )
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    void navigator.clipboard.writeText(fullPrompt)
    directorMessage.value = `已复制【${boundHostLabel.value}】编排提示词到剪贴板，直接粘贴发送给 Agent 即可！`
    store.presetSaveMessage = '已复制导演提示词'
    store.presetSaveStatus = 'success'
  }
}

function pasteAndApplyDirectorJson(rawText: string): boolean {
  try {
    const plan = extractJsonFromHostReply(rawText)
    if (!plan) {
      directorMessage.value = '未能在文本中解析出合法的动作 JSON，请确认内容包含 {"version": 1, "actions": [{"kind": "..."}]}'
      store.presetSaveMessage = '解析动作 JSON 失败'
      store.presetSaveStatus = 'error'
      return false
    }
    const compiled = compileDirectorPlan(
      plan,
      {
        parameters: store.modelCapabilities?.parameters,
        modelEmotions: store.modelEmotions,
        modelControls: store.modelControls,
      },
      pairedGestures.value,
      currentEditingStep.value,
    )
    store.presetEditingLocked = true
    editingSteps.value = compiled
    editingStepIndex.value = 0
    directorMessage.value = `已成功解析并载入 ${compiled.length} 个动作分镜：${plan.summary || ''}`
    store.presetSaveMessage = `已载入：${plan.summary || '宿主分镜'}`
    store.presetSaveStatus = 'success'

    playPreset(
      {
        id: `host_director_${Date.now()}`,
        label: (plan.summary || '宿主分镜').slice(0, 20),
        description: plan.summary || '',
        emotion: 'neutral',
        group: '动作库',
        controls: [...currentEditingStep.value.controls],
        parameters: { ...currentEditingStep.value.parameters },
        steps: compiled,
        finishMode: 'hold',
        preview: true,
      },
      'hold',
    )
    return true
  } catch (error) {
    directorMessage.value = `解析动作计划异常：${(error as Error)?.message || error}。请检查动作 JSON 格式。`
    store.presetSaveMessage = '动作 JSON 格式异常'
    store.presetSaveStatus = 'error'
    return false
  }
}

async function sendPromptToHostDirector(): Promise<boolean> {
  const prompt = directorPrompt.value.trim()
  if (!prompt) {
    directorMessage.value = '请输入动作指令描述'
    return false
  }

  // Antigravity 为外部 IDE Agent，生成提示词并引导用户/Agent 对齐
  if (boundHostId.value === 'antigravity' || boundHostId.value === 'standalone') {
    copyHostDirectorPrompt()
    directorMessage.value = `已为 ${boundHostLabel.value} 生成完整动作提示词并复制到剪贴板。发给 Agent 后，可将回复的 JSON 贴入下方应用！`
    return true
  }

  const fullPrompt = buildHostDirectorPrompt(
    prompt,
    '大肥鱼',
    {
      parameters: store.modelCapabilities?.parameters,
      modelEmotions: store.modelEmotions,
      modelControls: store.modelControls,
    },
    pairedGestures.value,
  )

  directorRunning.value = true
  directorMessage.value = `正在请求宿主【${boundHostLabel.value}】编排剧情…`
  try {
    const result = await (window as any).utaAPI?.sendHostMessage?.({
      host: boundHostId.value,
      text: fullPrompt,
    })

    if (!result || !result.ok) {
      const err = result?.error || '宿主未能响应，可能是会话离线或正忙'
      directorMessage.value = `${err}（可切换到「本地快速模式」直接生成）`
      store.presetSaveMessage = err
      store.presetSaveStatus = 'error'
      return false
    }

    const delivery = (result as any).delivery
    const rawOutput = String((result as any).text || (result as any).output || '').trim()
    const isQueued =
      delivery === 'queued' ||
      rawOutput.toLowerCase() === 'queued' ||
      (Boolean((result as any).accepted) && !rawOutput)

    if (isQueued) {
      directorMessage.value = `提示词已成功送达宿主【${boundHostLabel.value}】执行队列。待宿主回复后，您可复制其内容点击下方「粘贴计划」直接载入；或直接切换到「本地快速模式」即刻生成！`
      store.presetSaveMessage = '提示词已送达宿主队列'
      store.presetSaveStatus = 'success'
      return true
    }

    const plan = extractJsonFromHostReply(rawOutput)
    if (!plan) {
      directorMessage.value = '宿主已回复，但未解析出动作 JSON。回复内容已复制到剪贴板，您也可以切换到本地模式生成。'
      if (typeof navigator !== 'undefined' && navigator.clipboard && rawOutput) {
        void navigator.clipboard.writeText(rawOutput)
      }
      return false
    }

    const compiled = compileDirectorPlan(
      plan,
      {
        parameters: store.modelCapabilities?.parameters,
        modelEmotions: store.modelEmotions,
        modelControls: store.modelControls,
      },
      pairedGestures.value,
      currentEditingStep.value,
    )

    store.presetEditingLocked = true
    editingSteps.value = compiled
    editingStepIndex.value = 0
    directorMessage.value = `宿主已完成编排，生成 ${compiled.length} 个分镜：${plan.summary || prompt}`
    store.presetSaveMessage = `宿主导演：${plan.summary || prompt}`
    store.presetSaveStatus = 'success'

    playPreset(
      {
        id: `host_director_${Date.now()}`,
        label: prompt.slice(0, 20),
        description: plan.summary || '',
        emotion: 'neutral',
        group: '动作库',
        controls: [...currentEditingStep.value.controls],
        parameters: { ...currentEditingStep.value.parameters },
        steps: compiled,
        finishMode: 'hold',
        preview: true,
      },
      'hold',
    )
    return true
  } catch (error) {
    directorMessage.value = `请求宿主异常：${(error as Error)?.message || error}`
    return false
  } finally {
    directorRunning.value = false
  }
}


function generateDirectorSteps(): boolean {
  const prompt = directorPrompt.value.trim()
  if (!prompt) {
    directorMessage.value = '请输入动作指令描述'
    return false
  }
  directorRunning.value = true
  try {
    const plan = parseNaturalActionPrompt(
      prompt,
      {
        parameters: store.modelCapabilities?.parameters,
        modelEmotions: store.modelEmotions,
        modelControls: store.modelControls,
      },
      pairedGestures.value,
    )
    const compiled = compileDirectorPlan(
      plan,
      {
        parameters: store.modelCapabilities?.parameters,
        modelEmotions: store.modelEmotions,
        modelControls: store.modelControls,
      },
      pairedGestures.value,
      currentEditingStep.value,
    )
    if (!compiled || compiled.length === 0) {
      directorMessage.value = '未能生成有效动作步骤'
      return false
    }

    store.presetEditingLocked = true
    editingSteps.value = compiled
    editingStepIndex.value = 0
    directorMessage.value = `已编排 ${compiled.length} 个分镜：${plan.summary || prompt}`
    store.presetSaveMessage = `AI 导演：${plan.summary || prompt}`
    store.presetSaveStatus = 'success'

    playPreset(
      {
        id: `director_${Date.now()}`,
        label: prompt.slice(0, 20),
        description: plan.summary || '',
        emotion: 'neutral',
        group: '动作库',
        controls: [...currentEditingStep.value.controls],
        parameters: { ...currentEditingStep.value.parameters },
        steps: compiled,
        finishMode: 'hold',
        preview: true,
      },
      'hold',
    )
    return true
  } finally {
    directorRunning.value = false
  }
}

const currentEditingStep = computed<PresetKeyframeStep>(() => {
  const idx = Math.max(0, Math.min(editingSteps.value.length - 1, editingStepIndex.value))
  return (
    editingSteps.value[idx] ?? {
      label: '步骤 1',
      durationMs: 600,
      holdMs: 0,
      controls: [],
      parameters: {},
    }
  )
})

const motionSelection = computed(() => {
  const motion = currentEditingStep.value?.motion
  if (!isNativeMotionBinding(motion)) return 'none'
  const index = motion.index ?? 0
  const found = presetMotionOptions.value.findIndex(
    (option) => option.group === motion.group && (option.index ?? 0) === index,
  )
  return found >= 0 ? String(found) : 'none'
})

function onMotionSelect(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  const step = currentEditingStep.value
  if (!step) return
  if (value === 'none' || value === 'auto') {
    delete step.motion
  } else {
    const option = presetMotionOptions.value[Number(value)]
    if (option) {
      step.motion = { group: option.group, index: option.index ?? 0 }
    }
  }
  store.presetEditingLocked = true
  commitWorkshopHistory()
  previewStep(step, true)
}

interface WorkshopEditorSnapshot {
  name: string
  emotion: string
  group: string
  finishMode: PresetFinishMode
  motion: { group: string; index?: number } | 'none' | null
  steps: PresetKeyframeStep[]
}

function editorSnapshot(): string {
  return JSON.stringify({
    name: customPresetName.value,
    emotion: editingEmotion.value,
    group: editingGroup.value,
    finishMode: editingFinishMode.value,
    motion: editingMotion.value ?? null,
    steps: editingSteps.value,
  })
}

const workshopBaseline = ref(editorSnapshot())
const workshopHistory = createSnapshotHistory()
workshopHistory.reset(workshopBaseline.value)
const historyVersion = ref(0)
let historyTimer: ReturnType<typeof setTimeout> | null = null
let applyingEditorSnapshot = false

function flushHistoryTimer(): void {
  if (historyTimer) {
    clearTimeout(historyTimer)
    historyTimer = null
  }
}

function commitWorkshopHistory(): void {
  flushHistoryTimer()
  workshopHistory.commit(editorSnapshot())
  historyVersion.value += 1
}

watch(editorSnapshot, () => {
  if (applyingEditorSnapshot) return
  flushHistoryTimer()
  historyTimer = setTimeout(() => {
    historyTimer = null
    commitWorkshopHistory()
  }, 350)
})

const workshopDirty = computed(() => editorSnapshot() !== workshopBaseline.value)
let draftSignalTimer: ReturnType<typeof setInterval> | null = null
function stopDraftSignalTimer(): void {
  if (!draftSignalTimer) return
  clearInterval(draftSignalTimer)
  draftSignalTimer = null
}
watch(workshopDirty, dirty => {
  stopDraftSignalTimer()
  setWorkshopDraftSignal(dirty)
  if (dirty) {
    // Keep the cross-window hint fresh while the user edits for a long time.
    draftSignalTimer = setInterval(() => setWorkshopDraftSignal(true), 30_000)
  }
}, { immediate: true })
function onWorkshopDraftUnload(): void {
  stopDraftSignalTimer()
  setWorkshopDraftSignal(false)
}
if (typeof window !== 'undefined') window.addEventListener('beforeunload', onWorkshopDraftUnload)
const canUndoWorkshop = computed(() => {
  historyVersion.value
  return workshopHistory.canUndo()
})
const canRedoWorkshop = computed(() => {
  historyVersion.value
  return workshopHistory.canRedo()
})

function markWorkshopClean(): void {
  flushHistoryTimer()
  workshopBaseline.value = editorSnapshot()
  workshopHistory.reset(workshopBaseline.value)
  historyVersion.value += 1
}

const presetDraftGuardOpen = ref(false)
const presetDraftGuardTitle = ref('')
const presetDraftGuardBusy = ref(false)
const presetDraftGuardError = ref('')
const presetDraftGuardSaveRef = ref<HTMLButtonElement | null>(null)
let pendingPresetDraftAction: (() => void | Promise<void>) | null = null

function requestPresetDraftGuard(
  title: string,
  action: () => void | Promise<void>,
): void {
  if (!workshopDirty.value) {
    void action()
    return
  }
  if (presetDraftGuardOpen.value) return
  presetDraftGuardTitle.value = title
  presetDraftGuardError.value = ''
  presetDraftGuardBusy.value = false
  pendingPresetDraftAction = action
  presetDraftGuardOpen.value = true
  void nextTick(() => presetDraftGuardSaveRef.value?.focus())
}

function closePresetDraftGuard(): void {
  presetDraftGuardOpen.value = false
  presetDraftGuardTitle.value = ''
  presetDraftGuardError.value = ''
  presetDraftGuardBusy.value = false
  pendingPresetDraftAction = null
}

function continuePresetDraftEditing(): void {
  if (presetDraftGuardBusy.value) return
  closePresetDraftGuard()
}

function discardPresetDraftAndContinue(): void {
  if (presetDraftGuardBusy.value) return
  const action = pendingPresetDraftAction
  closePresetDraftGuard()
  void action?.()
}

async function savePresetDraftAndContinue(): Promise<void> {
  if (presetDraftGuardBusy.value) return
  presetDraftGuardBusy.value = true
  presetDraftGuardError.value = ''
  try {
    if (!saveCurrentCombo()) {
      presetDraftGuardError.value = store.presetSaveMessage || '保存工坊草稿失败，请检查名称后重试。'
      return
    }
    const action = pendingPresetDraftAction
    closePresetDraftGuard()
    await action?.()
  } finally {
    presetDraftGuardBusy.value = false
  }
}

function applyWorkshopSnapshot(raw: string): void {
  let parsed: WorkshopEditorSnapshot
  try {
    parsed = JSON.parse(raw) as WorkshopEditorSnapshot
  } catch {
    return
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.steps)) return
  applyingEditorSnapshot = true
  try {
    customPresetName.value = String(parsed.name ?? '')
    editingEmotion.value = String(parsed.emotion ?? 'neutral')
    editingGroup.value = String(parsed.group ?? '')
    editingFinishMode.value = parsed.finishMode === 'hold' || parsed.finishMode === 'loop'
      ? parsed.finishMode
      : 'revert'
    editingMotion.value = parsed.motion === 'none'
      ? 'none'
      : parsed.motion && typeof parsed.motion === 'object' && typeof parsed.motion.group === 'string'
        ? {
            group: parsed.motion.group,
            ...(Number.isFinite(parsed.motion.index) ? { index: Number(parsed.motion.index) } : {}),
          }
        : undefined
    const steps = parsed.steps.map((step, index) => ({
      label: String(step?.label ?? `步骤 ${index + 1}`),
      durationMs: Math.max(40, Math.min(5000, Math.round(Number(step?.durationMs) || 600))),
      holdMs: Math.max(0, Math.min(10000, Math.round(Number(step?.holdMs) || 0))),
      controls: Array.isArray(step?.controls)
        ? step.controls.filter((id): id is string => typeof id === 'string')
        : [],
      parameters: step?.parameters && typeof step.parameters === 'object'
        ? Object.fromEntries(
            Object.entries(step.parameters).filter(
              (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]),
            ),
          )
        : {},
      ...(step?.motion && typeof step.motion === 'object' && typeof (step.motion as any).group === 'string'
        ? {
            motion: {
              group: String((step.motion as any).group).trim(),
              ...(Number.isFinite((step.motion as any).index) ? { index: Number((step.motion as any).index) } : {}),
            },
          }
        : {}),
    }))
    editingSteps.value = steps.length > 0
      ? steps
      : [{ label: '步骤 1', durationMs: 600, holdMs: 0, controls: [], parameters: {} }]
    editingStepIndex.value = Math.max(0, Math.min(editingSteps.value.length - 1, editingStepIndex.value))
  } finally {
    applyingEditorSnapshot = false
  }
  store.presetEditingLocked = true
  previewStep(currentEditingStep.value, true)
}

function undoWorkshop(): void {
  commitWorkshopHistory()
  const snapshot = workshopHistory.undo()
  historyVersion.value += 1
  if (snapshot) applyWorkshopSnapshot(snapshot)
}

function redoWorkshop(): void {
  flushHistoryTimer()
  const snapshot = workshopHistory.redo()
  historyVersion.value += 1
  if (snapshot) applyWorkshopSnapshot(snapshot)
}

const unregisterWorkshopDraft = registerUnsavedDraft('workshop-draft', {
  label: '预设工坊草稿',
  kind: 'workshop',
  isDirty: () => workshopDirty.value,
  save: async () => saveCurrentCombo(),
})

const statePresets = computed(() => store.statePresets)
const expandedGroupName = ref('')
const lastDrawerGroupByRow = reactive<Record<number, string>>({})

type PresetGroupBucket = { group: string; emotion: string; items: ModelStatePreset[] }
type PresetGridSlot =
  | { kind: 'group'; grp: PresetGroupBucket; gIdx: number }
  | { kind: 'add-new' }

const groupedStatePresets = computed<PresetGroupBucket[]>(() => {
  const map = new Map<string, PresetGroupBucket>()
  for (const preset of statePresets.value) {
    const groupName = resolvePresetGroup(preset)
    let bucket = map.get(groupName)
    if (!bucket) {
      bucket = {
        group: groupName,
        emotion: preset.emotion || 'neutral',
        items: [],
      }
      map.set(groupName, bucket)
    }
    bucket.items.push(preset)
  }
  return Array.from(map.values())
})

const presetGridRows = computed<PresetGridSlot[][]>(() => {
  const slots: PresetGridSlot[] = groupedStatePresets.value.map((grp, gIdx) => ({
    kind: 'group',
    grp,
    gIdx,
  }))
  if (displayMode.value === 'live2d') {
    slots.push({ kind: 'add-new' })
  }
  const rows: PresetGridSlot[][] = []
  for (let i = 0; i < slots.length; i += 2) {
    rows.push(slots.slice(i, i + 2))
  }
  return rows
})

function isRowDrawerOpen(row: PresetGridSlot[]): boolean {
  if (!expandedGroupName.value) return false
  return row.some((s) => s.kind === 'group' && s.grp.group === expandedGroupName.value)
}

function getRowDrawerGroup(
  row: PresetGridSlot[],
  rIdx: number,
): { grp: PresetGroupBucket; gIdx: number } | null {
  const groupSlots = row.filter(
    (s): s is { kind: 'group'; grp: PresetGroupBucket; gIdx: number } => s.kind === 'group',
  )
  if (groupSlots.length === 0) return null
  if (expandedGroupName.value) {
    const activeHit = groupSlots.find((s) => s.grp.group === expandedGroupName.value)
    if (activeHit) return activeHit
  }
  const remembered = lastDrawerGroupByRow[rIdx]
  if (remembered) {
    const rememberedHit = groupSlots.find((s) => s.grp.group === remembered)
    if (rememberedHit) return rememberedHit
  }
  return groupSlots[0]
}

function isGroupActive(grp: { group: string; items: ModelStatePreset[] }): boolean {
  return !isCreatingNewPreset.value && grp.items.some((p) => p.id === activePresetId.value)
}

function isGroupPinned(grp: { group: string; items: ModelStatePreset[] }): boolean {
  return grp.items.some((p) => p.id === store.effectiveHoldPresetId)
}

function toggleExpandGroup(groupName: string, rIdx?: number, gIdx?: number) {
  if (typeof rIdx === 'number') {
    lastDrawerGroupByRow[rIdx] = groupName
  }
  const isClosing = expandedGroupName.value === groupName
  expandedGroupName.value = isClosing ? '' : groupName
  const dirX = typeof gIdx === 'number' ? (gIdx % 2 === 0 ? -1 : 1) : 0.7
  triggerHeroImpulse(dirX, isClosing ? 0.65 : 0.95)
}

function onGroupCapsuleClick(
  grp: { group: string; emotion: string; items: ModelStatePreset[] },
  gIdx: number,
) {
  if (grp.items[0]) {
    applyStatePreset(grp.items[0], gIdx)
  }
}

function togglePinGroup(grp: { group: string; items: ModelStatePreset[] }, gIdx: number) {
  const target =
    grp.items.find((p) => p.id === store.activeHoldPresetId) ??
    grp.items.find((p) => p.id === activePresetId.value) ??
    grp.items[0]
  if (target) {
    togglePinPreset(target, gIdx)
  }
}

function formatGroupPresetLabel(preset: ModelStatePreset, groupName: string): string {
  const raw = preset.label.trim()
  if (raw.startsWith(`${groupName}·`)) {
    const stripped = raw.slice(groupName.length + 1).trim()
    if (stripped) return stripped
  }
  return raw
}

function selectPresetGroupOption(groupName: string, emotion: string) {
  editingGroup.value = groupName
  editingEmotion.value = emotion
}

function triggerRandomInGroup(groupName: string, gIdx?: number) {
  const picked = pickRandomPresetInGroup(statePresets.value, groupName)
  if (picked) {
    applyStatePreset(picked, gIdx)
  }
}

const currentSelectedPreset = computed(() =>
  isCreatingNewPreset.value
    ? undefined
    : statePresets.value.find((p) => p.id === activePresetId.value),
)

const isCurrentPresetPinned = computed(
  () =>
    !!currentSelectedPreset.value &&
    store.effectiveHoldPresetId === currentSelectedPreset.value.id,
)

const isOverwritingPreset = computed(() => {
  const clean = customPresetName.value.trim().toLowerCase()
  if (!clean) return false
  return statePresets.value.some((p) => p.label.toLowerCase() === clean)
})

const saveButtonLabel = computed(() => {
  if (isCreatingNewPreset.value) {
    return isOverwritingPreset.value ? '覆盖同名预设' : '创建并保存'
  }
  return isOverwritingPreset.value ? '保存修改' : '另存为新预设'
})

const finishModeShortLabel = computed(() => {
  if (editingFinishMode.value === 'hold') return '持续保持'
  if (editingFinishMode.value === 'loop') return '循环往复'
  return '播完恢复'
})

const currentPresetBadgeText = computed(() => {
  if (isCreatingNewPreset.value) return finishModeShortLabel.value
  if (isCurrentPresetPinned.value) return '常驻基准'
  return finishModeShortLabel.value
})

const totalControlsCount = computed(() => store.modelControls.length)
const faceSliders = computed(() => store.modelSliders.filter((s) => s.group === 'face'))
const poseSliders = computed(() => store.modelSliders.filter((s) => s.group === 'pose'))
const extraSliders = computed(() => store.modelSliders.filter((s) => s.group === 'extra'))

const snippetParameters = computed(() => store.modelCapabilities?.parameters ?? [])

function canUseQuickSnippet(type: QuickSnippetType): boolean {
  return canBuildQuickSnippet(type, snippetParameters.value)
}

function quickSnippetTitle(type: QuickSnippetType): string {
  return canUseQuickSnippet(type)
    ? `追加两帧「${QUICK_SNIPPET_LABELS[type]}」关键帧`
    : QUICK_SNIPPET_REASONS[type]
}

function addQuickSnippet(type: QuickSnippetType): boolean {
  const steps = buildQuickSnippet(type, snippetParameters.value, currentEditingStep.value)
  if (!steps) {
    store.presetSaveStatus = 'error'
    store.presetSaveMessage = QUICK_SNIPPET_REASONS[type]
    return false
  }
  store.presetEditingLocked = true
  editingSteps.value.push(...steps)
  editingStepIndex.value = editingSteps.value.length - 1
  previewStep(editingSteps.value[editingStepIndex.value], true)
  return true
}

const CATEGORY_LABELS: Record<string, string> = {
  outfit: '服装配饰',
  hair: '发型发饰',
  pose_prop: '手部与道具',
  face_effect: '脸部特效',
  toggle: '其他开关',
  other: '其他部件',
}

const CATEGORY_ORDER = ['outfit', 'hair', 'pose_prop', 'face_effect', 'toggle', 'other']
const CATEGORY_ALIASES: Record<string, string> = {
  costume: 'outfit',
  hand: 'pose_prop',
  emotion: 'face_effect',
  prop: 'pose_prop',
}

const controlGroups = computed(() => {
  const buckets = new Map<string, ResolvedModelControl[]>()
  for (const ctrl of store.modelControls) {
    const cat = CATEGORY_LABELS[ctrl.category]
      ? ctrl.category
      : CATEGORY_ALIASES[ctrl.category] ?? 'other'
    let list = buckets.get(cat)
    if (!list) {
      list = []
      buckets.set(cat, list)
    }
    list.push(ctrl)
  }
  const stepControls = currentEditingStep.value.controls ?? []
  return CATEGORY_ORDER.filter((cat) => (buckets.get(cat)?.length ?? 0) > 0).map((cat) => {
    const items = buckets.get(cat) ?? []
    const activeCount = items.filter((item) =>
      stepControls.some((c) => c === item.id || c.startsWith(`${item.id}:`)),
    ).length
    return {
      category: cat,
      label: CATEGORY_LABELS[cat] ?? '其他部件',
      items,
      activeCount,
    }
  })
})

const currentStepActiveControls = computed<Array<{ id: string; label: string; stageLabel?: string }>>(() => {
  const step = currentEditingStep.value
  const result: Array<{ id: string; label: string; stageLabel?: string }> = []
  for (const rawId of step.controls ?? []) {
    const [baseId, stagePart] = rawId.split(':')
    const ctrl = store.modelControls.find((c) => c.id === rawId || c.id === baseId)
    const label = ctrl ? ctrl.label : baseId
    result.push({
      id: rawId,
      label,
      stageLabel: stagePart || (ctrl?.stages && ctrl.currentStageIndex !== undefined ? ctrl.stages[ctrl.currentStageIndex]?.label : undefined),
    })
  }
  return result
})

const currentStepModifiedSliders = computed<Array<{ id: string; label: string; value: number; diffText: string }>>(() => {
  const step = currentEditingStep.value
  const params = step.parameters ?? {}
  const list: Array<{ id: string; label: string; value: number; diffText: string }> = []
  for (const slider of store.modelSliders) {
    const val = params[slider.id]
    if (typeof val === 'number' && Number.isFinite(val) && Math.abs(val - slider.defaultValue) > 1e-3) {
      const diff = val - slider.defaultValue
      const sign = diff > 0 ? '+' : ''
      const formatted = Math.round(val * 100) / 100
      list.push({
        id: slider.id,
        label: slider.label,
        value: val,
        diffText: `${formatted} (${sign}${Math.round(diff * 100) / 100})`,
      })
    }
  }
  return list
})

/** 从当前正在编辑的分镜步骤读取滑块值（与舞台自动回退解耦，防止回退冲掉面板参数） */
function getStepSliderValue(slider: ResolvedModelSlider): number {
  const v = currentEditingStep.value.parameters[slider.id]
  return typeof v === 'number' && Number.isFinite(v) ? v : slider.defaultValue
}


function getSliderFillPercent(slider: ResolvedModelSlider): number {
  const val = getStepSliderValue(slider)
  const span = slider.max - slider.min
  if (span <= 0) return 0
  return Math.max(0, Math.min(100, ((val - slider.min) / span) * 100))
}


/** 手柄与填充共用百分比定位，保证手柄中心始终压在填充边缘。 */
function getSliderGripLeft(slider: ResolvedModelSlider): string {
  const percent = getSliderFillPercent(slider)
  return `clamp(8px, ${percent}%, calc(100% - 8px))`
}

function isStepSliderModified(slider: ResolvedModelSlider): boolean {
  return Math.abs(getStepSliderValue(slider) - slider.defaultValue) > 1e-3
}

function isStepControlActive(controlId: string): boolean {
  return currentEditingStep.value.controls.some((c) => c === controlId || c.startsWith(`${controlId}:`))
}

const modifiedFaceSliderCount = computed(
  () => faceSliders.value.filter((s) => isStepSliderModified(s)).length,
)
const modifiedPoseSliderCount = computed(
  () => poseSliders.value.filter((s) => isStepSliderModified(s)).length,
)
const modifiedExtraSliderCount = computed(
  () => extraSliders.value.filter((s) => isStepSliderModified(s)).length,
)
const activeStepControlsCount = computed(() => currentEditingStep.value.controls.length)

function formatControlLabel(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*$/, '').trim() || raw
}

function shouldSpanFullRow(ctrl: ResolvedModelControl, totalInGroup: number): boolean {
  return totalInGroup === 1 || formatControlLabel(ctrl.label).length > 6
}

function formatSliderValue(val: number, step: number): string {
  if (step >= 1) return String(Math.round(val))
  if (step >= 0.1) return val.toFixed(1)
  return val.toFixed(2)
}

function formatStepSec(ms: number): string {
  const sec = Math.max(0, ms) / 1000
  return Number(sec.toFixed(2)).toString()
}

function syncCurrentStepToLiveModel(transitionMs = 0): void {
  store.presetEditingLocked = true
  const step = currentEditingStep.value
  // 空控件步骤只同步滑块，不能把所有控件清空；
  // 否则模型默认的手、服饰会在调滑块/重置时一起消失。
  if (step.controls.length > 0) {
    for (const c of store.modelControls) {
      c.active = false
    }
    applyControlActionToList(
      store.modelControls,
      step.controls,
      'on',
      store.modelCapabilities,
    )
  }
  for (const s of store.modelSliders) {
    const v = step.parameters[s.id]
    s.value = typeof v === 'number' && Number.isFinite(v) ? v : s.defaultValue
  }
  syncSliders(transitionMs)
}

function loadPresetIntoEditor(preset: ModelStatePreset) {
  clearControlToggleSnapshot()
  isCreatingNewPreset.value = false
  activePresetId.value = preset.id
  previousPresetId.value = preset.id
  customPresetName.value = preset.label
  editingEmotion.value = preset.emotion || 'neutral'
  editingGroup.value = resolvePresetGroup(preset)
  editingFinishMode.value = getPresetDefaultFinishMode(preset)
  editingMotion.value = preset.motion
  const norm = normalizePresetSteps(preset).map((s, i) => ({
    label: s.label || `步骤 ${i + 1}`,
    durationMs: s.durationMs,
    holdMs: s.holdMs,
    controls: [...s.controls],
    parameters: { ...s.parameters },
    ...(s.motion ? { motion: { ...s.motion } } : {}),
  }))
  editingSteps.value = norm
  editingStepIndex.value = norm.length - 1
  // 设置窗口只是桌宠的镜像；加载预设时同步最终步骤的滑块值，
  // 否则工坊里再切换控件会用旧滑块把当前姿态（例如点菜手）顶掉。
  const finalStep = norm[norm.length - 1]
  for (const slider of store.modelSliders) {
    const value = finalStep?.parameters[slider.id]
    slider.value =
      typeof value === 'number' && Number.isFinite(value) ? value : slider.defaultValue
  }
  const finalControls = finalStep?.controls ?? []
  const finalControlSet = new Set(finalControls)
  for (const control of store.modelControls) {
    const directMatch = finalControlSet.has(control.id)
    const stageEntry = finalControls.find((c) => c.startsWith(`${control.id}:`))
    if (directMatch || stageEntry) {
      control.active = true
      if (stageEntry && control.stages && control.stages.length > 0) {
        const stageLabel = stageEntry.slice(control.id.length + 1)
        const stageIdx = control.stages.findIndex((s) => s.label === stageLabel)
        if (stageIdx >= 0) control.currentStageIndex = stageIdx
      }
    } else {
      control.active = false
      if (control.stages && control.stages.length > 0) {
        control.currentStageIndex = control.defaultStageIndex ?? 0
      }
    }
  }
  markWorkshopClean()
}

// 面板未打开时才跟随后台状态切换；打开期间绝不在「播完恢复」结束时强行跳回日常待机
watch(
  () => store.activeRunningPresetId,
  (runningId) => {
    if (props.open || store.presetEditingLocked || !runningId) return
    if (activePresetId.value === runningId) return
    const matched = statePresets.value.find((p) => p.id === runningId)
    if (matched) {
      loadPresetIntoEditor(matched)
    }
  },
)

function openStudioForCurrentPreset() {
  switchTab('studio')
  expandedSections.sequence = true
  if (editingSteps.value.length > 0) {
    selectEditingStep(Math.max(0, Math.min(editingSteps.value.length - 1, editingStepIndex.value)))
  }
}

function startNewPreset(targetGroup?: string, targetEmotion?: string) {
  requestPresetDraftGuard(
    '新建预设前，当前工坊还有未保存的修改。',
    () => startNewPresetNow(targetGroup, targetEmotion),
  )
}

function startNewPresetNow(targetGroup?: string, targetEmotion?: string) {
  clearControlToggleSnapshot()
  if (!isCreatingNewPreset.value && activePresetId.value && activePresetId.value !== '__new__') {
    previousPresetId.value = activePresetId.value
  }
  const baseGroup =
    targetGroup?.trim() ||
    (currentSelectedPreset.value ? resolvePresetGroup(currentSelectedPreset.value) : '自定义')
  const baseEmotion =
    targetEmotion?.trim() || currentSelectedPreset.value?.emotion || 'neutral'
  isCreatingNewPreset.value = true
  activePresetId.value = '__new__'
  editingGroup.value = baseGroup
  editingEmotion.value = baseEmotion
  customPresetName.value = targetGroup ? `${targetGroup}·` : ''
  editingFinishMode.value = baseEmotion === 'neutral' ? 'hold' : 'revert'
  editingMotion.value = undefined
  const persistentIds = store.modelControls
    .filter((c) => isPersistentControlCategory(c.category) && c.active)
    .map((c) => c.id)
  const firstStep: PresetKeyframeStep = {
    label: '步骤 1',
    durationMs: 600,
    holdMs: 0,
    controls: persistentIds,
    parameters: {},
  }
  editingSteps.value = [firstStep]
  editingStepIndex.value = 0
  switchTab('studio')
  expandedSections.sequence = true
  store.presetEditingLocked = true
  previewStep(firstStep, true)
  markWorkshopClean()
  void nextTick(() => {
    presetNameInputRef.value?.focus()
  })
}

function cancelNewPreset() {
  isCreatingNewPreset.value = false
  const fallback =
    statePresets.value.find((p) => p.id === previousPresetId.value) ??
    (store.activeHoldPresetId
      ? statePresets.value.find((p) => p.id === store.activeHoldPresetId)
      : undefined) ??
    statePresets.value[0]
  if (fallback) {
    applyStatePresetNow(fallback, 0)
  }
  switchTab('states')
}

function selectEditingStep(idx: number) {
  const target = editingSteps.value[idx]
  if (!target) return
  store.presetEditingLocked = true
  editingStepIndex.value = idx
  for (const slider of store.modelSliders) {
    const value = target.parameters?.[slider.id]
    slider.value = typeof value === 'number' && Number.isFinite(value) ? value : slider.defaultValue
  }

  const targetControls = target.controls ?? []
  const targetControlSet = new Set(targetControls)
  for (const control of store.modelControls) {
    const directMatch = targetControlSet.has(control.id)
    const stageEntry = targetControls.find((c) => c.startsWith(`${control.id}:`))
    if (directMatch || stageEntry) {
      control.active = true
      if (stageEntry && control.stages && control.stages.length > 0) {
        const stageLabel = stageEntry.slice(control.id.length + 1)
        const stageIdx = control.stages.findIndex((s) => s.label === stageLabel)
        if (stageIdx >= 0) control.currentStageIndex = stageIdx
      }
    } else {
      control.active = false
      if (control.stages && control.stages.length > 0) {
        control.currentStageIndex = control.defaultStageIndex ?? 0
      }
    }
  }

  // 智能自动展开有改动的手风琴项，消除折叠黑盒
  if (targetControls.length > 0) {
    expandedSections.controls = true
  }
  const hasFace = faceSliders.value.some(
    (s) => Math.abs((target.parameters?.[s.id] ?? s.defaultValue) - s.defaultValue) > 1e-3,
  )
  if (hasFace) expandedSections.face = true
  const hasPose = poseSliders.value.some(
    (s) => Math.abs((target.parameters?.[s.id] ?? s.defaultValue) - s.defaultValue) > 1e-3,
  )
  if (hasPose) expandedSections.pose = true
  const hasExtra = extraSliders.value.some(
    (s) => Math.abs((target.parameters?.[s.id] ?? s.defaultValue) - s.defaultValue) > 1e-3,
  )
  if (hasExtra) expandedSections.extra = true

  previewStep(target, true)
}

function addEditingStep() {
  store.presetEditingLocked = true
  const base = currentEditingStep.value
  const nextIdx = editingSteps.value.length + 1
  const newStep: PresetKeyframeStep = {
    label: `步骤 ${nextIdx}`,
    durationMs: 600,
    holdMs: 1000,
    controls: [...base.controls],
    parameters: { ...base.parameters },
  }
  editingSteps.value.push(newStep)
  editingStepIndex.value = editingSteps.value.length - 1
  previewStep(newStep, true)
}

function removeEditingStepAtIndex(idx: number) {
  if (editingSteps.value.length <= 1) return
  if (idx < 0 || idx >= editingSteps.value.length) return
  store.presetEditingLocked = true
  editingSteps.value.splice(idx, 1)
  const nextIdx = Math.max(0, Math.min(editingSteps.value.length - 1, editingStepIndex.value >= idx ? Math.max(0, editingStepIndex.value - 1) : editingStepIndex.value))
  editingStepIndex.value = nextIdx
  if (editingSteps.value[nextIdx]) {
    previewStep(editingSteps.value[nextIdx], true)
  }
}

function removeCurrentEditingStep() {
  removeEditingStepAtIndex(editingStepIndex.value)
}

function onStepDurationChange(e: Event) {
  const sec = parseFloat((e.target as HTMLInputElement).value)
  if (!Number.isFinite(sec)) return
  currentEditingStep.value.durationMs = Math.max(40, Math.min(5000, Math.round(sec * 1000)))
}

function onStepHoldChange(e: Event) {
  const sec = parseFloat((e.target as HTMLInputElement).value)
  if (!Number.isFinite(sec)) return
  currentEditingStep.value.holdMs = Math.max(0, Math.min(10000, Math.round(sec * 1000)))
}

async function exportEditingSequenceToMotion3(): Promise<boolean> {
  if (editingSteps.value.length === 0) {
    store.presetSaveStatus = 'error'
    store.presetSaveMessage = '分镜时间线为空，无法导出动作。'
    return false
  }

  const stepsWithMotion = editingSteps.value.filter(
    (s) => isNativeMotionBinding(s.motion),
  )
  if (wholeMotionLabel.value || stepsWithMotion.length > 0) {
    const motionNames = Array.from(new Set([wholeMotionLabel.value, ...stepsWithMotion.map((s) => s.motion!.group)].filter(Boolean))).join('、')
    store.presetSaveStatus = 'error'
    store.presetSaveMessage = `当前预设依赖原生动作（${motionNames}），无法完整导出为单个 motion3.json。请先保存为用户预设，再使用角色页的「用户预设 → 导出」。`
    return false
  }

  const name = customPresetName.value.trim() || activePresetId.value || 'uta-motion'
  const suggestedName = formatMotionFilename(name)

  let motionJson: unknown
  try {
    motionJson = exportPresetStepsToMotion3(
      editingSteps.value,
      {
        fps: 30,
        finishMode: editingFinishMode.value,
        revertHoldMs: 1600,
        excludePhysicsOutputs: true,
      },
      {
        sliders: store.modelSliders,
        controls: store.modelControls,
        capabilities: store.modelCapabilities,
      },
    )
  } catch (err) {
    store.presetSaveStatus = 'error'
    store.presetSaveMessage = (err as Error)?.message || '导出 motion3.json 失败'
    return false
  }

  const text = JSON.stringify(motionJson, null, 2)

  if (window.utaAPI?.exportMotionFile) {
    const res = await window.utaAPI.exportMotionFile({ suggestedName, text })
    if (res.ok) {
      store.presetSaveStatus = 'success'
      store.presetSaveMessage = `已成功导出标准 Live2D 动作文件：${suggestedName}`
      return true
    } else if (res.error === 'cancelled') {
      return false
    } else {
      store.presetSaveStatus = 'error'
      store.presetSaveMessage = '导出动作文件失败，请检查文件写入权限。'
      return false
    }
  }

  try {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = suggestedName
    a.click()
    URL.revokeObjectURL(url)
    store.presetSaveStatus = 'success'
    store.presetSaveMessage = `已下载动作文件：${suggestedName}`
    return true
  } catch {
    store.presetSaveStatus = 'error'
    store.presetSaveMessage = '下载动作文件失败。'
    return false
  }
}

function previewEditingSequence() {
  if (store.modelActionStatus === 'running') return
  store.presetEditingLocked = false
  store.beginPresetPreview()
  const lastStep = editingSteps.value[editingSteps.value.length - 1]
  const tempPreset: ModelStatePreset = {
    id: activePresetId.value || 'preview',
    label: customPresetName.value.trim() || '预览状态',
    group: editingGroup.value.trim() || undefined,
    description: '',
    emotion: editingEmotion.value || 'neutral',
    controls: lastStep ? [...lastStep.controls] : [],
    parameters: lastStep ? { ...lastStep.parameters } : {},
    steps: editingSteps.value.map((s) => ({
      label: s.label,
      durationMs: s.durationMs,
      holdMs: s.holdMs,
      controls: [...s.controls],
      parameters: { ...s.parameters },
      ...(s.motion ? { motion: { ...s.motion } } : {}),
    })),
    finishMode: editingFinishMode.value,
    motion: editingMotion.value,
    custom: true,
    preview: true,
  }
  playPreset(tempPreset, editingFinishMode.value)
}

let scrubPreviewTimer: ReturnType<typeof setTimeout> | null = null

function releaseWorkshopFromPanel(): void {
  clearControlToggleSnapshot()
  if (scrubPreviewTimer) { clearTimeout(scrubPreviewTimer); scrubPreviewTimer = null }
  store.presetEditingLocked = false
  store.endPresetPreview()
  void store.releaseModelWorkshop()
}

/** 拖动滑块时复用“点击步骤”的预览通道；80ms 合并一次，避免每个 input 都重启过渡 */
function scheduleScrubPreview(): void {
  if (scrubPreviewTimer) return
  scrubPreviewTimer = setTimeout(() => {
    scrubPreviewTimer = null
    store.presetEditingLocked = true
    previewStep(currentEditingStep.value, true)
  }, 80)
}

function onSliderInput(slider: ResolvedModelSlider, e: Event) {
  const num = parseFloat((e.target as HTMLInputElement).value)
  if (!Number.isFinite(num)) return
  const step = currentEditingStep.value
  const rounded = Math.round(num * 100) / 100
  if (Math.abs(rounded - slider.defaultValue) > 1e-3) {
    step.parameters = { ...step.parameters, [slider.id]: rounded }
  } else {
    const nextParams = { ...step.parameters }
    delete nextParams[slider.id]
    step.parameters = nextParams
  }
  // 和点击步骤完全同一路径：带 gaze lock、240ms 缓动，不再走 0ms 直跳。
  scheduleScrubPreview()
}

function resetSingleSlider(slider: ResolvedModelSlider) {
  const step = currentEditingStep.value
  const nextParams = { ...step.parameters }
  delete nextParams[slider.id]
  step.parameters = nextParams
  syncCurrentStepToLiveModel(600)
}

function resetSlidersByGroup(group: 'face' | 'pose' | 'extra') {
  const step = currentEditingStep.value
  const nextParams = { ...step.parameters }
  for (const s of store.modelSliders) {
    if (s.group === group) {
      delete nextParams[s.id]
    }
  }
  step.parameters = nextParams
  syncCurrentStepToLiveModel(600)
}

// ==================== motion-web Handfeel 物理弹簧与次级果冻引擎 ====================
let handfeelRafId = 0
let lastHandfeelTime = 0

// 1. 顶部导航栏胶囊滑块弹簧状态（§1 Underdamped Spring + §2 Velocity Coupling）
let navInitialized = false
let navX = 3
let navW = 64
let navTargetX = 3
let navTargetW = 64
let navVelX = 0
let navVelW = 0

// 2. 右下角鹅卵石次级果冻与流体共振状态（§4 Secondary Motion）
let pebbleJelly = 0
let pebbleJellyVel = 0

// 3. 左上角圆点磁吸与水滴果冻状态（Recipe #2 Magnetic Hover + §4）
let orbX = 0
let orbY = 0
let orbTargetX = 0
let orbTargetY = 0
let orbVelX = 0
let orbVelY = 0
let orbJelly = 0
let orbJellyVel = 0

// 4. 滚动速度耦合（驱动鹅卵石次级响应）
let lastScrollTop = 0
let scrollVel = 0

function wakeHandfeelLoop() {
  if (!props.open || !props.active || handfeelRafId) return
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  lastHandfeelTime = 0
  handfeelRafId = requestAnimationFrame(stepHandfeel)
}

function updateNavTarget(snapImmediate = false) {
  const navEl = navBarRef.value
  if (!navEl) return
  const activeBtn = navEl.querySelector('.bio-tab.active') as HTMLElement | null
  if (!activeBtn) return
  navTargetX = activeBtn.offsetLeft
  navTargetW = activeBtn.offsetWidth
  if (snapImmediate || !navInitialized) {
    navX = navTargetX
    navW = navTargetW
    navVelX = 0
    navVelW = 0
    navInitialized = true
    navEl.style.setProperty('--nav-x', `${navX.toFixed(2)}px`)
    navEl.style.setProperty('--nav-w', `${Math.max(28, navW).toFixed(2)}px`)
    navEl.style.setProperty('--nav-sx', '1')
    navEl.style.setProperty('--nav-sy', '1')
    navEl.style.setProperty('--nav-skew', '0deg')
  }
  wakeHandfeelLoop()
}

function triggerHeroImpulse(dirX = 0, strength = 1) {
  pebbleJellyVel += (dirX >= 0 ? 1.4 : -1.4) * strength
  wakeHandfeelLoop()
}

function switchTab(tab: 'states' | 'studio' | 'settings') {
  if (activeTab.value === tab) return
  if (activeTab.value === 'studio' && tab !== 'studio') {
    releaseWorkshopFromPanel()
  }
  activeTab.value = tab
  lastScrollTop = 0
  scrollVel = 0
  void nextTick(() => {
    updateNavTarget(false)
  })
}

function onOrbMouseMove(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement | null
  if (!el) return
  const r = el.getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  orbTargetX = (e.clientX - cx) * 0.38
  orbTargetY = (e.clientY - cy) * 0.38
  wakeHandfeelLoop()
}

function onOrbMouseLeave() {
  orbTargetX = 0
  orbTargetY = 0
  orbJellyVel += 0.8
  wakeHandfeelLoop()
}

function onPanelScroll(e: Event) {
  const el = e.currentTarget as HTMLElement | null
  if (!el) return
  const cur = el.scrollTop
  const delta = cur - lastScrollTop
  lastScrollTop = cur
  if (Math.abs(delta) < 120) {
    scrollVel = delta
    wakeHandfeelLoop()
  }
}

function stepHandfeel(now: number) {
  if (!props.open) {
    handfeelRafId = 0
    return
  }
  const rawDt = lastHandfeelTime ? (now - lastHandfeelTime) / 1000 : 1 / 60
  lastHandfeelTime = now
  const dt = Math.min(Math.max(rawDt, 0.001), 1 / 30)
  const frameScale = dt * 60

  const navEl = navBarRef.value
  const orbEl = orbBtnRef.value
  const pepEl = pebbleRef.value

  // 1. 顶部导航胶囊滑块：欠阻尼弹簧 + 速度耦合体积守恒拉伸（仅写入 navEl 叶子容器）
  if (navEl) {
    navVelX += (navTargetX - navX) * 84 * dt
    navVelX *= Math.pow(0.84, frameScale)
    navX += navVelX * dt

    navVelW += (navTargetW - navW) * 88 * dt
    navVelW *= Math.pow(0.85, frameScale)
    navW += navVelW * dt

    const speedStretch = Math.min(0.18, Math.abs(navVelX) * 0.00045)
    const navSx = 1 + speedStretch
    const navSy = 1 / navSx
    const navSkew = Math.max(-5, Math.min(5, -navVelX * 0.006))

    navEl.style.setProperty('--nav-x', `${navX.toFixed(2)}px`)
    navEl.style.setProperty('--nav-w', `${Math.max(28, navW).toFixed(2)}px`)
    navEl.style.setProperty('--nav-sx', navSx.toFixed(3))
    navEl.style.setProperty('--nav-sy', navSy.toFixed(3))
    navEl.style.setProperty('--nav-skew', `${navSkew.toFixed(2)}deg`)
  }

  // 2. 右下角鹅卵石：次级流体果冻（仅写入 pepEl 叶子节点）
  const primaryDrive = Math.max(-1.2, Math.min(1.2, scrollVel * 0.018))
  pebbleJellyVel += (primaryDrive - pebbleJelly) * 56 * dt
  pebbleJellyVel *= Math.pow(0.88, frameScale)
  pebbleJelly += pebbleJellyVel * dt
  scrollVel *= Math.pow(0.84, frameScale)

  if (pepEl) {
    const pepRot = pebbleJelly * 16
    const pepSx = Math.max(0.78, Math.min(1.26, 1 + pebbleJelly * 0.22))
    const pepSy = Math.max(0.78, Math.min(1.26, 1 / pepSx))
    pepEl.style.setProperty('--pep-rot', `${pepRot.toFixed(2)}deg`)
    pepEl.style.setProperty('--pep-sx', pepSx.toFixed(3))
    pepEl.style.setProperty('--pep-sy', pepSy.toFixed(3))
  }

  // 3. 左上角圆点：磁吸跟随 + 水滴果冻（仅写入 orbEl 叶子节点）
  orbVelX += (orbTargetX - orbX) * 92 * dt
  orbVelX *= Math.pow(0.82, frameScale)
  orbX += orbVelX * dt

  orbVelY += (orbTargetY - orbY) * 92 * dt
  orbVelY *= Math.pow(0.82, frameScale)
  orbY += orbVelY * dt

  orbJellyVel += (0 - orbJelly) * 68 * dt
  orbJellyVel *= Math.pow(0.86, frameScale)
  orbJelly += orbJellyVel * dt

  if (orbEl) {
    const orbStretch = Math.max(0.82, Math.min(1.22, 1 + orbJelly * 0.18))
    const orbSx = orbStretch
    const orbSy = 1 / orbStretch
    orbEl.style.setProperty('--orb-x', `${orbX.toFixed(2)}px`)
    orbEl.style.setProperty('--orb-y', `${orbY.toFixed(2)}px`)
    orbEl.style.setProperty('--orb-sx', orbSx.toFixed(3))
    orbEl.style.setProperty('--orb-sy', orbSy.toFixed(3))
  }

  const navRest =
    Math.abs(navTargetX - navX) < 0.08 &&
    Math.abs(navTargetW - navW) < 0.08 &&
    Math.abs(navVelX) < 0.15 &&
    Math.abs(navVelW) < 0.15
  const pepRest =
    Math.abs(pebbleJelly) < 0.004 &&
    Math.abs(pebbleJellyVel) < 0.01 &&
    Math.abs(scrollVel) < 0.1
  const orbRest =
    Math.abs(orbTargetX - orbX) < 0.05 &&
    Math.abs(orbTargetY - orbY) < 0.05 &&
    Math.abs(orbVelX) < 0.1 &&
    Math.abs(orbVelY) < 0.1 &&
    Math.abs(orbJelly) < 0.004 &&
    Math.abs(orbJellyVel) < 0.01

  if (navRest && pepRest && orbRest) {
    handfeelRafId = 0
    return
  }

  handfeelRafId = requestAnimationFrame(stepHandfeel)
}

function startHandfeelLoop() {
  if (handfeelRafId) cancelAnimationFrame(handfeelRafId)
  handfeelRafId = 0
  lastHandfeelTime = 0
  navInitialized = false
  void nextTick(() => {
    updateNavTarget(true)
  })
}

function stopHandfeelLoop() {
  if (handfeelRafId) {
    cancelAnimationFrame(handfeelRafId)
    handfeelRafId = 0
  }
}

function applyStatePreset(preset: ModelStatePreset, idx?: number) {
  if (
    !isCreatingNewPreset.value &&
    activePresetId.value === preset.id &&
    workshopDirty.value
  ) {
    // 同一个预设只重播，不重新载入编辑器，避免草稿和撤销历史被冲掉。
    store.presetEditingLocked = false
    store.endPresetPreview()
    triggerHeroImpulse(typeof idx === 'number' ? (idx % 2 === 0 ? -1 : 1) : 0, 1)
    if (displayMode.value === 'live2d') {
      playPreset(preset)
    } else {
      store.currentEmotion = preset.emotion
      store.emotionPulse++
    }
    return
  }
  requestPresetDraftGuard(
    `切换到「${preset.label}」前，当前工坊还有未保存的修改。`,
    () => applyStatePresetNow(preset, idx),
  )
}

function applyStatePresetNow(preset: ModelStatePreset, idx?: number) {
  store.presetEditingLocked = false
  store.endPresetPreview()
  const dirX = typeof idx === 'number' ? (idx % 2 === 0 ? -1 : 1) : 0
  triggerHeroImpulse(dirX, 1)
  loadPresetIntoEditor(preset)
  if (displayMode.value === 'live2d') {
    playPreset(preset, getPresetDefaultFinishMode(preset))
  } else {
    void store.requestModelAction({ type: 'set-emotion', emotion: preset.emotion }).then(result => {
      if (result.ok) { store.currentEmotion = preset.emotion; store.emotionPulse++ }
    })
  }
}

function togglePinPreset(preset: ModelStatePreset, idx?: number) {
  if (store.activeHoldPresetId === preset.id) {
    togglePinPresetNow(preset, idx)
    return
  }
  requestPresetDraftGuard(
    `将「${preset.label}」设为常驻基准前，当前工坊还有未保存的修改。`,
    () => togglePinPresetNow(preset, idx),
  )
}

function togglePinPresetNow(preset: ModelStatePreset, idx?: number) {
  store.presetEditingLocked = false
  store.endPresetPreview()
  const dirX = typeof idx === 'number' ? (idx % 2 === 0 ? -1 : 1) : 0.6
  triggerHeroImpulse(dirX, 1.15)
  if (store.activeHoldPresetId === preset.id) {
    // 取消常驻：清空常驻 ID，当前选中的预设卡片不跳走，舞台平滑回到日常待机
    store.activeHoldPresetId = ''
    setPetHoldPreset('')
    const neutralPreset = statePresets.value.find((p) => p.id === 'neutral')
    if (neutralPreset && displayMode.value === 'live2d') {
      playPreset(neutralPreset, 'hold')
    }
    return
  }
  const sameActive = !isCreatingNewPreset.value && activePresetId.value === preset.id
  store.activeHoldPresetId = preset.id
  setPetHoldPreset(preset.id)
  if (!sameActive) loadPresetIntoEditor(preset)
  if (displayMode.value === 'live2d') {
    playPreset(preset, 'hold')
  }
}

function saveCurrentCombo(): boolean {
  const name = customPresetName.value.trim()
  if (!name) {
    store.presetSaveStatus = 'error'
    store.presetSaveMessage = '请先给预设起一个名称，再保存。'
    return false
  }
  const saved = store.saveCustomPreset(name, undefined, undefined, editingEmotion.value, {
    group: editingGroup.value.trim() || undefined,
    steps: editingSteps.value,
    finishMode: editingFinishMode.value,
    motion: editingMotion.value,
  })
  if (!saved) return false
  store.presetEditingLocked = false
  store.endPresetPreview()
  loadPresetIntoEditor(saved)
  if (displayMode.value === 'live2d') {
    playPreset(saved)
  }
  return true
}

function removeCustomPreset(id: string) {
  if (!store.deleteCustomPreset(id)) return
  setPetHoldPreset(store.activeHoldPresetId)
  if (activePresetId.value === id) {
    const fallback = statePresets.value[0]
    if (fallback) {
      loadPresetIntoEditor(fallback)
    } else {
      activePresetId.value = ''
      customPresetName.value = ''
    }
  }
}

function onRestoreDefaultPresets() {
  const restored = store.restoreDefaultPresets()
  if (!restored) return
  store.activeHoldPresetId = ''
  setPetHoldPreset('')
  if (restored.length > 0) {
    applyStatePresetNow(restored[0], 0)
  }
}

type ControlToggleSnapshot = {
  controlId: string
  stepIndex: number
  stepControls: string[]
  controls: Array<[string, boolean]>
  sliders: Array<[string, number]>
}

/**
 * 工坊里开一个部件常常会触发互斥，把原来的手/道具控件顶掉。
 * 取消这个部件时要回到开启前的现场，而不是只把它自己关掉。
 */
let controlToggleSnapshot: ControlToggleSnapshot | null = null

function captureControlToggleState(controlId: string): ControlToggleSnapshot {
  return {
    controlId,
    stepIndex: editingStepIndex.value,
    stepControls: [...currentEditingStep.value.controls],
    controls: store.modelControls.map((control) => [control.id, control.active]),
    sliders: store.modelSliders.map((slider) => [slider.id, slider.value]),
  }
}

function restoreControlToggleState(snapshot: ControlToggleSnapshot): void {
  const activeById = new Map(snapshot.controls)
  for (const control of store.modelControls) {
    if (activeById.has(control.id)) control.active = activeById.get(control.id)!
  }
  const valueById = new Map(snapshot.sliders)
  for (const slider of store.modelSliders) {
    if (valueById.has(slider.id)) slider.value = valueById.get(slider.id)!
  }
  if (editingStepIndex.value === snapshot.stepIndex) {
    currentEditingStep.value.controls = [...snapshot.stepControls]
  }
  syncSliders(600)
}

function clearControlToggleSnapshot(): void {
  controlToggleSnapshot = null
}

function toggleSingleControl(controlId: string) {
  const step = currentEditingStep.value
  const ctrl = store.modelControls.find((c) => c.id === controlId)
  if (ctrl?.stages && ctrl.stages.length > 0) {
    const stageCount = ctrl.stages.length
    const defIdx = ctrl.defaultStageIndex ?? 0
    const curIdx = ctrl.currentStageIndex ?? defIdx
    const nextIdx = (curIdx + 1) % stageCount

    step.controls = step.controls.filter((c) => c !== controlId && !c.startsWith(`${controlId}:`))
    if (nextIdx !== defIdx || ctrl.defaultActive) {
      const stageLabel = ctrl.stages[nextIdx].label
      step.controls.push(`${controlId}:${stageLabel}`)
    }
    store.presetEditingLocked = true
    applyControlActionToList(store.modelControls, [`${controlId}:${ctrl.stages[nextIdx].label}`], 'toggle', store.modelCapabilities)
    syncSliders(600)
    return
  }

  const wasActive =
    store.modelControls.find((control) => control.id === controlId)?.active === true ||
    step.controls.includes(controlId)
  if (!wasActive) {
    controlToggleSnapshot = captureControlToggleState(controlId)
  }
  const tempControls = store.modelControls.map((c) => ({
    ...c,
    active: step.controls.includes(c.id),
  }))
  applyControlActionToList(tempControls, controlId, 'toggle', store.modelCapabilities)
  step.controls = tempControls.filter((c) => c.active).map((c) => c.id)
  // 只切换这一个控件，不能走整步重置；整步重置会把默认控件一起关掉。
  store.presetEditingLocked = true
  applyControlActionToList(
    store.modelControls,
    [controlId],
    step.controls.includes(controlId) ? 'on' : 'off',
    store.modelCapabilities,
  )
  if (wasActive && controlToggleSnapshot?.controlId === controlId) {
    const snapshot = controlToggleSnapshot
    controlToggleSnapshot = null
    restoreControlToggleState(snapshot)
    return
  }
  syncSliders(600)
}

function resetTransientControls() {
  clearControlToggleSnapshot()
  store.presetEditingLocked = true
  const step = currentEditingStep.value
  step.controls = step.controls.filter((id) => {
    const ctrl = store.modelControls.find((c) => c.id === id)
    return ctrl ? isPersistentControlCategory(ctrl.category) : false
  })
  const transientIds = store.modelControls
    .filter((c) => c.active && !isPersistentControlCategory(c.category))
    .map((c) => c.id)
  if (transientIds.length > 0) {
    applyControlActionToList(
      store.modelControls,
      transientIds,
      'off',
      store.modelCapabilities,
    )
  }
  syncSliders(600)
}

function resetAllControls() {
  clearControlToggleSnapshot()
  store.presetEditingLocked = false
  store.activeHoldPresetId = ''
  setPetHoldPreset('')
  isCreatingNewPreset.value = false
  triggerHeroImpulse(0, 0.9)
  const neutralPreset = statePresets.value.find((p) => p.id === 'neutral')
  if (neutralPreset) {
    loadPresetIntoEditor(neutralPreset)
  } else {
    activePresetId.value = 'neutral'
    customPresetName.value = ''
    editingSteps.value = [
      { label: '步骤 1', durationMs: 600, holdMs: 0, controls: [], parameters: {} },
    ]
    editingStepIndex.value = 0
    editingFinishMode.value = 'hold'
  }
  void store.requestModelAction({ type: 'control-action', control: '*', action: 'reset' })
  store.currentEmotion = 'neutral'
  store.emotionPulse++
}

const orbColorInputRef = ref<HTMLInputElement | null>(null)
const quickModelBarOpen = ref(false)

const orbTooltip = computed(() => {
  switch (store.orbAction) {
    case 'model_picker':
      return '快捷圆点：点击展开/收起模型选择栏（可在面板设置中更改）'
    case 'toggle_display_mode':
      return `快捷圆点：点击切换至${displayMode.value === 'live2d' ? '静态立绘' : 'Live2D 模型'}（可在面板设置中更改）`
    case 'color_picker':
      return '快捷圆点：点击打开自定义调色盘（可在面板设置中更改）'
    case 'toggle_theme':
      return `快捷圆点：点击切换至${store.themeMode === 'dark' ? '日间模式' : '夜间模式'}（可在面板设置中更改）`
    default:
      return '快捷圆点'
  }
})

function toggleQuickDisplayMode() {
  const nextKind: ModelKind = displayMode.value === 'live2d' ? 'image-set' : 'live2d'
  void setDisplayMode(nextKind)
}

function onOrbClick() {
  orbJellyVel += 2.8
  pebbleJellyVel += 1.6
  wakeHandfeelLoop()
  switch (store.orbAction) {
    case 'model_picker':
      quickModelBarOpen.value = !quickModelBarOpen.value
      break
    case 'toggle_display_mode':
      toggleQuickDisplayMode()
      break
    case 'color_picker':
      orbColorInputRef.value?.click()
      break
    case 'toggle_theme':
      store.themeMode = store.themeMode === 'dark' ? 'light' : 'dark'
      break
  }
}

function onAccentColorInput(e: Event) {
  const val = (e.target as HTMLInputElement).value
  if (val) store.accentColor = val
}

const models = ref<Awaited<ReturnType<typeof listAvailableModels>>>([])
const selectedModel = ref('')
const switching = ref(false)

const displayMode = computed<ModelKind>(() => {
  const current = selectedModel.value || store.modelUrl
  return current ? kindOfModelUrl(current) : 'live2d'
})

const filteredModels = computed(() => models.value.filter((m) => m.kind === displayMode.value))

const currentModelDisplayName = computed(() => {
  const found = filteredModels.value.find((m) => m.url === selectedModel.value)
  if (found) return found.name
  if (filteredModels.value.length > 0) return filteredModels.value[0].name
  return displayMode.value === 'live2d' ? '未发现 Live2D 模型' : '未发现静态立绘包'
})

async function setDisplayMode(kind: ModelKind) {
  if (kind === displayMode.value) return
  const remembered = getStoredModelForKind(kind)
  const memoryKey = remembered ? normalizeModelKey(remembered) : ''
  const rememberedModel = remembered
    ? models.value.find((m) => m.url === remembered || normalizeModelKey(m.url) === memoryKey)
    : undefined
  const first = rememberedModel ?? models.value.find((m) => m.kind === kind)
  if (!first) return
  switching.value = true
  try {
    await store.requestModelSwitch(first.url)
  } catch {
    // The asynchronous action banner already describes the failure; keep the current model.
  } finally {
    switching.value = false
    selectedModel.value = store.modelUrl || first.url
    void nextTick(() => updateNavTarget(false))
  }
}

async function loadModels(forceRescan = false) {
  models.value = await listAvailableModels(forceRescan)
  selectedModel.value = store.modelUrl || getStoredModelPath() || models.value[0]?.url || ''
}

onMounted(() => {
  void loadModels()
  const initialPreset = statePresets.value.find((p) => p.id === activePresetId.value) ?? statePresets.value[0]
  if (initialPreset) {
    loadPresetIntoEditor(initialPreset)
  }
  if (props.open) {
    startHandfeelLoop()
  }
})

onUnmounted(() => {
  unregisterWorkshopDraft()
  if (typeof window !== 'undefined') window.removeEventListener('beforeunload', onWorkshopDraftUnload)
  stopDraftSignalTimer()
  setWorkshopDraftSignal(false)
  flushHistoryTimer()
  releaseWorkshopFromPanel()
  stopHandfeelLoop()
})

watch(
  () => props.active,
  active => {
    if (active) {
      startHandfeelLoop()
      return
    }
    stopHandfeelLoop()
    flushHistoryTimer()
    store.presetEditingLocked = false
    store.endPresetPreview()
  },
)

watch(
  () => props.open,
  (open) => {
    if (open) {
      void loadModels()
      startHandfeelLoop()
    } else {
      releaseWorkshopFromPanel()
      stopHandfeelLoop()
    }
  },
)
watch(
  () => store.modelUrl,
  (url) => {
    if (url) {
      selectedModel.value = url
      activePresetId.value = 'neutral'
      const neutral = statePresets.value.find((p) => p.id === 'neutral') ?? statePresets.value[0]
      if (neutral) loadPresetIntoEditor(neutral)
    }
  },
)

async function rescan() {
  await loadModels(true)
}

function openModelsFolder() {
  void window.utaAPI?.openModelsFolder()
}

async function selectModelUrl(url: string) {
  if (!url || url === store.modelUrl) {
    return
  }
  switching.value = true
  try {
    await store.requestModelSwitch(url)
  } catch {
    // Keep the selected model and let the action banner show the real error.
  } finally {
    switching.value = false
    selectedModel.value = store.modelUrl || url
  }
}

function reload() {
  void window.utaAPI?.reloadWindow()
}

/**
 * 拆分后的「状态预设」「预设工坊」子页签共用这份工作区。
 * reactive 会自动解包其中的 ref/computed；子组件模板读写属性等价于读写父组件原 ref。
 */
const workshop: SettingsWorkshop = reactive({
  pebbleRef,
  presetNameInputRef,
  bindPebbleRef,
  bindPresetNameInput,

  activePresetId,
  isCreatingNewPreset,
  customPresetName,
  editingSteps,
  editingStepIndex,
  currentEditingStep,
  editingFinishMode,
  editingGroup,
  presetMotionOptions,
  nativeMotionOptions,
  nativeMotionName,
  saveNativeMotionPreset,
  saveAllNativeMotionPresets,
  previewNativeMotionPreset,
  pairedGestures,
  addPairedGestureSnippet,
  savePairedGesturePreset,
  previewPairedGesture,
  directorPrompt,
  directorRunning,
  directorMessage,
  directorEngine,
  boundHostId,
  boundHostLabel,
  generateDirectorSteps,
  applyDirectorPromptSample,
  sendPromptToHostDirector,
  copyHostDirectorPrompt,
  pasteAndApplyDirectorJson,
  motionSelection,
  wholeMotionLabel,
  clearWholeMotion,
  onMotionSelect,
  expandedSections,
  workshopDirty,
  canUndoWorkshop,
  canRedoWorkshop,
  undoWorkshop,
  redoWorkshop,

  statePresets,
  currentSelectedPreset,
  isCurrentPresetPinned,
  currentPresetBadgeText,
  saveButtonLabel,
  finishModeShortLabel,
  groupedStatePresets,
  presetGridRows,
  expandedGroupName,
  displayMode,
  store,

  totalControlsCount,
  controlGroups,
  activeStepControlsCount,
  faceSliders,
  poseSliders,
  extraSliders,
  modifiedFaceSliderCount,
  modifiedPoseSliderCount,
  modifiedExtraSliderCount,
  PRESET_EMOTION_GROUPS,
  // 分组芯片按当前模型的预设推导，避免与预设包脱节
  presetGroupOptions: () => derivePresetGroupOptions(statePresets.value),

  openStudioForCurrentPreset,
  togglePinPreset,
  removeCustomPreset,
  onRestoreDefaultPresets,
  resetAllControls,
  isGroupActive,
  isGroupPinned,
  onGroupCapsuleClick,
  toggleExpandGroup,
  togglePinGroup,
  startNewPreset,
  isRowDrawerOpen,
  getRowDrawerGroup,
  triggerRandomInGroup,
  applyStatePreset,
  formatGroupPresetLabel,

  toggleSection,
  selectEditingStep,
  addEditingStep,
  addQuickSnippet,
  canUseQuickSnippet,
  quickSnippetTitle,
  removeEditingStepAtIndex,
  removeCurrentEditingStep,
  onStepDurationChange,
  onStepHoldChange,
  previewEditingSequence,
  exportEditingSequenceToMotion3,
  selectPresetGroupOption,
  saveCurrentCombo,
  cancelNewPreset,
  resetTransientControls,
  toggleSingleControl,
  isStepControlActive,
  shouldSpanFullRow,
  formatControlLabel,
  resetSlidersByGroup,
  getSliderFillPercent,
  getSliderGripLeft,
  isStepSliderModified,
  resetSingleSlider,
  currentStepActiveControls,
  currentStepModifiedSliders,
  formatSliderValue,
  getStepSliderValue,
  onSliderInput,
  formatStepSec,
})

provide('settingsWorkshop', workshop)
</script>

<style src="./styles/settings-panel.css"></style>
