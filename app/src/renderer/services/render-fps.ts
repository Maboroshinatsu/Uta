/**
 * 渲染刷新率偏好：30 / 60 / 120 / 自适应屏幕刷新率。
 * 偏好存在 localStorage，应用后统一设置 Pixi 的共享 Ticker。
 *
 * 另有一条“类 LTPO”的动态逻辑：有交互/动作时用所选上限，纯待机一段时间后
 * 降到 30fps 只画呼吸和眨眼；鼠标进入桌宠窗口会立刻升回上限。
 */
import { setRenderMaxFPS } from './live2d/loader'

export type RenderFpsMode = '30' | '60' | '120' | 'auto'

export const RENDER_FPS_MODES: readonly RenderFpsMode[] = ['30', '60', '120', 'auto'] as const

const STORAGE_KEY = 'uta/render-fps-mode'
const ADAPTIVE_KEY = 'uta/adaptive-idle-fps'
const DEFAULT_MODE: RenderFpsMode = '60'
/** 纯待机时的目标帧率 */
const IDLE_FPS = 30
/** 无交互多久后降帧（鼠标移动本身还会额外保持约 2 秒，合计约 5 秒） */
const IDLE_DELAY_MS = 3000

let baseFps = 60
let active = true
let adaptiveIdleEnabled = readAdaptiveFlag()
let idleTimer: ReturnType<typeof setTimeout> | null = null
/** 连续切换档位时，较慢的异步解析（尤其自适应 IPC）不得覆盖新选择 */
let applyEpoch = 0

function readAdaptiveFlag(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(ADAPTIVE_KEY) !== 'false'
    }
  } catch {}
  return true
}

export function getRenderFpsMode(): RenderFpsMode {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw && (RENDER_FPS_MODES as readonly string[]).includes(raw)) {
        return raw as RenderFpsMode
      }
    }
  } catch {}
  return DEFAULT_MODE
}

export function setRenderFpsMode(mode: RenderFpsMode): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, mode)
    }
  } catch {}
}

export function getAdaptiveIdleEnabled(): boolean {
  return adaptiveIdleEnabled
}

export function setAdaptiveIdleEnabled(enabled: boolean): void {
  adaptiveIdleEnabled = enabled
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ADAPTIVE_KEY, String(enabled))
    }
  } catch {}
  clearIdleTimer()
  if (enabled && !active) {
    scheduleIdle()
  } else {
    applyNow()
  }
}

async function resolveAutoFps(): Promise<number> {
  try {
    const hz = await window.utaAPI?.getDisplayRefreshRate?.()
    if (typeof hz === 'number' && Number.isFinite(hz) && hz > 0) return hz
  } catch {
    /* 拿不到显示器刷新率时回到 60 */
  }
  return 60
}

export async function resolveRenderFps(mode: RenderFpsMode): Promise<number> {
  if (mode === 'auto') return resolveAutoFps()
  return Number(mode)
}

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

function applyNow(): void {
  const fps =
    adaptiveIdleEnabled && !active && baseFps > IDLE_FPS ? IDLE_FPS : baseFps
  setRenderMaxFPS(fps)
}

function scheduleIdle(): void {
  clearIdleTimer()
  if (!adaptiveIdleEnabled || active || baseFps <= IDLE_FPS) return
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (!active) applyNow()
  }, IDLE_DELAY_MS)
}

/**
 * 标记当前是否有需要高帧率的交互/动作。
 * true 会立刻恢复上限并取消降帧计时；false 会在延迟后降到空闲帧率。
 */
export function setRenderActivity(nextActive: boolean): void {
  if (nextActive) {
    active = true
    clearIdleTimer()
    applyNow()
    return
  }

  if (!active) return
  active = false
  if (adaptiveIdleEnabled && baseFps > IDLE_FPS) {
    scheduleIdle()
  } else {
    applyNow()
  }
}

/** 应用帧率偏好；返回实际应用的上限数值（自适应模式为屏幕刷新率） */
export async function applyRenderFpsMode(mode: RenderFpsMode = getRenderFpsMode()): Promise<number> {
  const epoch = ++applyEpoch
  const fps = await resolveRenderFps(mode)
  if (epoch !== applyEpoch) return baseFps
  baseFps = fps
  clearIdleTimer()
  applyNow()
  if (!active && adaptiveIdleEnabled && baseFps > IDLE_FPS) {
    scheduleIdle()
  }
  return baseFps
}
