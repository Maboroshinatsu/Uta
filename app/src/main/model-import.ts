import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as yauzl from 'yauzl'
import { isAllowedModelAsset, isPathInside, resolveContainedModelFile } from './model-path-safety'
import { readModelImportJson, safeRelative, type Candidate, type ModelImportInspection } from './model-import-inspector'
import type { ModelImportPreview } from '../shared/model-import-contracts'

const MAX_BYTES = 2 * 1024 * 1024 * 1024
const MAX_FILE = 256 * 1024 * 1024
const MAX_FILES = 4096
const TTL = 20 * 60_000
interface Stage { owner: number; root: string; expires: number; candidates: Candidate[] }

type InspectModels = (request: ModelImportInspection, signal: AbortSignal) => Promise<Candidate[]>

const inspectInWorker: InspectModels = (request, signal) => {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'model-import-worker.js'), { workerData: request })
    const cancel = () => { void worker.terminate().catch(reject) }
    signal.addEventListener('abort', cancel, { once: true })
    worker.once('message', resolve)
    worker.once('error', reject)
    worker.once('exit', () => {
      signal.removeEventListener('abort', cancel)
      reject(signal.aborted ? Error('已取消导入。') : Error('模型检查进程意外退出。'))
    })
  })
}

function plainDirectory(file: string): void {
  const stat = fs.lstatSync(file)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('角色目录不能是符号链接。')
}

