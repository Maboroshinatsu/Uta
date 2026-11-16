/**
 * Pure model capability profiling for the frozen first-wave desktop contract.
 *
 * This module only inspects an already-read synthetic snapshot. It does not load
 * Live2D, read files, hash assets, touch the network or persist anything.
 * Callers are responsible for turning loader ParameterInfo.default into
 * defaultValue and for supplying an opaque content signature.
 */
import type {
  ChannelCapability,
  InspectedParameter,
  ModelCapabilityProfile,
  ModelInspectionInput,
  NativeExpressionDefinition,
  ProfileBuildResult,
  SemanticChannel,
  SemanticMapping,
} from '../../../../shared/first-wave-contracts'

export const SEMANTIC_CHANNEL_ORDER = [
  'headX', 'headY', 'headZ',
  'bodyX', 'bodyY', 'bodyZ',
  'gazeX', 'gazeY',
  'eyeOpenLeft', 'eyeOpenRight',
  'mouthOpen', 'mouthForm',
  'browLeft', 'browRight',
  'breath',
] as const satisfies readonly SemanticChannel[]

export const STANDARD_PARAMETER_IDS: Readonly<Record<SemanticChannel, string>> = {
  headX: 'ParamAngleX',
  headY: 'ParamAngleY',
  headZ: 'ParamAngleZ',
  bodyX: 'ParamBodyAngleX',
  bodyY: 'ParamBodyAngleY',
  bodyZ: 'ParamBodyAngleZ',
  gazeX: 'ParamEyeBallX',
  gazeY: 'ParamEyeBallY',
  eyeOpenLeft: 'ParamEyeLOpen',
  eyeOpenRight: 'ParamEyeROpen',
  mouthOpen: 'ParamMouthOpenY',
  mouthForm: 'ParamMouthForm',
  browLeft: 'ParamBrowLY',
  browRight: 'ParamBrowRY',
  breath: 'ParamBreath',
}

/**
 * Deliberately small exact-match aliases. Substring or directional guessing is
 * out of scope; add aliases only after a real model proves the wording.
 */
const LABEL_ALIASES: Readonly<Record<SemanticChannel, readonly string[]>> = {
  headX: ['头部左右', '头左右', 'head x', 'headx', 'head left-right'],
  headY: ['头部上下', '头上下', 'head y', 'heady', 'head up-down'],
  headZ: ['头部倾斜', '头倾斜', 'head z', 'headz', 'head tilt'],
  bodyX: ['身体左右', '身体水平', 'body x', 'bodyx', 'body left-right'],
  bodyY: ['身体前后', '身体上下', 'body y', 'bodyy', 'body front-back'],
  bodyZ: ['身体倾斜', 'body z', 'bodyz', 'body tilt'],
  gazeX: ['视线左右', '眼球左右', 'gaze x', 'gazex', 'eyeball x'],
  gazeY: ['视线上下', '眼球上下', 'gaze y', 'gazey', 'eyeball y'],
  eyeOpenLeft: ['左眼开合', '左眼睁开', '左眼', 'eye l open', 'eyel open', 'left eye open'],
  eyeOpenRight: ['右眼开合', '右眼睁开', '右眼', 'eye r open', 'eyer open', 'right eye open'],
  mouthOpen: ['嘴张开', '口张开', '张嘴', 'mouth open', 'mouthopen'],
  mouthForm: ['嘴型', '口型', '嘴巴形状', 'mouth form', 'mouthform'],
  browLeft: ['左眉', '左眉毛', 'brow l', 'browl', 'left brow'],
  browRight: ['右眉', '右眉毛', 'brow r', 'browr', 'right brow'],
  breath: ['呼吸', 'breath', 'breathing'],
}

const PARAMETER_KEYS = ['id', 'min', 'max', 'defaultValue', 'label', 'physicsOutput'] as const
const EXPRESSION_KEYS = ['name', 'parameters'] as const
const EXPRESSION_PARAMETER_KEYS = ['id', 'value', 'blend'] as const
const MOTION_KEYS = ['group', 'index', 'parameterIds', 'durationMs', 'loop', 'curveTargets'] as const
const MOTION_TARGET_NAMES = ['Parameter', 'Model', 'PartOpacity'] as const
const MOTION_CURVE_TARGET_KEYS = ['curveCount', 'targetIds'] as const
const OVERRIDE_KEYS = ['channel', 'parameterId', 'direction', 'confirmed'] as const
const ROOT_KEYS = ['schemaVersion', 'modelSignature', 'parameters', 'expressions', 'motions', 'overrides'] as const
const BLEND_MODES = new Set(['Add', 'Multiply', 'Overwrite'])

