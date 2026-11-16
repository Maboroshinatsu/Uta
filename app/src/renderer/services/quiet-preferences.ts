export interface QuietPreferences {
  idleActionsEnabled: boolean
  ttsSpeakNarration: boolean
}

const KEY = 'uta:before-quiet-mode'
let memory: QuietPreferences | undefined

/** 两个窗口共用同一份恢复记录；退出安静模式不擅自开启原本关闭的解说。 */
export function toggleQuietPreferences(current: QuietPreferences, enabled: boolean): QuietPreferences {
  if (enabled) {
    if (!current.idleActionsEnabled && !current.ttsSpeakNarration) return { ...current }
    memory = { idleActionsEnabled: current.idleActionsEnabled, ttsSpeakNarration: current.ttsSpeakNarration }
    try { localStorage.setItem(KEY, JSON.stringify(memory)) } catch { /* this window can still restore */ }
    return { idleActionsEnabled: false, ttsSpeakNarration: false }
  }
  let previous = memory
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (saved && typeof saved.idleActionsEnabled === 'boolean' && typeof saved.ttsSpeakNarration === 'boolean') previous = saved
    localStorage.removeItem(KEY)
  } catch { /* use the in-memory choice or conservative defaults */ }
  memory = undefined
  return previous ?? { idleActionsEnabled: true, ttsSpeakNarration: false }
}
