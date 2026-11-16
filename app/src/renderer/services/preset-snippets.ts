export type QuickSnippetType = 'blink' | 'nod' | 'tilt' | 'gasp'

export interface SnippetParameterInfo {
  id: string
  min: number
  max: number
  default: number
}

export interface SnippetBase {
  controls: readonly string[]
  parameters: Readonly<Record<string, number>>
}

export interface QuickSnippetStep {
  label: string
  durationMs: number
  holdMs: number
  controls: string[]
  parameters: Record<string, number>
}

export const QUICK_SNIPPET_LABELS: Record<QuickSnippetType, string> = {
  blink: '眨眼',
  nod: '点头',
  tilt: '歪头',
  gasp: '惊讶',
}

export const QUICK_SNIPPET_REQUIREMENTS: Record<QuickSnippetType, string[]> = {
  blink: ['ParamEyeLOpen', 'ParamEyeROpen'],
  nod: ['ParamAngleY'],
  tilt: ['ParamAngleZ'],
  gasp: ['ParamEyeLOpen', 'ParamEyeROpen', 'ParamMouthOpenY'],
}

export const QUICK_SNIPPET_REASONS: Record<QuickSnippetType, string> = {
  blink: '当前模型没有确认的左右眼睑参数，不能生成眨眼动作。',
  nod: '当前模型没有确认的头部上下参数，不能生成点头动作。',
  tilt: '当前模型没有确认的头部倾斜参数，不能生成歪头动作。',
  gasp: '当前模型缺少眼睑或嘴部张口参数，不能生成惊讶动作。',
}

export function canBuildQuickSnippet(
  type: QuickSnippetType,
  parameters: readonly SnippetParameterInfo[],
): boolean {
  const available = new Set(parameters.map((parameter) => parameter.id))
  return QUICK_SNIPPET_REQUIREMENTS[type].every((id) => available.has(id))
}

export function buildQuickSnippet(
  type: QuickSnippetType,
  parameters: readonly SnippetParameterInfo[],
  base: SnippetBase,
): QuickSnippetStep[] | null {
  if (!canBuildQuickSnippet(type, parameters)) return null
  const byId = new Map(parameters.map((parameter) => [parameter.id, parameter]))
  const clamp = (id: string, value: number): number => {
    const parameter = byId.get(id)
    return parameter ? Math.min(parameter.max, Math.max(parameter.min, value)) : value
  }
  const current = (id: string): number => {
    const value = base.parameters[id]
    const parameter = byId.get(id)
    return clamp(
      id,
      typeof value === 'number' && Number.isFinite(value) ? value : (parameter?.default ?? 0),
    )
  }
  const offset = (id: string, delta: number): number => {
    const parameter = byId.get(id)
    const from = current(id)
    if (!parameter) return from + delta
    let target = from + delta
    if (target > parameter.max || target < parameter.min) target = from - delta
    return clamp(id, target)
  }
  const step = (
    label: string,
    durationMs: number,
    holdMs: number,
    overrides: Record<string, number>,
  ): QuickSnippetStep => ({
    label,
    durationMs,
    holdMs,
    controls: [...base.controls],
    parameters: { ...base.parameters, ...overrides },
  })

  const eyeL = current('ParamEyeLOpen')
  const eyeR = current('ParamEyeROpen')
  if (type === 'blink') {
    return [
      step('眨眼·闭', 120, 60, { ParamEyeLOpen: 0, ParamEyeROpen: 0 }),
      step('眨眼·睁', 180, 0, { ParamEyeLOpen: eyeL, ParamEyeROpen: eyeR }),
    ]
  }
  if (type === 'nod') {
    const head = current('ParamAngleY')
    return [
      step('点头·低', 220, 100, {
        ParamAngleY: offset('ParamAngleY', -8),
      }),
      step('点头·回', 260, 0, { ParamAngleY: head }),
    ]
  }
  if (type === 'tilt') {
    const head = current('ParamAngleZ')
    return [
      step('歪头·侧', 300, 160, {
        ParamAngleZ: offset('ParamAngleZ', 10),
      }),
      step('歪头·正', 380, 0, { ParamAngleZ: head }),
    ]
  }
  const mouth = current('ParamMouthOpenY')
  const head = current('ParamAngleY')
  return [
    step('惊讶·起', 140, 120, {
      ParamEyeLOpen: clamp('ParamEyeLOpen', Math.max(eyeL, 1)),
      ParamEyeROpen: clamp('ParamEyeROpen', Math.max(eyeR, 1)),
      ParamMouthOpenY: clamp('ParamMouthOpenY', Math.max(mouth, 0.75)),
      ParamAngleY: offset('ParamAngleY', -3),
    }),
    step('惊讶·回', 220, 0, {
      ParamEyeLOpen: eyeL,
      ParamEyeROpen: eyeR,
      ParamMouthOpenY: mouth,
      ParamAngleY: head,
    }),
  ]
}
