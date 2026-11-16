/**
 * 读取 VTube Studio 模型的 sidecar 配置，生成 Uta 自己的注册项/适配草稿。
 * 只解析模型作者和 VTS 存下来的数据，不依赖 VTS 代码。
 */

export interface VtsHotkey {
  Name?: string
  Action?: string
  File?: string
}

export interface VtsParameterSetting {
  Input?: string
  OutputLive2D?: string
  OutputRangeLower?: number
  OutputRangeUpper?: number
  InputRangeLower?: number
  InputRangeUpper?: number
  Smoothing?: number
}

export interface VtsParameterMapping {
  input: string
  output: string
  min: number
  max: number
  smoothing?: number
}

export interface VtsConfig {
  Hotkeys?: VtsHotkey[]
  ParameterSettings?: VtsParameterSetting[]
}

export interface VtsFocusMapping {
  headXParam?: string
  headYParam?: string
  headZParam?: string
  headScale?: number
  eyeXParam?: string
  eyeYParam?: string
  eyeScale?: number
  invertEyeX?: boolean
  invertEyeY?: boolean
  bodyXParam?: string
  bodyYParam?: string
  bodyZParam?: string
  bodyScale?: number
}

export interface VtsSidecarPlan {
  expressions: Array<{ Name: string; File: string }>
  motions: Record<string, Array<{ File: string; FadeInTime: number; FadeOutTime: number }>>
  focus?: VtsFocusMapping
  vtsMappings?: VtsParameterMapping[]
  idleMotions: string[]
  lipSync?: { mouthOpenParam: string; gain: number }
  baseParameters?: Record<string, number>
  emotions?: Record<string, any>
  animations?: Record<string, any>
  controls?: Record<string, any>
}

