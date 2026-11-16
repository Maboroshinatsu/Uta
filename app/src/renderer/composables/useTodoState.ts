import { onMounted, onUnmounted, ref } from 'vue'
import { hasTodoIpc, OUTDATED_MAIN_MESSAGE } from '@/services/todo-availability'
import type { TodoState } from '../../shared/todo-contracts'

export function useTodoState() {
  const state = ref<TodoState | null>(null)
  const loading = ref(false)
  const error = ref('')
  const available = ref(true)
  let sequence = 0
  let disposed = false
  let unsubscribe: (() => void) | null = null

  async function refresh(): Promise<void> {
    const token = ++sequence
    if (!hasTodoIpc()) {
      available.value = false
      state.value = null
      error.value = OUTDATED_MAIN_MESSAGE
      loading.value = false
      return
    }
    available.value = true
    loading.value = true
    try {
      const result = await window.utaAPI?.getTodoState?.()
      if (disposed || token !== sequence) return
      if (result) {
        state.value = result
        error.value = ''
      } else {
        error.value = '待办状态不可用。'
      }
    } catch {
      if (disposed || token !== sequence) return
      error.value = '待办状态读取失败。'
    } finally {
      if (!disposed && token === sequence) loading.value = false
    }
  }

  onMounted(() => {
    void refresh()
    unsubscribe = window.utaAPI?.onTodoChanged?.(() => { void refresh() }) ?? null
    window.addEventListener('focus', refresh)
  })

  onUnmounted(() => {
    disposed = true
    sequence++
    unsubscribe?.()
    unsubscribe = null
    window.removeEventListener('focus', refresh)
  })

  return { state, loading, error, available, refresh }
}
