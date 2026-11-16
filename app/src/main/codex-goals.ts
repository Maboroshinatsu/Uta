import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { HostPlanItem, TodoStatus } from '../shared/todo-contracts'

export interface CodexGoalResult {
  title: string
  items: HostPlanItem[]
  status: string
  updatedAt: number
}

function cleanText(text: unknown): string {
  if (typeof text !== 'string') return ''
  return text
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

export function parseCodexObjective(
  objective: string,
  goalStatus = 'pending',
): { title: string; items: HostPlanItem[] } {
  const lines = String(objective || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    return { title: '会话目标', items: [] }
  }

  const stepPattern = /^(?:(?:\d+[\.、\)]|[-*]|\[[\sxX]\])\s*)+(.*)$/
  const titleLines: string[] = []
  const stepLines: Array<{ text: string; completed: boolean }> = []
  let inSteps = false

  for (const line of lines) {
    if (/^(?:步骤|tasks|steps|todo|计划)[:：]?$/i.test(line)) {
      inSteps = true
      continue
    }
    const match = stepPattern.exec(line)
    if (match) {
      inSteps = true
      const isDone = /\[[xX]\]/.test(line)
      const text = cleanText(match[1])
      if (text) stepLines.push({ text, completed: isDone })
    } else if (!inSteps) {
      titleLines.push(line)
    } else {
      const isDone = /\[[xX]\]/.test(line)
      const text = cleanText(line)
      if (text) stepLines.push({ text, completed: isDone })
    }
  }

  const title = titleLines.join(' · ').slice(0, 120) || cleanText(stepLines[0]?.text) || '会话目标'

  const items: HostPlanItem[] = stepLines.map((step, idx) => {
    let status: TodoStatus = 'pending'
    if (step.completed || goalStatus === 'completed') {
      status = 'completed'
    } else if (idx === 0 && (goalStatus === 'active' || goalStatus === 'in_progress')) {
      status = 'in_progress'
    }
    return {
      text: step.text,
      status,
    }
  })

  // If no numbered steps were found, the entire objective acts as the single step
  if (items.length === 0 && lines.length > 0) {
    items.push({
      text: cleanText(lines[0]),
      status: goalStatus === 'completed' ? 'completed' : 'pending',
    })
  }

  return { title, items }
}

function readCodexGoalFromDatabase(sessionId: string): { goal: CodexGoalResult | null; failed: boolean } {
  const dbPath = path.join(os.homedir(), '.codex', 'goals_1.sqlite')
  if (!fs.existsSync(dbPath)) return { goal: null, failed: false }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (
        filename: string,
        options?: { open?: boolean; readOnly?: boolean },
      ) => {
        prepare: (query: string) => {
          all: (...args: unknown[]) => unknown[]
        }
        close: () => void
      }
    }
    const db = new DatabaseSync(dbPath, { open: true, readOnly: true })
    try {
      const query = `
        SELECT objective, status, updated_at_ms
        FROM thread_goals
        WHERE thread_id = ? OR thread_id LIKE ?
        ORDER BY updated_at_ms DESC
        LIMIT 1
      `
      const stmt = db.prepare(query)
      const rows = stmt.all(sessionId, `%${sessionId}`) as Array<{
        objective: string
        status: string
        updated_at_ms: number
      }>
      if (!rows || rows.length === 0) return { goal: null, failed: false }
      const row = rows[0]
      const { title, items } = parseCodexObjective(row.objective, row.status)
      return {
        goal: {
          title,
          items,
          status: row.status,
          updatedAt: Number(row.updated_at_ms) || Date.now(),
        },
        failed: false,
      }
    } finally {
      try {
        db.close()
      } catch {
        /* close safe */
      }
    }
  } catch {
    // Electron 的 Node 没有 node:sqlite；由调用方回落到会话转录，并只在两者都失败时提示一次。
    return { goal: null, failed: true }
  }
}

interface TranscriptGoalEvent {
  objective: string
  status: string
  updatedAtMs: number
}

const TRANSCRIPT_SCAN_CHUNK = 256 * 1024
// 目标事件通常落在会话末尾；给历史大文件设上限，避免同步 IO 长时间阻塞主进程
const TRANSCRIPT_SCAN_LIMIT = 8 * 1024 * 1024
const transcriptCache = new Map<string, { file: string; mtimeMs: number; size: number; goal: CodexGoalResult | null }>()
const warnedSessions = new Set<string>()