type ProfileIssue = Extract<ProfileBuildResult, { ok: false }>['issues'][number]
type IssueCode = ProfileIssue['code']
type MotionEntry = ModelInspectionInput['motions'][number]
type ValidOverride = ModelInspectionInput['overrides'][number]

interface ValidationState {
  issues: ProfileIssue[]
}

const CHANNEL_SET: ReadonlySet<string> = new Set(SEMANTIC_CHANNEL_ORDER)

const NORMALIZED_ALIASES: ReadonlyMap<string, readonly SemanticChannel[]> = (() => {
  const map = new Map<string, SemanticChannel[]>()
  for (const channel of SEMANTIC_CHANNEL_ORDER) {
    for (const alias of LABEL_ALIASES[channel]) {
      const key = normalizeLabel(alias)
      const channels = map.get(key) ?? []
      if (!channels.includes(channel)) channels.push(channel)
      map.set(key, channels)
    }
  }
  return map
})()

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSemanticChannel(value: unknown): value is SemanticChannel {
  return typeof value === 'string' && CHANNEL_SET.has(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function fieldPath(base: string, key: string): string {
  return base === '' ? key : `${base}.${key}`
}

function issue(state: ValidationState, code: IssueCode, path: string, message: string): void {
  state.issues.push({ code, path, message })
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  code: IssueCode,
  path: string,
  state: ValidationState,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      issue(state, code, fieldPath(path, key), `unknown field "${key}"`)
    }
  }
}

function readNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  code: IssueCode,
  path: string,
  state: ValidationState,
): string | null {
  const value = record[key]
  if (!isNonEmptyString(value)) {
    issue(state, code, fieldPath(path, key), `${key} must be a non-empty string`)
    return null
  }
  return value
}

function readFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  code: IssueCode,
  path: string,
  state: ValidationState,
): number | null {
  const value = record[key]
  if (!isFiniteNumber(value)) {
    issue(state, code, fieldPath(path, key), `${key} must be a finite number`)
    return null
  }
  return value
}

function validateParameters(
  raw: unknown[],
  state: ValidationState,
): { list: InspectedParameter[]; byId: Map<string, InspectedParameter> } {
  const list: InspectedParameter[] = []
  const byId = new Map<string, InspectedParameter>()

  raw.forEach((entry, index) => {
    const path = `parameters[${index}]`
    if (!isRecord(entry)) {
      issue(state, 'invalid-parameter', path, 'parameter must be an object')
      return
    }
    rejectUnknownKeys(entry, PARAMETER_KEYS, 'invalid-parameter', path, state)

    const id = readNonEmptyString(entry, 'id', 'invalid-parameter', path, state)
    const min = readFiniteNumber(entry, 'min', 'invalid-parameter', path, state)
    const max = readFiniteNumber(entry, 'max', 'invalid-parameter', path, state)
    const defaultValue = readFiniteNumber(entry, 'defaultValue', 'invalid-parameter', path, state)

    let rangeOk = false
    if (min !== null && max !== null && defaultValue !== null) {
      if (min > max) {
        issue(state, 'invalid-parameter', fieldPath(path, 'min'), 'min must be <= max')
      } else if (defaultValue < min || defaultValue > max) {
        issue(state, 'invalid-parameter', fieldPath(path, 'defaultValue'), 'defaultValue must be within [min, max]')
      } else {
        rangeOk = true
      }
    }

    if (typeof entry.physicsOutput !== 'boolean') {
      issue(state, 'invalid-parameter', fieldPath(path, 'physicsOutput'), 'physicsOutput must be a boolean')
    }
    const label = entry.label
    const labelOk = label === undefined || typeof label === 'string'
    if (!labelOk) {
      issue(state, 'invalid-parameter', fieldPath(path, 'label'), 'label must be a string when present')
    }

    if (id === null || !rangeOk || typeof entry.physicsOutput !== 'boolean' || !labelOk) return
    if (byId.has(id)) {
      issue(state, 'duplicate-parameter', fieldPath(path, 'id'), `duplicate parameter id "${id}"`)
      return
    }
    const parameter: InspectedParameter = {
      id,
      min: min as number,
      max: max as number,
      defaultValue: defaultValue as number,
      physicsOutput: entry.physicsOutput,
      ...(label === undefined ? {} : { label: label as string }),
    }
    byId.set(id, parameter)
    list.push(parameter)
  })

  return { list, byId }
}

