import type { ParameterInfo } from './loader'

/** 鼠标视线跟随要写入的模型参数。VTS 模型常用自定义控制器（AngleX、PositionX…）。 */
export interface FocusMapping {
  headXParam?: string | null
  headYParam?: string | null
  headZParam?: string | null
  headScale: number
  eyeXParam?: string | null
  eyeYParam?: string | null
  eyeScale: number
  invertEyeX?: boolean
  invertEyeY?: boolean
  bodyXParam?: string | null
  bodyYParam?: string | null
  bodyZParam?: string | null
  bodyScale: number
  bodyAxisGain?: Partial<Record<'X' | 'Y' | 'Z', number>>
}

export type ParameterBlendMode = 'pose-offset' | 'gaze' | 'eye-open' | 'absolute'

/** 标准通道作为兼容回退；自定义命名以本模型已解析的绑定为准。 */
export function parameterBlendMode(id: string, modes?: Readonly<Record<string, ParameterBlendMode>>): ParameterBlendMode {
  if (modes && Object.hasOwn(modes, id)) return modes[id]
  if (/^(Param)?EyeBall[XY]$/i.test(id)) return 'gaze'
  if (/^ParamEye[LR]Open$/i.test(id)) return 'eye-open'
  if (/^(Param)?(Angle[XYZ]|BodyAngle[XYZ]|Shoulder|Leg|Step|Position[XYZ])$/i.test(id)) return 'pose-offset'
  return 'absolute'
}

/** 一次解析，供跟随、姿态过渡、SDK 基线保护和释放共用；不依赖作者或模型名称。 */
export function resolveParameterBlendModes(
  parameterIds: Iterable<string>, mapping?: FocusMapping | null, bindings: VtsFocusBinding[] = [],
): Record<string, ParameterBlendMode> {
  const ids = new Set(parameterIds)
  const modes: Record<string, ParameterBlendMode> = Object.create(null)
  for (const id of ids) modes[id] = parameterBlendMode(id)
  for (const id of [mapping?.headXParam, mapping?.headYParam, mapping?.headZParam,
    mapping?.bodyXParam, mapping?.bodyYParam, mapping?.bodyZParam]) {
    if (id && ids.has(id)) modes[id] = 'pose-offset'
  }
  for (const id of [mapping?.eyeXParam, mapping?.eyeYParam]) {
    if (id && ids.has(id)) modes[id] = 'gaze'
  }
  for (const binding of bindings) {
    if (/^EyeOpen(?:Left|Right)$/.test(binding.input) && ids.has(binding.output) && modes[binding.output] === 'absolute') {
      modes[binding.output] = 'eye-open'
    }
  }
  return modes
}

