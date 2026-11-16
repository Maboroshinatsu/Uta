const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '..', 'shared', 'uta-narration.mjs'),
).href

test('tool categories map to stable narration intents', async () => {
  const { inferToolIntent } = await import(moduleUrl)
  const cases = [
    ['read_file', {}, 'looking'],
    ['Grep', {}, 'searching'],
    ['Glob', {}, 'searching'],
    ['search_web', {}, 'researching'],
    ['read_url_content', {}, 'researching'],
    ['apply_patch', {}, 'editing'],
    ['write_config', {}, 'defining'],
    ['Bash', { command: 'npm test' }, 'testing'],
    ['Bash', { command: 'git status' }, 'running'],
    ['run_command', { command: 'pytest -q' }, 'testing'],
    ['mcp__server__tool', {}, 'running'],
  ]
  for (const [tool, input, expected] of cases) {
    assert.equal(inferToolIntent(tool, input), expected, `${tool} -> ${expected}`)
  }
  assert.equal(inferToolIntent('', {}), null)
})

test('lifecycle events map to narration intents and ignore noisy success events', async () => {
  const { inferNarration } = await import(moduleUrl)
  assert.equal(inferNarration('SessionStart'), 'session_start')
  assert.equal(inferNarration('UserPromptSubmit'), 'thinking')
  assert.equal(inferNarration('PreToolUse', { tool_name: 'Read' }), 'looking')
  assert.equal(inferNarration('PostToolUse', { tool_name: 'Read' }), null)
  assert.equal(inferNarration('PostToolUse', { tool_name: 'Read', error: 'x' }), 'error')
  assert.equal(inferNarration('PostToolUseFailure'), 'error')
  assert.equal(inferNarration('PermissionRequest'), 'waiting')
  assert.equal(inferNarration('Stop'), 'success')
  assert.equal(inferNarration('Interrupt'), 'retry')
  assert.equal(inferNarration('agent/request'), 'thinking')
  assert.equal(inferNarration('tools/execute', { tool: 'Grep' }), 'searching')
  assert.equal(inferNarration('tools/result', { isError: true }), 'error')
  assert.equal(inferNarration('unknown/event'), null)
})

test('user-choice tools are recognized separately from approvals', async () => {
  const { isUserChoiceTool } = await import(moduleUrl)
  for (const name of [
    'AskUserQuestion',
    'ask_user',
    'ask_user_question',
    'ask_question',
    'ask_followup_question',
    'request_user_input',
    'user_choice',
    'choose_option',
    'question',
  ]) {
    assert.equal(isUserChoiceTool(name), true, `${name} should be a choice tool`)
  }
  for (const name of ['Bash', 'TaskStop', 'manage_task', 'deskpet_set_preset', '']) {
    assert.equal(isUserChoiceTool(name), false, `${name} should not be a choice tool`)
  }
})

test('no prompt text is used for classification', async () => {
  const { inferNarration } = await import(moduleUrl)
  const intent = inferNarration('PreToolUse', {
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
    prompt: 'SECRET-PROMPT',
  })
  assert.equal(intent, 'testing')
})
