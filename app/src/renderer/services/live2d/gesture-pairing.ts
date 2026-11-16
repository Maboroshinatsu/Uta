import type { ModelStatePreset, PresetKeyframeStep } from './emotion-adapter'

export interface PairedGestureJoint {
  id: string
  name: string
  min: number
  max: number
  default: number
}

export interface PairedGesture {
  id: string
  name: string
  label: string
  enter: {
    group: string
    index: number
    durationMs?: number
  }
  exit: {
    group: string
    index: number
    durationMs?: number
  }
  joints: PairedGestureJoint[]
}

export interface GestureSnippetBase {
  controls: readonly string[]
  parameters: Readonly<Record<string, number>>
}

interface KnownGestureCatalogItem {
  id: string
  name: string
  label: string
  enterMatches: string[]
  exitMatches: string[]
  jointIds: Array<{ id: string; name: string }>
}

const KNOWN_GESTURE_CATALOG: KnownGestureCatalogItem[] = [
  {
    id: 'hand_on_chest',
    name: '抚胸手',
    label: '抚胸致意',
    enterMatches: ['抚胸手打开', '默认手切举手', '抚胸打开', '抚胸_打开'],
    exitMatches: ['抚胸手关闭', '举手切默认手', '抚胸关闭', '抚胸_关闭'],
    jointIds: [
      { id: 'Param62', name: '右上臂摆动' },
      { id: 'Param59', name: '右手透视' },
      { id: 'Param60', name: '右前臂' },
      { id: 'Param61', name: '右手手腕' },
    ],
  },
  {
    id: 'point',
    name: '竖手指',
    label: '竖起食指',
    enterMatches: ['竖手指打开', '竖手指切出来动画', '竖食指打开', '竖手指_打开'],
    exitMatches: ['竖手指关闭', '竖手指切回默认', '竖食指关闭', '竖手指_关闭'],
    jointIds: [
      { id: 'Param36', name: '左上臂摆动' },
      { id: 'Param39', name: '左手透视' },
      { id: 'Param41', name: '左前臂' },
      { id: 'Param42', name: '左手手腕' },
      { id: 'Param43', name: '左手食指' },
    ],
  },
  {
    id: 'grass',
    name: '狗尾巴草',
    label: '拿起狗尾草',
    enterMatches: ['狗尾巴草打开', '狗尾草打开', '狗尾草切换出来', '狗尾草_打开'],
    exitMatches: ['狗尾巴草关闭', '狗尾草关闭', '狗尾草切回默认手', '狗尾草_关闭'],
    jointIds: [
      { id: 'Param36', name: '左上臂摆动' },
      { id: 'Param39', name: '左手透视' },
      { id: 'Param41', name: '左前臂' },
      { id: 'Param42', name: '左手手腕' },
    ],
  },
]

