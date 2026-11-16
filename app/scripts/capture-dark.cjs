'use strict'
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

app.setPath('userData', path.join(os.tmpdir(), `uta-dark-${Date.now()}`))
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('no-sandbox')

async function run() {
  const win = new BrowserWindow({
    width: 1120,
    height: 940,
    show: false,
    webPreferences: { offscreen: true }
  })
  await win.loadURL('http://localhost:5173/?window=settings#settings')
  await new Promise((r) => setTimeout(r, 1800))
  await win.webContents.executeJavaScript(`
    document.documentElement.setAttribute('data-theme', 'dark');
    const buttons = Array.from(document.querySelectorAll('.segmented-btn, button'));
    const studioBtn = buttons.find(b => b.textContent && b.textContent.includes('预设工坊'));
    if (studioBtn) studioBtn.click();
    const addBtn = document.querySelector('.kf-add');
    if (addBtn) { addBtn.click(); addBtn.click(); }
  `)
  await new Promise((r) => setTimeout(r, 800))
  const img = await win.webContents.capturePage()
  const outPath = 'C:/Users/Administrator/.gemini/antigravity/brain/25c4b8b9-5ce3-4518-8a4e-e4f6a5d33b1d/workshop-board-dark.png'
  fs.writeFileSync(outPath, img.toPNG())
  console.log('[Capture Dark] Saved to:', outPath)
  app.exit(0)
}

app.whenReady().then(run)