function validateExpressions(
  raw: unknown[],
  state: ValidationState,
): NativeExpressionDefinition[] {
  const list: NativeExpressionDefinition[] = []
  const names = new Set<string>()

  raw.forEach((entry, index) => {
    const path = `expressions[${index}]`
    if (!isRecord(entry)) {
      issue(state, 'invalid-resource', path, 'expression must be an object')
      return
    }
    rejectUnknownKeys(entry, EXPRESSION_KEYS, 'invalid-resource', path, state)

    const name = readNonEmptyString(entry, 'name', 'invalid-resource', path, state)
    const rawParameters = entry.parameters
    if (!Array.isArray(rawParameters)) {
      issue(state, 'invalid-resource', fieldPath(path, 'parameters'), 'expression parameters must be an array')
      return
    }

    const parameters: NativeExpressionDefinition['parameters'] = []
    let parametersValid = true
    rawParameters.forEach((rawParameter, parameterIndex) => {
      const parameterPath = `${fieldPath(path, 'parameters')}[${parameterIndex}]`
      if (!isRecord(rawParameter)) {
        issue(state, 'invalid-resource', parameterPath, 'expression parameter must be an object')
        parametersValid = false
        return
      }
      rejectUnknownKeys(rawParameter, EXPRESSION_PARAMETER_KEYS, 'invalid-resource', parameterPath, state)
      const id = readNonEmptyString(rawParameter, 'id', 'invalid-resource', parameterPath, state)
      const value = readFiniteNumber(rawParameter, 'value', 'invalid-resource', parameterPath, state)
      const blend = rawParameter.blend
      const blendOk = typeof blend === 'string' && BLEND_MODES.has(blend)
      if (!blendOk) {
        issue(state, 'invalid-resource', fieldPath(parameterPath, 'blend'), 'blend must be Add, Multiply or Overwrite')
      }
      if (id === null || value === null || !blendOk) {
        parametersValid = false
        return
      }
      parameters.push({ id, value, blend: blend as 'Add' | 'Multiply' | 'Overwrite' })
    })

    if (name === null || !parametersValid) return
    if (names.has(name)) {
      issue(state, 'invalid-resource', fieldPath(path, 'name'), `duplicate expression name "${name}"`)
      return
    }
    names.add(name)
    list.push({ name, parameters })
  })

  return list
}

function collectResourceWarnings(
  expressions: readonly NativeExpressionDefinition[],
  motions: readonly MotionEntry[],
  byId: ReadonlyMap<string, InspectedParameter>,
): ModelCapabilityProfile['warnings'] {
  const warnings: ModelCapabilityProfile['warnings'] = []
  const seen = new Set<string>()

  const push = (
    code: ModelCapabilityProfile['warnings'][number]['code'],
    resource: string,
    parameterId: string,
  ): void => {
    const key = `${code}\u0000${resource}\u0000${parameterId}`
    if (seen.has(key)) return
    seen.add(key)
    warnings.push({ code, resource, parameterId })
  }

  for (const expression of expressions) {
    for (const parameter of expression.parameters) {
      if (!byId.has(parameter.id)) push('unknown-expression-parameter', expression.name, parameter.id)
    }
  }
  for (const motion of motions) {
    const resource = `${motion.group}#${motion.index}`
    for (const parameterId of motion.parameterIds) {
      if (!byId.has(parameterId)) push('unknown-motion-parameter', resource, parameterId)
    }
  }
  return warnings
}

