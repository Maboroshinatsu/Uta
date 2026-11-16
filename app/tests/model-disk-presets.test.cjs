const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Load the production pure sanitizers without booting Electron's main process.
const text = fs.readFileSync(path.join(__dirname, '../src/main/index.ts'), 'utf8')
const ast = ts.createSourceFile('main.ts', text, ts.ScriptTarget.Latest, true)
const names = new Set(['sanitizeParamRecord', 'sanitizeDiskMotion', 'sanitizeModelPresets'])
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
assert.equal(functions.length, names.size)
const code = ts.transpileModule(functions.map(node => node.getText(ast)).join('\n') + '\nmodule.exports = sanitizeModelPresets',
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const sandbox = { module: { exports: {} } }
vm.runInNewContext(code, sandbox)
const sanitize = raw => JSON.parse(JSON.stringify(sandbox.module.exports(raw)))

test('disk presets retain user ownership, native step references and an immediate return', () => {
  const [preset] = sanitize({ presets: [{ id: 'happy', label: 'Happy', source: 'user', revertHoldMs: 0,
    motion: { group: '', index: 1 }, steps: [{ durationMs: 500, holdMs: 0,
      controls: [], parameters: { ParamAngleY: 3 }, motion: { group: 'FlickUp', index: 0 } }] }] })
  assert.equal(preset.source, 'user')
  assert.equal(preset.revertHoldMs, 0)
  assert.deepEqual(preset.motion, { group: '', index: 1 })
  assert.deepEqual(preset.steps[0].motion, { group: 'FlickUp', index: 0 })
})

test('disk presets omit malformed motion references and unknown ownership values', () => {
  const [preset] = sanitize([{ id: 'neutral', label: 'Idle', source: 'anything', motion: { index: 1 },
    steps: [{ durationMs: 100, holdMs: 0, motion: 'none' }] }])
  assert.equal(preset.source, undefined)
  assert.equal(preset.motion, undefined)
  assert.equal(preset.steps[0].motion, undefined)
})

test('native motion group identity survives disk parsing without trimming or losing unnamed steps', () => {
  const [preset] = sanitize([{ id: 'native', label: 'Native', motion: { group: ' Idle ', index: 0 },
    steps: [{ durationMs: 200, motion: { group: '', index: 1 } }] }])
  assert.equal(preset.motion.group, ' Idle ')
  assert.equal(preset.steps[0].motion.group, '')
})

test('the distributed Hiyori presets preserve all curated slots through disk loading', () => {
  const original = JSON.parse(fs.readFileSync(path.join(__dirname,
    '../src/renderer/public/models/hiyori_pro_zh/hiyori_pro_zh/runtime/deskpet-presets.json'), 'utf8')).presets
  const result = sanitize({ presets: original })
  assert.equal(result.length, original.length)
  assert.deepEqual(result.map(p => [p.id, p.label, p.source, p.motion]), original.map(p => [p.id, p.label, p.source, p.motion]))
})
