import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { sanitizeText } from './runtime-commands'
import type {
  DailyMutationResult,
  DailyRepeat,
  DailyTodoItem,
  DailyTodoState,
  DailyStoreError,
} from '../shared/daily-todo-contracts'

const MAX_ITEMS = 200
const MAX_TEXT = 200
const MAX_FILE_BYTES = 1024 * 1024
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/

interface DailyDocument {
  version: 1
  reminderSound: boolean
  items: DailyTodoItem[]
}

function validTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function validDailyItem(value: unknown): value is DailyTodoItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const repeat = item.repeat === 'daily' ? 'daily' : item.repeat === 'none' ? 'none' : null
  const remindAtOk = item.remindAt === undefined || validTime(item.remindAt)
  const lastOk = item.lastRemindedAt === undefined || validTime(item.lastRemindedAt)
  const resetOk = item.resetDaily === undefined || typeof item.resetDaily === 'boolean'
  const snoozeOk = item.snoozedUntil === undefined || validTime(item.snoozedUntil)
  return typeof item.id === 'string' && ID_PATTERN.test(item.id) &&
    typeof item.text === 'string' && item.text.length > 0 && item.text.length <= MAX_TEXT &&
    (item.status === 'pending' || item.status === 'completed') &&
    validTime(item.createdAt) && validTime(item.updatedAt) &&
    (item.completedAt === undefined || validTime(item.completedAt)) &&
    repeat !== null && remindAtOk && lastOk && resetOk && snoozeOk
}

function cleanItem(item: DailyTodoItem): DailyTodoItem {
  return {
    id: item.id,
    text: item.text,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(item.completedAt !== undefined ? { completedAt: item.completedAt } : {}),
    ...(item.remindAt !== undefined ? { remindAt: item.remindAt } : {}),
    repeat: item.repeat === 'daily' ? 'daily' : 'none',
    ...(item.resetDaily === true ? { resetDaily: true } : {}),
    ...(item.snoozedUntil !== undefined ? { snoozedUntil: item.snoozedUntil } : {}),
    ...(item.lastRemindedAt !== undefined ? { lastRemindedAt: item.lastRemindedAt } : {}),
  }
}

/**
 * 每天重复的提醒只按 HH:mm 触发；保存时把锚点归一到“下一次发生”。
 * 这样设置一个已经过去的今天时间不会立刻触发，而是排到明天。
 */
export function normalizeDailyAnchor(remindAt: number, now: number): number {
  const base = new Date(remindAt)
  const next = new Date(now)
  next.setHours(base.getHours(), base.getMinutes(), 0, 0)
  if (next.getTime() <= now) next.setDate(next.getDate() + 1)
  return next.getTime()
}

export function isDailyReminderDue(item: DailyTodoItem, now: number): boolean {
  if (item.status === 'completed' || item.remindAt === undefined || now < item.remindAt) return false
  if (item.snoozedUntil !== undefined) {
    if (item.snoozedUntil > now) return false
    return (item.lastRemindedAt ?? 0) < item.snoozedUntil
  }
  const dueAt = currentOccurrence(item, now)
  if (dueAt === null || now < dueAt) return false
  return (item.lastRemindedAt ?? 0) < dueAt
}

/** 当前这一轮提醒应触发的时间；每天重复取今天的 HH:mm，一次性就是原定时间。 */
export function currentOccurrence(item: DailyTodoItem, now: number): number | null {
  if (item.remindAt === undefined) return null
  if (item.repeat !== 'daily') return item.remindAt
  const base = new Date(item.remindAt)
  const occurrence = new Date(now)
  occurrence.setHours(base.getHours(), base.getMinutes(), 0, 0)
  return Math.max(occurrence.getTime(), item.remindAt)
}

export function dueDailyReminders(items: readonly DailyTodoItem[], now: number): DailyTodoItem[] {
  return items.filter(item => isDailyReminderDue(item, now))
}

