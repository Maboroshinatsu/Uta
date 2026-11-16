import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const TASK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
export const IGNORED_ROOT = path.join(TASK_ROOT, '.uta-task')
export const REFERENCE_ROOT = path.join(IGNORED_ROOT, 'reference-inputs')
export const REFERENCE_MANIFEST = path.join(REFERENCE_ROOT, 'manifest.json')
export const ENGINE_SNAPSHOT = path.join(REFERENCE_ROOT, 'soullink', 'packages', 'engine')
export const MODEL_INPUT = path.join(IGNORED_ROOT, 'model-input')
export const BUILD_ROOT = path.join(IGNORED_ROOT, 'soullink-build')
export const RUN_ROOT = path.join(IGNORED_ROOT, 'soullink-runs')
export const TEMP_ROOT = path.join(IGNORED_ROOT, 'tmp')
export const APP_ROOT = path.join(TASK_ROOT, 'app')
export const APP_NODE_MODULES = path.join(APP_ROOT, 'node_modules')
export const PUBLIC_BUNDLE = path.join(BUILD_ROOT, 'public-engine.mjs')
export const INTERNAL_BUNDLE = path.join(BUILD_ROOT, 'internal-engine.mjs')
export const UTA_ADAPTER_BUNDLE = path.join(BUILD_ROOT, 'uta-adapter.mjs')
export const ENGINE_SOURCE_COPY = path.join(BUILD_ROOT, 'engine-src')

export function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true })
}

export function prepareTempEnvironment() {
  ensureDir(TEMP_ROOT)
  process.env.TEMP = TEMP_ROOT
  process.env.TMP = TEMP_ROOT
  process.env.TMPDIR = TEMP_ROOT
  return TEMP_ROOT
}

export function requirePath(target, description) {
  if (!fs.existsSync(target)) {
    throw new Error(`${description} is missing: ${target}`)
  }
  return target
}

export function taskRelative(absolute) {
  return path.relative(TASK_ROOT, absolute).replaceAll('\\', '/')
}
