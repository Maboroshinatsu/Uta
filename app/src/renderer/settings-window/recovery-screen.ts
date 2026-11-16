import type { SettingsRecoveryPreview } from '../../shared/settings-recovery-contracts'
import { isSettingsWindowRoute } from '../route'
import { loadEnvironmentLabel } from '../services/environment-label'

/** No Pinia, model, host or audio initialization while settings are blocked. */
export function renderSettingsRecoveryScreen(onRetry: () => void): () => void {
  const container = document.getElementById('app')
  if (!container) return () => {}
  let disposed = false
  let review: Extract<SettingsRecoveryPreview, { available: true }> | null = null
  container.innerHTML = `
    <div style="position:fixed;inset:0 0 auto;z-index:10;display:flex;align-items:center;justify-content:space-between;height:38px;padding-left:14px;background:#f4f1e9;border-bottom:1px solid #e5dfd3;color:#1c2a31;font:12px/1 system-ui,sans-serif;-webkit-app-region:drag;user-select:none;">
      <span style="display:flex;align-items:center;gap:8px;"><span style="width:9px;height:9px;border-radius:999px;background:#3d6a8e;"></span><strong>Uta 设置</strong><span style="color:#647674;">恢复模式</span></span>
      <span style="display:flex;height:100%;-webkit-app-region:no-drag;">
        <button id="recovery-minimize" type="button" aria-label="最小化" style="width:44px;border:0;background:transparent;color:#647674;font:16px/1 system-ui;cursor:pointer;">–</button>
        <button id="recovery-maximize" type="button" aria-label="最大化" style="width:44px;border:0;background:transparent;color:#647674;font:16px/1 system-ui;cursor:pointer;">□</button>
        <button id="recovery-close" type="button" aria-label="关闭" style="width:44px;border:0;background:transparent;color:#647674;font:18px/1 system-ui;cursor:pointer;">×</button>
      </span>
    </div>
    <main id="settings-blocked-screen" style="box-sizing:border-box;min-height:100vh;display:grid;place-content:center;padding:70px 32px 32px;background:#f4f1e9;color:#1c2a31;font:14px/1.7 system-ui,sans-serif;">
      <section style="box-sizing:border-box;width:min(560px,100%);padding:28px;background:#fffcf6;border:1px solid #e5dfd3;border-radius:20px;">
        <h1 style="font-size:22px;margin:0 0 12px;">设置暂时无法读取</h1>
        <p id="settings-recovery-profile" style="overflow-wrap:anywhere;color:#647674;">数据环境：正在确认…</p>
        <p>当前配置保持原样。可以重新读取，或查看当前实例中可用的偏好备份。</p>
        <p id="recovery-status" role="status" aria-live="polite">正在检查备份…</p>
        <div style="display:flex;flex-wrap:wrap;gap:10px;">
          <button id="retry-settings-btn" type="button" style="padding:10px 16px;border-radius:10px;border:1px solid #e2dbce;background:#f4f1e9;color:#1c2a31;font:inherit;cursor:pointer;">重新读取</button>
          <button id="review-settings-backup" type="button" disabled style="padding:10px 16px;border-radius:10px;border:1px solid #3d6a8e;background:#3d6a8e;color:#fff;font:inherit;cursor:pointer;">查看备份</button>
        </div>
        <section id="settings-backup-review" hidden style="margin-top:20px;border-top:1px solid #e5dfd3;padding-top:16px;">
          <h2 style="font-size:16px;">确认恢复这份备份？</h2>
          <p id="settings-backup-summary"></p>
          <p>恢复只涉及当前实例的公开偏好。损坏原件会另存保留，有效备份不会被覆盖；模型、预设和密钥不变。</p>
          <button id="cancel-settings-recovery" type="button" style="padding:10px 16px;border-radius:10px;border:1px solid #e2dbce;background:#f4f1e9;font:inherit;cursor:pointer;">取消</button>
          <button id="confirm-settings-recovery" type="button" style="padding:10px 16px;border-radius:10px;border:1px solid #3d6a8e;background:#3d6a8e;color:#fff;font:inherit;cursor:pointer;">确认恢复备份</button>
        </section>
      </section>
    </main>`
  const status = document.getElementById('recovery-status')!
  const view = document.getElementById('review-settings-backup') as HTMLButtonElement
  const retry = document.getElementById('retry-settings-btn') as HTMLButtonElement
  const panel = document.getElementById('settings-backup-review')!
  const confirm = document.getElementById('confirm-settings-recovery') as HTMLButtonElement
  const cancel = document.getElementById('cancel-settings-recovery') as HTMLButtonElement
  document.getElementById('recovery-minimize')?.addEventListener('click', () => { void window.utaAPI?.controlWindow?.('minimize') })
  document.getElementById('recovery-maximize')?.addEventListener('click', () => { void window.utaAPI?.controlWindow?.('toggle-maximize') })
  document.getElementById('recovery-close')?.addEventListener('click', () => { void window.utaAPI?.controlWindow?.('close') })
  const api = window.utaAPI?.settingsRecovery
  void loadEnvironmentLabel(window.utaAPI).then(environment => {
    if (!disposed) document.getElementById('settings-recovery-profile')!.textContent = `数据环境：${environment.label}`
  })
  const unavailable = (result?: SettingsRecoveryPreview) => result && !result.available && result.reason === 'future-schema'
    ? '配置来自较新的程序版本，请使用对应版本打开；这里不会降级覆盖。'
    : result && !result.available && result.reason === 'not-needed'
      ? '当前配置已可以读取，请点击重新读取。' : '暂时没有可用的偏好备份。请检查文件权限，或保留当前数据后联系开发者。'
  async function inspect(show: boolean) {
    view.disabled = true
    try {
      const result = await api?.preview()
      if (disposed) return
      if (!result?.available) { review = null; panel.hidden = true; status.textContent = unavailable(result); return }
      review = result
      status.textContent = '找到一份有效偏好备份。查看后可选择恢复，检查本身不会改动文件。'
      view.disabled = false
      if (show) {
        document.getElementById('settings-backup-summary')!.textContent = `备份版本 ${result.backupRevision}，${result.themeMode === 'dark' ? '深色' : '浅色'}模式，语音播报${result.ttsEnabled ? '开启' : '关闭'}。`
        panel.hidden = false; cancel.focus()
      }
    } catch { if (!disposed) status.textContent = '备份检查未完成，请重新读取或检查文件权限。' }
  }
  view.addEventListener('click', () => { void inspect(true) })
  cancel.addEventListener('click', () => { review = null; panel.hidden = true; view.focus() })
  retry.addEventListener('click', () => {
    retry.disabled = true
    void api?.retry().catch(() => false).finally(() => { if (!disposed) onRetry() })
    if (!api) onRetry()
  })
  confirm.addEventListener('click', () => {
    if (!review) return
    let allowRecovery = true
    confirm.disabled = true; view.disabled = true; cancel.disabled = true
    void api?.restore(review.token).then(result => {
      if (disposed) return
      if (result.ok) { status.textContent = '偏好已恢复，正在重新加载。'; onRetry() }
      else {
        review = null; panel.hidden = true
        if (result.code === 'future-schema') allowRecovery = false
        status.textContent = result.code === 'future-schema' ? '当前文件已被较新版本更新，这里不会降级覆盖。请使用对应版本打开。' : result.code === 'changed' || result.code === 'preview-expired'
          ? '备份或当前文件已经变化，请重新查看后确认。' : '恢复未完成，当前文件保持原样。请检查权限后重试。'
      }
    }).catch(() => { if (!disposed) status.textContent = '恢复结果未确认，请重新读取。' })
      .finally(() => { if (!disposed) { confirm.disabled = false; view.disabled = !allowRecovery; cancel.disabled = false } })
  })
  // A blocked settings document has no drafts; it must still support native close/quit.
  const closeBridge = isSettingsWindowRoute() ? window.utaAPI?.settingsWindow : undefined
  const unsubscribeClose = closeBridge?.onCloseRequested(request => { void closeBridge.respond(request.id, 'close') })
  void closeBridge?.ready().catch(() => {})
  void inspect(false)
  return () => { disposed = true; review = null; unsubscribeClose?.() }
}