function validateMotions(raw: unknown[], state: ValidationState): MotionEntry[] {
  const list: MotionEntry[] = []
  const keys = new Set<string>()

  raw.forEach((entry, index) => {
    const path = `motions[${index}]`
    if (!isRecord(entry)) {
      issue(state, 'invalid-resource', path, 'motion must be an object')
      return
    }
    rejectUnknownKeys(entry, MOTION_KEYS, 'invalid-resource', path, state)

    const group = readNonEmptyString(entry, 'group', 'invalid-resource', path, state)
    const motionIndex = entry.index
    let indexOk = true
    if (typeof motionIndex !== 'number' || !Number.isInteger(motionIndex) || motionIndex < 0) {
      issue(state, 'invalid-resource', fieldPath(path, 'index'), 'motion index must be a non-negative integer')
      indexOk = false
    }
    const rawParameterIds = entry.parameterIds
    if (!Array.isArray(rawParameterIds)) {
      issue(state, 'invalid-resource', fieldPath(path, 'parameterIds'), 'motion parameterIds must be an array')
      return
    }
    const parameterIds: string[] = []
    let parameterIdsOk = true
    rawParameterIds.forEach((value, parameterIndex) => {
      if (!isNonEmptyString(value)) {
        issue(state, 'invalid-resource', `${fieldPath(path, 'parameterIds')}[${parameterIndex}]`, 'motion parameter id must be a non-empty string')
        parameterIdsOk = false
        return
      }
      parameterIds.push(value)
    })

    let durationMs: number | null | undefined
    if (entry.durationMs !== undefined) {
      if (entry.durationMs !== null && (typeof entry.durationMs !== 'number' || !Number.isFinite(entry.durationMs) || entry.durationMs < 0)) {
        issue(state, 'invalid-resource', fieldPath(path, 'durationMs'), 'motion durationMs must be null or a non-negative finite number')
      } else {
        durationMs = entry.durationMs as number | null
      }
    }

    let loop: boolean | null | undefined
    if (entry.loop !== undefined) {
      if (entry.loop !== null && typeof entry.loop !== 'boolean') {
        issue(state, 'invalid-resource', fieldPath(path, 'loop'), 'motion loop must be null or a boolean')
      } else {
        loop = entry.loop as boolean | null
      }
    }

    let curveTargets: MotionEntry['curveTargets']
    if (entry.curveTargets !== undefined) {
      const targetPath = fieldPath(path, 'curveTargets')
      if (!isRecord(entry.curveTargets)) {
        issue(state, 'invalid-resource', targetPath, 'motion curveTargets must be an object')
      } else {
        rejectUnknownKeys(entry.curveTargets, MOTION_TARGET_NAMES, 'invalid-resource', targetPath, state)
        const parsed = {} as NonNullable<MotionEntry['curveTargets']>
        let targetsOk = true
        for (const targetName of MOTION_TARGET_NAMES) {
          const summaryPath = fieldPath(targetPath, targetName)
          const summary = entry.curveTargets[targetName]
          if (!isRecord(summary)) {
            issue(state, 'invalid-resource', summaryPath, 'motion target summary must be an object')
            targetsOk = false
            continue
          }
          rejectUnknownKeys(summary, MOTION_CURVE_TARGET_KEYS, 'invalid-resource', summaryPath, state)
          const curveCount = summary.curveCount
          if (typeof curveCount !== 'number' || !Number.isInteger(curveCount) || curveCount < 0) {
            issue(state, 'invalid-resource', fieldPath(summaryPath, 'curveCount'), 'curveCount must be a non-negative integer')
            targetsOk = false
          }
          const rawTargetIds = summary.targetIds
          if (!Array.isArray(rawTargetIds)) {
            issue(state, 'invalid-resource', fieldPath(summaryPath, 'targetIds'), 'targetIds must be an array')
            targetsOk = false
            continue
          }
          const targetIds: string[] = []
          for (const [targetIndex, targetId] of rawTargetIds.entries()) {
            if (!isNonEmptyString(targetId)) {
              issue(state, 'invalid-resource', `${fieldPath(summaryPath, 'targetIds')}[${targetIndex}]`, 'target id must be a non-empty string')
              targetsOk = false
              continue
            }
            targetIds.push(targetId)
          }
          if (typeof curveCount === 'number' && Number.isInteger(curveCount) && curveCount >= 0) {
            parsed[targetName] = { curveCount, targetIds }
          }
        }
        if (targetsOk) curveTargets = parsed
      }
    }

    if (group === null || !indexOk || !parameterIdsOk) return
    const key = `${group}\u0000${motionIndex}`
    if (keys.has(key)) {
      issue(state, 'invalid-resource', path, `duplicate motion resource "${group}#${motionIndex}"`)
      return
    }
    keys.add(key)
    list.push({
      group,
      index: motionIndex as number,
      parameterIds,
      ...(entry.durationMs !== undefined ? { durationMs } : {}),
      ...(entry.loop !== undefined ? { loop } : {}),
      ...(entry.curveTargets !== undefined && curveTargets ? { curveTargets } : {}),
    })
  })

  return list
}

