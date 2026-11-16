/**
 * 最终摘要清洗：桌宠只保留一两句，去掉代码、表格、链接与角色标签。
 */
export const MAX_COMMENTARY_CHARS = 120

export function summarizeCommentary(text, maxChars = MAX_COMMENTARY_CHARS) {
  if (typeof text !== 'string' || !text.trim()) return ''
  const normalized = text.replace(/\r\n?/g, '\n')
  const withoutCode = normalized.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]+)`/g, '$1')
  const withoutTables = withoutCode
    .split('\n')
    .filter((line) => !/^\s*\|.*\|\s*$/.test(line))
    .join('\n')
  const prose = withoutTables
    .replace(/\[(?:uta|emotion|preset)\s*:[^\]]*\]/gi, '')
    .replace(/<uta\s[^>]*\/?>/gi, '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!prose) return ''
  if (prose.length <= maxChars) return prose
  const sentences = prose.match(/[^。！？!?]+[。！？!?]?/g) ?? [prose]
  let summary = (sentences[0] || prose).trim()
  if (summary.length < 24 && sentences[1]) summary = `${summary} ${sentences[1].trim()}`.trim()
  if (summary.length > maxChars) {
    const cut = summary.slice(0, maxChars)
    const punctuation = Math.max(
      cut.lastIndexOf('。'),
      cut.lastIndexOf('！'),
      cut.lastIndexOf('？'),
      cut.lastIndexOf('；'),
      cut.lastIndexOf('.'),
    )
    summary = (punctuation >= 12 ? cut.slice(0, punctuation + 1) : cut).trimEnd() + '…'
  } else if (prose.length > summary.length) {
    summary = `${summary.replace(/[。！？!?]$/, '')}…`
  }
  return summary.slice(0, maxChars + 1)
}
