/** 内置情绪词表；模型（adapter / 立绘包清单）还可以声明任意自定义情绪键 */
export const DESKPET_EMOTIONS = [
  'happy',
  'sad',
  'angry',
  'surprise',
  'embarrassed',
  'thinking',
  'shy',
  'curious',
  'confused',
  'neutral',
  'idle'
] as const

export type DeskpetEmotion = typeof DESKPET_EMOTIONS[number]

import type { ModelCapabilities, ModelDiskAssetsInfo } from './loader'
import { alignDefaultPresetSlots, buildDafishNaturalPresets, buildDsNaturalPresets, isDafishModel, isDsMouseModel } from './natural-presets'
import { buildGenericStatePresets } from './generic-state-presets'
import { DAFISH_BODY_LED_HAPPY_MOTION } from './dafish-body-led-happy'
import { findBuiltinAdapter } from './builtin-adapters'
import { normalizeFocusMapping, type FocusMapping } from './focus-mapping'
import { controlOperationKey, expressionControlParameters, expressionResourceIndex, isAttributionLabel, resourceHotkey, resourceLabel, uniqueResourceId } from './resource-metadata'
import { isNativeMotionBinding } from '../../../shared/native-motion'

export interface EmotionMotionTarget {
  group: string
  index?: number
}

export interface EmotionTarget {
  expression?: string
  motion?: EmotionMotionTarget
  parameters?: Record<string, number>
}

export interface AnimationTarget {
  motion: EmotionMotionTarget
}

export interface ModelControlStage {
  label: string
  parameters: Record<string, number>
}

export interface ModelControlTarget {
  /** 控件显示名称，不填则用键名 */
  label?: string
  /** 控件分类（outfit / hair / pose_prop / face_effect / toggle） */
  category?: string
  /** 是否默认开启 */
  defaultActive?: boolean
  /** 关联的 .exp3.json 名称（即使未在 model3.json 注册也可自动解析为参数） */
  expression?: string
  /** 激活该控件时写入的参数映射 */
  parameters?: Record<string, number>
  /** 多阶段状态（如大小变的大/中/小）；声明 stages 时优先按 stages 循环切换 */
  stages?: ModelControlStage[]
  /** 默认阶段索引（缺省为 0） */
  defaultStageIndex?: number
  /** 激活该控件时隐藏的部件 ID 列表 */
  hiddenParts?: string[]
  /** 激活该控件时强制显示的部件 ID 列表（如 pose3.json 中的 PartArmB） */
  shownParts?: string[]
}

export interface ResolvedModelControl {
  id: string
  label: string
  category: string
  parameters: Record<string, number>
  stages?: ModelControlStage[]
  currentStageIndex?: number
  defaultStageIndex?: number
  hiddenParts: string[]
  shownParts?: string[]
  defaultActive: boolean
  active: boolean
  /** User-pinned part/control: survives preset actions and idle cleanup. */
  held?: boolean
  source: 'adapter' | 'auto'
}

export interface LipSyncConfig {
  /** 张嘴幅度参数 ID，不同模型可能不叫 ParamMouthOpenY */
  mouthOpenParam: string
  /** 幅度缩放，1 = 原样，0.6 = 收一点 */
  gain: number
}

export const DEFAULT_LIP_SYNC: LipSyncConfig = {
  mouthOpenParam: 'ParamMouthOpenY',
  gain: 1,
}

export interface ModelEmotionAdapter {
  version: 1
  modelId?: string
  name?: string
  /** 待机动作组，留空则退回按组名猜（idle/neutral/...） */
  idleMotions: string[]
  lipSync: LipSyncConfig
  /** 底层常驻参数（如去除作者水印、修正默认姿态），不受情绪切换或控件重置影响 */
  baseParameters: Record<string, number>
  /** 底层常驻隐藏的部件 ID 列表 */
  hiddenParts: string[]
  /** 底层常驻隐藏的 drawable ID 列表（如只作蒙版源、不应显示的网格） */
  hiddenDrawables: string[]
  /** 鼠标视线跟随要写入的模型参数；缺省时使用标准 Live2D 参数 */
  focus?: FocusMapping
  generatedFocus?: true
  /** 情绪键 → 表现目标；键不限于内置词表，模型可声明任意自定义情绪 */
  emotions: Record<string, EmotionTarget>
  animations: Record<string, AnimationTarget>
  /** 显式声明的模型控件开关（服饰/发型/道具/特效） */
  controls: Record<string, ModelControlTarget>
  /** 是否真的读到了 adapter（本地文件或内置目录）；没有适配文件的模型不需要校验 */
  loaded: boolean
  /** 适配来源：本地覆盖优先，其次是按模型签名匹配的内置目录 */
  adapterSource?: 'local' | 'builtin' | 'none'
}

function createEmptyAdapter(): ModelEmotionAdapter {
  return {
    version: 1,
    modelId: 'empty',
    idleMotions: [],
    lipSync: { ...DEFAULT_LIP_SYNC },
    baseParameters: {},
    hiddenParts: [],
    hiddenDrawables: [],
    emotions: {},
    animations: {},
    controls: {},
    loaded: false,
    adapterSource: 'none',
  }
}

function getAdapterUrl(modelUrl: string): string {
  const url = new URL(modelUrl, window.location.href)
  return new URL('deskpet-adapter.json', url).toString()
}

function isDeskpetEmotion(value: string): value is DeskpetEmotion {
  return (DESKPET_EMOTIONS as readonly string[]).includes(value)
}

export function isDeskpetEmotionValue(value: unknown): value is DeskpetEmotion {
  return typeof value === 'string' && isDeskpetEmotion(value)
}

function normalizeParametersMap(raw: unknown): Record<string, number> {
  const parameters: Record<string, number> = {}
  if (!raw || typeof raw !== 'object') return parameters
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id === 'string' && id && typeof value === 'number' && Number.isFinite(value)) {
      parameters[id] = value
    }
  }
  return parameters
}

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((s) => s.trim())
}

function normalizeTarget(target: unknown): EmotionTarget | null {
  if (!target || typeof target !== 'object') return null

  const entry = target as any
  const normalized: EmotionTarget = {}

  if (typeof entry.expression === 'string' && entry.expression) {
    normalized.expression = entry.expression
  }

  if (entry.motion && typeof entry.motion === 'object' && typeof entry.motion.group === 'string') {
    normalized.motion = {
      group: entry.motion.group,
      index: typeof entry.motion.index === 'number' ? entry.motion.index : 0
    }
  }

  const parameters = normalizeParametersMap(entry.parameters)
  if (Object.keys(parameters).length > 0) {
    normalized.parameters = parameters
  }

  return normalized.expression || normalized.motion || normalized.parameters ? normalized : null
}

function normalizeAnimationTarget(target: unknown): AnimationTarget | null {
  if (!target || typeof target !== 'object') return null

  const entry = target as any
  if (!entry.motion || typeof entry.motion !== 'object' || typeof entry.motion.group !== 'string') return null

  return {
    motion: {
      group: entry.motion.group,
      index: typeof entry.motion.index === 'number' ? entry.motion.index : 0
    }
  }
}

function normalizeControlTarget(target: unknown): ModelControlTarget | null {
  if (!target || typeof target !== 'object') return null
  const entry = target as any
  const normalized: ModelControlTarget = {}

  if (typeof entry.label === 'string' && entry.label.trim()) {
    normalized.label = entry.label.trim()
  }
  if (typeof entry.category === 'string' && entry.category.trim()) {
    normalized.category = entry.category.trim()
  }
  if (typeof entry.defaultActive === 'boolean') {
    normalized.defaultActive = entry.defaultActive
  }
  if (typeof entry.expression === 'string' && entry.expression.trim()) {
    normalized.expression = entry.expression.trim()
  }
  const parameters = normalizeParametersMap(entry.parameters)
  if (Object.keys(parameters).length > 0) {
    normalized.parameters = parameters
  }
  const hiddenParts = normalizeStringList(entry.hiddenParts)
  if (hiddenParts.length > 0) {
    normalized.hiddenParts = hiddenParts
  }
  const shownParts = normalizeStringList(entry.shownParts)
  if (shownParts.length > 0) {
    normalized.shownParts = shownParts
  }
  if (Array.isArray(entry.stages) && entry.stages.length > 0) {
    const validStages = entry.stages
      .filter((s: unknown) => s && typeof s === 'object' && typeof (s as any).label === 'string')
      .map((s: any) => ({
        label: String(s.label).trim(),
        parameters: normalizeParametersMap(s.parameters),
      }))
    if (validStages.length > 0) {
      normalized.stages = validStages
      if (Number.isInteger(entry.defaultStageIndex) && entry.defaultStageIndex >= 0 && entry.defaultStageIndex < validStages.length) {
        normalized.defaultStageIndex = entry.defaultStageIndex
      }
    }
  }

  return normalized.expression || normalized.parameters || normalized.hiddenParts || normalized.shownParts || normalized.stages
    ? normalized
    : null
}

function normalizeLipSync(raw: unknown): LipSyncConfig {
  const entry = raw as any
  if (!entry || typeof entry !== 'object') return { ...DEFAULT_LIP_SYNC }
  const gain = typeof entry.gain === 'number' && entry.gain > 0 ? entry.gain : DEFAULT_LIP_SYNC.gain
  return {
    mouthOpenParam: typeof entry.mouthOpenParam === 'string' && entry.mouthOpenParam
      ? entry.mouthOpenParam
      : DEFAULT_LIP_SYNC.mouthOpenParam,
    gain: Math.min(4, gain),
  }
}

