/** 界面由 Vite 热更新，主进程与 preload 必须重启才换；两者不同步时待办接口不存在，要如实说明而不是报“添加失败”。 */
export const OUTDATED_MAIN_MESSAGE =
  '待办功能暂时用不了：正在运行的 Uta 主程序比界面旧。请完全退出 Uta 再重新启动（开发时重跑 npm run dev）。'

/** 项目待办按绑定宿主归属；没有宿主时给出出路，而不是让人对着“无法确定待办所属项目”发愣。 */
export const NO_PLATFORM_MESSAGE =
  '还没有绑定宿主，项目待办用不了；先在快捷设置里选一个宿主。生活小事可以直接记在“日常”栏。'

function apiSurface(): UtaAPI | undefined {
  return typeof window === 'undefined' ? undefined : window.utaAPI
}

export function hasTodoIpc(): boolean {
  const surface = apiSurface()
  return typeof surface?.getTodoState === 'function'
}

export function hasDailyIpc(): boolean {
  const surface = apiSurface()
  return typeof surface?.getDailyState === 'function' && typeof surface?.dailyAddItem === 'function'
}
