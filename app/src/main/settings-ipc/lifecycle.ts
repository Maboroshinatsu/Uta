import type { SettingsIpcController, SettingsIpcOptions } from './index'
import { registerSettingsIpc } from './index'
import type { SettingsDocument, SettingsService, SettingsWriteResult } from '../../shared/settings-contracts'

/** Tray/shortcut state is a view of the same authority used by renderer clients. */
export async function observeHoverFade(store: SettingsService, apply: (enabled: boolean) => void) {
  let revision = -1
  const receive = (doc: SettingsDocument) => {
    if (doc.revision <= revision) return
    revision = doc.revision
    apply(doc.values.hoverFadeEnabled)
  }
  const unsubscribe = store.subscribe(receive)
  try {
    const state = await store.read()
    if (state.status === 'ready') receive(state.document)
    return unsubscribe
  } catch (error) { unsubscribe(); throw error }
}

export async function patchHoverFade(store: SettingsService, enabled: boolean): Promise<SettingsWriteResult> {
  const state = await store.read()
  if (state.status !== 'ready') return { ok: false, code: 'store-blocked', currentRevision: null }
  return store.patch({ expectedRevision: state.document.revision, changes: { hoverFadeEnabled: enabled } })
}

/**
 * Stable installations always expose the current settings store. A missing
 * migration marker is treated as a personal first run, not as a blocked
 * upgrade path; an invalid marker still fails closed so a newer or corrupt
 * store is never silently replaced.
 */
export async function initializeSettingsIpc(
  options: Omit<SettingsIpcOptions, 'mode' | 'store'> & {
    isStable: boolean
    stableAuthority?: 'legacy' | 'accepted' | 'blocked'
    createStore: () => Promise<SettingsService>
  },
): Promise<SettingsIpcController> {
  let store: SettingsService | null = null
  if (!options.isStable || options.stableAuthority !== 'blocked') {
    try { store = await options.createStore() } catch { /* read stays blocked until recovery */ }
  }
  const mode = options.isStable ? 'canonical-stable' : 'canonical-dev'
  return registerSettingsIpc({ ...options, mode, store })
}

/** Prevent Electron from exiting until the active store has flushed its queue. */
export function createSettingsQuitGuard(close: () => Promise<void>, resumeQuit: () => void) {
  let complete = false
  let pending: Promise<void> | null = null
  return (event: { preventDefault: () => void }): void => {
    if (complete) return
    event.preventDefault()
    if (pending) return
    pending = Promise.resolve().then(close).catch(() => {}).then(() => {
      complete = true
      resumeQuit()
    })
  }
}