function normalizeIdleMotions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((group): group is string => typeof group === 'string' && group.length > 0)
}

function normalizeAdapter(raw: any, adapterSource: 'local' | 'builtin' = 'local'): ModelEmotionAdapter {
  const emotions: Record<string, EmotionTarget> = {}
  const animations: Record<string, AnimationTarget> = {}
  const controls: Record<string, ModelControlTarget> = {}

  if (raw?.emotions && typeof raw.emotions === 'object') {
    for (const [emotion, target] of Object.entries(raw.emotions)) {
      // 不再限内置词表：自定义情绪键原样保留（模型自定义情绪的入口）
      if (!emotion) continue

      const normalized = normalizeTarget(target)
      if (normalized) emotions[emotion] = normalized
    }
  }

  if (raw?.animations && typeof raw.animations === 'object') {
    for (const [animation, target] of Object.entries(raw.animations)) {
      if (!animation) continue

      const normalized = normalizeAnimationTarget(target)
      if (normalized) animations[animation] = normalized
    }
  }

  if (raw?.controls && typeof raw.controls === 'object') {
    for (const [controlId, target] of Object.entries(raw.controls)) {
      if (!controlId) continue
      const normalized = normalizeControlTarget(target)
      if (normalized) controls[controlId] = normalized
    }
  }

  const focus = normalizeFocusMapping(raw?.focus)
  return {
    version: 1,
    modelId: typeof raw?.modelId === 'string' ? raw.modelId : undefined,
    name: typeof raw?.name === 'string' ? raw.name : undefined,
    idleMotions: normalizeIdleMotions(raw?.idleMotions),
    lipSync: normalizeLipSync(raw?.lipSync),
    baseParameters: normalizeParametersMap(raw?.baseParameters),
    hiddenParts: normalizeStringList(raw?.hiddenParts),
    hiddenDrawables: normalizeStringList(raw?.hiddenDrawables),
    ...(focus ? { focus } : {}),
    emotions,
    animations,
    controls,
    loaded: true,
    adapterSource
  }
}

export async function loadEmotionAdapter(
  modelUrl: string,
  modelSignature?: string | null,
  modelNameHint?: string | null,
): Promise<ModelEmotionAdapter> {
  const adapterUrl = getAdapterUrl(modelUrl)
  let localRaw: unknown = null

  try {
    const resp = await fetch(adapterUrl, { cache: 'no-cache' })
    if (resp.ok) {
      // dev server 对不存在的文件会回 index.html（状态码 200），
      // 直接 json() 会抛 SyntaxError，看起来像“适配器坏了”，其实是“没有适配器”
      const text = await resp.text()
      if (text.trimStart().startsWith('{')) {
        localRaw = JSON.parse(text)
      } else {
        console.info(`[Deskpet] No local emotion adapter for this model: ${adapterUrl}`)
      }
    } else {
      console.info(`[Deskpet] No emotion adapter found: ${adapterUrl}`)
    }
  } catch (err) {
    console.warn('[Deskpet] Failed to load local emotion adapter:', err)
  }

  const inferredHint =
    modelNameHint ||
    decodeURIComponent(modelUrl.split(/[/\\]/).filter(Boolean).slice(-2, -1)[0] || '')
  const builtin = findBuiltinAdapter(modelSignature, inferredHint)

  if (localRaw && typeof localRaw === 'object') {
    const local = localRaw as any
    const localEmotions = local.emotions && typeof local.emotions === 'object' ? Object.keys(local.emotions) : []
    const localControls = local.controls && typeof local.controls === 'object' ? Object.keys(local.controls) : []

    // 如果本地 adapter 是刚导入生成的空草稿（或未配置表情/控件），且有匹配的内置适配模板，则智能继承内置模板
    let effective = local
    if (builtin && (localEmotions.length === 0 || localControls.length === 0)) {
      const bAdapter = builtin.adapter as any
      effective = {
        ...bAdapter,
        ...local,
        ...(bAdapter.focus && local.focus ? { focus: { ...bAdapter.focus, ...local.focus } } : {}),
        emotions: localEmotions.length > 0 ? local.emotions : { ...bAdapter.emotions, ...(local.emotions ?? {}) },
        controls: localControls.length > 0 ? local.controls : { ...bAdapter.controls, ...(local.controls ?? {}) },
        hiddenDrawables: [
          ...new Set([
            ...(Array.isArray(bAdapter.hiddenDrawables) ? bAdapter.hiddenDrawables : []),
            ...(Array.isArray(local.hiddenDrawables) ? local.hiddenDrawables : []),
          ]),
        ],
        baseParameters: {
          ...(bAdapter.baseParameters ?? {}),
          ...(local.baseParameters ?? {}),
        },
      }
      console.info(`[Deskpet] Merged builtin adapter into local draft: ${builtin.name}`)
    }

    // Generated VTS bindings are a fallback. A user-authored focus field takes priority.
    let generatedFocus = false
    if (Object.hasOwn(local, 'generatedFocus') && !Object.hasOwn(local, 'focus')) {
      const exactBuiltin = builtin && builtin.signature === modelSignature ? builtin.adapter as { focus?: unknown } : null
      effective = { ...effective, focus: exactBuiltin?.focus ?? local.generatedFocus ?? effective.focus }
      generatedFocus = exactBuiltin?.focus == null && local.generatedFocus != null
    }

    const adapter = normalizeAdapter(effective, 'local')
    if (generatedFocus && adapter.focus) adapter.generatedFocus = true
    const isDafish =
      adapter.name === '大肥鱼' ||
      builtin?.name === '大肥鱼' ||
      inferredHint.includes('072c7e1cdc') ||
      inferredHint.includes('大肥鱼')
    if (isDafish && adapter.hiddenDrawables.length > 0) {
      // 历史自愈：清理此前由于旧着色器缺失而针对大肥鱼鼻子添加的临时隐藏网格，恢复原作者设计的鼻头立体高光
      adapter.hiddenDrawables = adapter.hiddenDrawables.filter(
        (id) => id !== 'ArtMesh246' && id !== 'ArtMesh682',
      )
    }
    const emotionKeys = Object.keys(adapter.emotions)
    const animationKeys = Object.keys(adapter.animations)
    console.info(`[Deskpet] Local emotion adapter loaded: ${adapter.name || adapter.modelId || adapterUrl}`)
    console.info(`[Deskpet] Adapter emotions: ${emotionKeys.length ? emotionKeys.join(', ') : '(none)'}`)
    console.info(`[Deskpet] Adapter animations: ${animationKeys.length ? animationKeys.join(', ') : '(none)'}`)
    return adapter
  }

  if (builtin) {
    const adapter = normalizeAdapter(builtin.adapter, 'builtin')
    const emotionKeys = Object.keys(adapter.emotions)
    const animationKeys = Object.keys(adapter.animations)
    console.info(`[Deskpet] Built-in emotion adapter loaded: ${builtin.name} (${builtin.modelId ?? builtin.signature})`)
    console.info(`[Deskpet] Adapter emotions: ${emotionKeys.length ? emotionKeys.join(', ') : '(none)'}`)
    console.info(`[Deskpet] Adapter animations: ${animationKeys.length ? animationKeys.join(', ') : '(none)'}`)
    return adapter
  }
  if (modelSignature) {
    console.info(`[Deskpet] No built-in emotion adapter for signature: ${modelSignature}`)
  }
  return createEmptyAdapter()
}

export function getEmotionTarget(
  adapter: ModelEmotionAdapter | null,
  emotion: string
): EmotionTarget | null {
  if (!adapter || !emotion) return null
  return adapter.emotions[emotion] || null
}

export function getAnimationTarget(
  adapter: ModelEmotionAdapter | null,
  animation: string,
  caps?: ModelCapabilities | null,
): AnimationTarget | null {
  if (!animation) return null
  // 1. Adapter 显式声明的动作映射优先
  if (adapter?.animations?.[animation]) {
    return adapter.animations[animation]
  }

  // 2. 匹配原生动作组（如 "脱捕"、"狗尾巴草打开"）
  const motionGroups = caps?.motionGroups ?? {}
  if (motionGroups[animation] && motionGroups[animation] > 0) {
    return { motion: { group: animation, index: 0 } }
  }

  // 3. 支持 "动作组#索引" 语法（如 "Tap#1"、"脱捕#0"）
  const hashIdx = animation.indexOf('#')
  if (hashIdx > 0) {
    const group = animation.slice(0, hashIdx)
    const idx = parseInt(animation.slice(hashIdx + 1), 10)
    let matchedGroup: string | null = motionGroups[group] ? group : null
    if (!matchedGroup) {
      const groupLower = group.toLowerCase()
      for (const g of Object.keys(motionGroups)) {
        if (g.toLowerCase() === groupLower) {
          matchedGroup = g
          break
        }
      }
    }
    if (matchedGroup && Number.isFinite(idx) && idx >= 0 && idx < motionGroups[matchedGroup]) {
      return { motion: { group: matchedGroup, index: idx } }
    }
  }

  // 4. 不区分大小写的备用匹配
  const lower = animation.toLowerCase()
  if (adapter?.animations) {
    for (const [k, v] of Object.entries(adapter.animations)) {
      if (k.toLowerCase() === lower) return v
    }
  }
  for (const [g, count] of Object.entries(motionGroups)) {
    if (g.toLowerCase() === lower && count > 0) {
      return { motion: { group: g, index: 0 } }
    }
  }

  return null
}

// ── 自动发现水印与模型控件（结合 .exp3.json / .cdi3.json / .physics3.json / .vtube.json） ──

