import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RuntimeCommand, RuntimeEventMeta } from './runtime-commands'
import { readHostSessionPreference, type HostSessionPreference } from './host-session-preference'
import type { HostSessionRecord } from './host-bridge'

interface CodexConversation {
  sessionId: string
  label: string
  cwd: string
  lastSeen: number
  available: boolean
}

/** Per-Uta routing metadata only. Background events never change the reply target. */
export function createCodexSessionStore(runtimeDir: string) {
  const file = path.join(runtimeDir, 'codex-conversations.json')
  const conversations = new Map<string, CodexConversation>()
  let automaticSessionId = ''
  let lastSavedAt = 0
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (raw.version === 1 && Array.isArray(raw.conversations)) {
      for (const item of raw.conversations.slice(0, 64)) {
        if (!item || typeof item.sessionId !== 'string' || !item.sessionId.trim() || item.sessionId.length > 200 ||
            !Number.isFinite(item.lastSeen) || item.lastSeen < 0) continue
        conversations.set(item.sessionId, {
          sessionId: item.sessionId,
          label: typeof item.label === 'string' ? item.label.slice(0, 80) : 'Codex',
          cwd: typeof item.cwd === 'string' ? item.cwd.slice(0, 500) : '',
          lastSeen: item.lastSeen,
          available: item.available !== false,
        })
      }
      if (typeof raw.automaticSessionId === 'string' && conversations.has(raw.automaticSessionId)) {
        automaticSessionId = raw.automaticSessionId
      }
    }
  } catch { /* First run or unreadable cache: wait for this instance's next event. */ }

  function save(now: number): void {
    const temp = `${file}.${randomUUID()}.tmp`
    try {
      fs.mkdirSync(runtimeDir, { recursive: true })
      fs.writeFileSync(temp, JSON.stringify({ version: 1, automaticSessionId, conversations: [...conversations.values()] }), { mode: 0o600 })
      fs.renameSync(temp, file)
      lastSavedAt = now
    } catch {
      try { fs.rmSync(temp, { force: true }) } catch { /* Best effort. */ }
      console.warn('[uta] Could not save Codex conversation routing.')
    }
  }

  function observe(command: RuntimeCommand, meta: RuntimeEventMeta, now = Date.now()): void {
    if (meta.hostId !== 'codex' || !meta.sessionId || meta.sessionId.length > 200) return
    const previous = conversations.get(meta.sessionId)
    const record: CodexConversation = {
      sessionId: meta.sessionId,
      label: previous?.label ?? 'Codex',
      cwd: previous?.cwd ?? '',
      lastSeen: now,
      available: true,
    }
    if (command.command === 'session_bind') {
      if (typeof command.cwd === 'string') record.cwd = command.cwd
      if (command.label) record.label = command.label
    }
    conversations.set(record.sessionId, record)
    // Existing installed hooks use this exact label only for UserPromptSubmit.
    const userSubmitted = (command.command === 'session_bind' && command.userInitiated === true) ||
      (command.command === 'agent_state' && command.state === 'thinking' && command.label === '思考中...')
    const changedTarget = !automaticSessionId || (userSubmitted && automaticSessionId !== record.sessionId)
    if (changedTarget) automaticSessionId = record.sessionId
    if (conversations.size > 64) {
      const pinned = readHostSessionPreference(runtimeDir, 'codex')?.sessionId
      const oldest = [...conversations.values()].filter(item => item.sessionId !== automaticSessionId && item.sessionId !== pinned)
        .sort((a, b) => a.lastSeen - b.lastSeen)[0]
      if (oldest) conversations.delete(oldest.sessionId)
    }
    if (!previous || !previous.available || changedTarget || userSubmitted || command.command === 'session_bind' || now - lastSavedAt >= 5000) save(now)
  }

  function list(): CodexConversation[] {
    return [...conversations.values()].sort((a, b) => b.lastSeen - a.lastSeen).map(item => ({ ...item }))
  }

  function target(preference: HostSessionPreference | null): HostSessionRecord | null {
    const id = preference?.sessionId ?? automaticSessionId
    const record = conversations.get(id)
    if (!record?.available) return null
    return { host: 'codex', sessionId: record.sessionId, cwd: record.cwd, updatedAt: record.lastSeen }
  }

  function invalidate(sessionId: string): void {
    const record = conversations.get(sessionId)
    if (!record) return
    record.available = false
    save(Date.now())
  }

  return { observe, list, target, invalidate, getAutomaticSessionId: () => automaticSessionId || null }
}
