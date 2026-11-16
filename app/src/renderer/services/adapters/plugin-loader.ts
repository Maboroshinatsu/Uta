/**
 * 适配器插件加载器。
 *
 * 内置插件来自随包提供的 manifest；外部插件从
 * %APPDATA%/uta/adapters/<id>/uta-adapter.json 读取。
 * 外部清单加载/校验失败时仍保留条目，设置为“未加载”。
 */
import { shallowRef } from 'vue'
import { BUILTIN_PLUGIN_MANIFESTS } from './builtin-plugin-manifests'
import { validateAdapterManifest, type AdapterPluginManifest } from './plugin-manifest'
import { createPluginHostRegistration, findHost, registerDynamicHost } from './index'

export interface AdapterPluginLoadResult {
  ok: boolean
  error?: string
}

export interface AdapterPluginEntry {
  /** 已加载插件为 manifest.id；未加载时使用目录派生的稳定键 */
  key: string
  manifest: AdapterPluginManifest | null
  source: 'builtin' | 'external'
  loaded: boolean
  error?: string
  dir?: string
}

function builtinEntries(): AdapterPluginEntry[] {
  return BUILTIN_PLUGIN_MANIFESTS.map((manifest) => ({
    key: manifest.id,
    manifest,
    source: 'builtin',
    loaded: true,
  }))
}

export const adapterPluginEntries = shallowRef<AdapterPluginEntry[]>(builtinEntries())

let loadPromise: Promise<AdapterPluginLoadResult> | null = null

export function loadAdapterPlugins(): Promise<AdapterPluginLoadResult> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const external: AdapterPluginEntry[] = []
    let loadError: string | undefined
    try {
      const listed = (await window.utaAPI?.listAdapterPlugins?.()) ?? []
      for (const item of listed) {
        const dir = typeof item?.dir === 'string' ? item.dir : 'unknown'
        if (item?.error) {
          external.push({
            key: `external:${dir}`,
            manifest: null,
            source: 'external',
            loaded: false,
            error: item.error,
            dir,
          })
          continue
        }
        const validation = validateAdapterManifest(item?.manifest)
        if (!validation.ok) {
          external.push({
            key: `external:${dir}`,
            manifest: null,
            source: 'external',
            loaded: false,
            error: validation.error,
            dir,
          })
          continue
        }
        const manifest = validation.value
        if (findHost(manifest.id)) {
          external.push({
            key: `external:${dir}`,
            manifest,
            source: 'external',
            loaded: false,
            error: `插件 ID "${manifest.id}" 已被内置或其他插件占用`,
            dir,
          })
          continue
        }
        const registered = registerDynamicHost(
          createPluginHostRegistration(manifest, 'external'),
        )
        external.push({
          key: manifest.id,
          manifest,
          source: 'external',
          loaded: registered,
          ...(registered ? {} : { error: '插件注册失败' }),
          dir,
        })
      }
    } catch (err) {
      loadError = String((err as Error)?.message ?? err)
      external.push({
        key: 'external:error',
        manifest: null,
        source: 'external',
        loaded: false,
        error: loadError,
      })
    }

    adapterPluginEntries.value = [...builtinEntries(), ...external]
    if (loadError) loadPromise = null
    return loadError ? { ok: false, error: loadError } : { ok: true }
  })()
  return loadPromise
}
