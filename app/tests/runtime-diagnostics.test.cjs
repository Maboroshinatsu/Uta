'use strict'
/**
 * 运行环境身份与诊断测试。
 * 覆盖：
 * 1. 字段白名单与隐私保护（剥离未授权敏感字段如 token, key 等）
 * 2. profile 分类与内部路径折叠策略（stable 默认折叠，其他默认展开）
 * 3. 构建信息解析（commit, dirty, builtAt 缺失时显示未知而非伪造）
 * 4. packaged 来源真实性（仅真实布尔保留，缺失、null、字符串规范为 null 并显示未知）
 * 5. 浏览器环境兼容（无 utaAPI 标为 no-api，平滑降级）
 * 6. API 返回 null 标为 error（支持重试，不误判为 no-api）
 * 7. 异常拦截与安全边界（严禁在错误信息中泄露原始异常或任何 token/key）
 * 8. 错误恢复与重试行为（先失败后成功的重试调用）
 * 9. 避免伪造桥在线状态
 */

const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function loadDiagnosticsService() {
  const filePath = path.resolve(__dirname, '../src/renderer/services/runtime-diagnostics.ts')
  const code = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      console,
      Promise,
      String,
      Boolean,
      Array,
      Object,
      Error,
    },
    { filename: filePath },
  )
  return module.exports
}

const service = loadDiagnosticsService()
const {
  isStableProfile,
  shouldDefaultExpandPaths,
  formatCommit,
  formatDirty,
  formatBuiltAt,
  formatPackaged,
  formatProfileBadge,
  sanitizeEnvironmentInfo,
  fetchEnvironmentDiagnostics,
} = service

test('Profile 分类与内部路径折叠逻辑：stable 默认折叠，其余默认展开', () => {
  assert.equal(isStableProfile('stable'), true)
  assert.equal(isStableProfile('  stable  '), true)
  assert.equal(isStableProfile('task-antigravity'), false)
  assert.equal(isStableProfile('dev-1234567890ab'), false)
  assert.equal(isStableProfile('custom'), false)
  assert.equal(isStableProfile(''), false)
  assert.equal(isStableProfile(null), false)
  assert.equal(isStableProfile(undefined), false)

  // stable 内部路径默认折叠 (false)
  assert.equal(shouldDefaultExpandPaths('stable'), false)
  assert.equal(shouldDefaultExpandPaths('  stable  '), false)

  // 任务与开发 profile 内部路径默认展开 (true)
  assert.equal(shouldDefaultExpandPaths('task-antigravity'), true)
  assert.equal(shouldDefaultExpandPaths('dev-1234567890ab'), true)
  assert.equal(shouldDefaultExpandPaths('custom'), true)
  assert.equal(shouldDefaultExpandPaths(''), true)
  assert.equal(shouldDefaultExpandPaths(null), true)
})

test('构建信息缺失时显示未知而非伪造，不虚报 commit/dirty/builtAt', () => {
  // Commit 格式化
  assert.equal(formatCommit('dcf1b3fa1234567890'), 'dcf1b3fa1234')
  assert.equal(formatCommit('dcf1b3f'), 'dcf1b3f')
  assert.equal(formatCommit(null), '未知')
  assert.equal(formatCommit(undefined), '未知')
  assert.equal(formatCommit('   '), '未知')
  assert.equal(formatCommit(12345), '未知')

  // Dirty 状态格式化
  assert.equal(formatDirty(true), '有未提交修改 (dirty)')
  assert.equal(formatDirty(false), '干净 (clean)')
  assert.equal(formatDirty(null), '未知')
  assert.equal(formatDirty(undefined), '未知')
  assert.equal(formatDirty('true'), '未知')

  // BuiltAt 格式化
  assert.equal(formatBuiltAt('2026-10-22T20:00:00.000Z'), '2026-10-22T20:00:00.000Z')
  assert.equal(formatBuiltAt(null), '未知')
  assert.equal(formatBuiltAt(undefined), '未知')
  assert.equal(formatBuiltAt(''), '未知')
})

