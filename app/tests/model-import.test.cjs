'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { deflateRawSync } = require('node:zlib')
const createLoader = require('./support/settings-loader.cjs')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ7sAAAAASUVORK5CYII=', 'base64')
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
  return c >>> 0
})
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-model-import-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'source'), profile = path.join(root, 'profile')
  fs.mkdirSync(source)
  fs.writeFileSync(path.join(source, 'deskpet-images.json'), JSON.stringify({ name: '测试角色', default: 'neutral', images: { neutral: 'neutral.png', happy: 'missing.png' } }))
  fs.writeFileSync(path.join(source, 'neutral.png'), png)
  return { root, source, profile }
}
function importer(profile, overrides = {}) {
  const load = createLoader(overrides, { AbortController })
  const { inspectModelCandidates } = load('main/model-import-inspector')
  return load('main/model-import').createModelImporter(profile, async request => inspectModelCandidates(request))
}
// Stored ZIP fixture generator: the production importer still uses the real ZIP reader.
function zip(file, entries) {
  let offset = 0
  const parts = [], central = []
  for (const { name, data, attributes = 0, deflate = false, declaredSize } of entries) {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data), filename = Buffer.from(name)
    const packed = deflate ? deflateRawSync(bytes) : bytes
    const size = declaredSize ?? bytes.length
    let crc = 0xffffffff
    for (const value of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ value) & 0xff]
    crc = (crc ^ 0xffffffff) >>> 0
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(deflate ? 8 : 0, 8)
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(size, 22); header.writeUInt16LE(filename.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(0x314, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8)
    entry.writeUInt16LE(deflate ? 8 : 0, 10)
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(size, 24); entry.writeUInt16LE(filename.length, 28)
    entry.writeUInt32LE(attributes >>> 0, 38); entry.writeUInt32LE(offset, 42)
    parts.push(header, filename, packed); central.push(entry, filename); offset += header.length + filename.length + packed.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  fs.writeFileSync(file, Buffer.concat([...parts, directory, end]))
}

test('a real 65 MiB resource imports from both folder and compressed ZIP', async t => {
  const { root, source, profile } = fixture(t), service = importer(profile)
  t.after(() => service.dispose())
  const large = Buffer.alloc(65 * 1024 * 1024)
  png.copy(large)
  fs.writeFileSync(path.join(source, 'neutral.png'), large)
  const file = path.join(root, 'large.zip')
  zip(file, [
    { name: 'deskpet-images.json', data: fs.readFileSync(path.join(source, 'deskpet-images.json')) },
    { name: 'neutral.png', data: large, deflate: true },
  ])
  for (const input of [source, file]) {
    const preview = await service.stage(input, 1)
    const candidate = preview.candidates[0]
    assert.equal(candidate.errors.length, 0)
    assert.ok(candidate.bytes >= large.length)
  }
})

test('ZIP ignores an oversized editor file without extracting it or charging the resource budget', async t => {
  const { root, source, profile } = fixture(t), service = importer(profile)
  t.after(() => service.dispose())
  const file = path.join(root, 'editor.zip')
  zip(file, [
    { name: 'art.psd', data: 'not extracted', deflate: true, declaredSize: 3 * 1024 * 1024 * 1024 },
    { name: 'deskpet-images.json', data: fs.readFileSync(path.join(source, 'deskpet-images.json')) },
    { name: 'neutral.png', data: png },
  ])
  const preview = await service.stage(file, 1)
  assert.equal(preview.candidates[0].errors.length, 0)
  const staged = path.join(profile, '.model-import', preview.token, 'payload')
  assert.equal(fs.existsSync(path.join(staged, 'art.psd')), false)
  assert.ok(preview.candidates[0].bytes < 1024)
})

test('ZIP validates paths and duplicate names even for skipped editor files', async t => {
  const { root, profile } = fixture(t), service = importer(profile)
  t.after(() => service.dispose())
  const file = path.join(root, 'unsafe.zip')
  zip(file, [{ name: '../art.psd', data: 'ignored' }])
  await assert.rejects(service.stage(file, 1), /路径|relative path/i)
  zip(file, [{ name: 'art.psd', data: 'first' }, { name: 'ART.psd', data: 'second' }])
  await assert.rejects(service.stage(file, 1), /重复文件名/)
})

