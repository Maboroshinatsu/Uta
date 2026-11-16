import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

const appDir = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const mode = process.argv[2]
if (process.argv.length > 3 || (mode && !['--candidate', '--installer'].includes(mode))) {
  throw Error('Usage: verify-windows.mjs [--candidate|--installer]')
}
const candidate = mode === '--candidate'
const installer = mode === '--installer'
const packaged = candidate || installer
const pkg = require('../package.json')
if (process.platform !== 'win32') throw Error('Windows is required for this verification.')
if (installer && (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted')) {
  throw Error('Installer verification requires a disposable GitHub-hosted Windows runner.')
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-windows-check-'))
const profile = path.join(root, 'profile')
const endpointFile = path.join(profile, 'runtime-endpoint.json')
const historyFile = path.join(profile, 'chat-history.v1.json')
const legacyMessage = 'Message saved by the previous version.'
const liveMessage = 'Message sent through the running desktop bridge.'
let uninstaller

async function waitFor(read, description, deadline = Date.now() + 25000) {
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await delay(100)
  }
  throw Error(`Timed out waiting for ${description}`)
}

async function verifyCandidate() {
  const archive = path.join(appDir, 'release', installer ? `Uta-Setup-${pkg.version}.exe` : `Uta-${pkg.version}-win-x64.zip`)
  const manifest = JSON.parse(fs.readFileSync(`${archive}.manifest.json`, 'utf8'))
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(archive)) hash.update(chunk)
  assert.equal(hash.digest('hex'), manifest.sha256)
  assert.equal(manifest.dirty, false)
  assert.equal(manifest.commit, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appDir, encoding: 'utf8' }).trim())
  assert.equal(manifest.version, pkg.version)
  assert.equal(manifest.archive, path.basename(archive))
  const destination = path.join(root, 'candidate')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', installer
    ? '$p = Start-Process -FilePath $env:UTA_VERIFY_ARCHIVE -ArgumentList "/S /currentuser /D=$env:UTA_VERIFY_PACKAGE_DIR" -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode'
    : 'Expand-Archive -LiteralPath $env:UTA_VERIFY_ARCHIVE -DestinationPath $env:UTA_VERIFY_PACKAGE_DIR'], {
    env: { ...process.env, UTA_VERIFY_ARCHIVE: archive, UTA_VERIFY_PACKAGE_DIR: destination }, windowsHide: true,
    timeout: 120000,
  })
  if (installer) uninstaller = path.join(destination, 'Uninstall Uta.exe')
  const { extractFile, listPackage } = require('@electron/asar')
  const archiveAsar = path.join(destination, 'resources', 'app.asar')
  const build = JSON.parse(extractFile(archiveAsar, path.join('out', 'build-info.json')).toString('utf8'))
  assert.equal(build.commit, manifest.commit)
  assert.equal(build.version, manifest.version)
  assert.ok(extractFile(archiveAsar, path.join('out', 'main', 'model-import-worker.js')).length)
  assert.equal(listPackage(archiveAsar).some(file => /\.(can3|cmo3)$/i.test(file)), false)
  for (const file of ['LICENSE-Uta.txt', 'THIRD_PARTY_LICENSES.md', 'THIRD-PARTY-NOTICES.txt', 'HIYORI-README.txt', 'FIRST-READ.md', 'MAIBOT-ADAPTER.md', 'Pets/README.txt']) {
    assert.ok(fs.statSync(path.join(destination, file)).size > 0, `Missing bundled file: ${file}`)
  }
  for (const directory of ['codex-marketplace', 'deepseek-harness', 'uta-qoder-plugin', 'uta-antigravity-plugin', 'claude-marketplace', 'zcode-marketplace', 'uta-opencode-plugin']) {
    assert.ok(fs.statSync(path.join(destination, 'resources', 'uta-plugins', directory)).isDirectory(), `Missing connector: ${directory}`)
  }
  return path.join(destination, 'Uta.exe')
}

async function verifyBuiltWorker() {
  const source = path.join(root, 'import-fixture')
  const model = path.join(source, 'test.model3.json')
  fs.mkdirSync(source)
  fs.writeFileSync(path.join(source, 'test.moc3'), 'MOC3fixture')
  fs.writeFileSync(path.join(source, 'test.png'), 'texture fixture')
  fs.writeFileSync(path.join(source, 'test.motion3.json'), '{}')
  fs.writeFileSync(model, JSON.stringify({ FileReferences: {
    Moc: 'test.moc3', Textures: ['test.png'],
    Motions: { Idle: Array(2000).fill({ File: 'test.motion3.json' }) },
  } }))
  const worker = new Worker(path.join(appDir, 'out', 'main', 'model-import-worker.js'), {
    workerData: { root: source, models: path.join(profile, 'models'), token: 'test' },
  })
  let timer
  try {
    const result = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error('Model inspection timed out.')), 10000)
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.once('exit', () => reject(Error('Model inspection exited without a result.')))
    })
    assert.deepEqual(result[0].errors, [])
    assert.match(result[0].summary, /2000/)
    assert.equal(result[0].files.length, 4)
  } finally {
    clearTimeout(timer)
    await worker.terminate()
  }
}

