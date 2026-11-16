/**
 * 动作工坊 -> 标准 Live2D Cubism 3/4/5 motion3.json 动作导出器
 *
 * 核心特性：
 * 1. 严格符合 Cubism 3/4/5 Motion 规范（Version: 3, Meta, Curves, Segments）。
 * 2. 30Hz / 60Hz 确定性采样插值（基于 easeInOutCubic 曲线与 step.holdMs 保持）。
 * 3. 自动排除物理输出通道（physicsOutputIds），防止动作在 VTube Studio 中与物理演算冲突。
 * 4. 自动剔除全程无变化的冗余参数，保持导出的动作文件极致轻量。
 * 5. 完整支持控件多段切换（如 大小变:中）与部件显隐（PartOpacity）。
 * 6. 支持三种收尾模式（hold 保持终态、revert 优雅回待机、loop 循环）。
 */

import { isNativeMotionBinding } from '../../../shared/native-motion'
import type {
  PresetFinishMode,
  PresetKeyframeStep,
  ResolvedModelControl,
  ResolvedModelSlider,
} from './emotion-adapter'
import {
  applyControlActionToList,
  computeControlLayerState,
} from './emotion-adapter'
import type { ModelCapabilities } from './loader'

export interface MotionExportOptions {
  /** 导出帧率，默认 30，可选 15..60 */
  fps?: number
  /** 动作收尾模式：hold（保持终态）、revert（平滑回待机）、loop（循环动作） */
  finishMode?: PresetFinishMode
  /** finishMode 为 revert 时的终态保持时长（毫秒），默认 1600ms */
  revertHoldMs?: number
  /** finishMode 为 revert 时淡出回待机所需时长（毫秒），默认 600ms */
  revertTransitionMs?: number
  /** 是否自动排除物理输出通道，默认 true */
  excludePhysicsOutputs?: boolean
  /** 物理输出参数 ID 集合（从模型 physics3.json 获取） */
  physicsOutputIds?: string[] | Set<string>
  /** 是否强制循环（优先使用 finishMode === 'loop'） */
  loop?: boolean
  /** 曲线淡入淡出时间（秒），默认 0.0 */
  fadeTime?: number
  /** 基础隐藏部件集合 */
  baseHiddenParts?: string[]
}

export interface Live2dMotion3Curve {
  Target: 'Parameter' | 'PartOpacity'
  Id: string
  FadeInTime?: number
  FadeOutTime?: number
  Segments: number[]
}

export interface Live2dMotion3Json {
  Version: 3
  Meta: {
    Duration: number
    Fps: number
    Loop: boolean
    AreBeziersRestricted: boolean
    CurveCount: number
    TotalSegmentCount: number
    TotalPointCount: number
    UserDataCount: number
    TotalUserDataSize: number
    FadeInTime: number
    FadeOutTime: number
  }
  Curves: Live2dMotion3Curve[]
  UserData: Array<{
    Time: number
    Value: string
  }>
}

/** 三次方平滑缓动曲线（与 Uta 舞台 runtime 保持 100% 一致） */
export function easeInOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2
}

/** 规范化浮点数，保留指定位小数 */
export function roundTo(val: number, decimals = 4): number {
  const factor = Math.pow(10, decimals)
  return Math.round(val * factor) / factor
}

/** 格式化动作导出的文件名（自动补充 .motion3.json 后缀并清洗非法字符） */
export function formatMotionFilename(presetName: string): string {
  const trimmed = (presetName ?? '').trim() || 'uta-motion'
  const sanitized = trimmed
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '-')
  if (sanitized.toLowerCase().endsWith('.motion3.json')) {
    return sanitized
  }
  if (sanitized.toLowerCase().endsWith('.json')) {
    return sanitized.slice(0, -5) + '.motion3.json'
  }
  return `${sanitized}.motion3.json`
}

interface ResolvedStepState {
  parameters: Record<string, number>
  partOpacities: Record<string, number>
}

