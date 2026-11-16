/**
 * 从桌宠直连宿主会话。
 *
 * 只使用各宿主官方提供的 headless/resume/queue 能力：
 * - DeepSeek Harness: headless --session-id，任务走 stdin；
 * - Claude Code: -p --resume；
 * - ZCode: --prompt --resume；
 * - OpenCode: 插件 SDK 的原生会话投递；
 * - Codex: queue --thread --message（异步入队，回复由已有 hook 带回）。
 *
 * 尚未实现或验证的宿主输入路线明确返回 unsupported。
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { resolveHostPaths, type HostPaths } from './host-paths'
import type { HostDeliveryState } from '../shared/host-delivery'
import type { HostInputStatus } from '../shared/host-input-status'
import { parseHostOutput } from './host-output'

export type HostBridgeCode = 'unsupported' | 'no-session' | 'target-changed' | 'busy' | 'failed'
export interface HostBridgeResult {
  ok: boolean
  code?: HostBridgeCode
  text?: string
  accepted?: boolean
  error?: string
  sessionId?: string
  delivery?: HostDeliveryState
}

export interface HostSessionRecord {
  host: string
  sessionId: string
  cwd: string
  updatedAt: number
  permissionMode?: string
  hostConfigDir?: string
  inputSurface?: 'cli' | 'unconfirmed'
  hostExecutable?: string
  hostPluginDir?: string
  activity?: 'busy' | 'idle' | 'unknown'
  nativeBridgeId?: string
}

interface HostInvocation {
  command: string
  args: string[]
  stdin?: string
  /**
   * 子进程工作目录。DSH 的 `headless --session-id` 会用
   * `assertAdoptable` 校验 `session.header.cwd === process.cwd()`，
   * 不一致直接拒绝续跑，所以必须用会话登记的真实工作区启动。
   */
  cwd?: string
  env?: Record<string, string>
  output?: { host: 'claude-code' | 'zcode' | 'opencode' | 'qoder'; sessionId: string }
  /** 只确认入队、不等待最终回复 */
  acceptedOnly?: boolean
  /** DSH 的桌面 exe 需要以 Electron-as-Node 方式运行内部 CLI。 */
  electronAsNode?: boolean
  timeoutMs?: number
}

const HOST_SESSION_FILES: Record<string, string> = {
  'deepseek-harness': 'harness-session.json',
  'claude-code': 'claude-code-session.json',
  zcode: 'zcode-session.json',
  opencode: 'opencode-session.json',
  codex: 'codex-session.json',
  qoder: 'qoder-session.json',
}

const HOST_LABELS: Record<string, string> = {
  'deepseek-harness': 'DeepSeek Harness',
  'claude-code': 'Claude Code',
  zcode: 'ZCode',
  opencode: 'OpenCode',
  codex: 'Codex',
  qoder: 'Qoder',
}

// ZCode CLI 依赖 node:sqlite，Uta 自带的 Electron Node 没有该内置模块，必须用系统 Node。
const SESSION_MAX_AGE_MS = 30 * 60 * 1000
const BUSY_WINDOW_MS = 2500
const MAX_TEXT_CHARS = 1000
const MAX_REPLY_CHARS = 1200
const MAX_OUTPUT_BYTES = 1024 * 1024
const COMMAND_TIMEOUT_MS = 180_000
const CODEX_TIMEOUT_MS = 30_000

const activeHosts = new Set<string>()
const lastSendAt = new Map<string, number>()

function stripAnsi(value: string): string {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

function clip(value: unknown, max: number): string {
  return stripAnsi(String(value ?? ''))
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max)
}

export function sessionFilePath(appData: string, hostId: string, runtimeDir = path.join(appData, 'uta')): string | null {
  const file = Object.hasOwn(HOST_SESSION_FILES, hostId) ? HOST_SESSION_FILES[hostId] : undefined
  return file ? path.join(runtimeDir, 'hooks', file) : null
}

interface NativeHarnessBridge {
  port: number
  token: string
  pid: number
  delivery?: 'accepted' | 'queued'
}

