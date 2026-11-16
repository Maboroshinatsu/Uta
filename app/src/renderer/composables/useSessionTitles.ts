import { ref, watch } from 'vue'
import type { SessionReference } from '../../shared/session-title'

function key(hostId: string, sessionId: string): string {
  return JSON.stringify([hostId, sessionId])
}

export function useSessionTitles(references: () => SessionReference[]) {
  const titles = ref(new Map<string, string>())
  watch(() => {
    const unique = new Map<string, SessionReference>()
    for (const reference of references()) {
      const id = key(reference.hostId, reference.sessionId)
      unique.delete(id)
      unique.set(id, reference)
    }
    return JSON.stringify([...unique.values()].slice(-256))
  }, (encoded, _, onCleanup) => {
    const requested = JSON.parse(encoded) as SessionReference[]
    if (!requested.length || typeof window === 'undefined' || !window.utaAPI?.getSessionTitles) return
    let current = true
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const result = await window.utaAPI?.getSessionTitles?.(requested)
        if (!current || !result) return
        const next = new Map(result.map(item => [key(item.hostId, item.sessionId), item.title]))
        if (next.size !== titles.value.size || [...next].some(([id, title]) => titles.value.get(id) !== title)) {
          titles.value = next
        }
      } catch {
        // A failed lookup leaves the last known title available.
      } finally {
        pending = false
      }
    }
    void refresh()
    // The host can generate or rename a title while the same records are visible.
    const timer = window.setInterval(refresh, 5000)
    onCleanup(() => { current = false; window.clearInterval(timer) })
  }, { immediate: true })

  return (hostId: string, sessionId: string) => titles.value.get(key(hostId, sessionId)) || ''
}
