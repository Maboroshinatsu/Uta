export function useWindowDrag() {
  function onNavMouseDown(e: MouseEvent) {
    let lastX = e.screenX
    let lastY = e.screenY
    let moved = false
    let pendingX = 0
    let pendingY = 0
    let scheduled = false

    const flush = () => {
      scheduled = false
      const dx = pendingX
      const dy = pendingY
      pendingX = 0
      pendingY = 0
      if (dx || dy) window.utaAPI?.dragWindow(dx, dy)
    }

    const onMove = (ev: MouseEvent) => {
      const dx = ev.screenX - lastX
      const dy = ev.screenY - lastY
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      moved = true
      lastX = ev.screenX
      lastY = ev.screenY
      // 每次 mousemove 都发 IPC 会让主进程频繁 setBounds；按帧合并位移
      pendingX += dx
      pendingY += dy
      if (!scheduled) {
        scheduled = true
        requestAnimationFrame(flush)
      }
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (pendingX || pendingY) flush()
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return { onNavMouseDown }
}