/** 转录文件名以线程 id 结尾（rollout-<时间>-<threadId>.jsonl），按文件名定位即可。 */
function locateTranscript(dir: string, sessionId: string): string | null {
  let best: string | null = null
  let bestMtime = -1
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop() as string
    let entries: Array<{ name: string; isDirectory: () => boolean }>
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.name.endsWith('.jsonl') || !entry.name.includes(sessionId)) continue
      try {
        const mtime = fs.statSync(full).mtimeMs
        if (mtime > bestMtime) {
          bestMtime = mtime
          best = full
        }
      } catch {
        /* 扫描期间文件可能被清理 */
      }
    }
  }
  return best
}

function parseTranscriptGoal(line: string, sessionId: string): TranscriptGoalEvent | null {
  if (!line.includes('thread_goal_updated')) return null
  let event: any
  try {
    event = JSON.parse(line)
  } catch {
    return null
  }
  const goal = event?.payload?.goal
  if (!goal || typeof goal.objective !== 'string' || !goal.objective.trim()) return null
  if (typeof goal.threadId === 'string' && goal.threadId && goal.threadId !== sessionId) return null
  const seconds = Number(goal.updatedAt ?? goal.createdAt)
  return {
    objective: goal.objective,
    status: typeof goal.status === 'string' && goal.status ? goal.status : 'pending',
    updatedAtMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now(),
  }
}

/** 从文件末尾向前读，取最后一条 thread_goal_updated；避免整份大转录的线性解析。 */
function readLastTranscriptGoal(file: string, sessionId: string): TranscriptGoalEvent | null {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    let offset = size
    let carry = ''
    let scanned = 0
    while (offset > 0 && scanned < TRANSCRIPT_SCAN_LIMIT) {
      const length = Math.min(TRANSCRIPT_SCAN_CHUNK, offset)
      offset -= length
      const buffer = Buffer.alloc(length)
      fs.readSync(fd, buffer, 0, length, offset)
      const lines = (buffer.toString('utf8') + carry).split('\n')
      // 首个片段是被更早字节截断的半行，留给下一轮（更靠前的块）拼接
      carry = lines.shift() ?? ''
      for (let i = lines.length - 1; i >= 0; i--) {
        const goal = parseTranscriptGoal(lines[i], sessionId)
        if (goal) return goal
      }
      scanned += length
    }
    if (scanned >= TRANSCRIPT_SCAN_LIMIT) return null
    return parseTranscriptGoal(carry, sessionId)
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        /* close safe */
      }
    }
  }
}

function readCodexGoalFromTranscript(sessionId: string): CodexGoalResult | null {
  if (sessionId.length > 200 || !/^[A-Za-z0-9-]+$/.test(sessionId)) return null
  const root = path.join(os.homedir(), '.codex', 'sessions')
  if (!fs.existsSync(root)) return null

  const cached = transcriptCache.get(sessionId)
  const file = cached && fs.existsSync(cached.file) ? cached.file : locateTranscript(root, sessionId)
  if (!file) {
    transcriptCache.delete(sessionId)
    return null
  }

  let stat: ReturnType<typeof fs.statSync>
  try {
    stat = fs.statSync(file)
  } catch {
    return null
  }
  if (cached && cached.file === file && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.goal
  }

  const event = readLastTranscriptGoal(file, sessionId)
  const goal = event
    ? (() => {
        const { title, items } = parseCodexObjective(event.objective, event.status)
        return { title, items, status: event.status, updatedAt: event.updatedAtMs }
      })()
    : null
  transcriptCache.set(sessionId, { file, mtimeMs: stat.mtimeMs, size: stat.size, goal })
  return goal
}

export function readCodexSessionGoal(sessionId: string): CodexGoalResult | null {
  if (!sessionId) return null
  const fromDatabase = readCodexGoalFromDatabase(sessionId)
  if (fromDatabase.goal) return fromDatabase.goal

  const fromTranscript = readCodexGoalFromTranscript(sessionId)
  if (fromTranscript) return fromTranscript

  if (fromDatabase.failed && !warnedSessions.has(sessionId)) {
    warnedSessions.add(sessionId)
    console.warn('[codex-goals] sqlite 不可用，且会话转录中没有找到目标；Codex 待办将为空:', sessionId)
  }
  return null
}
