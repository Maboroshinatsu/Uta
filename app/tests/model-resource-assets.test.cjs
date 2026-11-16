const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')
const load = require('./support/settings-loader.cjs')()
const { resolveContainedModelFile } = load('main/model-path-safety')
const source = fs.readFileSync(path.join(__dirname, '../src/main/index.ts'), 'utf8')
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'inspectModelAssets')
const code = ts.transpileModule(declaration.getText(ast) + '\nmodule.exports = inspectModelAssets', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

test('manifest resources keep nested file identity and registered aliases and own their CDI metadata', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-resource-assets-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const write = (file, data) => {
    const target = path.join(dir, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify(data))
  }
  write('model.model3.json', { FileReferences: {
    DisplayInfo: 'deep/metadata/actual/model.cdi3.json',
    Expressions: [{ Name: 'Blush', File: 'face/red.exp3.json' }, { Name: 'Costume', File: 'deep/a/b/red.exp3.json' }],
    Motions: { '': [{ File: 'deep/a/b/idle.motion3.json' }] },
  } })
  write('face/red.exp3.json', { Parameters: [{ Id: 'Face', Value: 1 }] })
  write('deep/a/b/red.exp3.json', { Parameters: [{ Id: 'Costume', Value: 1 }] })
  write('deep/a/b/idle.motion3.json', { Meta: { Duration: 18, Loop: true }, Curves: [{ Id: 'Body' }] })
  write('deep/metadata/actual/model.cdi3.json', { Parameters: [{ Id: 'Face', Name: '脸红' }] })
  write('other.cdi3.json', { Parameters: [{ Id: 'Face', Name: '其他模型' }] })
  const sandbox = { module: { exports: {} }, fs, path, console, resolveContainedModelFile,
    resolveModelFilePath: () => path.join(dir, 'model.model3.json'), MODEL_PRESETS_FILENAME: 'deskpet-presets.json',
    readModelPerformanceAssets: () => null }
  vm.runInNewContext(code, sandbox)
  const result = JSON.parse(JSON.stringify(sandbox.module.exports('model')))
  assert.equal(result.cdiParameters.Face.name, '脸红')
  assert.deepEqual(result.expressions.map(e => [e.file, e.registeredName]).sort(), [
    ['deep/a/b/red.exp3.json', 'Costume'], ['face/red.exp3.json', 'Blush'],
  ])
  assert.deepEqual(result.motionDetails['deep/a/b/idle.motion3.json'], { durationMs: 18000, loop: true })
  assert.deepEqual(result.motionParameterIds, ['Body'])
})
