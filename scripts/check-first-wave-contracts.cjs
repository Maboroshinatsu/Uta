'use strict'
/** Checks the frozen, side-effect-free types and synthetic fixtures using this task's compiler. */
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const ts = require(path.join(root, 'app/node_modules/typescript'))
const files = ['app/src/shared/first-wave-contracts.ts', 'app/tests/fixtures/first-wave-v1.ts'].map(p => path.join(root, p))
const program = ts.createProgram(files, {
  strict: true, noEmit: true, skipLibCheck: true,
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  types: [],
})
const errors = ts.getPreEmitDiagnostics(program)
if (errors.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: p => p, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }))
  process.exitCode = 1
} else console.log('First-wave types and fixtures passed; 3 expected invalid shapes rejected. Runtime range validation belongs to the profile task.')
