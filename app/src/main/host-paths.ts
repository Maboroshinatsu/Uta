import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export interface HostPathOverrides {
  harnessExe?: string
  harnessCli?: string
  harnessHome?: string
  opencodeExe?: string
  zcodeCli?: string
  nodeExe?: string
  claudeExe?: string
  claudeJs?: string
  codexExe?: string
}

export interface HostPaths {
  harnessExe: string
  harnessCli: string
  harnessHome: string
  opencodeExe: string
  zcodeCli: string
  nodeExe: string
  claudeExe: string
  claudeJs: string
  codexExe: string
}

const DEFAULT_HARNESS_EXE = 'D:/DeepSeek-Harness/DeepSeek Harness.exe'
const DEFAULT_HARNESS_CLI =
  'D:/DeepSeek-Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'
const DEFAULT_OPENCODE_EXE = 'D:/OpenCode/opencode-cli.exe'
const DEFAULT_ZCODE_CLI = 'D:/Zcode/resources/glm/zcode.cjs'
const DEFAULT_NODE_EXE = 'C:/Program Files/nodejs/node.exe'

const ENV_KEYS: Record<keyof HostPathOverrides, string> = {
  harnessExe: 'UTA_HARNESS_EXE',
  harnessCli: 'UTA_HARNESS_CLI',
  harnessHome: 'UTA_DSH_HOME',
  opencodeExe: 'UTA_OPENCODE_EXE',
  zcodeCli: 'UTA_ZCODE_CLI',
  nodeExe: 'UTA_NODE_EXE',
  claudeExe: 'UTA_CLAUDE_EXE',
  claudeJs: 'UTA_CLAUDE_JS',
  codexExe: 'UTA_CODEX_EXE',
}

function isFile(file: string | undefined): file is string {
  if (!file) return false
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

function firstFile(...candidates: Array<string | undefined>): string {
  return candidates.find(isFile) ?? ''
}

function isShellShim(file: string): boolean {
  if (['.cmd', '.bat', '.ps1'].includes(path.extname(file).toLowerCase())) return true
  if (process.platform !== 'win32' || path.extname(file)) return false
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const header = Buffer.alloc(2)
    return fs.readSync(fd, header, 0, 2, 0) === 2 && header.toString() === '#!'
  } catch { return false }
  finally { if (fd !== undefined) fs.closeSync(fd) }
}

/** spawn(..., { shell: false }) cannot launch cmd/bat shims; never advertise them as executables. */
function firstNativeFile(...candidates: Array<string | undefined>): string {
  return candidates.find(file => isFile(file) && !isShellShim(file)) ?? ''
}

export function readHostPathOverrides(file: string): HostPathOverrides {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const record = raw as Record<string, unknown>
  const result: HostPathOverrides = {}
  for (const key of Object.keys(ENV_KEYS) as Array<keyof HostPathOverrides>) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) result[key] = value.trim()
  }
  return result
}

function writeHostPathOverrides(runtimeDir: string, overrides: HostPathOverrides): void {
  fs.mkdirSync(runtimeDir, { recursive: true })
  const configFile = path.join(runtimeDir, 'host-paths.json')
  const temp = `${configFile}.tmp.${process.pid}.${randomUUID()}`
  try {
    fs.writeFileSync(temp, JSON.stringify(overrides, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 })
    fs.renameSync(temp, configFile)
  } catch (error) {
    try { fs.unlinkSync(temp) } catch { /* ignore */ }
    throw error
  }
}

export function writeHostPathOverride(
  runtimeDir: string,
  hostId: string,
  file: string,
): keyof HostPathOverrides {
  if (!isFile(file)) throw new Error('宿主路径不是可读文件')
  const extension = path.extname(file).toLowerCase()
  if (isShellShim(file)) throw new Error('请选择原生程序或 JS 入口，不支持 shell 启动脚本')
  let key: keyof HostPathOverrides
  if (hostId === 'deepseek-harness') key = 'harnessExe'
  else if (hostId === 'opencode') key = 'opencodeExe'
  else if (hostId === 'zcode') key = 'zcodeCli'
  else if (hostId === 'claude-code') key = ['.js', '.cjs', '.mjs'].includes(extension) ? 'claudeJs' : 'claudeExe'
  else if (hostId === 'codex') key = 'codexExe'
  else if (hostId === 'node') key = 'nodeExe'
  else throw new Error('这个宿主不支持手动路径')
  if (key === 'claudeJs' || key === 'zcodeCli') {
    if (!['.js', '.cjs', '.mjs'].includes(extension)) throw new Error('请选择 JS 入口文件')
  } else if (!['.exe', '.com', ''].includes(extension)) {
    throw new Error('请选择原生可执行文件')
  }
  const configFile = path.join(runtimeDir, 'host-paths.json')
  const overrides = readHostPathOverrides(configFile)
  if (key === 'claudeJs') delete overrides.claudeExe
  if (key === 'claudeExe') delete overrides.claudeJs
  overrides[key] = file
  writeHostPathOverrides(runtimeDir, overrides)
  return key
}

