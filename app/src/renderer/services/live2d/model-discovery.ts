/**
 * Live2D 模型发现
 *
 * 选取顺序：
 *   1. 用户在设置面板里选定的模型（localStorage: deskpet/model-path）
 *   2. model-config.ts 里的 MODEL_PATH（内置默认模型）
 *   3. 主进程扫描 public/models/ 得到的第一个 .model3.json
 *
 * 目录扫描交给主进程做（渲染层没有 fs），见 main/index.ts 的 list-models。
 */
import { MODEL_PATH } from '@/services/model-config'

export const MODEL_PATH_KEY = 'deskpet/model-path'
export const MODEL_KIND_MEMORY_KEY = 'deskpet/model-by-kind'

export type ModelKind = 'live2d' | 'image-set'

function readKindMemory(): Partial<Record<ModelKind, string>> {
  try {
    const parsed = JSON.parse(localStorage.getItem(MODEL_KIND_MEMORY_KEY) || '{}') as
      Partial<Record<ModelKind, unknown>>
    const memory: Partial<Record<ModelKind, string>> = {}
    for (const kind of ['live2d', 'image-set'] as const) {
      const value = parsed?.[kind]
      if (typeof value === 'string') {
        const normalized = normalizeModelPath(value)
        if (normalized) memory[kind] = normalized
      }
    }
    return memory
  } catch {
    return {}
  }
}

/** Last model explicitly used in each display kind; empty when this kind has no history. */
export function getStoredModelForKind(kind: ModelKind): string {
  return readKindMemory()[kind] ?? ''
}

export function rememberModelForKind(url: string): void {
  const normalized = normalizeModelPath(url)
  if (!normalized) return
  try {
    const memory = readKindMemory()
    const kind = kindOfModelUrl(normalized)
    if (memory[kind] === normalized) return
    memory[kind] = normalized
    localStorage.setItem(MODEL_KIND_MEMORY_KEY, JSON.stringify(memory))
  } catch {
    // localStorage disabled: current session still switches normally.
  }
}

