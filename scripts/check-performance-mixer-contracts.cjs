'use strict'
/** Type-checks the additive mixer contract and synthetic fixtures with the app compiler. */
const path = require('node:path')
const ts = require(path.join(__dirname, '..', 'app/node_modules/typescript'))
const root = path.resolve(__dirname, '..')
const program = ts.createProgram([
  path.join(root, 'app/src/shared/first-wave-contracts.ts'),
  path.join(root, 'app/src/shared/performance-mixer-contracts.ts'),
  path.join(root, 'app/tests/fixtures/first-wave-v1.ts'),
  path.join(root, 'app/tests/fixtures/performance-mixer-v1.ts'),
], {
  strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [],
})
const errors = ts.getPreEmitDiagnostics(program)
if (errors.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }))
  process.exitCode = 1
} else console.log('Performance mixer v1 contract and fixtures passed; invalid enum/raw parameter shapes were rejected. Numeric ranges require runtime validation.')
