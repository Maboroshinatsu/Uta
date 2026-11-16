'use strict'
// 从 src/renderer/public/uta-icon.svg 生成 icon.png 与多尺寸 icon.ico。
// 用法：在 app 目录执行 `node_modules/electron/dist/electron.exe scripts/render-icon.cjs`
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const APP_ROOT = path.resolve(__dirname, '..')
const SVG_FILE = path.join(APP_ROOT, 'src/renderer/public/uta-icon.svg')
const PNG_FILE = path.join(APP_ROOT, 'src/renderer/public/icon.png')
const TRAY_PNG_FILE = path.join(APP_ROOT, 'src/renderer/public/icon-tray.png')
const ICO_FILE = path.join(APP_ROOT, 'src/renderer/public/icon.ico')
const ROOT_ICO_FILE = path.resolve(APP_ROOT, '..', 'icon.ico')
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256]

function makeIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)

  const directories = []
  let offset = 6 + entries.length * 16
  for (const entry of entries) {
    const dir = Buffer.alloc(16)
    dir[0] = entry.size >= 256 ? 0 : entry.size
    dir[1] = entry.size >= 256 ? 0 : entry.size
    dir[2] = 0
    dir[3] = 0
    dir.writeUInt16LE(1, 4)
    dir.writeUInt16LE(32, 6)
    dir.writeUInt32LE(entry.png.length, 8)
    dir.writeUInt32LE(offset, 12)
    directories.push(dir)
    offset += entry.png.length
  }

  return Buffer.concat([header, ...directories, ...entries.map((entry) => entry.png)])
}

async function captureSvg(svgFile) {
  const svg = fs.readFileSync(svgFile, 'utf-8')
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:1024px;height:1024px;overflow:hidden;background:transparent}
    svg{display:block;width:1024px;height:1024px}
  </style></head><body>${svg}</body></html>`
  const htmlFile = path.join(
    os.tmpdir(),
    `uta-icon-render-${process.pid}-${path.basename(svgFile, '.svg')}.html`,
  )
  fs.writeFileSync(htmlFile, html, 'utf-8')

  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: false },
  })
  try {
    await win.loadFile(htmlFile)
    await new Promise((resolve) => setTimeout(resolve, 250))
    const image = await win.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
    if (image.isEmpty()) throw new Error(`capturePage returned an empty image for ${svgFile}`)
    return image
  } finally {
    win.destroy()
    try {
      fs.unlinkSync(htmlFile)
    } catch {}
  }
}

async function render() {
  const image = await captureSvg(SVG_FILE)

  fs.writeFileSync(PNG_FILE, image.toPNG())
  fs.writeFileSync(TRAY_PNG_FILE, image.resize({ width: 64, height: 64, quality: 'best' }).toPNG())

  const entries = ICON_SIZES.map((size) => ({
    size,
    png: image.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  }))
  const ico = makeIco(entries)
  fs.writeFileSync(ICO_FILE, ico)
  fs.writeFileSync(ROOT_ICO_FILE, ico)

  console.log(`wrote ${PNG_FILE}`)
  console.log(`wrote ${TRAY_PNG_FILE}`)
  console.log(`wrote ${ICO_FILE}`)
  console.log(`wrote ${ROOT_ICO_FILE}`)
}

app.setPath('userData', path.join(os.tmpdir(), 'uta-icon-render'))
// 两次 capture 之间会短暂没有窗口；默认行为会直接退出应用
app.on('window-all-closed', () => {})
app.whenReady().then(render).then(() => app.quit()).catch((err) => {
  console.error(err)
  app.quit()
  process.exitCode = 1
})
