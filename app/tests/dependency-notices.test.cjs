const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function fixture(t, { version = '1.0.0', license = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-notices-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'scripts'))
  fs.copyFileSync(path.join(__dirname, '../scripts/dependency-notices.mjs'), path.join(root, 'scripts/dependency-notices.mjs'))
  const dir = path.join(root, 'node_modules/sample')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'sample', version }))
  if (license) fs.writeFileSync(path.join(dir, 'LICENSE-MIT.txt'), 'Copyright Sample Author\nOriginal permission text')
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages: {
    '': { license: 'MIT' },
    'node_modules/sample': { version: '1.0.0', license: 'MIT' },
    'node_modules/dev-only': { version: '2.0.0', dev: true },
  } }))
  return { root, run: () => spawnSync(process.execPath, [path.join(root, 'scripts/dependency-notices.mjs')], { encoding: 'utf8', windowsHide: true }) }
}

test('dependency notices retain original text and omit development-only packages', t => {
  const f = fixture(t), result = f.run()
  assert.equal(result.status, 0, result.stderr)
  const text = fs.readFileSync(path.join(f.root, 'build/THIRD-PARTY-NOTICES.txt'), 'utf8')
  assert.ok(text.includes('sample@1.0.0'))
  assert.ok(text.includes('Copyright Sample Author\nOriginal permission text'))
  assert.ok(!text.includes('dev-only'))
})

test('a dependency without license text cannot produce a release notice file', t => {
  const f = fixture(t, { license: false }), result = f.run()
  assert.notEqual(result.status, 0)
  assert.ok(result.stderr.includes('Missing license text: sample@1.0.0'))
  assert.equal(fs.existsSync(path.join(f.root, 'build/THIRD-PARTY-NOTICES.txt')), false)
})

test('dependency notices reject an installed version different from the lockfile', t => {
  const f = fixture(t, { version: '2.0.0' }), result = f.run()
  assert.notEqual(result.status, 0)
  assert.ok(result.stderr.includes('Dependency differs from lockfile'))
})