const NOISE_NAME_RE =
  /角度|旋转|呼吸|眼珠|眼球|眨眼|开闭|開閉|微笑|张开|闭合|変形|变形|摇动|物理|\[物\]|唯一发布渠道|哔哩哔哩|账号|立绘[:：]|建模[:：]|^参数\d+$|^Param|Position|Rotation|Shoulder|Step|Hand|Mouth|Jaw|Cheek|舌|目玉|体の回転|照れ|右耳|左耳/i

const WATERMARK_RE = /水印|watermark|shuiyin/i
const SHOW_WATERMARK_RE = /显示水印|打开水印|开启水印|show\s*watermark/i

function matchControlCategory(text: string): string | null {
  // “蛋包饭”里的“包”不是服装包；这类餐桌/点菜道具先归入手部/道具，
  // 否则会被当成常驻服装，回待机时不会自动收掉。
  if (/蛋包饭|点菜|便当|餐桌|饭桌/i.test(text)) return 'pose_prop'
  if (/衣|服|外套|裙|袖|领|帽|鞋|袜|眼镜|耳机|发卡|饰|包|蝴蝶结|uniform|dress|coat|hat|glasses|shirt|skirt|hoodie|tie/i.test(text)) {
    return 'outfit'
  }
  if (/发|马尾|刘海|辫|呆毛|hair|ponytail|bangs|twintail/i.test(text)) {
    return 'hair'
  }
  if (/手|姿|抱|持|拿|捧|挥|麦克风|手柄|棒|刀|剑|斧|剪刀|锤|荧光棒|pose|hand|arm|hold|mic|staff|bat|hammer|scissors|axe|gamepad/i.test(text)) {
    return 'pose_prop'
  }
  if (/眼|瞳|泪|黑化|脸黑|红晕|脸红|汗|嘴|舌|眉|牙|恶魔|翅膀|角|尾|eye|tear|blush|dark|yandere|mouth|brow|wing|horn|tail/i.test(text)) {
    return 'face_effect'
  }
  return null
}

/**
 * 控件分类优先看控件 ID，再看 label。
 * label 会拼上参数名（如 Open Arms 带上 School Uniform），先看 label 会把姿势误判成常驻服装。
 */
export function inferControlCategory(id: string, label: string): string {
  return matchControlCategory(id) ?? matchControlCategory(label) ?? 'toggle'
}

export interface ResolvedModelState {
  baseParameters: Record<string, number>
  hiddenParts: string[]
  controls: ResolvedModelControl[]
}

/**
 * 结合 adapter 显式声明与模型磁盘资产（.exp3.json / .cdi3.json / .physics3.json / .vtube.json），
 * 完成三件事：
 *   1. 自动识别去除作者水印的参数与图层，合并进 baseParameters / hiddenParts（常驻底层，永不因情绪切换而恢复）
 *   2. 对 adapter.emotions 中引用了未注册进 .model3.json 的 .exp3.json 表情，自动内联其参数
 *   3. 解析显式声明 + 自动发现的模型控件（服饰、发型、道具、姿势、脸部开关）
 */
