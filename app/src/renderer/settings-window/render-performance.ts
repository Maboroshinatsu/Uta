export type RenderFpsMode = '30' | '60' | '120' | 'auto'

export const RENDER_FPS_STORAGE_KEY = 'uta/render-fps-mode'
export const ADAPTIVE_IDLE_STORAGE_KEY = 'uta/adaptive-idle-fps'
export const RENDER_FPS_MODES: ReadonlyArray<RenderFpsMode> = ['30', '60', '120', 'auto']

/** The pet renderer owns frame pacing; the settings window shares the same
 * localStorage preference keys and asks the user to reload the pet window. */
export function readRenderFpsMode(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): RenderFpsMode {
  try {
    const raw = storage?.getItem(RENDER_FPS_STORAGE_KEY)
    if (raw && (RENDER_FPS_MODES as ReadonlyArray<string>).includes(raw)) return raw as RenderFpsMode
  } catch {
    // Ignore storage access failures and keep the default.
  }
  return '60'
}

export function writeRenderFpsMode(mode: RenderFpsMode, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): boolean {
  if (!storage) return false
  try {
    storage.setItem(RENDER_FPS_STORAGE_KEY, mode)
    return true
  } catch {
    return false
  }
}

export function readAdaptiveIdle(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): boolean {
  try {
    return storage?.getItem(ADAPTIVE_IDLE_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function writeAdaptiveIdle(enabled: boolean, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): boolean {
  if (!storage) return false
  try {
    storage.setItem(ADAPTIVE_IDLE_STORAGE_KEY, String(enabled))
    return true
  } catch {
    return false
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}
