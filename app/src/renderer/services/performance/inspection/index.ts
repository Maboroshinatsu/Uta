/**
 * Real Cubism Core -> frozen first-wave ModelInspectionInput adapter.
 *
 * The caller owns Core lifecycle and the already-parsed resource JSON. This
 * module only reads Core arrays, converts CDI/physics/exp3/motion3 metadata,
 * then validates the result through the merged pure profile builder. It does
 * not load PIXI, read files, hash assets, write Core or retain mutable input
 * references.
 */
import type {
  InspectedParameter,
  ModelInspectionInput,
  NativeMotionDefinition,
} from '../../../../shared/first-wave-contracts'
import type {
  CoreInspectionRequest,
  CoreInspectionResult,
  CoreModelView,
} from '../../../../shared/model-inspection-contracts'
import { buildModelCapabilityProfile } from '../profile/index'

export const MAX_CORE_PARAMETERS = 4096
export const MAX_METADATA_RESOURCES = 1024
export const MAX_METADATA_JSON_BYTES = 8 * 1024 * 1024

type InspectionIssue = Extract<CoreInspectionResult, { ok: false }>['issues'][number]
type FailureResult = { ok: false; issues: InspectionIssue[] }

interface CoreParameterSnapshot {
  id: string
  min: number
  max: number
  defaultValue: number
}

interface ConvertedMetadata {
  labels: Map<string, string>
  physicsOutputIds: Set<string>
  expressions: ModelInspectionInput['expressions']
  motions: ModelInspectionInput['motions']
}

interface ValidationState {
  issues: InspectionIssue[]
}

const REQUEST_KEYS = ['modelSignature', 'metadata', 'overrides'] as const
const METADATA_KEYS = ['cdi', 'physics', 'expressions', 'motions'] as const
const EXPRESSION_KEYS = ['name', 'json'] as const
const MOTION_KEYS = ['group', 'index', 'json'] as const
const BLEND_MODES = new Set(['Add', 'Multiply', 'Overwrite'])
const MOTION_TARGETS = new Set(['Parameter', 'Model', 'PartOpacity'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function issue(state: ValidationState, code: InspectionIssue['code'], path: string, message: string): void {
  state.issues.push({ code, path, message })
}

function failure(state: ValidationState): FailureResult {
  return { ok: false, issues: state.issues }
}

function fieldPath(base: string, key: string): string {
  return base === '' ? key : `${base}.${key}`
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  state: ValidationState,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      issue(state, 'invalid-metadata', fieldPath(path, key), `unknown field "${key}"`)
    }
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}

/**
 * Serializes the parsed JSON once to enforce the per-document byte budget and
 * to reject values that are not actually JSON (cycles, BigInt, throwing toJSON).
 */
function checkJsonSize(value: unknown, path: string, state: ValidationState): boolean {
  let serialized: string
  try {
    const result = JSON.stringify(value)
    if (typeof result !== 'string') {
      issue(state, 'invalid-metadata', path, 'metadata JSON is not serializable')
      return false
    }
    serialized = result
  } catch {
    issue(state, 'invalid-metadata', path, 'metadata JSON is not serializable')
    return false
  }
  if (utf8ByteLength(serialized) > MAX_METADATA_JSON_BYTES) {
    issue(state, 'invalid-metadata', path, `metadata JSON exceeds ${MAX_METADATA_JSON_BYTES} bytes`)
    return false
  }
  return true
}

function readArrayLike(value: unknown, count: number, path: string, state: ValidationState): ArrayLike<unknown> | null {
  if (value === null || typeof value !== 'object') {
    issue(state, 'invalid-core', path, 'must be an array-like object')
    return null
  }
  const length = (value as { length?: unknown }).length
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) {
    issue(state, 'invalid-core', path, 'length must be a non-negative integer')
    return null
  }
  if (length !== count) {
    issue(state, 'invalid-core', path, `length ${length} does not match parameter count ${count}`)
    return null
  }
  return value as ArrayLike<unknown>
}

