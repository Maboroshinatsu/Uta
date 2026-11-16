import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { findOnPath, resolveHostPaths, type HostPaths } from './host-paths'
import type {
  OnboardingDetection,
  OnboardingHost,
  OnboardingHostId,
  OnboardingInstallResult,
  OnboardingStage,
  OnboardingStageId,
  OnboardingStageState,
} from '../shared/host-onboarding-contracts'

const CODEX_PLUGIN_ID = 'uta-deskpet@uta'
const DSH_PLUGIN_NAME = '@uta/deepseek-harness-plugin'
const CODEX_NAME = 'uta-deskpet'
const COMMAND_TIMEOUT_MS = 30_000

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
  /** The timeout fired but the child could not be confirmed stopped. */
  stillRunning?: boolean
}

export interface HostOnboardingDeps {
  appData: string
  runtimeDir: string
  env?: NodeJS.ProcessEnv
  resourcesPath?: string
  appPath?: string
  isPackaged?: boolean
  exists?: (file: string) => boolean
  run?: (file: string, args: string[], options: { env: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<CommandResult>
  codexExe?: string
  harnessExe?: string
  harnessCli?: string
  qoderExe?: string
  antigravityExe?: string
  claudeExe?: string
  assetRoot?: string
  now?: () => Date
  isRuntimeReady?: () => boolean
  getSessions?: (hostId: string) => Array<{ sessionId: string; label: string; selected: boolean }>
  getSelectedWorkspace?: (hostId: string) => string | undefined
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

function directoryIdentity(directory: string): string {
  let resolved = path.resolve(directory)
  try { resolved = fs.realpathSync.native(resolved) } catch { /* Missing paths cannot verify an installation. */ }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function defaultRun(
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<CommandResult> {
  return new Promise(resolve => {
    let settled = false
    let closed = false
    let timedOut = false
    let stdout = ''
    let stderr = ''
    let graceTimer: ReturnType<typeof setTimeout> | null = null
    const finish = (result: CommandResult) => {
      if (settled) return
      settled = true
      if (graceTimer) clearTimeout(graceTimer)
      resolve(result)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(file, args, {
        env: options.env,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      finish({ code: -2, stdout, stderr: String((error as Error)?.message ?? error) })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill() } catch { /* already gone */ }
      if (process.platform === 'win32' && child.pid) {
        try {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          }).on('error', () => { /* grace timer below still applies */ })
        } catch { /* grace timer below still applies */ }
      }
      // Do not report a timeout as settled while the old process can still
      // write config.toml. Callers must treat stillRunning as "do not restore".
      graceTimer = setTimeout(() => {
        if (!closed) {
          finish({ code: -1, stdout, stderr: `${stderr}\ncommand timed out`.trim(), stillRunning: true })
        }
      }, 5000)
    }, options.timeoutMs)
    child.stdout?.on('data', chunk => { stdout += String(chunk) })
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    child.on('error', error => {
      clearTimeout(timer)
      finish({ code: -2, stdout, stderr: String((error as Error)?.message ?? error) })
    })
    child.on('close', code => {
      closed = true
      clearTimeout(timer)
      finish({
        code: timedOut ? -1 : (code ?? -1),
        stdout,
        stderr: timedOut ? `${stderr}\ncommand timed out`.trim() : stderr,
        stillRunning: false,
      })
    })
  })
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '').trim()) as T
  } catch {
    return null
  }
}

export function parseCodexPluginList(text: string): {
  name: string
  version: string
  marketplace: string
  installed: boolean
  enabled: boolean
} | null {
  const parsed = parseJson<{ installed?: unknown }>(text)
  if (!parsed || !Array.isArray(parsed.installed)) return null
  for (const item of parsed.installed) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = String(record.name ?? '')
    const pluginId = String(record.pluginId ?? '')
    // Exact identity only: a lookalike such as "uta-deskpet-pro" must not count.
    if (name !== CODEX_NAME && pluginId !== CODEX_PLUGIN_ID) continue
    return {
      name: name || pluginId,
      version: String(record.version ?? ''),
      marketplace: String(record.marketplaceName ?? ''),
      installed: record.installed !== false,
      enabled: record.enabled !== false,
    }
  }
  return null
}

export function parseCodexMcpList(text: string): {
  name: string
  enabled: boolean
} | null {
  const parsed = parseJson<unknown>(text)
  if (!parsed) return null
  const records: unknown[] = []
  if (Array.isArray(parsed)) {
    records.push(...parsed)
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    for (const key of ['servers', 'installed', 'mcpServers']) {
      const value = obj[key]
      if (Array.isArray(value)) {
        records.push(...value)
      } else if (value && typeof value === 'object') {
        for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
          if (entry && typeof entry === 'object') {
            records.push({ name, ...(entry as Record<string, unknown>) })
          }
        }
      }
    }
  }
  for (const item of records) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = String(record.name ?? record.serverName ?? record.id ?? '').trim()
    const normalized = name.toLowerCase().replace(/_/g, '-')
    // Exact identity only: "uta-deskpet-pro" is a different MCP server.
    if (normalized !== CODEX_NAME && normalized !== CODEX_PLUGIN_ID) continue
    const disabled = record.enabled === false || record.disabled === true
    return { name, enabled: !disabled }
  }
  return null
}

const DEFAULT_CODEX_HOOK_EVENTS = [
  'sessionstart',
  'userpromptsubmit',
  'pretooluse',
  'permissionrequest',
  'posttooluse',
  'stop',
  'sessionend',
  'interrupt',
]

export interface CodexHookTrust {
  state: 'none' | 'partial' | 'trusted'
  trusted: number
  total: number
  missing: string[]
}

function normalizeHookEvent(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '')
}

/**
 * Codex records trust per hook definition. One trusted_hash must not make the
 * whole plugin look trusted; count every required event and report partial.
 */
export function codexHookTrust(
  configText: string,
  requiredEvents: string[] = DEFAULT_CODEX_HOOK_EVENTS,
): CodexHookTrust {
  const required = [...new Set(requiredEvents.map(normalizeHookEvent).filter(Boolean))]
  const trusted = new Set<string>()
  let currentEvent: string | null = null
  let currentTrusted = false
  const flush = (): void => {
    if (currentEvent && currentTrusted) trusted.add(currentEvent)
  }
  for (const rawLine of configText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      flush()
      currentEvent = null
      currentTrusted = false
      if (!/uta-deskpet/i.test(line)) continue
      const eventMatch = line.match(/#hooks\[\d+\][^"\]]*?:([a-z_]+):/i)
      currentEvent = eventMatch ? normalizeHookEvent(eventMatch[1]) : null
      continue
    }
    if (currentEvent && (
      /^trusted_hash\s*=\s*\S+/i.test(line) ||
      /^trusted\s*=\s*true\b/i.test(line)
    )) currentTrusted = true
  }
  flush()

  const missing = required.filter(event => !trusted.has(event))
  const trustedCount = required.length - missing.length
  return {
    state: trustedCount === 0 ? 'none' : missing.length === 0 ? 'trusted' : 'partial',
    trusted: trustedCount,
    total: required.length,
    missing,
  }
}

export function codexHooksTrusted(
  configText: string,
  requiredEvents: string[] = DEFAULT_CODEX_HOOK_EVENTS,
): boolean {
  return codexHookTrust(configText, requiredEvents).state === 'trusted'
}

function stage(id: OnboardingStageId, state: OnboardingStageState, detail: string): OnboardingStage {
  return { id, state, detail }
}

