import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

export interface OnboardingState {
  version: 1
  completed: boolean
  completedAt: string | null
  hostId: string
}

const STATE_FILE = 'onboarding-state.json'
const EXISTING_PROFILE_FILES = ['settings.v1.json', 'window-state.json', 'deskpet-presets.json']

export function createOnboardingStateStore(directory: string) {
  const file = path.join(directory, STATE_FILE)

  function read(): OnboardingState | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<OnboardingState>
      if (parsed?.version !== 1 || typeof parsed.completed !== 'boolean' ||
        typeof parsed.hostId !== 'string') return null
      return {
        version: 1,
        completed: parsed.completed,
        completedAt: typeof parsed.completedAt === 'string' ? parsed.completedAt : null,
        hostId: parsed.hostId.slice(0, 64),
      }
    } catch {
      return null
    }
  }

  function hasExistingProfile(): boolean {
    return EXISTING_PROFILE_FILES.some(name => fs.existsSync(path.join(directory, name)))
  }

  /** Missing state + existing data means an upgrade, not a first run. */
  function shouldOpen(): boolean {
    const state = read()
    if (state) return !state.completed
    return !hasExistingProfile()
  }

  /** Remember that the guide was offered so an interrupted first run opens it again. */
  function markPending(): boolean {
    if (read()) return true
    const next: OnboardingState = {
      version: 1,
      completed: false,
      completedAt: null,
      hostId: '',
    }
    const temp = `${file}.tmp.${process.pid}.${randomUUID()}`
    try {
      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      fs.renameSync(temp, file)
      return true
    } catch {
      try { fs.rmSync(temp, { force: true }) } catch { /* best effort */ }
      return false
    }
  }

  function complete(hostId: string): boolean {
    const raw = typeof hostId === 'string' ? hostId.trim() : ''
    if (!raw || raw.length > 64 || !/^[a-z0-9_-]+$/i.test(raw)) return false
    const clean = raw
    const next: OnboardingState = {
      version: 1,
      completed: true,
      completedAt: new Date().toISOString(),
      hostId: clean,
    }
    const temp = `${file}.tmp.${process.pid}.${randomUUID()}`
    try {
      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      fs.renameSync(temp, file)
      return true
    } catch {
      try { fs.rmSync(temp, { force: true }) } catch { /* best effort */ }
      return false
    }
  }

  return { file, read, shouldOpen, markPending, complete, hasExistingProfile }
}
