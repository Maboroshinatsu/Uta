import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { sanitizeText } from './runtime-commands'
import { readCodexSessionGoal } from './codex-goals'
import type {
  HostPlanItem,
  HostPlanSnapshot,
  TodoItem,
  TodoProject,
  TodoState,
  TodoStoreError,
  TodoStatus,
} from '../shared/todo-contracts'

const MAX_PROJECTS = 100
const MAX_ITEMS_PER_PROJECT = 200
const MAX_HOST_PLANS = 100
const MAX_HOST_PLANS_PER_HOST = 30
const MAX_HOST_PLAN_ITEMS = 50
const MAX_TODO_TEXT = 200
const MAX_PATH = 500
const MAX_KEY = 700
const MAX_FILE_BYTES = 2 * 1024 * 1024
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/
const HOST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const SOURCE_PATTERN = /^[A-Za-z0-9._-]{1,40}$/

interface ProjectsDocument {
  version: 1
  projects: TodoProject[]
}

interface HostPlansDocument {
  version: 1
  plans: HostPlanSnapshot[]
}

export interface TodoStore {
  reload: () => void
  state: (activeHostId: string, activeSessionId: string, activeCwd: string) => TodoState
  applyHostSnapshot: (input: { hostId: string; sessionId: string; cwd: string; source: string; title?: string; items: unknown }) => boolean
  applyClaudeTaskDelta: (input: { sessionId: string; cwd?: string; action: 'create' | 'update'; id: string; text?: string; status?: TodoStatus | 'deleted' }) => boolean
}

export function normalizeTodoStatus(value: unknown): TodoStatus {
  return value === 'completed' || value === 'in_progress' || value === 'inProgress'
    ? value === 'inProgress' ? 'in_progress' : value
    : 'pending'
}

function cleanHostId(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return HOST_ID_PATTERN.test(text) ? text : ''
}

function cleanSource(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return SOURCE_PATTERN.test(text) ? text : 'host-plan'
}

function cleanPath(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text && text.length <= MAX_PATH ? text : ''
}

function workspacePath(raw: string): string {
  try {
    return path.resolve(raw)
  } catch {
    return raw
  }
}

function workspaceKey(rawCwd: string): string {
  const resolved = workspacePath(rawCwd).replace(/\\/g, '/')
  return `workspace:${process.platform === 'win32' ? resolved.toLowerCase() : resolved}`
}

function unidentifiedKey(hostId: string): string {
  return `unidentified:${cleanHostId(hostId) || 'unknown'}`
}

function projectLabel(rawCwd: string): string {
  const resolved = workspacePath(rawCwd)
  return (path.basename(resolved) || resolved || '未命名项目').slice(0, 120)
}

function validTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function validItem(value: unknown): value is TodoItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && ID_PATTERN.test(item.id) &&
    typeof item.text === 'string' && item.text.length > 0 && item.text.length <= MAX_TODO_TEXT &&
    (item.status === 'pending' || item.status === 'in_progress' || item.status === 'completed') &&
    validTime(item.createdAt) && validTime(item.updatedAt) &&
    (item.completedAt === undefined || validTime(item.completedAt))
}

export function validProject(value: unknown): value is TodoProject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const project = value as Record<string, unknown>
  return typeof project.key === 'string' && project.key.length > 0 && project.key.length <= MAX_KEY &&
    typeof project.path === 'string' && project.path.length <= MAX_PATH &&
    typeof project.label === 'string' && project.label.length > 0 && project.label.length <= 120 &&
    (project.hostId === undefined || (typeof project.hostId === 'string' && project.hostId.length <= 64)) &&
    typeof project.unidentified === 'boolean' &&
    Array.isArray(project.items) && project.items.length <= MAX_ITEMS_PER_PROJECT &&
    project.items.every(validItem) && validTime(project.updatedAt)
}

