import type { PublicSettings, SettingsDocument, SettingsWriteResult } from '../../../shared/settings-contracts'
import type { PublicSettingsBridge } from '../../../shared/settings-integration-contracts'
import { PUBLIC_SETTINGS_KEYS, type SettingsClientInitResult, type SettingsClientMode } from './types'

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const closed = (): SettingsWriteResult => ({ ok: false, code: 'closed', currentRevision: null })

export class SettingsClient {
  private bridge: PublicSettingsBridge | null = null
  private mode: SettingsClientMode = 'browser-mock'
  private currentDocument: SettingsDocument | null = null
  private isInitialized = false
  private bridgeUnsubscribe: (() => void) | null = null
  private listeners = new Set<(doc: SettingsDocument) => void>()
  private epoch = 0
  private patchQueue: Promise<unknown> = Promise.resolve()
  // Pending intents advance across our successful writes only, never foreign revisions.
  private intents = new Set<{ revision: number; ownAdvances: number }>()

  public getMode(): SettingsClientMode { return this.mode }
  public isReady(): boolean { return this.isInitialized }
  public getCurrentDocument(): SettingsDocument | null {
    return this.currentDocument ? copy(this.currentDocument) : null
  }
  public getCurrentSettings(): PublicSettings | null {
    return this.currentDocument ? { ...this.currentDocument.values } : null
  }
  public getCurrentRevision(): number | null { return this.currentDocument?.revision ?? null }

  public async init(bridgeOverride?: PublicSettingsBridge): Promise<SettingsClientInitResult> {
    const epoch = ++this.epoch
    this.resetConnection()
    const preload = typeof window !== 'undefined' ? window.utaAPI : undefined
    const bridge = bridgeOverride ?? preload?.publicSettings
    if (!bridge) {
      if (preload) return { ok: false, error: 'Settings bridge is unavailable' }
      this.isInitialized = true
      return { ok: true, mode: 'browser-mock' }
    }
    this.bridge = bridge
    try {
      const mode = await bridge.getMode()
      if (epoch !== this.epoch) return { ok: false, error: 'Initialization superseded' }
      if (mode !== 'legacy' && mode !== 'canonical-dev' && mode !== 'canonical-stable') throw new Error('Invalid authority mode')
      this.mode = mode
      if (mode === 'legacy') {
        this.isInitialized = true
        return { ok: true, mode }
      }
      this.bridgeUnsubscribe = bridge.onChanged(doc => {
        if (epoch === this.epoch) this.acceptDocument(doc)
      })
      const state = await bridge.read()
      if (epoch !== this.epoch) return { ok: false, error: 'Initialization superseded' }
      if (!state || state.status !== 'ready') throw new Error('Settings store is blocked or unavailable')
      this.acceptDocument(state.document)
      if (!this.currentDocument) throw new Error('Invalid settings snapshot')
      this.isInitialized = true
      return { ok: true, mode, document: this.getCurrentDocument() }
    } catch {
      // An obsolete failed init must not tear down a later successful retry.
      if (epoch === this.epoch) this.resetConnection()
      return { ok: false, error: 'Settings store is blocked or unavailable' }
    }
  }

  private acceptDocument(document: SettingsDocument): void {
    if (!Number.isSafeInteger(document.revision) || document.revision < 0) return
    if (this.currentDocument && document.revision <= this.currentDocument.revision) return
    this.currentDocument = copy(document)
    if (!this.isInitialized) return
    for (const listener of Array.from(this.listeners)) {
      if (!this.listeners.has(listener)) continue
      try { listener(copy(this.currentDocument)) } catch { /* isolate subscribers */ }
    }
  }

  public patch(changes: Partial<PublicSettings>): Promise<SettingsWriteResult> {
    if (!this.isInitialized || !['canonical-dev', 'canonical-stable'].includes(this.mode) || !this.bridge || !this.currentDocument) {
      return Promise.resolve({ ok: false, code: 'store-blocked', currentRevision: null })
    }
    if (!changes || typeof changes !== 'object' || Array.isArray(changes) ||
      Object.keys(changes).some(key => !PUBLIC_SETTINGS_KEYS.includes(key as keyof PublicSettings) ||
        changes[key as keyof PublicSettings] === undefined)) {
      return Promise.resolve({ ok: false, code: 'invalid-request', currentRevision: this.getCurrentRevision() })
    }
    const input = { ...changes }
    const epoch = this.epoch
    const bridge = this.bridge
    const intents = this.intents
    const intent = { revision: this.currentDocument.revision, ownAdvances: 0 }
    intents.add(intent)
    const active = (): boolean => epoch === this.epoch && this.isInitialized && this.bridge === bridge
    const refresh = async (): Promise<void> => {
      try {
        const state = await bridge.read()
        if (active() && state?.status === 'ready') this.acceptDocument(state.document)
      } catch { /* retain committed snapshot and return the failed edit to the caller */ }
    }
    const execute = async (): Promise<SettingsWriteResult> => {
      if (!active() || !this.currentDocument) return closed()
      const expectedRevision = intent.revision + intent.ownAdvances
      if (this.currentDocument.revision !== expectedRevision) {
        await refresh()
        return active()
          ? { ok: false, code: 'revision-conflict', currentRevision: this.getCurrentRevision() }
          : closed()
      }
      const effective: Partial<PublicSettings> = {}
      for (const key of PUBLIC_SETTINGS_KEYS) {
        if (key in input && input[key] !== this.currentDocument.values[key]) {
          ;(effective as Record<string, unknown>)[key] = input[key]
        }
      }
      if (Object.keys(effective).length === 0) {
        return { ok: true, changed: false, document: this.getCurrentDocument()! }
      }
      const result = await bridge.patch({ expectedRevision, changes: effective })
      if (!active()) return closed()
      if (result.ok) {
        if (result.changed) {
          for (const pending of intents) {
            if (result.document.revision > pending.revision) pending.ownAdvances++
          }
        }
        this.acceptDocument(result.document)
        return copy(result)
      }
      if (result.code === 'revision-conflict') await refresh()
      return active() ? result : closed()
    }
    const pending = this.patchQueue.then(execute).catch((): SettingsWriteResult =>
      active() ? { ok: false, code: 'io-error', currentRevision: this.getCurrentRevision() } : closed()
    ).finally(() => { intents.delete(intent) })
    this.patchQueue = pending
    return pending
  }

  public subscribe(listener: (doc: SettingsDocument) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private resetConnection(): void {
    const unsubscribe = this.bridgeUnsubscribe
    this.bridgeUnsubscribe = null
    if (unsubscribe) { try { unsubscribe() } catch { /* disposed bridge */ } }
    this.isInitialized = false
    this.currentDocument = null
    this.bridge = null
    this.mode = 'browser-mock'
    this.patchQueue = Promise.resolve()
    this.intents = new Set()
  }

  public dispose(): void {
    this.epoch++
    this.resetConnection()
    this.listeners.clear()
  }
}

export const settingsClient = new SettingsClient()
