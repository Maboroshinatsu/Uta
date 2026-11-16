export type DailyTodoStatus = 'pending' | 'completed'
export type DailyRepeat = 'none' | 'daily'

export interface DailyTodoItem {
  id: string
  text: string
  status: DailyTodoStatus
  createdAt: number
  updatedAt: number
  completedAt?: number
  remindAt?: number
  repeat: DailyRepeat
  /** 每天重复时，完成到下一次提醒时间后自动回到未完成；默认关闭。 */
  resetDaily?: boolean
  /** 本次提醒被推迟到的时刻；“完成”或再次修改提醒时间会清掉。 */
  snoozedUntil?: number
  lastRemindedAt?: number
}

export type DailyStoreError = 'unreadable' | 'invalid' | 'future-version'

export interface DailyTodoState {
  items: DailyTodoItem[]
  reminderSound: boolean
  error: DailyStoreError | null
  /** 已到点但没有完成的项，用来做角标和“到点未处理”列表。 */
  unhandledIds: string[]
}

export interface DailyAddItemInput {
  text: string
  remindAt?: number | null
  repeat?: DailyRepeat
  resetDaily?: boolean
}

export interface DailyUpdateItemInput {
  id: string
  text?: string
  status?: DailyTodoStatus
  remindAt?: number | null
  repeat?: DailyRepeat
  resetDaily?: boolean
}

export interface DailySnoozeInput {
  id: string
  minutes: number
}

export interface DailySendInput {
  hostId: string
  items: Array<{ id: string; text: string }>
}

export type DailyMutationResult =
  | { ok: true; state: DailyTodoState }
  | { ok: false; error: string; state: DailyTodoState }

export interface DailyReminderPayload {
  items: Array<{ id: string; text: string; dueAt: number; repeat: DailyRepeat }>
  sound: boolean
}
