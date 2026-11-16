#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  BUILD_ROOT,
  PUBLIC_BUNDLE,
  RUN_ROOT,
  ensureDir,
  prepareTempEnvironment,
  taskRelative,
} from './lib/paths.mjs'
import { verifyReferenceInputs } from './lib/verify-reference.mjs'
import {
  createFullCapabilityProfile,
  createPartialCapabilityProfile,
} from '../fixtures/capability-profiles.mjs'
import { runCpuBaseline } from '../src/benchmark.mjs'
import { loadRealCapabilityProfile, summarizeCapabilityProfile } from '../src/real-profile.mjs'
import {
  loadPublicApi,
  runActionLifecycleScenario,
  runAllScenarios,
  runDeterminismScenario,
  runDtVariantsScenario,
  runEmotionGradientScenario,
  runMouthGateScenario,
  runProfileFilterScenario,
  runSpeechCancelScenario,
} from '../src/scenarios.mjs'

function runScenarioSafely(id, run, ...args) {
  const startedAt = Date.now()
  try {
    return { ...run(...args), durationMs: Date.now() - startedAt }
  } catch (error) {
    return {
      id,
      passed: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      durationMs: Date.now() - startedAt,
    }
  }
}

async function main() {
  const temp = prepareTempEnvironment()
  if (!fs.existsSync(PUBLIC_BUNDLE)) {
    throw new Error('public bundle is missing; run node scripts/build-engine.mjs first')
  }
  ensureDir(RUN_ROOT)
  const api = await loadPublicApi()
  const reference = verifyReferenceInputs()
  const buildReport = JSON.parse(fs.readFileSync(path.join(BUILD_ROOT, 'build-report.json'), 'utf8'))
  const surfaceReport = JSON.parse(fs.readFileSync(path.join(BUILD_ROOT, 'surface-report.json'), 'utf8'))

  const synthetic = runAllScenarios(api, {
    full: createFullCapabilityProfile(),
    partial: createPartialCapabilityProfile(),
  })

  const real = await loadRealCapabilityProfile()
  let realScenarios = null
  let realSummary = null
  let benchmark = null
  let benchmarkProfile = 'synthetic:full'
  if (real.available) {
    realSummary = summarizeCapabilityProfile(real.capabilityProfile)
    realScenarios = [
      runScenarioSafely('emotion-gradients', runEmotionGradientScenario, api, real.capabilityProfile),
      runScenarioSafely('mouth-gate', runMouthGateScenario, api, real.capabilityProfile),
      runScenarioSafely('speech-cancel', runSpeechCancelScenario, api, real.capabilityProfile),
      runScenarioSafely('dt-variants', runDtVariantsScenario, api, real.capabilityProfile),
      runScenarioSafely('determinism', runDeterminismScenario, api, real.capabilityProfile),
      runScenarioSafely('profile-filter', runProfileFilterScenario, api, real.capabilityProfile),
      runScenarioSafely('action-lifecycle', runActionLifecycleScenario, api, real.capabilityProfile),
    ]
    benchmark = runCpuBaseline(api, real.capabilityProfile)
    benchmarkProfile = 'real:ds-control-baseline-v1'
  } else {
    benchmark = runCpuBaseline(api, createFullCapabilityProfile())
  }

  const results = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    task: 'soullink-engine-spike',
    modelRequest: {
      requested: 'DeepSeek-Flash with max reasoning and 1,000,000 context window',
      effectiveLimitsReturnedByCli: false,
      note: 'The CLI did not return effective reasoning/context values; they are not claimed as verified.',
    },
    environment: {
      node: process.version,
      platform: process.platform,
      tempDirectory: taskRelative(temp),
      profile: process.env.UTA_PROFILE ?? null,
    },
    reference: {
      sourceHead: reference.sourceHead,
      manifestSha256: reference.manifestSha256,
      fileCount: reference.fileCount,
      totalBytes: reference.totalBytes,
      standaloneNoticeFound: reference.standaloneNoticeFound,
      licenseHashes: reference.licenseHashes,
    },
    build: {
      typecheckExitCode: buildReport.typecheck.exitCode,
      public: buildReport.bundles.public,
      internal: buildReport.bundles.internal,
      utaAdapter: buildReport.bundles.utaAdapter,
      note: buildReport.note,
    },
    surface: {
      package: surfaceReport.package,
      license: surfaceReport.license,
      source: {
        all: surfaceReport.source.all,
        publicClosure: surfaceReport.source.publicClosure,
        runtimeClosure: surfaceReport.source.runtimeClosure,
      },
      exports: {
        publicCount: surfaceReport.exports.publicCount,
        internalCount: surfaceReport.exports.internalCount,
        publicIsStrictSubset: surfaceReport.exports.publicIsStrictSubset,
        internalOnly: surfaceReport.exports.internalOnly,
      },
    },
    syntheticScenarios: synthetic,
    realInput: real.available
      ? {
          available: true,
          summary: realSummary,
          integrity: real.integrity,
          counts: real.counts,
          coreReport: real.coreReport,
          lipSyncGroup: real.lipSyncGroup,
          noticeHash: real.noticeHash,
          parameterCount: real.parameterCount,
          expressionCount: real.expressionCount,
          motionCount: real.motionCount,
          coreReleased: real.coreReleased,
          scenarios: realScenarios,
        }
      : { available: false, reason: real.reason },
    benchmark: {
      profile: benchmarkProfile,
      ...benchmark,
    },
  }

  const stamp = results.generatedAt.replaceAll(':', '-').replaceAll('.', '-')
  const runFile = path.join(RUN_ROOT, `run-${stamp}.json`)
  const latestFile = path.join(RUN_ROOT, 'latest.json')
  const serialized = JSON.stringify(results, null, 2) + '\n'
  fs.writeFileSync(runFile, serialized)
  fs.writeFileSync(latestFile, serialized)

  const allScenarioResults = [
    ...synthetic,
    ...(realScenarios ?? []),
  ]
  const failures = allScenarioResults.filter((entry) => entry.passed !== true)
  console.log(JSON.stringify({
    runFile: taskRelative(runFile),
    latestFile: taskRelative(latestFile),
    runSha256: crypto.createHash('sha256').update(serialized).digest('hex'),
    syntheticScenarios: synthetic.map((entry) => ({ id: entry.id, passed: entry.passed, error: entry.error })),
    realInputAvailable: real.available,
    realScenarios: realScenarios?.map((entry) => ({ id: entry.id, passed: entry.passed, error: entry.error })) ?? null,
    benchmarkProfile,
    engineTiming: benchmark.engine.timing,
    baselineTiming: benchmark.baseline.timing,
    engineOutput: benchmark.engine.output,
    baselineOutput: benchmark.baseline.output,
    failures: failures.map((entry) => ({ id: entry.id, error: entry.error })),
  }, null, 2))

  if (failures.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