export function writeDshHomeOverride(runtimeDir: string, directory: string): string {
  let stat: fs.Stats
  try {
    stat = fs.statSync(directory)
  } catch {
    throw new Error('DSH 数据目录不存在')
  }
  if (!stat.isDirectory()) throw new Error('请选择 DSH 数据目录，而不是文件')
  // 用户可能直接选中 profiles/desktop；统一保存为 DSH_HOME（.dsh）。
  const normalized = path.basename(directory).toLowerCase() === 'desktop' &&
    path.basename(path.dirname(directory)).toLowerCase() === 'profiles'
    ? path.dirname(path.dirname(directory))
    : directory
  if (path.basename(normalized).toLowerCase() !== '.dsh' &&
      !fs.existsSync(path.join(normalized, 'profiles'))) {
    throw new Error('请选择包含 profiles 的 .dsh 数据目录')
  }
  const configFile = path.join(runtimeDir, 'host-paths.json')
  const overrides = readHostPathOverrides(configFile)
  overrides.harnessHome = path.resolve(normalized)
  writeHostPathOverrides(runtimeDir, overrides)
  return overrides.harnessHome
}

export function findOnPath(names: string[], env: NodeJS.ProcessEnv = process.env): string {
  const pathValue = env.PATH || env.Path || ''
  const dirs = pathValue.split(path.delimiter).filter(Boolean)
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name)
      if (isFile(candidate) && !isShellShim(candidate)) return candidate
    }
  }
  return ''
}

function configured(
  key: keyof HostPathOverrides,
  overrides: HostPathOverrides,
  env: NodeJS.ProcessEnv,
): string {
  const envValue = env[ENV_KEYS[key]]
  return (typeof envValue === 'string' && envValue.trim()) || overrides[key] || ''
}

function findCodexInstall(env: NodeJS.ProcessEnv): string {
  const base = path.join(env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin')
  try {
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(base, entry.name, 'codex.exe'))
      .filter(isFile)
      .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0]?.file ?? ''
  } catch {
    return ''
  }
}

/** Electron installers put the app in different per-user/program-files folders. */
function commonHarnessInstallCandidates(env: NodeJS.ProcessEnv): string[] {
  const local = env.LOCALAPPDATA || ''
  const programFiles = env.PROGRAMFILES || env.ProgramFiles || ''
  const programFilesX86 = env['PROGRAMFILES(X86)'] || env['ProgramFiles(x86)'] || ''
  return [
    local && path.join(local, 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe'),
    local && path.join(local, 'Programs', 'deepseek-harness', 'DeepSeek Harness.exe'),
    programFiles && path.join(programFiles, 'DeepSeek Harness', 'DeepSeek Harness.exe'),
    programFilesX86 && path.join(programFilesX86, 'DeepSeek Harness', 'DeepSeek Harness.exe'),
    DEFAULT_HARNESS_EXE,
  ].filter(Boolean) as string[]
}

function directoryExists(directory: string): boolean {
  try {
    return fs.statSync(directory).isDirectory()
  } catch {
    return false
  }
}

export function resolveHostPaths(
  appData: string,
  runtimeDir = path.join(appData, 'uta'),
  env: NodeJS.ProcessEnv = process.env,
): HostPaths {
  const overrides = readHostPathOverrides(path.join(runtimeDir, 'host-paths.json'))
  const harnessExe = firstNativeFile(
    configured('harnessExe', overrides, env),
    findOnPath(['DeepSeek Harness.exe', 'DeepSeek-Harness.exe'], env),
    ...commonHarnessInstallCandidates(env),
  )
  const harnessCli = firstFile(
    configured('harnessCli', overrides, env),
    harnessExe
      ? path.join(
        path.dirname(harnessExe),
        'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js',
      )
      : '',
    DEFAULT_HARNESS_CLI,
  )
  const configuredHome = configured('harnessHome', overrides, env)
  // 显式 DSH_HOME / 用户选择的数据目录优先；即使它暂时不存在，也不能悄悄
  // 改用另一个 .dsh，否则会把插件装到用户没选的那份 profile。
  const explicitHome = configuredHome
    ? path.resolve(configuredHome)
    : env.DSH_HOME
      ? path.resolve(env.DSH_HOME)
      : ''
  const fallbackHomes = [
    env.USERPROFILE ? path.join(env.USERPROFILE, '.dsh') : '',
    env.HOME ? path.join(env.HOME, '.dsh') : '',
    path.join(os.homedir(), '.dsh'),
  ].filter(Boolean) as string[]
  const harnessHome = explicitHome || fallbackHomes.find(directoryExists) || fallbackHomes[0] || path.join(os.homedir(), '.dsh')
  const opencodeExe = firstNativeFile(
    configured('opencodeExe', overrides, env),
    findOnPath(['opencode.exe', 'opencode'], env),
    DEFAULT_OPENCODE_EXE,
  )
  const zcodeCli = firstFile(
    configured('zcodeCli', overrides, env),
    findOnPath(['zcode.cjs'], env),
    DEFAULT_ZCODE_CLI,
  )
  const nodeExe = firstNativeFile(
    configured('nodeExe', overrides, env),
    findOnPath(['node.exe', 'node'], env),
    DEFAULT_NODE_EXE,
  )
  const configuredClaudeExe = configured('claudeExe', overrides, env)
  const configuredClaudeJs = configured('claudeJs', overrides, env)
  const claudeExe = isFile(configuredClaudeJs) && !configuredClaudeExe ? '' : firstNativeFile(
    configuredClaudeExe,
    path.join(env.USERPROFILE || env.HOME || os.homedir(), '.local', 'bin', 'claude.exe'),
    path.join(env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    findOnPath(['claude.exe', 'claude'], env),
  )
  const claudeJs = firstFile(
    configuredClaudeJs,
    path.join(env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
  )
  const codexExe = firstNativeFile(
    configured('codexExe', overrides, env),
    findCodexInstall(env),
    findOnPath(['codex.exe', 'codex'], env),
  )
  return { harnessExe, harnessCli, harnessHome, opencodeExe, zcodeCli, nodeExe, claudeExe, claudeJs, codexExe }
}
