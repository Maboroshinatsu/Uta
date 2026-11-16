import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createDefaultDocument } from './defaults'
import type {
  SettingsDocument,
  SettingsIoHooks,
  SettingsState
} from './types'
import {
  MAX_JSON_SIZE_BYTES,
  validateDocument
} from './validator'

export const MAIN_SETTINGS_FILENAME = 'settings.v1.json'
export const BACKUP_SETTINGS_FILENAME = 'settings.v1.backup.json'

export const defaultIoHooks: SettingsIoHooks = {
  async readFile(filePath, encoding) {
    return fs.readFile(filePath, { encoding })
  },
  async writeFile(filePath, data, encoding) {
    const handle = await fs.open(filePath, 'wx')
    try {
      await handle.writeFile(data, { encoding })
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
  async rename(oldPath, newPath) {
    await fs.rename(oldPath, newPath)
  },
  async unlink(filePath) {
    try {
      await fs.unlink(filePath)
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'ENOENT') {
        throw err
      }
    }
  },
  async stat(filePath) {
    // lstat：设置文件被替换成符号链接时按“不是普通文件”处理，不跟随链接读取/覆盖目标
    const s = await fs.lstat(filePath)
    return {
      size: s.size,
      isFile: () => s.isFile(),
      isSymbolicLink: () => s.isSymbolicLink()
    }
  }
}

export interface ReadDiskResult {
  isFirstLaunch: boolean
  state: SettingsState
}

export class AtomicWriter {
  private readonly dir: string
  private readonly io: SettingsIoHooks

  constructor(directory: string, customIo?: Partial<SettingsIoHooks>) {
    this.dir = directory
    this.io = {
      ...defaultIoHooks,
      ...customIo
    }
  }

  public getMainPath(): string {
    return path.join(this.dir, MAIN_SETTINGS_FILENAME)
  }

  public getBackupPath(): string {
    return path.join(this.dir, BACKUP_SETTINGS_FILENAME)
  }

  /** A first explicit import also gets a rollback document, without modifying its legacy sources. */
  public async ensureImportBackup(document: SettingsDocument): Promise<void> {
    try { await this.io.stat(this.getMainPath()); return }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const content = JSON.stringify(document, null, 2)
    try {
      const existing = JSON.parse(await this.io.readFile(this.getBackupPath(), 'utf8'))
      if (!validateDocument(existing).ok || JSON.stringify(existing) !== JSON.stringify(document)) throw new Error('Import backup differs')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const temp = path.join(this.dir, `${BACKUP_SETTINGS_FILENAME}.import.${randomUUID()}`)
      try { await this.io.writeFile(temp, content, 'utf8'); await this.io.rename(temp, this.getBackupPath()) }
      catch (failure) {
        if ((failure as NodeJS.ErrnoException).code !== 'EEXIST') await this.io.unlink(temp).catch(() => {})
        throw failure
      }
    }
  }

  public async isBackupValid(): Promise<boolean> {
    const backupPath = this.getBackupPath()
    try {
      const stat = await this.io.stat(backupPath)
      if (!stat.isFile() || stat.size > MAX_JSON_SIZE_BYTES || stat.size === 0) {
        return false
      }
      const rawText = await this.io.readFile(backupPath, 'utf8')
      if (Buffer.byteLength(rawText, 'utf8') > MAX_JSON_SIZE_BYTES) return false
      const parsed = JSON.parse(rawText)
      const valid = validateDocument(parsed)
      return valid.ok && valid.value.schemaVersion === 1
    } catch {
      return false
    }
  }

  public async readInitialState(): Promise<ReadDiskResult> {
    const mainPath = this.getMainPath()
    const backupPath = this.getBackupPath()

    const probe = async (file: string) => {
      try { return { stat: await this.io.stat(file), error: false } }
      catch (error) { return { stat: null, error: (error as NodeJS.ErrnoException).code !== 'ENOENT' } }
    }
    const main = await probe(mainPath), backup = await probe(backupPath)
    const mainExists = main.stat !== null, backupExists = backup.stat !== null
    const backupValid = backupExists ? await this.isBackupValid() : false
    if (main.error || backup.error) {
      return { isFirstLaunch: false, state: { status: 'blocked', reason: 'io-error', backupAvailable: backupValid } }
    }

    // 首次无主文件且无备份
    if (!mainExists && !backupExists) {
      return {
        isFirstLaunch: true,
        state: {
          status: 'ready',
          document: createDefaultDocument()
        }
      }
    }

    // 主文件丢失但有备份：不能当作首次启动覆盖
    if (!mainExists && backupExists) {
      return {
        isFirstLaunch: false,
        state: {
          status: 'blocked',
          reason: 'corrupt',
          backupAvailable: backupValid
        }
      }
    }
    if (!main.stat?.isFile()) {
      return { isFirstLaunch: false, state: { status: 'blocked', reason: 'corrupt', backupAvailable: backupValid } }
    }

    // 读取主文件
    try {
      const mainStat = await this.io.stat(mainPath)
      if (mainStat.isSymbolicLink?.() === true || mainStat.size > MAX_JSON_SIZE_BYTES) {
        return {
          isFirstLaunch: false,
          state: {
            status: 'blocked',
            reason: 'corrupt',
            backupAvailable: backupValid
          }
        }
      }

      const content = await this.io.readFile(mainPath, 'utf8')
      if (Buffer.byteLength(content, 'utf8') > MAX_JSON_SIZE_BYTES) {
        return { isFirstLaunch: false, state: { status: 'blocked', reason: 'corrupt', backupAvailable: backupValid } }
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(content)
      } catch {
        return {
          isFirstLaunch: false,
          state: {
            status: 'blocked',
            reason: 'corrupt',
            backupAvailable: backupValid
          }
        }
      }

      const valResult = validateDocument(parsed)
      if (!valResult.ok) {
        return {
          isFirstLaunch: false,
          state: {
            status: 'blocked',
            reason: valResult.isFutureSchema ? 'future-schema' : 'corrupt',
            backupAvailable: backupValid
          }
        }
      }

      return {
        isFirstLaunch: false,
        state: {
          status: 'ready',
          document: valResult.value
        }
      }
    } catch {
      return {
        isFirstLaunch: false,
        state: {
          status: 'blocked',
          reason: 'io-error',
          backupAvailable: backupValid
        }
      }
    }
  }

  public async writeDocument(document: SettingsDocument): Promise<void> {
    const mainPath = this.getMainPath()
    const backupPath = this.getBackupPath()

    const serialized = JSON.stringify(document, null, 2) + '\n'
    if (Buffer.byteLength(serialized, 'utf8') > MAX_JSON_SIZE_BYTES) {
      throw new Error('Document payload exceeds 1 MiB limit')
    }

    const randTag = randomUUID()
    const tempMainPath = path.join(this.dir, `${MAIN_SETTINGS_FILENAME}.tmp.${randTag}`)
    const tempBackupPath = path.join(this.dir, `${BACKUP_SETTINGS_FILENAME}.tmp.${randTag}`)

    let mainFileExists = false
    try {
      const s = await this.io.stat(mainPath)
      if (!s.isFile()) throw new Error('Main settings path is not a file')
      mainFileExists = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    const ownedTemps = new Set<string>()
    const writeTemp = async (file: string, data: string) => {
      ownedTemps.add(file)
      try { await this.io.writeFile(file, data, 'utf8') }
      catch (error) {
        // Exclusive create never owned an existing colliding file.
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') ownedTemps.delete(file)
        throw error
      }
    }

    try {
      // 1. 写主配置临时文件并 fsync
      await writeTemp(tempMainPath, serialized)

      // 2. 若存在已有主文件，先将其安全复制为备份
      if (mainFileExists) {
        const existingMainContent = await this.io.readFile(mainPath, 'utf8')
        await writeTemp(tempBackupPath, existingMainContent)
        await this.io.rename(tempBackupPath, backupPath)
      }

      // 3. 原子重命名替换主文件
      await this.io.rename(tempMainPath, mainPath)
    } catch (err) {
      // 失败时清理本次创建的临时文件，绝不留下残留 pending
      for (const file of ownedTemps) await this.io.unlink(file).catch(() => {})
      throw err
    }
  }
}