export const DEFAULT_FOCUS_MAPPING: FocusMapping = {
  headXParam: 'ParamAngleX',
  headYParam: 'ParamAngleY',
  headZParam: 'ParamAngleZ',
  headScale: 30,
  eyeXParam: 'ParamEyeBallX',
  eyeYParam: 'ParamEyeBallY',
  eyeScale: 1,
  invertEyeX: false,
  invertEyeY: false,
  bodyXParam: 'ParamBodyAngleX',
  bodyYParam: null,
  bodyZParam: null,
  bodyScale: 10,
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

export interface VtsFocusBinding {
  input: string
  output: string
  lower?: number
  upper?: number
}
const BODY_AXES = ['X', 'Y', 'Z'] as const

function bindingScale(binding?: VtsFocusBinding): number | undefined {
  const { lower, upper } = binding ?? {}
  if (typeof lower === 'number' && typeof upper === 'number' && lower !== upper) {
    return Math.max(Math.abs(lower), Math.abs(upper))
  }
}

function physicsWriters(physics: unknown) {
  const settings = record(physics)?.PhysicsSettings
  const writers = new Map<string, Array<{ inputs: unknown; output: Record<string, unknown> }>>()
  if (Array.isArray(settings)) {
    for (const setting of settings) {
      const group = record(setting)
      if (!Array.isArray(group?.Output)) continue
      for (const value of group.Output) {
        const output = record(value)
        if (!output) continue
        const destinations = Array.isArray(output.Destination) ? output.Destination : [output.Destination]
        for (const value of destinations) {
          const destination = record(value)
          if (destination?.Target !== 'Parameter' || typeof destination.Id !== 'string') continue
          const links = writers.get(destination.Id) ?? []
          links.push({ inputs: group.Input, output })
          writers.set(destination.Id, links)
        }
      }
    }
  }
  return writers
}

function inputParameter(input: Record<string, unknown> | undefined): string | undefined {
  const source = record(input?.Source)
  if (source?.Target === 'Parameter' && typeof source.Id === 'string') return source.Id
}

/** An adapter can set or disable individual axes. Fill omitted axes from the model. */
export function resolveModelFocusMapping(
  parameters: ParameterInfo[], physics: unknown, adapter?: FocusMapping, bindings: VtsFocusBinding[] = [], generated = false,
): FocusMapping {
  const byId = new Map(parameters.map(parameter => [parameter.id, parameter]))
  const writers = physicsWriters(physics)
  const writable = (id: string): ParameterInfo | undefined => {
    const parameter = byId.get(id)
    if (parameter && parameter.max > parameter.min && !parameter.isPhysicsOutput && !writers.has(id)) return parameter
  }
  if (generated && adapter) {
    adapter = { ...adapter }
    for (const axis of BODY_AXES) {
      const field = `body${axis}Param` as const
      const id = adapter[field]
      if (id && !writable(id)) delete adapter[field]
    }
  }
  const channel = (id: string) => (writable(`Param${id}`) ?? writable(id))?.id ?? null
  const headChannel = (axis: typeof BODY_AXES[number]) => {
    const aliases = new Set([`ParamAngle${axis}`, `Angle${axis}`])
    const declared = new Set(bindings.filter(binding =>
      binding.input === `FaceAngle${axis}` && aliases.has(binding.output) && writable(binding.output),
    ).map(binding => binding.output))
    if (declared.size === 1) return declared.values().next().value ?? null
    const all = new Set(bindings.filter(binding => binding.input === `FaceAngle${axis}` && writable(binding.output)).map(binding => binding.output))
    const only = all.size === 1 ? all.values().next().value : undefined
    // FaceAngle 同时绑定头与身体时，物理中已确认的身体输入不能再当头部重复驱动。
    const bodyInputs = new Set<string>()
    for (const target of [`ParamBodyAngle${axis}`, `BodyAngle${axis}`]) {
      for (const link of writers.get(target) ?? []) {
        if (Array.isArray(link.inputs)) for (const input of link.inputs) {
          const id = inputParameter(record(input))
          if (id) bodyInputs.add(id)
        }
      }
    }
    if (only && !/^(Param)?(?:BodyAngle|Position)[XYZ]\d*(?:Input)?$/i.test(only) &&
      (!bodyInputs.has(only) || !channel(`Angle${axis}`))) return only
    const custom = new Set(bindings.filter(binding => binding.input === `FaceAngle${axis}` &&
      writable(binding.output) && !bodyInputs.has(binding.output)).map(binding => binding.output))
    if (custom.size === 1) return custom.values().next().value ?? null
    return channel(`Angle${axis}`)
  }
  const eyeBinding = (axis: 'X' | 'Y') => {
    const matches = bindings.filter(binding =>
      (binding.input === `EyeRight${axis}` || binding.input === `EyeLeft${axis}`) &&
      writable(binding.output),
    )
    const first = matches[0]
    if (first && matches.every(binding =>
      binding.output === first.output && binding.lower === first.lower && binding.upper === first.upper,
    )) return first
  }
  const eyeX = eyeBinding('X')
  const eyeY = eyeBinding('Y')
  const bodyAxisGain: NonNullable<FocusMapping['bodyAxisGain']> = {}
  const mapping: FocusMapping = {
    ...DEFAULT_FOCUS_MAPPING,
    headXParam: headChannel('X'), headYParam: headChannel('Y'), headZParam: headChannel('Z'),
    eyeXParam: eyeX?.output ?? channel('EyeBallX'), eyeYParam: eyeY?.output ?? channel('EyeBallY'),
    invertEyeX: eyeX?.lower !== undefined && eyeX.upper !== undefined && eyeX.lower > eyeX.upper,
    invertEyeY: eyeY?.lower !== undefined && eyeY.upper !== undefined && eyeY.lower > eyeY.upper,
    bodyXParam: null, bodyYParam: null, bodyZParam: null,
    ...adapter,
    bodyAxisGain,
  }
  const used = new Set(focusMappingParamIds(mapping))
  const headAndEyes = new Set([mapping.headXParam, mapping.headYParam, mapping.headZParam, mapping.eyeXParam, mapping.eyeYParam])
  for (const axis of BODY_AXES) {
    const field = `body${axis}Param` as const
    if (adapter?.[field] !== undefined) continue
    const name = `BodyAngle${axis}`
    const target = byId.get(`Param${name}`) ?? byId.get(name)
    if (!target || target.max <= target.min) continue
    let source = axis === 'X' ? writable(target.id) : undefined
    let sign = 1
    const axisBindings = bindings.filter(binding => binding.input === `FaceAngle${axis}`)
    const links = writers.get(target.id)
    if (links?.length === 1) {
      const { inputs, output } = links[0]
      const expectedInput = new RegExp(`^(?:Param)?(?:BodyAngle|Position)${axis}\\d*(?:Input)?$`, 'i')
      const entries = Array.isArray(inputs) ? inputs.map(record) : []
      const candidates = entries.filter(input => {
        const id = inputParameter(input)
        if (!id || !writable(id) || input?.Type !== 'Angle' || typeof input.Weight !== 'number' || input.Weight <= 0) return false
        return axisBindings.some(binding => binding.output === id) || (entries.length === 1 && expectedInput.test(id))
      })
      const input = candidates.length === 1 ? candidates[0] : undefined
      const id = inputParameter(input)
      if (id && input && !entries.some(entry => headAndEyes.has(inputParameter(entry) ?? '')) &&
        output.Type === 'Angle' && typeof output.Weight === 'number' && output.Weight > 0 &&
        typeof output.Scale === 'number' && Number.isFinite(output.Scale) && output.Scale !== 0) {
        source = writable(id)
        sign = ((input.Reflect === true) !== (output.Reflect === true) ? -1 : 1) * Math.sign(output.Scale)
      }
    }
    if (!source || used.has(source.id)) continue
    used.add(source.id)
    mapping[field] = source.id
    const sourceBindings = axisBindings.filter(binding => binding.output === source.id)
    const gain = sourceBindings.length === 1 ? bindingScale(sourceBindings[0]) : undefined
    bodyAxisGain[axis] = sign * Math.min(gain ?? mapping.bodyScale, (source.max - source.min) / 2)
  }
  return mapping
}

/** Keep native motion blink bindings. Only remove body inputs from SDK automatic blinking. */
export function automaticBlinkParameterIds(
  ids: string[], parameters: ParameterInfo[], physics: unknown, bindings: VtsFocusBinding[],
): string[] {
  const realIds = new Set(parameters.map(parameter => parameter.id))
  const eyeIds = ['ParamEyeLOpen', 'ParamEyeROpen']
  if (!eyeIds.every(id => realIds.has(id) && ids.includes(id))) return ids
  const eyeInputs = new Set([...eyeIds, ...bindings.filter(binding => /^EyeOpen(?:Left|Right)$/.test(binding.input)).map(binding => binding.output)])
  const bodyInputs = new Set<string>()
  for (const [destination, links] of physicsWriters(physics)) {
    if (!/^(?:Param)?BodyAngle[XYZ]$/.test(destination) || !realIds.has(destination)) continue
    for (const { inputs } of links) {
      if (!Array.isArray(inputs)) continue
      for (const value of inputs) {
        const input = record(value)
        const id = inputParameter(input)
        if (id && typeof input?.Weight === 'number' && input.Weight > 0) bodyInputs.add(id)
      }
    }
  }
  return ids.filter(id => eyeInputs.has(id) || !bodyInputs.has(id))
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function optionalText(value: unknown, fallback: string | null): string | null {
  if (value === null || value === '') return null
  return text(value, fallback ?? '') || null
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

/** 缺省通道在模型载入后推断；显式 null 可禁用身体轴与头部倾斜。 */
export function normalizeFocusMapping(raw: unknown): FocusMapping | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entry = raw as Record<string, unknown>
  return {
    ...(typeof entry.headXParam === 'string' && entry.headXParam.trim() ? { headXParam: entry.headXParam.trim() } : {}),
    ...(typeof entry.headYParam === 'string' && entry.headYParam.trim() ? { headYParam: entry.headYParam.trim() } : {}),
    ...(entry.headZParam !== undefined ? { headZParam: optionalText(entry.headZParam, DEFAULT_FOCUS_MAPPING.headZParam ?? null) } : {}),
    headScale: number(entry.headScale, DEFAULT_FOCUS_MAPPING.headScale, 1, 180),
    ...(typeof entry.eyeXParam === 'string' && entry.eyeXParam.trim() ? { eyeXParam: entry.eyeXParam.trim() } : {}),
    ...(typeof entry.eyeYParam === 'string' && entry.eyeYParam.trim() ? { eyeYParam: entry.eyeYParam.trim() } : {}),
    eyeScale: number(entry.eyeScale, DEFAULT_FOCUS_MAPPING.eyeScale, 0.1, 10),
    ...(typeof entry.invertEyeX === 'boolean' ? { invertEyeX: entry.invertEyeX } : {}),
    ...(typeof entry.invertEyeY === 'boolean' ? { invertEyeY: entry.invertEyeY } : {}),
    ...(entry.bodyXParam !== undefined ? { bodyXParam: optionalText(entry.bodyXParam, null) } : {}),
    ...(entry.bodyYParam !== undefined ? { bodyYParam: optionalText(entry.bodyYParam, null) } : {}),
    ...(entry.bodyZParam !== undefined ? { bodyZParam: optionalText(entry.bodyZParam, null) } : {}),
    bodyScale: number(entry.bodyScale, DEFAULT_FOCUS_MAPPING.bodyScale, 1, 180),
  }
}

/** focus 里所有会写入的参数 ID（去重，供校验与稳定性检查）。 */
export function focusMappingParamIds(mapping: FocusMapping): string[] {
  return [...new Set([
    mapping.headXParam,
    mapping.headYParam,
    mapping.headZParam,
    mapping.eyeXParam,
    mapping.eyeYParam,
    mapping.bodyXParam,
    mapping.bodyYParam,
    mapping.bodyZParam,
  ].filter((id): id is string => !!id))]
}
