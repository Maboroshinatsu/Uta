import genericData from './natural-presets.json'
import dsData from './natural-presets.ds.json'
import { createDafishBodyLedNeutralPreset } from './dafish-body-led-neutral'
import { createDafishBodyLedHappyPreset } from './dafish-body-led-happy'
import { createDafishBodyLedCuriousPreset } from './dafish-body-led-curious'
import { createDafishBodyLedSurprisedPreset } from './dafish-body-led-surprised'
import { createDafishBodyLedSadPreset } from './dafish-body-led-sad'
import { createDafishBodyLedAngryPreset } from './dafish-body-led-angry'
import { createDafishBodyLedShyPreset } from './dafish-body-led-shy'
import { createDafishBodyLedThinkingPreset } from './dafish-body-led-thinking'
import { createDafishWellActuallyPreset } from './dafish-well-actually'
import type {
  ModelStatePreset,
  PresetFinishMode,
  PresetKeyframeStep,
  ResolvedModelControl,
  ResolvedModelSlider,
} from './emotion-adapter'

interface RawStep {
  label?: string
  durationMs: number
  holdMs: number
  controls?: string[]
  parameters: Record<string, number>
  motion?: { group: string; index?: number }
}

interface RawPreset {
  id: string
  label: string
  description: string
  emotion: string
  group: string
  controls?: string[]
  finishMode: PresetFinishMode
  revertHoldMs?: number
  motion?: { group: string; index?: number } | 'none'
  steps: RawStep[]
}

const REQUIRED_SLIDERS = [
  'ParamAngleX',
  'ParamAngleY',
  'ParamAngleZ',
  'ParamEyeBallX',
  'ParamEyeBallY',
  'ParamBrowLY',
  'ParamBrowRY',
  'ParamMouthForm',
]
const MIN_STEP_PARAMETERS = 8

function isCompatibleModel(sliders: Map<string, ResolvedModelSlider>): boolean {
  const mouth = sliders.get('ParamMouthForm')
  const angleY = sliders.get('ParamAngleY')
  if (!mouth || mouth.min > -1 || mouth.max < 0.5) return false
  if (!angleY || angleY.max < 8 || angleY.min > -8) return false
  return REQUIRED_SLIDERS.every((id) => sliders.has(id))
}

function clampToSlider(value: number, slider: ResolvedModelSlider): number {
  const clamped = Math.min(slider.max, Math.max(slider.min, value))
  return Math.round(clamped * 100) / 100
}

function buildPack(
  rawPresets: RawPreset[],
  sliders: ResolvedModelSlider[],
  controls: ResolvedModelControl[],
  allowControls: boolean,
): ModelStatePreset[] {
  const byId = new Map(sliders.map((slider) => [slider.id, slider]))
  if (!isCompatibleModel(byId)) return []
  const availableControlIds = new Set(controls.map((control) => control.id))
  const isControlAvailable = (id: string) => {
    const baseId = id.includes(':') ? id.split(':')[0] : id
    return availableControlIds.has(baseId) || availableControlIds.has(id)
  }
  const presets: ModelStatePreset[] = []

  for (const raw of rawPresets) {
    const steps: PresetKeyframeStep[] = []
    for (const rawStep of raw.steps) {
      const parameters: Record<string, number> = {}
      for (const [id, value] of Object.entries(rawStep.parameters)) {
        const slider = byId.get(id)
        if (!slider || !Number.isFinite(value)) continue
        parameters[id] = clampToSlider(value, slider)
      }
      const stepControls = allowControls
        ? (rawStep.controls ?? []).filter((id) => isControlAvailable(id))
        : []
      steps.push({
        ...(rawStep.label ? { label: rawStep.label } : {}),
        durationMs: rawStep.durationMs,
        holdMs: rawStep.holdMs,
        controls: stepControls,
        parameters,
        ...(rawStep.motion ? { motion: rawStep.motion } : {}),
      })
    }
    const lastStep = steps[steps.length - 1]
    const isNeutral = raw.id === 'neutral'
    if (!lastStep || (!isNeutral && steps.length < 2)) continue
    if (!isNeutral && Object.keys(lastStep.parameters).length < MIN_STEP_PARAMETERS) continue
    const presetControls = allowControls
      ? (raw.controls ?? []).filter((id) => isControlAvailable(id))
      : []
    presets.push({
      id: raw.id,
      label: raw.label,
      description: raw.description,
      emotion: raw.emotion,
      group: raw.group,
      controls: presetControls,
      parameters: { ...lastStep.parameters },
      steps,
      finishMode: raw.finishMode,
      ...(typeof raw.revertHoldMs === 'number' ? { revertHoldMs: raw.revertHoldMs } : {}),
      ...(raw.motion ? { motion: raw.motion } : {}),
      custom: true,
    })
  }
  return presets
}