/** 将步骤解析为具体的参数字典与部件透明度 */
function resolveStepState(
  step: PresetKeyframeStep | undefined,
  allControls: ResolvedModelControl[],
  allSliders: ResolvedModelSlider[],
  caps: ModelCapabilities | null,
  baseHiddenParts: string[],
): ResolvedStepState {
  const clonedControls = allControls.map((c) => ({
    ...c,
    active: false,
    currentStageIndex: c.defaultStageIndex ?? 0,
  }))

  if (step?.controls && step.controls.length > 0) {
    applyControlActionToList(clonedControls, step.controls, 'on', caps)
  }

  const ctrlLayer = computeControlLayerState(clonedControls, baseHiddenParts, caps)

  const parameters: Record<string, number> = {}
  for (const s of allSliders) {
    parameters[s.id] = s.defaultValue
  }
  for (const [pid, val] of Object.entries(ctrlLayer.parameters)) {
    parameters[pid] = val
  }
  if (step?.parameters) {
    for (const [pid, val] of Object.entries(step.parameters)) {
      if (typeof val === 'number' && Number.isFinite(val)) {
        parameters[pid] = val
      }
    }
  }

  const partOpacities: Record<string, number> = {}
  for (const partId of baseHiddenParts) {
    partOpacities[partId] = 0.0
  }
  for (const partId of ctrlLayer.hiddenParts) {
    partOpacities[partId] = 0.0
  }
  for (const partId of ctrlLayer.shownParts) {
    partOpacities[partId] = 1.0
  }

  return { parameters, partOpacities }
}

/** 动作时间线上的时间切片 */
interface TimelineSpan {
  startTime: number
  duration: number
  kind: 'transition' | 'hold'
  fromParams: Record<string, number>
  toParams: Record<string, number>
  fromParts: Record<string, number>
  toParts: Record<string, number>
}

/**
 * 将工坊的关键帧步骤导出为标准 Live2D motion3.json
 */
