'use strict'
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

app.setPath('userData', path.join(os.tmpdir(), `uta-capture-${Date.now()}`))
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('no-sandbox')
app.on('window-all-closed', () => {})

async function capture() {
  const outDir = 'C:/Users/Administrator/.gemini/antigravity/brain/25c4b8b9-5ce3-4518-8a4e-e4f6a5d33b1d'

  // 1. 设置大面板窗口
  const win = new BrowserWindow({
    width: 1140,
    height: 960,
    show: false,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: false,
    }
  })

  const targetUrl = 'http://localhost:5173/?window=settings#settings'
  console.log('[Capture] Loading', targetUrl)
  await win.loadURL(targetUrl)
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // 截图 1：当前角色卡片（验证模型名左侧人形头像已移除）
  const charImage = await win.webContents.capturePage()
  fs.writeFileSync(path.join(outDir, 'character-tab-focused-v4.png'), charImage.toPNG())
  console.log('[Capture] Character tab saved')

  // 点击“预设工坊”
  await win.webContents.executeJavaScript(`
    const buttons = Array.from(document.querySelectorAll('.segmented-btn, button'));
    const studioBtn = buttons.find(b => b.textContent && b.textContent.includes('预设工坊'));
    if (studioBtn) studioBtn.click();
  `).catch(console.error)

  await new Promise((resolve) => setTimeout(resolve, 800))

  // 连续新增动作帧
  await win.webContents.executeJavaScript(`
    const addBtn = document.querySelector('.kf-add');
    if (addBtn) {
      addBtn.click();
      addBtn.click();
    }
    const board = document.querySelector('.studio-workbench-board');
    if (board) {
      board.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  `).catch(console.error)

  await new Promise((resolve) => setTimeout(resolve, 800))

  // 截图 2：工坊面板（验证大明度燕麦暖沙与深海蓝纯色撞色、无底衬悬停变红叉号、全高且不遮挡的滑块、左上角设置中心新 SVG 品牌图标）
  const workshopImage = await win.webContents.capturePage()
  fs.writeFileSync(path.join(outDir, 'workshop-board-focused-v4.png'), workshopImage.toPNG())
  console.log('[Capture] Workshop board saved')

  // 截图 3：语音与音量设置 (验证音量滑块最大/最小值两头不被圆角遮挡)
  await win.webContents.executeJavaScript(`
    const navButtons = Array.from(document.querySelectorAll('.nav-tab-btn, button'));
    const voiceNav = navButtons.find(b => b.textContent && b.textContent.includes('语音'));
    if (voiceNav) voiceNav.click();
  `).catch(console.error)
  await new Promise((resolve) => setTimeout(resolve, 800))

  // 模拟将播报音量拉到 100%（最大值）和 0%（最小值），测试是否被遮挡
  await win.webContents.executeJavaScript(`
    const slider = document.querySelector('.slider-range-input');
    if (slider) {
      slider.value = '1';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
  `).catch(console.error)
  await new Promise((resolve) => setTimeout(resolve, 500))

  const voiceImage = await win.webContents.capturePage()
  fs.writeFileSync(path.join(outDir, 'voice-tab-focused-v4.png'), voiceImage.toPNG())
  console.log('[Capture] Voice screenshot saved')

  // 截图 4：外观与性能（暗色模式下强调色更改生效与文字对比度）
  await win.webContents.executeJavaScript(`
    (() => {
      const navButtons = Array.from(document.querySelectorAll('.nav-tab-btn, button'));
      const appNav = navButtons.find(b => b.textContent && b.textContent.includes('外观与性能'));
      if (appNav) appNav.click();
    })()
  `).catch(console.error)
  await new Promise((resolve) => setTimeout(resolve, 800))

  // 切换到深色模式，并点击橙色/暖沙强调色 swatch
  await win.webContents.executeJavaScript(`
    (() => {
      const darkBtn = Array.from(document.querySelectorAll('.theme-card')).find(b => b.textContent && b.textContent.includes('深色'));
      if (darkBtn) darkBtn.click();
      const swatches = Array.from(document.querySelectorAll('.swatch'));
      if (swatches.length >= 5) swatches[4].click(); // 暖沙/陶红
    })()
  `).catch(console.error)
  await new Promise((resolve) => setTimeout(resolve, 800))

  const appDarkImage = await win.webContents.capturePage()
  fs.writeFileSync(path.join(outDir, 'appearance-tab-dark-v4.png'), appDarkImage.toPNG())
  console.log('[Capture] Appearance dark mode saved')

  win.close()
}

app.whenReady().then(capture).then(() => app.exit(0)).catch((err) => {
  console.error('[Capture] Error:', err)
  app.exit(1)
})
