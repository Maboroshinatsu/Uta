import { inject } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import type {
  ModelStatePreset,
  PresetFinishMode,
  PresetKeyframeStep,
  ResolvedModelControl,
  ResolvedModelSlider,
} from '@/services/live2d/emotion-adapter'
import type { ModelKind } from '@/services/live2d/model-discovery'
import type { QuickSnippetType } from '@/services/preset-snippets'
import type { NativeMotionOption } from '@/services/live2d/preset-motion-options'
import type { PairedGesture } from '@/services/live2d/gesture-pairing'

/** 状态预设按分组聚合后的桶（与 SettingsPanel 内部结构保持一致） */
export type PresetGroupBucket = {
  group: string
  emotion: string
  items: ModelStatePreset[]
}

/** 两列布局中的单个槽位：一个分组胶囊，或「+ 新建预设」按钮 */
export type PresetGridSlot =
  | { kind: 'group'; grp: PresetGroupBucket; gIdx: number }
  | { kind: 'add-new' }

export interface SettingsExpandedSections {
  sequence: boolean
  controls: boolean
  face: boolean
  pose: boolean
  extra: boolean
}

/**
 * 拆分后的「状态预设」「预设工坊」子页签共享的父级工作区。
 * 所有 ref 放进 reactive 后由 Vue 自动解包，写入属性等价于写回原 ref。
 */
export interface SettingsWorkshop {
  // ==================== 状态预设同步 ====================
  pebbleRef: HTMLElement | null
  presetNameInputRef: HTMLInputElement | null
  bindPebbleRef: (el: Element | ComponentPublicInstance | null) => void
  bindPresetNameInput: (el: Element | ComponentPublicInstance | null) => void

  // ==================== 预设编辑器状态 ====================
  activePresetId: string
  isCreatingNewPreset: boolean
  customPresetName: string
  editingSteps: PresetKeyframeStep[]
  editingStepIndex: number
  currentEditingStep: PresetKeyframeStep
  editingFinishMode: PresetFinishMode
  editingGroup: string
  presetMotionOptions: Array<{ group: string; index: number; label: string; safe: boolean }>
  nativeMotionOptions: NativeMotionOption[]
  nativeMotionName: string
  saveNativeMotionPreset: (motion: NativeMotionOption) => void
  saveAllNativeMotionPresets: () => void
  previewNativeMotionPreset: (motion: NativeMotionOption) => void
  pairedGestures: PairedGesture[]
  addPairedGestureSnippet: (gesture: PairedGesture) => boolean
  savePairedGesturePreset: (gesture: PairedGesture) => void
  previewPairedGesture: (gesture: PairedGesture) => void
  directorPrompt: string
  directorRunning: boolean
  directorMessage: string
  directorEngine: 'local' | 'host'
  boundHostId: string
  boundHostLabel: string
  generateDirectorSteps: () => boolean
  applyDirectorPromptSample: (sample: string) => void
  sendPromptToHostDirector: () => Promise<boolean>
  copyHostDirectorPrompt: () => void
  pasteAndApplyDirectorJson: (raw: string) => boolean
  motionSelection: string
  wholeMotionLabel: string
  clearWholeMotion: () => void
  onMotionSelect: (event: Event) => void
  expandedSections: SettingsExpandedSections
  workshopDirty: boolean
  canUndoWorkshop: boolean
  canRedoWorkshop: boolean
  undoWorkshop: () => void
  redoWorkshop: () => void

  // ==================== 状态预设视图数据 ====================
  statePresets: ModelStatePreset[]
  currentSelectedPreset: ModelStatePreset | undefined
  isCurrentPresetPinned: boolean
  currentPresetBadgeText: string
  saveButtonLabel: string
  finishModeShortLabel: string
  groupedStatePresets: PresetGroupBucket[]
  presetGridRows: PresetGridSlot[][]
  expandedGroupName: string
  displayMode: ModelKind
  store: { activeHoldPresetId: string; effectiveHoldPresetId: string; presetSaveStatus?: 'idle' | 'success' | 'error'; presetSaveMessage?: string }

