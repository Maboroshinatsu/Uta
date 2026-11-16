import { createHmac } from 'node:crypto'
import { COMPANION_HTTP_PATHS, type CompanionHttpHost } from '../shared/companion-http-contract'

const MAX_BODY_BYTES = 8 * 1024 * 1024
const PATHS: ReadonlySet<string> = new Set(Object.values(COMPANION_HTTP_PATHS))

export async function requestCompanionHost(
  host: CompanionHttpHost,
  runtimeToken: string,
  base: unknown,
  route: unknown,
  body: unknown,
): Promise<number | null> {
  if (typeof base !== 'string' || typeof route !== 'string' || !PATHS.has(route)) return 400
  if (host === 'astrbot' && route === COMPANION_HTTP_PATHS.screenshot) return 400
  let url: URL
  try {
    url = new URL(base)
  } catch {
    return 400
  }
  if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return 400
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1'
  if (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') return 400

  const ready = route === COMPANION_HTTP_PATHS.ready
  if (ready ? body !== undefined : typeof body !== 'string') return 400
  if (typeof body === 'string' && Buffer.byteLength(body) > MAX_BODY_BYTES) return 413

  const credential = createHmac('sha256', runtimeToken).update(`uta:${host}:http-ingress:v1`).digest('hex')
  url.pathname = route
  try {
    const response = await fetch(url, {
      method: ready ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${credential}`,
        ...(ready ? {} : { 'Content-Type': 'application/json' }),
      },
      body: typeof body === 'string' ? body : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(ready ? 5000 : 10000),
    })
    void response.body?.cancel().catch(() => {})
    return response.status
  } catch {
    return null
  }
}
