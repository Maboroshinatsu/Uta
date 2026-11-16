'use strict'
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

module.exports = function createLoader(overrides = {}, globals = {}) {
  const root = path.resolve(__dirname, '../../src')
  const cache = new Map()
  function load(name) {
    let file = path.resolve(root, name)
    if (!fs.existsSync(file)) file = fs.existsSync(file + '.ts') ? file + '.ts' : path.join(file, 'index.ts')
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.ts')
    if (file.toLowerCase().endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'))
    if (cache.has(file)) return cache.get(file).exports
    const mod = { exports: {} }
    cache.set(file, mod)
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    const resolve = id => {
      if (Object.hasOwn(overrides, id)) return overrides[id]
      if (id.endsWith('.css')) return {}
      if (id.startsWith('@/')) return load(path.join('renderer', id.slice(2)))
      if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id))
      return require(id)
    }
    vm.runInNewContext(code, {
      module: mod, exports: mod.exports, require: resolve, __dirname: path.dirname(file),
      console, process, Buffer, URL, setTimeout, clearTimeout, setImmediate, clearImmediate,
      queueMicrotask, Promise, Object, Array, String, Number, Boolean, Error, TypeError,
      RangeError, Map, Set, JSON, ...globals,
    }, { filename: file })
    return mod.exports
  }
  return load
}