/** 由模型 URL 判定渲染路径：立绘包清单 vs Live2D model3.json */
export function kindOfModelUrl(url: string): ModelKind {
  return /deskpet-images\.json(\?|#|$)/i.test(url) ? 'image-set' : 'live2d'
}

let cachedModelUrl: string | null = null
let cachedModelList: ModelEntry[] | null = null

/**
 * 提取归一化的相对路径标识符，用于跨协议（uta:// vs deskpet:// vs ./models/）、
 * 跨平台路径分隔符、以及 URL 编码与未编码（如中文文件名）之间做可靠匹配。
 */
export function normalizeModelKey(rawUrl: string): string {
  if (!rawUrl) return ''
  let cleaned = rawUrl.trim().replace(/\\/g, '/')
  try {
    cleaned = decodeURIComponent(cleaned)
  } catch {}
  return cleaned
    .replace(/^uta:\/\/models\//i, '')
    .replace(/^deskpet:\/\/models\//i, '')
    .replace(/^\.?\/models\//i, '')
    .replace(/^models\//i, '')
    .replace(/^\/+/, '')
    .toLowerCase()
}

/**
 * 校验模型 URL 是否在当前运行环境中可用，并返回规范化的目标 URL。
 * 若 stored 路径与主进程扫描到的模型匹配（无论是否带 uta:// 或 URL 编码差异），
 * 均返回可用的规范 URL；若无法匹配则返回 null。
 */
export async function resolveUsableModelUrl(url: string): Promise<string | null> {
  if (!url) return null
  const models = await listAvailableModels()
  if (models.length === 0) {
    // 强制重扫一次主进程，避免启动早期 IPC 时差导致的空列表
    const rescanned = await listAvailableModels(true)
    const exact = rescanned.find((m) => m.url === url)
    if (exact) return exact.url
    const key = normalizeModelKey(url)
    const matched = rescanned.find((m) => normalizeModelKey(m.url) === key)
    if (matched) return matched.url
  } else {
    const exact = models.find((m) => m.url === url)
    if (exact) return exact.url
    const key = normalizeModelKey(url)
    const matched = models.find((m) => normalizeModelKey(m.url) === key)
    if (matched) return matched.url
  }

  // utaAPI 不可用（纯浏览器调试）时退回 GET + JSON 嗅探：
  try {
    const resp = await fetch(url, { cache: 'no-cache' })
    if (!resp.ok) return null
    const text = await resp.text()
    if (text.trimStart().startsWith('{')) return url
    return null
  } catch {
    return null
  }
}

/**
 * 判断模型 URL 是否真的可加载。
 */
export async function modelUrlUsable(url: string): Promise<boolean> {
  return (await resolveUsableModelUrl(url)) !== null
}

/**
 * 归一化模型路径，只接受渲染层真正能加载的相对 URL。
 *
 * 旧版设置面板是个自由输入框，很容易被填成绝对路径
 * （例如 D:\...\src\renderer\public\models\ariu_vts\ariu.model3.json）。
 * 这种值在 http:// 页面里永远加载不了（Electron 也会拦 file://），
 * 也就是说它从来没有真正生效过 —— 所以直接丢弃，而不是猜测用户想选哪个模型。
 */
export function normalizeModelPath(raw: string): string {
  const value = raw.trim().replace(/\\/g, '/')
  if (!value) return ''

  // 打包模式下主进程通过自定义协议提供模型，这类 URL 原样放行
  if (value.startsWith('uta://') || value.startsWith('deskpet://')) return value

  const isAbsolute = /^[a-zA-Z]:\//.test(value) || value.startsWith('/') || /^[a-z]+:\/\//i.test(value)
  if (isAbsolute) {
    console.warn(`[ModelDiscovery] Ignoring absolute model path (never loadable): ${raw}`)
    return ''
  }

  if (value.startsWith('./')) return value
  if (value.startsWith('models/')) return `./${value}`
  return `./${value.replace(/^\.?\//, '')}`
}

export function getStoredModelPath(): string {
  try {
    const raw = localStorage.getItem(MODEL_PATH_KEY) || ''
    if (!raw) return ''

    // 顺手把旧格式洗掉，免得每次启动都重复归一化和告警
    const normalized = normalizeModelPath(raw)
    if (!normalized) {
      localStorage.removeItem(MODEL_PATH_KEY)
    } else if (normalized !== raw) {
      localStorage.setItem(MODEL_PATH_KEY, normalized)
    }
    return normalized
  } catch {
    return ''
  }
}

export function setStoredModelPath(url: string): void {
  try {
    const normalized = normalizeModelPath(url)
    if (normalized) {
      localStorage.setItem(MODEL_PATH_KEY, normalized)
      rememberModelForKind(normalized)
    } else {
      localStorage.removeItem(MODEL_PATH_KEY)
    }
  } catch {
    // localStorage 被禁用时静默失败，本次会话仍可正常切换
  }
}

/** 列出 public/models/ 下所有可用模型，供设置面板下拉框使用。 */
export async function listAvailableModels(forceRescan = false): Promise<ModelEntry[]> {
  if (cachedModelList && !forceRescan) return cachedModelList
  try {
    cachedModelList = ((await window.utaAPI?.listModels()) ?? []) as ModelEntry[]
  } catch (err) {
    // 失败绝不写缓存：否则一次 IPC 抖动会让设置面板此后一直显示「没有模型」，
    // 除非强制重扫才能恢复。
    console.warn('[ModelDiscovery] list-models failed:', err)
    return []
  }
  return cachedModelList
}

export async function discoverModel(): Promise<string> {
  if (cachedModelUrl) return cachedModelUrl

  let missingStored = ''
  const stored = getStoredModelPath()
  if (stored) {
    const usableUrl = await resolveUsableModelUrl(stored)
    if (usableUrl) {
      cachedModelUrl = usableUrl
      if (usableUrl !== stored) {
        setStoredModelPath(usableUrl)
      } else {
        rememberModelForKind(usableUrl)
      }
      return cachedModelUrl
    }
    // 哪怕某次检测暂时未命中（如主进程首帧 IPC 延迟），也绝不擦除用户的配置，
    // 仅在当前会话平滑回退，避免造成永久性偏好丢失。
    console.warn(`[ModelDiscovery] Stored model not currently found, falling back without wiping: ${stored}`)
    missingStored = stored
  }

  const fallbackName = (url: string): string => url.split(/[\\/]/).filter(Boolean).pop() ?? ''
  const noticeFallback = (url: string): void => {
    if (!missingStored) return
    fallbackNotice = `原来的角色「${fallbackName(missingStored)}」找不到了，这次先显示「${fallbackName(url)}」。`
      + '可在设置 → 角色与动作里重新选择。'
  }

  const defaultUrl = await resolveUsableModelUrl(MODEL_PATH)
  if (defaultUrl) {
    cachedModelUrl = defaultUrl
    // 临时回退不能覆盖用户原本按展示模式记住的选择
    if (!missingStored) rememberModelForKind(defaultUrl)
    noticeFallback(defaultUrl)
    return cachedModelUrl
  }
  console.warn(`[ModelDiscovery] Default model missing: ${MODEL_PATH}`)

  const models = await listAvailableModels(true)
  if (models.length > 0) {
    cachedModelUrl = models[0].url
    if (!missingStored) rememberModelForKind(cachedModelUrl)
    noticeFallback(cachedModelUrl)
    console.log(`[ModelDiscovery] Found model by scan: ${cachedModelUrl}`)
    return cachedModelUrl
  }

  console.warn('[ModelDiscovery] No model found in models directory')
  return ''
}

let fallbackNotice = ''

/** 取走一次“原角色缺失、已临时换人”的提示；桌宠窗口负责展示。 */
export function consumeModelFallbackNotice(): string {
  const notice = fallbackNotice
  fallbackNotice = ''
  return notice
}

export function clearModelCache(): void {
  cachedModelUrl = null
  cachedModelList = null
}
