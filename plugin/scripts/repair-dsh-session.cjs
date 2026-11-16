'use strict'

/**
 * 修复 DSH V4 会话日志里缺少 role/id 的用户消息。
 *
 * 背景：Uta 0.3.0 早期版本的原生 followup 只传了 content/source，
 * DSH 会把它写成不合法的 user/message，重放时整个请求报 missing field role。
 *
 * 用法（DSH 必须已退出）：
 *   node plugin/scripts/repair-dsh-session.cjs [session.v4.jsonl.zstd]
 *   node plugin/scripts/repair-dsh-session.cjs <file> --dry-run
 *
 * 只改目标消息的 role/id，其他事件和 zstd 帧保持原样；写入前自动生成 .bak 备份。
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function findNewestSession() {
  const root = path.join(os.homedir(), '.dsh', 'sessions')
  const found = []
  const walk = (dir, depth = 0) => {
    if (depth > 6) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.name === 'session.v4.jsonl.zstd') {
        try {
          found.push({ file: full, mtime: fs.statSync(full).mtimeMs })
        } catch {
          /* ignore */
        }
      }
    }
  }
  walk(root)
  found.sort((a, b) => b.mtime - a.mtime)
  return found[0]?.file || ''
}

function frameOffsets(buf) {
  const offsets = []
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (
      buf[i] === ZSTD_MAGIC[0] &&
      buf[i + 1] === ZSTD_MAGIC[1] &&
      buf[i + 2] === ZSTD_MAGIC[2] &&
      buf[i + 3] === ZSTD_MAGIC[3]
    ) {
      offsets.push(i)
    }
  }
  return offsets
}

function ensureUserMessage(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false
  if (typeof record.role === 'string' && typeof record.id === 'string') return false
  if (!Array.isArray(record.content) || !record.source) return false
  if (typeof record.role !== 'string' || !record.role) record.role = 'user'
  if (typeof record.id !== 'string' || !record.id) record.id = crypto.randomUUID()
  return true
}

function patchFrameText(text) {
  const lines = text.split('\n')
  let patched = 0
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    let changed = false
    if (event?.type === 'user/message' && ensureUserMessage(event.data)) changed = true
    if (event?.type === 'agent/inbox/spliced' && Array.isArray(event.data?.inserted)) {
      for (const message of event.data.inserted) {
        if (ensureUserMessage(message)) changed = true
      }
    }
    if (changed) {
      lines[i] = JSON.stringify(event)
      patched += 1
    }
  }
  return { text: lines.join('\n'), patched }
}

function verify(repairedBuf) {
  const offsets = frameOffsets(repairedBuf)
  let bad = 0
  for (let i = 0; i < offsets.length; i += 1) {
    const start = offsets[i]
    const end = offsets[i + 1] ?? repairedBuf.length
    let text = ''
    try {
      text = zlib.zstdDecompressSync(repairedBuf.subarray(start, end)).toString('utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      let event
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (
        event?.type === 'user/message' &&
        (typeof event.data?.role !== 'string' || typeof event.data?.id !== 'string')
      ) {
        bad += 1
      }
      if (event?.type === 'agent/inbox/spliced') {
        for (const message of event.data?.inserted || []) {
          if (typeof message?.role !== 'string' || typeof message?.id !== 'string') bad += 1
        }
      }
    }
  }
  return bad
}

function dshIsRunning() {
  if (process.platform !== 'win32') return false
  try {
    const output = execFileSync(
      'tasklist.exe',
      ['/FI', 'IMAGENAME eq DeepSeek Harness.exe', '/NH'],
      { encoding: 'utf8' },
    )
    return /DeepSeek Harness\.exe/i.test(output)
  } catch {
    return false
  }
}

function main() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
  const dryRun = process.argv.includes('--dry-run')
  const force = process.argv.includes('--force')
  const file = path.resolve(args[0] || findNewestSession())
  if (!args[0] && !file) throw new Error('没有找到 DSH 会话日志')
  if (!fs.existsSync(file)) throw new Error(`会话日志不存在: ${file}`)
  if (!dryRun && dshIsRunning() && !force) {
    throw new Error('DeepSeek Harness 仍在运行，请先完全退出，或显式加 --force')
  }

  const buf = fs.readFileSync(file)
  const offsets = frameOffsets(buf)
  if (offsets.length === 0) throw new Error('没有找到 zstd 帧')

  const parts = []
  if (offsets[0] > 0) parts.push(buf.subarray(0, offsets[0]))
  let patched = 0
  for (let i = 0; i < offsets.length; i += 1) {
    const start = offsets[i]
    const end = offsets[i + 1] ?? buf.length
    const original = buf.subarray(start, end)
    let text = ''
    try {
      text = zlib.zstdDecompressSync(original).toString('utf8')
    } catch {
      parts.push(original)
      continue
    }
    const result = patchFrameText(text)
    if (result.patched > 0) {
      parts.push(zlib.zstdCompressSync(Buffer.from(result.text, 'utf8')))
      patched += result.patched
    } else {
      parts.push(original)
    }
  }

  const repaired = Buffer.concat(parts)
  const remaining = verify(repaired)
  console.log(
    JSON.stringify({
      file,
      frames: offsets.length,
      patchedMessages: patched,
      remainingBadMessages: remaining,
      dryRun,
    }),
  )
  if (remaining > 0) throw new Error('修复后仍存在缺少 role/id 的消息，未写入')
  if (dryRun) return
  if (patched === 0) return

  const suffix = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14)
  const backup = `${file}.bak-${suffix}`
  fs.copyFileSync(file, backup)
  const tmp = `${file}.repairing`
  fs.writeFileSync(tmp, repaired)
  fs.renameSync(tmp, file)
  console.log(JSON.stringify({ backup, written: true }))
}

try {
  main()
} catch (error) {
  console.error(`[repair-dsh-session] ${error?.message || error}`)
  process.exitCode = 1
}
