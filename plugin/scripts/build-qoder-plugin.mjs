/**
 * 组装可直接安装的 Qoder 插件目录与 ZIP。
 *
 * Qoder 会把插件目录整体复制走，所以 hook 与 MCP 服务端都用 esbuild
 * 和 plugin/shared 打成单文件；产物不再需要复制共享模块或改写 import。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { bundleEntry } from './plugin-bundler.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(here, '..')
const srcDir = path.join(pluginRoot, 'plugins', 'qoder')
const mcpServer = path.join(pluginRoot, 'plugins', 'deskpet-mcp', 'server.mjs')
const distRoot = path.join(pluginRoot, 'dist')
const outDir = path.join(distRoot, 'uta-qoder-plugin')
const zipPath = path.join(distRoot, 'uta-qoder-plugin.zip')

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  console.log('  +', path.relative(outDir, dest))
}

console.log('assembling Qoder plugin ->', outDir)
resetDir(outDir)

copy(path.join(srcDir, '.qoder-plugin', 'plugin.json'), path.join(outDir, '.qoder-plugin', 'plugin.json'))
copy(path.join(srcDir, 'mcp.json'), path.join(outDir, 'mcp.json'))
copy(path.join(srcDir, 'hooks', 'hooks.json'), path.join(outDir, 'hooks', 'hooks.json'))
copy(path.join(srcDir, 'README.md'), path.join(outDir, 'README.md'))

const runtimeDir = path.join(outDir, 'runtime')
fs.mkdirSync(runtimeDir, { recursive: true })
bundleEntry({
  entry: path.join(srcDir, 'src', 'uta-hook.mjs'),
  outfile: path.join(runtimeDir, 'uta-hook.mjs'),
})
console.log('  + runtime/uta-hook.mjs (bundled)')
bundleEntry({
  entry: mcpServer,
  outfile: path.join(runtimeDir, 'deskpet-mcp.mjs'),
})
console.log('  + runtime/deskpet-mcp.mjs (bundled)')
copy(path.join(srcDir, 'scripts/launch-qoder-cli.mjs'), path.join(runtimeDir, 'launch-qoder-cli.mjs'))

// 产物自检：单文件产物里不应再有需要解析的相对 import
for (const file of ['uta-hook.mjs', 'deskpet-mcp.mjs']) {
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
