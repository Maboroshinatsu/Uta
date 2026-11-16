/**
 * 运行环境身份与诊断展示辅助服务。
 * 纯逻辑函数，无 DOM/Electron 强绑定，便于单元测试与不同环境展示。
 *
 * 字段白名单：profile, packaged, version, sourceDir, userData, runtimeDir, endpointFile,
 * 以及 build.commit, build.dirty, build.builtAt。
 * 安全约束：禁止读取端点内容，禁止显示/导出 token/key，禁止伪称“桥在线”，禁止在错误提示中回显原始异常信息。
 */

export interface BuildInfo {
  commit: string | null
  dirty: boolean | null
  builtAt: string | null
}

export interface SanitizedEnvironmentInfo {
  profile: string
  packaged: boolean | null
  version: string
  sourceDir: string
  userData: string
  runtimeDir: string
  endpointFile: string
  build: BuildInfo
}

export interface RawEnvironmentInput {
  profile?: unknown
  packaged?: unknown
  version?: unknown
  sourceDir?: unknown
  userData?: unknown
  runtimeDir?: unknown
  endpointFile?: unknown
  build?: {
    commit?: unknown
    dirty?: unknown
    builtAt?: unknown
  } | null
  [key: string]: unknown
}

export type DiagnosticsStatus = 'idle' | 'loading' | 'success' | 'no-api' | 'error'

export interface DiagnosticsState {
  status: DiagnosticsStatus
  data: SanitizedEnvironmentInfo | null
  errorMessage: string | null
}

/**
 * 判断是否为日常正式环境 profile（stable）
 */
export function isStableProfile(profile: string | null | undefined): boolean {
  return String(profile || '').trim() === 'stable'
}

/**
 * 路径折叠逻辑：stable profile 默认折叠内部路径，其余 profile 默认展开。
 */
export function shouldDefaultExpandPaths(profile: string | null | undefined): boolean {
  return !isStableProfile(profile)
}

/**
 * 格式化构建提交 SHA（缺失或非字符串时返回“未知”）
 */
export function formatCommit(commit: unknown): string {
  if (typeof commit === 'string' && commit.trim()) {
    const trimmed = commit.trim()
    return trimmed.length > 12 ? trimmed.slice(0, 12) : trimmed
  }
  return '未知'
}

/**
 * 格式化构建状态（dirty/clean，缺失或非布尔值时返回“未知”，不伪造）
 */
export function formatDirty(dirty: unknown): string {
  if (dirty === true) return '有未提交修改 (dirty)'
  if (dirty === false) return '干净 (clean)'
  return '未知'
}

/**
 * 格式化构建时间（缺失或非字符串时返回“未知”）
 */
export function formatBuiltAt(builtAt: unknown): string {
  if (typeof builtAt === 'string' && builtAt.trim()) {
    return builtAt.trim()
  }
  return '未知'
}

/**
 * 格式化打包分发类型（仅真实布尔区分打包/源码，null 或非布尔显示未知）
 */
export function formatPackaged(packaged: unknown): string {
  if (packaged === true) return '打包发行版 (Packaged)'
  if (packaged === false) return '源码开发版 (Source / Dev)'
  return '未知'
}

/**
 * 格式化 Profile 显示徽章与样式归类
 */
export function formatProfileBadge(profile: string | null | undefined): {
  label: string
  isStable: boolean
} {
  const isStable = isStableProfile(profile)
  const trimmed = typeof profile === 'string' ? profile.trim() : ''
  if (!trimmed) {
    return { label: '未分配 Profile', isStable: false }
  }
  if (isStable) {
    return { label: '日常正式环境 (stable)', isStable: true }
  }
  return { label: `开发/任务环境 (${trimmed})`, isStable: false }
}

/**
 * 白名单过滤与清洗。
 * 严格只保留指定白名单字段，剔除任何可能混入的 token, secret, 敏感信息及私有字段。
 * packaged 字段仅接受实际 boolean 类型，缺失、null 或字符串强制规范为 null，避免误判来源。
 */
export function sanitizeEnvironmentInfo(raw: unknown): SanitizedEnvironmentInfo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }

  const input = raw as RawEnvironmentInput

  const profile = typeof input.profile === 'string' ? input.profile.trim() : ''
  const packaged = typeof input.packaged === 'boolean' ? input.packaged : null
  const version = typeof input.version === 'string' ? input.version.trim() : ''
  const sourceDir = typeof input.sourceDir === 'string' ? input.sourceDir.trim() : ''
  const userData = typeof input.userData === 'string' ? input.userData.trim() : ''
  const runtimeDir = typeof input.runtimeDir === 'string' ? input.runtimeDir.trim() : ''
  const endpointFile = typeof input.endpointFile === 'string' ? input.endpointFile.trim() : ''

  let commit: string | null = null
  let dirty: boolean | null = null
  let builtAt: string | null = null

  if (input.build && typeof input.build === 'object' && !Array.isArray(input.build)) {
    if (typeof input.build.commit === 'string' && input.build.commit.trim()) {
      commit = input.build.commit.trim()
    }
    if (typeof input.build.dirty === 'boolean') {
      dirty = input.build.dirty
    }
    if (typeof input.build.builtAt === 'string' && input.build.builtAt.trim()) {
      builtAt = input.build.builtAt.trim()
    }
  }

  return {
    profile,
    packaged,
    version,
    sourceDir,
    userData,
    runtimeDir,
    endpointFile,
    build: {
      commit,
      dirty,
      builtAt,
    },
  }
}

/**
 * 安全获取运行环境诊断信息。
 * 完备处理纯普通浏览器无 utaAPI、主进程未响应或抛错等边界。
 * 规则：
 * - 只有环境完全缺失 utaAPI / getEnvironmentInfo 时才标为 'no-api'；
 * - API 存在但返回 null 或抛出异常均标为 'error'（支持重试）；
 * - 错误信息使用固定文案，严禁拼接或输出原始 err.message，杜绝泄漏凭据与内部异常。
 */
export async function fetchEnvironmentDiagnostics(
  utaAPI?: Window['utaAPI'],
): Promise<DiagnosticsState> {
  if (!utaAPI || typeof utaAPI.getEnvironmentInfo !== 'function') {
    return {
      status: 'no-api',
      data: null,
      errorMessage: '当前运行于普通浏览器环境，未检测到桌面运行环境 API。',
    }
  }

  try {
    const raw = await utaAPI.getEnvironmentInfo()
    if (!raw) {
      return {
        status: 'error',
        data: null,
        errorMessage: '获取环境诊断信息失败，请重试。',
      }
    }

    const sanitized = sanitizeEnvironmentInfo(raw)
    if (!sanitized) {
      return {
        status: 'error',
        data: null,
        errorMessage: '获取环境诊断信息失败，请重试。',
      }
    }

    return {
      status: 'success',
      data: sanitized,
      errorMessage: null,
    }
  } catch {
    // 严禁输出原始 err.message 或将异常内容回显至 UI
    return {
      status: 'error',
      data: null,
      errorMessage: '获取环境诊断信息失败，请重试。',
    }
  }
}