export function resolveModelControlsAndBase(
  adapter: ModelEmotionAdapter,
  caps: ModelCapabilities,
  diskAssets?: ModelDiskAssetsInfo | null,
): ResolvedModelState {
  const paramById = new Map(caps.parameters.map((p) => [p.id, p]))
  const registeredExps = new Set(caps.expressions)
  const cdiParams = diskAssets?.cdiParameters ?? {}
  const cdiParts = diskAssets?.cdiParts ?? {}
  const physicsOut = new Set(diskAssets?.physicsOutputIds ?? [])
  const vtubeHotkeys = diskAssets?.vtubeHotkeys ?? {}
  const diskExpressions = diskAssets?.expressions ?? []

  const diskExpByName = expressionResourceIndex(diskExpressions)

  const baseParameters: Record<string, number> = {}
  for (const [id, val] of Object.entries(adapter.baseParameters)) {
    if (paramById.has(id)) baseParameters[id] = val
  }

  const baseHiddenPartsSet = new Set<string>(adapter.hiddenParts)
  for (const part of caps.parts ?? []) {
    const partName = (part.name ?? cdiParts[part.id] ?? '').trim()
    // 跳过 .psd 根图层容器（避免整个模型 PSD 文件名带“水印”时误隐藏全身），只隐藏具体水印部件
    if (/\.psd$/i.test(partName)) continue
    if (WATERMARK_RE.test(part.id) || (partName && WATERMARK_RE.test(partName) && !SHOW_WATERMARK_RE.test(partName))) {
      baseHiddenPartsSet.add(part.id)
    }
  }

  const watermarkParamIds = new Set<string>()
  const coveredParams = new Set<string>(Object.keys(baseParameters))
  for (const p of caps.parameters) {
    const pname = p.name ?? cdiParams[p.id]?.name ?? ''
    if (WATERMARK_RE.test(p.id) || WATERMARK_RE.test(pname)) watermarkParamIds.add(p.id)
  }

  // 1) 扫描 .exp3.json 中的水印项
  for (const exp of diskExpressions) {
    if (!exp.parameters.length) continue
    const hk = resourceHotkey(exp.file, vtubeHotkeys)
    const resourceName = `${exp.name} ${exp.file} ${hk}`
    const isRemoval = !SHOW_WATERMARK_RE.test(resourceName)
    const targets = expressionControlParameters(exp, paramById)

    for (const p of exp.parameters) {
      const pname = cdiParams[p.id]?.name ?? ''
      if (watermarkParamIds.has(p.id) || WATERMARK_RE.test(pname) ||
        (WATERMARK_RE.test(resourceName) && exp.parameters.length === 1)) {
        watermarkParamIds.add(p.id)
        coveredParams.add(p.id)
        if (isRemoval && WATERMARK_RE.test(resourceName) && !(p.id in baseParameters) && paramById.has(p.id)) {
          if (p.id in targets) baseParameters[p.id] = targets[p.id]
        }
      }
    }
  }

  // 检查 .cdi3.json 里独立的去水印参数（无 .exp3.json 时兜底）
  for (const p of caps.parameters) {
    const pname = p.name ?? cdiParams[p.id]?.name ?? ''
    const combined = `${p.id} ${pname}`
    if (WATERMARK_RE.test(combined)) {
      watermarkParamIds.add(p.id)
      if (!SHOW_WATERMARK_RE.test(combined) && !(p.id in baseParameters) && p.default === 0 && p.max > 0) {
        baseParameters[p.id] = p.max
      }
    }
  }

  // 2) 未注册的情绪表达式内联为同一套控件目标；情绪引用不影响资源入口的发现。
  for (const target of Object.values(adapter.emotions)) {
    if (!target) continue
    if (target.expression) {
      if (!registeredExps.has(target.expression)) {
        const diskExp = diskExpByName.get(target.expression.replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase())
        if (diskExp) {
          const inlined: Record<string, number> = { ...(target.parameters ?? {}) }
          for (const [id, value] of Object.entries(expressionControlParameters(diskExp, paramById))) {
            if (watermarkParamIds.has(id)) continue
            if (!(id in inlined)) inlined[id] = value
          }
          if (Object.keys(inlined).length > 0) {
            target.parameters = inlined
          }
          delete target.expression
        }
      }
    }
  }

  // 3) 解析显式声明的 adapter.controls
  const controls: ResolvedModelControl[] = []
  const seenControlIds = new Set<string>()

  for (const [controlId, raw] of Object.entries(adapter.controls)) {
    const params: Record<string, number> = {}
    if (raw.expression) {
      const diskExp = diskExpByName.get(raw.expression.replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase())
      if (diskExp) {
        for (const [id, value] of Object.entries(expressionControlParameters(diskExp, paramById))) {
          if (!watermarkParamIds.has(id)) {
            params[id] = value
          }
        }
      }
    }
    if (raw.parameters) {
      for (const [pid, val] of Object.entries(raw.parameters)) {
        if (paramById.has(pid)) {
          params[pid] = val
        }
      }
    }
    let stages: ModelControlStage[] | undefined
    if (Array.isArray(raw.stages) && raw.stages.length > 0) {
      stages = raw.stages
        .filter((s: unknown) => s && typeof s === 'object' && typeof (s as any).label === 'string')
        .map((s: any) => {
          const sParams: Record<string, number> = {}
          if (s.parameters) {
            for (const [pid, val] of Object.entries(s.parameters)) {
              if (paramById.has(pid)) {
                sParams[pid] = Number(val)
              }
            }
          }
          return {
            label: String(s.label).trim(),
            parameters: sParams,
          }
        })
    }
    const hasStages = Boolean(stages && stages.length > 0)
    const hiddenParts = (raw.hiddenParts ?? []).filter(Boolean)
    const shownParts = (raw.shownParts ?? []).filter(Boolean)
    if (Object.keys(params).length === 0 && hiddenParts.length === 0 && shownParts.length === 0 && !hasStages) continue

    const label = raw.label || controlId
    const category = raw.category || inferControlCategory(controlId, label)
    const defaultStageIndex = Number.isInteger(raw.defaultStageIndex) && raw.defaultStageIndex! >= 0 && raw.defaultStageIndex! < (stages?.length ?? 0)
      ? raw.defaultStageIndex!
      : 0
    const defaultActive = hasStages ? defaultStageIndex > 0 || Boolean(raw.defaultActive) : Boolean(raw.defaultActive)
    const currentStageIndex = defaultStageIndex

    controls.push({
      id: controlId,
      label,
      category,
      parameters: hasStages ? { ...stages![defaultStageIndex].parameters } : params,
      hiddenParts,
      ...(shownParts.length > 0 ? { shownParts } : {}),
      defaultActive,
      active: defaultActive,
      source: 'adapter',
      ...(hasStages ? { stages, currentStageIndex, defaultStageIndex } : {}),
    })
    seenControlIds.add(controlId.toLowerCase())
  }

  const operations = new Set<string>()
  for (const control of controls) {
    for (const id of Object.keys(control.parameters)) coveredParams.add(id)
    for (const stage of control.stages ?? []) for (const id of Object.keys(stage.parameters)) coveredParams.add(id)
    if (control.hiddenParts.length || control.shownParts?.length) continue
    for (const parameters of [control.parameters, ...(control.stages ?? []).map(stage => stage.parameters)]) {
      if (Object.keys(parameters).length) operations.add(controlOperationKey(parameters))
    }
  }

  // 4) 从 .exp3.json 自动发现模型控件
  for (const exp of diskExpressions) {
    if (!exp.parameters.length) continue
    const stem = exp.name
    const hk = resourceHotkey(exp.file, vtubeHotkeys)
    const cleanParams: Record<string, number> = {}
    const activeParamNames: string[] = []
    for (const [id, value] of Object.entries(expressionControlParameters(exp, paramById))) {
      const pname = paramById.get(id)?.name ?? cdiParams[id]?.name ?? ''
      if (watermarkParamIds.has(id)) continue
      cleanParams[id] = value
      const defVal = paramById.get(id)?.default ?? 0
      if (value !== defVal && pname && !NOISE_NAME_RE.test(pname) && !activeParamNames.includes(pname)) {
        activeParamNames.push(pname)
      }
    }

    const cleanKeys = Object.keys(cleanParams)
    if (cleanKeys.length === 0) continue
    // 只去除等价操作；共享通道但取值不同、或组合方式不同的资源继续保留。
    const operation = controlOperationKey(cleanParams)
    if (operations.has(operation)) continue

    let cid: string
    let label: string
    if (/^\d+$/.test(stem) && activeParamNames.length > 0) {
      cid = activeParamNames[0]
      label = activeParamNames.slice(0, 2).join(' / ')
    } else {
      cid = resourceLabel(stem, hk && !/^\d+$/.test(hk) ? hk : undefined)
      const desc = activeParamNames.slice(0, 3).join(' / ')
      label = desc && desc.toLowerCase() !== cid.toLowerCase() ? `${cid} (${desc})` : cid
    }

    const preferredId = cid
    cid = uniqueResourceId(cid, !seenControlIds.has(stem.toLowerCase()) ? stem : `exp:${exp.file}`, seenControlIds)
    if (cid !== preferredId) label = `${label} (${cid.startsWith('exp:') ? exp.file : stem})`
    seenControlIds.add(cid.toLowerCase())
    operations.add(operation)
    for (const id of cleanKeys) coveredParams.add(id)

    controls.push({
      id: cid,
      label,
      category: inferControlCategory(cid, label),
      parameters: cleanParams,
      hiddenParts: [],
      defaultActive: false,
      active: false,
      source: 'auto',
    })
  }

  // 5) 从 .cdi3.json 自动发现独立按键/开关参数（如 wuwuwuwu 的 按键眼镜 / 按键外套）
  for (const p of caps.parameters) {
    if (physicsOut.has(p.id) || coveredParams.has(p.id) || watermarkParamIds.has(p.id)) continue
    const pname = p.name ?? cdiParams[p.id]?.name ?? ''
    const pgroup = p.group ?? cdiParams[p.id]?.group ?? ''
    if (!pname || NOISE_NAME_RE.test(pname)) continue
    if (WATERMARK_RE.test(p.id) || WATERMARK_RE.test(pname)) continue

    if (/按键|开关/.test(pname) || /按键|开关/.test(pgroup)) {
      if (STANDARD_SLIDER_META.some(meta => meta.re.test(p.id))) continue
      // 过滤 VTS 内部无用按键（如 Anikey、SWITCH*）以及纯装饰分隔符参数
      if (/Anikey$|SWITCH[A-Z]$|divider|[■]{2,}|^-{2,}/i.test(p.id) || /^[■_—\-]{2,}|[■]{2,}/.test(pname)) continue
      const targetVal = p.max
      // 默认值已在目标端时，“关闭=恢复默认”的控件无法表达另一端，保留为滑块。
      if (targetVal === p.default || !(p.max > p.min)) continue
      const cid = uniqueResourceId(pname, p.id, seenControlIds)
      seenControlIds.add(cid.toLowerCase())
      controls.push({
        id: cid,
        label: cid === pname ? pname : `${pname} (${p.id})`,
        category: inferControlCategory(pname, pname),
        parameters: { [p.id]: targetVal },
        hiddenParts: [],
        defaultActive: false,
        active: false,
        source: 'auto',
      })
    }
  }

  // 6) 从 .pose3.json 或 PartArmA / PartArmB 互斥部件组自动发现手部/姿态切换控件（如 Hiyori 的双手举起 PartArmB）
  const modelPartIds = new Set((caps.parts ?? []).map((pt) => pt.id))
  const diskPoseGroups = diskAssets?.poseGroups ?? caps.poseGroups ?? []
  const hasPoseFile = diskPoseGroups.length > 0
  const effectivePoseGroups: string[][] = []
  for (const grp of diskPoseGroups) {
    const valid = grp.filter((id) => modelPartIds.has(id))
    if (valid.length >= 2) effectivePoseGroups.push(valid)
  }
  if (
    modelPartIds.has('PartArmA') &&
    modelPartIds.has('PartArmB') &&
    !effectivePoseGroups.some((g) => g.includes('PartArmA') && g.includes('PartArmB'))
  ) {
    effectivePoseGroups.push(['PartArmA', 'PartArmB'])
  }

  for (const group of effectivePoseGroups) {
    const altPartIds = group.slice(1)
    for (const altId of altPartIds) {
      // 仅对缺少 .pose3.json 的模型（如 hiyori_vts）默认隐藏备选姿态图层，避免四只手同屏；
      // 有 .pose3.json 的模型由 CubismPose 自动管理，确保 .motion3.json 连续动作能自由切换 PartArmB
      if (!hasPoseFile) {
        baseHiddenPartsSet.add(altId)
      }

      const isArmB = /^PartArmB$/i.test(altId)
      const partName = (cdiParts[altId] ?? '').trim()
      const preferredId = isArmB ? '双手举起' : partName || altId
      const cid = uniqueResourceId(preferredId, altId, seenControlIds)
      const label = isArmB ? '双手举起 (手臂B)' : partName ? `${partName} (${altId})` : altId
      const otherParts = group.filter((id) => id !== altId)
      const operation = controlOperationKey({}, otherParts, [altId])
      if (controls.some(control => controlOperationKey(control.parameters, control.hiddenParts, control.shownParts) === operation)) continue
      seenControlIds.add(cid.toLowerCase())
      controls.push({
        id: cid,
        label,
        category: 'pose_prop',
        parameters: {},
        hiddenParts: otherParts,
        shownParts: [altId],
        defaultActive: false,
        active: false,
        source: 'auto',
      })
    }
  }

  return {
    baseParameters,
    hiddenParts: [...baseHiddenPartsSet],
    controls,
  }
}

/** 获取某个控件的"有效激活参数"（非默认值的参数；若全部等于默认值则返回全部）。 */
export function getActiveControlParams(
  control: ResolvedModelControl,
  defaultById: Map<string, number>,
): Record<string, number> {
  if (control.stages && control.stages.length > 0) {
    const curIdx = control.currentStageIndex ?? 0
    const stage = control.stages[curIdx] ?? control.stages[0]
    return stage ? { ...stage.parameters } : {}
  }
  const nonDefault: Record<string, number> = {}
  for (const [pid, val] of Object.entries(control.parameters)) {
    const def = defaultById.get(pid) ?? 0
    if (val !== def) {
      nonDefault[pid] = val
    }
  }
  return Object.keys(nonDefault).length > 0 ? nonDefault : { ...control.parameters }
}

/** 计算当前所有激活控件合并后的参数层、隐藏部件集合与强制显示部件集合。 */
export function computeControlLayerState(
  controls: ResolvedModelControl[],
  baseHiddenParts: string[],
  caps: ModelCapabilities | null,
): { parameters: Record<string, number>; hiddenParts: string[]; shownParts: string[] } {
  const defaultById = new Map<string, number>(
    (caps?.parameters ?? []).map((p) => [p.id, p.default]),
  )
  const parameters: Record<string, number> = {}
  const hiddenSet = new Set<string>(baseHiddenParts)
  const shownSet = new Set<string>()

  for (const ctrl of controls) {
    if (!ctrl.active) continue
    const activeParams = getActiveControlParams(ctrl, defaultById)
    for (const [pid, val] of Object.entries(activeParams)) {
      parameters[pid] = val
    }
    for (const partId of ctrl.shownParts ?? []) {
      shownSet.add(partId)
      hiddenSet.delete(partId)
    }
    for (const partId of ctrl.hiddenParts) {
      hiddenSet.add(partId)
      shownSet.delete(partId)
    }
  }

  return {
    parameters,
    hiddenParts: [...hiddenSet],
    shownParts: [...shownSet],
  }
}

/** 在控件列表中按 ID 或 label 模糊查找匹配的控件。 */
export function findModelControl(
  controls: ResolvedModelControl[],
  query: string,
): ResolvedModelControl | null {
  const q = query.trim().toLowerCase()
  if (!q) return null

  for (const c of controls) {
    if (c.id.toLowerCase() === q || c.label.toLowerCase() === q) return c
  }
  for (const c of controls) {
    const idLower = c.id.toLowerCase()
    const labelLower = c.label.toLowerCase()
    if (idLower.includes(q) || labelLower.includes(q) || q.includes(idLower)) {
      return c
    }
  }
  return null
}