/** 到点但没完成的项；推迟中的也算，因为它确实还没处理。 */
export function unhandledDailyReminderIds(items: readonly DailyTodoItem[], now: number): string[] {
  return items
    .filter(item => {
      if (item.status === 'completed') return false
      const dueAt = currentOccurrence(item, now)
      if (dueAt === null || item.remindAt === undefined || now < item.remindAt) return false
      // An earlier occurrence remains unhandled across midnight until completed.
      const wasReminded = item.lastRemindedAt !== undefined &&
        item.lastRemindedAt >= item.remindAt && item.lastRemindedAt <= now
      return now >= dueAt || wasReminded || item.snoozedUntil !== undefined
    })
    .map(item => item.id)
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** 开启“第二天重新出现”的每天待办，在下一个提醒日回到未完成。 */
export function shouldResetDailyItem(item: DailyTodoItem, now: number): boolean {
  if (item.resetDaily !== true || item.repeat !== 'daily' || item.status !== 'completed') return false
  const dueAt = currentOccurrence(item, now)
  if (dueAt === null || now < dueAt) return false
  const completedAt = item.completedAt ?? item.updatedAt
  return startOfDay(completedAt) < startOfDay(dueAt)
}

function sortItems(items: readonly DailyTodoItem[]): DailyTodoItem[] {
  const pending = items.filter(item => item.status === 'pending')
  const completed = items.filter(item => item.status === 'completed')
  pending.sort((a, b) => {
    const aTime = a.remindAt ?? Number.POSITIVE_INFINITY
    const bTime = b.remindAt ?? Number.POSITIVE_INFINITY
    if (aTime !== bTime) return aTime - bTime
    return a.createdAt - b.createdAt
  })
  completed.sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt))
  return [...pending, ...completed]
}

