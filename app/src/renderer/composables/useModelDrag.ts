import { onScopeDispose, ref } from 'vue'

export function useModelDrag(onDragEnd?: (target: EventTarget | null) => void) {
  let dragOffsetX = 0
  let dragOffsetY = 0
  let dragActive = false
  let dragStartX = 0
  let dragStartY = 0
  let dragMoved = false
  let cancelDrag: (() => void) | null = null
  const isDragging = ref(false)
  onScopeDispose(() => cancelDrag?.())

  function onModelMouseDown(e: MouseEvent) {
    cancelDrag?.()
    const startTarget = e.target
    dragStartX = e.clientX
    dragStartY = e.clientY
    dragMoved = false
    dragActive = true
    isDragging.value = true

    const onMove = (ev: MouseEvent) => {
      if (!dragActive) return
      // 在窗口外松开鼠标时 document 可能收不到 mouseup；回到窗口后按键已为 0
      if (ev.buttons === 0) {
        onUp()
        return
      }
      const dx = ev.clientX - dragStartX
      const dy = ev.clientY - dragStartY
      if (!dragMoved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      dragMoved = true
      dragOffsetX += dx
      dragOffsetY += dy
      dragStartX = ev.clientX
      dragStartY = ev.clientY
    }

    const onUp = (event?: Event) => {
      dragActive = false
      isDragging.value = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
      cancelDrag = null
      if (dragMoved && event?.type === 'mouseup') onDragEnd?.(startTarget)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    cancelDrag = () => onUp()
  }

  function consumeDragOffsets(): { x: number; y: number } | null {
    if (dragOffsetX === 0 && dragOffsetY === 0) return null
    const offsets = { x: dragOffsetX, y: dragOffsetY }
    dragOffsetX = 0
    dragOffsetY = 0
    return offsets
  }

  /** 最近一次手势是否是轻点（没有发生位移），供点击互动判断 */
  function isTapGesture(): boolean {
    return !dragMoved
  }

  return { onModelMouseDown, consumeDragOffsets, isDragging, isTapGesture }
}