test('packaged 来源严谨性：仅真实布尔保留，缺失、null、字符串强制规范为 null 并显示未知', () => {
  // 真实 true
  const resTrue = sanitizeEnvironmentInfo({ packaged: true })
  assert.equal(resTrue.packaged, true)
  assert.equal(formatPackaged(resTrue.packaged), '打包发行版 (Packaged)')

  // 真实 false
  const resFalse = sanitizeEnvironmentInfo({ packaged: false })
  assert.equal(resFalse.packaged, false)
  assert.equal(formatPackaged(resFalse.packaged), '源码开发版 (Source / Dev)')

  // 缺失
  const resMissing = sanitizeEnvironmentInfo({})
  assert.equal(resMissing.packaged, null)
  assert.equal(formatPackaged(resMissing.packaged), '未知')

  // null
  const resNull = sanitizeEnvironmentInfo({ packaged: null })
  assert.equal(resNull.packaged, null)
  assert.equal(formatPackaged(resNull.packaged), '未知')

  // 字符串 'true' / 'false'（不能被强制转成布尔）
  const resStrTrue = sanitizeEnvironmentInfo({ packaged: 'true' })
  assert.equal(resStrTrue.packaged, null)
  assert.equal(formatPackaged(resStrTrue.packaged), '未知')

  const resStrFalse = sanitizeEnvironmentInfo({ packaged: 'false' })
  assert.equal(resStrFalse.packaged, null)
  assert.equal(formatPackaged(resStrFalse.packaged), '未知')

  // 数字 1 / 0
  const resNum = sanitizeEnvironmentInfo({ packaged: 1 })
  assert.equal(resNum.packaged, null)
  assert.equal(formatPackaged(resNum.packaged), '未知')
})

test('Profile 徽章与标签生成', () => {
  const stableBadge = formatProfileBadge('stable')
  assert.equal(stableBadge.isStable, true)
  assert.ok(stableBadge.label.includes('正式'))

  const taskBadge = formatProfileBadge('task-antigravity')
  assert.equal(taskBadge.isStable, false)
  assert.ok(taskBadge.label.includes('task-antigravity'))

  const emptyBadge = formatProfileBadge('')
  assert.equal(emptyBadge.isStable, false)
  assert.equal(emptyBadge.label, '未分配 Profile')
})

test('白名单机制与数据清洗：严格剔除 token, secret, chatLog 等未声明字段', () => {
  const untrustedInput = {
    profile: 'task-antigravity',
    packaged: false,
    version: '0.1.1',
    sourceDir: 'D:/Frankenstein/Uta-Workspace/tasks/antigravity-runtime-diagnostics',
    userData: 'C:/Users/Administrator/AppData/Roaming/uta-development/task-antigravity',
    runtimeDir: 'C:/Users/Administrator/AppData/Roaming/uta-development/task-antigravity',
    endpointFile: 'C:/Users/Administrator/AppData/Roaming/uta-development/task-antigravity/runtime-endpoint.json',
    build: {
      commit: '3ee3035eafb94ffd52a641759e66f0f9d2b2d990',
      dirty: false,
      builtAt: '2026-10-22T19:30:00Z',
      extraInternalFlag: 'forbidden',
    },
    // 以下敏感字段必须全部被剥离：
    token: 'super-secret-token-123456',
    secretKey: 'key_xyz987',
    apiKey: 'sk-abcdef',
    internalAuth: { bearer: 'xyz' },
    chatLog: 'user private message',
  }

  const clean = sanitizeEnvironmentInfo(untrustedInput)
  assert.ok(clean !== null)

  // 严格核对白名单顶级键集合
  const expectedKeys = [
    'profile',
    'packaged',
    'version',
    'sourceDir',
    'userData',
    'runtimeDir',
    'endpointFile',
    'build',
  ]
  assert.deepEqual(Object.keys(clean).sort(), expectedKeys.sort())

  // 核对 build 键集合
  const expectedBuildKeys = ['commit', 'dirty', 'builtAt']
  assert.deepEqual(Object.keys(clean.build).sort(), expectedBuildKeys.sort())

  // 验证未包含任何私密字段
  assert.equal(clean.token, undefined)
  assert.equal(clean.secretKey, undefined)
  assert.equal(clean.apiKey, undefined)
  assert.equal(clean.internalAuth, undefined)
  assert.equal(clean.chatLog, undefined)
  assert.equal(clean.build.extraInternalFlag, undefined)

  // 验证保留字段的准确性
  assert.equal(clean.profile, 'task-antigravity')
  assert.equal(clean.packaged, false)
  assert.equal(clean.version, '0.1.1')
  assert.equal(clean.build.commit, '3ee3035eafb94ffd52a641759e66f0f9d2b2d990')
  assert.equal(clean.build.dirty, false)
})

test('边界数据清洗：非对象输入或空值返回 null', () => {
  assert.equal(sanitizeEnvironmentInfo(null), null)
  assert.equal(sanitizeEnvironmentInfo(undefined), null)
  assert.equal(sanitizeEnvironmentInfo('bad-string'), null)
  assert.equal(sanitizeEnvironmentInfo([1, 2, 3]), null)
  assert.equal(sanitizeEnvironmentInfo(123), null)
})

test('环境诊断获取：普通浏览器无 utaAPI 接口时标为 no-api，不抛错', async () => {
  // 1. utaAPI 为 undefined
  const res1 = await fetchEnvironmentDiagnostics(undefined)
  assert.equal(res1.status, 'no-api')
  assert.equal(res1.data, null)
  assert.ok(res1.errorMessage.includes('普通浏览器'))

  // 2. utaAPI 存在但无 getEnvironmentInfo 方法
  const res2 = await fetchEnvironmentDiagnostics({})
  assert.equal(res2.status, 'no-api')
  assert.equal(res2.data, null)
})

