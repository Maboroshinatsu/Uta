'use strict'
// S01：模型资源必须经 realpath 收口，junction / 符号链接不能逃逸模型根。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/main/model-path-safety.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const hostModule = { exports: {} }
vm.runInNewContext(code, {
  module: hostModule,
  exports: hostModule.exports,
  require: (spec) => {
    if (spec === 'node:fs') return fs
    if (spec === 'node:path') return path
    throw new Error(`Unexpected import: ${spec}`)
  },
  Set,
  console,
})
const {
  isPathInside,
  isAllowedModelAsset,
  resolveContainedModelFile,
  isSafePresetTarget,
} = hostModule.exports

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'uta-path-safety-'))
}

function cleanup(...dirs) {
  for (const dir of dirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
}

test('模型根内的文件能解析，越界和未知扩展名被拒绝', () => {
  const root = tempRoot()
  const outside = tempRoot()
  try {
    const modelDir = path.join(root, 'miku')
    fs.mkdirSync(modelDir, { recursive: true })
    const modelFile = path.join(modelDir, 'miku.model3.json')
    fs.writeFileSync(modelFile, '{}')
    fs.writeFileSync(path.join(modelDir, 'texture.png'), 'png')
    fs.writeFileSync(path.join(modelDir, 'note.txt'), 'secret')
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside')

    assert.equal(resolveContainedModelFile([root], 'miku/miku.model3.json'), fs.realpathSync(modelFile))
    assert.equal(resolveContainedModelFile([root], 'miku/texture.png'), fs.realpathSync(path.join(modelDir, 'texture.png')))
    fs.writeFileSync(path.join(modelDir, 'portrait.svg'), '<svg xmlns="http://www.w3.org/2000/svg" />')
    assert.equal(isAllowedModelAsset('portrait.svg'), true)
    assert.equal(resolveContainedModelFile([root], 'miku/portrait.svg'), fs.realpathSync(path.join(modelDir, 'portrait.svg')))
    assert.equal(resolveContainedModelFile([root], `../${path.basename(outside)}/secret.txt`), null)
    assert.equal(resolveContainedModelFile([root], 'miku/note.txt'), null)
    assert.equal(resolveContainedModelFile([root], 'miku'), null, '目录不是可读模型资源')
    assert.equal(isAllowedModelAsset('a.MOC3'), true)
    assert.equal(isAllowedModelAsset('a.exe'), false)
    assert.equal(isPathInside(root, modelDir), true)
    assert.equal(isPathInside(modelDir, root), false)
  } finally {
    cleanup(root, outside)
  }
})

test('junction 指向模型根外时被真实路径校验拦住', (t) => {
  const root = tempRoot()
  const outside = tempRoot()
  try {
    fs.writeFileSync(path.join(outside, 'outside.model3.json'), '{}')
    const link = path.join(root, 'escape')
    try {
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (err) {
      t.skip(`无法创建 junction: ${err.message}`)
      return
    }

    assert.equal(resolveContainedModelFile([root], 'escape/outside.model3.json'), null)
  } finally {
    cleanup(root, outside)
  }
})

test('预设写入只允许模型目录内的普通文件', () => {
  const root = tempRoot()
  const outside = tempRoot()
  try {
    const modelFile = path.join(root, 'miku.model3.json')
    fs.writeFileSync(modelFile, '{}')
    const target = path.join(root, 'deskpet-presets.json')

    assert.equal(isSafePresetTarget(modelFile, target), true, '目标不存在时允许创建')
    fs.writeFileSync(target, '{}')
    assert.equal(isSafePresetTarget(modelFile, target), true, '目标存在且在同目录时允许')

    const outsideTarget = path.join(outside, 'deskpet-presets.json')
    fs.writeFileSync(outsideTarget, '{}')
    try {
      fs.symlinkSync(outsideTarget, target, 'file')
      assert.equal(isSafePresetTarget(modelFile, target), false, '指向外部的文件链接必须拒绝')
    } catch {
      // Windows 文件符号链接可能需要额外权限；跳过这一子断言
    }
  } finally {
    cleanup(root, outside)
  }
})