test('ZIP rejects a resource over 256 MiB with its filename before opening its stream', async t => {
  const { root, profile } = fixture(t), service = importer(profile)
  t.after(() => service.dispose())
  const file = path.join(root, 'oversized.zip')
  zip(file, [{ name: 'texture.png', data: 'not inflated', deflate: true, declaredSize: 256 * 1024 * 1024 + 1 }])
  await assert.rejects(service.stage(file, 1), /texture\.png.*256 MiB/)
  assert.deepEqual(fs.readdirSync(path.join(profile, '.model-import')), [])
})

test('ZIP size metadata permits 600 MiB and rejects archives over 2 GiB', async t => {
  const { root, source, profile } = fixture(t)
  const file = path.join(root, 'archive.zip')
  zip(file, [
    { name: 'deskpet-images.json', data: fs.readFileSync(path.join(source, 'deskpet-images.json')) },
    { name: 'neutral.png', data: png },
  ])
  let size = 600 * 1024 * 1024
  const service = importer(profile, { 'node:fs': { ...fs, lstatSync(input) {
    const stat = fs.lstatSync(input)
    return input === file ? Object.assign(Object.create(stat), { size }) : stat
  } } })
  t.after(() => service.dispose())
  assert.equal((await service.stage(file, 1)).candidates[0].errors.length, 0)
  size = 2 * 1024 * 1024 * 1024 + 1
  await assert.rejects(service.stage(file, 1), /ZIP 文件超过 2 GiB/)
})

test('folder resource accounting still rejects totals over 2 GiB and cleans staging', async t => {
  const { source, profile } = fixture(t)
  for (let i = 0; i < 9; i++) fs.writeFileSync(path.join(source, `resource-${i}.bin`), 'data')
  // Virtualize file sizes to test aggregate accounting without writing gigabytes.
  const sized = (input, stat) => String(input).endsWith('.bin')
    ? Object.assign(Object.create(stat), { size: 256 * 1024 * 1024 }) : stat
  const service = importer(profile, { 'node:fs': { ...fs, promises: {
    ...fs.promises,
    lstat: async input => sized(input, await fs.promises.lstat(input)),
    stat: async input => sized(input, await fs.promises.stat(input)),
  } } })
  t.after(() => service.dispose())
  await assert.rejects(service.stage(source, 1), /资源合计超过 2 GiB/)
  assert.deepEqual(fs.readdirSync(path.join(profile, '.model-import')), [])
})

test('folder import stages data, previews safely, drops missing optional images and preserves source', async t => {
  const { source, profile } = fixture(t), service = importer(profile)
  t.after(() => service.dispose())
  fs.writeFileSync(path.join(source, 'untrusted.js'), 'throw new Error("never copied")')
  const original = fs.readFileSync(path.join(source, 'deskpet-images.json'), 'utf8')
  const preview = await service.stage(source, 7), candidate = preview.candidates[0]
  assert.equal(candidate.errors.length, 0)
  assert.equal(candidate.warnings.length, 1)
  assert.ok(service.previewFile(preview.token, 'neutral.png'))
  assert.equal(service.previewFile(preview.token, '../source/neutral.png'), null)
  assert.equal(service.previewFile(preview.token, 'untrusted.js'), null)
  await assert.rejects(service.install(preview.token, candidate.id, 8, false), /过期/)
  const url = await service.install(preview.token, candidate.id, 7, false)
  const destination = path.join(profile, 'models', decodeURIComponent(url.replace('uta://models/', '')))
  assert.deepEqual(JSON.parse(fs.readFileSync(destination, 'utf8')).images, { neutral: 'neutral.png' })
  assert.equal(fs.existsSync(path.join(path.dirname(destination), 'untrusted.js')), false)
  assert.equal(fs.readFileSync(path.join(source, 'deskpet-images.json'), 'utf8'), original)
  assert.equal(service.previewFile(preview.token, 'neutral.png'), null)
})

test('nested ZIP is recognized; traversal, duplicate names and links are rejected without escaping', async t => {
  const { root, profile } = fixture(t), service = importer(profile)
  t.after(() => service.dispose())
  const file = path.join(root, 'pack.zip')
  zip(file, [{ name: 'outer/deskpet-images.json', data: JSON.stringify({ images: { neutral: 'neutral.png' } }) }, { name: 'outer/neutral.png', data: png }])
  const preview = await service.stage(file, 1)
  assert.equal(preview.candidates[0].errors.length, 0)
  assert.ok(service.previewFile(preview.token, 'outer/neutral.png'))
  for (const entries of [
    [{ name: '../escaped.png', data: png }],
    [{ name: 'same.png', data: png }, { name: 'SAME.png', data: png }],
    [{ name: 'link.png', data: 'outside', attributes: 0o120777 << 16 }],
  ]) { zip(file, entries); await assert.rejects(service.stage(file, 1)) }
  assert.equal(fs.existsSync(path.join(profile, 'escaped.png')), false)
})

