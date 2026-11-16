/** Fetch third-party runtime files separately from Uta's source checkout. */
import fs from 'node:fs/promises'
import { createReadStream, createWriteStream, readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import yauzl from 'yauzl'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const appDir = fileURLToPath(new URL('../', import.meta.url))
const defaultManifest = JSON.parse(readFileSync(new URL('./live2d-assets.json', import.meta.url), 'utf8'))

function contained(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') ||
    relative.split('/').some(part => !part || part === '.' || part === '..') || path.isAbsolute(relative)) {
    throw new Error(`Invalid asset path: ${relative}`)
  }
  const target = path.resolve(root, relative)
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Asset path escapes its directory')
  return target
}

async function present(file) {
  try {
    const stat = await fs.lstat(file)
    if (!stat.isFile() || stat.size === 0) throw new Error(`Asset is not a nonempty regular file: ${file}`)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function digest(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function archive(source, cacheDir, fetcher) {
  if (!/^[a-f0-9]{64}$/.test(source.sha256) || !/^[a-z0-9-]+$/.test(source.id)) throw new Error('Invalid asset source identity')
  if (new URL(source.url).protocol !== 'https:') throw new Error('Asset downloads require HTTPS')
  const file = path.join(cacheDir, `${source.id}-${source.sha256}.zip`)
  if (await present(file) && await digest(file) === source.sha256) return file
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    const response = await fetcher(source.url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok || !response.body) throw new Error(`Asset download failed: ${source.id} (HTTP ${response.status})`)
    const hash = createHash('sha256')
    let size = 0
    const handle = await fs.open(temp, 'wx')
    try {
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > source.maxBytes) throw new Error(`Asset archive is too large: ${source.id}`)
        hash.update(chunk)
        await handle.writeFile(chunk)
      }
    } finally { await handle.close() }
    if (hash.digest('hex') !== source.sha256) throw new Error(`Asset checksum mismatch: ${source.id}`)
    await fs.rename(temp, file)
    return file
  } finally { await fs.rm(temp, { force: true }) }
}

function extract(file, wanted, directory, maxBytes) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error) { reject(error); return }
      const found = new Set()
      let total = 0
      let settled = false
      const fail = error => {
        if (settled) return
        settled = true
        zip.close()
        reject(error)
      }
      zip.on('error', fail)
      zip.on('end', () => {
        if (settled) return
        settled = true
        const missing = [...wanted.keys()].filter(name => !found.has(name))
        if (missing.length) reject(new Error(`Asset archive is missing: ${missing.join(', ')}`))
        else resolve()
      })
      zip.on('entry', entry => {
        if (!wanted.has(entry.fileName)) { zip.readEntry(); return }
        if (found.has(entry.fileName)) { fail(new Error(`Duplicate asset entry: ${entry.fileName}`)); return }
        found.add(entry.fileName)
        if ((entry.externalFileAttributes >>> 16 & 0xf000) === 0xa000) {
          fail(new Error(`Asset entry is a symbolic link: ${entry.fileName}`)); return
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error) { fail(error); return }
          const write = async () => {
            const target = contained(directory, wanted.get(entry.fileName))
            await fs.mkdir(path.dirname(target), { recursive: true })
            let size = 0
            const limit = new Transform({
              transform(chunk, _encoding, callback) {
                size += chunk.length
                total += chunk.length
                if (total > maxBytes) callback(new Error('Expanded asset files are too large'))
                else callback(null, chunk)
              },
            })
            await pipeline(stream, limit, createWriteStream(target, { flags: 'wx' }))
            if (size === 0) throw new Error(`Empty asset entry: ${entry.fileName}`)
          }
          write().then(() => zip.readEntry(), fail)
        })
      })
      zip.readEntry()
    })
  })
}

export async function prepareLive2dAssets({ directory = appDir, manifest = defaultManifest, fetcher = fetch, log = console.info } = {}) {
  const publicDir = path.join(directory, 'src', 'renderer', 'public')
  const cacheDir = path.join(directory, '.cache', 'live2d')
  for (const source of manifest.sources) {
    const wanted = new Map()
    for (const file of source.files) {
      contained(publicDir, file.target)
      if (!(await present(contained(publicDir, file.target)))) wanted.set(file.entry, file.target)
    }
    if (!wanted.size) continue
    await fs.mkdir(cacheDir, { recursive: true })
    log(`[uta] preparing ${source.id}`)
    const file = await archive(source, cacheDir, fetcher)
    const stage = await fs.mkdtemp(path.join(cacheDir, 'extract-'))
    try {
      await extract(file, wanted, stage, source.maxBytes * 4)
      for (const target of wanted.values()) {
        const destination = contained(publicDir, target)
        await fs.mkdir(path.dirname(destination), { recursive: true })
        try { await fs.copyFile(contained(stage, target), destination, fs.constants.COPYFILE_EXCL) }
        catch (error) { if (error.code !== 'EEXIST') throw error }
      }
    } finally { await fs.rm(stage, { recursive: true, force: true }) }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareLive2dAssets().catch(error => { console.error(error.message); process.exitCode = 1 })
}
