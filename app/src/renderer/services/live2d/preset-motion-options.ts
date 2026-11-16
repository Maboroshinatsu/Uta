export interface PresetMotionOption {
  group: string
  index: number
  label: string
  safe: boolean
}

/**
 * 这些动作组会切换/留下场景道具（自拍手机、蛋包饭、泡泡糖、开盖、喷水等）。
 * 完整列出资源，并标注场景动作；不能因名称推断而隐藏作者提供的动作。
 */
const SCENE_MOTION_GROUP_RE =
  /selfie|ketchup|bubble|splash|open.?lid|phone|danbao|paopao|scene|prop|item|weapon/i

export function listPresetMotionOptions(
  motionGroups: Record<string, number> | null | undefined,
  current?: { group: string; index?: number } | null,
  motionDetails?: Record<string, { label?: string; durationMs?: number; loop?: boolean }> | null,
): PresetMotionOption[] {
  const options: PresetMotionOption[] = listNativeMotionLibrary(motionGroups, motionDetails).map(motion => {
    const safe = !SCENE_MOTION_GROUP_RE.test(motion.group)
    return { group: motion.group, index: motion.index, label: motion.label + (safe ? '' : '（场景动作）'), safe }
  })

  if (current) {
    const index = current.index ?? 0
    if (!options.some((option) => option.group === current.group && option.index === index)) {
      options.unshift({
        group: current.group,
        index,
        label: `${current.group || '未命名动作组'} · ${index + 1}（当前绑定）`,
        safe: false,
      })
    }
  }
  return options
}

export interface NativeMotionOption {
  group: string
  index: number
  label: string
  name: string
  durationMs?: number
  loop?: boolean
}

export function listNativeMotionLibrary(
  motionGroups: Record<string, number> | null | undefined,
  motionDetails?: Record<string, { label?: string; durationMs?: number; loop?: boolean }> | null,
): NativeMotionOption[] {
  const options: NativeMotionOption[] = []
  for (const [group, count] of Object.entries(motionGroups ?? {})) {
    if (!Number.isInteger(count) || count <= 0) continue
    for (let index = 0; index < count; index += 1) {
      const key = `${group}#${index}`
      const detail = motionDetails?.[key] ?? motionDetails?.[group]
      const name = detail?.label?.trim() || group.trim() || '未命名动作'
      const label = name === group && count > 1 ? `${name} · ${index + 1}/${count}` :
        !detail?.label?.trim() && !group.trim() ? `${name} · ${index + 1}/${count}` : name
      options.push({
        group,
        index,
        name,
        label,
        ...(detail?.durationMs !== undefined ? { durationMs: detail.durationMs } : {}),
        ...(detail?.loop !== undefined ? { loop: detail.loop } : {}),
      })
    }
  }
  return options
}
