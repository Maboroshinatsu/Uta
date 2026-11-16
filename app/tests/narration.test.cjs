'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/services/narration.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const mod = { exports: {} }
vm.runInNewContext(code, { module: mod, exports: mod.exports, console })
const { NARRATION_LIBRARY, pickNarration } = mod.exports

test('every narration intent has phrases, visual hints and a sane bubble TTL', () => {
  const intents = [
    'session_start',
    'thinking',
    'looking',
    'searching',
    'reading',
    'defining',
    'editing',
    'testing',
    'running',
    'researching',
    'waiting',
    'found',
    'progress',
    'success',
    'error',
    'retry',
  ]
  assert.deepEqual(Object.keys(NARRATION_LIBRARY).sort(), intents.sort())
  for (const [intent, reaction] of Object.entries(NARRATION_LIBRARY)) {
    assert.ok(reaction.phrases.length >= 2, `${intent} needs multiple phrases`)
    assert.ok(reaction.bubbleTtlMs >= 1500 && reaction.bubbleTtlMs <= 12000, intent)
    assert.ok(reaction.preset || reaction.emotion, `${intent} needs a visual hint`)
  }
})

test('pickNarration avoids repeating the previous phrase', () => {
  const first = pickNarration('looking', { random: () => 0 })
  assert.ok(first.phrase)
  const second = pickNarration('looking', { random: () => 0, lastPhrase: first.phrase })
  assert.notEqual(second.phrase, first.phrase)
})

test('pickNarration returns stable intent and reaction fields', () => {
  const picked = pickNarration('success', { random: () => 0.99 })
  assert.equal(picked.intent, 'success')
  assert.equal(picked.preset, '开心')
  assert.equal(picked.emotion, 'happy')
  assert.ok(picked.phrase.includes('结果') || picked.phrase.includes('完成') || picked.phrase.includes('验收'))
})
