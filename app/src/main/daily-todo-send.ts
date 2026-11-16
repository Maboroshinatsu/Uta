import type { DailyTodoState } from '../shared/daily-todo-contracts'
import type { TodoSendResult } from '../shared/todo-contracts'

/** Recheck both the destination and the exact text the user reviewed. */
export function prepareDailySend(state: DailyTodoState, boundHost: string | null, payload: unknown):
  | { ok: true; text: string }
  | { ok: false; code: 'invalid' | 'empty'; error: string } {
  if (!boundHost) return { ok: false, code: 'empty', error: '还没有绑定平台，先在连接与会话里选择一个平台。' }
  if (state.error) return { ok: false, code: 'invalid', error: '日常待办文件无法读取，无法发送。' }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, code: 'invalid', error: '没有可发送的待办。' }
  const request = payload as Record<string, unknown>
  if (request.hostId !== boundHost) return { ok: false, code: 'invalid', error: '绑定的宿主已改变，请重新预览。' }
  if (!Array.isArray(request.items) || request.items.length === 0 || request.items.length > 200) {
    return { ok: false, code: 'empty', error: '请选择未完成的日常待办。' }
  }
  const seen = new Set<string>()
  const texts: string[] = []
  for (const entry of request.items) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || typeof entry.text !== 'string' || seen.has(entry.id)) {
      return { ok: false, code: 'invalid', error: '待办选择无效，请重新预览。' }
    }
    seen.add(entry.id)
    const current = state.items.find(item => item.id === entry.id)
    if (!current || current.status !== 'pending' || current.text !== entry.text) {
      return { ok: false, code: 'invalid', error: '待办内容或状态已改变，请重新预览。' }
    }
    texts.push(current.text)
  }
  const text = ['日常待办清单', ...texts.map((item, index) => `${index + 1}. ${item}`), '', '请按这份清单继续推进。'].join('\n')
  if (text.length > 1000) return { ok: false, code: 'invalid', error: '待办清单超过 1000 字符，请减少发送项。' }
  return { ok: true, text }
}

export async function dispatchDailySend(
  text: string,
  send: (text: string) => Promise<{ ok: boolean; code?: string; error?: string; text?: string }>,
  copy: (text: string) => void,
): Promise<TodoSendResult> {
  const result = await send(text)
  if (result.ok) return { ok: true, mode: 'sent', text: result.text || '已发送给宿主。' }
  if (result.code === 'unsupported') {
    copy(text)
    return { ok: true, mode: 'copied', text: '当前平台不支持从桌宠直接发送，日常待办已复制。', detail: text }
  }
  const code = result.code === 'no-session' || result.code === 'busy' || result.code === 'failed' ? result.code : 'failed'
  return { ok: false, code, error: result.error || '发送失败，请稍后重试。' }
}
