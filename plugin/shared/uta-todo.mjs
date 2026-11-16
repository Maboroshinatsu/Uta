/**
 * 宿主原生待办/计划的只读快照提取。
 *
 * 各宿主的工具名和字段不同：
 * - Codex: update_plan { plan: [{ step, status }] }
 * - Claude Code / ZCode: TodoWrite { todos: [{ content, status }] }
 * - OpenCode: todowrite { todos: [{ content, status }] }
 * - DSH: todo_write { todos: [{ content, status }] }
 *
 * 这里只读取工具参数，不执行工具、不写宿主文件；未知形状返回 null。
 */

const TODO_TOOL_NAMES = new Set([
  'update_plan',
  'updateplan',
  'todowrite',
  'todo_write',
  'todo-write',
  'write_todos',
  'todo',
  'create_goal',
  'update_goal',
  'set_goal',
  'get_goal',
])

const HOST_SOURCES = {
  codex: 'codex-plan',
  'claude-code': 'claude-todo',
  zcode: 'zcode-todo',
  qoder: 'qoder-todo',
  antigravity: 'antigravity-todo',
  opencode: 'opencode-todo',
  // Both ids map to one source so a renamed host keeps its existing plan history.
  'deepseek-harness': 'dsh-todo',
  harness: 'dsh-todo',
}

export function normalizeTodoStatus(value) {
  const status = String(value || '').trim()
  if (status === 'completed' || status === 'in_progress' || status === 'inProgress') {
    return status === 'inProgress' ? 'in_progress' : status
  }
  return 'pending'
}

function asObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

export function normalizeTodoToolName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^functions\./, '')
    .replace(/^tools\./, '')
}

export function isTodoTool(toolName) {
  const name = normalizeTodoToolName(toolName)
  if (!name) return false
  return (
    TODO_TOOL_NAMES.has(name) ||
    name.endsWith('.update_plan') ||
    name.endsWith('.todowrite') ||
    name.endsWith('.create_goal') ||
    name.endsWith('.update_goal')
  )
}

export function parseObjectiveToItems(text, goalStatus = 'pending') {
  if (typeof text !== 'string') return null
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return null
  const stepPattern = /^(?:(?:\d+[\.、\)]|[-*]|\[[\sxX]\])\s*)+(.*)$/
  const titleLines = []
  const stepLines = []
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
      const t = cleanText(match[1])
      if (t) stepLines.push({ text: t, completed: isDone })
    } else if (!inSteps) {
      titleLines.push(line)
    } else {
      const isDone = /\[[xX]\]/.test(line)
      const t = cleanText(line)
      if (t) stepLines.push({ text: t, completed: isDone })
    }
  }
  const title = titleLines.join(' · ').slice(0, 120) || (stepLines[0]?.text ?? '') || '会话目标'
  const items = stepLines.map((s, idx) => {
    let status = 'pending'
    if (s.completed || goalStatus === 'completed') status = 'completed'
    else if (idx === 0 && (goalStatus === 'active' || goalStatus === 'in_progress')) status = 'in_progress'
    return { text: s.text, status }
  })
  if (items.length === 0 && lines.length > 0) {
    items.push({
      text: cleanText(lines[0]),
      status: goalStatus === 'completed' ? 'completed' : 'pending',
    })
  }
  return { title, items }
}

/** 返回归一化条目；不是可识别的待办工具时返回 null。 */
export function extractTodoItems(toolName, rawArgs) {
  if (!isTodoTool(toolName)) return null
  const args = asObject(rawArgs)
  if (!args) return null
  const list = Array.isArray(args.plan)
    ? args.plan
    : Array.isArray(args.todos)
      ? args.todos
      : Array.isArray(args.items)
        ? args.items
        : null
  if (list) {
    return list
      .slice(0, 50)
      .map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null
        const text = cleanText(item.step ?? item.content ?? item.text ?? item.title ?? item.task)
        if (!text) return null
        return { text, status: normalizeTodoStatus(item.status ?? item.state) }
      })
      .filter(Boolean)
  }
  const objective = args.objective || args.goal || args.description
  if (typeof objective === 'string' && objective.trim()) {
    const parsed = parseObjectiveToItems(objective, args.status)
    return parsed?.items || null
  }
  return null
}