export function isPersistentControlCategory(category: string): boolean {
  return category === 'outfit' || category === 'hair'
}

export interface PresetKeyframeStep {
  label?: string
  durationMs: number
  holdMs: number
  controls: string[]
  parameters: Record<string, number>
  /** 可选绑定的步骤原生动作（在多步分镜执行该步时触发） */
  motion?: { group: string; index?: number }
}

export type PresetFinishMode = 'hold' | 'revert' | 'loop'

export interface ModelStatePreset {
  id: string
  label: string
  description: string
  emotion: string
  /** 所属情绪/状态分组名称（如 '开心'、'害羞'、'生气不满'、'日常待机' 等，同组可包含多个变体预设供随机抽取） */
  group?: string
  controls: string[]
  /** 预设中包含的面捕/五官/角度连续参数覆盖值（与最后一步同步） */
  parameters?: Record<string, number>
  /** 分步关键帧序列（支持多步连续分镜动画） */
  steps?: PresetKeyframeStep[]
  /** 序列结束后的收尾方式：hold=持续保持终态，revert=演完平滑回退基准态，loop=循环往复 */
  finishMode?: PresetFinishMode
  /** 当 finishMode === 'revert' 时，终态保持多久后回退（默认 1600ms） */
  revertHoldMs?: number
  /** 可选绑定的模型原生 .motion3.json 动作，或 'none' 显式禁用内置动作 */
  motion?: { group: string; index?: number } | 'none'
  custom?: boolean
  /** 'user' marks presets saved by the workshop; absent means seeded built-in. */
  source?: 'builtin' | 'user'
  /** Empty default slot kept for authoring when the model cannot perform it yet. */
  unavailable?: true
  /** 仅用于预设工坊的临时预览，不落盘 */
  preview?: boolean
}

export const PRESET_EMOTION_GROUPS: ReadonlyArray<{ group: string; emotion: string }> = [
  { group: '日常待机', emotion: 'neutral' },
  { group: '开心', emotion: 'happy' },
  { group: '害羞', emotion: 'shy' },
  { group: '委屈难过', emotion: 'sad' },
  { group: '生气不满', emotion: 'angry' },
  { group: '尴尬', emotion: 'embarrassed' },
  { group: '厌烦', emotion: 'neutral' },
  { group: '倦怠', emotion: 'neutral' },
  { group: '思考', emotion: 'thinking' },
  { group: '专注', emotion: 'thinking' },
  { group: '工作', emotion: 'thinking' },
  { group: '好奇', emotion: 'curious' },
  { group: '惊讶', emotion: 'surprise' },
  { group: '等待', emotion: 'neutral' },
  { group: '测试', emotion: 'thinking' },
  { group: '空闲', emotion: 'neutral' },
]

/**
 * 工坊「状态预设」分组芯片的唯一来源：按当前模型实际加载的预设推导，
 * 顺序跟随预设列表，情绪取该分组第一个预设的情绪。
 * 分组名会随预设包演进（通用/DS 是 14 个长名，大肥鱼已改成短名），
 * 再写一份静态名单就必然和界面对不上，因此只在没有任何预设时回退到静态表。
 */
export function derivePresetGroupOptions(
  presets: Array<{ id?: string; label?: string; emotion?: string; group?: string }> | null | undefined,
): Array<{ group: string; emotion: string }> {
  const seen = new Map<string, string>()
  for (const preset of presets ?? []) {
    const group = resolvePresetGroup(preset)
    if (!group || seen.has(group)) continue
    seen.set(group, preset.emotion || 'neutral')
  }
  if (seen.size === 0) return PRESET_EMOTION_GROUPS.map((item) => ({ ...item }))
  return [...seen.entries()].map(([group, emotion]) => ({ group, emotion }))
}

export function resolvePresetGroup(preset: {
  id?: string
  label?: string
  emotion?: string
  group?: string
}): string {
  const explicit = (preset.group ?? '').trim()
  if (explicit) return explicit
  const id = (preset.id ?? '').trim().toLowerCase()
  const label = (preset.label ?? '').trim()
  const emo = (preset.emotion ?? '').trim().toLowerCase()
  const prefix = label.split(/[·・\-_/]/)[0]?.trim() ?? ''

  if (id === 'neutral' || id === 'idle' || label === '日常待机') return '日常待机'
  if (emo === 'thinking' || id.startsWith('think') || prefix === '思考') return '思考'
  if (id.startsWith('focus') || prefix === '专注') return '专注'
  if (emo === 'curious' || id.startsWith('curious') || prefix === '好奇') return '好奇'
  if (emo === 'surprise' || id.startsWith('surprise') || prefix === '惊讶') return '惊讶'
  if (id.startsWith('waiting') || prefix === '等待') return '等待'
  if (id.startsWith('testing') || prefix === '测试') return '测试'
  if (id.startsWith('annoyed') || prefix === '厌烦' || /厌烦|嫌弃|白眼/.test(label)) return '厌烦'
  if (id.startsWith('weary') || prefix === '倦怠' || /倦怠|打盹|困倦/.test(label)) return '倦怠'
  if (emo === 'happy' || id.startsWith('happy') || prefix === '开心') return '开心'
  if (emo === 'shy' || id.startsWith('shy') || prefix === '害羞') return '害羞'
  if (emo === 'sad' || id.startsWith('sad') || prefix === '委屈' || prefix === '委屈难过') return '委屈难过'
  if (emo === 'angry' || id.startsWith('angry') || prefix === '生气' || prefix === '生气不满') return '生气不满'
  if (emo === 'embarrassed' || id.startsWith('embarrassed') || prefix === '尴尬') return '尴尬'
  if (prefix && label.includes('·')) return prefix
  if (emo && emo !== 'neutral') return emo
  return '日常待机'
}

export function getPresetDefaultFinishMode(preset: {
  id?: string
  label?: string
  emotion?: string
  group?: string
  finishMode?: PresetFinishMode
}): PresetFinishMode {
  if (
    preset.finishMode === 'hold' ||
    preset.finishMode === 'revert' ||
    preset.finishMode === 'loop'
  ) {
    return preset.finishMode
  }
  const text = `${preset.id ?? ''} ${preset.label ?? ''} ${preset.emotion ?? ''} ${preset.group ?? ''}`
  if (
    /^(neutral|idle|annoyed|weary)/i.test(preset.id ?? '') ||
    /待机|日常|厌烦|倦怠|犯困|造型|服装/i.test(text)
  ) {
    return 'hold'
  }
  return 'revert'
}

export function normalizePresetSteps(preset: {
  controls?: string[]
  parameters?: Record<string, number>
  steps?: PresetKeyframeStep[]
}): PresetKeyframeStep[] {
  if (Array.isArray(preset.steps) && preset.steps.length > 0) {
    return preset.steps.map((s) => ({
      ...(s.label ? { label: s.label } : {}),
      durationMs: Number.isFinite(s.durationMs)
        ? Math.max(40, Math.min(5000, Math.round(s.durationMs)))
        : 600,
      holdMs: Number.isFinite(s.holdMs)
        ? Math.max(0, Math.min(10000, Math.round(s.holdMs)))
        : 1000,
      controls: Array.isArray(s.controls) ? [...s.controls] : [...(preset.controls ?? [])],
      parameters: s.parameters ? { ...s.parameters } : {},
      ...(isNativeMotionBinding(s.motion)
        ? {
            motion: {
              group: s.motion.group,
              ...(Number.isFinite(s.motion.index) ? { index: Number(s.motion.index) } : {}),
            },
          }
        : {}),
    }))
  }
  return [
    {
      durationMs: 600,
      holdMs: 0,
      controls: [...(preset.controls ?? [])],
      parameters: preset.parameters ? { ...preset.parameters } : {},
    },
  ]
}

export interface ResolvedModelSlider {
  id: string
  label: string
  group: 'face' | 'pose' | 'extra'
  min: number
  max: number
  step: number
  defaultValue: number
  value: number
}