export function createHostOnboarding(deps: HostOnboardingDeps) {
  const env = deps.env ?? process.env
  const userHome = env.USERPROFILE || env.HOME || os.homedir()
  const opencodeConfigDir = env.OPENCODE_CONFIG_DIR?.trim()
    ? path.resolve(env.OPENCODE_CONFIG_DIR.trim())
    : path.join(env.XDG_CONFIG_HOME || path.join(userHome, '.config'), 'opencode')
  const exists = deps.exists ?? isFile
  const run = deps.run ?? defaultRun
  const now = deps.now ?? (() => new Date())
  const codexHome = env.CODEX_HOME && env.CODEX_HOME.trim()
    ? path.resolve(env.CODEX_HOME)
    : path.join(userHome, '.codex')
  const assetRoot = deps.assetRoot ?? (deps.isPackaged
    ? path.join(deps.resourcesPath ?? '', 'uta-plugins')
    : path.join(deps.appPath ?? '', '..', 'plugin', 'dist'))
  const codexMarketplace = path.join(assetRoot, 'codex-marketplace')
  const dshPlugin = path.join(assetRoot, 'deepseek-harness')

  /**
   * 用户可以在引导里重新选择宿主程序/数据目录，所以检测与安装都不能复用
   * 工厂创建时的静态路径，必须每次重新读取 host-paths.json。
   */
  function currentHostPaths(): HostPaths {
    const resolved = resolveHostPaths(deps.appData, deps.runtimeDir, env)
    const harnessExe = deps.harnessExe !== undefined ? deps.harnessExe : resolved.harnessExe
    const harnessCli = deps.harnessCli !== undefined
      ? deps.harnessCli
      : deps.harnessExe !== undefined
        ? (deps.harnessExe
          ? path.join(
            path.dirname(deps.harnessExe),
            'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js',
          )
          : '')
        : resolved.harnessCli
    return { ...resolved, codexExe: deps.codexExe ?? resolved.codexExe, harnessExe, harnessCli }
  }

  function currentDshHome(): string {
    return currentHostPaths().harnessHome
  }

  /**
   * Qoder/Antigravity 没有稳定的 CLI 入口，但桌面版安装目录相对固定。
   * 只做存在性判断，不启动、不改写它们。
   */
  function desktopHostExe(hostId: 'qoder' | 'antigravity'): string {
    const injected = hostId === 'qoder' ? deps.qoderExe : deps.antigravityExe
    if (injected !== undefined) return injected && exists(injected) ? injected : ''
    const local = env.LOCALAPPDATA || env.LocalAppData || ''
    const programFiles = env.PROGRAMFILES || env.ProgramFiles || ''
    const programFilesX86 = env['PROGRAMFILES(X86)'] || env['ProgramFiles(x86)'] || ''
    const names = hostId === 'qoder' ? ['Qoder.exe', 'Qoder CN.exe'] : ['Antigravity.exe']
    const dirs = hostId === 'qoder'
      ? [
          local && path.join(local, 'Programs', 'Qoder'),
          local && path.join(local, 'Programs', 'Qoder CN'),
          local && path.join(local, 'Programs', 'qoder'),
          programFiles && path.join(programFiles, 'Qoder'),
          programFilesX86 && path.join(programFilesX86, 'Qoder'),
          'D:/Qoder CN',
          'D:/Qoder',
        ]
      : [
          local && path.join(local, 'Programs', 'antigravity'),
          local && path.join(local, 'Programs', 'Antigravity'),
          programFiles && path.join(programFiles, 'Antigravity'),
          programFilesX86 && path.join(programFilesX86, 'Antigravity'),
          'D:/Antigravity',
        ]
    for (const dir of dirs) {
      if (!dir) continue
      for (const name of names) {
        const candidate = path.join(dir, name)
        if (exists(candidate)) return candidate
      }
    }
    return findOnPath(names, env)
  }

  function hostPresence(): { ids: string[]; qoderExe: string; antigravityExe: string } {
    const current = currentHostPaths()
    const qoderExe = desktopHostExe('qoder')
    const antigravityExe = desktopHostExe('antigravity')
    const ids: string[] = []
    if (current.codexExe && exists(current.codexExe)) ids.push('codex')
    if (current.harnessExe && exists(current.harnessExe)) ids.push('deepseek-harness')
    if ((current.claudeExe && exists(current.claudeExe)) ||
        (current.claudeJs && exists(current.claudeJs))) ids.push('claude-code')
    if (current.zcodeCli && exists(current.zcodeCli)) ids.push('zcode')
    if (current.opencodeExe && exists(current.opencodeExe)) ids.push('opencode')
    if (qoderExe) ids.push('qoder')
    if (antigravityExe) ids.push('antigravity')
    return { ids, qoderExe, antigravityExe }
  }

  async function detectPresence(): Promise<{ ids: string[]; checkedAt: string }> {
    return { ids: hostPresence().ids, checkedAt: now().toISOString() }
  }

  function isDirectory(directory: string): boolean {
    try {
      return fs.statSync(directory).isDirectory()
    } catch {
      return false
    }
  }

  let nodeProbe: Promise<boolean> | null = null
  let nodeProbeAt = 0
  function nodeAvailable(): Promise<boolean> {
    const started = Date.now()
    if (nodeProbe && started - nodeProbeAt < 30_000) return nodeProbe
    nodeProbeAt = started
    nodeProbe = (async () => {
      try {
        const result = await run('node', ['--version'], { env, timeoutMs: 5_000 })
        return result.code === 0 && !result.stillRunning
      } catch {
        return false
      }
    })()
    return nodeProbe
  }

  function runtimeStage(): OnboardingStage {
    const ready = deps.isRuntimeReady?.() ?? true
    return stage('runtime', ready ? 'verified' : 'pending',
      ready ? 'Uta 已就绪，正在自动连接宿主。' : '等待 Uta 启动。')
  }

  function sessionStage(hostId: string): OnboardingStage {
    const sessions = deps.getSessions?.(hostId) ?? []
    if (sessions.length === 0) {
      return stage('session', 'pending', '正在自动寻找聊天；找到后会自动更新。')
    }
    const selected = sessions.find(session => session.selected)
    return stage('session', 'verified',
      selected ? `当前会话：${selected.label || selected.sessionId}` : `检测到 ${sessions.length} 个会话，可在设置中固定。`)
  }

  function manifestVersion(manifest: string): string {
    try {
      const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { version?: unknown }
      return typeof parsed.version === 'string' ? parsed.version : ''
    } catch {
      return ''
    }
  }

  function codexAssetVersion(): string {
    return manifestVersion(path.join(codexMarketplace, 'plugins', 'uta-deskpet', '.codex-plugin', 'plugin.json'))
  }

  const antigravityGlobalTarget = path.join(userHome, '.gemini', 'config', 'plugins', 'uta-deskpet')
  function antigravityManifests() {
    const cwd = deps.getSelectedWorkspace?.('antigravity')
    const local = cwd && path.isAbsolute(cwd) ? path.join(cwd, '.agents', 'plugins', 'uta-deskpet', 'plugin.json') : ''
    const global = [antigravityGlobalTarget, path.join(userHome, '.gemini', 'antigravity', 'plugins', 'uta-deskpet')]
      .map(dir => path.join(dir, 'plugin.json')).find(exists)
    return { workspace: local && exists(local) ? local : undefined, global }
  }

  function codexHookEvents(): string[] {
    const manifest = path.join(codexMarketplace, 'plugins', 'uta-deskpet', '.codex-plugin', 'plugin.json')
    try {
      const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
        hooks?: { hooks?: Record<string, unknown> }
      }
      const events = parsed.hooks?.hooks && typeof parsed.hooks.hooks === 'object'
        ? Object.keys(parsed.hooks.hooks)
        : []
      return events.length > 0 ? events : DEFAULT_CODEX_HOOK_EVENTS
    } catch {
      return DEFAULT_CODEX_HOOK_EVENTS
    }
  }

  async function codexPluginInfo(): Promise<{
    installed: boolean
    enabled: boolean
    version: string
    marketplace: string
    error: string
    mcpRegistered: boolean
    mcpEnabled: boolean
    nodeReady: boolean
    hookTrust: CodexHookTrust
  }> {
    const { codexExe } = currentHostPaths()
    if (!codexExe || !exists(codexExe)) {
      return {
        installed: false, enabled: false, version: '', marketplace: '', error: 'not-found',
        mcpRegistered: false, mcpEnabled: false, nodeReady: false,
        hookTrust: { state: 'none', trusted: 0, total: 0, missing: [] },
      }
    }
    const list = await run(codexExe, ['plugin', 'list', '--json'], { env, timeoutMs: 12_000 })
    const plugin = list.code === 0 ? parseCodexPluginList(list.stdout) : null
    const mcp = await run(codexExe, ['mcp', 'list', '--json'], { env, timeoutMs: 12_000 })
    const mcpEntry = mcp.code === 0 ? parseCodexMcpList(mcp.stdout) : null
    const nodeReady = await nodeAvailable()
    let hookTrust: CodexHookTrust = { state: 'none', trusted: 0, total: 0, missing: [] }
    try {
      hookTrust = codexHookTrust(
        fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'),
        codexHookEvents(),
      )
    } catch {
      hookTrust = { state: 'none', trusted: 0, total: 0, missing: [] }
    }
    return {
      installed: !!plugin?.installed,
      enabled: plugin?.enabled !== false,
      version: plugin?.version ?? '',
      marketplace: plugin?.marketplace ?? '',
      error: list.code === 0 ? '' : (list.stderr || list.stdout || 'plugin-list-failed').trim().slice(0, 300),
      mcpRegistered: !!mcpEntry,
      mcpEnabled: mcpEntry?.enabled === true,
      nodeReady,
      hookTrust,
    }
  }

  async function detectCodex(): Promise<OnboardingHost> {
    const { codexExe } = currentHostPaths()
    const installed = !!codexExe && exists(codexExe)
    let version = ''
    if (installed) {
      const result = await run(codexExe, ['--version'], { env, timeoutMs: 8_000 })
      if (result.code === 0) version = result.stdout.trim().split('\n')[0].slice(0, 80)
    }
    const plugin = installed
      ? await codexPluginInfo()
      : {
          installed: false, enabled: false, version: '', marketplace: '', error: '',
          mcpRegistered: false, mcpEnabled: false, nodeReady: false,
          hookTrust: { state: 'none', trusted: 0, total: 0, missing: [] },
        }
    const hookTrust = plugin.hookTrust
    const hooksDetail = hookTrust.state === 'trusted'
      ? 'hooks 已全部信任；新会话握手后才能确认工具可用。'
      : hookTrust.state === 'partial'
        ? `hooks 只信任了 ${hookTrust.trusted}/${hookTrust.total} 项（缺少 ${hookTrust.missing.join('、')}）；请在 Codex 的 /hooks 里完成其余项。`
        : 'hooks 尚未信任；请在 Codex 的 /hooks 里审查并信任全部 Uta hooks。'
    const toolsDetail = !plugin.installed
      ? '安装插件后检测 MCP 工具。'
      : !plugin.enabled
        ? 'Uta 插件已停用；MCP 不会加载，请先在 Codex 插件列表中启用。'
        : !plugin.nodeReady
          ? '缺少 Node.js：Codex 的 Uta MCP 需要 node 命令，安装 Node 后重新检测。'
          : !plugin.mcpRegistered
            ? '插件已安装，但 MCP 列表里没有 uta-deskpet；请新开会话或重新安装。'
            : !plugin.mcpEnabled
              ? 'MCP 条目已登记但处于停用状态；请在 Codex 的 MCP 设置中启用。'
              : `MCP 已登记并启用；${hooksDetail}`
    const toolsState: OnboardingStageState =
      plugin.installed && plugin.enabled && plugin.mcpRegistered && !plugin.mcpEnabled
        ? 'manual'
        : 'pending'
    const pluginDetail = plugin.installed
      ? `${plugin.version || '版本未知'} · ${plugin.marketplace || '来源未知'}${plugin.enabled ? '' : ' · 已停用'}`
      : '尚未安装 Uta 插件。'
    return {
      id: 'codex',
      name: 'OpenAI Codex',
      description: '官方 plugin / MCP / hooks。安装后新开会话即可同步状态与角色工具。',
      installed,
      executable: installed ? codexExe : '',
      configPath: codexHome,
      autoInstall: true,
      pluginInstalled: plugin.installed,
      pluginVersion: plugin.version,
      stages: [
        stage('detected', installed ? 'verified' : 'failed',
          installed ? `${version || 'codex'} · ${codexExe}` : '没有找到 Codex 可执行文件。'),
        stage('plugin', plugin.installed ? (plugin.enabled ? 'verified' : 'manual') : 'pending', pluginDetail),
        stage('tools', toolsState, toolsDetail),
        runtimeStage(),
        sessionStage('codex'),
        stage('response', 'pending', '可在桌宠里先做本地回应测试；宿主工具调用需要新会话。'),
      ],
      notes: [
        ...(plugin.error ? [`读取插件列表失败：${plugin.error}`] : []),
        ...(plugin.installed && !plugin.enabled ? ['Uta 插件已安装但被停用；请在 Codex 插件列表中启用它。'] : []),
        ...(plugin.installed && !plugin.nodeReady ? ['没有找到 node 命令；Codex 的 Uta MCP 启动会失败。请安装 Node.js 并确认 Codex 的 PATH 能找到 node。'] : []),
        ...(plugin.installed && plugin.mcpRegistered && !plugin.mcpEnabled ? ['Uta MCP 条目存在但被停用；启用后新开会话。'] : []),
        ...(plugin.installed && hookTrust.state === 'partial'
          ? [`Uta hooks 只有 ${hookTrust.trusted}/${hookTrust.total} 项被信任（缺少 ${hookTrust.missing.join('、')}）；在 Codex 的 /hooks 里完成其余项。`]
          : []),
        ...(plugin.installed && hookTrust.state === 'none'
          ? ['首次使用需要在 Codex 输入 /hooks 审查并信任全部 Uta hooks。']
          : []),
        ...(plugin.version && codexAssetVersion() && plugin.version !== codexAssetVersion()
          ? [`已安装 ${plugin.version}，随包版本 ${codexAssetVersion()}；重新安装可更新。`]
          : []),
      ],
      manualSteps: [
        '正常使用 Codex 即可，Uta 会自动识别聊天；固定回复目标是可选操作。',
        '首次使用在 /hooks 中审查并信任 Uta 的 hooks；未信任时 MCP 工具仍可用，但状态不会跟随。',
      ],
    }
  }

  function dshPluginState(profile: string) {
    const linkPath = path.join(profile, 'node_modules', '@uta', 'deepseek-harness-plugin')
    const linkFound = exists(path.join(linkPath, 'package.json'))
    let declared = false
    let dependency = ''
    try {
      const packageFile = JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
        dsh?: { profile?: { bundles?: string[] } }
      }
      dependency = packageFile.dependencies?.[DSH_PLUGIN_NAME] ?? ''
      const bundles = packageFile.dsh?.profile?.bundles ?? []
      declared = !!dependency && bundles.some(bundle => bundle.includes('deepseek-harness'))
    } catch {
      declared = false
    }
    const pluginInstalled = declared && linkFound
    const version = manifestVersion(path.join(linkPath, 'package.json'))
    const assetVersion = manifestVersion(path.join(dshPlugin, 'package.json'))
    const local = /^(?:link|file):(.+)$/.exec(dependency)
    const sourceMatches = !!local &&
      directoryIdentity(path.resolve(profile, local[1])) === directoryIdentity(dshPlugin) &&
      directoryIdentity(linkPath) === directoryIdentity(dshPlugin)
    return { declared, pluginInstalled, version,
      upToDate: pluginInstalled && sourceMatches && !!assetVersion && version === assetVersion }
  }

  async function detectDsh(current = currentHostPaths()): Promise<OnboardingHost> {
    const profile = path.join(current.harnessHome, 'profiles', 'desktop')
    const exeFound = !!current.harnessExe && exists(current.harnessExe)
    const cliFound = !!current.harnessCli && exists(current.harnessCli)
    const profileFound = exists(path.join(profile, 'package.json'))
    const plugin = dshPluginState(profile)
    const { declared, pluginInstalled } = plugin
    const canInstall = exeFound && cliFound && profileFound
    const detectedStage = exeFound
      ? stage('detected', 'verified', current.harnessExe)
      : profileFound
        ? stage('detected', 'manual', '已找到 DSH 数据目录，但没有找到 DSH 程序；请点「选择 DSH 程序」。')
        : stage('detected', 'failed', '没有找到 DeepSeek Harness。请先安装，或点「选择 DSH 程序」。')
    const pluginStage = plugin.upToDate
      ? stage('plugin', 'verified', plugin.version)
      : pluginInstalled
        ? stage('plugin', 'manual', '已安装的插件需要更新，请完全退出 DSH 后更新。')
        : declared
          ? stage('plugin', 'manual', '插件登记存在，但 node_modules 链接缺失；点「安装 Uta 插件」可修复。')
          : canInstall
            ? stage('plugin', 'manual', '点「安装 Uta 插件」写入 desktop profile；安装前请完全退出 DSH。')
            : stage('plugin', 'manual', profileFound
              ? '找不到 DSH 程序的 CLI；请点「选择 DSH 程序」后重新检测。'
              : '请先打开一次 DeepSeek Harness 生成 desktop profile，或选择 DSH 数据目录。')
    const shim = current.harnessExe
      ? path.join(path.dirname(current.harnessExe), 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd')
      : ''
    const manualCommand = shim && exists(shim)
      ? `"${shim}" plugin --profile desktop add "${dshPlugin}"`
      : `dsh plugin --profile desktop add "${dshPlugin}"`
    return {
      id: 'deepseek-harness',
      name: 'DeepSeek Harness',
      description: '原生 Cordis 插件。安装 Uta 插件时会先备份 desktop profile，DSH 运行中不会改写配置。',
      installed: exeFound || profileFound,
      executable: exeFound ? current.harnessExe : '',
      configPath: profile,
      autoInstall: canInstall,
      pluginInstalled,
      pluginVersion: plugin.version,
      installLabel: pluginInstalled && !plugin.upToDate ? '更新 Uta 插件' : '安装 Uta 插件',
      installNote: '会先备份 DSH desktop profile，再调用 DSH 自带 CLI；请先完全退出 DeepSeek Harness。',
      pathActionLabel: '选择 DSH 程序',
      homeActionLabel: '选择 DSH 数据目录',
      stages: [
        detectedStage,
        pluginStage,
        stage('tools', 'manual', 'DSH 原生工具；安装后新会话加载。'),
        runtimeStage(),
        sessionStage('deepseek-harness'),
        stage('response', 'pending', '可在桌宠里先做本地回应测试；宿主工具调用需要新会话。'),
      ],
      notes: [
        '只有你点「安装 Uta 插件」且 DSH 已完全退出时，Uta 才会备份并写入 desktop profile。',
        '插件在随包目录里；如果移动了 Uta 或 DSH 重置了 profile，可以在这页重新安装。',
      ],
      manualSteps: [
        '如果还没有安装 DSH，先安装并打开一次 DeepSeek Harness，让 desktop profile 完成初始化。',
        '完全退出 DeepSeek Harness。',
        `在本页点「安装 Uta 插件」；也可以用 DSH 自带命令手动安装：${manualCommand}`,
        '重新打开 DeepSeek Harness，并新开一个会话。',
        '回到 Uta 设置 → 连接与会话，选择 DeepSeek Harness。',
      ],
    }
  }

  async function detectOtherHosts(): Promise<OnboardingHost[]> {
    const paths = currentHostPaths()
    const presence = hostPresence()
    const claudeCli = deps.claudeExe ?? (paths.claudeExe || paths.claudeJs)
    let claudePlugin: { enabled: boolean; version: string } | null = null
    if (claudeCli && exists(claudeCli)) {
      const js = /\.[cm]?js$/i.test(claudeCli)
      const command = js ? paths.nodeExe : claudeCli
      if (command && exists(command)) {
        try {
          const result = await run(command, [...(js ? [claudeCli] : []), 'plugin', 'list', '--json'], { env, timeoutMs: 5000 })
          const list: unknown = result.code === 0 && !result.stillRunning ? JSON.parse(result.stdout) : null
          const entry = Array.isArray(list) ? list.find(item => item?.id === 'uta-deskpet@uta') : null
          if (entry) claudePlugin = { enabled: entry.enabled === true, version: typeof entry.version === 'string' ? entry.version : '' }
        } catch { /* 无法确认时保留未验证状态，市场目录不是安装证明。 */ }
      }
    }
    const qoderZip = path.join(assetRoot, 'uta-qoder-plugin.zip')
    const antigravityZip = path.join(assetRoot, 'uta-antigravity-plugin.zip')
    const claudeMarket = path.join(assetRoot, 'claude-marketplace')
    const zcodeMarket = path.join(assetRoot, 'zcode-marketplace')
    const opencodePlugin = path.join(assetRoot, 'uta-opencode-plugin')
    const definitions: Array<{
      id: OnboardingHostId
      name: string
      exe: string
      note: string
      detect: boolean
      manualSteps: string[]
      notes?: string[]
    }> = [
      {
        id: 'maibot', name: 'MaiBot 适配器', exe: '',
        note: '通过随包插件把 Uta 的私聊接入 MaiBot；需要手动放入 MaiBot 的插件目录。',
        detect: false,
        manualSteps: [
          '把当前 Uta 随包的 maibot-adapter 文件夹复制到 MaiBot 的 plugins 目录（可改名为 uta-maibot-adapter）。',
          '重启 MaiBot，在插件列表里确认「Uta 桌面宠物适配器」已加载；它只监听 127.0.0.1:8524。',
          '回到 Uta，在设置里确认「MaiBot 适配器」的服务地址是 http://127.0.0.1:8524，再完成绑定。',
        ],
        notes: [
          'Uta 和 MaiBot 在本机回环通信，并通过桌宠绑定自动鉴权。',
          'MaiBot 其他聊天平台的回复不会进入桌宠气泡；Uta 只显示发给它自己的回复。',
        ],
      },
      {
        id: 'qoder', name: 'Qoder', exe: presence.qoderExe,
        note: '已有插件安装方式；本版不自动改写 Qoder 配置。',
        detect: true,
        manualSteps: [
          `桌面版：扩展 → 插件 → 添加插件，选择随包 ZIP：${qoderZip}`,
          `CLI 版：解压 ZIP 后按 README 使用 runtime/launch-qoder-cli.mjs 启动器，明确 CLI 程序和配置目录。`,
          '重启 Qoder 会话后，在连接与会话里选择 Qoder。',
        ],
      },
      {
        id: 'antigravity', name: 'Antigravity', exe: presence.antigravityExe,
        note: '工作区与全局插件；支持一键自动安装，MCP 角色工具就绪。',
        detect: true,
        manualSteps: [
          `解压随包 ZIP：${antigravityZip}`,
          '把解压出的插件目录复制到当前工作区的 .agents\\plugins\\uta-deskpet。',
          '重启 Antigravity 会话后，在连接与会话里选择 Antigravity。',
        ],
      },
      {
        id: 'claude-code', name: 'Claude Code', exe: paths.claudeExe || paths.claudeJs,
        note: 'CLI 插件；支持一键调用 Claude CLI 注册本地市场并安装。',
        detect: true,
        manualSteps: [
          `claude plugin marketplace add "${claudeMarket}"`,
          'claude plugin install uta-deskpet@uta',
          '重启 Claude Code 会话；首次使用按提示确认 hooks。',
        ],
      },
      {
        id: 'zcode', name: 'ZCode', exe: paths.zcodeCli,
        note: '已有插件安装方式；本版不自动改写 ZCode 配置。',
        detect: true,
        manualSteps: [
          `在 ZCode 的 CLI 中执行：plugins marketplace add "${zcodeMarket}"`,
          'plugins install uta-deskpet@uta',
          '重启 ZCode 会话后，在连接与会话里选择 ZCode。',
        ],
      },
      {
        id: 'opencode', name: 'OpenCode', exe: paths.opencodeExe,
        note: '单文件插件；支持一键部署脚本至用户插件目录。',
        detect: true,
        manualSteps: [
          `创建目录 ${path.join(opencodeConfigDir, 'plugins')}（如果还没有）。`,
          `把随包文件复制进去：${opencodePlugin}\\uta-opencode.ts`,
          '重启 OpenCode。',
        ],
      },
    ]
    return definitions.map(item => {
      const installed = item.detect && !!item.exe && exists(item.exe)
      const autoInstall = item.id === 'qoder' || item.id === 'antigravity' || item.id === 'opencode'
        || (item.id === 'claude-code' && !!claudeCli)
      let pluginInstalled = false
      const agManifests = item.id === 'antigravity' ? antigravityManifests() : undefined
      const agManifest = agManifests?.workspace ?? agManifests?.global
      if (item.id === 'antigravity') {
        pluginInstalled = !!agManifest
      } else if (item.id === 'qoder') {
        pluginInstalled = exists(path.join(userHome, '.qoder-cn', 'plugins', 'cache', 'local', 'uta-deskpet', '0.1.0', '.qoder-plugin', 'plugin.json')) ||
          exists(path.join(userHome, '.qoder', 'plugins', 'cache', 'local', 'uta-deskpet', '0.1.0', '.qoder-plugin', 'plugin.json'))
      } else if (item.id === 'opencode') {
        pluginInstalled = exists(path.join(opencodeConfigDir, 'plugins', 'uta-opencode.ts'))
      } else if (item.id === 'claude-code') {
        pluginInstalled = claudePlugin?.enabled === true
      }

      const pluginStage = pluginInstalled
        ? stage('plugin', 'verified', agManifests
          ? [agManifests.workspace && `所选工作区 ${manifestVersion(agManifests.workspace) || '已安装'}`,
            agManifests.global && `全局 ${manifestVersion(agManifests.global) || '已安装'}`].filter(Boolean).join(' · ')
          : '插件已就绪')
        : item.id === 'claude-code' && claudePlugin
          ? stage('plugin', 'manual', '插件已安装但未启用；请在 Claude Code 中启用 uta-deskpet@uta。')
        : autoInstall
          ? stage('plugin', 'pending', '支持一键自动安装')
          : stage('plugin', 'manual', '手动安装；本版不自动配置。')

      const toolsStage = pluginInstalled
        ? stage('tools', 'pending', '已检测到插件文件；请在宿主会话中验证工具与事件。')
        : autoInstall
          ? stage('tools', 'pending', '安装后自动注入 MCP 与钩子')
          : stage('tools', 'manual', '安装后按宿主说明验证。')

      const stages = item.id === 'maibot'
        ? [
            stage('detected', 'verified', '随包提供，无需自动检测。'),
            stage('plugin', 'manual', '把 maibot-adapter 放入 MaiBot 的 plugins 目录。'),
            stage('tools', 'manual', 'MaiBot 加载插件后，本机 8524 端口可访问。'),
            runtimeStage(),
            stage('session', 'pending', '回到 Uta 完成绑定后可用。'),
            stage('response', 'pending', '在 Uta 气泡里发一条消息验证回复。'),
          ]
        : [
            stage('detected', installed ? 'verified' : 'unavailable',
              installed
                ? item.exe
                : item.detect
                  ? '未检测到可执行入口。'
                  : '本版暂不支持自动检测，请按下方手动步骤确认。'),
            pluginStage,
            toolsStage,
            runtimeStage(),
            item.id === 'antigravity' ? stage('session', 'pending', '连接后在设置里选择会话。') : sessionStage(item.id),
            stage('response', 'pending', '使用桌宠本地回应测试。'),
          ]
      return {
        id: item.id,
        name: item.name,
        description: item.note,
        installed,
        executable: installed ? item.exe : '',
        configPath: '',
        autoInstall,
        pluginInstalled,
        pluginVersion: item.id === 'claude-code' ? claudePlugin?.version ?? '' : agManifest ? manifestVersion(agManifest) : '',
        stages,
        notes: item.notes ?? [
          autoInstall
            ? '支持一键自动安装插件并部署所需 hooks 与 MCP 配置。'
            : '保持现有手动接入能力，不在首次引导中自动修改配置。',
          item.detect
            ? '支持检测该宿主的可执行环境。'
            : '这个宿主没有可用的自动检测；显示为未验证不代表安装失败。',
        ],
        manualSteps: item.manualSteps,
      }
    })
  }

  async function detect(): Promise<OnboardingDetection> {
    const [codex, dsh, others] = await Promise.all([detectCodex(), detectDsh(), detectOtherHosts()])
    return {
      hosts: [codex, dsh, ...others],
      runtime: {
        activeHostId: '',
        connected: deps.isRuntimeReady?.() ?? true,
        sessions: deps.getSessions?.('codex') ?? [],
      },
      checkedAt: now().toISOString(),
    }
  }

  function backupCodexConfig(): { ok: boolean; path: string; error: string; existed: boolean } {
    const config = path.join(codexHome, 'config.toml')
    if (!exists(config)) return { ok: true, path: '', error: '', existed: false }
    const stamp = now().toISOString().replace(/[:.]/g, '-')
    const dir = path.join(codexHome, 'uta-backups', stamp)
    try {
      fs.mkdirSync(dir, { recursive: true })
      const target = path.join(dir, 'config.toml')
      fs.copyFileSync(config, target)
      return { ok: true, path: target, error: '', existed: true }
    } catch {
      return { ok: false, path: '', error: '无法备份现有的 Codex 配置。', existed: true }
    }
  }

  function restoreCodexConfig(
    backup: string,
    existedBefore: boolean,
  ): { ok: boolean; error: string; preserved: string; removedCreated: boolean } {
    const target = path.join(codexHome, 'config.toml')
    const stamp = now().toISOString().replace(/[:.]/g, '-')
    const preserved = `${target}.uta-failed-${stamp}`
    let preservedPath = ''
    if (!backup) {
      if (!exists(target)) {
        return { ok: true, error: '', preserved: '', removedCreated: false }
      }
      if (existedBefore) {
        return { ok: false, error: '缺少安装前的 Codex 配置备份，未覆盖当前配置。', preserved: '', removedCreated: false }
      }
      try {
        fs.copyFileSync(target, preserved)
        preservedPath = preserved
        fs.rmSync(target, { force: true })
        return { ok: true, error: '', preserved: preservedPath, removedCreated: true }
      } catch {
        return { ok: false, error: '无法清理本次新建的 Codex 配置。', preserved: preservedPath, removedCreated: false }
      }
    }
    if (exists(target)) {
      try {
        fs.copyFileSync(target, preserved)
        preservedPath = preserved
      } catch {
        // Never overwrite a file whose concurrent changes could not be saved.
        return { ok: false, error: '安装期间 Codex 配置发生变化，无法先保存当前副本，未覆盖。', preserved: '', removedCreated: false }
      }
    }
    const temp = `${target}.uta-restore-${process.pid}-${Date.now()}`
    try {
      fs.copyFileSync(backup, temp)
      fs.renameSync(temp, target)
      return { ok: true, error: '', preserved: preservedPath, removedCreated: false }
    } catch {
      try { fs.rmSync(temp, { force: true }) } catch { /* best effort */ }
      return { ok: false, error: '恢复 Codex 配置失败。', preserved: preservedPath, removedCreated: false }
    }
  }

  function restoreFailureDetail(
    restored: { ok: boolean; error: string; preserved: string; removedCreated: boolean },
    backupPath: string,
  ): string {
    if (restored.ok) {
      if (restored.removedCreated) {
        return restored.preserved
          ? `安装前没有现有 Codex 配置；本次新建的 config.toml 已移走（副本 ${restored.preserved}），可以重试。`
          : '安装前没有现有 Codex 配置；本次新建的 config.toml 已移走，可以重试。'
      }
      if (restored.preserved) {
        return `已恢复安装前的 Codex 配置；安装期间的变化已另存为 ${restored.preserved}，如需保留请手动合并。`
      }
      return backupPath
        ? '已恢复安装前的 Codex 配置；可以重试，或按手动步骤安装。'
        : '安装前没有现有 Codex 配置；本次命令未完成，可以重试。'
    }
    if (restored.preserved) {
      return `${restored.error} 当前配置已另存：${restored.preserved}。请关闭 Codex 后手动恢复。`
    }
    return backupPath
      ? `${restored.error} 备份仍在：${backupPath}。请手动复制回 config.toml 后重试。`
      : `${restored.error} 请打开 Codex 检查 /plugins 后重试。`
  }

  function timedOutDetail(backupPath: string): string {
    return backupPath
      ? `为避免覆盖仍在写入的配置，本次没有自动恢复。安装前备份：${backupPath}。请先完全退出 Codex，再手动检查 /plugins 与 config.toml。`
      : '为避免覆盖仍在写入的配置，本次没有自动恢复。请先完全退出 Codex，再手动检查 /plugins 与 config.toml。'
  }

  let installBlocked: {
    hostId: OnboardingHostId
    backupPath: string
    detail: string
  } | null = null
  const installLockDir = path.join(deps.appData, 'uta-host-locks')
  const installLockFile = path.join(
    installLockDir,
    `${crypto.createHash('sha256').update(path.resolve(codexHome).toLowerCase()).digest('hex').slice(0, 32)}.json`,
  )
  const legacyInstallBlockFile = path.join(deps.runtimeDir, 'host-install-block.json')
  let installLockToken = ''
  let installUnsettled = false

  interface CodexInstallLock {
    version: 1
    token: string
    pid: number
    hostId: 'codex'
    codexHome: string
    stage: 'installing' | 'blocked'
    at: string
    backupPath?: string
    detail?: string
    error?: string
  }

  function readInstallLock(): CodexInstallLock | null {
    try {
      const value = JSON.parse(fs.readFileSync(installLockFile, 'utf8')) as Partial<CodexInstallLock>
      if (value?.version !== 1 || typeof value.token !== 'string' ||
        typeof value.pid !== 'number' || value.hostId !== 'codex' ||
        (value.stage !== 'installing' && value.stage !== 'blocked')) return null
      return value as CodexInstallLock
    } catch {
      return null
    }
  }

  function writeInstallLock(lock: CodexInstallLock): boolean {
    try {
      fs.mkdirSync(installLockDir, { recursive: true })
      const temp = `${installLockFile}.tmp-${process.pid}-${Date.now()}`
      fs.writeFileSync(temp, JSON.stringify(lock, null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
      })
      fs.renameSync(temp, installLockFile)
      return true
    } catch {
      return false
    }
  }

  function pidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException)?.code === 'EPERM'
    }
  }

  function rememberBlockedLock(lock: CodexInstallLock): void {
    installBlocked = {
      hostId: 'codex',
      backupPath: typeof lock.backupPath === 'string' ? lock.backupPath : '',
      detail: typeof lock.detail === 'string' && lock.detail
        ? lock.detail
        : '上一次安装没有确认写入进程退出。',
    }
  }

  /** A blocked lock is shared by every Uta profile using the same CODEX_HOME. */
  function syncInstallBlockFromLock(): CodexInstallLock | null {
    const lock = readInstallLock()
    if (lock?.stage === 'blocked') rememberBlockedLock(lock)
    else if (!lock && !installUnsettled) installBlocked = null
    return lock
  }

  function acquireSharedInstallLock():
    | { ok: true; token: string }
    | { ok: false; active: boolean; blocked: boolean; detail: string } {
    const token = crypto.randomUUID()
    const lock: CodexInstallLock = {
      version: 1,
      token,
      pid: process.pid,
      hostId: 'codex',
      codexHome: path.resolve(codexHome),
      stage: 'installing',
      at: now().toISOString(),
    }
    try {
      fs.mkdirSync(installLockDir, { recursive: true })
      const fd = fs.openSync(installLockFile, 'wx', 0o600)
      try {
        fs.writeFileSync(fd, JSON.stringify(lock, null, 2) + '\n', 'utf8')
      } finally {
        fs.closeSync(fd)
      }
      installLockToken = token
      return { ok: true, token }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') {
        return { ok: false, active: false, blocked: false, detail: '无法创建共享安装锁，请检查本机用户数据目录权限。' }
      }
      const existing = readInstallLock()
      if (!existing) {
        return {
          ok: false,
          active: false,
          blocked: true,
          detail: '共享安装锁无法读取，无法确认 Codex 配置是否仍在被写入。请确认 Codex 已完全退出后手动解除阻断。',
        }
      }
      if (existing.stage === 'installing' && pidAlive(existing.pid)) {
        return {
          ok: false,
          active: true,
          blocked: false,
          detail: `另一个 Uta 实例（PID ${existing.pid}）正在安装同一份 Codex 配置，请等待它结束。`,
        }
      }
      const blocked: CodexInstallLock = {
        ...existing,
        stage: 'blocked',
        detail: existing.stage === 'installing'
          ? '上一次安装的 Uta 进程已退出，但写入 Codex 配置的子进程没有确认停止。请完全退出 Codex 后解除阻断。'
          : (existing.detail || '上一次安装没有确认写入进程退出。'),
      }
      writeInstallLock(blocked)
      rememberBlockedLock(blocked)
      return { ok: false, active: false, blocked: true, detail: blocked.detail || '' }
    }
  }

  function releaseSharedInstallLock(token = installLockToken): void {
    const current = readInstallLock()
    if (current?.token === token) {
      try { fs.rmSync(installLockFile, { force: true }) } catch { /* best effort */ }
    }
    installLockToken = ''
  }

  function markSharedInstallBlocked(backupPath: string, error: string): string {
    const detail = timedOutDetail(backupPath)
    const current = readInstallLock()
    const lock: CodexInstallLock = {
      version: 1,
      token: current?.token || installLockToken || crypto.randomUUID(),
      pid: process.pid,
      hostId: 'codex',
      codexHome: path.resolve(codexHome),
      stage: 'blocked',
      at: now().toISOString(),
      backupPath,
      detail,
      error,
    }
    writeInstallLock(lock)
    installUnsettled = true
    rememberBlockedLock(lock)
    return detail
  }

  function clearInstallLockFiles(): boolean {
    try {
      fs.rmSync(installLockFile, { force: true })
      fs.rmSync(legacyInstallBlockFile, { force: true })
      return true
    } catch {
      return false
    }
  }

  // Preserve a block created by alpha.11, which lived per Uta profile.
  try {
    if (!fs.existsSync(installLockFile) && fs.existsSync(legacyInstallBlockFile)) {
      const saved = JSON.parse(fs.readFileSync(legacyInstallBlockFile, 'utf8')) as {
        backupPath?: unknown
        detail?: unknown
      }
      writeInstallLock({
        version: 1,
        token: crypto.randomUUID(),
        pid: 0,
        hostId: 'codex',
        codexHome: path.resolve(codexHome),
        stage: 'blocked',
        at: now().toISOString(),
        backupPath: typeof saved.backupPath === 'string' ? saved.backupPath : '',
        detail: typeof saved.detail === 'string' && saved.detail
          ? saved.detail
          : '上一次安装没有确认写入进程退出。',
      })
      fs.rmSync(legacyInstallBlockFile, { force: true })
    }
  } catch {
    /* A corrupt legacy block must not prevent the shared lock from being read. */
  }
  syncInstallBlockFromLock()

  function blockUnsettledWriter(
    base: Omit<OnboardingInstallResult, 'ok' | 'error' | 'detail' | 'stages'>,
    backupPath: string,
    error: string,
  ): OnboardingInstallResult {
    const detail = markSharedInstallBlocked(backupPath, error)
    return {
      ...base,
      ok: false,
      stages: [],
      error,
      detail: `${detail} 已暂停后续安装写入；完全退出 Codex 后点「解除安装阻断」再重试。`,
      retryBlocked: true,
    }
  }

  async function installCodex(): Promise<OnboardingInstallResult> {
    const { codexExe } = currentHostPaths()
    const before = await detectCodex()
    const base = { hostId: 'codex' as const, backupPath: '', restartRequired: false, sessionRequired: true }
    if (!before.installed) {
      return {
        ...base, ok: false, stages: before.stages,
        error: '没有找到 Codex，请先安装 Codex 或选择稍后连接。',
        detail: '安装 Codex 后重新检测，不需要重新填写引导。',
      }
    }
    if (!exists(path.join(codexMarketplace, 'plugins', 'uta-deskpet', '.codex-plugin', 'plugin.json'))) {
      return {
        ...base, ok: false, stages: before.stages,
        error: 'Uta 安装目录里缺少 Codex 插件文件。',
        detail: '请重新安装完整候选包，或开发者先运行 npm run plugin:build。',
      }
    }
    if (!(await nodeAvailable())) {
      return {
        ...base, ok: false, stages: before.stages,
        error: '没有找到 Node.js，安装未开始。',
        detail: 'Codex 的 Uta MCP 通过 node 命令启动。请安装 Node.js，并确认 Codex 运行环境能找到 node，然后重新检测。',
      }
    }
    try {
      fs.mkdirSync(codexHome, { recursive: true })
    } catch {
      return {
        ...base, ok: false, stages: before.stages,
        error: '无法创建 Codex 配置目录，安装未开始。',
        detail: `请检查目录权限：${codexHome}`,
      }
    }
    const info = await codexPluginInfo()
    if (info.installed && !info.enabled) {
      return {
        ...base, ok: false, stages: before.stages,
        error: 'Uta 插件已安装但处于停用状态，不会自动覆盖。',
        detail: '请在 Codex 的插件列表中启用 Uta，或先移除旧插件后重试。',
      }
    }
    if (info.installed && info.marketplace !== 'uta') {
      return {
        ...base, ok: false, stages: before.stages,
        error: info.marketplace
          ? `检测到同名插件来自「${info.marketplace}」，不会自动替换你已有的安装。`
          : '检测到同名插件，但无法确认它来自 Uta 本地市场。',
        detail: '请先在 Codex 中移除旧插件，或保留它并手动核对版本；Uta 已停止修改配置。',
      }
    }
    const assetVersion = codexAssetVersion()
    if (info.installed && !assetVersion) {
      return {
        ...base, ok: false, stages: before.stages,
        error: '随包插件缺少版本信息，无法判断是否需要更新。',
        detail: '已安装的插件保持不变；请重新安装完整 Uta 包，或按手动步骤核对版本。',
      }
    }
    if (info.installed && assetVersion && info.version === assetVersion) {
      return {
        ...base, ok: true, stages: before.stages,
        error: '', detail: `已安装 ${info.version}，无需重复安装。`,
      }
    }
    const backup = backupCodexConfig()
    if (!backup.ok) {
      return {
        ...base, ok: false, stages: before.stages,
        error: '无法备份现有的 Codex 配置，安装未开始。',
        detail: `${backup.error} 请先关闭 Codex、检查配置目录权限后重试。`,
      }
    }
    base.backupPath = backup.path
    const marketplace = await run(codexExe, ['plugin', 'marketplace', 'add', codexMarketplace, '--json'], {
      env, timeoutMs: COMMAND_TIMEOUT_MS,
    })
    if (marketplace.stillRunning) {
      return blockUnsettledWriter(base, backup.path, '添加 Codex 本地市场超时，且 Codex 进程没有确认退出。')
    }
    if (marketplace.code !== 0) {
      const restored = restoreCodexConfig(backup.path, backup.existed)
      return {
        ...base, ok: false, stages: before.stages,
        error: `添加 Codex 本地市场失败：${(marketplace.stderr || marketplace.stdout).trim().slice(0, 300)}`,
        detail: restoreFailureDetail(restored, backup.path),
      }
    }
    const add = await run(codexExe, ['plugin', 'add', CODEX_PLUGIN_ID, '--json'], {
      env, timeoutMs: COMMAND_TIMEOUT_MS,
    })
    if (add.stillRunning) {
      return blockUnsettledWriter(base, backup.path, '安装 Codex 插件超时，且 Codex 进程没有确认退出。')
    }
    const after = await detectCodex()
    if (!after.pluginInstalled) {
      const restored = restoreCodexConfig(backup.path, backup.existed)
      return {
        ...base, ok: false, stages: after.stages,
        error: add.code === 0
          ? '命令完成，但没有在 Codex 插件列表里读到 Uta。'
          : `安装 Codex 插件失败：${(add.stderr || add.stdout).trim().slice(0, 300)}`,
        detail: restoreFailureDetail(restored, backup.path),
      }
    }
    if (assetVersion && after.pluginVersion && after.pluginVersion !== assetVersion) {
      return {
        ...base, ok: false, stages: after.stages,
        error: `安装命令完成，但版本仍是 ${after.pluginVersion}（随包 ${assetVersion}）。`,
        detail: '插件可能已被旧版本占用；请先在 Codex 中移除旧插件，然后重新安装。',
      }
    }
    return {
      ...base, ok: true, stages: after.stages,
      error: '',
      detail: '插件已写入。新开一个 Codex 会话；首次使用请在 /hooks 里信任一次。',
    }
  }

  async function dshProcessRunning(): Promise<boolean> {
    if (process.platform !== 'win32') return false
    try {
      const result = await run(
        'tasklist',
        ['/FI', 'IMAGENAME eq DeepSeek Harness.exe', '/FO', 'CSV', '/NH'],
        { env, timeoutMs: 5_000 },
      )
      return result.code === 0 && /DeepSeek Harness\.exe/i.test(result.stdout)
    } catch {
      return false
    }
  }

  interface DshProfileBackup {
    path: string
    files: string[]
    linkExisted: boolean
    linkTarget?: string
  }

  function backupDshProfile(profile: string): { ok: true; backup: DshProfileBackup } | { ok: false; error: string } {
    const names = ['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-lock.yaml']
      .filter(name => exists(path.join(profile, name)))
    if (!names.includes('package.json')) {
      return { ok: false, error: 'DSH desktop profile 缺少 package.json，无法备份。' }
    }
    const stamp = now().toISOString().replace(/[:.]/g, '-')
    const dir = path.join(deps.runtimeDir, 'dsh-plugin-backups', `${stamp}-${crypto.randomUUID().slice(0, 8)}`)
    try {
      fs.mkdirSync(dir, { recursive: true })
      for (const name of names) fs.copyFileSync(path.join(profile, name), path.join(dir, name))
      const linkExisted = exists(path.join(profile, 'node_modules', '@uta', 'deepseek-harness-plugin', 'package.json'))
      const link = path.join(profile, 'node_modules', '@uta', 'deepseek-harness-plugin')
      let linkTarget: string | undefined
      try { if (fs.lstatSync(link).isSymbolicLink()) linkTarget = fs.readlinkSync(link) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify({ files: names, linkExisted, linkTarget, createdAt: now().toISOString() }, null, 2) + '\n',
        { encoding: 'utf8', mode: 0o600 },
      )
      return { ok: true, backup: { path: dir, files: names, linkExisted, linkTarget } }
    } catch {
      return { ok: false, error: '无法备份 DSH desktop profile，安装未开始。请检查 DSH 数据目录权限。' }
    }
  }

  function restoreDshProfile(
    backup: DshProfileBackup,
    profile: string,
  ): { ok: boolean; error: string } {
    try {
      for (const name of backup.files) {
        const target = path.join(profile, name)
        const temp = `${target}.uta-restore-${process.pid}-${Date.now()}`
        fs.copyFileSync(path.join(backup.path, name), temp)
        try {
          fs.renameSync(temp, target)
        } catch {
          fs.rmSync(target, { force: true })
          fs.renameSync(temp, target)
        }
      }
      const link = path.join(profile, 'node_modules', '@uta', 'deepseek-harness-plugin')
      if (backup.linkTarget) {
        try {
          if (!fs.lstatSync(link).isSymbolicLink()) throw new Error('DSH plugin link was replaced by a directory')
          fs.unlinkSync(link)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        fs.mkdirSync(path.dirname(link), { recursive: true })
        fs.symlinkSync(backup.linkTarget, link, 'junction')
      } else if (!backup.linkExisted) {
        try {
          if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link)
        } catch {
          /* no link or not removable; restoring package.json is enough */
        }
      }
      return { ok: true, error: '' }
    } catch {
      return { ok: false, error: `恢复 DSH desktop profile 失败，安装前备份保留在 ${backup.path}。` }
    }
  }

  function pruneDshBackups(): void {
    const root = path.join(deps.runtimeDir, 'dsh-plugin-backups')
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(root, entry.name))
        .sort()
      for (const old of entries.slice(0, -5)) {
        fs.rmSync(old, { recursive: true, force: true })
      }
    } catch {
      /* retention is best effort */
    }
  }

  const legacyDshInstallLockFile = path.join(deps.runtimeDir, 'dsh-plugin-install.lock')

  function dshInstallLockFile(home = currentDshHome()): string {
    const key = crypto.createHash('sha256').update(directoryIdentity(home)).digest('hex').slice(0, 32)
    return path.join(installLockDir, `dsh-${key}.json`)
  }

  function readDshInstallLock(file: string): { pid: number; token: string; stage: 'installing' | 'blocked' } | null {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        pid?: unknown
        token?: unknown
        stage?: unknown
      }
      if (!Number.isSafeInteger(raw.pid) || (raw.pid as number) <= 0 || typeof raw.token !== 'string' || !raw.token) return null
      return { pid: raw.pid as number, token: raw.token, stage: raw.stage === 'blocked' ? 'blocked' : 'installing' }
    } catch {
      return null
    }
  }

  function acquireDshInstallLock(home: string):
    | { ok: true; release: () => void; block: () => void }
    | { ok: false; error: string; retryBlocked: boolean } {
    const file = dshInstallLockFile(home)
    const token = crypto.randomUUID()
    // An old per-profile timeout must not become permission for a new writer.
    if (fs.existsSync(legacyDshInstallLockFile)) {
      return { ok: false, error: '上次 DSH 安装尚未确认结束，请完全退出 DSH 后解除安装阻断。', retryBlocked: true }
    }
    try {
      fs.mkdirSync(installLockDir, { recursive: true })
      const fd = fs.openSync(file, 'wx', 0o600)
      try {
        fs.writeFileSync(fd, JSON.stringify({ token, pid: process.pid, stage: 'installing', at: now().toISOString() }), 'utf8')
      } finally { fs.closeSync(fd) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        return { ok: false, error: '无法创建 DSH 共享安装锁，请检查本机数据目录权限。', retryBlocked: false }
      }
      const existing = readDshInstallLock(file)
      const active = existing?.stage === 'installing' && pidAlive(existing.pid)
      return { ok: false, retryBlocked: !active, error: active
        ? '另一个 Uta 实例正在安装同一份 DSH 配置，请等待它结束。'
        : '上次 DSH 安装尚未确认结束，请完全退出 DSH 后解除安装阻断。' }
    }
    return {
      ok: true,
      block: () => {
        const current = readDshInstallLock(file)
        if (current?.token !== token) return
        const temp = `${file}.${token}.tmp`
        try {
          fs.writeFileSync(temp, JSON.stringify({ ...current, stage: 'blocked' }), { mode: 0o600 })
          fs.renameSync(temp, file)
        } finally { try { fs.unlinkSync(temp) } catch { /* Already renamed. */ } }
      },
      release: () => {
        const current = readDshInstallLock(file)
        if (current?.token !== token) return
        try {
          fs.rmSync(file, { force: true })
        } catch {
          /* best effort */
        }
      },
    }
  }

  async function installDsh(): Promise<OnboardingInstallResult> {
    const current = currentHostPaths()
    const before = await detectDsh(current)
    const profile = path.join(current.harnessHome, 'profiles', 'desktop')
    const base = {
      hostId: 'deepseek-harness' as const,
      backupPath: '',
      restartRequired: false,
      sessionRequired: true,
    }
    if (!exists(path.join(profile, 'package.json'))) {
      return {
        ...base,
        ok: false,
        stages: before.stages,
        error: '还没有找到 DSH 的 desktop profile，安装未开始。',
        detail: '请先打开一次 DeepSeek Harness，让它完成初始化；如果数据目录不在默认位置，请点「选择 DSH 数据目录」。',
      }
    }
    if (!current.harnessExe || !exists(current.harnessExe) ||
        !current.harnessCli || !exists(current.harnessCli)) {
      return {
        ...base,
        ok: false,
        stages: before.stages,
        error: '没有找到 DSH 程序或自带 CLI，安装未开始。',
        detail: '请点「选择 DSH 程序」，选中 DeepSeek Harness.exe，再重新检测。',
      }
    }
    if (!exists(path.join(dshPlugin, 'package.json')) || !exists(path.join(dshPlugin, 'cordis.patch.yml'))) {
      return {
        ...base,
        ok: false,
        stages: before.stages,
        error: '随包的 DSH 插件文件缺失，安装未开始。',
        detail: '请重新解压或安装完整 Uta 包，确认 resources\\uta-plugins\\deepseek-harness 存在。',
      }
    }
    if (!manifestVersion(path.join(dshPlugin, 'package.json'))) {
      return { ...base, ok: false, stages: before.stages, error: '随包的 DSH 插件缺少版本信息，安装未开始。', detail: '请重新取得完整 Uta 插件。' }
    }
    const lock = acquireDshInstallLock(current.harnessHome)
    if (!lock.ok) {
      return { ...base, ok: false, stages: before.stages, error: lock.error, retryBlocked: lock.retryBlocked, detail: '没有修改 DSH 配置。' }
    }
    let keepLock = false
    try {
      if (dshPluginState(profile).upToDate) {
        return { ...base, ok: true, stages: (await detectDsh(current)).stages, error: '', restartRequired: true,
          detail: 'Uta 插件已经安装，无需重复安装。请重新打开 DeepSeek Harness，并新开一个会话。' }
      }
      if (await dshProcessRunning()) {
        return { ...base, ok: false, stages: before.stages, error: 'DeepSeek Harness 正在运行，安装未开始。',
          detail: '请从任务栏或托盘完全退出 DeepSeek Harness，再安装或更新 Uta 插件。' }
      }
      const backup = backupDshProfile(profile)
      if (!backup.ok) {
        return { ...base, ok: false, stages: before.stages, error: backup.error, detail: '没有修改 DSH 配置。' }
      }
      base.backupPath = backup.backup.path
      let result: CommandResult
      try {
        result = await run(
          current.harnessExe,
          ['--expose-internals', current.harnessCli, 'plugin', '--profile', 'desktop', 'add', dshPlugin],
          {
            env: { ...env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: current.harnessHome },
            timeoutMs: 120_000,
          },
        )
      } catch (error) {
        result = { code: -2, stdout: '', stderr: String((error as Error)?.message ?? error) }
      }
      const after = await detectDsh(current)
      if (result.stillRunning) {
        keepLock = true
        try { lock.block() } catch { /* Keep the original lock if persisting its blocked state fails. */ }
        return {
          ...base,
          ok: false,
          retryBlocked: true,
          stages: before.stages,
          error: '安装命令超时，且 DSH 进程没有确认退出。',
          detail: `已保留安装锁和备份。请完全退出 DSH 后解除安装阻断；备份在 ${backup.backup.path}。`,
        }
      }
      if (result.code !== 0 || !dshPluginState(profile).upToDate) {
        const restored = restoreDshProfile(backup.backup, profile)
        return {
          ...base,
          ok: false,
          stages: after.stages,
          error: result.code === 0
            ? '命令完成，但 DSH 插件的版本或安装位置未更新。'
            : `安装 DSH 插件失败：${(result.stderr || result.stdout).trim().slice(0, 300) || '没有返回错误信息'}`,
          detail: restored.ok
            ? '已恢复安装前的 DSH desktop profile。'
            : restored.error,
        }
      }
      pruneDshBackups()
      return {
        ...base,
        ok: true,
        stages: after.stages,
        error: '',
        restartRequired: true,
        detail: 'Uta 插件已写入 DSH desktop profile。请重新打开 DeepSeek Harness，并新开一个会话。',
      }
    } finally {
      if (!keepLock) lock.release()
    }
  }

  async function installAntigravity(): Promise<OnboardingInstallResult> {
    const sourceDir = path.join(assetRoot, 'uta-antigravity-plugin')
    if (!exists(sourceDir)) {
      return {
        ok: false,
        hostId: 'antigravity',
        stages: [],
        backupPath: '',
        restartRequired: false,
        sessionRequired: true,
        error: '未找到 Antigravity 插件随包资源',
        detail: '请确认 resources\\uta-plugins\\uta-antigravity-plugin 存在',
      }
    }
    const globalTarget = antigravityGlobalTarget
    try {
      fs.mkdirSync(path.dirname(globalTarget), { recursive: true })
      fs.cpSync(sourceDir, globalTarget, { recursive: true, force: true })
      return {
        ok: true,
        hostId: 'antigravity',
        stages: [
          stage('detected', 'verified', '已定位 Antigravity 环境'),
          stage('plugin', 'verified', `已部署至 ${globalTarget}`),
          stage('tools', 'pending', '已部署 MCP 与动作编排 skill；刷新 Antigravity 后验证工具。'),
          runtimeStage(),
          stage('session', 'pending', '在 Antigravity 中启动新会话即可连接'),
          stage('response', 'pending', '测试桌宠会话回应'),
        ],
        backupPath: '',
        restartRequired: true,
        sessionRequired: true,
        error: '',
        detail: '已安装全局 Antigravity 插件。若项目已有工作区副本，请从该工作区更新。重开会话后验证工具。',
      }
    } catch (err) {
      return {
        ok: false,
        hostId: 'antigravity',
        stages: [],
        backupPath: '',
        restartRequired: false,
        sessionRequired: true,
        error: '写入插件目录失败',
        detail: String((err as Error).message ?? err),
      }
    }
  }

  async function installQoder(): Promise<OnboardingInstallResult> {
    const sourceDir = path.join(assetRoot, 'uta-qoder-plugin')
    if (!exists(sourceDir)) {
      return {
        ok: false,
        hostId: 'qoder',
        stages: [],
        backupPath: '',
        restartRequired: false,
        sessionRequired: true,
        error: '未找到 Qoder 插件随包资源',
        detail: '请确认 resources\\uta-plugins\\uta-qoder-plugin 存在',
      }
    }
    const targetDir = path.join(userHome, '.qoder-cn', 'plugins', 'cache', 'local', 'uta-deskpet', '0.1.0')
    const qoderGlobalDir = path.join(userHome, '.qoder', 'plugins', 'cache', 'local', 'uta-deskpet', '0.1.0')
    try {
      fs.mkdirSync(targetDir, { recursive: true })
      fs.cpSync(sourceDir, targetDir, { recursive: true, force: true })
      if (exists(path.join(userHome, '.qoder'))) {
        fs.mkdirSync(qoderGlobalDir, { recursive: true })
        fs.cpSync(sourceDir, qoderGlobalDir, { recursive: true, force: true })
      }
      return {
        ok: true,
        hostId: 'qoder',
        stages: [
          stage('detected', 'verified', '已定位 Qoder 环境'),
          stage('plugin', 'verified', `已写入本地扩展缓存 ${targetDir}`),
          stage('tools', 'pending', '插件文件已部署；重启会话后验证工具与事件。'),
          runtimeStage(),
          stage('session', 'pending', '在 Qoder 中新建或重启会话后即可连接'),
          stage('response', 'pending', '测试桌宠会话回应'),
        ],
        backupPath: '',
        restartRequired: true,
        sessionRequired: true,
        error: '',
        detail: '已成功安装 Qoder 插件。在 Qoder 中重启会话后，在桌宠连接面板选择 Qoder 即可连接。',
      }
    } catch (err) {
      return {
        ok: false,
        hostId: 'qoder',
        stages: [],
        backupPath: '',
        restartRequired: false,
        sessionRequired: true,
        error: '写入 Qoder 插件缓存失败',
        detail: String((err as Error).message ?? err),
      }
    }
  }

  async function installOpencode(): Promise<OnboardingInstallResult> {
    const sourceFile = path.join(assetRoot, 'uta-opencode-plugin', 'uta-opencode.ts')
    const sourceMcp = path.join(assetRoot, 'uta-opencode-plugin', 'deskpet-mcp.mjs')
    if (!exists(sourceFile)) {
      return {
        ok: false,
        hostId: 'opencode',
        stages: [],
        backupPath: '',
        restartRequired: false,
        sessionRequired: true,
        error: '未找到 OpenCode 插件随包资源',
        detail: '请确认 resources\\uta-plugins\\uta-opencode-plugin\\uta-opencode.ts 存在',
      }
    }
    const targetDir = path.join(opencodeConfigDir, 'plugins')
    const targetFile = path.join(targetDir, 'uta-opencode.ts')
    try {
      fs.mkdirSync(targetDir, { recursive: true })
      if (exists(sourceMcp)) {
        const mcpDir = path.join(opencodeConfigDir, 'uta-deskpet-mcp')
        fs.mkdirSync(mcpDir, { recursive: true })
        fs.copyFileSync(sourceMcp, path.join(mcpDir, 'deskpet-mcp.mjs'))
      }
      fs.copyFileSync(sourceFile, targetFile)
      return {
        ok: true,
        hostId: 'opencode',
        stages: [
          stage('detected', 'verified', '已定位 OpenCode 环境'),
          stage('plugin', 'verified', `已部署脚本至 ${targetFile}`),
          stage('tools', 'pending', exists(sourceMcp) ? '角色与动作编排工具已部署，重启 OpenCode 后验证。' : '此资源包未包含角色工具。'),
          runtimeStage(),
          stage('session', 'pending', '重启 OpenCode 后选择会话'),
          stage('response', 'pending', '测试桌宠会话回应'),
        ],
        backupPath: '',
        restartRequired: true,
        sessionRequired: true,
        error: '',
        detail: '已部署 OpenCode 插件。重启 OpenCode 后验证连接。',
      }
    } catch (err) {
      return {
        ok: false,
        hostId: 'opencode',
        stages: [],
        backupPath: '',
        restartRequired: false,
        sessionRequired: true,
        error: '写入 OpenCode 插件目录失败',
        detail: String((err as Error).message ?? err),
      }
    }
  }

  async function installClaude(): Promise<OnboardingInstallResult> {
    const claudeMarket = path.join(assetRoot, 'claude-marketplace')
    if (!exists(claudeMarket)) {
      return {
        ok: false,
        hostId: 'claude-code',
        stages: [],
        backupPath: '',
        restartRequired: false,
        sessionRequired: true,
        error: '未找到 Claude 插件市场随包资源',
        detail: '请确认 resources\\uta-plugins\\claude-marketplace 存在',
      }
    }
    const currentPaths = currentHostPaths()
    const claudeExe = deps.claudeExe ?? (currentPaths.claudeExe || currentPaths.claudeJs)
    if (!claudeExe || !exists(claudeExe)) {
      return {
        ok: false,
        hostId: 'claude-code',
        stages: [],
        backupPath: '',
        restartRequired: false,
        sessionRequired: true,
        error: '未检测到 Claude CLI 可执行文件',
        detail: '请先在系统环境变量中安装配置 Claude Code CLI。',
      }
    }
    const isJsEntry = /\.[cm]?js$/i.test(claudeExe)
    const cliCommand = isJsEntry ? currentPaths.nodeExe : claudeExe
    const cliPrefix = isJsEntry ? [claudeExe] : []
    if (!cliCommand || !exists(cliCommand)) {
      return { ok: false, hostId: 'claude-code', stages: [], backupPath: '', restartRequired: false,
        sessionRequired: true, error: 'Claude JS 入口需要 Node.js', detail: '请安装 Node.js 或选择 Claude 原生可执行文件。' }
    }
    try {
      const addRes = await run(cliCommand, [...cliPrefix, 'plugin', 'marketplace', 'add', claudeMarket], { env, timeoutMs: 15_000 })
      if (addRes.code !== 0 || addRes.stillRunning) {
        const errorDetail = addRes.stillRunning
          ? '添加 Claude 插件市场超时（超过 15 秒）'
          : (addRes.stderr || addRes.stdout || `命令退出码异常: ${addRes.code}`)
        return {
          ok: false,
          hostId: 'claude-code',
          stages: [
            stage('detected', 'verified', `Claude CLI: ${claudeExe}`),
            stage('plugin', 'unavailable', '添加插件市场失败'),
          ],
          backupPath: '',
          restartRequired: false,
          sessionRequired: true,
          error: '添加 Claude 插件市场失败',
          detail: errorDetail.trim(),
        }
      }

      const installRes = await run(cliCommand, [...cliPrefix, 'plugin', 'install', 'uta-deskpet@uta'], { env, timeoutMs: 15_000 })
      if (installRes.code !== 0 || installRes.stillRunning) {
        const errorDetail = installRes.stillRunning
          ? '安装 Claude 插件超时（超过 15 秒）'
          : (installRes.stderr || installRes.stdout || `命令退出码异常: ${installRes.code}`)
        return {
          ok: false,
          hostId: 'claude-code',
          stages: [
            stage('detected', 'verified', `Claude CLI: ${claudeExe}`),
            stage('plugin', 'unavailable', '安装插件失败'),
          ],
          backupPath: '',
          restartRequired: false,
          sessionRequired: true,
          error: '执行 Claude 插件安装命令失败',
          detail: errorDetail.trim(),
        }
      }

      return {
        ok: true,
        hostId: 'claude-code',
        stages: [
          stage('detected', 'verified', `Claude CLI: ${claudeExe}`),
          stage('plugin', 'verified', '已通过 Claude CLI 安装 uta-deskpet@uta 插件'),
          stage('tools', 'pending', '插件已安装；首次会话确认 hooks 并验证 MCP 工具。'),
          runtimeStage(),
          stage('session', 'pending', '启动 Claude Code 会话即可连接'),
          stage('response', 'pending', '测试桌宠会话回应'),
        ],
        backupPath: '',
        restartRequired: false,
        sessionRequired: true,
        error: '',
        detail: '已成功通过 Claude CLI 安装插件。启动 Claude Code 会话时按提示确认 hooks 即可连接。',
      }
    } catch (err) {
      return {
        ok: false,
        hostId: 'claude-code',
        stages: [],
        backupPath: '',
        restartRequired: false,
        sessionRequired: true,
        error: '执行 Claude 插件安装命令失败',
        detail: String((err as Error).message ?? err),
      }
    }
  }

  let installInProgress = false

  async function install(hostId: string): Promise<OnboardingInstallResult> {
    const normalizedHostId: OnboardingHostId = hostId === 'codex' ? 'codex' : 'deepseek-harness'
    if (installInProgress) {
      return {
        ok: false,
        hostId: normalizedHostId,
        stages: [],
        backupPath: '',
        restartRequired: false,
        sessionRequired: true,
        error: '安装正在进行，请稍候。',
        detail: '不要重复点击；上一次安装结束前不会再修改配置。',
      }
    }
    if (hostId === 'deepseek-harness') {
      installInProgress = true
      try {
        return await installDsh()
      } finally {
        installInProgress = false
      }
    }
    syncInstallBlockFromLock()
    if (installBlocked) {
      return {
        ok: false,
        hostId: normalizedHostId,
        stages: [],
        backupPath: installBlocked.backupPath,
        restartRequired: false,
        sessionRequired: true,
        error: '上次安装超时，写入配置的进程还没有确认退出，已暂停继续安装。',
        detail: `${installBlocked.detail} 完全退出 Codex 后点「解除安装阻断」再重试。`,
        retryBlocked: true,
      }
    }
    if (hostId === 'antigravity') {
      installInProgress = true
      try {
        return await installAntigravity()
      } finally {
        installInProgress = false
      }
    }
    if (hostId === 'qoder') {
      installInProgress = true
      try {
        return await installQoder()
      } finally {
        installInProgress = false
      }
    }
    if (hostId === 'opencode') {
      installInProgress = true
      try {
        return await installOpencode()
      } finally {
        installInProgress = false
      }
    }
    if (hostId === 'claude-code') {
      installInProgress = true
      try {
        return await installClaude()
      } finally {
        installInProgress = false
      }
    }
    if (hostId !== 'codex') {
      return {
        ok: false,
        hostId: hostId as OnboardingHostId,
        stages: [],
        backupPath: '',
        restartRequired: false,
        sessionRequired: true,
        error: '这个宿主不支持自动安装。',
        detail: '请按宿主卡片里的手动步骤操作。',
      }
    }

    const acquired = acquireSharedInstallLock()
    if (!acquired.ok) {
      if (acquired.blocked) {
        const blockedLock = syncInstallBlockFromLock()
        return {
          ok: false,
          hostId: 'codex',
          stages: [],
          backupPath: blockedLock?.backupPath ?? '',
          restartRequired: false,
          sessionRequired: true,
          error: '同一份 Codex 配置的上一次安装还没有确认退出，已暂停继续安装。',
          detail: `${acquired.detail} 完全退出 Codex 后点「解除安装阻断」再重试。`,
          retryBlocked: true,
        }
      }
      return {
        ok: false,
        hostId: 'codex',
        stages: [],
        backupPath: '',
        restartRequired: false,
        sessionRequired: true,
        error: '另一个 Uta 实例正在安装同一份 Codex 配置。',
        detail: acquired.detail,
        retryBlocked: false,
      }
    }

    installInProgress = true
    installUnsettled = false
    try {
      return await installCodex()
    } finally {
      installInProgress = false
      if (!installUnsettled) releaseSharedInstallLock(acquired.token)
    }
  }

  function unblockInstall(hostId: string): { ok: boolean; error?: string } {
    if (!['codex', 'deepseek-harness', 'antigravity', 'qoder', 'opencode', 'claude-code'].includes(hostId)) {
      return { ok: false, error: 'invalid-host' }
    }
    if (hostId !== 'codex' && hostId !== 'deepseek-harness') {
      return { ok: true }
    }
    if (installInProgress) return { ok: false, error: 'install-in-progress' }
    if (hostId === 'deepseek-harness') {
      const files = [dshInstallLockFile(), legacyDshInstallLockFile]
      if (files.some(file => {
        const lock = readDshInstallLock(file)
        return lock?.stage === 'installing' && pidAlive(lock.pid)
      })) return { ok: false, error: 'install-in-progress' }
      try {
        for (const file of files) fs.rmSync(file, { force: true })
        return { ok: true }
      } catch {
        return { ok: false, error: 'unblock-failed' }
      }
    }
    const lock = readInstallLock()
    if (lock?.stage === 'installing' && pidAlive(lock.pid)) {
      return { ok: false, error: 'install-in-progress' }
    }
    if (!clearInstallLockFiles()) return { ok: false, error: 'unblock-failed' }
    installBlocked = null
    installUnsettled = false
    installLockToken = ''
    return { ok: true }
  }

  return { detect, detectPresence, install, unblockInstall, codexHome, dshHome: currentDshHome(), codexMarketplace, dshPlugin }
}
