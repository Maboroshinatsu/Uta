'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')

const helper = import('../shared/uta-todo.mjs')

test('extracts Codex update_plan steps and normalizes inProgress', async () => {
  const { extractTodoItems } = await helper
  const items = extractTodoItems('update_plan', {
    explanation: '继续',
    plan: [
      { step: '检查协议', status: 'completed' },
      { step: '写 UI', status: 'inProgress' },
      { step: '验收', status: 'pending' },
    ],
  })
  assert.deepEqual(items, [
    { text: '检查协议', status: 'completed' },
    { text: '写 UI', status: 'in_progress' },
    { text: '验收', status: 'pending' },
  ])
})

test('extracts Claude TodoWrite and OpenCode todowrite content fields', async () => {
  const { extractTodoItems } = await helper
  for (const tool of ['TodoWrite', 'todowrite', 'todo_write', 'write_todos']) {
    const items = extractTodoItems(tool, {
      todos: [{ content: '接宿主', status: 'in_progress' }],
    })
    assert.deepEqual(items, [{ text: '接宿主', status: 'in_progress' }], tool)
  }
})

test('unknown tools and malformed payloads return null, empty lists stay explicit', async () => {
  const { extractTodoItems } = await helper
  assert.equal(extractTodoItems('Bash', { command: 'ls' }), null)
  assert.equal(extractTodoItems('todowrite', null), null)
  assert.equal(extractTodoItems('todowrite', 'not-json'), null)
  assert.deepEqual(extractTodoItems('todowrite', { todos: [] }), [])
})

test('todo text is sanitized and capped, empty entries are dropped', async () => {
  const { extractTodoItems } = await helper
  const items = extractTodoItems('TodoWrite', {
    todos: [
      { content: '  a\u0000  b  ', status: 'pending' },
      { content: '', status: 'pending' },
      { content: 'x'.repeat(300), status: 'weird' },
    ],
  })
  assert.equal(items.length, 2)
  assert.equal(items[0].text, 'a b')
  assert.equal(items[1].text.length, 200)
  assert.equal(items[1].status, 'pending')
})

test('extractTodoSnapshot only emits on tool hook events with host attribution', async () => {
  const { extractTodoSnapshot } = await helper
  assert.equal(extractTodoSnapshot('Stop', {
    hook_event_name: 'Stop',
    tool_name: 'update_plan',
    tool_input: { plan: [{ step: 'x', status: 'pending' }] },
  }, 'codex'), null)

  assert.equal(extractTodoSnapshot('PreToolUse', { tool_name: 'update_plan', tool_input: { plan: [{ step: 'not committed', status: 'pending' }] } }, 'codex'), null)
  const snapshot = extractTodoSnapshot('PostToolUse', {
    hook_event_name: 'PostToolUse',
    cwd: 'D:/Work/Uta',
    tool_name: 'update_plan',
    tool_input: { plan: [{ step: 'x', status: 'inProgress' }] },
  }, 'codex')
  assert.deepEqual(snapshot, {
    command: 'todo_snapshot',
    source: 'codex-plan',
    cwd: 'D:/Work/Uta',
    items: [{ text: 'x', status: 'in_progress' }],
  })

  const claude = extractTodoSnapshot('PostToolUse', {
    tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'y', status: 'completed' }] },
  }, 'claude-code')
  assert.equal(claude.source, 'claude-todo')
  assert.equal(claude.cwd, undefined)

  const codexGoal = extractTodoSnapshot('PostToolUse', {
    tool_name: 'create_goal',
    tool_input: {
      objective: '测试目标标题\n步骤：\n1. 第一步\n2. 第二步',
    },
  }, 'codex')
  assert.deepEqual(codexGoal, {
    command: 'todo_snapshot',
    source: 'codex-plan',
    title: '测试目标标题',
    items: [
      { text: '第一步', status: 'pending' },
      { text: '第二步', status: 'pending' },
    ],
  })
})

test('Claude task hooks extract only successful, attributable incremental updates', async () => {
  const { extractClaudeTaskDelta } = await helper
  const create = { session_id: 's1', tool_name: 'TaskCreate', tool_input: { subject: '草稿' }, tool_response: { task: { id: '1', subject: '检查样例' } }, cwd: 'D:/p' }
  assert.deepEqual(extractClaudeTaskDelta('PostToolUse', create, 'claude-code'), { command: 'claude_task_delta', action: 'create', id: '1', text: '检查样例', cwd: 'D:/p' })
  const update = { session_id: 's1', tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' }, tool_response: { success: true, taskId: '1', updatedFields: ['status'], statusChange: { from: 'pending', to: 'completed' } } }
  assert.deepEqual(extractClaudeTaskDelta('PostToolUse', update, 'claude-code'), { command: 'claude_task_delta', action: 'update', id: '1', status: 'completed' })
  const deleted = { ...update, tool_input: { taskId: '1', status: 'deleted' }, tool_response: { success: true, taskId: '1', updatedFields: ['deleted'], statusChange: { from: 'completed', to: 'deleted' } } }
  assert.deepEqual(extractClaudeTaskDelta('PostToolUse', deleted, 'claude-code'), { command: 'claude_task_delta', action: 'update', id: '1', status: 'deleted' })
  const renamed = { ...update, tool_input: { taskId: '1', subject: '新标题' }, tool_response: { success: true, taskId: '1', updatedFields: ['subject'] } }
  assert.deepEqual(extractClaudeTaskDelta('PostToolUse', renamed, 'claude-code'), { command: 'claude_task_delta', action: 'update', id: '1', text: '新标题' })
  assert.equal(extractClaudeTaskDelta('PreToolUse', create, 'claude-code'), null)
  assert.equal(extractClaudeTaskDelta('PostToolUseFailure', create, 'claude-code'), null)
  assert.equal(extractClaudeTaskDelta('PostToolUse', create, 'codex'), null)
  assert.equal(extractClaudeTaskDelta('PostToolUse', { ...create, session_id: '' }, 'claude-code'), null)
  assert.equal(extractClaudeTaskDelta('PostToolUse', { ...update, tool_response: { ...update.tool_response, success: false } }, 'claude-code'), null)
  assert.equal(extractClaudeTaskDelta('PostToolUse', { ...update, tool_response: { ...update.tool_response, taskId: '2' } }, 'claude-code'), null)
})
