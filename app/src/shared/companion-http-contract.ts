export const COMPANION_HTTP_CHANNEL = 'companion-http-request'

export type CompanionHttpHost = 'maibot' | 'astrbot'

export function isCompanionHttpHost(host: unknown): host is CompanionHttpHost {
  return host === 'maibot' || host === 'astrbot'
}

export const COMPANION_HTTP_PATHS = {
  ready: '/v1/ready',
  text: '/v1/input/text',
  screenshot: '/v1/input/screenshot',
  model: '/v1/sync/model',
} as const