export const DAFISH_VTS_TEMPLATE = {
  baseParameters: {
    Divider1: 0,
    Divider3: 0,
    Paramshuiyin7: 0,
    Paramshuiyin8: 0,
    Param55: 0,
    Param56: 0,
    Param57: 0,
    Param58: 0,
  },
  emotions: {
    happy: { parameters: { key4: 1, ParamMouthForm: 0.8, ParamMouthOpenY: 0.2, ParamEyeLOpen: 1, ParamEyeROpen: 1 } },
    sad: { parameters: { key2: 1, ParamMouthForm: -0.6, ParamEyeLOpen: 0.65, ParamEyeROpen: 0.65 } },
    angry: { parameters: { key1: 1, ParamMouthForm: -0.7, ParamEyeLOpen: 0.9, ParamEyeROpen: 0.9 } },
    surprise: { parameters: { ParamEyeLOpen: 1.5, ParamEyeROpen: 1.5, ParamMouthOpenY: 0.9 } },
    embarrassed: { parameters: { key7: 1, key13: 1, ParamMouthForm: -0.2 } },
    thinking: { parameters: { key6: 1, ParamMouthForm: 0.15 } },
    shy: { parameters: { key7: 1, ParamEyeLOpen: 0.8, ParamEyeROpen: 0.8, ParamMouthForm: 0.4 } },
    curious: { parameters: { ParamEyeLOpen: 1.1, ParamEyeROpen: 1.1, ParamMouthOpenY: 0.2 } },
    confused: { parameters: { key3: 1, ParamMouthForm: -0.2 } },
  },
  animations: {
    wave: { motion: { group: '竖手指打开', index: 0 } },
    nod: { motion: { group: '抚胸手打开', index: 0 } },
    cheer: { motion: { group: '脱捕', index: 0 } },
  },
  controls: {
    黑脸: { label: '黑脸', category: 'face_effect', parameters: { key1: 1 } },
    落泪: { label: '落泪', category: 'face_effect', parameters: { key2: 1 } },
    圈圈眼: { label: '圈圈眼', category: 'face_effect', parameters: { key3: 1 } },
    爱心眼: { label: '爱心眼', category: 'face_effect', parameters: { key4: 1 } },
    '><眼': { label: '><眼', category: 'face_effect', parameters: { key5: 1 } },
    屑屑眼: { label: '屑屑眼', category: 'face_effect', parameters: { key6: 1 } },
    脸红: { label: '脸红', category: 'face_effect', parameters: { key7: 1 } },
    加载: { label: '加载', category: 'toggle', parameters: { key8: 1 } },
    大牙: { label: '大牙', category: 'face_effect', parameters: { key9: 1 } },
    大钢盆: { label: '大钢盆', category: 'pose_prop', parameters: { key10: 1 } },
    黑框眼镜: { label: '黑框眼镜', category: 'pose_prop', parameters: { key11: 1 } },
    单片眼镜: { label: '单片眼镜', category: 'pose_prop', parameters: { key12: 1 } },
    流冷汗: { label: '流冷汗', category: 'face_effect', parameters: { key13: 1 } },
    狗尾草: {
      label: '狗尾草',
      category: 'pose_prop',
      parameters: { Movement1: 1, Movement3: 0, Param56: 1, Param57: 0, Param36: 0.04, Param39: 0.2, Param41: -0.732, Param42: 0, Param43: 0 },
    },
    抚胸: {
      label: '抚胸',
      category: 'pose_prop',
      parameters: { Movement2: 1, Param56: 1, Param57: 0, Param62: 0.034, Param59: 0.476, Param60: 0.86, Param61: 0.002 },
    },
    竖食指: {
      label: '竖食指',
      category: 'pose_prop',
      parameters: { Movement1: 0, Movement3: 1, Param56: 1, Param57: 0, Param40: 1, Param36: 0, Param39: 0.322, Param41: 0.702, Param42: 0, Param43: 0 },
    },
    长短裙: {
      label: '长短裙切换',
      category: 'outfit',
      stages: [
        { label: '长裙', parameters: { Clothes1: 1 } },
        { label: '短裙', parameters: { Clothes1: 0 } },
      ],
      defaultStageIndex: 0,
    },
    大小变: {
      label: '大小变',
      category: 'toggle',
      stages: [
        { label: '大', parameters: { Clothes2: 0 } },
        { label: '中', parameters: { Clothes2: 0.4 } },
        { label: '小', parameters: { Clothes2: 1 } },
      ],
      defaultStageIndex: 0,
    },
    胸口衣服: { label: '胸口衣服', category: 'outfit', parameters: { Clothes3: 1 } },
    鞋子: { label: '鞋子', category: 'outfit', parameters: { Clothes4: 1 } },
    尾巴: {
      label: '尾巴',
      category: 'outfit',
      stages: [
        { label: '开', parameters: { Clothes5: 1 } },
        { label: '关', parameters: { Clothes5: 0 } },
      ],
      defaultStageIndex: 0,
    },
  },
}

function isDafishModelSidecars(sidecars: string[], hotkeys: VtsHotkey[]): boolean {
  if (sidecars.some(s => /大肥鱼|dafish|deepseek/i.test(s))) return true
  const dafishHotkeys = new Set(['体型1', '体型2', '裙长切换', '狗尾巴草打开', '抚胸手打开', '竖手指打开', '脱鞋', '钢盆', '兔牙'])
  let count = 0
  for (const h of hotkeys) {
    if (h.Name && dafishHotkeys.has(h.Name)) count++
  }
  return count >= 2
}

const basename = (file: string) => file.split('/').pop() ?? file

function stem(file: string, suffix: RegExp): string {
  return basename(file).replace(suffix, '')
}

function uniqueName(name: string, used: Set<string>): string {
  let candidate = name.trim() || '未命名'
  let index = 2
  while (used.has(candidate.toLowerCase())) candidate = `${name} (${index++})`
  used.add(candidate.toLowerCase())
  return candidate
}

function scaleOf(setting: VtsParameterSetting, fallback: number): number {
  const lower = Math.abs(Number(setting.OutputRangeLower))
  const upper = Math.abs(Number(setting.OutputRangeUpper))
  const scale = Math.max(Number.isFinite(lower) ? lower : 0, Number.isFinite(upper) ? upper : 0)
  return scale > 0 ? scale : fallback
}

function inverted(setting: VtsParameterSetting): boolean {
  return Number(setting.OutputRangeLower) > Number(setting.OutputRangeUpper)
}