const STANDARD_SLIDER_META: Array<{
  re: RegExp
  label: string
  group: 'face' | 'pose'
  order: number
}> = [
  { re: /^ParamEyeLOpen$/i, label: '左眼开合', group: 'face', order: 1 },
  { re: /^ParamEyeROpen$/i, label: '右眼开合', group: 'face', order: 2 },
  { re: /^ParamEyeLSmile$/i, label: '左眼笑意', group: 'face', order: 3 },
  { re: /^ParamEyeRSmile$/i, label: '右眼笑意', group: 'face', order: 4 },
  { re: /^ParamEyeBallX$/i, label: '视线左右', group: 'face', order: 5 },
  { re: /^ParamEyeBallY$/i, label: '视线上下', group: 'face', order: 6 },
  { re: /^ParamBrowLY$/i, label: '左眉高低', group: 'face', order: 7 },
  { re: /^ParamBrowRY$/i, label: '右眉高低', group: 'face', order: 8 },
  { re: /^ParamBrowLX$/i, label: '左眉左右', group: 'face', order: 9 },
  { re: /^ParamBrowRX$/i, label: '右眉左右', group: 'face', order: 10 },
  { re: /^ParamBrowLAngle$/i, label: '左眉角度', group: 'face', order: 11 },
  { re: /^ParamBrowRAngle$/i, label: '右眉角度', group: 'face', order: 12 },
  { re: /^ParamBrowLForm$/i, label: '左眉弯曲', group: 'face', order: 13 },
  { re: /^ParamBrowRForm$/i, label: '右眉弯曲', group: 'face', order: 14 },
  { re: /^ParamMouthForm$/i, label: '嘴角弧度', group: 'face', order: 15 },
  { re: /^ParamMouthOpenY$/i, label: '嘴巴张合', group: 'face', order: 16 },
  { re: /^(Param)?MouthX$/i, label: '歪嘴左右', group: 'face', order: 17 },
  { re: /^(Param)?MouthPucker/i, label: '嘟嘴幅度', group: 'face', order: 18 },
  { re: /^ParamCheek$/i, label: '脸颊红晕', group: 'face', order: 19 },
  { re: /^ParamAngleX$/i, label: '头部左右 (X)', group: 'pose', order: 20 },
  { re: /^ParamAngleY$/i, label: '头部俯仰 (Y)', group: 'pose', order: 21 },
  { re: /^ParamAngleZ$/i, label: '头部歪斜 (Z)', group: 'pose', order: 22 },
  { re: /^ParamBodyAngleX$/i, label: '身体左右 (X)', group: 'pose', order: 23 },
  { re: /^ParamBodyAngleY$/i, label: '身体俯仰 (Y)', group: 'pose', order: 24 },
  { re: /^ParamBodyAngleZ$/i, label: '身体歪斜 (Z)', group: 'pose', order: 25 },
  { re: /^ParamShoulder$/i, label: '双肩耸动', group: 'pose', order: 26 },
  { re: /^ParamLeg$/i, label: '腿部微动', group: 'pose', order: 27 },
  { re: /^ParamStep$/i, label: '步伐微动', group: 'pose', order: 28 },
  { re: /^ParamArmLA$/i, label: '左臂张合 (垂手A)', group: 'pose', order: 30 },
  { re: /^ParamArmRA$/i, label: '右臂张合 (垂手A)', group: 'pose', order: 31 },
  { re: /^ParamHandL$/i, label: '左手手型 (垂手A)', group: 'pose', order: 32 },
  { re: /^ParamHandR$/i, label: '右手手型 (垂手A)', group: 'pose', order: 33 },
  { re: /^ParamArmLB$/i, label: '左臂高低 (举手B)', group: 'pose', order: 34 },
  { re: /^ParamArmRB$/i, label: '右臂高低 (举手B)', group: 'pose', order: 35 },
  { re: /^ParamHandLB$/i, label: '左手旋转 (举手B)', group: 'pose', order: 36 },
  { re: /^ParamHandRB$/i, label: '右手旋转 (举手B)', group: 'pose', order: 37 },
]

function computeSliderStep(min: number, max: number): number {
  const span = Math.abs(max - min)
  if (span <= 2.5) return 0.05
  if (span <= 10) return 0.1
  return 1
}

/**
 * 从当前模型参数清单中提取可供用户调节的 VTB 面捕/五官/姿态滑块。
 * 自动过滤掉底层去水印参数、纯物理输出参数以及已被做成二元开关的单参数控件。
 */
const VTS_KNOWN_META: Record<string, { label: string; group: 'face' | 'pose'; order: number }> = {
  AngleX: { label: '头部左右 (X)', group: 'pose', order: 10 },
  AngleY: { label: '头部俯仰 (Y)', group: 'pose', order: 11 },
  AngleZ: { label: '头部歪斜 (Z)', group: 'pose', order: 12 },
  PositionX: { label: '身体左右 (X)', group: 'pose', order: 20 },
  PositionY: { label: '身体俯仰 (Y)', group: 'pose', order: 21 },
  PositionZ: { label: '身体前后 (Z)', group: 'pose', order: 22 },
  ParamEyeLOpen: { label: '左眼开合', group: 'face', order: 1 },
  ParamEyeROpen: { label: '右眼开合', group: 'face', order: 2 },
  EyeSmile: { label: '笑眼', group: 'face', order: 3 },
  LEyeSquint: { label: '左眼眯起', group: 'face', order: 4 },
  REyeSquint: { label: '右眼眯起', group: 'face', order: 5 },
  ParamEyeBallX: { label: '视线左右', group: 'face', order: 6 },
  ParamEyeBallY: { label: '视线上下', group: 'face', order: 7 },
  ParamBrowLY: { label: '左眉高低', group: 'face', order: 8 },
  ParamBrowRY: { label: '右眉高低', group: 'face', order: 9 },
  BrowInnerUp: { label: '挑眉/蹙眉', group: 'face', order: 10 },
  ParamBrowLAngle: { label: '左眉角度', group: 'face', order: 11 },
  ParamBrowRAngle: { label: '右眉角度', group: 'face', order: 12 },
  ParamMouthForm: { label: '嘴角弧度', group: 'face', order: 13 },
  ParamMouthOpenY: { label: '嘴巴张合', group: 'face', order: 14 },
  JawOpen: { label: '下巴张开', group: 'face', order: 15 },
  TongueOut: { label: '吐舌', group: 'face', order: 16 },
  CheeckPuff: { label: '脸颊鼓起', group: 'face', order: 17 },
  CheekPuff: { label: '脸颊鼓起', group: 'face', order: 17 },
  Mouthpucker: { label: '嘟嘴', group: 'face', order: 18 },
  MouthPuckerWiden: { label: '扁嘴/阔嘴', group: 'face', order: 19 },
  MouthFunnel: { label: '圆嘴 (O型)', group: 'face', order: 20 },
  MouthX: { label: '歪嘴左右', group: 'face', order: 21 },
  MouthSmile_L: { label: '左嘴角上扬', group: 'face', order: 22 },
  MouthSmile_R: { label: '右嘴角上扬', group: 'face', order: 23 },
  MouthPressLipOpen: { label: '抿嘴唇', group: 'face', order: 24 },
  NoseNeer: { label: '鼻梁皱起', group: 'face', order: 25 },
  MouthRollUpper: { label: '上唇内卷', group: 'face', order: 26 },
  MouthRollLower: { label: '下唇内卷', group: 'face', order: 27 },
}

const INTERNAL_CHANNEL_RE =
  /Colorflicker|Glintshift|LittleFlower|AngryMove|RCry|LCry|Startwinkle|Kira[A-Z]|GemHighlight|GemReflection|ParamSilence|Param[AIUEO]$|LeanInput|IDLE$|Anikey$|SWITCH[A-Z]$|divider|[■]{2,}|^-{2,}|SweatBurst|FeatherPhysics|RibbonY\d|SkirtLayerY|LateSideHair|FrontHairZ|RSleeveX|RShiftbuffer|RColorshift|MicroGlows|WingOpenClose|WingSpread|WingRotation|Ani\d+$|^Param\d+$|AniEyerolling|Angry\d*$/i