export function listPairedGestures(
  motionGroups: Record<string, number> | null | undefined,
  motionDetails?: Record<string, { durationMs?: number; loop?: boolean }> | null,
  modelParameters?: ReadonlyArray<{ id: string; min: number; max: number; default: number; name?: string }> | null,
): PairedGesture[] {
  if (!motionGroups) return []
  const availableGroups = new Set(
    Object.keys(motionGroups).filter((g) => (motionGroups[g] ?? 0) > 0),
  )

  const paramMap = new Map<string, { id: string; min: number; max: number; default: number; name?: string }>()
  for (const p of modelParameters ?? []) {
    paramMap.set(p.id, p)
  }

  const results: PairedGesture[] = []
  const matchedGroups = new Set<string>()

  // 1. Scan known catalog items
  for (const item of KNOWN_GESTURE_CATALOG) {
    const enterGroup = item.enterMatches.find((g) => availableGroups.has(g))
    const exitGroup = item.exitMatches.find((g) => availableGroups.has(g))
    if (enterGroup && exitGroup) {
      matchedGroups.add(enterGroup)
      matchedGroups.add(exitGroup)

      const enterKey = `${enterGroup}#0`
      const exitKey = `${exitGroup}#0`
      const enterDetail = motionDetails?.[enterKey] ?? motionDetails?.[enterGroup]
      const exitDetail = motionDetails?.[exitKey] ?? motionDetails?.[exitGroup]

      const joints: PairedGestureJoint[] = []
      for (const j of item.jointIds) {
        const found = paramMap.get(j.id)
        if (found) {
          joints.push({
            id: found.id,
            name: j.name || found.name || found.id,
            min: found.min,
            max: found.max,
            default: found.default,
          })
        }
      }

      results.push({
        id: item.id,
        name: item.name,
        label: item.label,
        enter: {
          group: enterGroup,
          index: 0,
          durationMs: enterDetail?.durationMs,
        },
        exit: {
          group: exitGroup,
          index: 0,
          durationMs: exitDetail?.durationMs,
        },
        joints,
      })
    }
  }

  // 2. Scan generic pairing patterns (打开 ↔ 关闭 / 开 ↔ 关 / enter ↔ exit)
  const remainingGroups = Array.from(availableGroups).filter((g) => !matchedGroups.has(g))
  const openPatterns = [
    { openSuffix: '打开', closeSuffix: '关闭' },
    { openSuffix: '开', closeSuffix: '关' },
    { openSuffix: '_open', closeSuffix: '_close' },
    { openSuffix: '_enter', closeSuffix: '_exit' },
    { openSuffix: '_in', closeSuffix: '_out' },
  ]

  for (const pat of openPatterns) {
    for (const group of remainingGroups) {
      if (matchedGroups.has(group)) continue
      if (group.endsWith(pat.openSuffix)) {
        const prefix = group.slice(0, -pat.openSuffix.length)
        const closeGroup = `${prefix}${pat.closeSuffix}`
        if (availableGroups.has(closeGroup) && !matchedGroups.has(closeGroup)) {
          matchedGroups.add(group)
          matchedGroups.add(closeGroup)

          const enterKey = `${group}#0`
          const exitKey = `${closeGroup}#0`
          const enterDetail = motionDetails?.[enterKey] ?? motionDetails?.[group]
          const exitDetail = motionDetails?.[exitKey] ?? motionDetails?.[closeGroup]

          const baseLabel = prefix || group
          results.push({
            id: `generic_${prefix || group}`,
            name: baseLabel,
            label: `${baseLabel}（成对手势）`,
            enter: {
              group,
              index: 0,
              durationMs: enterDetail?.durationMs,
            },
            exit: {
              group: closeGroup,
              index: 0,
              durationMs: exitDetail?.durationMs,
            },
            joints: [],
          })
        }
      }
    }
  }

  return results
}

export function buildPairedGestureSteps(
  gesture: PairedGesture,
  base: GestureSnippetBase,
  options?: {
    holdDurationMs?: number
    jointOverrides?: Record<string, number>
    stepLabelPrefix?: string
  },
): PresetKeyframeStep[] {
  const enterDuration = Math.max(100, Math.round(gesture.enter.durationMs ?? 1100))
  const exitDuration = Math.max(100, Math.round(gesture.exit.durationMs ?? 1050))
  const holdDuration = Math.max(100, Math.round(options?.holdDurationMs ?? 1200))
  const prefix = options?.stepLabelPrefix ?? gesture.name

  // Step 1: 起手（播放进入动作）
  const step1: PresetKeyframeStep = {
    label: `${prefix}·起手`,
    durationMs: enterDuration,
    holdMs: 40,
    controls: [...base.controls],
    parameters: { ...base.parameters },
    motion: {
      group: gesture.enter.group,
      index: gesture.enter.index,
    },
  }

  // Step 2: 保持与微调（关节参数可调节）
  const step2: PresetKeyframeStep = {
    label: `${prefix}·姿态微调`,
    durationMs: holdDuration,
    holdMs: 200,
    controls: [...base.controls],
    parameters: {
      ...base.parameters,
      ...(options?.jointOverrides ?? {}),
    },
  }

  // Step 3: 收手（播放退出动作，关节参数恢复）
  const step3: PresetKeyframeStep = {
    label: `${prefix}·收手回正`,
    durationMs: exitDuration,
    holdMs: 0,
    controls: [...base.controls],
    parameters: { ...base.parameters },
    motion: {
      group: gesture.exit.group,
      index: gesture.exit.index,
    },
  }

  return [step1, step2, step3]
}

export function buildPairedGesturePreset(
  gesture: PairedGesture,
  base: GestureSnippetBase,
  options?: {
    holdDurationMs?: number
    jointOverrides?: Record<string, number>
  },
): ModelStatePreset {
  const steps = buildPairedGestureSteps(gesture, base, options)
  return {
    id: `preset_gesture_${gesture.id}_${Date.now()}`,
    label: `${gesture.label}（闭环）`,
    description: `成对手势闭环：${gesture.enter.group} → 姿态微调 → ${gesture.exit.group}`,
    emotion: 'neutral',
    group: '动作库',
    finishMode: 'hold',
    source: 'user',
    custom: true,
    steps,
    controls: [...base.controls],
    parameters: { ...base.parameters },
  }
}
