export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  id: string
  text: string
  status: TodoStatus
  createdAt: number
  updatedAt: number
  completedAt?: number
}

export interface TodoProject {
  key: string
  path: string
  label: string
  hostId?: string
  unidentified: boolean
  items: TodoItem[]
  updatedAt: number
}

export interface HostPlanItem {
  id?: string
  text: string
  status: TodoStatus
}

export interface HostPlanSnapshot {
  hostId: string
  sessionId: string
  cwd: string
  source: string
  title?: string
  items: HostPlanItem[]
  updatedAt: number
  /** Incremental events may have been missed while Uta was offline. */
  partial?: boolean
}

export type TodoStoreError = 'unreadable' | 'invalid' | 'future-version' | 'read-only' | 'write-failed'

export interface TodoState {
  projects: TodoProject[]
  activeHostId: string
  activeSessionId: string
  activeCwd: string
  activeProjectKey: string
  activeProjectLabel: string
  activeProjectIsUnidentified: boolean
  hostPlan: HostPlanSnapshot | null
  hostPlanStale: boolean
  hostPlanSessionTitle?: string
  projectsError: TodoStoreError | null
}

export interface TodoSendInput {
  projectKey: string
  itemIds: string[]
}

export type TodoSendResult =
  | { ok: true; mode: 'sent' | 'copied'; text: string; detail?: string }
  | { ok: false; code?: 'unsupported' | 'no-session' | 'busy' | 'failed' | 'invalid' | 'empty'; error: string; copyText?: string }