function validateOverrides(
  raw: unknown[],
  byId: ReadonlyMap<string, InspectedParameter>,
  state: ValidationState,
): Map<SemanticChannel, ValidOverride> {
  const byChannel = new Map<SemanticChannel, ValidOverride>()

  raw.forEach((entry, index) => {
    const path = `overrides[${index}]`
    if (!isRecord(entry)) {
      issue(state, 'invalid-override', path, 'override must be an object')
      return
    }
    rejectUnknownKeys(entry, OVERRIDE_KEYS, 'invalid-override', path, state)

    const channel = entry.channel
    const channelOk = isSemanticChannel(channel)
    if (!channelOk) {
      issue(state, 'invalid-override', fieldPath(path, 'channel'), 'channel is not a known semantic channel')
    }
    const parameterId = readNonEmptyString(entry, 'parameterId', 'invalid-override', path, state)
    const direction = entry.direction
    const directionOk = direction === 'normal' || direction === 'reversed'
    if (!directionOk) {
      issue(state, 'invalid-override', fieldPath(path, 'direction'), 'direction must be normal or reversed')
    }
    if (typeof entry.confirmed !== 'boolean') {
      issue(state, 'invalid-override', fieldPath(path, 'confirmed'), 'confirmed must be a boolean')
    }

    if (parameterId !== null && !byId.has(parameterId)) {
      issue(state, 'unknown-override-target', fieldPath(path, 'parameterId'), `override target "${parameterId}" does not exist`)
      return
    }
    if (!channelOk || parameterId === null || !directionOk || typeof entry.confirmed !== 'boolean') return
    if (byChannel.has(channel)) {
      issue(state, 'invalid-override', fieldPath(path, 'channel'), `duplicate override for channel "${channel}"`)
      return
    }
    byChannel.set(channel, {
      channel,
      parameterId,
      direction,
      confirmed: entry.confirmed,
    })
  })

  return byChannel
}

function mapChannels(
  parameters: readonly InspectedParameter[],
  byId: ReadonlyMap<string, InspectedParameter>,
  overrides: ReadonlyMap<SemanticChannel, ValidOverride>,
): { mappings: SemanticMapping[]; capabilities: ChannelCapability[] } {
  const labelMatchByParameter = new Map<string, readonly SemanticChannel[]>()
  for (const parameter of parameters) {
    if (parameter.label === undefined) continue
    const matched = NORMALIZED_ALIASES.get(normalizeLabel(parameter.label))
    if (matched !== undefined) labelMatchByParameter.set(parameter.id, matched)
  }

  const mappings: SemanticMapping[] = []
  const capabilities: ChannelCapability[] = []

  for (const channel of SEMANTIC_CHANNEL_ORDER) {
    const override = overrides.get(channel)

    if (override !== undefined && override.confirmed) {
      const target = byId.get(override.parameterId) as InspectedParameter
      mappings.push({
        channel,
        parameterId: target.id,
        direction: override.direction,
        source: 'manual',
        confidence: 1,
        confirmed: true,
      })
      if (target.physicsOutput) {
        capabilities.push({ channel, status: 'needs-calibration', parameterIds: [target.id], reason: 'physics-output' })
      } else if (target.min === target.max) {
        capabilities.push({ channel, status: 'needs-calibration', parameterIds: [target.id], reason: 'ambiguous' })
      } else {
        capabilities.push({ channel, status: 'available', parameterIds: [target.id], reason: 'mapped' })
      }
      continue
    }

    const standardId = STANDARD_PARAMETER_IDS[channel]
    const standard = byId.get(standardId)
    if (standard !== undefined) {
      if (!standard.physicsOutput && standard.min < standard.max) {
        mappings.push({
          channel,
          parameterId: standardId,
          direction: 'normal',
          source: 'standard-id',
          confidence: 1,
          confirmed: true,
        })
        capabilities.push({ channel, status: 'available', parameterIds: [standardId], reason: 'mapped' })
      } else {
        capabilities.push({
          channel,
          status: 'needs-calibration',
          parameterIds: [standardId],
          reason: standard.physicsOutput ? 'physics-output' : 'ambiguous',
        })
      }
      continue
    }

    const singleCandidates: InspectedParameter[] = []
    const ambiguousCandidates: InspectedParameter[] = []
    for (const parameter of parameters) {
      const matched = labelMatchByParameter.get(parameter.id)
      if (matched === undefined || !matched.includes(channel)) continue
      if (matched.length === 1) singleCandidates.push(parameter)
      else ambiguousCandidates.push(parameter)
    }

    if (ambiguousCandidates.length === 0 && singleCandidates.length === 1) {
      const candidate = singleCandidates[0]
      if (candidate.physicsOutput) {
        capabilities.push({ channel, status: 'needs-calibration', parameterIds: [candidate.id], reason: 'physics-output' })
      } else if (candidate.min === candidate.max) {
        capabilities.push({ channel, status: 'needs-calibration', parameterIds: [candidate.id], reason: 'ambiguous' })
      } else {
        mappings.push({
          channel,
          parameterId: candidate.id,
          direction: 'normal',
          source: 'label-guess',
          confidence: 0.5,
          confirmed: false,
        })
        capabilities.push({ channel, status: 'needs-calibration', parameterIds: [candidate.id], reason: 'ambiguous' })
      }
      continue
    }

    if (singleCandidates.length > 0 || ambiguousCandidates.length > 0) {
      const candidateIds = parameters
        .filter((parameter) => labelMatchByParameter.get(parameter.id)?.includes(channel) === true)
        .map((parameter) => parameter.id)
      capabilities.push({ channel, status: 'needs-calibration', parameterIds: candidateIds, reason: 'ambiguous' })
      continue
    }

    if (override !== undefined) {
      mappings.push({
        channel,
        parameterId: override.parameterId,
        direction: override.direction,
        source: 'manual',
        confidence: 1,
        confirmed: false,
      })
      capabilities.push({ channel, status: 'needs-calibration', parameterIds: [override.parameterId], reason: 'unconfirmed' })
      continue
    }

    capabilities.push({ channel, status: 'unsupported', parameterIds: [], reason: 'missing-parameter' })
  }

  return { mappings, capabilities }
}