export function resolveModelSliders(
  caps: ModelCapabilities | null,
  controls: ResolvedModelControl[] = [],
  baseParameters: Record<string, number> = {},
  motionParameterIds: Iterable<string> = [],
  focus?: FocusMapping,
  vtubeParameters: Array<{ input: string; output: string }> = [],
  physicsOutputIds: Iterable<string> = [],
): ResolvedModelSlider[] {
  const params = caps?.parameters ?? []
  if (params.length === 0) return []

  const baseIds = new Set(Object.keys(baseParameters))
  const motionParamIds = new Set(motionParameterIds)
  const physicsSet = new Set(physicsOutputIds)
  const allParamIds = new Set(params.map((p) => p.id))

  // 当模型声明了 VTS Angle/Position 时，抑制官方残留的空标准参数，避免双重滑块与无效滑块
  const suppressedStandards = new Set<string>()
  if (allParamIds.has('AngleX')) suppressedStandards.add('ParamAngleX')
  if (allParamIds.has('AngleY')) suppressedStandards.add('ParamAngleY')
  if (allParamIds.has('AngleZ')) suppressedStandards.add('ParamAngleZ')
  if (allParamIds.has('PositionX')) suppressedStandards.add('ParamBodyAngleX')
  if (allParamIds.has('PositionY')) suppressedStandards.add('ParamBodyAngleY')
  if (allParamIds.has('PositionZ')) suppressedStandards.add('ParamBodyAngleZ')

  // 控件已经接管的参数不再重复做成滑块：否则同一参数会有两个入口互相覆盖，
  // 武器/姿势这类多参数控件还会把十几个内部开关全部暴露出来。
  const controlParamIds = new Set<string>()
  for (const ctrl of controls) {
    for (const id of Object.keys(ctrl.parameters)) controlParamIds.add(id)
    if (ctrl.stages) {
      for (const s of ctrl.stages) {
        for (const id of Object.keys(s.parameters)) controlParamIds.add(id)
      }
    }
  }

  // 映射 focus 声明的核心头部与身体姿态参数
  const focusPoseMap = new Map<string, { label: string; group: 'pose' | 'face'; order: number }>()
  if (focus) {
    if (focus.headXParam) focusPoseMap.set(focus.headXParam, { label: '头部左右 (X)', group: 'pose', order: 10 })
    if (focus.headYParam) focusPoseMap.set(focus.headYParam, { label: '头部俯仰 (Y)', group: 'pose', order: 11 })
    if (focus.headZParam) focusPoseMap.set(focus.headZParam, { label: '头部歪斜 (Z)', group: 'pose', order: 12 })
    if (focus.bodyXParam) focusPoseMap.set(focus.bodyXParam, { label: '身体左右 (X)', group: 'pose', order: 20 })
    if (focus.bodyYParam) focusPoseMap.set(focus.bodyYParam, { label: '身体俯仰 (Y)', group: 'pose', order: 21 })
    if (focus.bodyZParam) focusPoseMap.set(focus.bodyZParam, { label: '身体歪斜 (Z)', group: 'pose', order: 22 })
    if (focus.eyeXParam) focusPoseMap.set(focus.eyeXParam, { label: '视线左右', group: 'face', order: 6 })
    if (focus.eyeYParam) focusPoseMap.set(focus.eyeYParam, { label: '视线上下', group: 'face', order: 7 })
  }

  const vtsOutputSet = new Set(vtubeParameters.map((vp) => vp.output))

  const ordered: Array<{ slider: ResolvedModelSlider; order: number }> = []

  for (const p of params) {
    if (baseIds.has(p.id)) continue
    if (p.isPhysicsOutput || physicsSet.has(p.id)) continue
    if (suppressedStandards.has(p.id) && !focusPoseMap.has(p.id)) continue
    if (/^ParamBreath$/i.test(p.id)) continue
    const span = p.max - p.min
    if (!(span > 0)) continue

    const label = resourceLabel(p.id, p.name)
    const text = `${p.id} ${label} ${p.group ?? ''}`

    // 控件已接管的通道不再生成滑块：必须排在 focus / 标准元数据之前，
    // 否则同一个参数会同时有滑块与控件两个入口，互相覆盖。
    if (controlParamIds.has(p.id)) continue

    // 1) 优先匹配 focus
    const focusMeta = focusPoseMap.get(p.id)
    if (focusMeta) {
      ordered.push({
        order: focusMeta.order,
        slider: {
          id: p.id,
          label: focusMeta.label,
          group: focusMeta.group,
          min: p.min,
          max: p.max,
          step: computeSliderStep(p.min, p.max),
          defaultValue: p.default,
          value: p.default,
        },
      })
      continue
    }

    // 2) 优先匹配 VTS 已知核心面捕与姿态元数据
    const vtsMeta = VTS_KNOWN_META[p.id]
    if (vtsMeta) {
      ordered.push({
        order: vtsMeta.order,
        slider: {
          id: p.id,
          label: vtsMeta.label,
          group: vtsMeta.group,
          min: p.min,
          max: p.max,
          step: computeSliderStep(p.min, p.max),
          defaultValue: p.default,
          value: p.default,
        },
      })
      continue
    }

    // 3) 标准 Live2D 元数据匹配
    const std = STANDARD_SLIDER_META.find((m) => m.re.test(p.id))
    if (std) {
      ordered.push({
        order: std.order,
        slider: {
          id: p.id,
          label: p.name ? `${std.label}` : std.label,
          group: std.group,
          min: p.min,
          max: p.max,
          step: computeSliderStep(p.min, p.max),
          defaultValue: p.default,
          value: p.default,
        },
      })
      continue
    }

    // 动作独占只排除没有元数据匹配的通道：标准姿态参数仍允许用户用滑块微调，
    // 所以这条不能提到 focus / 标准元数据之前。
    if (motionParamIds.has(p.id) && !vtsOutputSet.has(p.id)) continue

    // 已确认的可写输入优先于命名启发式；组名含“物理”不等于此参数是物理输出。
    if (!vtsOutputSet.has(p.id)) {
      if (isAttributionLabel(p.name ?? '')) continue
      if (/物理|飘动|摇晃|呼吸|physics|hair.*shake|skirt/i.test(`${p.id} ${label}`)) continue
      if (INTERNAL_CHANNEL_RE.test(p.id) || INTERNAL_CHANNEL_RE.test(label)) continue
    }

    let group: 'face' | 'pose' | 'extra' = 'extra'
    let order = 100
    if (/眼|眉|嘴|口|舌|腮|脸|瞳|eye|brow|mouth|cheek|pupil|tongue/i.test(text)) {
      group = 'face'
      order = 40
    } else if (/头|身|腰|脖|手|臂|九轴|angle|body|head|arm/i.test(text)) {
      group = 'pose'
      order = 60
    }

    ordered.push({
      order,
      slider: {
        id: p.id,
        label,
        group,
        min: p.min,
        max: p.max,
        step: computeSliderStep(p.min, p.max),
        defaultValue: p.default,
        value: p.default,
      },
    })
  }

  ordered.sort((a, b) => a.order - b.order)
  return ordered.map((item) => item.slider)
}

/** 记录每个情绪分组上一次随机抽中的预设 ID，同组 >= 2 个预设时避免连续两次抽到同一个变体 */
const lastPickedPresetByGroup = new Map<string, string>()

function chooseNonRepeatingRandomPreset(
  groupKey: string,
  candidates: ModelStatePreset[],
): ModelStatePreset | null {
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]
  const lastId = lastPickedPresetByGroup.get(groupKey)
  const pool = lastId ? candidates.filter((p) => p.id !== lastId) : candidates
  const effectivePool = pool.length > 0 ? pool : candidates
  const picked = effectivePool[Math.floor(Math.random() * effectivePool.length)]
  lastPickedPresetByGroup.set(groupKey, picked.id)
  return picked
}

/**
 * 在指定的情绪分组或情绪键下随机抽取一个预设（同组 >= 2 个预设时防连重）。
 */
export function pickRandomPresetInGroup(
  presets: ModelStatePreset[],
  groupOrEmotion: string,
): ModelStatePreset | null {
  const q = groupOrEmotion.trim().toLowerCase()
  if (!q) return null
  const groupMatches = presets.filter((p) => {
    const grp = resolvePresetGroup(p).toLowerCase()
    const emo = (p.emotion ?? '').trim().toLowerCase()
    return grp === q || (q !== 'neutral' && emo === q)
  })
  return chooseNonRepeatingRandomPreset(q, groupMatches)
}

export function findModelStatePreset(
  presets: ModelStatePreset[],
  query: string,
  options?: { exactOnly?: boolean },
): ModelStatePreset | null {
  const q = query.trim().toLowerCase()
  if (!q) return null

  if (options?.exactOnly) {
    for (const p of presets) {
      if (p.id.toLowerCase() === q || p.label.toLowerCase() === q) return p
    }
    return null
  }

  // 1) 若查询词命中某个拥有多个预设变体的「情绪分组名」或「基础情绪名」（例如 'happy' / '开心' / '害羞'），
  //    优先在该分组内随机抽取一个预设变体（防连续重复），丰富状态表现多样性
  const groupMatches = presets.filter((p) => {
    const grp = resolvePresetGroup(p).toLowerCase()
    const emo = (p.emotion ?? '').trim().toLowerCase()
    return grp === q || (q !== 'neutral' && emo === q)
  })
  if (groupMatches.length > 1) {
    return chooseNonRepeatingRandomPreset(q, groupMatches)
  }

  // 2) 精确匹配单个预设的 id 或 label（如具体变体名 '开心·歪头笑'）
  for (const p of presets) {
    if (p.id.toLowerCase() === q || p.label.toLowerCase() === q) return p
  }

  // 3) 若单预设分组命中，直接返回
  if (groupMatches.length === 1) {
    return groupMatches[0]
  }

  // 4) 模糊包含匹配（支持分组名、预设名或 ID 子串匹配；若命中多个同组变体同样随机抽取）
  const fuzzyMatches = presets.filter((p) => {
    const idLower = p.id.toLowerCase()
    const labelLower = p.label.toLowerCase()
    const grpLower = resolvePresetGroup(p).toLowerCase()
    return (
      labelLower.includes(q) ||
      q.includes(labelLower) ||
      grpLower.includes(q) ||
      q.includes(grpLower) ||
      idLower === q
    )
  })
  if (fuzzyMatches.length > 0) {
    return chooseNonRepeatingRandomPreset(q, fuzzyMatches)
  }

  return null
}

/**
 * 对控件列表执行 on / off / toggle / reset / reset_transient / set，并自动处理互斥预设控件
 */
