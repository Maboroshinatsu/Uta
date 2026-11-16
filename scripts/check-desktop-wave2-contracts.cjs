'use strict'
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const ts = require(path.join(root, 'app/node_modules/typescript'))
const program = ts.createProgram(['app/tests/fixtures/desktop-wave2.ts'].map(p => path.join(root, p)), {
  strict: true, noEmit: true, skipLibCheck: true, types: [],
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
})
const diagnostics = ts.getPreEmitDiagnostics(program)
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: p => p, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }))
  process.exitCode = 1
} else console.log('Desktop wave 2 contracts compile; three invalid shapes rejected. Runtime validation remains worker scope.')