function findSetting(
  settings: VtsParameterSetting[],
  input: string,
  output: RegExp,
): VtsParameterSetting | undefined {
  return settings.find((setting) =>
    setting.Input === input &&
    typeof setting.OutputLive2D === 'string' &&
    output.test(setting.OutputLive2D)
  )
}

function buildFocus(settings: VtsParameterSetting[]): VtsFocusMapping | undefined {
  const headX = findSetting(settings, 'FaceAngleX', /^(ParamAngleX|AngleX)$/i)
  const headY = findSetting(settings, 'FaceAngleY', /^(ParamAngleY|AngleY)$/i)
  const headZ = findSetting(settings, 'FaceAngleZ', /^(ParamAngleZ|AngleZ)$/i)
  const eyeX = findSetting(settings, 'EyeRightX', /^(ParamEyeBallX|EyeBallX)$/i)
  const eyeY = findSetting(settings, 'EyeRightY', /^(ParamEyeBallY|EyeBallY)$/i)
  const bodyX = findSetting(settings, 'FaceAngleX', /^(ParamBodyAngleX|PositionX|ParamBodyX)$/i)
  const bodyY = findSetting(settings, 'FaceAngleY', /^(ParamBodyAngleY|PositionY|ParamBodyY)$/i)
  const bodyZ = findSetting(settings, 'FaceAngleZ', /^(ParamBodyAngleZ|PositionZ|ParamBodyZ)$/i)
  const mapping: VtsFocusMapping = {}
  if (headX) { mapping.headXParam = headX.OutputLive2D; mapping.headScale = scaleOf(headX, 30) }
  if (headY) mapping.headYParam = headY.OutputLive2D
  if (headZ) mapping.headZParam = headZ.OutputLive2D
  if (eyeX) { mapping.eyeXParam = eyeX.OutputLive2D; mapping.eyeScale = 1; mapping.invertEyeX = inverted(eyeX) }
  if (eyeY) { mapping.eyeYParam = eyeY.OutputLive2D; mapping.eyeScale = 1; mapping.invertEyeY = inverted(eyeY) }
  if (bodyX) { mapping.bodyXParam = bodyX.OutputLive2D; mapping.bodyScale = scaleOf(bodyX, 30) }
  if (bodyY) mapping.bodyYParam = bodyY.OutputLive2D
  if (bodyZ) mapping.bodyZParam = bodyZ.OutputLive2D
  return Object.keys(mapping).length > 0 ? mapping : undefined
}

/**
 * sidecars 是相对模型目录的路径；vtsConfig 为同名 .vtube.json 的解析结果。
 * 返回可合并到 model3.json/deskpet-adapter.json 的注册项。
 */