test('invalid required Live2D assets cannot be installed; optional missing motions warn', async t => {
  const { source, profile } = fixture(t), service = importer(profile)
  t.after(() => service.dispose())
  fs.rmSync(path.join(source, 'deskpet-images.json'))
  const manifest = path.join(source, 'pet.model3.json')
  fs.writeFileSync(manifest, JSON.stringify({ FileReferences: { Moc: 'pet.moc3', Textures: ['neutral.png'], Motions: { idle: [{ File: 'missing.motion3.json' }] } } }))
  const invalid = await service.stage(source, 1)
  assert.ok(invalid.candidates[0].errors.length)
  await assert.rejects(service.install(invalid.token, invalid.candidates[0].id, 1, false))
  fs.writeFileSync(path.join(source, 'pet.moc3'), Buffer.from('MOC3fixture'))
  const valid = await service.stage(source, 1)
  assert.equal(valid.candidates[0].errors.length, 0)
  assert.equal(valid.candidates[0].warnings.length, 1)
  service.cancel(valid.token, 1)
  assert.equal(service.previewFile(valid.token, 'pet.moc3'), null)
})

test('replace requires confirmation; a failed final rename restores the original model', async t => {
  const { source, profile } = fixture(t)
  let fail = false
  const service = importer(profile, { 'node:fs': { ...fs, renameSync(from, to) {
    if (fail && path.basename(from) === 'prepared') throw Error('injected failure')
    fs.renameSync(from, to)
  } } })
  t.after(() => service.dispose())
  let preview = await service.stage(source, 1)
  const url = await service.install(preview.token, preview.candidates[0].id, 1, false)
  const destination = path.join(profile, 'models', url.replace('uta://models/', ''))
  const original = fs.readFileSync(path.join(path.dirname(destination), 'neutral.png'))
  fs.writeFileSync(path.join(source, 'neutral.png'), Buffer.concat([png, Buffer.from('changed')]))
  preview = await service.stage(source, 1)
  assert.equal(preview.candidates[0].replaces, true)
  await assert.rejects(service.install(preview.token, preview.candidates[0].id, 1, false), /确认替换/)
  fail = true
  await assert.rejects(service.install(preview.token, preview.candidates[0].id, 1, true), /injected/)
  assert.deepEqual(fs.readFileSync(path.join(path.dirname(destination), 'neutral.png')), original)
  assert.equal(fs.existsSync(path.join(profile, '.model-import-journal.json')), false)
})

