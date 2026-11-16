/**
 * 内置的声明式 HTTP 适配器插件。
 * 本机伴侣使用主进程鉴权的 HTTP 路由。
 */
import type { HostCapabilities } from '../host/contracts'
import type { AdapterPluginManifest } from './plugin-manifest'
import { COMPANION_HTTP_PATHS } from '../../../shared/companion-http-contract'

const HTTP_CAPABILITIES: HostCapabilities = {
  statusEvents: true,
  assistantText: true,
  sendInput: true,
  cancelTurn: false,
  characterTools: true,
  sessionSelection: false,
}

const BASE_URL_FIELD = (label: string, defaultValue: string, description: string) => ({
  key: 'baseUrl',
  type: 'text' as const,
  label,
  description,
  placeholder: defaultValue,
  default: defaultValue,
})

const COMPANION_ROUTES: AdapterPluginManifest['routes'] = {
  health: { method: 'GET', path: COMPANION_HTTP_PATHS.ready },
  text: {
    method: 'POST', path: COMPANION_HTTP_PATHS.text,
    body: { text: '$text', request_id: '$requestId' },
  },
  emotions: { method: 'POST', path: COMPANION_HTTP_PATHS.model, body: { emotions: '$emotions' } },
  controls: { method: 'POST', path: COMPANION_HTTP_PATHS.model, body: { controls: '$controls', presets: '$presets' } },
}

export const BUILTIN_PLUGIN_MANIFESTS: AdapterPluginManifest[] = [
  {
    schemaVersion: 1,
    id: 'maibot',
    name: 'MaiBot 适配器',
    version: '1.0.0',
    category: 'adapter',
    description: '面向 QQ / 微信等社交聊天伴侣生态',
    capabilities: { ...HTTP_CAPABILITIES },
    baseUrlSetting: 'baseUrl',
    settings: [
      BASE_URL_FIELD(
        'MaiBot 服务地址',
        'http://127.0.0.1:8524',
        '只支持本机 HTTP 地址',
      ),
    ],
    routes: {
      ...COMPANION_ROUTES,
      screenshot: {
        method: 'POST',
        path: COMPANION_HTTP_PATHS.screenshot,
        body: { image: '$base64', request_id: '$requestId' },
      },
    },
  },
  {
    schemaVersion: 1,
    id: 'astrbot',
    name: 'AstrBot 适配器',
    version: '1.0.0',
    category: 'adapter',
    description: '面向 AstrBot 多平台 AI 代理与消息框架',
    capabilities: { ...HTTP_CAPABILITIES },
    baseUrlSetting: 'baseUrl',
    settings: [
      BASE_URL_FIELD(
        'AstrBot 服务地址',
        'http://127.0.0.1:8526',
        '只支持本机 HTTP 地址',
      ),
    ],
    routes: { ...COMPANION_ROUTES },
  },
]
