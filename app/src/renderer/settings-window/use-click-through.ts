import { computed, onMounted, onUnmounted, ref } from 'vue'

/**
 * Click-through is owned by the main process and stored with the pet window.
 * The settings window only mirrors the real state and asks the main process to
 * change it; it never fakes a local switch.
 */
export function useClickThrough() {
  const locked = ref(false)
  const busy = ref(false)
  let disposed = false
  let unsubscribe: (() => void) | null = null

  const supported = computed(() => typeof window !== 'undefined' && typeof window.utaAPI?.setClickThroughLocked === 'function')

  async function refresh(): Promise<void> {
    try {
      const state = await window.utaAPI?.getUiState?.()
      if (!disposed && state && typeof state.clickThroughLocked === 'boolean') {
        locked.value = state.clickThroughLocked
      }
    } catch {
      // Keep the last known state when the pet window is unavailable.
    }
  }

  async function setLocked(value: boolean): Promise<void> {
    if (busy.value || !supported.value) return
    const previous = locked.value
    busy.value = true
    locked.value = value
    try {
      await window.utaAPI?.setClickThroughLocked?.(value)
    } catch {
      locked.value = previous
    } finally {
      busy.value = false
    }
  }

  onMounted(() => {
    void refresh()
    unsubscribe = window.utaAPI?.onSetClickThroughLocked?.(value => {
      if (!disposed) locked.value = value
    }) ?? null
  })

  onUnmounted(() => {
    disposed = true
    unsubscribe?.()
    unsubscribe = null
  })

  return { locked, busy, supported, setLocked, refresh }
}
