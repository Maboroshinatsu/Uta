import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export async function publishRelease({ directory, tag, repository, token, fetcher = fetch, run }) {
  if (!/^v\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(tag) ||
      !/^[\w.-]+\/[\w.-]+$/.test(repository) || !token) {
    throw Error('A complete version tag, repository and GitHub token are required.')
  }
  const version = tag.slice(1)
  const files = [`Uta-${version}-win-x64.zip`, `Uta-Setup-${version}.exe`]
  files.push(...files.map(file => `${file}.manifest.json`), 'SHA256SUMS.txt')
  const local = []
  for (const name of files) {
    const file = path.resolve(directory, name)
    const hash = createHash('sha256')
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
    local.push({ name, file, size: fs.statSync(file).size, digest: `sha256:${hash.digest('hex')}` })
  }
  const command = run ?? (args => execFileSync('gh', args, {
    cwd: directory, stdio: 'inherit', env: { ...process.env, GH_TOKEN: token, GH_REPO: repository },
  }))
  const base = `https://api.github.com/repos/${repository}/releases`
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Uta-release' }
  const response = await fetcher(`${base}/tags/${encodeURIComponent(tag)}`, { headers })
  let release
  if (response.status === 404) {
    await response.body?.cancel()
    // The by-tag endpoint only returns published releases. Include authenticated
    // draft listings before deciding that a new release is needed.
    for (let page = 1; ; page++) {
      const listed = await fetcher(`${base}?per_page=100&page=${page}`, { headers })
      if (!listed.ok) throw Error(`Listing release drafts failed: HTTP ${listed.status}`)
      const releases = await listed.json()
      if (!Array.isArray(releases)) throw Error('Unexpected GitHub release listing.')
      release = releases.find(item => item.tag_name === tag)
      if (release || releases.length < 100) break
    }
  } else {
    if (!response.ok) {
      await response.body?.cancel()
      throw Error(`Looking up the release failed: HTTP ${response.status}`)
    }
    release = await response.json()
  }
  const prerelease = version.includes('-')
  if (!release) {
    await command(['release', 'create', tag, ...local.map(asset => asset.file),
      '--verify-tag', '--title', `Uta ${tag}`, '--generate-notes',
      ...(prerelease ? ['--prerelease', '--latest=false'] : [])])
    return { created: true, uploaded: local.length, skipped: 0 }
  }
  if (release.tag_name !== tag || !Array.isArray(release.assets)) throw Error('Unexpected GitHub release response.')
  const missing = []
  for (const asset of local) {
    const existing = release.assets.find(item => item.name === asset.name)
    if (!existing) missing.push(asset)
    else if (existing.size !== asset.size || existing.digest !== asset.digest || existing.state !== 'uploaded') {
      throw Error(`Release asset already exists with different or unverified content: ${asset.name}`)
    }
  }
  if (release.immutable && missing.length) throw Error('Cannot add assets to an immutable release.')
  if (missing.length) await command(['release', 'upload', tag, ...missing.map(asset => asset.file)])
  if (release.draft || release.prerelease !== prerelease) {
    await command(['release', 'edit', tag, '--draft=false', `--prerelease=${prerelease}`,
      ...(prerelease ? ['--latest=false'] : [])])
  }
  return { created: false, uploaded: missing.length, skipped: local.length - missing.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await publishRelease({
    directory: path.resolve(process.env.RELEASE_DIRECTORY || 'packages'),
    tag: process.env.RELEASE_TAG,
    repository: process.env.GH_REPO,
    token: process.env.GH_TOKEN,
  })
  console.log(`Release ready: ${process.env.RELEASE_TAG}; uploaded=${result.uploaded}, unchanged=${result.skipped}`)
}