/** 通用自然编排：只用标准参数，不依赖任何模型自定义表情 ID。 */
export function buildGenericNaturalPresets(
  sliders: ResolvedModelSlider[],
  controls: ResolvedModelControl[] = [],
): ModelStatePreset[] {
  return buildPack(genericData.presets as RawPreset[], sliders, controls, false)
}

/** DS 鼠控版自然编排：在通用动作上叠加开心兴奋、脸红、哭等专用强特效。 */
export function buildDsNaturalPresets(
  sliders: ResolvedModelSlider[],
  controls: ResolvedModelControl[],
): ModelStatePreset[] {
  return buildPack(dsData.presets as RawPreset[], sliders, controls, true)
}

export function isDsMouseModel(
  sliders: ResolvedModelSlider[],
  controls: ResolvedModelControl[],
): boolean {
  const hasPointHand = sliders.some((slider) => slider.id === 'pointX')
  const dsControls = new Set(['蛋包饭', '点菜按下', '开心兴奋', '脸红'])
  return hasPointHand && controls.some((control) => dsControls.has(control.id))
}

const DEFAULT_PRESET_SLOTS = [
  ['neutral', createDafishBodyLedNeutralPreset],
  ['happy', createDafishBodyLedHappyPreset],
  ['curious', createDafishBodyLedCuriousPreset],
  ['surprised', createDafishBodyLedSurprisedPreset],
  ['sad', createDafishBodyLedSadPreset],
  ['angry', createDafishBodyLedAngryPreset],
  ['shy', createDafishBodyLedShyPreset],
  ['thinking', createDafishBodyLedThinkingPreset],
] as const

export function buildDafishNaturalPresets(
  _sliders?: ResolvedModelSlider[],
  _controls?: ResolvedModelControl[],
): ModelStatePreset[] {
  return [...DEFAULT_PRESET_SLOTS.map(([, create]) => create()), createDafishWellActuallyPreset()]
}

/** 共用大肥鱼的槽位顺序、名称和分组，动作内容由当前模型提供。 */
export function alignDefaultPresetSlots(presets: ModelStatePreset[]): ModelStatePreset[] {
  const byId = new Map(presets.map(preset => [preset.id, preset]))
  return DEFAULT_PRESET_SLOTS.flatMap(([id, create]) => {
    const preset = byId.get(id)
    if (!preset) return []
    const { label, group, emotion } = create()
    return [{ ...preset, label, group, emotion }]
  })
}

export function isDafishModel(
  _sliders: ResolvedModelSlider[],
  controls: ResolvedModelControl[],
): boolean {
  const dafishControls = new Set(['大小变', '狗尾草', '抚胸', '竖食指', '长短裙', '大钢盆', '爱心眼'])
  let count = 0
  for (const control of controls) {
    if (dafishControls.has(control.id)) count++
  }
  return count >= 2
}

export function buildNaturalPresetsForModel(
  sliders: ResolvedModelSlider[],
  controls: ResolvedModelControl[],
): ModelStatePreset[] {
  if (isDafishModel(sliders, controls)) {
    return buildDafishNaturalPresets(sliders, controls)
  }
  return isDsMouseModel(sliders, controls)
    ? buildDsNaturalPresets(sliders, controls)
    : buildGenericNaturalPresets(sliders, controls)
}