function validHostPlanItem(value: unknown): value is HostPlanItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.text === 'string' && item.text.length > 0 && item.text.length <= MAX_TODO_TEXT &&
    (item.id === undefined || (typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(item.id))) &&
    (item.status === 'pending' || item.status === 'in_progress' || item.status === 'completed')
}

function validHostPlan(value: unknown): value is HostPlanSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const plan = value as Record<string, unknown>
  return typeof plan.hostId === 'string' && HOST_ID_PATTERN.test(plan.hostId) &&
    typeof plan.sessionId === 'string' && plan.sessionId.length <= 200 &&
    typeof plan.cwd === 'string' && plan.cwd.length <= MAX_PATH &&
    typeof plan.source === 'string' && SOURCE_PATTERN.test(plan.source) &&
    (plan.title === undefined || typeof plan.title === 'string') &&
    (plan.partial === undefined || typeof plan.partial === 'boolean') &&
    Array.isArray(plan.items) && plan.items.length <= MAX_HOST_PLAN_ITEMS &&
    plan.items.every(validHostPlanItem) && validTime(plan.updatedAt)
}

function cleanItem(item: TodoItem): TodoItem {
  return {
    id: item.id,
    text: item.text,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(item.completedAt !== undefined ? { completedAt: item.completedAt } : {}),
  }
}

function cleanProject(project: TodoProject): TodoProject {
  return {
    key: project.key,
    path: project.path,
    label: project.label,
    ...(project.hostId ? { hostId: project.hostId } : {}),
    unidentified: project.unidentified,
    items: project.items.map(cleanItem),
    updatedAt: project.updatedAt,
  }
}

function cleanHostPlan(plan: HostPlanSnapshot): HostPlanSnapshot {
  return {
    hostId: plan.hostId,
    sessionId: plan.sessionId,
    cwd: plan.cwd,
    source: plan.source,
    ...(plan.title ? { title: plan.title.slice(0, 120) } : {}),
    items: plan.items.map(item => ({ ...(item.id ? { id: item.id } : {}), text: item.text, status: normalizeTodoStatus(item.status) })),
    updatedAt: plan.updatedAt,
    ...(plan.partial === true ? { partial: true } : {}),
  }
}

