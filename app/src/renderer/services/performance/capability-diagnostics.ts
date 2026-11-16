import type {
  ModelCapabilityProfile,
  NativeMotionDefinition,
} from '../../../shared/first-wave-contracts'
import { DEFAULT_LIP_SYNC, type ModelControlTarget, type ModelEmotionAdapter } from '../live2d/emotion-adapter'
import { DEFAULT_FOCUS_MAPPING } from '../live2d/focus-mapping'
import type { ModelCapabilities } from '../live2d/loader'

export const STANDARD_ANIMATION_SEMANTICS = [
  'wave', 'jump', 'spin', 'sit', 'sleep', 'wake', 'dance', 'cheer',
] as const

export type CapabilityDiagnosticCode =
  | 'missing-motion-resource'
  | 'missing-expression-resource'
  | 'missing-parameter'
  | 'missing-part'
  | 'unmapped-animation-semantic'
  | 'shared-motion-resource'
  | 'motion-semantic-needs-review'
  | 'speech-mouth-parameter-conflict'
  | 'motion-parameter-overlap'

export interface CapabilityDiagnostic {
  code: CapabilityDiagnosticCode
  severity: 'error' | 'warning' | 'info' | 'review'
  path: string
  message: string
  semantic?: string
  resource?: string
  relatedSemantics?: string[]
  parameterIds?: string[]
  partIds?: string[]
}

export interface ModelCapabilityFacts {
  schemaVersion: 1
  modelSignature: string
  modelUrl?: string
  motionGroups?: Record<string, number>
  source: {
    core: 'loaded-cubism-core'
    resources: 'model3-declared-assets'
    adapter: 'deskpet-adapter' | 'builtin-adapter' | 'runtime-defaults'
  }
  parameters: ModelCapabilityProfile['parameters']
  expressions: ModelCapabilityProfile['expressions']
  unregisteredExpressions?: string[]
  motions: ModelCapabilityProfile['motions']
  parts?: NonNullable<ModelCapabilities['parts']>
  poseGroups?: string[][]
  bindings: {
    idleMotions: string[]
    lipSync: ModelEmotionAdapter['lipSync']
    focus: typeof DEFAULT_FOCUS_MAPPING
    focusSource: 'adapter' | 'runtime-default'
    baseParameters: Record<string, number>
    hiddenParts: string[]
    hiddenDrawables: string[]
    emotions: ModelEmotionAdapter['emotions']
    animations: ModelEmotionAdapter['animations']
    controls: ModelEmotionAdapter['controls']
  }
  /** Effective values after runtime control/base resolution; present when the caller supplies loaded capabilities. */
  resolved?: {
    baseParameters: Record<string, number>
    controls: NonNullable<ModelCapabilities['controls']>
  }
  diagnostics: CapabilityDiagnostic[]
}

interface MotionBinding {
  path: string
  semantic: string
  resource: string
  motion: NativeMotionDefinition | undefined
}

function motionKey(group: string, index = 0): string {
  return `${group}#${index}`
}

function cloneMotion(motion: NativeMotionDefinition): NativeMotionDefinition {
  return {
    group: motion.group,
    index: motion.index,
    parameterIds: [...motion.parameterIds],
    ...(motion.durationMs !== undefined ? { durationMs: motion.durationMs } : {}),
    ...(motion.loop !== undefined ? { loop: motion.loop } : {}),
    ...(motion.curveTargets ? {
      curveTargets: {
        Parameter: {
          curveCount: motion.curveTargets.Parameter.curveCount,
          targetIds: [...motion.curveTargets.Parameter.targetIds],
        },
        Model: {
          curveCount: motion.curveTargets.Model.curveCount,
          targetIds: [...motion.curveTargets.Model.targetIds],
        },
        PartOpacity: {
          curveCount: motion.curveTargets.PartOpacity.curveCount,
          targetIds: [...motion.curveTargets.PartOpacity.targetIds],
        },
      },
    } : {}),
  }
}

function cloneParameterMap(parameters: Record<string, number> | undefined): Record<string, number> | undefined {
  return parameters ? { ...parameters } : undefined
}