test('a first install with a transient rename failure can retry without restarting', async t => {
  const { source, profile } = fixture(t)
  let locked = true
  const service = importer(profile, { 'node:fs': { ...fs, renameSync(from, to) {
    if (locked && path.basename(from) === 'prepared') throw Error('injected sharing violation')
    fs.renameSync(from, to)
  } } })
  t.after(() => service.dispose())
  const { token, candidates: [candidate] } = await service.stage(source, 1)
  await assert.rejects(service.install(token, candidate.id, 1, false), /sharing violation/)
  locked = false
  assert.match(await service.install(token, candidate.id, 1, false), /^uta:\/\/models\//)
})

test('models in the same VTS folder retain separate labels and installations', async t => {
  const { source, profile } = fixture(t), service = importer(profile)
  t.after(() => service.dispose())
  fs.rmSync(path.join(source, 'deskpet-images.json'))
  fs.writeFileSync(path.join(source, 'pet.moc3'), 'MOC3fixture')
  fs.writeFileSync(path.join(source, 'shared.vtube.json'), '{}')
  for (const name of ['ModelA', 'ModelB']) {
    fs.writeFileSync(path.join(source, `${name}.model3.json`), JSON.stringify({ FileReferences: { Moc: 'pet.moc3', Textures: ['neutral.png'] } }))
  }
  const first = await service.stage(source, 1)
  assert.deepEqual(Array.from(first.candidates, candidate => candidate.name), ['ModelA', 'ModelB'])
  const urlA = await service.install(first.token, first.candidates[0].id, 1, false)
  const second = await service.stage(source, 1)
  assert.equal(second.candidates[0].replaces, true)
  assert.equal(second.candidates[1].replaces, false)
  const urlB = await service.install(second.token, second.candidates[1].id, 1, false)
  for (const url of [urlA, urlB]) {
    const installed = path.join(profile, 'models', url.replace('uta://models/', ''))
    assert.ok(fs.existsSync(installed))
  }
  assert.notEqual(path.dirname(urlA), path.dirname(urlB))
})

test('startup restores an interrupted replacement and malformed journal never disables the pet', t => {
  const { profile } = fixture(t)
  let service = importer(profile)
  service.dispose()
  const name = 'imported-character-1234', backup = path.join(profile, '.model-import-backups', name)
  fs.mkdirSync(backup)
  fs.writeFileSync(path.join(backup, 'old.json'), '{}')
  fs.writeFileSync(path.join(profile, '.model-import-journal.json'), JSON.stringify({ destination: name }))
  service = importer(profile)
  assert.equal(fs.existsSync(path.join(profile, 'models', name, 'old.json')), true)
  service.dispose()
  fs.writeFileSync(path.join(profile, '.model-import-journal.json'), '{bad')
  assert.doesNotThrow(() => { service = importer(profile) })
  service.dispose()
})

for (const broken of [false, true]) test(`replace preserves the installed adapter when the source adapter is ${broken ? 'invalid' : 'absent'}`, async t => {
  const { source, profile } = fixture(t), service = importer(profile)
  t.after(() => service.dispose())
  fs.rmSync(path.join(source, 'deskpet-images.json'))
  fs.writeFileSync(path.join(source, 'pet.model3.json'), JSON.stringify({
    FileReferences: { Moc: 'pet.moc3', Textures: ['neutral.png'] },
  }))
  fs.writeFileSync(path.join(source, 'pet.moc3'), Buffer.from('MOC3fixture'))
  let preview = await service.stage(source, 1)
  const first = preview.candidates[0]
  assert.equal(first.errors.length, 0)
  const url = await service.install(preview.token, first.id, 1, false)
  const destination = path.dirname(path.join(profile, 'models', decodeURIComponent(url.replace('uta://models/', ''))))
  const adapterFile = path.join(destination, 'deskpet-adapter.json')
  fs.writeFileSync(adapterFile, JSON.stringify({
    version: 1,
    name: '大肥鱼',
    idleMotions: ['IDLE'],
    lipSync: { mouthOpenParam: 'ParamMouthOpenY', gain: 1 },
    baseParameters: { Divider1: 0 },
    hiddenParts: [],
    hiddenDrawables: ['ArtMesh246', 'ArtMesh682'],
    emotions: {},
    animations: {},
    controls: {},
  }))

  if (broken) fs.writeFileSync(path.join(source, 'deskpet-adapter.json'), '{invalid')
  preview = await service.stage(source, 1)
  const second = preview.candidates[0]
  assert.equal(second.replaces, true)
  if (broken) assert.ok(second.warnings.some(warning => warning.includes('deskpet-adapter.json')))
  await service.install(preview.token, second.id, 1, true)
  const preserved = JSON.parse(fs.readFileSync(adapterFile, 'utf8'))
  assert.deepEqual(preserved.hiddenDrawables, ['ArtMesh246', 'ArtMesh682'])
  assert.deepEqual(preserved.baseParameters, { Divider1: 0 })
})

test('a Live2D manifest cannot expand a small model into an unbounded reference list', async t => {
  const { source, profile } = fixture(t)
  let reads = 0
  const countedFs = Object.create(fs)
  countedFs.readFileSync = (file, ...args) => {
    if (path.basename(file) === 'move.motion3.json') reads++
    return fs.readFileSync(file, ...args)
  }
  const service = importer(profile, { 'node:fs': countedFs })
  t.after(() => service.dispose())
  fs.rmSync(path.join(source, 'deskpet-images.json'))
  fs.writeFileSync(path.join(source, 'pet.moc3'), 'MOC3fixture')
  fs.writeFileSync(path.join(source, 'move.motion3.json'), '{}')
  const manifest = path.join(source, 'pet.model3.json')
  const motion = { File: 'move.motion3.json' }
  const write = count => fs.writeFileSync(manifest, JSON.stringify({
    FileReferences: { Moc: 'pet.moc3', Textures: ['neutral.png'], Motions: { Idle: Array(count).fill(motion) } },
  }))
  write(2000)
  const allowed = await service.stage(source, 1)
  assert.equal(allowed.candidates[0].errors.length, 0)
  assert.match(allowed.candidates[0].summary, /2000 个动作/)
  assert.equal(reads, 1)
  write(4097)
  const over = await service.stage(source, 1)
  assert.match(over.candidates[0].errors.join(' '), /资源引用超过 4096/)
  await assert.rejects(service.install(over.token, over.candidates[0].id, 1, false), /没有通过检查/)
})

test('VTS sidecars are installed and registered with a generated adapter', async t => {
  const { source, profile } = fixture(t), service = importer(profile)
  t.after(() => service.dispose())
  fs.rmSync(path.join(source, 'deskpet-images.json'))
  fs.writeFileSync(path.join(source, 'pet.model3.json'), JSON.stringify({
    FileReferences: { Moc: 'pet.moc3', Textures: ['neutral.png'] },
  }))
  fs.writeFileSync(path.join(source, 'pet.moc3'), Buffer.from('MOC3fixture'))
  fs.mkdirSync(path.join(source, 'Exp3'))
  fs.mkdirSync(path.join(source, 'Animation'))
  fs.writeFileSync(path.join(source, 'Exp3', '脸红.exp3.json'), JSON.stringify({
    Type: 'Live2D Expression',
    Parameters: [{ Id: 'key7', Value: 1, Blend: 'Add' }],
  }))
  fs.writeFileSync(path.join(source, 'Animation', 'IDLE.motion3.json'), JSON.stringify({}))
  fs.writeFileSync(path.join(source, 'pet.vtube.json'), JSON.stringify({
    Hotkeys: [{ Name: '脸红', Action: 'ToggleExpression', File: '脸红.exp3.json' }],
    ParameterSettings: [
      { Input: 'FaceAngleX', OutputLive2D: 'AngleX', OutputRangeLower: -30, OutputRangeUpper: 30 },
      { Input: 'FaceAngleY', OutputLive2D: 'AngleY', OutputRangeLower: -30, OutputRangeUpper: 30 },
      { Input: 'EyeRightX', OutputLive2D: 'ParamEyeBallX', OutputRangeLower: 1, OutputRangeUpper: -1 },
      { Input: 'FaceAngleX', OutputLive2D: 'PositionX', OutputRangeLower: -30, OutputRangeUpper: 30 },
      { Input: 'MouthOpen', OutputLive2D: 'ParamMouthOpenY' },
    ],
  }))

  const preview = await service.stage(source, 1), candidate = preview.candidates[0]
  assert.equal(candidate.errors.length, 0)
  assert.match(candidate.summary, /VTS 表情 1/)
  const url = await service.install(preview.token, candidate.id, 1, false)
  const modelFile = path.join(profile, 'models', decodeURIComponent(url.replace('uta://models/', '')))
  const destination = path.dirname(modelFile)
  const doc = JSON.parse(fs.readFileSync(modelFile, 'utf8'))
  assert.deepEqual(doc.FileReferences.Expressions, [{ Name: '脸红', File: 'Exp3/脸红.exp3.json' }])
  assert.equal(doc.FileReferences.Motions.IDLE[0].File, 'Animation/IDLE.motion3.json')
  assert.ok(fs.existsSync(path.join(destination, 'Exp3', '脸红.exp3.json')))
  assert.ok(fs.existsSync(path.join(destination, 'Animation', 'IDLE.motion3.json')))
  assert.ok(fs.existsSync(path.join(destination, 'pet.vtube.json')))
  const adapter = JSON.parse(fs.readFileSync(path.join(destination, 'deskpet-adapter.json'), 'utf8'))
  assert.equal(adapter.focus, undefined)
  assert.equal(adapter.generatedFocus.headXParam, 'AngleX')
  assert.equal(adapter.generatedFocus.eyeXParam, 'ParamEyeBallX')
  assert.equal(adapter.generatedFocus.invertEyeX, true)
  assert.deepEqual(adapter.idleMotions, ['IDLE'])
  assert.equal(adapter.lipSync.mouthOpenParam, 'ParamMouthOpenY')
  assert.ok(adapter.controls['脸红'])
  assert.equal(adapter.controls['脸红'].category, 'face_effect')
})

test('nested multi-character packages isolate sidecars and do not leak child model motions into parent', async t => {
  const { source, profile } = fixture(t), service = importer(profile)
  t.after(() => service.dispose())
  fs.rmSync(path.join(source, 'deskpet-images.json'))
  fs.writeFileSync(path.join(source, 'parent.model3.json'), JSON.stringify({
    FileReferences: { Moc: 'parent.moc3', Textures: ['neutral.png'] },
  }))
  fs.writeFileSync(path.join(source, 'parent.moc3'), Buffer.from('MOC3fixture'))
  const childDir = path.join(source, 'child')
  fs.mkdirSync(childDir)
  fs.writeFileSync(path.join(childDir, 'child.model3.json'), JSON.stringify({
    FileReferences: { Moc: 'child.moc3', Textures: ['neutral.png'] },
  }))
  fs.writeFileSync(path.join(childDir, 'child.moc3'), Buffer.from('MOC3fixture'))
  fs.writeFileSync(path.join(childDir, 'B-only.motion3.json'), JSON.stringify({}))

  const preview = await service.stage(source, 1)
  assert.equal(preview.candidates.length, 2)
  const parentCandidate = preview.candidates.find(c => c.name === 'parent')
  assert.ok(parentCandidate)
  const url = await service.install(preview.token, parentCandidate.id, 1, false)
  const modelFile = path.join(profile, 'models', decodeURIComponent(url.replace('uta://models/', '')))
  const doc = JSON.parse(fs.readFileSync(modelFile, 'utf8'))
  const motions = Object.values(doc.FileReferences?.Motions ?? {}).flat().map(item => item?.File)
  assert.equal(motions.some(m => String(m).includes('B-only')), false, 'Child motion must not leak into parent model')
})


test('DaFish VTS model import generates complete template with multi-stage controls and emotions', async t => {
  const { source, profile } = fixture(t), service = importer(profile)
  t.after(() => service.dispose())
  fs.rmSync(path.join(source, 'deskpet-images.json'))
  fs.writeFileSync(path.join(source, '大肥鱼.model3.json'), JSON.stringify({
    FileReferences: { Moc: '大肥鱼.moc3', Textures: ['neutral.png'] },
  }))
  fs.writeFileSync(path.join(source, '大肥鱼.moc3'), Buffer.from('MOC3fixture'))
  fs.mkdirSync(path.join(source, 'Exp3'))
  fs.mkdirSync(path.join(source, 'Animation'))
  fs.writeFileSync(path.join(source, 'Exp3', '体型1.exp3.json'), JSON.stringify({}))
  fs.writeFileSync(path.join(source, 'Exp3', '裙子切换.exp3.json'), JSON.stringify({}))
  fs.writeFileSync(path.join(source, 'Animation', 'IDLE.motion3.json'), JSON.stringify({}))
  fs.writeFileSync(path.join(source, 'Animation', 'tuobu.motion3.json'), JSON.stringify({}))
  fs.writeFileSync(path.join(source, '大肥鱼.vtube.json'), JSON.stringify({
    Hotkeys: [
      { Name: '体型1', Action: 'ToggleExpression', File: '体型1.exp3.json' },
      { Name: '裙长切换', Action: 'ToggleExpression', File: '裙子切换.exp3.json' },
      { Name: '脱捕', Action: 'TriggerAnimation', File: 'tuobu.motion3.json' },
    ],
    ParameterSettings: [
      { Input: 'FaceAngleX', OutputLive2D: 'AngleX', OutputRangeLower: -30, OutputRangeUpper: 30 },
      { Input: 'MouthOpen', OutputLive2D: 'ParamMouthOpenY' },
    ],
  }))

  const preview = await service.stage(source, 1)
  const candidate = preview.candidates[0]
  assert.equal(candidate.errors.length, 0)
  const url = await service.install(preview.token, candidate.id, 1, false)
  const modelFile = path.join(profile, 'models', decodeURIComponent(url.replace('uta://models/', '')))
  const adapter = JSON.parse(fs.readFileSync(path.join(path.dirname(modelFile), 'deskpet-adapter.json'), 'utf8'))

  assert.ok(adapter.controls['大小变'])
  assert.equal(adapter.controls['大小变'].stages.length, 3)
  assert.ok(adapter.controls['狗尾草'])
  assert.ok(adapter.controls['抚胸'])
  assert.ok(adapter.emotions.happy)
  assert.equal(adapter.emotions.happy.parameters.key4, 1)
  assert.equal(adapter.animations.cheer.motion.group, '脱捕')
})
