/**
 * 路由判定工具函数
 * 将独立设置窗口的路由检测与桌面宠物主渲染流程解耦，确保零副作用引用。
 */
export function isSettingsWindowRoute(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.location.hash === '#settings' ||
    window.location.search.includes('window=settings')
  )
}
