import type { DailyTodoState } from '../../shared/daily-todo-contracts'

/**
 * “到点”标签与角标只统计真正到点、且没有被用户推迟的条目。
 * 推迟中的条目仍保留在 state.unhandledIds 里（不丢失），但不再催人。
 */
export function dueUnhandledIds(state: DailyTodoState | null, now = Date.now()): string[] {
  if (!state) return []
  const unhandled = new Set(state.unhandledIds)
  return state.items
    .filter(item => unhandled.has(item.id) &&
      !(item.snoozedUntil !== undefined && item.snoozedUntil > now))
    .map(item => item.id)
}