/** 待办项目按 userData 隔离；损坏/未来版本 fail closed，宿主快照损坏时可安全重置。 */
export function createTodoStore(
  directory: string,
  options: { now?: () => number } = {},
): TodoStore {
  const now = options.now ?? (() => Date.now())
  const projectsFile = path.join(directory, 'todo.v1.json')
  const hostPlansFile = path.join(directory, 'host-plans.v1.json')
  let projects: TodoProject[] = []
  let projectsError: TodoStoreError | null = null
  let hostPlans: HostPlanSnapshot[] = []

  fs.mkdirSync(directory, { recursive: true })
  readProjects()
  readHostPlans()

  function readJsonFile(file: string): { ok: true; value: unknown } | { ok: false; error: TodoStoreError } {
    try {
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) return { ok: false, error: 'invalid' }
      const raw = fs.readFileSync(file, 'utf8')
      if (Buffer.byteLength(raw, 'utf8') > MAX_FILE_BYTES) return { ok: false, error: 'invalid' }
      return { ok: true, value: JSON.parse(raw) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, value: null }
      return { ok: false, error: 'unreadable' }
    }
  }

  function readProjects(): void {
    const result = readJsonFile(projectsFile)
    if (!result.ok) {
      projects = []
      projectsError = result.error
      return
    }
    if (result.value === null) {
      projects = []
      projectsError = null
      return
    }
    const doc = result.value as Record<string, unknown>
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      projects = []
      projectsError = 'invalid'
      return
    }
    if (typeof doc.version === 'number' && doc.version > 1) {
      projects = []
      projectsError = 'future-version'
      return
    }
    if (doc.version !== 1 || !Array.isArray(doc.projects) || doc.projects.length > MAX_PROJECTS ||
        !doc.projects.every(validProject)) {
      projects = []
      projectsError = 'invalid'
      return
    }
    projects = (doc.projects as TodoProject[]).map(cleanProject)
    projectsError = null
  }

  function readHostPlans(): void {
    const result = readJsonFile(hostPlansFile)
    if (!result.ok || result.value === null) {
      hostPlans = []
      return
    }
    const doc = result.value as Record<string, unknown>
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.version !== 1 ||
        !Array.isArray(doc.plans) || doc.plans.length > MAX_HOST_PLANS || !doc.plans.every(validHostPlan)) {
      hostPlans = []
      return
    }
    hostPlans = (doc.plans as HostPlanSnapshot[]).map(cleanHostPlan)
  }

  function writeAtomic(file: string, value: unknown): boolean {
    const serialized = JSON.stringify(value)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_FILE_BYTES) return false
    const temp = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`)
    try {
      const fd = fs.openSync(temp, 'wx', 0o600)
      try {
        fs.writeFileSync(fd, serialized, 'utf8')
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      fs.renameSync(temp, file)
      return true
    } catch {
      try { fs.unlinkSync(temp) } catch { /* scratch file may not exist */ }
      return false
    }
  }

  function persistHostPlans(next: HostPlanSnapshot[]): boolean {
    if (!writeAtomic(hostPlansFile, { version: 1, plans: next })) {
      console.warn('[uta] host plans were not persisted; keeping the previous in-memory copy')
      return false
    }
    hostPlans = next
    return true
  }

  function activeKey(activeCwd: string, activeHostId: string): string {
    return activeCwd ? workspaceKey(activeCwd) : unidentifiedKey(activeHostId)
  }

  function state(activeHostId: string, activeSessionId: string, activeCwd: string): TodoState {
    const key = activeKey(activeCwd, activeHostId)
    const activeProject = projects.find(project => project.key === key) ?? null
    const exactPlan = hostPlans.find(plan => plan.hostId === activeHostId &&
      (plan.sessionId || '') === (activeSessionId || ''))
    let latestPlan = exactPlan ?? hostPlans
      .filter(plan => plan.hostId === activeHostId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null

    if (activeHostId === 'codex' && activeSessionId) {
      const codexGoal = readCodexSessionGoal(activeSessionId)
      if (codexGoal && (!latestPlan || codexGoal.updatedAt >= (latestPlan.updatedAt || 0))) {
        latestPlan = {
          hostId: 'codex',
          sessionId: activeSessionId,
          cwd: activeCwd,
          source: 'codex-plan',
          title: codexGoal.title,
          items: codexGoal.items,
          updatedAt: codexGoal.updatedAt,
        }
      }
    }

    const hostPlan = latestPlan ? cleanHostPlan(latestPlan) : null
    return {
      projects: [...projects]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(cleanProject),
      activeHostId,
      activeSessionId,
      activeCwd,
      activeProjectKey: key,
      activeProjectLabel: activeProject?.label ?? (activeCwd ? projectLabel(activeCwd) : '未识别项目'),
      activeProjectIsUnidentified: activeProject?.unidentified ?? !activeCwd,
      hostPlan,
      hostPlanStale: !!hostPlan?.sessionId && !!activeSessionId && hostPlan.sessionId !== activeSessionId,
      projectsError,
    }
  }

  function applyHostSnapshot(input: {
    hostId: string
    sessionId: string
    cwd: string
    source: string
    title?: string
    items: unknown
  }): boolean {
    const hostId = cleanHostId(input.hostId)
    if (!hostId || !Array.isArray(input.items)) return false
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim().slice(0, 200) : ''
    const cwd = cleanPath(input.cwd)
    const source = cleanSource(input.source)
    const title = typeof input.title === 'string' ? sanitizeText(input.title, 120) : undefined
    const items = input.items
      .slice(0, MAX_HOST_PLAN_ITEMS)
      .map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null
        const record = item as Record<string, unknown>
        const text = sanitizeText(record.text, MAX_TODO_TEXT)
        if (!text) return null
        return { text, status: normalizeTodoStatus(record.status) } satisfies HostPlanItem
      })
      .filter((item): item is HostPlanItem => !!item)
    const existingIndex = hostPlans.findIndex(plan => plan.hostId === hostId &&
      plan.sessionId === sessionId)
    const existing = existingIndex >= 0 ? hostPlans[existingIndex] : null
    if (existing && existing.source === source && existing.cwd === cwd && existing.title === title &&
        JSON.stringify(existing.items) === JSON.stringify(items)) {
      return false
    }
    const snapshot: HostPlanSnapshot = {
      hostId,
      sessionId,
      cwd,
      source,
      ...(title ? { title } : {}),
      items,
      updatedAt: now(),
    }
    const next = hostPlans.filter(plan => !(plan.hostId === hostId && plan.sessionId === sessionId))
    next.push(snapshot)
    const byHost = next.filter(plan => plan.hostId === hostId).sort((a, b) => b.updatedAt - a.updatedAt)
    const keep = new Set(byHost.slice(0, MAX_HOST_PLANS_PER_HOST).map(plan => `${plan.sessionId}\u0000${plan.updatedAt}`))
    const pruned = next
      .filter(plan => plan.hostId !== hostId || keep.has(`${plan.sessionId}\u0000${plan.updatedAt}`))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_HOST_PLANS)
    if (!persistHostPlans(pruned)) throw new Error('host plan save failed')
    return true
  }

  /** Claude task events are incremental: never claim they form a complete list. */
  function applyClaudeTaskDelta(input: {
    sessionId: string; cwd?: string; action: 'create' | 'update'; id: string
    text?: string; status?: TodoStatus | 'deleted'
  }): boolean {
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : ''
    const id = typeof input.id === 'string' ? input.id.trim() : ''
    if (!sessionId || sessionId.length > 200 || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) return false
    if (input.action !== 'create' && input.action !== 'update') return false
    const status = input.status
    if (status !== undefined && !['pending', 'in_progress', 'completed', 'deleted'].includes(status)) return false
    const text = sanitizeText(input.text, MAX_TODO_TEXT)
    if (input.action === 'create' && (!text || status === 'deleted')) return false
    if (input.action === 'update' && !text && status === undefined) return false
    const hostId = 'claude-code'
    const existing = hostPlans.find(plan => plan.hostId === hostId && plan.sessionId === sessionId && plan.source === 'claude-task')
    const items = existing ? existing.items.map(item => ({ ...item })) : []
    const index = items.findIndex(item => item.id === id)
    if (input.action === 'create') {
      if (index >= 0) return false
      if (items.length < MAX_HOST_PLAN_ITEMS) items.push({ id, text, status: status === 'completed' || status === 'in_progress' ? status : 'pending' })
    } else if (index >= 0) {
      if (status === 'deleted') items.splice(index, 1)
      else items[index] = { ...items[index], ...(text ? { text } : {}), ...(status ? { status } : {}) }
    }
    const snapshot: HostPlanSnapshot = {
      hostId, sessionId, cwd: cleanPath(input.cwd || existing?.cwd || ''), source: 'claude-task',
      items, updatedAt: now(), partial: true,
    }
    const next = hostPlans.filter(plan => !(plan.hostId === hostId && plan.sessionId === sessionId))
    next.push(snapshot)
    const keep = new Set(next.filter(plan => plan.hostId === hostId).sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_HOST_PLANS_PER_HOST).map(plan => `${plan.sessionId}\u0000${plan.updatedAt}`))
    const persisted = persistHostPlans(next.filter(plan => plan.hostId !== hostId || keep.has(`${plan.sessionId}\u0000${plan.updatedAt}`))
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_HOST_PLANS))
    if (!persisted) throw new Error('host plan save failed')
    return true
  }

  return {
    state,
    applyHostSnapshot,
    applyClaudeTaskDelta,
    reload: readProjects,
  }
}
