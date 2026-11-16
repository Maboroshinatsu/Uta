export interface SessionReference {
  hostId: string
  sessionId: string
}

export interface SessionTitle extends SessionReference {
  title: string
}

export const UNTITLED_SESSION = '未获取会话标题'
export const UNATTRIBUTED_SESSION = '未关联会话'

/** Host labels and transport IDs are not conversation titles. */
export function cleanSessionTitle(label: unknown, hostId: string, sessionId: string): string {
  if (typeof label !== 'string') return ''
  const text = label.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160)
  const name = text.toLowerCase().replace(/[\s_-]/g, '')
  const host = hostId.toLowerCase().replace(/[\s_-]/g, '')
  const id = sessionId.toLowerCase()
  if (name === host || name === `${host}cli` || text.toLowerCase() === id) return ''
  const generated = /(?:^|[\s·])(?:会话|聊天|session|thread)\s*[:：#]?\s*([\w-]{6,})$/i.exec(text)
  if (generated && id.startsWith(generated[1].toLowerCase())) return ''
  return text
}
