'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const createLoader = require('./support/settings-loader.cjs')

const {
  buildHostDirectorPrompt,
  extractJsonFromHostReply,
} = createLoader()('renderer/services/live2d/natural-action-planner')

const commandsCode = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/main/runtime-commands.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const commandsModule = { exports: {} }
vm.runInNewContext(commandsCode, { module: commandsModule, exports: commandsModule.exports })
const { validateRuntimeCommand } = commandsModule.exports

test('[FEAT-HOST-DIRECTOR] buildHostDirectorPrompt formats full context, gestures, and strict json schema', () => {
  const userInstruction = '先看左边，再抚胸微笑，最后轻轻点头看回我'
  const modelName = '大肥鱼'
  const context = {
    modelEmotions: ['happy', 'shy', 'angry'],
    parameters: [],
  }
  const pairedGestures = [
    {
      id: 'hand_on_chest',
      name: '抚胸手',
      label: '抚胸致意',
      enter: { group: '抚胸手打开', index: 0 },
      exit: { group: '抚胸手关闭', index: 0 },
      joints: [],
    },
  ]

  const prompt = buildHostDirectorPrompt(userInstruction, modelName, context, pairedGestures)

  assert.ok(prompt.includes('大肥鱼'))
  assert.ok(prompt.includes(userInstruction))
  assert.ok(prompt.includes('hand_on_chest'))
  assert.ok(prompt.includes('抚胸手打开'))
  assert.ok(prompt.includes('抚胸手关闭'))
  assert.ok(prompt.includes('"version": 1'))
  assert.ok(prompt.includes('"actions":'))
})

test('[FEAT-HOST-DIRECTOR] extractJsonFromHostReply handles markdown fenced code blocks and preamble', () => {
  const replyWithPreamble = `你好！我已经为您构思了这段细腻的动作分镜：

\`\`\`json
{
  "version": 1,
  "summary": "抚胸微笑并点头致意",
  "actions": [
    { "kind": "look", "direction": "left" },
    { "kind": "gesture", "name": "hand_on_chest", "durationMs": 1500 },
    { "kind": "smile" },
    { "kind": "nod", "count": 1 }
  ]
}
\`\`\`

希望能满足您的表演需求！`

  const plan = extractJsonFromHostReply(replyWithPreamble)
  assert.ok(plan)
  assert.equal(plan.version, 1)
  assert.equal(plan.summary, '抚胸微笑并点头致意')
  assert.equal(plan.actions.length, 4)
  assert.equal(plan.actions[0].kind, 'look')
  assert.equal(plan.actions[1].name, 'hand_on_chest')
})

test('[FEAT-HOST-DIRECTOR] extractJsonFromHostReply rejects invalid or malformed replies', () => {
  assert.equal(extractJsonFromHostReply(''), null)
  assert.equal(extractJsonFromHostReply('抱歉，我不能做这个动作。'), null)
  assert.equal(extractJsonFromHostReply('{"version": 2}'), null)
  assert.equal(extractJsonFromHostReply('{"actions": "not an array"}'), null)
})

test('[FEAT-HOST-DIRECTOR] validateRuntimeCommand validates direct_actions command', () => {
  // Valid with prompt
  const res1 = validateRuntimeCommand({
    command: 'direct_actions',
    prompt: '微笑看向前方',
  })
  assert.equal(res1.ok, true)
  assert.equal(res1.value.command, 'direct_actions')
  assert.equal(res1.value.prompt, '微笑看向前方')

  // Valid with plan
  const res2 = validateRuntimeCommand({
    command: 'direct_actions',
    plan: {
      version: 1,
      actions: [{ kind: 'smile' }],
    },
  })
  assert.equal(res2.ok, true)
  assert.equal(res2.value.command, 'direct_actions')
  assert.equal(res2.value.plan.version, 1)

  // Invalid when empty
  const res3 = validateRuntimeCommand({
    command: 'direct_actions',
  })
  assert.equal(res3.ok, false)
})