function readCoreParameters(core: unknown): { ok: true; parameters: CoreParameterSnapshot[] } | FailureResult {
  const state: ValidationState = { issues: [] }
  if (!isRecord(core)) {
    issue(state, 'invalid-core', 'core', 'core must be an object')
    return failure(state)
  }
  const parameters = core.parameters
  if (!isRecord(parameters)) {
    issue(state, 'invalid-core', 'core.parameters', 'core.parameters must be an object')
    return failure(state)
  }
  const count = parameters.count
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > MAX_CORE_PARAMETERS) {
    issue(state, 'invalid-core', 'core.parameters.count', `count must be an integer in 0..${MAX_CORE_PARAMETERS}`)
    return failure(state)
  }

  const ids = readArrayLike(parameters.ids, count, 'core.parameters.ids', state)
  const minimumValues = readArrayLike(parameters.minimumValues, count, 'core.parameters.minimumValues', state)
  const maximumValues = readArrayLike(parameters.maximumValues, count, 'core.parameters.maximumValues', state)
  const defaultValues = readArrayLike(parameters.defaultValues, count, 'core.parameters.defaultValues', state)
  if (ids === null || minimumValues === null || maximumValues === null || defaultValues === null) {
    return failure(state)
  }

  const seen = new Set<string>()
  const result: CoreParameterSnapshot[] = []
  for (let index = 0; index < count; index += 1) {
    const path = `core.parameters[${index}]`
    const id = ids[index]
    const min = minimumValues[index]
    const max = maximumValues[index]
    const defaultValue = defaultValues[index]

    let valid = true
    if (!isNonEmptyString(id)) {
      issue(state, 'invalid-core', `${path}.id`, 'id must be a non-empty string')
      valid = false
    } else if (seen.has(id)) {
      issue(state, 'invalid-core', `${path}.id`, `duplicate parameter id "${id}"`)
      valid = false
    }
    if (!isFiniteNumber(min)) {
      issue(state, 'invalid-core', `${path}.min`, 'minimum must be finite')
      valid = false
    }
    if (!isFiniteNumber(max)) {
      issue(state, 'invalid-core', `${path}.max`, 'maximum must be finite')
      valid = false
    }
    if (!isFiniteNumber(defaultValue)) {
      issue(state, 'invalid-core', `${path}.defaultValue`, 'defaultValue must be finite')
      valid = false
    }
    if (valid && isFiniteNumber(min) && isFiniteNumber(max) && isFiniteNumber(defaultValue)) {
      if (min > max) {
        issue(state, 'invalid-core', `${path}.min`, 'minimum must be <= maximum')
        valid = false
      } else if (defaultValue < min || defaultValue > max) {
        issue(state, 'invalid-core', `${path}.defaultValue`, 'defaultValue must be within [min, max]')
        valid = false
      }
    }
    if (!valid) continue

    seen.add(id as string)
    result.push({
      id: id as string,
      min: min as number,
      max: max as number,
      defaultValue: defaultValue as number,
    })
  }

  if (state.issues.length > 0) return failure(state)
  return { ok: true, parameters: result }
}

function validateCdi(value: unknown, labels: Map<string, string>, state: ValidationState): void {
  if (!checkJsonSize(value, 'metadata.cdi', state)) return
  if (!isRecord(value)) {
    issue(state, 'invalid-metadata', 'metadata.cdi', 'cdi must be an object')
    return
  }
  const rawParameters = value.Parameters
  if (!Array.isArray(rawParameters)) {
    issue(state, 'invalid-metadata', 'metadata.cdi.Parameters', 'cdi Parameters must be an array')
    return
  }
  const seen = new Set<string>()
  Array.from(rawParameters).forEach((entry, index) => {
    const path = `metadata.cdi.Parameters[${index}]`
    if (!isRecord(entry)) {
      issue(state, 'invalid-metadata', path, 'cdi parameter must be an object')
      return
    }
    const id = entry.Id
    const name = entry.Name
    if (!isNonEmptyString(id)) {
      issue(state, 'invalid-metadata', `${path}.Id`, 'Id must be a non-empty string')
      return
    }
    if (typeof name !== 'string') {
      issue(state, 'invalid-metadata', `${path}.Name`, 'Name must be a string')
      return
    }
    if (seen.has(id)) {
      issue(state, 'invalid-metadata', `${path}.Id`, `duplicate cdi parameter id "${id}"`)
      return
    }
    seen.add(id)
    if (name.trim() !== '') labels.set(id, name)
  })
}