/** Data-only imports. Source files and the current pet are never modified while staging. */
export function createModelImporter(userData: string, inspectModels: InspectModels = inspectInWorker) {
  const models = path.join(userData, 'models')
  const staging = path.join(userData, '.model-import')
  const backups = path.join(userData, '.model-import-backups')
  const journal = path.join(userData, '.model-import-journal.json')
  const stages = new Map<string, Stage>()
  let busy = false
  let disposed = false
  const abortInspection = new AbortController()
  let recoveryError = false
  try {
    for (const dir of [userData, models, staging, backups]) {
      fs.mkdirSync(dir, { recursive: true })
      plainDirectory(dir)
    }
  } catch { recoveryError = true }
  const destinationPath = (name: string) => {
    if (!/^imported-[a-z0-9-]{1,80}$/.test(name)) throw Error('导入记录不正确。')
    return path.join(models, name)
  }
  const removeStage = (token: string) => {
    const stage = stages.get(token)
    stages.delete(token)
    if (stage && isPathInside(staging, stage.root)) fs.rmSync(stage.root, { recursive: true, force: true })
  }
  // A crash between old->backup and new->destination restores the old directory on startup.
  try {
    if (recoveryError) throw Error('Import directory unavailable')
    if (fs.existsSync(journal)) {
      const record = readModelImportJson(journal)
      const destination = destinationPath(record.destination)
      const backup = path.join(backups, record.destination)
      if (fs.existsSync(backup)) {
        plainDirectory(backup)
        if (!fs.existsSync(destination)) fs.renameSync(backup, destination)
        else { plainDirectory(destination); fs.rmSync(backup, { recursive: true }) }
      }
      fs.rmSync(journal)
    }
    for (const entry of fs.readdirSync(staging, { withFileTypes: true })) {
      const file = path.join(staging, entry.name)
      if (entry.isDirectory() && !entry.isSymbolicLink() && Date.now() - fs.statSync(file).mtimeMs > 24 * 60 * 60_000) fs.rmSync(file, { recursive: true })
    }
  } catch { recoveryError = true }

  async function copySource(source: string, target: string): Promise<void> {
    let count = 0, bytes = 0, visited = 0
    const names = new Set<string>()
    const reserve = (name: string, size: number, included = true) => {
      const normalized = safeRelative(name)
      if (!Number.isSafeInteger(size) || size < 0) throw Error(`资源大小不正确：${normalized}`)
      if (names.has(normalized.toLowerCase())) throw Error('角色包包含重复文件名。')
      names.add(normalized.toLowerCase())
      if (included) {
        if (++count > MAX_FILES) throw Error('角色资源超过 4096 个文件。')
        if (size > MAX_FILE) throw Error(`资源文件过大：${normalized}（${(size / 1024 / 1024).toFixed(1)} MiB），单文件上限为 256 MiB。`)
        if ((bytes += size) > MAX_BYTES) throw Error('角色资源合计超过 2 GiB，请只保留需要导入的模型。')
      }
      return path.join(target, normalized)
    }
    const stat = fs.lstatSync(source)
    if (stat.isSymbolicLink()) throw Error('请选择实际文件夹或 ZIP，不能使用符号链接。')
    if (stat.isDirectory()) {
      if (source === staging || isPathInside(source, staging)) throw Error('请选择具体角色文件夹，不能导入整个 Uta 数据目录。')
      const walk = async (directory: string, depth: number) => {
        if (depth > 12) throw Error('角色文件夹层级太深。')
        for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
          if (++visited > MAX_FILES) throw Error('角色包包含太多目录或文件。')
          if (disposed) throw Error('已取消导入。')
          const full = path.join(directory, entry.name)
          const info = await fs.promises.lstat(full)
          if (info.isSymbolicLink()) throw Error('角色包不能包含符号链接。')
          if (info.isDirectory()) { await walk(full, depth + 1); continue }
          if (!info.isFile()) throw Error('角色包包含不支持的文件类型。')
          if (!isAllowedModelAsset(full)) continue
          const dest = reserve(path.relative(source, full), info.size)
          await fs.promises.mkdir(path.dirname(dest), { recursive: true })
          await fs.promises.copyFile(full, dest, fs.constants.COPYFILE_EXCL)
          if ((await fs.promises.stat(dest)).size !== info.size) throw Error('复制时源文件发生变化，请重新导入。')
        }
      }
      await walk(source, 0)
      return
    }
    if (!stat.isFile() || !source.toLowerCase().endsWith('.zip')) throw Error('请选择角色文件夹或 ZIP。')
    if (stat.size > MAX_BYTES) throw Error('ZIP 文件超过 2 GiB，请解压后选择具体模型文件夹。')
    await new Promise<void>((resolve, reject) => {
      yauzl.open(source, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
        if (error || !zip) { reject(Error('ZIP 无法读取。')); return }
        let finished = false
        const fail = (cause: unknown) => { if (!finished) { finished = true; zip.close(); reject(cause) } }
        zip.on('error', fail)
        zip.on('end', () => { if (!finished) { finished = true; resolve() } })
        zip.on('entry', (entry: yauzl.Entry) => {
          void (async () => {
            if (disposed) throw Error('已取消导入。')
            if (++visited > MAX_FILES) throw Error('ZIP 包含太多目录或文件。')
            if ((entry.externalFileAttributes >>> 16 & 0o170000) === 0o120000) throw Error('ZIP 不能包含符号链接。')
            if (entry.fileName.endsWith('/')) { safeRelative(entry.fileName.slice(0, -1)); zip.readEntry(); return }
            // Validate every path and count every entry, but only extract and budget supported assets.
            const included = isAllowedModelAsset(entry.fileName)
            const dest = reserve(entry.fileName, entry.uncompressedSize, included)
            if (!included) { zip.readEntry(); return }
            await fs.promises.mkdir(path.dirname(dest), { recursive: true })
            const stream = await new Promise<NodeJS.ReadableStream>((ok, bad) => zip.openReadStream(entry, (err, value) => err || !value ? bad(err) : ok(value)))
            let actual = 0
            await pipeline(stream, new Transform({ transform(chunk: Buffer, _encoding, callback) {
              actual += chunk.length
              callback(actual > entry.uncompressedSize || actual > MAX_FILE ? Error('ZIP 资源超过声明大小。') : null, chunk)
            } }), fs.createWriteStream(dest, { flags: 'wx' }))
            if (actual !== entry.uncompressedSize) throw Error('ZIP 资源不完整。')
            zip.readEntry()
          })().catch(fail)
        })
        zip.readEntry()
      })
    })
  }

  function get(token: string, owner?: number): Stage {
    const stage = stages.get(token)
    if (!stage || (owner !== undefined && stage.owner !== owner) || stage.expires < Date.now() || disposed) throw Error('导入预览已过期，请重新选择资源。')
    return stage
  }
  return {
    async stage(source: string, owner: number): Promise<ModelImportPreview> {
      if (busy || disposed || recoveryError) throw Error('导入暂不可用，请稍后重试；若重启后仍不可用，请检查导入恢复记录。')
      busy = true
      const token = randomUUID(), root = path.join(staging, token), payload = path.join(root, 'payload')
      try {
        for (const [key, value] of stages) if (value.owner === owner || value.expires < Date.now()) removeStage(key)
        await fs.promises.mkdir(payload, { recursive: true })
        await copySource(path.resolve(source), payload)
        const candidates = await inspectModels({ root: payload, token, models }, abortInspection.signal)
        if (disposed) throw Error('已取消导入。')
        stages.set(token, { owner, root, expires: Date.now() + TTL, candidates })
        return { token, candidates: candidates.map(({ manifest: _m, destination: _d, files: _f, sourceAdapter: _s, generatedAdapter: _g, ...candidate }) => candidate) }
      } catch (error) { fs.rmSync(root, { recursive: true, force: true }); throw error }
      finally {
        busy = false
        if (disposed) for (const token of stages.keys()) removeStage(token)
      }
    },
    previewFile(token: string, relative: string): string | null {
      try { const stage = get(token); return resolveContainedModelFile([path.join(stage.root, 'payload')], safeRelative(relative)) } catch { return null }
    },
    async install(token: string, candidateId: string, owner: number, replace: boolean): Promise<string> {
      if (busy || recoveryError) throw Error('已有导入正在处理。')
      const stage = get(token, owner), candidate = stage.candidates.find(value => value.id === candidateId)
      if (!candidate || candidate.errors.length) throw Error('这个角色没有通过检查，不能导入。')
      const destination = destinationPath(candidate.destination), backup = path.join(backups, candidate.destination)
      if (fs.existsSync(destination) && !replace) throw Error('同名角色已存在，请明确确认替换。')
      busy = true
      const prepared = path.join(stage.root, 'prepared')
      let journalCreated = false
      try {
        fs.rmSync(prepared, { recursive: true, force: true })
        for (const file of candidate.files) {
          const source = resolveContainedModelFile([path.dirname(candidate.manifest)], file)
          if (!source) throw Error('暂存资源已变化，请重新导入。')
          const target = path.join(prepared, file)
          await fs.promises.mkdir(path.dirname(target), { recursive: true })
          await fs.promises.copyFile(source, target)
        }
        if (disposed) throw Error('已取消导入。')
        const [checked] = await inspectModels({ root: prepared, manifest: path.join(prepared, path.basename(candidate.manifest)), token, models }, abortInspection.signal)
        if (disposed) throw Error('已取消导入。')
        if (checked.errors.length) throw Error('保存前复核失败，请重新导入。')
        if (candidate.generatedAdapter) fs.writeFileSync(path.join(prepared, 'deskpet-adapter.json'), candidate.generatedAdapter)
        // A source package without an adapter must not wipe local fixes (hidden drawables,
        // base parameters, controls) during a replace. Source-provided adapters still win.
        if (!candidate.sourceAdapter) {
          const previousAdapter = path.join(destination, 'deskpet-adapter.json')
          if (fs.existsSync(previousAdapter)) {
            await fs.promises.copyFile(previousAdapter, path.join(prepared, 'deskpet-adapter.json'))
          }
        }
        if (fs.existsSync(backup)) throw Error('上次导入的备份尚未处理，已保留现有角色。')
        fs.writeFileSync(journal, JSON.stringify({ destination: candidate.destination }), { flag: 'wx' })
        journalCreated = true
        try {
          if (fs.existsSync(destination)) { plainDirectory(destination); fs.renameSync(destination, backup) }
          fs.renameSync(prepared, destination)
        } catch (error) {
          if (!fs.existsSync(destination) && fs.existsSync(backup)) fs.renameSync(backup, destination)
          throw error
        }
        try { fs.rmSync(backup, { recursive: true, force: true }); fs.rmSync(journal, { force: true }) }
        catch { recoveryError = true /* Installed successfully; cleanup resumes on next startup. */ }
        const url = `uta://models/${candidate.destination}/${encodeURIComponent(path.basename(candidate.manifest))}`
        try { removeStage(token) } catch { /* Orphan staging files are cleaned on a later startup. */ }
        return url
      } catch (error) {
        // Preserve journal if rollback itself failed; next startup will restore the backup.
        if (journalCreated && !fs.existsSync(backup)) {
          try { fs.rmSync(journal, { force: true }) }
          catch { recoveryError = true }
        }
        throw error
      } finally {
        busy = false
        if (disposed) for (const token of stages.keys()) removeStage(token)
      }
    },
    cancel(token: string, owner: number) { if (!busy && stages.get(token)?.owner === owner) removeStage(token) },
    dispose() {
      disposed = true
      abortInspection.abort()
      if (!busy) for (const token of stages.keys()) removeStage(token)
    },
  }
}