export function exportPresetStepsToMotion3(
  steps: PresetKeyframeStep[],
  options?: MotionExportOptions,
  modelContext?: {
    sliders?: ResolvedModelSlider[]
    controls?: ResolvedModelControl[]
    capabilities?: ModelCapabilities | null
  },
): Live2dMotion3Json {
  const fps = Math.min(60, Math.max(10, Math.round(options?.fps ?? 30)))
  const finishMode: PresetFinishMode = options?.finishMode ?? 'hold'
  const isLoop = options?.loop !== undefined ? options.loop : finishMode === 'loop'
  const revertHoldSec = (options?.revertHoldMs ?? 1600) / 1000
  const revertTransitionSec = (options?.revertTransitionMs ?? 600) / 1000
  const fadeTime = Math.max(0, options?.fadeTime ?? 0)

  const allSliders = modelContext?.sliders ?? []
  const allControls = modelContext?.controls ?? []
  const caps = modelContext?.capabilities ?? null
  const baseHiddenParts = options?.baseHiddenParts ?? []

  const physicsSet = new Set<string>()
  if (options?.excludePhysicsOutputs !== false) {
    if (options?.physicsOutputIds) {
      for (const id of options.physicsOutputIds) physicsSet.add(id)
    }
    for (const p of caps?.parameters ?? []) {
      if (p.isPhysicsOutput) physicsSet.add(p.id)
    }
  }

  // 原生动作导出校验：若步骤中包含绑定的外部原生动作，明确阻止导出并提示原因，避免导出不完整的空曲线
  const stepsWithMotion = steps.filter(
    (s) => isNativeMotionBinding(s.motion),
  )
  if (stepsWithMotion.length > 0) {
    const motionNames = Array.from(new Set(stepsWithMotion.map((s) => s.motion!.group || '未命名动作组'))).join('、')
    throw new Error(
      `分镜步骤中包含绑定的原生动作（${motionNames}）。导出器暂不支持将预制原生动作混流导出为单一 motion3.json 文件，请使用纯参数与部件分镜进行导出。`,
    )
  }

  // 1. 解析静止态（Resting State）
  const restingState = resolveStepState(undefined, allControls, allSliders, caps, baseHiddenParts)
  const modelDefaults = new Map((caps?.parameters ?? []).map(parameter => [parameter.id, parameter.default]))
  const restingValue = (id: string) => restingState.parameters[id] ?? caps?.baseParameters?.[id] ?? modelDefaults.get(id) ?? 0

  // 2. 构建连续时间线切片（Timeline Spans）
  const spans: TimelineSpan[] = []
  let currentTime = 0
  const loopTimeline = isLoop && steps.length > 1
  let previousState = loopTimeline
    ? resolveStepState(steps[0], allControls, allSliders, caps, baseHiddenParts)
    : restingState

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const stepState = resolveStepState(step, allControls, allSliders, caps, baseHiddenParts)
    // 循环文件从首帧开始，首步入场淡入不烘焙进每一轮，与舞台重复播放的时间线一致。
    const transitionSec = loopTimeline && i === 0 ? 0 : Math.max(0, (step.durationMs ?? 600) / 1000)
    const holdSec = Math.max(0, (step.holdMs ?? 0) / 1000)

    // 过渡阶段
    if (transitionSec > 0) {
      spans.push({
        startTime: currentTime,
        duration: transitionSec,
        kind: 'transition',
        fromParams: previousState.parameters,
        toParams: stepState.parameters,
        fromParts: previousState.partOpacities,
        toParts: stepState.partOpacities,
      })
      currentTime += transitionSec
    }

    // 保持阶段
    if (holdSec > 0) {
      spans.push({
        startTime: currentTime,
        duration: holdSec,
        kind: 'hold',
        fromParams: stepState.parameters,
        toParams: stepState.parameters,
        fromParts: stepState.partOpacities,
        toParts: stepState.partOpacities,
      })
      currentTime += holdSec
    }

    previousState = stepState
  }

  // 3. 处理 finishMode === 'revert' 的优雅回待机
  if (finishMode === 'revert' && steps.length > 0) {
    if (revertHoldSec > 0) {
      spans.push({
        startTime: currentTime,
        duration: revertHoldSec,
        kind: 'hold',
        fromParams: previousState.parameters,
        toParams: previousState.parameters,
        fromParts: previousState.partOpacities,
        toParts: previousState.partOpacities,
      })
      currentTime += revertHoldSec
    }
    if (revertTransitionSec > 0) {
      spans.push({
        startTime: currentTime,
        duration: revertTransitionSec,
        kind: 'transition',
        fromParams: previousState.parameters,
        toParams: restingState.parameters,
        fromParts: previousState.partOpacities,
        toParts: restingState.partOpacities,
      })
      currentTime += revertTransitionSec
    }
  }

  const totalDuration = Math.max(1 / fps, currentTime)
  const frameCount = Math.max(1, Math.ceil(totalDuration * fps))

  // 4. 计算采样时间点与插值帧
  const sampleTimes: number[] = []
  for (let i = 0; i <= frameCount; i++) {
    sampleTimes.push(Math.min(i / fps, totalDuration))
  }

  function sampleAtTime(t: number): {
    params: Record<string, number>
    parts: Record<string, number>
  } {
    if (spans.length === 0) {
      return {
        params: { ...restingState.parameters },
        parts: { ...restingState.partOpacities },
      }
    }

    let activeSpan: TimelineSpan = spans[spans.length - 1]
    for (const span of spans) {
      if (t <= span.startTime + span.duration || span === spans[spans.length - 1]) {
        activeSpan = span
        break
      }
    }

    const { startTime, duration, kind, fromParams, toParams, fromParts, toParts } = activeSpan
    const rawT = duration > 0 ? (t - startTime) / duration : 1
    const eased = kind === 'transition' ? easeInOutCubic(rawT) : 1

    const sampledParams: Record<string, number> = {}
    const allParamKeys = new Set([...Object.keys(fromParams), ...Object.keys(toParams)])
    for (const pid of allParamKeys) {
      const fromVal = fromParams[pid] ?? restingValue(pid)
      const toVal = toParams[pid] ?? restingValue(pid)
      sampledParams[pid] = fromVal + (toVal - fromVal) * eased
    }

    const sampledParts: Record<string, number> = {}
    const allPartKeys = new Set([...Object.keys(fromParts), ...Object.keys(toParts)])
    for (const partId of allPartKeys) {
      const fromVal = fromParts[partId] ?? restingState.partOpacities[partId] ?? 1.0
      const toVal = toParts[partId] ?? restingState.partOpacities[partId] ?? 1.0
      sampledParts[partId] = fromVal + (toVal - fromVal) * eased
    }

    return { params: sampledParams, parts: sampledParts }
  }

  const samples = sampleTimes.map((t) => sampleAtTime(t))

  // 5. 生成参数曲线（Curves）：过滤物理输出，并剔除全程无变化的通道
  const curves: Live2dMotion3Curve[] = []
  const allCandidateParamIds = new Set<string>()
  for (const span of spans) {
    for (const id of Object.keys(span.fromParams)) allCandidateParamIds.add(id)
    for (const id of Object.keys(span.toParams)) allCandidateParamIds.add(id)
  }

  for (const pid of [...allCandidateParamIds].sort()) {
    if (physicsSet.has(pid)) continue

    const restingVal = restingValue(pid)
    let hasMotion = false
    for (const smp of samples) {
      if (Math.abs((smp.params[pid] ?? restingVal) - restingVal) > 1e-4) {
        hasMotion = true
        break
      }
    }
    if (!hasMotion) continue

    const segments: number[] = [0, roundTo(samples[0].params[pid] ?? restingVal, 5)]
    for (let i = 1; i <= frameCount; i++) {
      segments.push(0, roundTo(sampleTimes[i], 4), roundTo(samples[i].params[pid] ?? restingVal, 5))
    }

    curves.push({
      Target: 'Parameter',
      Id: pid,
      FadeInTime: fadeTime,
      FadeOutTime: fadeTime,
      Segments: segments,
    })
  }

  // 6. 生成部件显隐曲线（PartOpacity）
  const allCandidatePartIds = new Set<string>()
  for (const span of spans) {
    for (const k of Object.keys(span.fromParts)) allCandidatePartIds.add(k)
    for (const k of Object.keys(span.toParts)) allCandidatePartIds.add(k)
  }

  for (const partId of [...allCandidatePartIds].sort()) {
    const restingVal = restingState.partOpacities[partId] ?? 1.0
    let hasChange = false
    for (const smp of samples) {
      if (Math.abs((smp.parts[partId] ?? restingVal) - restingVal) > 1e-4) {
        hasChange = true
        break
      }
    }
    if (!hasChange) continue

    const segments: number[] = [0, roundTo(samples[0].parts[partId] ?? restingVal, 4)]
    for (let i = 1; i <= frameCount; i++) {
      segments.push(0, roundTo(sampleTimes[i], 4), roundTo(samples[i].parts[partId] ?? restingVal, 4))
    }

    curves.push({
      Target: 'PartOpacity',
      Id: partId,
      FadeInTime: fadeTime,
      FadeOutTime: fadeTime,
      Segments: segments,
    })
  }

  // 7. 汇总 Meta 统计指标
  const totalSegments = curves.reduce((acc, c) => acc + (c.Segments.length - 2) / 3, 0)
  const totalPoints = totalSegments + curves.length

  return {
    Version: 3,
    Meta: {
      Duration: roundTo(totalDuration, 3),
      Fps: fps,
      Loop: isLoop,
      AreBeziersRestricted: true,
      CurveCount: curves.length,
      TotalSegmentCount: totalSegments,
      TotalPointCount: totalPoints,
      UserDataCount: 0,
      TotalUserDataSize: 0,
      FadeInTime: fadeTime,
      FadeOutTime: fadeTime,
    },
    Curves: curves,
    UserData: [],
  }
}
