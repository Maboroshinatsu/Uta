/** 生成 ZIP 和来源清单，不安装插件、不提升日常版本。 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.dirname(appDir)
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8', windowsHide: true }).trim()
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const tempDir = path.join(appDir, 'build', 'tmp')
fs.mkdirSync(tempDir, { recursive: true })
Object.assign(env, { TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir })
const run = (script, args) => execFileSync(process.execPath, [path.join(appDir, 'node_modules', script), ...args], {
  cwd: appDir, env, stdio: 'inherit', windowsHide: true,
})
const shareMode = process.env.UTA_SHARE_PACKAGE === '1'
const info = {
  commit: git('rev-parse', 'HEAD'),
  dirty: !!git('status', '--porcelain', '--untracked-files=normal'),
  builtAt: new Date().toISOString(),
  node: process.version,
  version: JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version,
}
if (info.dirty) throw new Error('Commit or isolate source changes before packaging a release ZIP')
run('electron/install.js', [])
execFileSync(process.execPath, [path.join(appDir, 'scripts', 'dependency-notices.mjs')], {
  cwd: appDir, env, stdio: 'inherit', windowsHide: true,
})
run('electron-vite/bin/electron-vite.js', ['build'])

if (shareMode) {
  const dsModelDir = (process.env.UTA_DS_MODEL_DIR || '').trim()
  if (!dsModelDir) throw new Error('UTA_DS_MODEL_DIR is required when UTA_SHARE_PACKAGE=1')
  if (!fs.existsSync(path.join(dsModelDir, 'c_0120.model3.json'))) {
    throw new Error(`DS model folder is missing c_0120.model3.json: ${dsModelDir}`)
  }
  if (!fs.existsSync(path.join(dsModelDir, 'MODEL-NOTICE.txt'))) {
    throw new Error(`DS model folder is missing MODEL-NOTICE.txt: ${dsModelDir}`)
  }
  for (const [label, file] of [
    ['adapter', path.join(source, 'maibot-adapter', 'plugin.py')],
    ['adapter manifest', path.join(source, 'maibot-adapter', '_manifest.json')],
    ['Hiyori model', path.join(appDir, 'out', 'renderer', 'models', 'hiyori_pro_zh', 'hiyori_pro_zh', 'runtime', 'hiyori_pro_t11.model3.json')],
  ]) {
    if (!fs.existsSync(file)) throw new Error(`Share package is missing ${label}: ${file}`)
  }
  const target = path.join(appDir, 'out', 'renderer', 'models', 'DS-control')
  fs.rmSync(target, { recursive: true, force: true })
  fs.cpSync(dsModelDir, target, { recursive: true })
  info.sharePackage = true
  info.models = ['DS-control/c_0120', 'hiyori_pro_zh']
}

fs.writeFileSync(path.join(appDir, 'out', 'build-info.json'), JSON.stringify(info, null, 2) + '\n')
const builderConfig = shareMode ? 'electron-builder.share.yml' : 'electron-builder.zip.yml'
run('electron-builder/cli.js', ['--config', builderConfig, '--win', 'zip', '--x64', '--publish', 'never'])
if (git('rev-parse', 'HEAD') !== info.commit || git('status', '--porcelain', '--untracked-files=normal')) {
  throw new Error('Source changed during packaging; this ZIP is not eligible for promotion')
}
const archive = path.join(appDir, 'release', `Uta-${info.version}${shareMode ? '-share' : ''}-win-x64.zip`)
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
fs.writeFileSync(`${archive}.manifest.json`, JSON.stringify({ ...info, archive: path.basename(archive), sha256 }, null, 2) + '\n')
console.log(`ZIP: ${archive}\nSHA256: ${sha256}\nSource: ${info.commit}${info.dirty ? ' (dirty, not eligible for stable promotion)' : ''}`)
