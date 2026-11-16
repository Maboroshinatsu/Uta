import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { ShaderSystem } from '@pixi/core'
import { install as installPixiUnsafeEval } from '@pixi/unsafe-eval'
import App from './App.vue'
import './typography.css'
import { loadAdapterPlugins } from './services/adapters/plugin-loader'
import { normalizeHostPreference, reloadActiveHostFromPreference } from './services/adapters/active'
import { settingsClient } from './services/settings-client'
import { isSettingsWindowRoute } from './route'
import { renderSettingsRecoveryScreen } from './settings-window/recovery-screen'

export { isSettingsWindowRoute }

let bootstrapEpoch = 0
let mounted = false
let disposeBlockedScreen: (() => void) | null = null
if (typeof window !== 'undefined') {
  const unsubscribe = window.utaAPI?.settingsRecovery?.onRecovered?.(() => { if (!mounted) void bootstrap() })
  window.addEventListener('pagehide', () => { unsubscribe?.(); disposeBlockedScreen?.() }, { once: true })
}

export async function bootstrap(): Promise<void> {
  if (mounted) return
  const epoch = ++bootstrapEpoch

  // 设置客户端启动门控：必须在创建 Pinia 和挂载 App 之前完成权威配置加载
  const initResult = await settingsClient.init().catch(() => ({ ok: false }))
  if (epoch !== bootstrapEpoch) return
  if (!initResult.ok) {
    disposeBlockedScreen?.()
    disposeBlockedScreen = renderSettingsRecoveryScreen(() => {
      void bootstrap()
    })
    return
  }
  disposeBlockedScreen?.(); disposeBlockedScreen = null

  // 分流：设置窗口绝对不新建模型/宿主/音频实例
  if (isSettingsWindowRoute()) {
    // 适配器清单是设置页的数据源，不启动模型或宿主会话
    await loadAdapterPlugins()
    if (epoch !== bootstrapEpoch || mounted) return
    const { default: SettingsWindowApp } = await import('./settings-window/SettingsWindowApp.vue')
    if (epoch !== bootstrapEpoch || mounted) return
    const { connectSettingsWindowToPet } = await import('./settings-window/pet-bridge')
    if (epoch !== bootstrapEpoch || mounted) return
    const app = createApp(SettingsWindowApp)
    const pinia = createPinia()
    app.use(pinia)
    app.onUnmount(connectSettingsWindowToPet(pinia))
    app.mount('#app')
    mounted = true
    return
  }

  // CSP 禁止 new Function；PixiJS 6 的 ShaderSystem 需要该补丁才能创建渲染器
  installPixiUnsafeEval({ ShaderSystem })

  // 插件清单必须在组件读取宿主注册表之前加载完成。
  // A failed listing keeps the saved preference instead of degrading it to standalone.
  const pluginLoad = await loadAdapterPlugins()
  if (epoch !== bootstrapEpoch || mounted) return
  if (pluginLoad?.ok) {
    normalizeHostPreference()
    reloadActiveHostFromPreference()
  }
  const app = createApp(App)
  app.use(createPinia())
  app.mount('#app')
  mounted = true
}

const runtimeProcess = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process
if (!runtimeProcess || runtimeProcess.env?.NODE_ENV !== 'test') {
  void bootstrap()
}