function validatePhysics(value: unknown, physicsOutputIds: Set<string>, state: ValidationState): void {
  if (!checkJsonSize(value, 'metadata.physics', state)) return
  if (!isRecord(value)) {
    issue(state, 'invalid-metadata', 'metadata.physics', 'physics must be an object')
    return
  }
  const rawSettings = value.PhysicsSettings
  if (!Array.isArray(rawSettings)) {
    issue(state, 'invalid-metadata', 'metadata.physics.PhysicsSettings', 'PhysicsSettings must be an array')
    return
  }
  Array.from(rawSettings).forEach((setting, settingIndex) => {
    const settingPath = `metadata.physics.PhysicsSettings[${settingIndex}]`
    if (!isRecord(setting)) {
      issue(state, 'invalid-metadata', settingPath, 'physics setting must be an object')
      return
    }
    const outputs = setting.Output
    if (!Array.isArray(outputs)) {
      issue(state, 'invalid-metadata', `${settingPath}.Output`, 'Output must be an array')
      return
    }
    Array.from(outputs).forEach((output, outputIndex) => {
      const outputPath = `${settingPath}.Output[${outputIndex}]`
      if (!isRecord(output)) {
        issue(state, 'invalid-metadata', outputPath, 'physics output must be an object')
        return
      }
      const destination = output.Destination
      if (destination === null || destination === undefined || typeof destination !== 'object') {
        issue(state, 'invalid-metadata', `${outputPath}.Destination`, 'Destination must be an object or array')
        return
      }
      // Some Cubism exports use a single Destination object instead of an array.
      const destinations = Array.isArray(destination) ? destination : [destination]
      Array.from(destinations).forEach((entry, destinationIndex) => {
        const destinationPath = Array.isArray(destination)
          ? `${outputPath}.Destination[${destinationIndex}]`
          : `${outputPath}.Destination`
        if (!isRecord(entry)) {
          issue(state, 'invalid-metadata', destinationPath, 'destination must be an object')
          return
        }
        const target = entry.Target
        const id = entry.Id
        if (!isNonEmptyString(target)) {
          issue(state, 'invalid-metadata', `${destinationPath}.Target`, 'Target must be a non-empty string')
          return
        }
        if (!isNonEmptyString(id)) {
          issue(state, 'invalid-metadata', `${destinationPath}.Id`, 'Id must be a non-empty string')
          return
        }
        if (target === 'Parameter') physicsOutputIds.add(id)
      })
    })
  })
}

function validateExpressions(
  raw: unknown[],
  state: ValidationState,
): ModelInspectionInput['expressions'] | null {
  const names = new Set<string>()
  const expressions: ModelInspectionInput['expressions'] = []

  Array.from(raw).forEach((entry, index) => {
    const path = `metadata.expressions[${index}]`
    if (!isRecord(entry)) {
      issue(state, 'invalid-metadata', path, 'expression resource must be an object')
      return
    }
    rejectUnknownKeys(entry, EXPRESSION_KEYS, path, state)
    const name = entry.name
    const json = entry.json
    if (!isNonEmptyString(name)) {
      issue(state, 'invalid-metadata', `${path}.name`, 'name must be a non-empty string')
      return
    }
    if (!isRecord(json)) {
      issue(state, 'invalid-metadata', `${path}.json`, 'json must be an object')
      return
    }
    if (!checkJsonSize(json, `${path}.json`, state)) return
    const rawParameters = json.Parameters
    if (!Array.isArray(rawParameters)) {
      issue(state, 'invalid-metadata', `${path}.json.Parameters`, 'Parameters must be an array')
      return
    }

    const parameters: ModelInspectionInput['expressions'][number]['parameters'] = []
    let valid = true
    Array.from(rawParameters).forEach((rawParameter, parameterIndex) => {
      const parameterPath = `${path}.json.Parameters[${parameterIndex}]`
      if (!isRecord(rawParameter)) {
        issue(state, 'invalid-metadata', parameterPath, 'expression parameter must be an object')
        valid = false
        return
      }
      const id = rawParameter.Id
      const value = rawParameter.Value
      const blend = rawParameter.Blend
      const blendOk = typeof blend === 'string' && BLEND_MODES.has(blend)
      if (!isNonEmptyString(id)) {
        issue(state, 'invalid-metadata', `${parameterPath}.Id`, 'Id must be a non-empty string')
        valid = false
      }
      if (!isFiniteNumber(value)) {
        issue(state, 'invalid-metadata', `${parameterPath}.Value`, 'Value must be finite')
        valid = false
      }
      if (!blendOk) {
        issue(state, 'invalid-metadata', `${parameterPath}.Blend`, 'Blend must be Add, Multiply or Overwrite')
        valid = false
      }
      if (typeof id === 'string' && isNonEmptyString(id) && isFiniteNumber(value) && blendOk) {
        parameters.push({ id, value, blend: blend as 'Add' | 'Multiply' | 'Overwrite' })
      }
    })

    if (!valid) return
    if (names.has(name)) {
      issue(state, 'invalid-metadata', `${path}.name`, `duplicate expression name "${name}"`)
      return
    }
    names.add(name)
    expressions.push({ name, parameters })
  })

  return state.issues.length === 0 ? expressions : null
}