function readNativeHarnessBridge(appData: string, runtimeDir = path.join(appData, 'uta'), hostId = 'deepseek-harness', bridgeId?: string): NativeHarnessBridge | null {
  try {
    if (bridgeId && !/^[a-f0-9-]{36}$/.test(bridgeId)) return null
    const file = bridgeId ? path.join(runtimeDir, 'hooks/native-bridges', hostId, `${bridgeId}.json`) : path.join(runtimeDir, 'hooks', `${hostId}-native-bridge.json`)
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (
      raw?.version !== 1 ||
      !Number.isInteger(raw.port) ||
      raw.port <= 0 ||
      raw.port > 65535 ||
      typeof raw.token !== 'string' ||
      raw.token.length < 16 ||
      !Number.isInteger(raw.pid) ||
      raw.pid <= 0
    ) {
      return null
    }
    try {
      process.kill(raw.pid, 0)
    } catch {
      return null
    }
    return { port: raw.port, token: raw.token, pid: raw.pid,
      ...(raw.delivery === 'accepted' || raw.delivery === 'queued' ? { delivery: raw.delivery } : {}) }
  } catch {
    return null
  }
}

/**
 * 原生桥的投递结论只有三种，不能混为「失败」一种：
 * - `unavailable`：确定一个字节都没送到（没写桥信息、连接被拒、桥已过期），可以安全换通道重发；
 * - `unknown`：请求可能已经送到、只是回执丢了（超时、发完就被断开），**不能**自动重发；
 * - `result`：宿主给了明确答复，直接用它。
 */
type NativeHarnessOutcome =
  | { kind: 'unavailable' }
  | { kind: 'unknown'; error: string }
  | { kind: 'result'; value: HostBridgeResult }

/** 这些错误码说明还没写出去就被拒了，重发是安全的。 */
const UNDELIVERED_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EADDRNOTAVAIL',
  'EACCES',
  'EPERM',
])

/**
 * DSH 插件在活动 agent 上调用 followup()，比另起 headless 进程更接近宿主原生行为。
 * 返回三态结论而不是 null：只有 `unavailable` 才允许调用方回退到 headless CLI。
 */
