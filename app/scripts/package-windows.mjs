/** Build Windows packages and source manifests without changing the installed app. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.dirname(appDir)
const args = process.argv.slice(2)
if (args.some(arg => arg !== '--zip-only')) throw new Error('Usage: package-windows.mjs [--zip-only]')
const zipOnly = args.includes('--zip-only')
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
if (shareMode && !zipOnly) throw new Error('Share packages require the ZIP-only entry: npm run dist:zip')
const info = {
  commit: git('rev-parse', 'HEAD'),
  dirty: !!git('status', '--porcelain', '--untracked-files=normal'),
  builtAt: new Date().toISOString(),
  node: process.version,
  version: JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version,
}
if (info.dirty) throw new Error('Commit or isolate source changes before packaging a Windows release')
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
run('electron-builder/cli.js', ['--config', builderConfig, '--win', 'zip', ...(!zipOnly ? ['nsis'] : []), '--x64', '--publish', 'never'])
if (git('rev-parse', 'HEAD') !== info.commit || git('status', '--porcelain', '--untracked-files=normal')) {
  throw new Error('Source changed during packaging; these packages are not eligible for promotion')
}
const artifacts = [`Uta-${info.version}${shareMode ? '-share' : ''}-win-x64.zip`]
if (!zipOnly) artifacts.push(`Uta-Setup-${info.version}.exe`)
const checksums = []
for (const archive of artifacts) {
  const file = path.join(appDir, 'release', archive)
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  const sha256 = hash.digest('hex')
  fs.writeFileSync(`${file}.manifest.json`, JSON.stringify({ ...info, archive, sha256 }, null, 2) + '\n')
  checksums.push(`${sha256}  ${archive}`)
  console.log(`Package: ${file}\nSHA256: ${sha256}\nSource: ${info.commit}`)
}
fs.writeFileSync(path.join(appDir, 'release', 'SHA256SUMS.txt'), checksums.join('\n') + '\n')
