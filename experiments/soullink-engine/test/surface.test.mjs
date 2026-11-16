import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  BUILD_ROOT,
  INTERNAL_BUNDLE,
  PUBLIC_BUNDLE,
  TASK_ROOT,
  UTA_ADAPTER_BUNDLE,
} from '../scripts/lib/paths.mjs'
import { verifyReferenceInputs } from '../scripts/lib/verify-reference.mjs'

const buildReport = JSON.parse(fs.readFileSync(path.join(BUILD_ROOT, 'build-report.json'), 'utf8'))
const surfaceReport = JSON.parse(fs.readFileSync(path.join(BUILD_ROOT, 'surface-report.json'), 'utf8'))

test('pinned snapshot is fully hash-verified and has no standalone NOTICE', () => {
  const reference = verifyReferenceInputs()
  assert.equal(reference.sourceHead, '02cd75ac0a085a87d84d1a885f1b33eca8742d53')
  assert.equal(reference.fileCount, 88)
  assert.equal(reference.totalBytes, 411844)
  assert.equal(reference.standaloneNoticeFound, false)
  assert.deepEqual(reference.noticeFiles, [])
  assert.equal(reference.licenseHashes.LICENSE, '9838629be61bce3130144bc684e0579f687a3cddd024f67de5340a4f25cc5626')
  assert.equal(reference.licenseHashes['packages/engine/LICENSE'], reference.licenseHashes.LICENSE)
})

test('public and internal entries build from source with the app toolchain', () => {
  assert.equal(buildReport.typecheck.exitCode, 0, buildReport.typecheck.stdout + buildReport.typecheck.stderr)
  assert.ok(fs.existsSync(PUBLIC_BUNDLE))
  assert.ok(fs.existsSync(INTERNAL_BUNDLE))
  assert.ok(fs.existsSync(UTA_ADAPTER_BUNDLE))
  assert.ok(buildReport.bundles.public.bytes > 200_000)
  assert.equal(buildReport.bundles.public.inputModules, 65)
  assert.match(buildReport.note, /not from an official npm release/)
})

test('package exports expose a stable root plus an explicitly unstable internal path', () => {
  assert.deepEqual(Object.keys(surfaceReport.package.exports).sort(), ['.', './internal'])
  assert.equal(surfaceReport.package.type, 'module')
  assert.equal(surfaceReport.package.sideEffects, false)
  assert.deepEqual(surfaceReport.package.runtimeDependencies, [])
  assert.deepEqual(surfaceReport.package.peerDependencies, [])
  assert.equal(surfaceReport.package.license, 'Apache-2.0')
  assert.match(surfaceReport.license.firstLine, /Apache License/)
  assert.equal(surfaceReport.license.containsApache20, true)
  assert.equal(surfaceReport.license.standaloneNoticeFound, false)
})

test('public surface is a strict subset of internal and does not expose adapters directly', async () => {
  assert.equal(surfaceReport.exports.publicCount, 30)
  assert.equal(surfaceReport.exports.internalCount, 100)
  assert.equal(surfaceReport.exports.publicIsStrictSubset, true)
  for (const symbol of [
    'SoullinkRuntime',
    'SpeechPerformancePlanner',
    'resolveNativeAnimation',
    'motionStylePresets',
    'deriveParameterSmoothing',
    'deriveNeutralParams',
    'detectCapabilities',
    'computeAdaptationCoverage',
  ]) {
    assert.ok(surfaceReport.exports.publicExports.includes(symbol), `missing public export ${symbol}`)
  }
  for (const internalOnly of ['ModelProfileAdapter', 'LipSyncController', 'LayeredParameterMixer']) {
    assert.ok(surfaceReport.exports.internalOnly.includes(internalOnly))
    assert.ok(!surfaceReport.exports.publicExports.includes(internalOnly))
  }
})

test('runtime-only trimming would still retain almost the entire engine graph', () => {
  assert.equal(surfaceReport.source.publicClosure.files, 65)
  assert.equal(surfaceReport.source.internalClosure.files, 64)
  assert.ok(surfaceReport.source.runtimeClosure.files >= 60)
  assert.ok(surfaceReport.source.runtimeClosure.nonEmptyLines >= 7_000)
  assert.deepEqual(surfaceReport.source.externalImports, [])
})

test('experiment runtime sources never import the internal bundle', () => {
  const roots = [
    path.join(TASK_ROOT, 'experiments', 'soullink-engine', 'src'),
    path.join(TASK_ROOT, 'experiments', 'soullink-engine', 'test'),
    path.join(TASK_ROOT, 'experiments', 'soullink-engine', 'fixtures'),
    path.join(TASK_ROOT, 'experiments', 'soullink-engine', 'scripts', 'run-experiments.mjs'),
  ]
  const offenders = []
  const scan = (target) => {
    if (!fs.existsSync(target)) return
    const stat = fs.statSync(target)
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target)) scan(path.join(target, entry))
      return
    }
    if (!/\.(mjs|js|ts)$/.test(target)) return
    if (target.endsWith('surface.test.mjs')) return
    const source = fs.readFileSync(target, 'utf8')
    if (source.includes('internal-engine')) offenders.push(path.relative(TASK_ROOT, target))
  }
  for (const root of roots) scan(root)
  assert.deepEqual(offenders, [])
})