function build(input: unknown): ProfileBuildResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [{ code: 'invalid-schema', path: '$', message: 'input must be an object' }],
    }
  }

  const state: ValidationState = { issues: [] }
  rejectUnknownKeys(input, ROOT_KEYS, 'invalid-schema', '', state)

  if (input.schemaVersion !== 1) {
    issue(state, 'invalid-schema', 'schemaVersion', 'schemaVersion must be 1')
  }
  const modelSignature = input.modelSignature
  if (!isNonEmptyString(modelSignature)) {
    issue(state, 'invalid-signature', 'modelSignature', 'modelSignature must be a non-empty string')
  }

  const parameters = Array.isArray(input.parameters)
    ? validateParameters(input.parameters, state)
    : (() => {
        issue(state, 'invalid-parameter', 'parameters', 'parameters must be an array')
        return { list: [] as InspectedParameter[], byId: new Map<string, InspectedParameter>() }
      })()

  const expressions = Array.isArray(input.expressions)
    ? validateExpressions(input.expressions, state)
    : (() => {
        issue(state, 'invalid-resource', 'expressions', 'expressions must be an array')
        return [] as NativeExpressionDefinition[]
      })()

  const motions = Array.isArray(input.motions)
    ? validateMotions(input.motions, state)
    : (() => {
        issue(state, 'invalid-resource', 'motions', 'motions must be an array')
        return [] as MotionEntry[]
      })()

  const overrides = Array.isArray(input.overrides)
    ? validateOverrides(input.overrides, parameters.byId, state)
    : (() => {
        issue(state, 'invalid-override', 'overrides', 'overrides must be an array')
        return new Map<SemanticChannel, ValidOverride>()
      })()

  if (state.issues.length > 0 || typeof modelSignature !== 'string') {
    return { ok: false, issues: state.issues }
  }

  const { mappings, capabilities } = mapChannels(parameters.list, parameters.byId, overrides)
  return {
    ok: true,
    profile: {
      schemaVersion: 1,
      modelSignature,
      parameters: parameters.list,
      mappings,
      capabilities,
      expressions,
      motions,
      warnings: collectResourceWarnings(expressions, motions, parameters.byId),
    },
  }
}

/**
 * Builds a validated capability profile from an already-read model snapshot.
 * Malformed input always comes back as structured issues; the caller is never
 * expected to catch validation exceptions.
 */
export function buildModelCapabilityProfile(input: ModelInspectionInput): ProfileBuildResult {
  try {
    return build(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      issues: [{ code: 'invalid-schema', path: '$', message: `input could not be inspected: ${message}` }],
    }
  }
}
