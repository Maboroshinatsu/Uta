#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  APP_NODE_MODULES,
  APP_ROOT,
  BUILD_ROOT,
  ENGINE_SOURCE_COPY,
  ENGINE_SNAPSHOT,
  INTERNAL_BUNDLE,
  PUBLIC_BUNDLE,
  TASK_ROOT,
  UTA_ADAPTER_BUNDLE,
  ensureDir,
  prepareTempEnvironment,
  taskRelative,
} from './lib/paths.mjs'
import { verifyReferenceInputs } from './lib/verify-reference.mjs'

const require = createRequire(import.meta.url)

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function writeTsconfig(directory) {
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM'],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
      forceConsistentCasingInFileNames: true,
    },
    include: ['**/*.ts'],
    exclude: ['**/__tests__/**'],
  }
  const file = path.join(directory, 'tsconfig.uta-experiment.json')
  fs.writeFileSync(file, JSON.stringify(tsconfig, null, 2) + '\n')
  return file
}

function runTypecheck(tsconfigFile, environment) {
  const tsc = path.join(APP_NODE_MODULES, 'typescript', 'bin', 'tsc')
  if (!fs.existsSync(tsc)) throw new Error(`app TypeScript is missing: ${tsc}`)
  const startedAt = Date.now()
  const result = spawnSync(process.execPath, [tsc, '-p', tsconfigFile, '--noEmit'], {
    cwd: path.dirname(tsconfigFile),
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
  })
  return {
    command: `node ${taskRelative(tsc)} -p ${taskRelative(tsconfigFile)} --noEmit`,
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  }
}

async function bundle(esbuild, entryPoint, outfile, metafilePath) {
  const startedAt = Date.now()
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'node18',
    outfile,
    metafile: true,
    logLevel: 'silent',
    sourcemap: false,
  })
  fs.writeFileSync(metafilePath, JSON.stringify(result.metafile, null, 2) + '\n')
  const output = result.metafile.outputs[Object.keys(result.metafile.outputs).find((key) => key.endsWith('.mjs'))]
  return {
    entryPoint: taskRelative(entryPoint),
    output: taskRelative(outfile),
    bytes: output?.bytes ?? fs.statSync(outfile).size,
    inputModules: Object.keys(result.metafile.inputs).length,
    durationMs: Date.now() - startedAt,
    sha256: sha256(fs.readFileSync(outfile)),
  }
}

async function main() {
  const temp = prepareTempEnvironment()
  const environment = { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp }
  ensureDir(BUILD_ROOT)

  const reference = verifyReferenceInputs()

  fs.rmSync(ENGINE_SOURCE_COPY, { recursive: true, force: true })
  ensureDir(ENGINE_SOURCE_COPY)
  fs.cpSync(path.join(ENGINE_SNAPSHOT, 'src'), ENGINE_SOURCE_COPY, { recursive: true })
  const tsconfigFile = writeTsconfig(ENGINE_SOURCE_COPY)

  const typecheck = runTypecheck(tsconfigFile, environment)

  const esbuild = require(path.join(APP_NODE_MODULES, 'esbuild'))
  const publicBuild = await bundle(
    esbuild,
    path.join(ENGINE_SOURCE_COPY, 'public.ts'),
    PUBLIC_BUNDLE,
    path.join(BUILD_ROOT, 'public-engine.meta.json'),
  )
  const internalBuild = await bundle(
    esbuild,
    path.join(ENGINE_SOURCE_COPY, 'internal.ts'),
    INTERNAL_BUNDLE,
    path.join(BUILD_ROOT, 'internal-engine.meta.json'),
  )

  const inspectionEntry = path.join(APP_ROOT, 'src', 'renderer', 'services', 'performance', 'inspection', 'index.ts')
  const profileEntry = path.join(APP_ROOT, 'src', 'renderer', 'services', 'performance', 'profile', 'index.ts')
  const utaEntry = path.join(BUILD_ROOT, 'uta-adapter-entry.ts')
  const importPath = (absolute) => absolute.replaceAll('\\', '/')
  fs.writeFileSync(
    utaEntry,
    [
      `export { inspectCoreModel } from ${JSON.stringify(importPath(inspectionEntry))}`,
      `export { buildModelCapabilityProfile, SEMANTIC_CHANNEL_ORDER, STANDARD_PARAMETER_IDS } from ${JSON.stringify(importPath(profileEntry))}`,
      '',
    ].join('\n'),
  )
  const utaAdapterBuild = await bundle(
    esbuild,
    utaEntry,
    UTA_ADAPTER_BUNDLE,
    path.join(BUILD_ROOT, 'uta-adapter.meta.json'),
  )

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    taskRoot: TASK_ROOT,
    reference: {
      sourceHead: reference.sourceHead,
      manifestSha256: reference.manifestSha256,
      fileCount: reference.fileCount,
      totalBytes: reference.totalBytes,
      standaloneNoticeFound: reference.standaloneNoticeFound,
      noticeFiles: reference.noticeFiles,
      licenseHashes: reference.licenseHashes,
    },
    toolchain: {
      node: process.version,
      typescript: require(path.join(APP_NODE_MODULES, 'typescript', 'package.json')).version,
      esbuild: require(path.join(APP_NODE_MODULES, 'esbuild', 'package.json')).version,
      tempDirectory: taskRelative(temp),
    },
    typecheck,
    bundles: {
      public: publicBuild,
      internal: internalBuild,
      utaAdapter: utaAdapterBuild,
    },
    note: 'Bundles are built from the pinned local source snapshot, not from an official npm release. The internal bundle is produced for surface comparison only and is never consumed by the experiment driver.',
  }
  const reportFile = path.join(BUILD_ROOT, 'build-report.json')
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({
    report: taskRelative(reportFile),
    referenceSourceHead: reference.sourceHead,
    typecheckExitCode: typecheck.exitCode,
    publicBytes: publicBuild.bytes,
    publicModules: publicBuild.inputModules,
    internalBytes: internalBuild.bytes,
    internalModules: internalBuild.inputModules,
    utaAdapterBytes: utaAdapterBuild.bytes,
    utaAdapterModules: utaAdapterBuild.inputModules,
  }, null, 2))

  if (typecheck.exitCode !== 0) {
    console.error(typecheck.stdout)
    console.error(typecheck.stderr)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