test('环境诊断获取：API 返回 null 视为 error 并支持重试，不误判为 no-api', async () => {
  const fakeApiNull = {
    getEnvironmentInfo: async () => null,
  }
  const res = await fetchEnvironmentDiagnostics(fakeApiNull)
  assert.equal(res.status, 'error')
  assert.equal(res.data, null)
  assert.equal(res.errorMessage, '获取环境诊断信息失败，请重试。')
})

test('环境诊断获取：异常拦截与安全边界，严禁在错误信息中泄露原始异常或敏感 token/key', async () => {
  // 1. Error 对象中夹带 secret token 与内部详情
  const fakeApiSecretToken = {
    getEnvironmentInfo: async () => {
      throw new Error('Connection refused at 127.0.0.1:9880 with secret_token=sk-998877665544332211')
    },
  }
  const res1 = await fetchEnvironmentDiagnostics(fakeApiSecretToken)
  assert.equal(res1.status, 'error')
  assert.equal(res1.data, null)
  assert.equal(res1.errorMessage, '获取环境诊断信息失败，请重试。')
  assert.equal(res1.errorMessage.includes('secret_token'), false)
  assert.equal(res1.errorMessage.includes('sk-998877665544332211'), false)
  assert.equal(res1.errorMessage.includes('127.0.0.1'), false)

  // 2. 非 Error 对象的字符串拒绝（如内部抛出的敏感凭据）
  const fakeApiRawReject = {
    getEnvironmentInfo: async () => {
      return Promise.reject('DATABASE_PASSWORD=super_secret_pwd_xyz')
    },
  }
  const res2 = await fetchEnvironmentDiagnostics(fakeApiRawReject)
  assert.equal(res2.status, 'error')
  assert.equal(res2.data, null)
  assert.equal(res2.errorMessage, '获取环境诊断信息失败，请重试。')
  assert.equal(res2.errorMessage.includes('DATABASE_PASSWORD'), false)
  assert.equal(res2.errorMessage.includes('super_secret_pwd_xyz'), false)
})

test('环境诊断获取：先失败后成功的重试序列调用测试', async () => {
  let attempt = 0
  const mockApi = {
    getEnvironmentInfo: async () => {
      attempt++
      if (attempt === 1) {
        throw new Error('transient network or IPC error')
      }
      return {
        profile: 'task-antigravity',
        packaged: false,
        version: '0.1.1',
        sourceDir: 'D:/Frankenstein/Uta-Workspace/tasks/antigravity-runtime-diagnostics',
        userData: 'C:/Users/Administrator/AppData/Roaming/uta-development/task-antigravity',
        runtimeDir: 'C:/Users/Administrator/AppData/Roaming/uta-development/task-antigravity',
        endpointFile: 'C:/Users/Administrator/AppData/Roaming/uta-development/task-antigravity/runtime-endpoint.json',
        build: {
          commit: '3ee3035eafb94ffd52a641759e66f0f9d2b2d990',
          dirty: false,
          builtAt: '2026-10-22T20:00:00Z',
        },
      }
    },
  }

  // 第一次调用失败：进入 error 态，返回固定友好文案，不泄露异常内容
  const firstRes = await fetchEnvironmentDiagnostics(mockApi)
  assert.equal(firstRes.status, 'error')
  assert.equal(firstRes.data, null)
  assert.equal(firstRes.errorMessage, '获取环境诊断信息失败，请重试。')

  // 用户点击重试（第二次调用）：调用成功，进入 success 态，返回清洗后的白名单数据
  const secondRes = await fetchEnvironmentDiagnostics(mockApi)
  assert.equal(secondRes.status, 'success')
  assert.equal(secondRes.errorMessage, null)
  assert.ok(secondRes.data !== null)
  assert.equal(secondRes.data.profile, 'task-antigravity')
  assert.equal(secondRes.data.packaged, false)
  assert.equal(secondRes.data.build.commit, '3ee3035eafb94ffd52a641759e66f0f9d2b2d990')
})

test('诊断数据不伪称“桥在线”或连接成功', () => {
  // 运行环境诊断仅描述环境身份，不声称宿主桥在线
  const fakeEnv = {
    profile: 'task-antigravity',
    packaged: false,
    version: '0.1.1',
    sourceDir: '',
    userData: '',
    runtimeDir: '',
    endpointFile: 'C:/endpoint.json',
    build: null,
  }
  const sanitized = sanitizeEnvironmentInfo(fakeEnv)
  assert.equal(sanitized.bridgeOnline, undefined)
  assert.equal(sanitized.connected, undefined)
  assert.equal(sanitized.online, undefined)
})
