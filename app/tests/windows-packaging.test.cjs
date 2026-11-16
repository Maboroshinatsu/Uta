const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { execFileSync, spawnSync } = require('node:child_process')

function fixture(t, mutate = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-packaging-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const app = path.join(root, 'app')
  const write = (file, text) => {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
  }
  write('.gitignore', 'node_modules/\nout/\nbuild/\nrelease/\n')
  write('README.md', 'source fixture')
  write('app/package.json', JSON.stringify({ name: 'uta', version: '0.0.1-beta.1' }))
  write('app/package-lock.json', JSON.stringify({ version: '0.0.1-beta.1', packages: { '': { version: '0.0.1-beta.1' } } }))
  for (const name of ['package-windows.mjs', 'dependency-notices.mjs', 'verify-release-version.mjs']) {
    write(`app/scripts/${name}`, fs.readFileSync(path.join(__dirname, '../scripts', name)))
  }
  write('app/node_modules/electron/install.js', '')
  write('app/node_modules/electron-vite/bin/electron-vite.js', `require('node:fs').mkdirSync('out', {recursive:true})`)
  write('app/node_modules/electron-builder/cli.js', `
    const fs = require('node:fs')
    fs.mkdirSync('release', {recursive:true})
    fs.writeFileSync('release/Uta-0.0.1-beta.1-win-x64.zip', 'zip fixture')
    if (process.argv.includes('nsis')) fs.writeFileSync('release/Uta-Setup-0.0.1-beta.1.exe', 'installer fixture')
    ${mutate ? "fs.appendFileSync('../README.md', 'changed during packaging')" : ''}
  `)
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  git('init', '-q')
  git('add', '.')
  git('-c', 'user.name=Packaging test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture')
  const env = { ...process.env }
  delete env.UTA_SHARE_PACKAGE
  return { root, app, git, run: (...args) => spawnSync(process.execPath, ['scripts/package-windows.mjs', ...args], {
    cwd: app, env, encoding: 'utf8', windowsHide: true,
  }) }
}

function releaseVersion(h, tag) {
  return spawnSync(process.execPath, ['scripts/verify-release-version.mjs'], {
    cwd: h.app, env: { ...process.env, GITHUB_REF_NAME: tag }, encoding: 'utf8', windowsHide: true,
  })
}

test('release tags accept matching npm lockfiles with an empty root package key', t => {
  const result = releaseVersion(fixture(t), 'v0.0.1-beta.1')
  assert.equal(result.status, 0, result.stderr)
})

test('release tags must match the complete application version', t => {
  const result = releaseVersion(fixture(t), 'v0.0.1')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /versions must match/)
  assert.match(result.stderr, /Expected tag v0\.0\.1-beta\.1; received v0\.0\.1/)
})

for (const rootPackage of [false, true]) {
  test(`release tags reject a mismatched lockfile ${rootPackage ? 'root package' : 'top-level'} version`, t => {
    const h = fixture(t)
    const file = path.join(h.app, 'package-lock.json')
    const lock = JSON.parse(fs.readFileSync(file))
    if (rootPackage) lock.packages[''].version = '0.0.0'
    else lock.version = '0.0.0'
    fs.writeFileSync(file, JSON.stringify(lock))
    const result = releaseVersion(h, 'v0.0.1-beta.1')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /versions must match/)
  })
}

for (const zipOnly of [false, true]) {
  test(`Windows packaging emits verified manifests for ${zipOnly ? 'ZIP only' : 'ZIP and installer'} from one clean commit`, t => {
    const h = fixture(t)
    const result = h.run(...(zipOnly ? ['--zip-only'] : []))
    assert.equal(result.status, 0, result.stderr)
    const release = path.join(h.app, 'release')
    const files = fs.readdirSync(release).filter(name => /\.(zip|exe)$/.test(name))
    assert.equal(files.length, zipOnly ? 1 : 2)
    const info = JSON.parse(fs.readFileSync(path.join(h.app, 'out/build-info.json')))
    assert.equal(info.commit, h.git('rev-parse', 'HEAD'))
    assert.equal(info.dirty, false)
    const sums = fs.readFileSync(path.join(release, 'SHA256SUMS.txt'), 'utf8').trim().split('\n')
    assert.equal(sums.length, files.length)
    for (const file of files) {
      const manifest = JSON.parse(fs.readFileSync(path.join(release, `${file}.manifest.json`)))
      const sha256 = createHash('sha256').update(fs.readFileSync(path.join(release, file))).digest('hex')
      assert.deepEqual(manifest, { ...info, archive: file, sha256 })
      assert.ok(sums.includes(`${sha256}  ${file}`))
    }
    assert.equal(h.git('status', '--porcelain'), '')
  })
}

test('dirty source is rejected before any Windows package is built', t => {
  const h = fixture(t)
  fs.appendFileSync(path.join(h.root, 'README.md'), 'uncommitted')
  const result = h.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Commit or isolate/)
  assert.equal(fs.existsSync(path.join(h.app, 'release')), false)
})

test('source changes during packaging cannot receive release manifests', t => {
  const h = fixture(t, true)
  const result = h.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Source changed during packaging/)
  assert.deepEqual(fs.readdirSync(path.join(h.app, 'release')).filter(name => name.endsWith('.manifest.json')), [])
  assert.equal(fs.existsSync(path.join(h.app, 'release/SHA256SUMS.txt')), false)
})

test('unknown packaging flags fail without producing packages', t => {
  const h = fixture(t)
  const result = h.run('--zip-onyl')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Usage:/)
  assert.equal(fs.existsSync(path.join(h.app, 'release')), false)
})