export function applyControlActionToList(
  controls: ResolvedModelControl[],
  query: string | string[],
  action: 'on' | 'off' | 'toggle' | 'reset' | 'reset_transient' | 'set',
  caps: ModelCapabilities | null,
): { matched: ResolvedModelControl | null; matchedList: ResolvedModelControl[]; changed: boolean } {
  if (action === 'reset') {
    let changed = false
    for (const c of controls) {
      if (c.held) {
        c.held = false
        changed = true
      }
      if (c.stages && c.stages.length > 0) {
        const defIdx = c.defaultStageIndex ?? 0
        if (c.currentStageIndex !== defIdx) {
          c.currentStageIndex = defIdx
          c.parameters = { ...c.stages[defIdx].parameters }
          changed = true
        }
      }
      if (c.active !== c.defaultActive) {
        c.active = c.defaultActive
        changed = true
      }
    }
    return { matched: null, matchedList: [], changed }
  }

  if (action === 'reset_transient') {
    let changed = false
    for (const c of controls) {
      if (!isPersistentControlCategory(c.category) && !c.held) {
        if (c.stages && c.stages.length > 0) {
          const defIdx = c.defaultStageIndex ?? 0
          if (c.currentStageIndex !== defIdx) {
            c.currentStageIndex = defIdx
            c.parameters = { ...c.stages[defIdx].parameters }
            changed = true
          }
        }
        if (c.active !== c.defaultActive) {
          c.active = c.defaultActive
          changed = true
        }
      }
    }
    return { matched: null, matchedList: [], changed }
  }

  const queries = Array.isArray(query)
    ? query.map((s) => String(s).trim()).filter(Boolean)
    : String(query || '')
        .split(/[,，;；]+/)
        .map((s) => s.trim())
        .filter(Boolean)

  let changed = false
  if (action === 'set') {
    for (const c of controls) {
      if (!isPersistentControlCategory(c.category) && !c.held) {
        if (c.stages && c.stages.length > 0) {
          const defIdx = c.defaultStageIndex ?? 0
          if (c.currentStageIndex !== defIdx) {
            c.currentStageIndex = defIdx
            c.parameters = { ...c.stages[defIdx].parameters }
            changed = true
          }
        }
        if (c.active !== c.defaultActive) {
          c.active = c.defaultActive
          changed = true
        }
      }
    }
    if (queries.length === 0) {
      return { matched: null, matchedList: [], changed }
    }
  }

  if (queries.length === 0) {
    return { matched: null, matchedList: [], changed: false }
  }

  const defaultById = new Map<string, number>(
    (caps?.parameters ?? []).map((p) => [p.id, p.default]),
  )
  const matchedList: ResolvedModelControl[] = []

  for (const rawQ of queries) {
    let q = rawQ
    let stageTarget: string | null = null
    const colonIdx = rawQ.indexOf(':')
    const zhColonIdx = rawQ.indexOf('：')
    const sepIdx = colonIdx >= 0 ? colonIdx : zhColonIdx
    if (sepIdx >= 0) {
      q = rawQ.slice(0, sepIdx).trim()
      stageTarget = rawQ.slice(sepIdx + 1).trim()
    }

    const target = findModelControl(controls, q)
    if (!target) continue
    if (!matchedList.includes(target)) matchedList.push(target)

    const effectiveAction = action === 'set' ? 'on' : action
    const hasStages = Boolean(target.stages && target.stages.length > 0)

    let nextActive = target.active
    if (hasStages && target.stages) {
      const stageCount = target.stages.length
      const defIdx = target.defaultStageIndex ?? 0
      const curIdx = target.currentStageIndex ?? defIdx

      if (stageTarget !== null) {
        const stageNum = parseInt(stageTarget, 10)
        let foundIdx = -1
        if (!isNaN(stageNum) && stageNum >= 0 && stageNum < stageCount) {
          foundIdx = stageNum
        } else {
          foundIdx = target.stages.findIndex((s) => s.label.toLowerCase() === stageTarget!.toLowerCase())
        }
        if (foundIdx >= 0) {
          if (target.currentStageIndex !== foundIdx || !target.parameters) {
            target.currentStageIndex = foundIdx
            target.parameters = { ...target.stages[foundIdx].parameters }
            changed = true
          }
          if (effectiveAction === 'on') {
            nextActive = true
          } else if (effectiveAction === 'off') {
            nextActive = false
          } else {
            nextActive = foundIdx !== defIdx || Boolean(target.defaultActive)
          }
        }
      } else if (effectiveAction === 'on') {
        const targetIdx = target.active ? curIdx : (curIdx === defIdx ? (defIdx + 1) % stageCount : curIdx)
        if (target.currentStageIndex !== targetIdx || !target.parameters) {
          target.currentStageIndex = targetIdx
          target.parameters = { ...target.stages[targetIdx].parameters }
          changed = true
        }
        nextActive = true
      } else if (effectiveAction === 'off') {
        if (target.currentStageIndex !== defIdx || !target.parameters) {
          target.currentStageIndex = defIdx
          target.parameters = { ...target.stages[defIdx].parameters }
          changed = true
        }
        nextActive = false
      } else {
        const nextIdx = (curIdx + 1) % stageCount
        if (target.currentStageIndex !== nextIdx || !target.parameters) {
          target.currentStageIndex = nextIdx
          target.parameters = { ...target.stages[nextIdx].parameters }
          changed = true
        }
        nextActive = nextIdx !== defIdx || Boolean(target.defaultActive)
      }
    } else {
      nextActive = effectiveAction === 'on' ? true : effectiveAction === 'off' ? false : !target.active
    }

    if (target.active !== nextActive) {
      changed = true
    }
    target.active = nextActive
    if (!nextActive) target.held = false

    if (nextActive) {
      const activeParams = getActiveControlParams(target, defaultById)
      const targetTouchedIds = new Set(Object.keys(activeParams))
      const targetHiddenSet = new Set(target.hiddenParts)
      const targetShownSet = new Set(target.shownParts ?? [])
      for (const other of controls) {
        if (other === target || !other.active) continue
        const otherActiveIds = Object.keys(getActiveControlParams(other, defaultById))
        const paramConflict =
          otherActiveIds.length > 0 && otherActiveIds.every((id) => targetTouchedIds.has(id))
        const poseConflict =
          (other.shownParts ?? []).some((p) => targetHiddenSet.has(p)) ||
          other.hiddenParts.some((p) => targetShownSet.has(p))
        if (paramConflict || poseConflict) {
          other.active = false
          other.held = false
          changed = true
        }
      }
    }
  }

  return {
    matched: matchedList[0] ?? null,
    matchedList,
    changed: matchedList.length > 0 || changed,
  }
}

/**
 * 根据预设的 ID、名称或情绪键，解析切换该预设时应同步播放的连续动作（.motion3.json）。
 * 优先使用 deskpet-adapter.json 中的动作映射，若无适配文件则自动回退匹配模型自带的动作组。
 */
export function resolvePresetMotion(
  preset: {
    id?: string
    label?: string
    emotion?: string
    controls?: string[]
    motion?: { group: string; index?: number } | 'none'
  },
  adapter: ModelEmotionAdapter | null,
  caps: ModelCapabilities | null,
): EmotionMotionTarget | null {
  if (preset.motion === 'none') return null
  const motionGroups = caps?.motionGroups ?? {}
  const hasGroup = (g: string) => (motionGroups[g] ?? 0) > 0
  if (preset.motion && typeof preset.motion === 'object' && typeof preset.motion.group === 'string') {
    if (hasGroup(preset.motion.group)) {
      return { group: preset.motion.group, index: preset.motion.index ?? 0 }
    }
  }

  if (preset.id && preset.id !== 'neutral' && preset.id !== 'idle') {
    const byId = getEmotionTarget(adapter, preset.id)?.motion
    if (byId && hasGroup(byId.group)) return byId
    const animById = getAnimationTarget(adapter, preset.id)?.motion
    if (animById && hasGroup(animById.group)) return animById
  }

  if (preset.emotion && preset.emotion !== 'neutral' && preset.emotion !== 'idle') {
    const byEmo = getEmotionTarget(adapter, preset.emotion)?.motion
    if (byEmo && hasGroup(byEmo.group)) return byEmo
  }

  const text = `${preset.id ?? ''} ${preset.label ?? ''} ${preset.emotion ?? ''} ${(preset.controls ?? []).join(' ')}`
  if (/双手举起|思考|好奇|thinking|curious|wake/i.test(text)) {
    const t = getEmotionTarget(adapter, 'thinking')?.motion ?? getEmotionTarget(adapter, 'curious')?.motion
    if (t && hasGroup(t.group)) return t
    if (hasGroup('FlickUp')) return { group: 'FlickUp', index: 0 }
  }
  if (/开心|欢呼|挥手|高兴|愉快|happy|cheer|wave|smile/i.test(text)) {
    const t = getEmotionTarget(adapter, 'happy')?.motion ?? getAnimationTarget(adapter, 'cheer')?.motion
    if (t && hasGroup(t.group)) return t
    if (hasGroup('Tap')) return { group: 'Tap', index: (motionGroups.Tap ?? 1) > 1 ? 1 : 0 }
  }
  if (/生气|不满|愤怒|厌烦|嫌弃|烦躁|angry|annoyed/i.test(text)) {
    const t = getEmotionTarget(adapter, 'angry')?.motion
    if (t && hasGroup(t.group)) return t
    if (hasGroup('Flick@Body')) return { group: 'Flick@Body', index: 0 }
  }
  if (/委屈|难过|伤心|哭|倦怠|困倦|疲惫|sad|weary|sleep/i.test(text)) {
    const t = getEmotionTarget(adapter, 'sad')?.motion
    if (t && hasGroup(t.group)) return t
    if (hasGroup('FlickDown')) return { group: 'FlickDown', index: 0 }
  }
  if (/害羞|羞怯|尴尬|脸红|shy|embarrassed/i.test(text)) {
    const t = getEmotionTarget(adapter, 'shy')?.motion ?? getEmotionTarget(adapter, 'embarrassed')?.motion
    if (t && hasGroup(t.group)) return t
    if (hasGroup('Tap@Body')) return { group: 'Tap@Body', index: 0 }
  }
  if (/惊讶|吃惊|吓|surprise/i.test(text)) {
    const t = getEmotionTarget(adapter, 'surprise')?.motion
    if (t && hasGroup(t.group)) return t
    if (hasGroup('Flick')) return { group: 'Flick', index: 0 }
  }
  return null
}

/** 同一套默认槽位按模型的可用通道生成，专用演出继续使用对应模型的标定数据。 */
export function buildModelStatePresets(
  controls: ResolvedModelControl[],
  sliders: ResolvedModelSlider[] = [],
  caps: ModelCapabilities | null = null,
  adapter: ModelEmotionAdapter | null = null,
): ModelStatePreset[] {
  if (isDafishModel(sliders, controls) && (caps?.motionGroups[DAFISH_BODY_LED_HAPPY_MOTION] ?? 0) > 0) {
    return buildDafishNaturalPresets()
  }
  const generic = buildGenericStatePresets(controls, sliders, caps, adapter)
  return isDsMouseModel(sliders, controls)
    ? alignDefaultPresetSlots([...generic, ...buildDsNaturalPresets(sliders, controls)])
    : generic
}
