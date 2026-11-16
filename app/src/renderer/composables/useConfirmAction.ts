import { onUnmounted, ref } from 'vue'

/** 破坏性操作的两次点击确认：第一次按下只进入“待确认”，超时自动撤销。 */
export function useConfirmAction(timeoutMs = 3000) {
  const armed = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  function cancel(): void {
    armed.value = null
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  /** 返回 true 表示这次点击就是确认；false 表示刚刚进入待确认。 */
  function arm(key: string): boolean {
    if (armed.value === key) {
      cancel()
      return true
    }
    armed.value = key
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      armed.value = null
      timer = null
    }, timeoutMs)
    return false
  }

  onUnmounted(cancel)

  return { armed, arm, cancel }
}
