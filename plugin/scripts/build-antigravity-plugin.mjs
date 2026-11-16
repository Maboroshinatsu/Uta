/**
 * 组装自包含且可直接安装的 Antigravity 插件目录与 ZIP。
 *
 * hook 与 MCP 服务端都用 esbuild 和 plugin/shared 打成单文件；
 * 脱离仓库后不再依赖 runtime/ 下的共享模块副本。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { bundleEntry } from './plugin-bundler.mjs'
import { motionSkillMarkdown } from '../shared/uta-motion.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(here, '..')
const srcDir = path.join(pluginRoot, 'plugins', 'antigravity')
const mcpServer = path.join(pluginRoot, 'plugins', 'deskpet-mcp', 'server.mjs')
const distRoot = path.join(pluginRoot, 'dist')
const outDir = path.join(distRoot, 'uta-antigravity-plugin')
const zipPath = path.join(distRoot, 'uta-antigravity-plugin.zip')

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  console.log('  +', path.relative(outDir, dest))
}

console.log('assembling Antigravity plugin ->', outDir)
resetDir(outDir)

copy(path.join(srcDir, 'plugin.json'), path.join(outDir, 'plugin.json'))
copy(path.join(srcDir, 'mcp_config.json'), path.join(outDir, 'mcp_config.json'))
copy(path.join(srcDir, 'hooks.json'), path.join(outDir, 'hooks.json'))
copy(path.join(srcDir, 'README.md'), path.join(outDir, 'README.md'))
const skill = path.join(outDir, 'skills', 'uta-live2d-motion', 'SKILL.md')
fs.mkdirSync(path.dirname(skill), { recursive: true })
fs.writeFileSync(skill, motionSkillMarkdown)
copy(
  path.join(srcDir, 'scripts', 'launch_deskpet_mcp.cmd'),
  path.join(outDir, 'scripts', 'launch_deskpet_mcp.cmd'),
)

const runtimeDir = path.join(outDir, 'runtime')
fs.mkdirSync(runtimeDir, { recursive: true })
bundleEntry({
  entry: path.join(srcDir, 'src', 'uta-antigravity-hook.mjs'),
  outfile: path.join(runtimeDir, 'uta-antigravity-hook.mjs'),
})
console.log('  + runtime/uta-antigravity-hook.mjs (bundled)')
bundleEntry({
  entry: mcpServer,
  outfile: path.join(runtimeDir, 'deskpet-mcp.mjs'),
})
console.log('  + runtime/deskpet-mcp.mjs (bundled)')

// 产物自检：单文件产物里不应再有需要解析的相对 import
for (const file of ['uta-antigravity-hook.mjs', 'deskpet-mcp.mjs']) {
  const full = path.join(runtimeDir, file)
  const text = fs.readFileSync(full, 'utf8')
  const matches = [...text.matchAll(/from\s+'(\.[^']+)'/g)].map((m) => m[1])
  if (matches.length > 0) {
    throw new Error(`${file} 仍有未打包的相对 import: ${matches.join(', ')}`)
  }
}
console.log('self-contained bundle check: OK')

try {
  fs.rmSync(zipPath, { force: true })
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -Force`,
    ],
    { stdio: 'inherit' },
  )
  console.log('zip ->', zipPath)
} catch (err) {
  console.warn('ZIP 生成失败（目录产物仍然可用）:', err.message)
}

/**
 * Antigravity 会用插件目录名拼 MCP 工具名（mcp_<dir>_<server>_<tool>），
 * 目录名过长或插件目录里残留 .bak-* 备份都会超过 64 字符并被整段判无效。
 * 安装时把备份移出 plugins/，并用绝对路径重写 MCP 启动命令，避免 cwd 差异。
 */
function installPlugin(targetDir, label) {
  const pluginsDir = path.dirname(targetDir)
  const configDir = path.dirname(pluginsDir)
  const backupRoot = path.join(configDir, 'plugin-backups')
  fs.mkdirSync(pluginsDir, { recursive: true })
  fs.mkdirSync(backupRoot, { recursive: true })
  const scope = fs.realpathSync(configDir)
  for (const dir of [pluginsDir, backupRoot, ...(fs.existsSync(targetDir) ? [targetDir] : [])]) {
    const relative = path.relative(scope, fs.realpathSync(dir))
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Antigravity install path is outside its scope: ${dir}`)
    }
  }
  const staging = fs.mkdtempSync(path.join(backupRoot, 'uta-deskpet-stage-'))
  fs.cpSync(outDir, staging, { recursive: true })
  const file = path.join(staging, 'mcp_config.json')
  const config = JSON.parse(fs.readFileSync(file, 'utf8'))
  config.mcpServers['uta-deskpet'].args = [path.join(targetDir, 'runtime', 'deskpet-mcp.mjs')]
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
  let backup
  if (fs.existsSync(targetDir)) {
    backup = path.join(fs.mkdtempSync(path.join(backupRoot, 'uta-deskpet-')), 'plugin')
    fs.renameSync(targetDir, backup)
  }
  try { fs.renameSync(staging, targetDir) }
  catch (error) {
    if (backup) fs.renameSync(backup, targetDir)
    throw error
  }
  if (backup) console.log(`${label} backup -> ${backup}`)
  console.log(`${label} install: OK -> ${targetDir}`)
}

// 可选：一键安装到工作区或全局
if (process.argv.includes('--install-workspace')) {
  // 查找工作区根目录中的 .agents/plugins/uta-deskpet（支持 Uta 子目录或当前父工作区）
  let workspaceRoot = path.resolve(pluginRoot, '..')
  const parentAgents = path.join(path.resolve(workspaceRoot, '..'), '.agents')
  if (fs.existsSync(parentAgents)) {
    workspaceRoot = path.resolve(workspaceRoot, '..')
  }
  const pluginsDir = path.join(workspaceRoot, '.agents', 'plugins')
  fs.mkdirSync(pluginsDir, { recursive: true })
  const backupRoot = path.join(workspaceRoot, '.agents', 'plugin-backups')
  for (const entry of fs.readdirSync(pluginsDir)) {
    if (!/^uta-deskpet.*[._]bak-/i.test(entry)) continue
    fs.mkdirSync(backupRoot, { recursive: true })
    fs.renameSync(
      path.join(pluginsDir, entry),
      path.join(backupRoot, `${entry}-${Date.now()}`),
    )
    console.log(`moved plugin backup out of discovery path -> ${entry}`)
  }
  const targetDir = path.join(pluginsDir, 'uta-deskpet')
  console.log(`installing to workspace -> ${targetDir}`)
  installPlugin(targetDir, 'workspace')
}

if (process.argv.includes('--install-global')) {
  const globalDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'uta-deskpet')
  console.log(`installing to global -> ${globalDir}`)
  installPlugin(globalDir, 'global')
}
