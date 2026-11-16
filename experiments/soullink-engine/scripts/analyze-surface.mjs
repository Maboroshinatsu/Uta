#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  BUILD_ROOT,
  ENGINE_SOURCE_COPY,
  ENGINE_SNAPSHOT,
  INTERNAL_BUNDLE,
  PUBLIC_BUNDLE,
  taskRelative,
} from './lib/paths.mjs'

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function walkTypeScriptFiles(root) {
  const result = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue
        visit(absolute)
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        result.push(absolute)
      }
    }
  }
  visit(root)
  return result.sort()
}

function stripComments(source) {
  let result = ''
  let index = 0
  while (index < source.length) {
    const character = source[index]
    const next = source[index + 1]
    if (character === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }
    if (character === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1
      index += 2
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      const quote = character
      result += character
      index += 1
      while (index < source.length) {
        result += source[index]
        if (source[index] === '\\') {
          index += 1
          if (index < source.length) result += source[index]
        } else if (source[index] === quote) {
          index += 1
          break
        }
        index += 1
      }
      continue
    }
    result += character
    index += 1
  }
  return result
}

function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = []
  if (base.endsWith('.js')) candidates.push(base.slice(0, -3) + '.ts')
  candidates.push(base + '.ts', path.join(base, 'index.ts'), base)
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  throw new Error(`cannot resolve ${specifier} from ${fromFile}`)
}

function buildGraph(files) {
  const graph = new Map()
  const externalImports = []
  for (const file of files) {
    const source = stripComments(fs.readFileSync(file, 'utf8'))
    const dependencies = new Set()
    for (const match of source.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)) {
      const specifier = match[1]
      if (!specifier.startsWith('.')) {
        if (specifier !== 'node:fs') externalImports.push({ file: taskRelative(file), specifier })
        continue
      }
      dependencies.add(resolveSpecifier(file, specifier))
    }
    graph.set(file, dependencies)
  }
  return { graph, externalImports }
}

function closure(graph, entry) {
  const seen = new Set()
  const stack = [entry]
  while (stack.length > 0) {
    const file = stack.pop()
    if (seen.has(file)) continue
    seen.add(file)
    for (const dependency of graph.get(file) ?? []) stack.push(dependency)
  }
  return [...seen].sort()
}

function countLines(files) {
  let lines = 0
  let nonEmptyLines = 0
  let bytes = 0
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    bytes += Buffer.byteLength(source)
    const split = source.split(/\r?\n/)
    lines += split.length
    nonEmptyLines += split.filter((line) => line.trim() !== '').length
  }
  return { files: files.length, lines, nonEmptyLines, bytes }
}

async function exportSurface(bundle) {
  const module = await import(pathToFileURL(bundle).href)
  return Object.keys(module).sort()
}

async function main() {
  const files = walkTypeScriptFiles(ENGINE_SOURCE_COPY)
  const { graph, externalImports } = buildGraph(files)
  const publicEntry = path.join(ENGINE_SOURCE_COPY, 'public.ts')
  const internalEntry = path.join(ENGINE_SOURCE_COPY, 'internal.ts')
  const runtimeEntry = path.join(ENGINE_SOURCE_COPY, 'runtime', 'SoullinkRuntime.ts')
  if (!fs.existsSync(publicEntry) || !fs.existsSync(internalEntry) || !fs.existsSync(runtimeEntry)) {
    throw new Error('engine source copy is incomplete; run build-engine.mjs first')
  }

  const publicClosure = closure(graph, publicEntry)
  const internalClosure = closure(graph, internalEntry)
  const runtimeClosure = closure(graph, runtimeEntry)
  const publicExports = await exportSurface(PUBLIC_BUNDLE)
  const internalExports = await exportSurface(INTERNAL_BUNDLE)
  const publicOnly = publicExports.filter((name) => !internalExports.includes(name))
  const internalOnly = internalExports.filter((name) => !publicExports.includes(name))

  const packageJson = JSON.parse(fs.readFileSync(path.join(ENGINE_SNAPSHOT, 'package.json'), 'utf8'))
  const licenseFile = path.join(ENGINE_SNAPSHOT, 'LICENSE')
  const licenseText = fs.readFileSync(licenseFile, 'utf8')
  const readmeFile = path.join(ENGINE_SNAPSHOT, 'README.md')

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    package: {
      name: packageJson.name,
      version: packageJson.version,
      license: packageJson.license,
      type: packageJson.type,
      sideEffects: packageJson.sideEffects,
      exports: packageJson.exports,
      runtimeDependencies: Object.keys(packageJson.dependencies ?? {}),
      peerDependencies: Object.keys(packageJson.peerDependencies ?? {}),
      devDependencies: Object.keys(packageJson.devDependencies ?? {}),
      files: packageJson.files,
      repository: packageJson.repository,
    },
    license: {
      file: taskRelative(licenseFile),
      bytes: Buffer.byteLength(licenseText),
      sha256: sha256(licenseText),
      firstLine: licenseText.split(/\r?\n/, 1)[0],
      containsApache20: /Apache License\s+Version 2\.0/i.test(licenseText),
      standaloneNoticeFound: fs.existsSync(path.join(ENGINE_SNAPSHOT, 'NOTICE')),
      noticeFilesInSnapshot: [],
    },
    readme: {
      file: taskRelative(readmeFile),
      bytes: fs.statSync(readmeFile).size,
    },
    source: {
      all: countLines(files),
      publicClosure: countLines(publicClosure),
      internalClosure: countLines(internalClosure),
      runtimeClosure: countLines(runtimeClosure),
      externalImports,
      publicClosureFiles: publicClosure.map(taskRelative),
      runtimeClosureFiles: runtimeClosure.map(taskRelative),
    },
    exports: {
      publicCount: publicExports.length,
      internalCount: internalExports.length,
      publicExports,
      publicOnly,
      internalOnly,
      publicIsStrictSubset: publicOnly.length === 0,
    },
  }

  if (!fs.existsSync(path.join(ENGINE_SNAPSHOT, 'NOTICE'))) report.license.noticeFilesInSnapshot = []

  const reportFile = path.join(BUILD_ROOT, 'surface-report.json')
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({
    report: taskRelative(reportFile),
    package: `${report.package.name}@${report.package.version}`,
    license: report.package.license,
    runtimeDependencies: report.package.runtimeDependencies.length,
    exportsKeys: Object.keys(report.package.exports),
    sourceFiles: report.source.all.files,
    publicClosure: report.source.publicClosure,
    internalClosure: report.source.internalClosure,
    runtimeClosure: report.source.runtimeClosure,
    publicExports: report.exports.publicCount,
    internalExports: report.exports.internalCount,
    publicIsStrictSubset: report.exports.publicIsStrictSubset,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