function cloneControl(target: ModelControlTarget): ModelControlTarget {
  return {
    ...target,
    ...(target.parameters ? { parameters: { ...target.parameters } } : {}),
    ...(target.hiddenParts ? { hiddenParts: [...target.hiddenParts] } : {}),
    ...(target.shownParts ? { shownParts: [...target.shownParts] } : {}),
  }
}

function cloneResolvedControl(
  control: NonNullable<ModelCapabilities['controls']>[number],
): NonNullable<ModelCapabilities['controls']>[number] {
  return {
    ...control,
    parameters: { ...control.parameters },
    ...(control.hiddenParts ? { hiddenParts: [...control.hiddenParts] } : {}),
    ...(control.shownParts ? { shownParts: [...control.shownParts] } : {}),
  }
}

function cloneAdapter(adapter: ModelEmotionAdapter): ModelCapabilityFacts['bindings'] {
  const focus = adapter.focus ?? DEFAULT_FOCUS_MAPPING
  return {
    idleMotions: [...adapter.idleMotions],
    lipSync: { ...adapter.lipSync },
    focus: { ...focus },
    focusSource: adapter.focus ? 'adapter' : 'runtime-default',
    baseParameters: { ...adapter.baseParameters },
    hiddenParts: [...adapter.hiddenParts],
    hiddenDrawables: [...adapter.hiddenDrawables],
    emotions: Object.fromEntries(Object.entries(adapter.emotions).map(([semantic, target]) => [semantic, {
      ...(target.expression ? { expression: target.expression } : {}),
      ...(target.motion ? { motion: { ...target.motion } } : {}),
      ...(target.parameters ? { parameters: cloneParameterMap(target.parameters) } : {}),
    }])),
    animations: Object.fromEntries(Object.entries(adapter.animations).map(([semantic, target]) => [semantic, {
      motion: { ...target.motion },
    }])),
    controls: Object.fromEntries(Object.entries(adapter.controls).map(([id, target]) => [id, cloneControl(target)])),
  }
}

/**
 * Builds a detached, read-only diagnostic export. It proves structural facts
 * and identifies review work; it never claims that a motion visually matches a semantic.
 */