  // ==================== 预设工坊视图数据 ====================
  totalControlsCount: number
  controlGroups: Array<{
    category: string
    label: string
    items: ResolvedModelControl[]
    activeCount: number
  }>
  activeStepControlsCount: number
  faceSliders: ResolvedModelSlider[]
  poseSliders: ResolvedModelSlider[]
  extraSliders: ResolvedModelSlider[]
  modifiedFaceSliderCount: number
  modifiedPoseSliderCount: number
  modifiedExtraSliderCount: number
  currentStepActiveControls: Array<{ id: string; label: string; stageLabel?: string }>
  currentStepModifiedSliders: Array<{ id: string; label: string; value: number; diffText: string }>
  PRESET_EMOTION_GROUPS: ReadonlyArray<{ group: string; emotion: string }>
  /** 当前模型实际存在的状态预设分组（工坊芯片用），无预设时回退到上面的静态表。 */
  presetGroupOptions: () => ReadonlyArray<{ group: string; emotion: string }>

  // ==================== 状态预设交互 ====================
  openStudioForCurrentPreset: () => void
  togglePinPreset: (preset: ModelStatePreset, idx?: number) => void
  removeCustomPreset: (id: string) => void
  onRestoreDefaultPresets: () => void
  resetAllControls: () => void
  isGroupActive: (grp: PresetGroupBucket) => boolean
  isGroupPinned: (grp: PresetGroupBucket) => boolean
  onGroupCapsuleClick: (grp: PresetGroupBucket, gIdx: number) => void
  toggleExpandGroup: (groupName: string, rIdx?: number, gIdx?: number) => void
  togglePinGroup: (grp: PresetGroupBucket, gIdx: number) => void
  startNewPreset: (targetGroup?: string, targetEmotion?: string) => void
  isRowDrawerOpen: (row: PresetGridSlot[]) => boolean
  getRowDrawerGroup: (
    row: PresetGridSlot[],
    rIdx: number,
  ) => { grp: PresetGroupBucket; gIdx: number } | null
  triggerRandomInGroup: (groupName: string, gIdx?: number) => void
  applyStatePreset: (preset: ModelStatePreset, idx?: number) => void
  formatGroupPresetLabel: (preset: ModelStatePreset, groupName: string) => string

  // ==================== 预设工坊交互 ====================
  toggleSection: (key: keyof SettingsExpandedSections) => void
  selectEditingStep: (idx: number) => void
  addEditingStep: () => void
  addQuickSnippet: (type: QuickSnippetType) => boolean
  canUseQuickSnippet: (type: QuickSnippetType) => boolean
  quickSnippetTitle: (type: QuickSnippetType) => string
  removeEditingStepAtIndex: (idx: number) => void
  removeCurrentEditingStep: () => void
  onStepDurationChange: (e: Event) => void
  onStepHoldChange: (e: Event) => void
  previewEditingSequence: () => void
  exportEditingSequenceToMotion3: () => Promise<boolean>
  selectPresetGroupOption: (groupName: string, emotion: string) => void
  saveCurrentCombo: () => void
  cancelNewPreset: () => void
  resetTransientControls: () => void
  toggleSingleControl: (controlId: string) => void
  isStepControlActive: (controlId: string) => boolean
  shouldSpanFullRow: (ctrl: ResolvedModelControl, totalInGroup: number) => boolean
  formatControlLabel: (raw: string) => string
  resetSlidersByGroup: (group: 'face' | 'pose' | 'extra') => void
  getSliderFillPercent: (slider: ResolvedModelSlider) => number
  getSliderGripLeft: (slider: ResolvedModelSlider) => string
  isStepSliderModified: (slider: ResolvedModelSlider) => boolean
  resetSingleSlider: (slider: ResolvedModelSlider) => void
  formatSliderValue: (val: number, step: number) => string
  getStepSliderValue: (slider: ResolvedModelSlider) => number
  onSliderInput: (slider: ResolvedModelSlider, e: Event) => void
  formatStepSec: (ms: number) => string
}

/** 子页签统一从父面板注入工作区，缺失时立即报错而不是静默渲染空壳 */
export function useSettingsWorkshop(): SettingsWorkshop {
  const workshop = inject<SettingsWorkshop | null>('settingsWorkshop', null)
  if (!workshop) {
    throw new Error('[SettingsPanel] settingsWorkshop was not provided')
  }
  return workshop
}