function validateMotions(raw: unknown[], state: ValidationState): ModelInspectionInput['motions'] | null {
  const keys = new Set<string>()
  const motions: ModelInspectionInput['motions'] = []

  Array.from(raw).forEach((entry, index) => {
    const path = `metadata.motions[${index}]`
    if (!isRecord(entry)) {
      issue(state, 'invalid-metadata', path, 'motion resource must be an object')
      return
    }
    rejectUnknownKeys(entry, MOTION_KEYS, path, state)
    const group = entry.group
    const motionIndex = entry.index
    const json = entry.json
    if (!isNonEmptyString(group)) {
      issue(state, 'invalid-metadata', `${path}.group`, 'group must be a non-empty string')
      return
    }
    if (typeof motionIndex !== 'number' || !Number.isInteger(motionIndex) || motionIndex < 0) {
      issue(state, 'invalid-metadata', `${path}.index`, 'index must be a non-negative integer')
      return
    }
    if (!isRecord(json)) {
      issue(state, 'invalid-metadata', `${path}.json`, 'json must be an object')
      return
    }
    if (!checkJsonSize(json, `${path}.json`, state)) return
    const rawMeta = json.Meta
    let durationMs: number | null = null
    let loop: boolean | null = null
    if (rawMeta !== undefined) {
      if (!isRecord(rawMeta)) {
        issue(state, 'invalid-metadata', `${path}.json.Meta`, 'Meta must be an object when present')
        return
      }
      if (rawMeta.Duration !== undefined) {
        if (!isFiniteNumber(rawMeta.Duration) || rawMeta.Duration < 0) {
          issue(state, 'invalid-metadata', `${path}.json.Meta.Duration`, 'Duration must be a non-negative finite number')
          return
        }
        durationMs = Math.round(rawMeta.Duration * 1000)
      }
      if (rawMeta.Loop !== undefined) {
        if (typeof rawMeta.Loop !== 'boolean') {
          issue(state, 'invalid-metadata', `${path}.json.Meta.Loop`, 'Loop must be a boolean')
          return
        }
        loop = rawMeta.Loop
      }
    }

    const rawCurves = json.Curves
    if (!Array.isArray(rawCurves)) {
      issue(state, 'invalid-metadata', `${path}.json.Curves`, 'Curves must be an array')
      return
    }

    const targetSummaries: NativeMotionDefinition['curveTargets'] = {
      Parameter: { curveCount: 0, targetIds: [] },
      Model: { curveCount: 0, targetIds: [] },
      PartOpacity: { curveCount: 0, targetIds: [] },
    }
    const seenTargetIds = {
      Parameter: new Set<string>(),
      Model: new Set<string>(),
      PartOpacity: new Set<string>(),
    }
    let valid = true
    Array.from(rawCurves).forEach((rawCurve, curveIndex) => {
      const curvePath = `${path}.json.Curves[${curveIndex}]`
      if (!isRecord(rawCurve)) {
        issue(state, 'invalid-metadata', curvePath, 'motion curve must be an object')
        valid = false
        return
      }
      const target = rawCurve.Target
      const id = rawCurve.Id
      if (typeof target !== 'string' || !MOTION_TARGETS.has(target)) {
        issue(state, 'invalid-metadata', `${curvePath}.Target`, 'Target must be Parameter, Model or PartOpacity')
        valid = false
        return
      }
      if (!isNonEmptyString(id)) {
        issue(state, 'invalid-metadata', `${curvePath}.Id`, 'Id must be a non-empty string')
        valid = false
        return
      }
      if (typeof target === 'string' && MOTION_TARGETS.has(target) && typeof id === 'string' && isNonEmptyString(id)) {
        const typedTarget = target as keyof typeof targetSummaries
        targetSummaries[typedTarget].curveCount += 1
        if (!seenTargetIds[typedTarget].has(id)) {
          seenTargetIds[typedTarget].add(id)
          targetSummaries[typedTarget].targetIds.push(id)
        }
      }
    })

    if (!valid) return
    const key = `${group}\u0000${motionIndex}`
    if (keys.has(key)) {
      issue(state, 'invalid-metadata', path, `duplicate motion resource "${group}#${motionIndex}"`)
      return
    }
    keys.add(key)
    motions.push({
      group,
      index: motionIndex,
      parameterIds: [...targetSummaries.Parameter.targetIds],
      durationMs,
      loop,
      curveTargets: targetSummaries,
    })
  })

  return state.issues.length === 0 ? motions : null
}