async function withDesktop(executable, action) {
  const env = {
    ...process.env, DESKPET_HEADLESS: '1', UTA_SKIP_ONBOARDING: '1', UTA_BOUND_HOST: 'codex',
    UTA_PROFILE: 'windows-check', UTA_USER_DATA_DIR: profile, UTA_RUNTIME_DIR: profile, UTA_ENDPOINT_FILE: endpointFile,
  }
  for (const key of ['DESKPET_ENDPOINT_FILE', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL']) delete env[key]
  const graphics = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  const child = spawn(executable, packaged ? graphics : [appDir, ...graphics], {
    env, cwd: path.dirname(executable), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-5000) })
  const stopped = new Promise(resolve => child.once('exit', resolve))
  let launchError
  child.on('error', error => { launchError = error })
  try {
    const endpoint = await waitFor(async () => {
      if (launchError) throw launchError
      if (child.exitCode !== null) throw Error(`Uta exited with code ${child.exitCode}`)
      try {
        const info = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
        if (info.pid !== child.pid) return null
        const health = await runtimeRequest(info, '/health')
        return health.characterAvailable && health.profile === 'windows-check' && !health.stableData ? info : null
      } catch { return null }
    }, 'the isolated renderer and preload')
    await action(endpoint)
  } catch (error) {
    throw Error(`${error.message}\n${logs}`, { cause: error })
  } finally {
    if (child.pid) {
      child.kill()
      await stopped
    }
  }
}

async function runtimeRequest(endpoint, route, body) {
  const response = await fetch(`http://127.0.0.1:${endpoint.port}${route}`, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(2500),
    headers: { Authorization: `Bearer ${endpoint.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) throw Error(`Uta runtime returned HTTP ${response.status} for ${route}`)
  return response.json()
}

function readHistory() {
  return JSON.parse(fs.readFileSync(historyFile, 'utf8'))
}

try {
  fs.mkdirSync(profile)
  fs.writeFileSync(historyFile, JSON.stringify({ version: 1, entries: [
    { id: 'legacy-message', role: 'assistant', text: legacyMessage, timestamp: 1 },
    { id: 'legacy-receipt', role: 'assistant', text: 'Old completion', timestamp: 2, kind: 'completion' },
  ] }))
  const executable = packaged ? await verifyCandidate() : require('electron')
  if (!packaged) await verifyBuiltWorker()
  await withDesktop(executable, async endpoint => {
    await waitFor(async () => {
      const context = await runtimeRequest(endpoint, '/context')
      return context.modelContext?.ready && context.modelContext.kind === 'live2d'
    }, 'the bundled Live2D model')
    const receipt = await runtimeRequest(endpoint, '/command', {
      protocolVersion: '2.0', meta: { hostId: 'codex', eventId: 'smoke-message' },
      command: { command: 'notify', text: liveMessage },
    })
    assert.equal(receipt.accepted, true)
    const migrated = await waitFor(() => {
      const doc = readHistory()
      return doc.entries.some(message => message.text === liveMessage) ? doc : null
    }, 'renderer notification and history persistence')
    assert.equal(migrated.entries[0].text, legacyMessage)
    assert.equal(migrated.completionReceipts[0].id, 'legacy-receipt')
  })
  await withDesktop(executable, async () => {
    const history = readHistory()
    assert.deepEqual(history.entries.map(message => message.text), [legacyMessage, liveMessage])
    assert.equal(history.completionReceipts[0].id, 'legacy-receipt')
  })
  console.log('Windows startup, bundled Live2D, legacy history, renderer notification and restart passed.')
} finally {
  if (uninstaller && fs.existsSync(uninstaller)) {
    execFileSync(uninstaller, ['/S'], { windowsHide: true, timeout: 120000 })
    await waitFor(() => !fs.existsSync(path.join(path.dirname(uninstaller), 'Uta.exe')), 'installer removal')
    assert.ok(fs.existsSync(historyFile), 'Uninstall removed the isolated user data')
    console.log('Windows installer and uninstaller passed.')
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 })
}