function sendNativeHarnessMessage(
  appData: string,
  text: string,
  sessionId: string,
  runtimeDir?: string,
  hostId = 'deepseek-harness',
  cwd = '',
  bridgeId?: string,
): Promise<NativeHarnessOutcome> {
  const info = readNativeHarnessBridge(appData, runtimeDir, hostId, bridgeId)
  if (!info) return Promise.resolve({ kind: 'unavailable' })
  return new Promise((resolve) => {
    let settled = false
    let requestFlushed = false
    const finish = (outcome: NativeHarnessOutcome) => {
      if (settled) return
      settled = true
      resolve(outcome)
    }
    const messageId = crypto.randomUUID()
    const body = JSON.stringify({ text, sessionId, messageId, ...(hostId === 'opencode' && cwd ? { cwd } : {}) })
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: info.port,
        path: '/message',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${info.token}`,
        },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => {
          if (chunks.length < 32) chunks.push(chunk)
        })
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8')
          let parsed: any = null
          try {
            parsed = raw ? JSON.parse(raw) : null
          } catch {
            /* ignore */
          }
          if (res.statusCode === 200 && parsed?.ok && parsed?.accepted) {
            // 回执里的实际会话必须等于目标：插件若改投了别的会话，这里必须显示失败
            const deliveredTo = String(parsed?.sessionId || '')
            if (!deliveredTo || deliveredTo !== sessionId) {
              finish({
                kind: 'result',
                value: {
                  ok: false,
                  code: 'no-session',
                  delivery: 'unknown',
                  error: `宿主回报的接收会话是「${deliveredTo || '未知'}」，与目标「${sessionId}」不一致，这条消息没有算作发送成功。`,
                },
              })
              return
            }
            finish({
              kind: 'result',
              value: {
                ok: true,
                accepted: true,
                sessionId: deliveredTo,
                delivery: parsed.delivery === 'queued' ? 'queued' : 'accepted',
                text: hostId === 'opencode'
                  ? (parsed.delivery === 'queued' ? '已排队到 OpenCode 的选定会话，等待宿主处理。' : 'OpenCode 已接收消息，等待选定会话处理。')
                  : '已发送给 DeepSeek Harness，回复会显示在桌宠气泡里。',
              },
            })
            return
          }
          if (res.statusCode === 401 || res.statusCode === 404) {
            // 桥信息过期或端点不存在，请求根本没被处理
            finish({ kind: 'unavailable' })
            return
          }
          if (parsed?.error === 'session-not-found') {
            finish({
              kind: 'result',
              value: {
                ok: false,
                code: 'no-session',
                error:
                  `目标会话在 ${HOST_LABELS[hostId] || hostId} 里已经不存在了，这条消息没有发出，也没有改投其他会话。`,
              },
            })
            return
          }
          if (parsed?.error === 'session-mismatch') {
            finish({
              kind: 'result',
              value: {
                ok: false,
                code: 'no-session',
                error: '宿主回报的接收会话与目标不一致，这条消息按失败处理，没有改投其他会话。',
              },
            })
            return
          }
          finish({
            kind: 'result',
            value: {
              ok: false,
              code: 'failed',
              delivery: 'unknown',
              error: String(parsed?.error || `${HOST_LABELS[hostId]} 原生桥返回 HTTP ${res.statusCode}`),
            },
          })
        })
      },
    )
    req.on('response', res => {
      res.on('aborted', () => finish({ kind: 'unknown', error: 'DSH 原生桥回执未接收完整' }))
      res.on('error', () => finish({ kind: 'unknown', error: 'DSH 原生桥回执连接中断' }))
    })
    req.on('finish', () => {
      requestFlushed = true
    })
    req.on('timeout', () => {
      req.destroy()
      // 超时可能发生在宿主已经收下消息之后，回执丢失不能当作没送到
      finish({ kind: 'unknown', error: `${HOST_LABELS[hostId]} 原生桥 5 秒内没有回执` })
    })
    req.on('error', (error) => {
      const code = String((error as NodeJS.ErrnoException)?.code || '')
      if (UNDELIVERED_ERROR_CODES.has(code)) {
        finish({ kind: 'unavailable' })
        return
      }
      if (!requestFlushed && !code) {
        finish({ kind: 'unavailable' })
        return
      }
      finish({
        kind: 'unknown',
        error: `${HOST_LABELS[hostId]} 原生桥连接中断（${code || error.message}）`,
      })
    })
    req.end(body)
  })
}

export function readHostSession(appData: string, hostId: string, runtimeDir?: string, sessionId?: string): HostSessionRecord | null {
  const latest = sessionFilePath(appData, hostId, runtimeDir)
  const scoped = latest && sessionId
    ? path.join(path.dirname(latest), 'sessions', hostId, `${crypto.createHash('sha256').update(sessionId).digest('hex')}.json`)
    : null
  // An older plugin may have only the latest record; it is usable only if its ID matches.
  const file = scoped && fs.existsSync(scoped) ? scoped : latest
  if (!file) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (
      raw?.host !== hostId ||
      typeof raw.sessionId !== 'string' ||
      !raw.sessionId.trim() ||
      raw.sessionId.length > 200 ||
      (sessionId !== undefined && raw.sessionId !== sessionId) ||
      typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)
    ) {
      return null
    }
    return {
      host: hostId,
      sessionId: raw.sessionId.trim().slice(0, 200),
      cwd: typeof raw.cwd === 'string' ? raw.cwd.trim().slice(0, 500) : '',
      updatedAt: raw.updatedAt,
      ...(['busy', 'idle', 'unknown'].includes(raw.activity) ? { activity: raw.activity } : {}),
      ...(typeof raw.nativeBridgeId === 'string' && /^[a-f0-9-]{36}$/.test(raw.nativeBridgeId) ? { nativeBridgeId: raw.nativeBridgeId } : {}),
      ...((hostId === 'qoder' ? ['default', 'accept_edits', 'bypass_permissions', 'dont_ask', 'auto', 'plan'] : ['build', 'edit', 'plan', 'yolo', 'guarded']).includes(raw.permissionMode) ? { permissionMode: raw.permissionMode } : {}),
      ...(typeof raw.hostConfigDir === 'string' && raw.hostConfigDir.length <= 2048 && path.isAbsolute(raw.hostConfigDir) ? { hostConfigDir: raw.hostConfigDir } : {}),
      ...(hostId === 'qoder' ? {
        inputSurface: raw.inputSurface === 'cli' ? 'cli' : 'unconfirmed',
        ...(typeof raw.hostExecutable === 'string' && raw.hostExecutable.length <= 2048 && path.isAbsolute(raw.hostExecutable) ? { hostExecutable: raw.hostExecutable } : {}),
        ...(typeof raw.hostPluginDir === 'string' && raw.hostPluginDir.length <= 2048 && path.isAbsolute(raw.hostPluginDir) ? { hostPluginDir: raw.hostPluginDir } : {}),
      } : {}),
    }
  } catch {
    return null
  }
}

export function buildHarnessArgs(sessionId: string, harnessCli = ''): string[] {
  return [
    '--expose-internals',
    harnessCli,
    '--profile',
    'headless',
    '--session-id',
    sessionId,
    '-',
  ]
}

export function buildClaudeArgs(sessionId: string, text: string): string[] {
  return ['-p', '--resume', sessionId, '--output-format', 'json', '--', text]
}

export function buildZcodeArgs(sessionId: string, text: string, cwd: string, zcodeCli = '', permissionMode = 'plan'): string[] {
  const prompt = text.startsWith('-') ? ` ${text}` : text
  return [
    zcodeCli,
    '--prompt',
    prompt,
    '--resume',
    sessionId,
    '--mode',
    permissionMode,
    '--json',
    ...(cwd ? ['--cwd', cwd] : []),
  ]
}

export function buildOpenCodeArgs(sessionId: string, text: string, cwd: string): string[] {
  return [
    'run',
    '--session',
    sessionId,
    ...(cwd ? ['--dir', cwd] : []),
    '--format',
    'json',
    '--',
    text,
  ]
}

export function buildCodexArgs(sessionId: string, text: string): string[] {
  return ['queue', '--thread', sessionId, '--message', text]
}

export function buildQoderArgs(session: HostSessionRecord, text: string): string[] {
  return ['--print', '--resume', session.sessionId, '--cwd', session.cwd, '--config-dir', session.hostConfigDir!,
    '--plugin-dir', session.hostPluginDir!, '--permission-mode', session.permissionMode!, '--output-format', 'json', '--', text]
}

/** Describes this implementation's input route; it does not certify an entire host integration. */
export function getHostInputStatus(
  appData: string,
  hostId: string,
  runtimeDir?: string,
  selected?: HostSessionRecord | null,
): HostInputStatus {
  if (!hostId || hostId === 'none') {
    return {
      hostId: hostId || 'none',
      supported: false,
      configured: false,
      ready: false,
      mode: null,
      detail: '当前未绑定宿主，请在快捷设置中选择宿主。',
    }
  }
  const supported = Object.hasOwn(HOST_SESSION_FILES, hostId)
  const status: HostInputStatus = { hostId, supported, configured: false, ready: false, mode: null,
    detail: '当前宿主没有已接入的发送通道，请在宿主窗口输入。' }
  if (!supported) return status
  const session = selected === undefined ? readHostSession(appData, hostId, runtimeDir) : selected
  if (session?.host === hostId && session.sessionId) status.targetSession = { sessionId: session.sessionId }
  if (hostId === 'qoder') {
    status.mode = 'resume'
    if (session?.inputSurface !== 'cli') return { ...status, detail: '此 Qoder 会话尚未登记为 CLI；桌面版请回宿主输入，CLI 请用插件自带启动器打开。' }
    try {
      status.configured = !!session.hostExecutable && path.isAbsolute(session.hostExecutable) &&
        !['.cmd', '.bat', '.ps1'].includes(path.extname(session.hostExecutable).toLowerCase()) && fs.statSync(session.hostExecutable).isFile() &&
        !!session.hostConfigDir && fs.statSync(session.hostConfigDir).isDirectory() && !!session.hostPluginDir && fs.statSync(session.hostPluginDir).isDirectory()
    } catch { status.configured = false }
    if (!status.configured) return { ...status, detail: 'Qoder CLI 的程序或配置目录已不可用，请用插件自带启动器重新登记。' }
    if (!['default', 'accept_edits', 'bypass_permissions', 'dont_ask', 'auto', 'plan'].includes(session.permissionMode ?? '')) return { ...status, detail: 'Qoder CLI 权限模式尚未登记，请先在 CLI 中发一条消息。' }
    if (session.activity !== 'idle') return { ...status, detail: session.activity === 'busy' ? '这个 Qoder CLI 会话正在执行，请等本轮结束。' : '尚未确认 Qoder CLI 会话空闲，请先让 CLI 完成一轮。' }
  }
  const paths = resolveHostPaths(appData, runtimeDir)
  const nativeBridge = (hostId === 'deepseek-harness' || hostId === 'opencode') ? readNativeHarnessBridge(appData, runtimeDir, hostId, session?.nativeBridgeId) : null
  const native = !!nativeBridge
  if (hostId === 'opencode' && !native) return { ...status, detail: 'OpenCode 的原生发送插件未就绪，请更新并重新加载 Uta 插件；不会改用其他版本的命令行。' }
  status.mode = native && (hostId === 'deepseek-harness' || nativeBridge?.delivery === 'accepted') ? 'native' : hostId === 'codex' || hostId === 'opencode' ? 'queue' : 'resume'
  status.configured = status.configured || native || (hostId === 'deepseek-harness' ? !!(paths.harnessExe && paths.harnessCli)
    : hostId === 'claude-code' ? !!(paths.claudeExe || (paths.claudeJs && paths.nodeExe))
      : hostId === 'zcode' ? !!(paths.zcodeCli && paths.nodeExe)
        : hostId === 'codex' ? !!paths.codexExe : !!paths.opencodeExe)
  if (!status.configured) return { ...status, detail: '未找到可用的宿主程序，请在连接与会话中选择程序路径。' }
  if (!session || session.host !== hostId || !session.sessionId) {
    return { ...status, detail: hostId === 'codex' ? '正在自动连接 Codex 聊天；草稿会保留在这里。' : selected === null ? '固定的会话已不可用，请重新选择会话。' : '尚未登记目标会话，请先在宿主中发送一条消息。' }
  }
  const age = Date.now() - session.updatedAt
  if (!Number.isFinite(age) || age < 0 || (hostId !== 'codex' && age > SESSION_MAX_AGE_MS)) {
    return { ...status, detail: '会话记录已过期，请先在宿主中发送一条消息以重新登记。' }
  }
  if (hostId === 'zcode' && !['build', 'edit', 'plan', 'yolo', 'guarded'].includes(session.permissionMode ?? '')) {
    return { ...status, detail: '尚未确认这个 ZCode 会话的权限模式，请在宿主中发送一条消息以重新登记。' }
  }
  if (status.mode === 'resume' && !session.cwd) {
    return { ...status, detail: '目标会话的工作目录尚未登记，请先在宿主中发送一条消息。' }
  }
  if (status.mode === 'resume' && session.activity === 'busy') return { ...status, detail: '这个会话正在宿主中执行，请等本轮结束后再发送。' }
  return { ...status, ready: true, detail: status.mode === 'queue' ? '文字会排队到选定会话；入队后等待宿主处理。'
    : status.mode === 'native' ? '文字会发送到选定的活动会话。' : `${hostId === 'qoder' ? 'Qoder CLI 试验通道：' : ''}文字会从指定工作区续跑选定会话；请避免在宿主中同时续跑。` }
}

export function summarizeHostOutput(raw: string): string {
  return clip(raw, MAX_REPLY_CHARS)
}

function buildInvocation(
  hostId: string,
  session: HostSessionRecord,
  text: string,
  paths: HostPaths,
): HostInvocation | null {
  if (hostId === 'qoder' && session.inputSurface === 'cli' && session.hostExecutable && session.hostConfigDir && session.hostPluginDir && session.permissionMode) {
    return { command: session.hostExecutable, args: buildQoderArgs(session, text), cwd: session.cwd,
      output: { host: 'qoder', sessionId: session.sessionId }, timeoutMs: COMMAND_TIMEOUT_MS,
      env: { UTA_QODER_SURFACE: 'cli', UTA_QODER_EXE: session.hostExecutable, UTA_QODER_CONFIG_DIR: session.hostConfigDir, UTA_QODER_PLUGIN_DIR: session.hostPluginDir } }
  }
  if (hostId === 'deepseek-harness') {
    if (!paths.harnessExe || !paths.harnessCli) return null
    return {
      command: paths.harnessExe,
      args: buildHarnessArgs(session.sessionId, paths.harnessCli),
      stdin: text,
      electronAsNode: true,
      ...(session.cwd ? { cwd: session.cwd } : {}),
      timeoutMs: COMMAND_TIMEOUT_MS,
    }
  }
  if (hostId === 'claude-code') {
    if (paths.claudeExe) {
      return {
        command: paths.claudeExe,
        args: buildClaudeArgs(session.sessionId, text),
        output: { host: 'claude-code', sessionId: session.sessionId },
        ...(session.cwd ? { cwd: session.cwd } : {}),
        ...(session.hostConfigDir ? { env: { CLAUDE_CONFIG_DIR: session.hostConfigDir } } : {}),
        timeoutMs: COMMAND_TIMEOUT_MS,
      }
    }
    if (paths.claudeJs && paths.nodeExe) {
      return {
        command: paths.nodeExe,
        args: [paths.claudeJs, ...buildClaudeArgs(session.sessionId, text)],
        output: { host: 'claude-code', sessionId: session.sessionId },
        ...(session.cwd ? { cwd: session.cwd } : {}),
        ...(session.hostConfigDir ? { env: { CLAUDE_CONFIG_DIR: session.hostConfigDir } } : {}),
        timeoutMs: COMMAND_TIMEOUT_MS,
      }
    }
    return null
  }
  if (hostId === 'zcode') {
    if (!paths.zcodeCli || !paths.nodeExe) return null
    return {
      command: paths.nodeExe,
      args: buildZcodeArgs(session.sessionId, text, session.cwd, paths.zcodeCli, session.permissionMode),
      output: { host: 'zcode', sessionId: session.sessionId },
      ...(session.cwd ? { cwd: session.cwd } : {}),
      timeoutMs: COMMAND_TIMEOUT_MS,
    }
  }
  if (hostId === 'opencode') {
    if (!paths.opencodeExe) return null
    return {
      command: paths.opencodeExe,
      args: buildOpenCodeArgs(session.sessionId, text, session.cwd),
      output: { host: 'opencode', sessionId: session.sessionId },
      timeoutMs: COMMAND_TIMEOUT_MS,
    }
  }
  if (hostId === 'codex') {
    if (!paths.codexExe) return null
    return {
      command: paths.codexExe,
      args: buildCodexArgs(session.sessionId, text),
      ...(session.cwd ? { cwd: session.cwd } : {}),
      ...(session.hostConfigDir ? { env: { CODEX_HOME: session.hostConfigDir } } : {}),
      acceptedOnly: true,
      timeoutMs: CODEX_TIMEOUT_MS,
    }
  }
  return null
}

function runInvocation(invocation: HostInvocation): Promise<HostBridgeResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: HostBridgeResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    let child
    try {
      child = spawn(invocation.command, invocation.args, {
        windowsHide: true,
        shell: false,
        ...(invocation.cwd ? { cwd: invocation.cwd } : {}),
        env: {
          ...process.env,
          ...invocation.env,
          ...(invocation.command === process.execPath || invocation.electronAsNode
            ? { ELECTRON_RUN_AS_NODE: '1' }
            : {}),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      finish({ ok: false, code: 'failed', error: `无法启动宿主 CLI：${clip(error, 160)}` })
      return
    }

    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    const onData = (chunk: Buffer, target: 'stdout' | 'stderr') => {
      outputBytes += chunk.length
      if (outputBytes > MAX_OUTPUT_BYTES) {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
        finish({ ok: false, code: 'failed', delivery: 'unknown', error: '宿主输出超过接收上限，投递结果未确认，请查看宿主。' })
        return
      }
      if (target === 'stdout') stdout += chunk.toString('utf-8')
      else stderr += chunk.toString('utf-8')
    }
    child.stdout.on('data', (chunk: Buffer) => onData(chunk, 'stdout'))
    child.stderr.on('data', (chunk: Buffer) => onData(chunk, 'stderr'))
    child.on('error', (error) => {
      finish({ ok: false, code: 'failed', error: `无法启动宿主 CLI：${clip(error.message, 160)}` })
    })
    child.on('close', (code) => {
      if (settled) return
      if (invocation.acceptedOnly && code === 0) {
        finish({
          ok: true,
          accepted: true,
          delivery: 'queued',
          text: '已排队到 Codex，宿主处理后会通过已加载的插件回传回复。',
        })
        return
      }
      if (invocation.output && (code === 0 || stdout.trim())) {
        const parsed = parseHostOutput(invocation.output.host, stdout, invocation.output.sessionId)
        if (parsed.kind !== 'unknown') {
          finish({ ok: parsed.kind === 'success', delivery: 'completed', sessionId: parsed.sessionId,
            ...(parsed.kind === 'success' ? { text: summarizeHostOutput(parsed.text ?? '') } : { code: 'failed', error: parsed.error }) })
          return
        }
        if (code === 0) {
          finish({ ok: false, code: 'failed', delivery: 'unknown', error: parsed.error })
          return
        }
      }
      const reply = summarizeHostOutput(stdout)
      if (!invocation.output && code === 0 && reply) {
        finish({ ok: true, delivery: 'completed', text: reply })
        return
      }
      const detail = clip(stderr || stdout, 240)
      if (invocation.acceptedOnly) {
        const missingThread = /(?:thread|session)[^\r\n]*(?:not found|does not exist|invalid|expired)|no such (?:thread|session)/i.test(detail)
        finish({ ok: false, code: missingThread ? 'no-session' : 'failed', delivery: missingThread ? 'not-sent' : 'unknown',
          error: missingThread ? '这个 Codex 聊天已不可用，草稿已保留，请选择其他聊天。'
            : detail ? `Codex 暂时无法接收消息：${detail}` : 'Codex 暂时无法接收消息，请稍后重试。' })
        return
      }
      // DSH 0.2.x headless adopt 的三类拒绝：会话带 agent preset、工作目录不一致、会话是子代理/分叉
      if (/runs under agent preset/i.test(detail)) {
        finish({
          ok: false,
          code: 'failed',
          error: '该会话用了 agent 预设，DSH 不允许从外部续跑；请在 DSH 里新建一个不带预设的会话再绑定。',
        })
        return
      }
      if (/was recorded in .*not |recorded no working directory/i.test(detail)) {
        finish({
          ok: false,
          code: 'no-session',
          error: '会话工作目录与登记不一致，请在宿主里发一条消息重新登记后再试。',
        })
        return
      }
      if (/is a subagent or forked session|is live in this process/i.test(detail)) {
        finish({
          ok: false,
          code: 'busy',
          error: '该会话是子代理/派生会话，或仍在宿主里运行，无法从桌宠续跑。',
        })
        return
      }
      if (/unknown|not found|does not exist|no such session|session.*(invalid|expired)/i.test(detail)) {
        finish({
          ok: false,
          code: 'no-session',
          error: '宿主会话已失效，请先在宿主里发一条消息重新登记。',
        })
        return
      }
      finish({
        ok: false,
        code: 'failed',
        delivery: 'unknown',
        error: detail ? `宿主执行失败：${detail}` : `宿主执行失败（退出码 ${code ?? 'unknown'}）`,
      })
    })

    const timer = setTimeout(() => {
      if (settled) return
      try {
        child.kill()
        if (child.pid && process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          })
        }
      } catch {
        /* ignore */
      }
      finish({ ok: false, code: 'failed', delivery: 'unknown', error: '等待宿主回执超时，消息可能已经送达，请先查看宿主，避免重复发送。' })
    }, invocation.timeoutMs || COMMAND_TIMEOUT_MS)
    timer.unref?.()
    child.on('close', () => clearTimeout(timer))
    child.stdin.on('error', () => finish({ ok: false, code: 'failed', delivery: 'unknown', error: '输入连接中断，消息是否送达尚未确认，请先查看宿主。' }))

    try {
      if (invocation.stdin !== undefined) child.stdin.write(invocation.stdin)
      child.stdin.end()
    } catch {
      finish({ ok: false, code: 'failed', error: '无法把消息写入宿主进程' })
    }
  })
}

export async function sendHostMessage(
  appData: string,
  hostId: string,
  rawText: string,
  runtimeDir?: string,
  sessionOverride?: HostSessionRecord | null,
  expectedSessionId?: string,
): Promise<HostBridgeResult> {
  const result = await deliverHostMessage(appData, hostId, rawText, runtimeDir, sessionOverride, expectedSessionId)
  return { ...result, delivery: result.delivery ?? (result.ok ? 'completed' : 'not-sent') }
}

async function deliverHostMessage(
  appData: string,
  hostId: string,
  rawText: string,
  runtimeDir?: string,
  sessionOverride?: HostSessionRecord | null,
  expectedSessionId?: string,
): Promise<HostBridgeResult> {
  if (!Object.hasOwn(HOST_SESSION_FILES, hostId)) {
    return {
      ok: false,
      code: 'unsupported',
      error: '当前宿主没有可用的官方文本注入通道。',
    }
  }
  const text = stripAnsi(String(rawText ?? '')).trim()
  if (!text) return { ok: false, code: 'failed', error: '消息不能为空' }
  if (text.length > MAX_TEXT_CHARS) {
    return { ok: false, code: 'failed', error: `消息超过 ${MAX_TEXT_CHARS} 字符，请缩短后重试` }
  }
  if (sessionOverride === null) {
    return { ok: false, code: 'no-session', error: hostId === 'codex' ? '当前聊天暂不可用，草稿已保留；请检查 Codex 连接或选择其他聊天。' : '选定的会话暂不可用，请在宿主中重新打开会话或重新选择目标' }
  }
  if (activeHosts.has(hostId)) {
    return { ok: false, code: 'busy', error: '宿主上一轮还没结束，稍后再发。' }
  }
  const last = lastSendAt.get(hostId) || 0
  if (Date.now() - last < BUSY_WINDOW_MS) {
    return { ok: false, code: 'busy', error: '刚发过一条，等宿主处理完再发。' }
  }
  const candidate = sessionOverride === undefined ? readHostSession(appData, hostId, runtimeDir) : sessionOverride
  if (expectedSessionId !== undefined && candidate?.sessionId !== expectedSessionId) {
    return { ok: false, code: 'target-changed', error: '目标聊天已变化，请确认后再发送。' }
  }
  if (!candidate || candidate.host !== hostId || !candidate.sessionId?.trim() || candidate.sessionId.length > 200) {
    return {
      ok: false,
      code: 'no-session',
      error: `还没有登记 ${HOST_LABELS[hostId] || hostId} 会话，请先在宿主里发一条消息。`,
    }
  }
  // Keep the destination fixed while awaiting a native receipt or CLI response.
  const session: HostSessionRecord = { ...candidate }
  if (hostId === 'zcode' && !['build', 'edit', 'plan', 'yolo', 'guarded'].includes(session.permissionMode ?? '')) {
    return { ok: false, code: 'no-session', error: '尚未确认这个 ZCode 会话的权限模式，请在宿主里发送一条消息以重新登记后再试。' }
  }
  const age = Date.now() - session.updatedAt
  if (!Number.isFinite(age) || age < 0 || (hostId !== 'codex' && age > SESSION_MAX_AGE_MS)) {
    return {
      ok: false,
      code: 'no-session',
      error: `${HOST_LABELS[hostId] || hostId} 会话已经超过 30 分钟没有活动，请先在宿主里发一条消息。`,
    }
  }
  if (age < BUSY_WINDOW_MS && hostId !== 'codex' && hostId !== 'opencode') {
    return { ok: false, code: 'busy', error: '宿主正在回复，稍后再发。' }
  }
  if (session.activity === 'busy' && !['codex', 'opencode', 'deepseek-harness'].includes(hostId)) return { ok: false, code: 'busy', error: '这个会话正在宿主中执行，请等本轮结束后再发送。' }
  const inputStatus = getHostInputStatus(appData, hostId, runtimeDir, session)
  if (!inputStatus.ready) return { ok: false, code: inputStatus.configured ? 'no-session' : 'unsupported', error: inputStatus.detail }

  activeHosts.add(hostId)
  lastSendAt.set(hostId, Date.now())
  try {
    if (hostId === 'deepseek-harness' || hostId === 'opencode') {
      // 优先把消息送进正在运行的 DSH agent，而不是另起 headless 进程
      const native = await sendNativeHarnessMessage(appData, text, session.sessionId, runtimeDir, hostId, session.cwd, session.nativeBridgeId)
      if (native.kind === 'result') return native.value
      if (native.kind === 'unknown') {
        // 宿主可能已经收下这条消息，只是回执丢了。此时再走 CLI 就是一次操作投两遍。
        return {
          ok: false,
          code: 'failed',
          delivery: 'unknown',
          error: `${native.error}；消息可能已经送到宿主，为避免重复投递，这次没有自动改用命令行重发。请先看一眼宿主里是否已经出现这条消息。`,
        }
      }
      if (hostId === 'opencode') return { ok: false, code: 'no-session', error: 'OpenCode 原生发送通道已断开，请重新加载插件后再试；没有改用其他版本的命令行。' }
      // unavailable：确认没送到，才允许继续走 headless CLI
    }

    const invocation = buildInvocation(hostId, session, text, resolveHostPaths(appData, runtimeDir))
    if (!invocation) {
      return {
        ok: false,
        code: 'unsupported',
        error: `没有找到 ${HOST_LABELS[hostId] || hostId} 的原生 CLI 或 JS 入口；可在 host-paths.json 或 UTA_*_EXE 环境变量中指定路径（不要使用 .cmd/.bat）。`,
      }
    }
    const result = await runInvocation(invocation)
    return result.ok ? { ...result, sessionId: session.sessionId } : result
  } finally {
    activeHosts.delete(hostId)
  }
}