export function buildModelCapabilityFacts(
  profile: ModelCapabilityProfile,
  adapter: ModelEmotionAdapter,
  caps?: ModelCapabilities | null,
): ModelCapabilityFacts {
  const diagnostics: CapabilityDiagnostic[] = []
  const parameterIds = new Set(profile.parameters.map(parameter => parameter.id))
  const expressionNames = new Set(profile.expressions.map(expression => expression.name))
  const unregisteredExpressionNames = new Set((caps?.unregisteredExpressions ?? []).map(name => name.toLowerCase()))
  const partIds = new Set((caps?.parts ?? []).map(part => part.id))
  const motions = new Map(profile.motions.map(motion => [motionKey(motion.group, motion.index), motion]))
  const motionBindings: MotionBinding[] = []
  const isKnownExpression = (name: string): boolean =>
    expressionNames.has(name) || unregisteredExpressionNames.has(name.toLowerCase())

  const checkParameters = (path: string, values: Record<string, number> | undefined): void => {
    for (const parameterId of Object.keys(values ?? {})) {
      if (parameterIds.has(parameterId)) continue
      diagnostics.push({
        code: 'missing-parameter', severity: 'error', path: `${path}.parameters.${parameterId}`,
        message: `参数 ${parameterId} 不在已加载的 Core 模型中。`, parameterIds: [parameterId],
      })
    }
  }

  const checkExpression = (path: string, name: string | undefined, where: string): void => {
    if (!name || isKnownExpression(name)) return
    diagnostics.push({
      code: 'missing-expression-resource', severity: 'error', path,
      message: `${where}引用了不存在的表情 ${name}。`, resource: name,
    })
  }

  const checkParts = (path: string, ids: string[] | undefined): void => {
    if (partIds.size === 0) return
    for (const [index, partId] of (ids ?? []).entries()) {
      if (partIds.has(partId)) continue
      diagnostics.push({
        code: 'missing-part', severity: 'error', path: `${path}[${index}]`,
        message: `部件 ${partId} 不在该模型的部件列表中。`, partIds: [partId],
      })
    }
  }

  const addMotionBinding = (path: string, semantic: string, group: string, index = 0): MotionBinding => {
    const resource = motionKey(group, index)
    const binding = { path, semantic, resource, motion: motions.get(resource) }
    motionBindings.push(binding)
    if (!binding.motion) {
      diagnostics.push({
        code: 'missing-motion-resource', severity: 'error', path,
        message: `语义 ${semantic} 引用了不存在的原生动作 ${resource}。`, semantic, resource,
      })
    } else {
      diagnostics.push({
        code: 'motion-semantic-needs-review', severity: 'review', path,
        message: `原生动作 ${resource} 是否适合语义 ${semantic} 仍需逐项画面验收。`, semantic, resource,
      })
    }
    return binding
  }

  for (const [semantic, target] of Object.entries(adapter.emotions)) {
    const path = `emotions.${semantic}`
    const binding = target.motion
      ? addMotionBinding(`${path}.motion`, `emotion:${semantic}`, target.motion.group, target.motion.index ?? 0)
      : null
    checkExpression(`${path}.expression`, target.expression, `情绪 ${semantic} `)
    checkParameters(path, target.parameters)
    if (target.parameters && Object.prototype.hasOwnProperty.call(target.parameters, adapter.lipSync.mouthOpenParam)) {
      diagnostics.push({
        code: 'speech-mouth-parameter-conflict', severity: 'warning', path: `${path}.parameters.${adapter.lipSync.mouthOpenParam}`,
        message: `情绪 ${semantic} 写入说话口型参数 ${adapter.lipSync.mouthOpenParam}，说话时可能争用张嘴通道。`,
        semantic: `emotion:${semantic}`, parameterIds: [adapter.lipSync.mouthOpenParam],
      })
    }
    if (binding?.motion && target.parameters) {
      const overlap = binding.motion.parameterIds.filter(id => Object.prototype.hasOwnProperty.call(target.parameters, id))
      if (overlap.length > 0) {
        diagnostics.push({
          code: 'motion-parameter-overlap', severity: 'warning', path,
          message: `情绪 ${semantic} 的原生动作和手写参数同时驱动 ${overlap.join(', ')}。`,
          semantic: `emotion:${semantic}`, resource: binding.resource, parameterIds: overlap,
        })
      }
    }
  }

  for (const [semantic, target] of Object.entries(adapter.animations)) {
    addMotionBinding(`animations.${semantic}.motion`, `animation:${semantic}`, target.motion.group, target.motion.index ?? 0)
  }
  for (const semantic of STANDARD_ANIMATION_SEMANTICS) {
    if (adapter.animations[semantic]) continue
    diagnostics.push({
      code: 'unmapped-animation-semantic', severity: 'info', path: `animations.${semantic}`,
      message: `动作语义 ${semantic} 没有显式绑定。`, semantic: `animation:${semantic}`,
    })
  }

  for (const [index, group] of adapter.idleMotions.entries()) {
    const resource = motionKey(group, 0)
    if (motions.has(resource)) continue
    diagnostics.push({
      code: 'missing-motion-resource', severity: 'error', path: `idleMotions[${index}]`,
      message: `待机动作组 ${group} 没有可用的 index 0 资源。`, semantic: `idle:${group}`, resource,
    })
  }

  checkParameters('baseParameters', adapter.baseParameters)
  checkParts('hiddenParts', adapter.hiddenParts)
  for (const [controlId, target] of Object.entries(adapter.controls)) {
    checkParameters(`controls.${controlId}`, target.parameters)
    checkExpression(`controls.${controlId}.expression`, target.expression, `控件 ${controlId} `)
    checkParts(`controls.${controlId}.hiddenParts`, target.hiddenParts)
    checkParts(`controls.${controlId}.shownParts`, target.shownParts)
  }
  if (!parameterIds.has(adapter.lipSync.mouthOpenParam)) {
    const isDefaultMouth = adapter.lipSync.mouthOpenParam === DEFAULT_LIP_SYNC.mouthOpenParam
    diagnostics.push({
      code: 'missing-parameter', severity: isDefaultMouth ? 'warning' : 'error', path: 'lipSync.mouthOpenParam',
      message: isDefaultMouth
        ? `默认口型参数 ${adapter.lipSync.mouthOpenParam} 不在已加载的 Core 模型中；未声明真实张嘴参数时口型同步不会生效。`
        : `口型参数 ${adapter.lipSync.mouthOpenParam} 不在已加载的 Core 模型中。`,
      parameterIds: [adapter.lipSync.mouthOpenParam],
    })
  }
  const effectiveFocus = adapter.focus ?? DEFAULT_FOCUS_MAPPING
  {
    const focusParameters = [
      ['headXParam', effectiveFocus.headXParam],
      ['headYParam', effectiveFocus.headYParam],
      ['headZParam', effectiveFocus.headZParam],
      ['eyeXParam', effectiveFocus.eyeXParam],
      ['eyeYParam', effectiveFocus.eyeYParam],
      ['bodyXParam', effectiveFocus.bodyXParam],
      ['bodyYParam', effectiveFocus.bodyYParam],
      ['bodyZParam', effectiveFocus.bodyZParam],
    ] as const
    for (const [field, parameterId] of focusParameters) {
      if (!parameterId || parameterIds.has(parameterId)) continue
      diagnostics.push({
        code: 'missing-parameter', severity: 'error', path: `focus.${field}`,
        message: `视线跟随参数 ${parameterId} 不在已加载的 Core 模型中。`, parameterIds: [parameterId],
      })
    }
  }

  const byResource = new Map<string, MotionBinding[]>()
  for (const binding of motionBindings) {
    if (!binding.motion) continue
    const group = byResource.get(binding.resource) ?? []
    group.push(binding)
    byResource.set(binding.resource, group)
  }
  for (const [resource, bindings] of byResource) {
    if (bindings.length < 2) continue
    const relatedSemantics = bindings.map(binding => binding.semantic)
    diagnostics.push({
      code: 'shared-motion-resource', severity: 'review', path: bindings[0].path,
      message: `${relatedSemantics.join('、')} 共用原生动作 ${resource}，需要分别验收语义是否成立。`,
      resource, relatedSemantics,
    })
  }

  const resolved = caps
    ? {
        baseParameters: { ...(caps.baseParameters ?? adapter.baseParameters) },
        controls: (caps.controls ?? []).map(cloneResolvedControl),
      }
    : undefined
  const parts = caps?.parts?.length ? caps.parts.map(part => ({ ...part })) : undefined
  const poseGroups = caps?.poseGroups?.length ? caps.poseGroups.map(group => [...group]) : undefined
  const unregisteredExpressions = caps?.unregisteredExpressions?.length
    ? [...caps.unregisteredExpressions]
    : undefined

  return {
    schemaVersion: 1,
    modelSignature: profile.modelSignature,
    ...(caps?.modelUrl ? { modelUrl: caps.modelUrl } : {}),
    ...(caps?.motionGroups ? { motionGroups: { ...caps.motionGroups } } : {}),
    source: {
      core: 'loaded-cubism-core',
      resources: 'model3-declared-assets',
      adapter: adapter.loaded
        ? adapter.adapterSource === 'builtin' ? 'builtin-adapter' : 'deskpet-adapter'
        : 'runtime-defaults',
    },
    parameters: profile.parameters.map(parameter => ({ ...parameter })),
    expressions: profile.expressions.map(expression => ({
      name: expression.name,
      parameters: expression.parameters.map(parameter => ({ ...parameter })),
    })),
    ...(unregisteredExpressions ? { unregisteredExpressions } : {}),
    motions: profile.motions.map(cloneMotion),
    ...(parts ? { parts } : {}),
    ...(poseGroups ? { poseGroups } : {}),
    bindings: cloneAdapter(adapter),
    ...(resolved ? { resolved } : {}),
    diagnostics,
  }
}
