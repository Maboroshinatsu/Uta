/** 桌宠气泡用的轻量 Markdown：只生成 token，不写入 HTML，避免宿主文本注入。 */

export interface MarkdownSegment {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  href?: string
}

export type MarkdownBlock =
  | { type: 'paragraph'; segments: MarkdownSegment[] }
  | { type: 'heading'; level: number; segments: MarkdownSegment[] }
  | { type: 'code'; text: string; language?: string }
  | { type: 'list'; ordered: boolean; items: MarkdownSegment[][] }
  | { type: 'quote'; segments: MarkdownSegment[] }
  | { type: 'rule' }

interface InlineStyle {
  bold?: boolean
  italic?: boolean
  strike?: boolean
  href?: string
}

const SAFE_LINK = /^https?:\/\/[^\s]+$/i
const FENCE = /^\s*```([\w-]*)\s*$/
const FENCE_END = /^\s*```\s*$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/

function pushSegment(
  out: MarkdownSegment[],
  text: string,
  style: InlineStyle,
  code = false,
): void {
  if (!text) return
  if (code) {
    out.push({ text, code: true })
    return
  }
  const href = style.href && SAFE_LINK.test(style.href) ? style.href : undefined
  const last = out[out.length - 1]
  if (
    last &&
    !last.code &&
    !!last.bold === !!style.bold &&
    !!last.italic === !!style.italic &&
    !!last.strike === !!style.strike &&
    last.href === href
  ) {
    last.text += text
    return
  }
  out.push({
    text,
    ...(style.bold ? { bold: true } : {}),
    ...(style.italic ? { italic: true } : {}),
    ...(style.strike ? { strike: true } : {}),
    ...(href ? { href } : {}),
  })
}

function parseInline(source: string, style: InlineStyle, out: MarkdownSegment[]): void {
  let buffer = ''
  let i = 0
  const flush = (): void => {
    if (!buffer) return
    pushSegment(out, buffer, style)
    buffer = ''
  }

  while (i < source.length) {
    const ch = source[i]

    if (ch === '\\' && i + 1 < source.length && /[\\`*_[\]~()]/.test(source[i + 1])) {
      buffer += source[i + 1]
      i += 2
      continue
    }

    if (ch === '`') {
      let run = 1
      while (source[i + run] === '`') run += 1
      const end = source.indexOf('`'.repeat(run), i + run)
      if (end > i + run) {
        flush()
        pushSegment(out, source.slice(i + run, end).replace(/\n/g, ' '), style, true)
        i = end + run
        continue
      }
      buffer += source.slice(i, i + run)
      i += run
      continue
    }

    if (source.startsWith('**', i) || source.startsWith('__', i)) {
      const marker = source.slice(i, i + 2)
      const end = source.indexOf(marker, i + 2)
      const inner = end > i + 2 ? source.slice(i + 2, end) : ''
      if (end > i + 2 && inner.trim() && !/^\s|\s$/.test(inner)) {
        flush()
        parseInline(inner, { ...style, bold: true }, out)
        i = end + 2
        continue
      }
    }

    if (source.startsWith('~~', i)) {
      const end = source.indexOf('~~', i + 2)
      const inner = end > i + 2 ? source.slice(i + 2, end) : ''
      if (end > i + 2 && inner.trim() && !/^\s|\s$/.test(inner)) {
        flush()
        parseInline(inner, { ...style, strike: true }, out)
        i = end + 2
        continue
      }
    }

    if (ch === '*' || ch === '_') {
      const prev = source[i - 1] ?? ''
      const next = source[i + 1] ?? ''
      const boundary =
        ch === '*' ||
        (!/[A-Za-z0-9]/.test(prev) && !/[A-Za-z0-9]/.test(next))
      if (boundary && next && !/\s/.test(next)) {
        const end = source.indexOf(ch, i + 1)
        const inner = end > i + 1 ? source.slice(i + 1, end) : ''
        if (end > i + 1 && inner && !/^\s|\s$/.test(inner) && !inner.includes('\n')) {
          flush()
          parseInline(inner, { ...style, italic: true }, out)
          i = end + 1
          continue
        }
      }
    }

    if (ch === '[') {
      const link = /^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/i.exec(source.slice(i))
      if (link) {
        flush()
        parseInline(link[1], { ...style, href: link[2] }, out)
        i += link[0].length
        continue
      }
    }

    buffer += ch
    i += 1
  }
  flush()
}

function inlineSegments(source: string): MarkdownSegment[] {
  const out: MarkdownSegment[] = []
  parseInline(source, {}, out)
  return out
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const text = String(source ?? '').replace(/\r\n?/g, '\n')
  if (!text.trim()) return []
  const lines = text.split('\n')
  const blocks: MarkdownBlock[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const language = fence[1] || undefined
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !FENCE_END.test(lines[i])) {
        codeLines.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      blocks.push({ type: 'code', text: codeLines.join('\n'), ...(language ? { language } : {}) })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: Math.min(3, heading[1].length),
        segments: inlineSegments(heading[2]),
      })
      i += 1
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' })
      i += 1
      continue
    }

    const list = LIST_ITEM.exec(line)
    if (list) {
      const ordered = /^\d/.test(list[1])
      const items: MarkdownSegment[][] = []
      while (i < lines.length) {
        const item = LIST_ITEM.exec(lines[i])
        if (!item || /^\d/.test(item[1]) !== ordered) break
        let itemText = item[2]
        i += 1
        while (
          i < lines.length &&
          /^\s{2,}\S/.test(lines[i]) &&
          !LIST_ITEM.test(lines[i]) &&
          !FENCE.test(lines[i]) &&
          !QUOTE.test(lines[i])
        ) {
          itemText += `\n${lines[i].trim()}`
          i += 1
        }
        items.push(inlineSegments(itemText))
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    const quote = QUOTE.exec(line)
    if (quote) {
      const quoteLines: string[] = []
      while (i < lines.length) {
        const part = QUOTE.exec(lines[i])
        if (!part) break
        quoteLines.push(part[1])
        i += 1
      }
      blocks.push({ type: 'quote', segments: inlineSegments(quoteLines.join('\n')) })
      continue
    }

    const paragraphLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !LIST_ITEM.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !RULE.test(lines[i])
    ) {
      paragraphLines.push(lines[i])
      i += 1
    }
    if (paragraphLines.length > 0) {
      blocks.push({ type: 'paragraph', segments: inlineSegments(paragraphLines.join('\n')) })
    } else {
      blocks.push({ type: 'paragraph', segments: inlineSegments(line) })
      i += 1
    }
  }

  return blocks
}
