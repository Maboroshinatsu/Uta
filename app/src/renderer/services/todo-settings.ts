import { reactive, watch } from 'vue'
import type { ReminderSoundType } from './reminder-chime'

export interface TodoSettings {
  soundType: ReminderSoundType
  reminderPreset: string
  bubbleDurationSec: number
}

const STORAGE_KEY = 'uta:todo-settings:v1'

const DEFAULT_TODO_SETTINGS: TodoSettings = {
  soundType: 'chime',
  reminderPreset: '好奇',
  bubbleDurationSec: 10,
}

export function loadTodoSettings(): TodoSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_TODO_SETTINGS }
    const parsed = JSON.parse(raw)
    return {
      soundType: (parsed.soundType === 'drop' || parsed.soundType === 'knock' || parsed.soundType === 'ding' || parsed.soundType === 'chime')
        ? parsed.soundType
        : DEFAULT_TODO_SETTINGS.soundType,
      reminderPreset: typeof parsed.reminderPreset === 'string' && parsed.reminderPreset.trim()
        ? parsed.reminderPreset.trim()
        : DEFAULT_TODO_SETTINGS.reminderPreset,
      bubbleDurationSec: typeof parsed.bubbleDurationSec === 'number' && parsed.bubbleDurationSec > 0
        ? Math.min(60, Math.max(3, parsed.bubbleDurationSec))
        : DEFAULT_TODO_SETTINGS.bubbleDurationSec,
    }
  } catch {
    return { ...DEFAULT_TODO_SETTINGS }
  }
}

export function saveTodoSettings(settings: Partial<TodoSettings>): void {
  try {
    const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const next = { ...current, ...settings }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore storage quota */
  }
}

export function legacySoundDisabled(): boolean {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')?.soundEnabled === false
  } catch {
    return false
  }
}

/** Preserve the previous effective mute before retiring the local switch. */
export async function migrateLegacySoundSetting(api: Window['utaAPI'] | undefined): Promise<void> {
  try {
    const settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    if (!settings || !Object.hasOwn(settings, 'soundEnabled')) return
    if (!api?.getDailyState || !api.dailySetReminderSound) return
    if (settings.soundEnabled === false) {
      const state = await api.getDailyState()
      if (!state || state.error) return
      if (state.reminderSound && !(await api.dailySetReminderSound(false))?.ok) return
    }
    const latest = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    delete latest.soundEnabled
    localStorage.setItem(STORAGE_KEY, JSON.stringify(latest))
  } catch {
    // Leave the old mute in force if migration needs to be retried.
  }
}

let sharedState: TodoSettings | null = null

export function useTodoSettings() {
  if (!sharedState) {
    sharedState = reactive(loadTodoSettings())
    watch(sharedState, saveTodoSettings, { deep: true })
  }
  return sharedState
}
