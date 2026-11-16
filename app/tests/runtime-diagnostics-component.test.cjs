'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const Vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')

function evaluate(source, imports, globals = {}) {
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, console,
    require: name => {
      if (!(name in imports)) throw new Error(`Unexpected import ${name}`)
      return imports[name]
    }, ...globals })
  return module.exports
}

const service = evaluate(fs.readFileSync(path.join(__dirname, '../src/renderer/services/runtime-diagnostics.ts'), 'utf8'), {})
const file = path.join(__dirname, '../src/renderer/components/RuntimeDiagnostics.vue')
const { descriptor } = parse(fs.readFileSync(file, 'utf8'), { filename: file })
const script = compileScript(descriptor, { id: 'diagnostics-lifecycle-test', inlineTemplate: true }).content

const element = type => ({ type, text: '', props: {}, children: [], parent: null })
function mount(api) {
  const window = { utaAPI: api }
  const component = evaluate(script, { vue: Vue, '@/services/runtime-diagnostics': service }, { window }).default
  const root = element('root')
  const insert = (node, parent, anchor) => {
    if (node.parent) remove(node)
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
  }
  const remove = node => {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
    node.parent = null
  }
  const renderer = Vue.createRenderer({
    createElement: element, createText: text => ({ ...element('#text'), text }),
    createComment: () => element('#comment'),
    insert, remove, patchProp: (node, key, _old, value) => { node.props[key] = value },
    setText: (node, text) => { node.text = text },
    setElementText: (node, text) => { node.text = text; node.children = [] },
    parentNode: node => node.parent,
    nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
    insertStaticContent: (text, parent, anchor) => {
      const node = { ...element('#static'), text }; insert(node, parent, anchor); return [node, node]
    },
  })
  const errors = []
  const app = renderer.createApp(component)
  app.config.errorHandler = error => errors.push(error)
  app.mount(root)
  const text = node => [node.text.replace(/<[^>]*>/g, ''), ...node.children.map(text)].join(' ')
  const find = (predicate, node = root) => predicate(node) ? node : node.children.map(child => find(predicate, child)).find(Boolean)
  return { app, root, errors, text: () => text(root), findButton: label => find(n => n.type === 'button' && text(n).includes(label)) }
}
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
  await Vue.nextTick()
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const snapshot = profile => ({ profile, packaged: false, version: '0.1.1', sourceDir: 'candidate-root',
  userData: 'private-data-directory', runtimeDir: 'runtime-directory', endpointFile: 'endpoint-path',
  build: { commit: null, dirty: null, builtAt: null } })

test('the real component renders browser fallback without an Electron API', async () => {
  const h = mount(undefined)
  await settle()
  assert.ok(h.text().includes('普通浏览器'))
  assert.equal(h.errors.length, 0)
  h.app.unmount()
})

test('the real retry button recovers from an IPC error without echoing its message', async () => {
  let calls = 0
  const h = mount({ getEnvironmentInfo: async () => {
    if (++calls === 1) throw new Error('sensitive-token-in-error')
    return snapshot('retry-task')
  } })
  await settle()
  assert.ok(h.text().includes('失败'))
  assert.equal(h.text().includes('sensitive-token-in-error'), false)
  const button = h.findButton('重试')
  assert.ok(button)
  await button.props.onClick()
  await settle()
  assert.ok(h.text().includes('retry-task'))
  assert.equal(calls, 2)
  assert.equal(h.errors.length, 0)
  h.app.unmount()
})

test('stable paths start folded and task paths start expanded in the real template', async () => {
  const stable = mount({ getEnvironmentInfo: async () => snapshot('stable') })
  await settle()
  assert.equal(stable.text().includes('private-data-directory'), false)
  stable.findButton('内部路径').props.onClick()
  await settle()
  assert.ok(stable.text().includes('private-data-directory'))
  stable.app.unmount()
  const task = mount({ getEnvironmentInfo: async () => snapshot('another-task') })
  await settle()
  assert.ok(task.text().includes('private-data-directory'))
  assert.ok(task.text().includes('未知'))
  task.app.unmount()
})

test('a pending IPC response after component unmount does not remount content or throw', async () => {
  const response = deferred()
  const h = mount({ getEnvironmentInfo: () => response.promise })
  await Vue.nextTick()
  assert.ok(h.text().includes('正在读取'))
  h.app.unmount()
  response.resolve(snapshot('too-late'))
  await settle()
  assert.equal(h.root.children.length, 0)
  assert.equal(h.errors.length, 0)
})

test('a slower old IPC result cannot replace a newer diagnostic refresh', async () => {
  const first = deferred(), second = deferred()
  let calls = 0
  const h = mount({ getEnvironmentInfo: () => ++calls === 1 ? first.promise : second.promise })
  const refresh = h.findButton('重新检测')
  assert.ok(refresh)
  const refreshDone = refresh.props.onClick()
  second.resolve(snapshot('newer-result'))
  await refreshDone; await settle()
  assert.ok(h.text().includes('newer-result'))
  first.resolve(snapshot('stale-result'))
  await settle()
  assert.ok(h.text().includes('newer-result'))
  assert.equal(h.text().includes('stale-result'), false)
  h.app.unmount()
})