function readMetadata(request: unknown): { ok: true; metadata: ConvertedMetadata } | FailureResult {
  const state: ValidationState = { issues: [] }
  if (!isRecord(request)) {
    issue(state, 'invalid-metadata', 'request', 'request must be an object')
    return failure(state)
  }
  rejectUnknownKeys(request, REQUEST_KEYS, 'request', state)

  const metadata = request.metadata
  if (!isRecord(metadata)) {
    issue(state, 'invalid-metadata', 'metadata', 'metadata must be an object')
    return failure(state)
  }
  rejectUnknownKeys(metadata, METADATA_KEYS, 'metadata', state)

  const cdi = metadata.cdi
  const physics = metadata.physics
  const rawExpressions = metadata.expressions
  const rawMotions = metadata.motions

  if (cdi === undefined) {
    issue(state, 'invalid-metadata', 'metadata.cdi', 'cdi must be null when absent')
  }
  if (physics === undefined) {
    issue(state, 'invalid-metadata', 'metadata.physics', 'physics must be null when absent')
  }
  if (!Array.isArray(rawExpressions)) {
    issue(state, 'invalid-metadata', 'metadata.expressions', 'expressions must be an array')
  }
  if (!Array.isArray(rawMotions)) {
    issue(state, 'invalid-metadata', 'metadata.motions', 'motions must be an array')
  }
  if (!Array.isArray(rawExpressions) || !Array.isArray(rawMotions)) {
    return failure(state)
  }
  if (rawExpressions.length + rawMotions.length > MAX_METADATA_RESOURCES) {
    issue(state, 'invalid-metadata', 'metadata', `resource count exceeds ${MAX_METADATA_RESOURCES}`)
    return failure(state)
  }

  const labels = new Map<string, string>()
  const physicsOutputIds = new Set<string>()
  if (cdi !== undefined && cdi !== null) validateCdi(cdi, labels, state)
  if (physics !== undefined && physics !== null) validatePhysics(physics, physicsOutputIds, state)
  const expressions = validateExpressions(rawExpressions, state)
  const motions = validateMotions(rawMotions, state)
  if (state.issues.length > 0 || expressions === null || motions === null) return failure(state)

  return { ok: true, metadata: { labels, physicsOutputIds, expressions, motions } }
}

function copyOverrides(value: unknown): ModelInspectionInput['overrides'] {
  if (!Array.isArray(value)) return value as ModelInspectionInput['overrides']
  return value.map((entry) => (isRecord(entry) ? { ...entry } : entry)) as ModelInspectionInput['overrides']
}

function assemble(
  parameters: CoreParameterSnapshot[],
  metadata: ConvertedMetadata,
  request: Record<string, unknown>,
): CoreInspectionResult {
  const input: ModelInspectionInput = {
    schemaVersion: 1,
    modelSignature: request.modelSignature as string,
    parameters: parameters.map<InspectedParameter>((parameter) => {
      const label = metadata.labels.get(parameter.id)
      return {
        id: parameter.id,
        min: parameter.min,
        max: parameter.max,
        defaultValue: parameter.defaultValue,
        physicsOutput: metadata.physicsOutputIds.has(parameter.id),
        ...(label === undefined ? {} : { label }),
      }
    }),
    expressions: metadata.expressions,
    motions: metadata.motions,
    overrides: copyOverrides(request.overrides),
  }

  const result = buildModelCapabilityProfile(input)
  if (!result.ok) {
    return {
      ok: false,
      issues: result.issues.map((entry) => ({
        code: 'invalid-profile',
        path: entry.path,
        message: `${entry.code}: ${entry.message}`,
      })),
    }
  }
  return { ok: true, input }
}

/**
 * Converts one initialized Cubism Core view plus already-read metadata into the
 * frozen first-wave inspection input. Malformed Core or metadata returns
 * structured issues; a Core that cannot be inspected never throws to callers.
 */
export function inspectCoreModel(core: CoreModelView, request: CoreInspectionRequest): CoreInspectionResult {
  let parameters: CoreParameterSnapshot[]
  try {
    const coreResult = readCoreParameters(core as unknown)
    if (!coreResult.ok) return coreResult
    parameters = coreResult.parameters
  } catch {
    return {
      ok: false,
      issues: [{ code: 'invalid-core', path: 'core', message: 'core could not be inspected' }],
    }
  }

  let metadata: ConvertedMetadata
  try {
    const metadataResult = readMetadata(request as unknown)
    if (!metadataResult.ok) return metadataResult
    metadata = metadataResult.metadata
  } catch {
    return {
      ok: false,
      issues: [{ code: 'invalid-metadata', path: 'metadata', message: 'metadata could not be inspected' }],
    }
  }

  try {
    return assemble(parameters, metadata, request as unknown as Record<string, unknown>)
  } catch {
    return {
      ok: false,
      issues: [{ code: 'invalid-profile', path: '$', message: 'profile could not be built' }],
    }
  }
}