export function planVtsImport(input: {
  sidecars: string[]
  vtsConfig?: VtsConfig | null
  existingExpressionFiles?: Iterable<string>
  existingExpressionNames?: Iterable<string>
  existingMotionGroups?: Iterable<string>
  existingMotionFiles?: Iterable<string>
}): VtsSidecarPlan {
  const settings = Array.isArray(input.vtsConfig?.ParameterSettings) ? input.vtsConfig!.ParameterSettings! : []
  const hotkeys = Array.isArray(input.vtsConfig?.Hotkeys) ? input.vtsConfig!.Hotkeys! : []
  const hotkeyByFile = new Map<string, VtsHotkey>()
  for (const hotkey of hotkeys) {
    if (typeof hotkey.File !== 'string' || !hotkey.File) continue
    hotkeyByFile.set(basename(hotkey.File).toLowerCase(), hotkey)
  }

  const usedExpressionFiles = new Set([...(input.existingExpressionFiles ?? [])].map(file => file.toLowerCase()))
  const usedExpressionNames = new Set([...(input.existingExpressionNames ?? [])].map(name => name.toLowerCase()))
  const usedMotionGroups = new Set([...(input.existingMotionGroups ?? [])].map(name => name.toLowerCase()))
  const usedMotionFiles = new Set([...(input.existingMotionFiles ?? [])].map(file => file.toLowerCase()))
  const expressions: VtsSidecarPlan['expressions'] = []
  const motions: VtsSidecarPlan['motions'] = {}

  for (const file of input.sidecars) {
    const lower = file.toLowerCase()
    if (lower.endsWith('.exp3.json')) {
      if (usedExpressionFiles.has(lower)) continue
      const hotkey = hotkeyByFile.get(basename(file).toLowerCase())
      const baseName = hotkey?.Action === 'ToggleExpression' && hotkey.Name
        ? hotkey.Name
        : stem(file, /\.exp3\.json$/i)
      expressions.push({ Name: uniqueName(baseName, usedExpressionNames), File: file })
      usedExpressionFiles.add(lower)
      continue
    }
    if (lower.endsWith('.motion3.json')) {
      if (usedMotionFiles.has(lower)) continue
      const hotkey = hotkeyByFile.get(basename(file).toLowerCase())
      const baseName = hotkey?.Action === 'TriggerAnimation' && hotkey.Name
        ? hotkey.Name
        : stem(file, /\.motion3\.json$/i)
      const group = uniqueName(baseName, usedMotionGroups)
      motions[group] = [{ File: file, FadeInTime: 0.2, FadeOutTime: 0.2 }]
      usedMotionFiles.add(lower)
    }
  }

  const focus = buildFocus(settings)
  const mouthOpen = findSetting(settings, 'MouthOpen', /^(ParamMouthOpenY|MouthOpenY|ParamMouthOpen)$/i)
  const idleMotions = Object.keys(motions).filter(group => /idle/i.test(group))
  const isDafish = isDafishModelSidecars(input.sidecars, hotkeys)
  let baseParameters: Record<string, number> | undefined
  let emotions: Record<string, any> | undefined
  let animations: Record<string, any> | undefined
  let controls: Record<string, any> | undefined

  if (isDafish) {
    baseParameters = { ...DAFISH_VTS_TEMPLATE.baseParameters }
    emotions = { ...DAFISH_VTS_TEMPLATE.emotions }
    animations = { ...DAFISH_VTS_TEMPLATE.animations }
    controls = { ...DAFISH_VTS_TEMPLATE.controls }
  } else if (hotkeys.length > 0) {
    controls = {}
    for (const h of hotkeys) {
      if (h.Action === 'ToggleExpression' && h.Name) {
        const cat = /镜/i.test(h.Name) ? 'outfit'
          : /脸|眼|泪|哭|笑|屑|冷汗|牙|晕|怒/i.test(h.Name) ? 'face_effect'
          : /衣|裙|裤|鞋|袜|帽|尾巴/i.test(h.Name) ? 'outfit'
          : /盆|草|手|枪|伞|扇|刀|剑/i.test(h.Name) ? 'pose_prop'
          : 'toggle'
        controls[h.Name] = {
          label: h.Name,
          category: cat,
          parameters: {},
        }
      }
    }
  }

  const vtsMappings: VtsParameterMapping[] = []
  for (const s of settings) {
    if (typeof s.Input === 'string' && typeof s.OutputLive2D === 'string' && s.Input && s.OutputLive2D) {
      const lower = typeof s.OutputRangeLower === 'number' ? s.OutputRangeLower : undefined
      const upper = typeof s.OutputRangeUpper === 'number' ? s.OutputRangeUpper : undefined
      vtsMappings.push({
        input: s.Input,
        output: s.OutputLive2D,
        min: typeof lower === 'number' && Number.isFinite(lower) ? lower : 0,
        max: typeof upper === 'number' && Number.isFinite(upper) ? upper : 1,
        ...(typeof s.Smoothing === 'number' && Number.isFinite(s.Smoothing) ? { smoothing: s.Smoothing } : {}),
      })
    }
  }

  return {
    expressions,
    motions,
    ...(focus ? { focus } : {}),
    ...(vtsMappings.length > 0 ? { vtsMappings } : {}),
    idleMotions,
    ...(mouthOpen?.OutputLive2D ? { lipSync: { mouthOpenParam: mouthOpen.OutputLive2D, gain: 1 } } : {}),
    ...(baseParameters ? { baseParameters } : {}),
    ...(emotions ? { emotions } : {}),
    ...(animations ? { animations } : {}),
    ...(controls && Object.keys(controls).length > 0 ? { controls } : {}),
  }
}
