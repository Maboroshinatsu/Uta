const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')

const publisher = import(pathToFileURL(path.join(__dirname, '../../.github/scripts/publish-release.mjs')).href)
const tag = 'v0.3.0-beta.1'

function fixture(t, release = null) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-publish-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const files = ['Uta-0.3.0-beta.1-win-x64.zip', 'Uta-Setup-0.3.0-beta.1.exe']
  files.push(...files.map(file => file + '.manifest.json'), 'SHA256SUMS.txt')
  for (const file of files) fs.writeFileSync(path.join(directory, file), `fixture ${file}`)
  const state = { release, calls: [], lookupStatus: null, listStatus: 200, olderDraft: false, failUpload: false }
  const asset = file => {
    const bytes = fs.readFileSync(file)
    return { name: path.basename(file), size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, state: 'uploaded' }
  }
  const fetcher = async url => {
    const parsed = new URL(url)
    if (parsed.searchParams.has('page')) {
      const page = parsed.searchParams.get('page')
      const releases = state.olderDraft && page === '1'
        ? Array.from({ length: 100 }, (_, i) => ({ tag_name: `v9.0.${i}` }))
        : (state.release ? [state.release] : [])
      return new Response(JSON.stringify(releases), { status: state.listStatus })
    }
    return new Response(JSON.stringify(state.release), { status: state.lookupStatus ?? (state.release && !state.release.draft ? 200 : 404) })
  }
  const run = async args => {
    state.calls.push(args)
    if (args[1] === 'create') {
      assert.equal(state.release, null)
      state.release = { tag_name: tag, name: `Uta ${tag}`, body: 'generated notes', draft: false, prerelease: args.includes('--prerelease'), assets: [] }
      state.release.assets.push(...args.slice(3).filter(file => fs.existsSync(file)).map(asset))
    } else if (args[1] === 'upload') {
      if (state.failUpload) {
        state.release.assets.push(asset(args[3]))
        throw Error('Upload interrupted')
      }
      for (const file of args.slice(3)) {
        assert.equal(state.release.assets.some(item => item.name === path.basename(file)), false, 'must not overwrite assets')
        state.release.assets.push(asset(file))
      }
    } else if (args[1] === 'edit') {
      state.release.draft = false
      state.release.prerelease = args.includes('--prerelease=true')
    } else throw Error('Unexpected GitHub command')
  }
  return { directory, files, state, asset, publish: async () => (await publisher).publishRelease({
    directory, tag, repository: 'example/Uta', token: 'test-token', fetcher, run,
  }) }
}

function existing(overrides = {}) {
  return { tag_name: tag, name: 'Maintainer title', body: 'Maintainer notes', draft: false, prerelease: false, assets: [], ...overrides }
}

test('a missing release is created as a prerelease with all five verified files', async t => {
  const h = fixture(t)
  const result = await h.publish()
  assert.deepEqual(result, { created: true, uploaded: 5, skipped: 0 })
  assert.equal(h.state.release.prerelease, true)
  assert.equal(h.state.release.assets.length, 5)
  assert.ok(h.state.calls[0].includes('--verify-tag'))
  assert.ok(h.state.calls[0].includes('--latest=false'))
})

test('an existing release receives missing files without changing its title or notes', async t => {
  const h = fixture(t, existing())
  await h.publish()
  assert.equal(h.state.release.assets.length, 5)
  assert.equal(h.state.release.prerelease, true)
  assert.equal(h.state.release.name, 'Maintainer title')
  assert.equal(h.state.release.body, 'Maintainer notes')
  assert.equal(h.state.calls.some(args => args[1] === 'create'), false)
})

test('an interrupted upload resumes with identical existing assets and publishes a draft last', async t => {
  const h = fixture(t, existing({ draft: true }))
  h.state.failUpload = true
  await assert.rejects(h.publish(), /Upload interrupted/)
  assert.equal(h.state.release.draft, true)
  assert.equal(h.state.release.assets.length, 1)
  h.state.failUpload = false
  const result = await h.publish()
  assert.deepEqual(result, { created: false, uploaded: 4, skipped: 1 })
  assert.equal(h.state.release.assets.length, 5)
  assert.equal(h.state.release.draft, false)
  const repeated = await h.publish()
  assert.deepEqual(repeated, { created: false, uploaded: 0, skipped: 5 })
})

test('a conflicting same-name asset stops all uploads and metadata changes', async t => {
  const h = fixture(t, existing())
  h.state.release.assets.push({ ...h.asset(path.join(h.directory, h.files[1])), digest: 'sha256:conflicting' })
  await assert.rejects(h.publish(), /different or unverified content/)
  assert.deepEqual(h.state.calls, [])
})

test('a GitHub lookup error cannot be mistaken for a missing release', async t => {
  const h = fixture(t)
  h.state.lookupStatus = 503
  await assert.rejects(h.publish(), /HTTP 503/)
  assert.deepEqual(h.state.calls, [])
})

test('draft lookup includes later listing pages instead of creating a duplicate release', async t => {
  const h = fixture(t, existing({ draft: true }))
  h.state.olderDraft = true
  await h.publish()
  assert.equal(h.state.release.assets.length, 5)
  assert.equal(h.state.release.draft, false)
  assert.equal(h.state.calls.some(args => args[1] === 'create'), false)
})

test('a failed draft listing cannot create a duplicate release', async t => {
  const h = fixture(t, existing({ draft: true }))
  h.state.listStatus = 503
  await assert.rejects(h.publish(), /Listing release drafts failed: HTTP 503/)
  assert.deepEqual(h.state.calls, [])
})

test('a missing local package cannot create or alter a release', async t => {
  const h = fixture(t)
  fs.unlinkSync(path.join(h.directory, h.files[1]))
  await assert.rejects(h.publish(), /ENOENT/)
  assert.deepEqual(h.state.calls, [])
})

test('an immutable release cannot accept missing attachments', async t => {
  const h = fixture(t, existing({ immutable: true }))
  await assert.rejects(h.publish(), /immutable release/)
  assert.deepEqual(h.state.calls, [])
})
