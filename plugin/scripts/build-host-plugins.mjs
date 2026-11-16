/**
 * 组装 Claude Code / ZCode / Codex / OpenCode 的自包含插件产物与本地市场。
 *
 * 宿主安装插件时会把目录整体复制走，因此 runtime/ 下的 hook 与 MCP
 * 服务端都用 esbuild 和 plugin/shared 打成单文件，不再复制共享模块。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleEntry } from './plugin-bundler.mjs'
import { motionSkillMarkdown } from '../shared/uta-motion.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(here, '..')
const sharedDir = path.join(pluginRoot, 'shared')
const pluginsDir = path.join(pluginRoot, 'plugins')
const distRoot = path.join(pluginRoot, 'dist')

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true })
}

function writeJson(dest, value) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, JSON.stringify(value, null, 2) + '\n')
}

function bundleRuntime(outDir) {
  const runtimeDir = path.join(outDir, 'runtime')
  fs.mkdirSync(runtimeDir, { recursive: true })
  bundleEntry({
    entry: path.join(sharedDir, 'uta-host-hook.mjs'),
    outfile: path.join(runtimeDir, 'uta-host-hook.mjs'),
  })
  bundleEntry({
    entry: path.join(pluginsDir, 'deskpet-mcp', 'server.mjs'),
    outfile: path.join(runtimeDir, 'deskpet-mcp.mjs'),
  })
}

function checkSelfContained(outDir) {
  const runtimeDir = path.join(outDir, 'runtime')
  for (const file of fs.readdirSync(runtimeDir)) {
    if (!file.endsWith('.mjs')) continue
    const full = path.join(runtimeDir, file)
    const text = fs.readFileSync(full, 'utf8')
    for (const match of text.matchAll(/from\s+'(\.[^']+)'/g)) {
      const resolved = path.resolve(path.dirname(full), match[1])
      if (!fs.existsSync(resolved)) {
        throw new Error(`${outDir}: ${file} 的相对 import 在产物中缺失: ${match[1]}`)
      }
    }
  }
}

function buildHostPlugin(name, sourceSubdir, manifestFile) {
  const source = path.join(pluginsDir, sourceSubdir)
  const outDir = path.join(distRoot, name)
  resetDir(outDir)
  copyDir(source, outDir)
  bundleRuntime(outDir)
  if (sourceSubdir === 'codex' || sourceSubdir === 'claude-code') {
    const skill = path.join(outDir, 'skills', 'uta-live2d-motion', 'SKILL.md')
    fs.mkdirSync(path.dirname(skill), { recursive: true })
    fs.writeFileSync(skill, motionSkillMarkdown)
  }
  if (!fs.existsSync(path.join(outDir, manifestFile))) {
    throw new Error(`${name}: manifest 缺失 ${manifestFile}`)
  }
  checkSelfContained(outDir)
  console.log(`built ${name} -> ${path.relative(pluginRoot, outDir)}`)
  return outDir
}

function buildMarketplace(name, marketplaceFile, pluginOutDir, entryName = 'uta-deskpet', version = '0.1.0') {
  const root = path.join(distRoot, name)
  resetDir(root)
  const pluginCopy = path.join(root, 'plugins', entryName)
  copyDir(pluginOutDir, pluginCopy)
  const source = `./plugins/${entryName}`

  if (marketplaceFile.split(path.sep).join('/').endsWith('.agents/plugins/marketplace.json')) {
    writeJson(path.join(root, marketplaceFile), {
      name: 'uta',
      interface: { displayName: 'Uta Deskpet' },
      plugins: [
        {
          name: entryName,
          source: { source: 'local', path: source },
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
          category: 'Productivity',
        },
      ],
    })
  } else {
    writeJson(path.join(root, marketplaceFile), {
      name: 'uta',
      description: 'Uta desktop pet companion plugins',
      owner: { name: 'Maboroshinatsu' },
      plugins: [
        {
          name: entryName,
          source,
          version,
          description:
            'Uta desktop pet companion: lifecycle state, completion bubble, approval cards, and character tools.',
        },
      ],
    })
  }
  console.log(`market ${name} -> ${path.relative(pluginRoot, root)}`)
}

const claudeDir = buildHostPlugin(
  'uta-claude-plugin',
  'claude-code',
  path.join('.claude-plugin', 'plugin.json'),
)
buildMarketplace(
  'claude-marketplace',
  path.join('.claude-plugin', 'marketplace.json'),
  claudeDir,
  'uta-deskpet',
  '0.1.10',
)

const zcodeDir = buildHostPlugin(
  'uta-zcode-plugin',
  'zcode',
  path.join('.zcode-plugin', 'plugin.json'),
)
buildMarketplace(
  'zcode-marketplace',
  path.join('.claude-plugin', 'marketplace.json'),
  zcodeDir,
  'uta-deskpet',
  '0.1.7',
)

const codexDir = buildHostPlugin(
  'uta-codex-plugin',
  'codex',
  path.join('.codex-plugin', 'plugin.json'),
)
buildMarketplace(
  'codex-marketplace',
  path.join('.agents', 'plugins', 'marketplace.json'),
  codexDir,
)

const opencodeDir = path.join(distRoot, 'uta-opencode-plugin')
resetDir(opencodeDir)
bundleEntry({ entry: path.join(pluginsDir, 'opencode', 'uta-opencode.mjs'), outfile: path.join(opencodeDir, 'uta-opencode.ts') })
bundleEntry({ entry: path.join(pluginsDir, 'deskpet-mcp', 'server.mjs'), outfile: path.join(opencodeDir, 'deskpet-mcp.mjs') })
copyFile(path.join(pluginsDir, 'opencode', 'README.md'), path.join(opencodeDir, 'README.md'))
console.log(`built uta-opencode-plugin -> ${path.relative(pluginRoot, opencodeDir)}`)

console.log('\nInstall hints:')
console.log('  claude plugin marketplace add', path.join(distRoot, 'claude-marketplace'))
console.log('  claude plugin install uta-deskpet@uta')
console.log('  zcode plugins marketplace add', path.join(distRoot, 'zcode-marketplace'))
console.log('  zcode plugins install uta-deskpet@uta')
console.log('  codex plugin marketplace add', path.join(distRoot, 'codex-marketplace'))
console.log('  codex plugin add uta-deskpet@uta')
console.log('  opencode config plugin ->', path.join(opencodeDir, 'uta-opencode.ts'))
