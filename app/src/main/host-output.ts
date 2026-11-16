export interface HostOutput {
  kind: 'success' | 'failed' | 'unknown'
  text?: string
  sessionId?: string
  error?: string
}

/** Only host result envelopes may become assistant text; logs and tool payloads are excluded. */
export function parseHostOutput(host: 'claude-code' | 'zcode' | 'opencode' | 'qoder', raw: string, sessionId: string): HostOutput {
  const clean = raw.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trim()
  const records: Record<string, any>[] = []
  try {
    const value = JSON.parse(clean)
    if (value && typeof value === 'object' && !Array.isArray(value)) records.push(value)
  } catch {
    for (const line of clean.split(/\r?\n/)) {
      try {
        const value = JSON.parse(line)
        if (value && typeof value === 'object' && !Array.isArray(value)) records.push(value)
      } catch { /* CLI diagnostics are not assistant text. */ }
    }
  }
  if (host === 'claude-code' || host === 'qoder') {
    const result = [...records].reverse().find(record => record.type === 'result')
    if (!result || result.session_id !== sessionId) return { kind: 'unknown', error: '宿主没有返回目标会话的有效结果。' }
    if (result.is_error === true || (result.subtype && result.subtype !== 'success')) {
      return { kind: 'failed', sessionId, error: '宿主已接收消息，但本轮处理失败，请在宿主查看详情。' }
    }
    if (typeof result.result !== 'string') return { kind: 'unknown', error: '宿主结果格式无法识别。' }
    return { kind: 'success', sessionId, text: result.result }
  }
  if (host === 'zcode') {
    const result = [...records].reverse().find(record => record.sessionId === sessionId && typeof record.response === 'string')
    return result ? { kind: 'success', sessionId, text: result.response } : { kind: 'unknown', error: 'ZCode 没有返回目标会话的有效结果。' }
  }
  const relevant = records.filter(record => record.sessionID === sessionId)
  if (records.some(record => typeof record.sessionID === 'string' && record.sessionID !== sessionId)) {
    return { kind: 'unknown', error: 'OpenCode 回报的会话与目标不一致。' }
  }
  if (relevant.some(record => record.type === 'error')) return { kind: 'failed', sessionId, error: 'OpenCode 已接收消息，但本轮处理失败，请在宿主查看详情。' }
  const finished = relevant.some(record => record.type === 'step_finish' && record.part?.reason === 'stop')
  if (!finished) return { kind: 'unknown', error: 'OpenCode 没有返回可确认的结束事件。' }
  const parts = new Map<string, string>()
  for (const record of relevant) {
    if (record.type !== 'text' || typeof record.part?.text !== 'string') continue
    parts.set(typeof record.part.id === 'string' ? record.part.id : String(parts.size), record.part.text)
  }
  return { kind: 'success', sessionId, text: [...parts.values()].join('\n') }
}
