// Local developer lab. Uses its own Electron profile and a copied model, never the daily profile.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { app, BrowserWindow, screen } = require('electron')
const args = process.argv.slice(2)
const option = name => args[args.indexOf(name) + 1]
if (!args.includes('--model-dir') || !args.includes('--output')) throw new Error('--model-dir and --output are required')
const output = path.resolve(option('--output'))
const previous = path.join(output, 'runtime.json')
if (fs.existsSync(previous)) {
  const pid = JSON.parse(fs.readFileSync(previous, 'utf8')).pid
  let alive = false
  try { process.kill(pid, 0); alive = true } catch { /* completed previous lab */ }
  if (alive) throw new Error('This output directory belongs to a running lab')
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-live2d-lab-'))
const appRoot = path.resolve(__dirname, '../..')
fs.mkdirSync(output, { recursive: true })
fs.mkdirSync(path.join(root, 'appdata'), { recursive: true })
fs.cpSync(path.resolve(option('--model-dir')), path.join(root, 'profile/models/lab-model'), { recursive: true })
const modelDir = path.join(root, 'profile/models/lab-model')
const models = fs.readdirSync(modelDir).filter(n => n.endsWith('.model3.json'))
if (models.length !== 1) throw new Error('Expected one model3 file at model directory root')
app.setAppPath(appRoot)
app.setVersion(require(path.join(appRoot, 'package.json')).version)
app.setPath('appData', path.join(root, 'appdata'))
Object.assign(process.env, { UTA_PROFILE: 'live2d-lab', UTA_USER_DATA_DIR: path.join(root, 'profile'),
  UTA_RUNTIME_DIR: path.join(root, 'runtime'), UTA_ENDPOINT_FILE: path.join(root, 'runtime/runtime-endpoint.json'),
  UTA_SKIP_ONBOARDING: '1', UTA_BOUND_HOST: 'codex' })
delete process.env.ELECTRON_RENDERER_URL
const modelUrl = 'uta://models/lab-model/' + encodeURIComponent(models[0])
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const store = "document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('deskpet')"
async function waitFor(check, message, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs
  do {
    const value = await check()
    if (value) return value
    await sleep(50)
  } while (Date.now() < end)
  throw new Error(message)
}

async function fingerprintModel() {
  const manifest = JSON.parse(fs.readFileSync(path.join(modelDir, models[0]), 'utf8').replace(/^\uFEFF/, ''))
  const refs = manifest.FileReferences
  const files = [models[0], refs.Moc, ...refs.Textures, refs.Physics, refs.Pose, refs.DisplayInfo,
    ...(refs.Expressions ?? []).map(entry => entry.File),
    ...Object.values(refs.Motions ?? {}).flatMap(entries => entries.flatMap(entry => [entry.File, entry.Sound]))]
  const rootPath = fs.realpathSync(modelDir)
  const hashes = []
  for (const name of [...new Set(files.filter(Boolean))].sort()) {
    const file = fs.realpathSync(path.resolve(rootPath, name))
    if (!file.startsWith(rootPath + path.sep)) throw new Error('Model reference escapes the copied model')
    const hash = createHash('sha256')
    for await (const bytes of fs.createReadStream(file)) hash.update(bytes)
    hashes.push([name, hash.digest('hex')])
  }
  return 'lab-sha256:' + createHash('sha256').update(JSON.stringify(hashes)).digest('hex')
}

let seeded = false, busy = false, main, placed = false
const errors = []
app.on('web-contents-created', (_, wc) => {
  wc.on('console-message', (_event, level, message) => { if (level >= 2) errors.push(message) })
  wc.on('did-finish-load', async () => {
    if (wc.getURL().includes('#settings') || seeded) return
    seeded = true
    await wc.executeJavaScript(`localStorage.setItem('deskpet/model-path', ${JSON.stringify(modelUrl)});localStorage.setItem('deskpet/gaze-follow','false')`)
    wc.reload()
  })
})
setInterval(async () => {
  if (busy) return
  main = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('#settings'))
  if (main && !placed) {
    placed = true
    main.webContents.setBackgroundThrottling(false)
    const area = screen.getPrimaryDisplay().workArea
    main.setBounds({ x: area.x + Math.max(10, area.width - 760), y: area.y + 30, width: 700, height: Math.min(940, area.height - 60) })
    main.setBackgroundColor('#ede9e2')
  }
  fs.writeFileSync(path.join(output, 'runtime.json'), JSON.stringify({ pid: process.pid, root, errors, ready: !!main }, null, 2))
  if (fs.existsSync(path.join(output, 'quit.flag'))) return app.quit()
  const requestFile = path.join(output, 'request.json')
  if (!main || !fs.existsSync(requestFile)) return
  busy = true
  try {
    const request = JSON.parse(fs.readFileSync(requestFile, 'utf8')); fs.unlinkSync(requestFile)
    let result
    if (request.command === 'install') {
      await waitFor(() => main.webContents.executeJavaScript(`(() => {
        const s = ${store}, model = s?.live2dModel
        return !!(s?.modelLoaded && s.modelUrl === ${JSON.stringify(modelUrl)} && model?.alpha >= .999 &&
          s.pixiApp?.stage.children.filter(child => child.internalModel).length === 1 &&
          model.internalModel.settings.url === s.modelUrl)
      })()`), 'Target model did not settle on the stage', 20000)
      await main.webContents.executeJavaScript(`(() => {
        const s = ${store}
        s.gazeFollowEnabled = false; s.idleActionsEnabled = false; s.hoverFadeEnabled = false
      })()`)
      result = await main.webContents.executeJavaScript(`(${require('./renderer.cjs').toString()})()`)
      if (result.installed) {
        result = JSON.parse(fs.readFileSync(path.join(output, 'rig-info.json'), 'utf8'))
      } else {
        result.performanceProfile = !!result.signature
        if (!result.signature) result.signature = await fingerprintModel()
        fs.writeFileSync(path.join(output, 'rig-info.json'), JSON.stringify(result, null, 2))
      }
    }
    if (request.command === 'eval') result = await main.webContents.executeJavaScript(request.code)
    if (request.command === 'sweep') {
      const records = []
      const folder = path.join(output, request.name)
      if (!folder.startsWith(output + path.sep)) throw new Error('Invalid output folder')
      fs.mkdirSync(folder, { recursive: true })
      for (let i = 0; i < request.cases.length; i++) {
        const item = request.cases[i]
        const start = await main.webContents.executeJavaScript(`window.live2dLab.set(${JSON.stringify(item.parameters)}, ${JSON.stringify(item.mode || 'input')})`)
        const read = () => main.webContents.executeJavaScript('window.live2dLab.snapshot()')
        await waitFor(async () => {
          const sample = await read()
          if (sample.request === start.request && sample.frame >= start.frame + 3) return true
          await main.webContents.capturePage()
          return false
        }, `No fresh rendered frames for ${item.label}`)
        await sleep(item.settleMs ?? request.settleMs ?? 1200)
        const snapshot = await read()
        const file = String(i).padStart(4, '0') + '.png'
        const image = await main.webContents.capturePage()
        const captureEnd = await read()
        if (captureEnd.request !== start.request) throw new Error(`Trial changed during capture of ${item.label}`)
        fs.writeFileSync(path.join(folder, file), image.toPNG())
        records.push({ ...item, file, snapshot, startFrame: start.frame, captureEndFrame: captureEnd.frame })
        fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify(records, null, 2))
        fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify({ name: request.name, done: i + 1, total: request.cases.length, label: item.label }))
      }
      result = { count: records.length, folder }
    }
    if (request.command === 'record') {
      const folder = path.join(output, request.name)
      if (!folder.startsWith(output + path.sep)) throw new Error('Invalid output folder')
      fs.mkdirSync(folder, { recursive: true })
      const fps = request.fps || 15, duration = request.duration || 12
      await main.webContents.executeJavaScript(request.code || 'window.live2dLab.set({})')
      const start = Date.now(), timings = []
      for (let i = 0; i < Math.round(fps * duration); i++) {
        const delay = start + i * 1000 / fps - Date.now()
        if (delay > 0) await new Promise(r => setTimeout(r, delay))
        fs.writeFileSync(path.join(folder, String(i).padStart(4, '0') + '.png'), (await main.webContents.capturePage()).toPNG())
        timings.push(Date.now() - start)
      }
      fs.writeFileSync(path.join(folder, 'timings.json'), JSON.stringify(timings)); result = { frames: timings.length }
    }
    fs.writeFileSync(path.join(output, 'response.json'), JSON.stringify({ ok: true, result }, null, 2))
  } catch (e) { fs.writeFileSync(path.join(output, 'response.json'), JSON.stringify({ ok: false, error: String(e) })) }
  finally { busy = false }
}, 250).unref()
const buildDir = args.includes('--build-dir') ? path.resolve(option('--build-dir')) : path.join(appRoot, 'out')
require(path.join(buildDir, 'main/index.js'))