export function todoSourceForHost(hostId) {
  return HOST_SOURCES[String(hostId || '').trim()] || `${String(hostId || 'host').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 30)}-todo`
}

/** Claude Task tools send one successful change at a time, not a full snapshot. */
export function extractClaudeTaskDelta(event, payload = {}, hostId = '') {
  if (hostId !== 'claude-code' || event !== 'PostToolUse' || !payload.session_id) return null
  const name = normalizeTodoToolName(payload.tool_name || payload.toolName)
  const input = asObject(payload.tool_input ?? payload.toolInput)
  const response = asObject(payload.tool_response ?? payload.toolResponse)
  if (!input || !response || response.error || response.is_error || response.success === false || response.ok === false) return null
  const cwd = typeof payload.cwd === 'string' ? payload.cwd.trim().slice(0, 500) : ''
  if (name === 'taskcreate') {
    const task = asObject(response.task)
    const id = typeof task?.id === 'string' ? task.id.trim() : ''
    const text = cleanText(task?.subject)
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !text) return null
    return { command: 'claude_task_delta', action: 'create', id, text, ...(cwd ? { cwd } : {}) }
  }
  if (name === 'taskupdate') {
    const id = typeof response.taskId === 'string' ? response.taskId.trim() : ''
    const requestedId = input.taskId ?? input.id ?? input.task_id
    if (response.success !== true || !/^[A-Za-z0-9_-]{1,80}$/.test(id) || String(requestedId ?? '') !== id || !Array.isArray(response.updatedFields)) return null
    const text = response.updatedFields.includes('subject') ? cleanText(input.subject) : ''
    const change = asObject(response.statusChange)
    const status = response.updatedFields.includes('status') || response.updatedFields.includes('deleted') ? change?.to : undefined
    if (status !== undefined && !['pending', 'in_progress', 'completed', 'deleted'].includes(status)) return null
    if (!text && status === undefined) return null
    return { command: 'claude_task_delta', action: 'update', id, ...(text ? { text } : {}), ...(status ? { status } : {}), ...(cwd ? { cwd } : {}) }
  }
  return null
}

/**
 * 从宿主 hook payload 提取 todo_snapshot 指令。
 * Only a successful PostToolUse may commit a task mirror; pre-tool arguments are intent.
 */
export function extractTodoSnapshot(event, payload = {}, hostId = '') {
  const name = String(event || '')
  if (name !== 'PostToolUse' || payload.error || payload.tool_response?.is_error === true || payload.tool_response?.success === false) return null
  const toolName = payload?.tool_name || payload?.toolName || payload?.toolCall?.name || ''
  const rawArgs =
    payload?.tool_input ??
    payload?.toolInput ??
    payload?.args ??
    payload?.toolCall?.args
  const args = asObject(rawArgs)
  const items = extractTodoItems(toolName, rawArgs)
  if (!items) return null
  const cwd = typeof payload?.cwd === 'string' ? payload.cwd.trim().slice(0, 500) : ''
  let title = ''
  if (args) {
    if (typeof args.title === 'string' && args.title.trim()) {
      title = cleanText(args.title).slice(0, 120)
    } else {
      const obj = args.objective || args.goal || args.description
      if (typeof obj === 'string' && obj.trim()) {
        const parsed = parseObjectiveToItems(obj, args.status)
        if (parsed?.title) title = parsed.title
      }
    }
  }
  return {
    command: 'todo_snapshot',
    source: todoSourceForHost(hostId),
    ...(cwd ? { cwd } : {}),
    ...(title ? { title } : {}),
    items,
  }
}
