const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const prepare = import('../scripts/prepare-live2d-assets.mjs').then(mod => mod.prepareLive2dAssets)

function zip(entries) {
  const files = [], central = []
  let offset = 0
  for (const [name, text] of Object.entries(entries)) {
    const file = Buffer.from(name), data = Buffer.from(text)
    let crc = 0xffffffff
    for (const byte of data) {
      crc ^= byte
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    crc = (crc ^ 0xffffffff) >>> 0
    const header = Buffer.alloc(30), record = Buffer.alloc(46)
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4)
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(file.length, 26)
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6)
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24)
    record.writeUInt16LE(file.length, 28); record.writeUInt32LE(offset, 42)
    files.push(header, file, data); central.push(record, file)
    offset += header.length + file.length + data.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...files, directory, end])
}

async function sandbox(t, entries = { 'sdk/core.js': 'fixture-core', 'model/model.json': '{"Version":3}', 'model/editor.cmo3': 'excluded' }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'uta-assets-test-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const bytes = zip(entries)
  const source = { id: 'fixture', url: 'https://assets.example.invalid/fixture.zip',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), maxBytes: 1024 * 1024,
    files: [{ entry: 'sdk/core.js', target: 'core.js' }, { entry: 'model/model.json', target: 'models/test/model.json' }] }
  const manifest = { sources: [source] }, publicDir = path.join(directory, 'src', 'renderer', 'public')
  let downloads = 0
  const fetcher = async () => { downloads++; return new Response(bytes) }
  return { directory, publicDir, source, manifest, bytes, fetcher, downloads: () => downloads,
    run: async (options = {}) => (await prepare)({ directory, manifest, fetcher, log() {}, ...options }) }
}

test('resource preparation only installs runtime files and preserves local assets and Uta presets', async t => {
  const h = await sandbox(t)
  await fs.mkdir(path.join(h.publicDir, 'models', 'test'), { recursive: true })
  await fs.writeFile(path.join(h.publicDir, 'core.js'), 'local-core')
  await fs.writeFile(path.join(h.publicDir, 'models', 'test', 'deskpet-presets.json'), 'curated-presets')
  await h.run()
  await h.run({ fetcher: () => { throw new Error('complete resources must work offline') } })
  assert.equal(await fs.readFile(path.join(h.publicDir, 'core.js'), 'utf8'), 'local-core')
  assert.equal(await fs.readFile(path.join(h.publicDir, 'models/test/model.json'), 'utf8'), '{"Version":3}')
  assert.equal(await fs.readFile(path.join(h.publicDir, 'models/test/deskpet-presets.json'), 'utf8'), 'curated-presets')
  assert.deepEqual((await fs.readdir(path.join(h.publicDir, 'models/test'))).sort(), ['deskpet-presets.json', 'model.json'])
  assert.equal(h.downloads(), 1)
})

test('an archive with the wrong checksum cannot install files or leave a partial download', async t => {
  const h = await sandbox(t)
  h.source.sha256 = '0'.repeat(64)
  await assert.rejects(h.run(), /checksum mismatch/)
  await assert.rejects(fs.stat(h.publicDir), { code: 'ENOENT' })
  assert.deepEqual(await fs.readdir(path.join(h.directory, '.cache/live2d')), [])
})

test('missing archive entries fail before any of that source is installed', async t => {
  const h = await sandbox(t, { 'sdk/core.js': 'fixture-core' })
  await assert.rejects(h.run(), /archive is missing/)
  await assert.rejects(fs.stat(h.publicDir), { code: 'ENOENT' })
  assert.ok((await fs.readdir(path.join(h.directory, '.cache/live2d'))).every(name => name.endsWith('.zip')))
})

test('verified cached archives can repair missing resources without a network connection', async t => {
  const h = await sandbox(t)
  await h.run()
  await fs.unlink(path.join(h.publicDir, 'models/test/model.json'))
  await h.run({ fetcher: () => { throw new Error('offline') } })
  assert.equal(await fs.readFile(path.join(h.publicDir, 'models/test/model.json'), 'utf8'), '{"Version":3}')
  assert.equal(h.downloads(), 1)
})

test('a corrupt cache is downloaded again instead of being used for resource repair', async t => {
  const h = await sandbox(t)
  await h.run()
  await fs.unlink(path.join(h.publicDir, 'core.js'))
  const cache = path.join(h.directory, '.cache/live2d')
  await fs.writeFile(path.join(cache, (await fs.readdir(cache))[0]), 'corrupt')
  await h.run()
  assert.equal(await fs.readFile(path.join(h.publicDir, 'core.js'), 'utf8'), 'fixture-core')
  assert.equal(h.downloads(), 2)
})

test('failed and oversized downloads leave no installed resources or partial archives', async t => {
  const h = await sandbox(t)
  await assert.rejects(h.run({ fetcher: async () => new Response('unavailable', { status: 503 }) }), /HTTP 503/)
  h.source.maxBytes = 1
  await assert.rejects(h.run(), /archive is too large/)
  await assert.rejects(fs.stat(h.publicDir), { code: 'ENOENT' })
  assert.deepEqual(await fs.readdir(path.join(h.directory, '.cache/live2d')), [])
})

test('invalid destination paths are rejected before downloading or writing outside public', async t => {
  const h = await sandbox(t)
  for (const target of ['../outside.js', '/absolute.js', 'models/../../outside.js', 'models\\outside.js']) {
    h.source.files[0].target = target
    await assert.rejects(h.run(), /Invalid asset path/)
  }
  assert.equal(h.downloads(), 0)
})