/** 日常待办按 profile 单独保存；与项目待办、宿主计划互不影响。 */
export function createDailyTodoStore(
  directory: string,
  options: { now?: () => number; randomId?: () => string } = {},
) {
  const now = options.now ?? (() => Date.now())
  const randomId = options.randomId ?? (() => randomUUID())
  const file = path.join(directory, 'daily-todos.v1.json')
  let items: DailyTodoItem[] = []
  let reminderSound = false
  let error: DailyStoreError | null = null

  fs.mkdirSync(directory, { recursive: true })
  read()

  function read(): void {
    try {
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) {
        error = 'invalid'
        items = []
        return
      }
      const raw = fs.readFileSync(file, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        error = 'invalid'
        items = []
        return
      }
      const doc = parsed as Record<string, unknown>
      if (typeof doc.version === 'number' && doc.version > 1) {
        error = 'future-version'
        items = []
        return
      }
      if (doc.version !== 1 || !Array.isArray(doc.items) || doc.items.length > MAX_ITEMS ||
          !doc.items.every(validDailyItem)) {
        error = 'invalid'
        items = []
        return
      }
      items = (doc.items as DailyTodoItem[]).map(cleanItem)
      reminderSound = doc.reminderSound === true
      error = null
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        items = []
        reminderSound = false
        error = null
        return
      }
      items = []
      error = 'unreadable'
    }
  }

  function persist(nextItems: readonly DailyTodoItem[], nextSound = reminderSound): boolean {
    if (error) return false
    const doc: DailyDocument = { version: 1, reminderSound: nextSound, items: nextItems.map(cleanItem) }
    const serialized = JSON.stringify(doc)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_FILE_BYTES) return false
    const temp = path.join(directory, `.daily-todos.${randomUUID()}.tmp`)
    try {
      const fd = fs.openSync(temp, 'wx', 0o600)
      try {
        fs.writeFileSync(fd, serialized, 'utf8')
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      fs.renameSync(temp, file)
      items = nextItems.map(cleanItem)
      reminderSound = nextSound
      return true
    } catch {
      try { fs.unlinkSync(temp) } catch { /* scratch file may not exist */ }
      return false
    }
  }

  function state(): DailyTodoState {
    return {
      items: sortItems(items),
      reminderSound,
      error,
      unhandledIds: unhandledDailyReminderIds(items, now()),
    }
  }

  function failure(message: string): DailyMutationResult {
    return { ok: false, error: message, state: state() }
  }

  function normalizeReminder(
    remindAt: number | null | undefined,
    repeat: DailyRepeat,
  ): { remindAt?: number } | { error: string } {
    if (remindAt === null || remindAt === undefined) return {}
    if (!validTime(remindAt)) return { error: '提醒时间无效。' }
    return { remindAt: repeat === 'daily' ? normalizeDailyAnchor(remindAt, now()) : remindAt }
  }

  function addItem(input: {
    text: string
    remindAt?: number | null
    repeat?: DailyRepeat
    resetDaily?: boolean
  }): DailyMutationResult {
    if (error) return failure('日常待办文件当前不可写，请先检查本机数据。')
    const text = sanitizeText(input.text, MAX_TEXT)
    if (!text) return failure('待办内容不能为空。')
    if (items.length >= MAX_ITEMS) return failure('日常待办已达上限，请先清理已完成项。')
    const repeat: DailyRepeat = input.repeat === 'daily' ? 'daily' : 'none'
    if (repeat === 'daily' && (input.remindAt === null || input.remindAt === undefined)) {
      return failure('每天重复需要设置提醒时间。')
    }
    const reminder = normalizeReminder(input.remindAt, repeat)
    if ('error' in reminder) return failure(reminder.error)
    const timestamp = now()
    const next = [...items, {
      id: randomId(),
      text,
      status: 'pending' as const,
      createdAt: timestamp,
      updatedAt: timestamp,
      repeat,
      ...(repeat === 'daily' && input.resetDaily === true ? { resetDaily: true } : {}),
      ...(reminder.remindAt !== undefined ? { remindAt: reminder.remindAt } : {}),
    }]
    if (!persist(next)) return failure('日常待办保存失败，原文件未被覆盖。')
    return { ok: true, state: state() }
  }

  function updateItem(input: {
    id: string
    text?: string
    status?: 'pending' | 'completed'
    remindAt?: number | null
    repeat?: DailyRepeat
    resetDaily?: boolean
  }): DailyMutationResult {
    if (error) return failure('日常待办文件当前不可写，请先检查本机数据。')
    const index = items.findIndex(item => item.id === input.id)
    if (index < 0) return failure('待办条目不存在。')
    const current = items[index]
    const text = input.text === undefined ? current.text : sanitizeText(input.text, MAX_TEXT)
    if (!text) return failure('待办内容不能为空。')
    const status = input.status === 'completed' ? 'completed' : input.status === 'pending' ? 'pending' : current.status
    const repeat: DailyRepeat = input.repeat === undefined
      ? current.repeat
      : input.repeat === 'daily' ? 'daily' : 'none'
    const resetDaily = input.resetDaily === undefined
      ? current.resetDaily === true
      : input.resetDaily === true
    const nextRemindAt = input.remindAt === undefined ? current.remindAt : input.remindAt
    if (repeat === 'daily' && (nextRemindAt === null || nextRemindAt === undefined)) {
      return failure('每天重复需要设置提醒时间。')
    }
    const reminder = input.remindAt === undefined && input.repeat === undefined
      ? { remindAt: nextRemindAt ?? undefined }
      : normalizeReminder(nextRemindAt, repeat)
    if ('error' in reminder) return failure(reminder.error)
    const timestamp = now()
    const nextItem: DailyTodoItem = {
      ...current,
      text,
      status,
      repeat,
      updatedAt: timestamp,
      ...(status === 'completed' ? { completedAt: current.completedAt ?? timestamp } : {}),
    }
    if (status !== 'completed') delete nextItem.completedAt
    if (resetDaily && repeat === 'daily') nextItem.resetDaily = true
    else delete nextItem.resetDaily
    if (reminder.remindAt !== undefined) nextItem.remindAt = reminder.remindAt
    else delete nextItem.remindAt
    if (status === 'completed' || input.remindAt !== undefined || input.repeat !== undefined) {
      delete nextItem.snoozedUntil
    }
    if (input.remindAt !== undefined || input.repeat !== undefined) delete nextItem.lastRemindedAt
    const next = items.map((item, itemIndex) => itemIndex === index ? nextItem : item)
    if (!persist(next)) return failure('日常待办保存失败，原文件未被覆盖。')
    return { ok: true, state: state() }
  }

  function deleteItem(id: string): DailyMutationResult {
    if (error) return failure('日常待办文件当前不可写，请先检查本机数据。')
    if (!items.some(item => item.id === id)) return failure('待办条目不存在。')
    const next = items.filter(item => item.id !== id)
    if (!persist(next)) return failure('日常待办保存失败，原文件未被覆盖。')
    return { ok: true, state: state() }
  }

  function clearCompleted(): DailyMutationResult {
    if (error) return failure('日常待办文件当前不可写，请先检查本机数据。')
    // 每天重新出现的条目不算“完成”，不能被一键清掉
    const next = items.filter(item =>
      item.status !== 'completed' || (item.resetDaily === true && item.repeat === 'daily'))
    if (next.length === items.length) return { ok: true, state: state() }
    if (!persist(next)) return failure('日常待办保存失败，原文件未被覆盖。')
    return { ok: true, state: state() }
  }

  function snoozeItem(input: { id: string; minutes: number }): DailyMutationResult {
    if (error) return failure('日常待办文件当前不可写，请先检查本机数据。')
    if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 1440) {
      return failure('稍后提醒需要 1 到 1440 分钟。')
    }
    const index = items.findIndex(item => item.id === input.id)
    if (index < 0) return failure('待办条目不存在。')
    const current = items[index]
    if (current.remindAt === undefined) return failure('这条待办没有设置提醒。')
    if (current.status === 'completed') return failure('这条待办已经完成。')
    const timestamp = now()
    const next = items.map((item, itemIndex) => itemIndex === index
      ? { ...item, snoozedUntil: timestamp + input.minutes * 60_000, updatedAt: timestamp }
      : item)
    if (!persist(next)) return failure('日常待办保存失败，原文件未被覆盖。')
    return { ok: true, state: state() }
  }

  /** 把开启“每天重新出现”的已完成条目翻回未完成；返回是否写盘。 */
  function applyDailyRecurrence(): boolean {
    if (error) return false
    const timestamp = now()
    let changed = false
    const next = items.map(item => {
      if (!shouldResetDailyItem(item, timestamp)) return item
      changed = true
      const updated: DailyTodoItem = { ...item, status: 'pending', updatedAt: timestamp }
      delete updated.completedAt
      delete updated.snoozedUntil
      return updated
    })
    if (!changed) return false
    return persist(next)
  }

  function markReminded(ids: readonly string[], at = now()): boolean {
    if (error) return false
    const target = new Set(ids)
    if (target.size === 0) return true
    let changed = false
    const next = items.map(item => {
      if (!target.has(item.id)) return item
      changed = true
      const updated: DailyTodoItem = { ...item, lastRemindedAt: at }
      delete updated.snoozedUntil
      return updated
    })
    if (!changed) return true
    return persist(next)
  }

  function setReminderSound(enabled: boolean): DailyMutationResult {
    if (error) return failure('日常待办文件当前不可写，请先检查本机数据。')
    if (reminderSound === enabled) return { ok: true, state: state() }
    if (!persist(items, enabled)) return failure('日常待办保存失败，原文件未被覆盖。')
    return { ok: true, state: state() }
  }

  return {
    state,
    addItem,
    updateItem,
    deleteItem,
    clearCompleted,
    snoozeItem,
    applyDailyRecurrence,
    markReminded,
    setReminderSound,
    reload: read,
  }
}

export type DailyTodoStore = ReturnType<typeof createDailyTodoStore>
