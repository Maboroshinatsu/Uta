import rawPresetData from './continuous-presets.json'
import type {
  ModelStatePreset,
  PresetFinishMode,
  PresetKeyframeStep,
  ResolvedModelSlider,
} from './emotion-adapter'

interface RawStep {
  label?: string
  durationMs: number
  holdMs: number
  parameters: Record<string, number>
}

interface RawPreset {
  id: string
  label: string
  description: string
  emotion: string
  group: string
  finishMode: PresetFinishMode
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

/**
 * 连续表演包只面向与 DS 鼠控版同类的标准 VTB 参数模型：
 * 嘴角必须支持负值（DS 默认 -0.5），AngleY 必须有足够上下幅度。
 * 其他模型返回空，避免把不合适的嘴形/角度硬塞进去。
 */
function isCompatibleModel(sliders: Map<string, ResolvedModelSlider>): boolean {
  const mouth = sliders.get('ParamMouthForm')
  const angleY = sliders.get('ParamAngleY')
  if (!mouth || mouth.min > -1 || mouth.max < 0.5) return false
  if (!angleY || angleY.max < 8 || angleY.min > -8) return false
  return REQUIRED_SLIDERS.filter((id) => sliders.has(id)).length === REQUIRED_SLIDERS.length
}

function clampToSlider(value: number, slider: ResolvedModelSlider): number {
  const clamped = Math.min(slider.max, Math.max(slider.min, value))
  return Math.round(clamped * 100) / 100
}

/** 把内置连续序列过滤成当前模型可用的参数步骤；缺参数或模型不兼容时跳过。 */
export function buildContinuousPresets(sliders: ResolvedModelSlider[]): ModelStatePreset[] {
  const byId = new Map(sliders.map((slider) => [slider.id, slider]))
  if (!isCompatibleModel(byId)) return []

  const presets: ModelStatePreset[] = []
  for (const raw of (rawPresetData as unknown as { presets: RawPreset[] }).presets) {
    const steps: PresetKeyframeStep[] = []
    for (const rawStep of raw.steps) {
      const parameters: Record<string, number> = {}
      for (const [id, value] of Object.entries(rawStep.parameters)) {
        const slider = byId.get(id)
        if (!slider || !Number.isFinite(value)) continue
        parameters[id] = clampToSlider(value, slider)
      }
      steps.push({
        ...(rawStep.label ? { label: rawStep.label } : {}),
        durationMs: rawStep.durationMs,
        holdMs: rawStep.holdMs,
        controls: [],
        parameters,
      })
    }
    const lastStep = steps[steps.length - 1]
    if (steps.length < 4 || !lastStep || Object.keys(lastStep.parameters).length < MIN_STEP_PARAMETERS) {
      continue
    }
    presets.push({
      id: raw.id,
      label: raw.label,
      description: raw.description,
      emotion: raw.emotion,
      group: raw.group,
      controls: [],
      parameters: { ...lastStep.parameters },
      steps,
      finishMode: raw.finishMode,
      custom: true,
    })
  }
  return presets
}
