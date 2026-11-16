/** Uta 主进程与宿主插件共用的运行目录契约，不修改宿主 APPDATA。 */
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import fs from 'node:fs'

function absoluteOverride(value, name) {
  if (!value) return ''
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`)
  return path.resolve(value)
}

function appDataRoot(env) {
  if (env.APPDATA) return env.APPDATA
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support')
  return env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
}

function directoryIdentity(value) {
  let resolved
  try {
    resolved = fs.realpathSync.native(value)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    // A new profile may not exist yet, but one of its parents can be a junction.
    const parent = path.dirname(value)
    resolved = parent === value ? value : path.join(directoryIdentity(parent), path.basename(value))
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function sameDirectory(a, b) {
  return a === b || directoryIdentity(a) === directoryIdentity(b)
}

export function resolveRuntimePaths(env = process.env, options = {}) {
  const appData = options.appData || appDataRoot(env)
  const stableData = path.resolve(appData, 'uta')
  const endpoint = absoluteOverride(env.UTA_ENDPOINT_FILE, 'UTA_ENDPOINT_FILE')
  const legacyEndpoint = absoluteOverride(env.DESKPET_ENDPOINT_FILE, 'DESKPET_ENDPOINT_FILE')
  const selectedEndpoint = endpoint || legacyEndpoint
  const explicitRuntime = absoluteOverride(env.UTA_RUNTIME_DIR, 'UTA_RUNTIME_DIR')
  const runtimeOverride = explicitRuntime || (selectedEndpoint ? path.dirname(selectedEndpoint) : '')
  const profile = env.UTA_PROFILE || (env.UTA_USER_DATA_DIR || (runtimeOverride && !sameDirectory(runtimeOverride, stableData)) ? 'custom' : 'stable')
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile)) {
    throw new Error('UTA_PROFILE must contain 1-64 lowercase letters, digits, hyphens or underscores')
  }
  const userData = absoluteOverride(env.UTA_USER_DATA_DIR, 'UTA_USER_DATA_DIR') ||
    (profile === 'stable' ? stableData : path.resolve(appData, 'uta-development', profile))
  if (endpoint && legacyEndpoint && !sameDirectory(endpoint, legacyEndpoint)) {
    throw new Error('UTA_ENDPOINT_FILE and DESKPET_ENDPOINT_FILE point at different instances')
  }
  if (explicitRuntime && selectedEndpoint && !sameDirectory(path.dirname(selectedEndpoint), explicitRuntime)) {
    throw new Error('The endpoint file must be inside UTA_RUNTIME_DIR')
  }
  const runtimeDir = runtimeOverride || userData
  const usesStableData = sameDirectory(userData, stableData)
  const usesStableRuntime = sameDirectory(runtimeDir, stableData)
  if (profile !== 'stable' && (usesStableData || usesStableRuntime)) {
    throw new Error('A development profile cannot use the stable Uta data directory')
  }
  if (usesStableData !== usesStableRuntime) {
    throw new Error('Stable Uta data and runtime directories must be used together')
  }
  return {
    profile,
    userData,
    runtimeDir,
    hooksDir: path.join(runtimeDir, 'hooks'),
    endpointFile: selectedEndpoint || path.join(runtimeDir, 'runtime-endpoint.json'),
    isStable: profile === 'stable' && usesStableData && usesStableRuntime,
    explicit: ['UTA_PROFILE', 'UTA_USER_DATA_DIR', 'UTA_RUNTIME_DIR', 'UTA_ENDPOINT_FILE', 'DESKPET_ENDPOINT_FILE']
      .some((key) => !!env[key]),
  }
}

/** 源码默认按源码目录产生开发 profile；只有打包 exe 默认进入 stable。 */
export function resolveAppEnvironment(env = process.env, options) {
  const selected = { ...env }
  if (!selected.UTA_PROFILE && !selected.UTA_USER_DATA_DIR && options.isPackaged &&
      (selected.UTA_RUNTIME_DIR || selected.UTA_ENDPOINT_FILE || selected.DESKPET_ENDPOINT_FILE)) {
    selected.UTA_PROFILE = 'custom'
  }
  if (!selected.UTA_PROFILE && !selected.UTA_USER_DATA_DIR && !options.isPackaged) {
    const source = path.resolve(options.sourceDir)
    const digest = crypto.createHash('sha256').update(source).digest('hex').slice(0, 12)
    selected.UTA_PROFILE = `dev-${digest}`
  }
  return resolveRuntimePaths(selected, { appData: options.appData })
}
