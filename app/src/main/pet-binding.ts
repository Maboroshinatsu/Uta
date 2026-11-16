import fs from 'node:fs'
import path from 'node:path'

/** Internal host ids used by the runtime bridge and host adapters. */
export const PET_HOST_IDS = [
  'codex',
  'deepseek-harness',
  'qoder',
  'antigravity',
  'claude-code',
  'zcode',
  'opencode',
] as const

export type PetHostId = typeof PET_HOST_IDS[number]

export interface PetBinding {
  version: 1
  hostId: string
  boundAt: string
  sharedDiscovery?: boolean
}

export type PetBindingWriteResult =
  | { ok: true; binding: PetBinding }
  | { ok: false; error: 'invalid-host' | 'already-bound' | 'write-failed'; boundHostId?: string }

export function isPetHostId(value: unknown): value is PetHostId {
  return typeof value === 'string' && (PET_HOST_IDS as readonly string[]).includes(value)
}

/** Built-in hosts plus safe external adapter ids; standalone/fake are not bindings. */
export function isBindableHostId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value) &&
    value !== 'standalone' &&
    value !== 'fake' &&
    value !== 'legacy'
}

/**
 * 宿主 ID 统一前的旧写法。磁盘上可能仍存着 `harness`；读取时归一化为新 ID，
 * 否则 boundHostId 会拿旧 ID 去校验新 ID 的信封，把整条指令通道一起拒掉。
 */
const LEGACY_PET_HOST_IDS: Record<string, string> = { harness: 'deepseek-harness' }

/** Map a pre-unification host id to its current canonical form. */
export function canonicalPetHostId(value: unknown): string {
  return typeof value === 'string' ? (LEGACY_PET_HOST_IDS[value] ?? value) : ''
}

export function createPetBindingStore(runtimeDir: string) {
  const file = path.join(runtimeDir, 'pet-binding.json')
  let current = read()

  function read(): PetBinding | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<PetBinding>
      const hostId = canonicalPetHostId(parsed.hostId)
      if (parsed.version !== 1 || !isBindableHostId(hostId)) return null
      return {
        version: 1,
        hostId,
        boundAt: typeof parsed.boundAt === 'string' ? parsed.boundAt : '',
        ...(parsed.sharedDiscovery === true ? { sharedDiscovery: true } : {}),
      }
    } catch {
      return null
    }
  }

  function get(): PetBinding | null {
    return current
  }

  function write(binding: PetBinding): boolean {
    try {
      fs.mkdirSync(runtimeDir, { recursive: true })
      const temp = `${file}.tmp-${process.pid}-${Date.now()}`
      fs.writeFileSync(temp, JSON.stringify(binding, null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
      })
      fs.renameSync(temp, file)
      return true
    } catch {
      return false
    }
  }

  function bind(rawHostId: string): PetBindingWriteResult {
    const hostId = canonicalPetHostId(rawHostId)
    if (!isBindableHostId(hostId)) return { ok: false, error: 'invalid-host' }
    if (current) {
      if (current.hostId === hostId) return { ok: true, binding: current }
      return { ok: false, error: 'already-bound', boundHostId: current.hostId }
    }
    const binding: PetBinding = {
      version: 1,
      hostId,
      boundAt: new Date().toISOString(),
    }
    if (!write(binding)) return { ok: false, error: 'write-failed' }
    current = binding
    return { ok: true, binding }
  }

  /** Explicit user switch from the quick panel; one platform at a time. */
  function rebind(rawHostId: string, sharedDiscovery = false): PetBindingWriteResult {
    const hostId = canonicalPetHostId(rawHostId)
    if (!isBindableHostId(hostId)) return { ok: false, error: 'invalid-host' }
    if (current?.hostId === hostId && (!sharedDiscovery || current.sharedDiscovery)) return { ok: true, binding: current }
    const binding: PetBinding = {
      version: 1,
      hostId,
      boundAt: new Date().toISOString(),
      ...(sharedDiscovery ? { sharedDiscovery: true } : {}),
    }
    if (!write(binding)) return { ok: false, error: 'write-failed' }
    current = binding
    return { ok: true, binding }
  }

  function clear(): boolean {
    try {
      fs.rmSync(file, { force: true })
      current = null
      return true
    } catch {
      return false
    }
  }

  return { get, bind, rebind, clear }
}
