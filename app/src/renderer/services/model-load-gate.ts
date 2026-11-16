/**
 * Bridges an image-set URL switch to the StaticStage mount that actually loads it.
 * The lifecycle waits on this gate instead of sampling store.modelLoaded before
 * the newly mounted component has reported its result.
 */
interface PendingStaticLoad {
  url: string
  resolve: (ok: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

let pending: PendingStaticLoad | null = null

function finish(ok: boolean, matchUrl?: string): void {
  const current = pending
  if (!current) return
  if (matchUrl !== undefined && current.url !== matchUrl) return
  pending = null
  clearTimeout(current.timer)
  current.resolve(ok)
}

export function armStaticModelLoad(url: string, timeoutMs = 12_000): Promise<boolean> {
  finish(false)
  return new Promise<boolean>(resolve => {
    const timer = setTimeout(() => {
      if (pending?.timer === timer) finish(false, url)
    }, Math.max(1000, timeoutMs))
    pending = { url, resolve, timer }
  })
}

export function settleStaticModelLoad(url: string, ok: boolean): void {
  finish(ok, url)
}

export function cancelStaticModelLoad(): void {
  finish(false)
}
