import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents, type WebFrameMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { normalizePetSettingsCommand, type PetSettingsCommand, type PetSettingsCommandResult, type PetSettingsModelContext } from '../../shared/settings-command-contracts'

interface Options {
  getPet: () => WebContents | null
  isSettingsSender: (event: IpcMainInvokeEvent) => boolean
  isPetSender: (event: IpcMainEvent) => boolean
  timeoutMs?: number
}
interface Owner { sender: WebContents; frame: WebFrameMain; session: number }
interface Pending {
  owner: Owner
  pet: WebContents
  frame: WebFrameMain
  resolve: (result: PetSettingsCommandResult) => void
  timer: ReturnType<typeof setTimeout>
}

/** One editor document owns its commands and lock. Closing/reloading it releases both. */
export class SettingsPetCommands {
  private owner: Owner | null = null
  private nextSession = 0
  private pet: WebContents | null = null
  private petEpoch = 0
  private observed = new Set<WebContents>()
  private pending = new Map<string, Pending>()
  constructor(private readonly options: Options) {}

  private settle(id: string, result: PetSettingsCommandResult): void {
    const request = this.pending.get(id)
    if (!request) return
    this.pending.delete(id)
    clearTimeout(request.timer)
    request.resolve(result)
  }

  private releaseOwner(error: string): void {
    const owner = this.owner
    if (!owner) return
    this.owner = null
    for (const [id, request] of this.pending) {
      if (request.owner === owner) this.settle(id, { ok: false, error })
    }
    const pet = this.pet
    if (pet && !pet.isDestroyed()) {
      try {
        pet.send('pet-settings-command', { id: randomUUID(), session: owner.session, command: { type: 'release-workshop' } })
      } catch { /* A destroyed pet cannot retain an in-memory workshop lock. */ }
    }
  }

  private observePet(pet: WebContents): void {
    if (this.pet === pet) return
    this.releaseOwner('pet-reloaded')
    this.pet = pet
    this.petEpoch++
    const invalidate = () => {
      if (this.pet !== pet) return
      this.petEpoch++
      this.releaseOwner('pet-reloaded')
    }
    pet.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) invalidate() })
    pet.on('render-process-gone', invalidate)
    pet.once('destroyed', () => { invalidate(); if (this.pet === pet) this.pet = null })
  }

  private getOwner(event: IpcMainInvokeEvent): Owner {
    if (this.owner?.sender === event.sender && this.owner.frame === event.senderFrame) return this.owner
    this.releaseOwner('session-closed')
    const sender = event.sender
    if (!this.observed.has(sender)) {
      this.observed.add(sender)
      const invalidate = () => { if (this.owner?.sender === sender) this.releaseOwner('session-closed') }
      sender.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) invalidate() })
      sender.on('render-process-gone', invalidate)
      sender.once('destroyed', () => { invalidate(); this.observed.delete(sender) })
    }
    return this.owner = { sender, frame: event.senderFrame!, session: ++this.nextSession }
  }

  public run(event: IpcMainInvokeEvent, raw: unknown, rawModel?: unknown): Promise<PetSettingsCommandResult> {
    if (!this.options.isSettingsSender(event)) return Promise.resolve({ ok: false, error: 'unauthorized' })
    const command = normalizePetSettingsCommand(raw)
    if (!command) return Promise.resolve({ ok: false, error: 'invalid-command' })
    if (command.type === 'release-workshop') {
      this.releaseOwner('session-closed')
      return Promise.resolve({ ok: true })
    }
    let model: PetSettingsModelContext | undefined
    if (rawModel !== undefined) {
      const value = rawModel as Partial<PetSettingsModelContext> | null
      if (!value || Array.isArray(value) || typeof value.modelUrl !== 'string' || value.modelUrl.length > 4096 ||
        !Number.isSafeInteger(value.modelGeneration) || value.modelGeneration! < 0 ||
        !Number.isSafeInteger(value.petEpoch) || value.petEpoch! < 1) {
        return Promise.resolve({ ok: false, error: 'invalid-command' })
      }
      model = { modelUrl: value.modelUrl, modelGeneration: value.modelGeneration!, petEpoch: value.petEpoch! }
    }
    const pet = this.options.getPet()
    if (!pet || pet.isDestroyed()) return Promise.resolve({ ok: false, error: 'pet-unavailable' })
    this.observePet(pet)
    if (model && model.petEpoch !== this.petEpoch) return Promise.resolve({ ok: false, error: 'model-changed' })
    const owner = this.getOwner(event)
    const id = randomUUID()
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.settle(id, { ok: false, error: 'timeout' })
        if (this.owner === owner) this.releaseOwner('timeout')
      }, this.options.timeoutMs ?? (command.type === 'switch-model' ? 15000 : 3000))
      this.pending.set(id, { owner, pet, frame: pet.mainFrame, resolve, timer })
      try { pet.send('pet-settings-command', { id, session: owner.session, command, model }) }
      catch { this.settle(id, { ok: false, error: 'pet-unavailable' }); this.releaseOwner('pet-unavailable') }
    })
  }

  public receive(event: IpcMainEvent, payload: unknown): void {
    if (!this.options.isPetSender(event) || !payload || typeof payload !== 'object') return
    const { id, result } = payload as { id?: unknown; result?: PetSettingsCommandResult }
    if (typeof id !== 'string') return
    const pending = this.pending.get(id)
    if (!pending || event.sender !== pending.pet || event.senderFrame !== pending.frame) return
    if (!result || typeof result.ok !== 'boolean') { this.settle(id, { ok: false, error: 'invalid-result' }); return }
    const clean: PetSettingsCommandResult = result.ok
      ? { ok: true, data: result.data }
      : { ok: false, error: typeof result.error === 'string' ? result.error.slice(0, 120) : 'action-rejected' }
    if (pending && clean.ok && pending.owner === this.owner && clean.data && typeof clean.data === 'object') {
      clean.data = { ...clean.data, petEpoch: this.petEpoch }
    }
    this.settle(id, clean)
  }

  public dispose(): void { this.releaseOwner('session-closed') }
}

export function registerSettingsPetCommands(controller: SettingsPetCommands): void {
  ipcMain.handle('settings-pet-command', (event, command, model) => controller.run(event, command, model))
  ipcMain.on('pet-settings-command-result', (event, payload) => controller.receive(event, payload))
}
