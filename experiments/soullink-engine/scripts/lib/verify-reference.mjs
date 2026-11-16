import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ENGINE_SNAPSHOT, REFERENCE_MANIFEST, REFERENCE_ROOT } from './paths.mjs'

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertInside(root, candidate, label) {
  const relative = path.relative(root, candidate)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the reference snapshot: ${candidate}`)
  }
}

function walkFiles(root) {
  const result = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) result.push(absolute)
    }
  }
  visit(root)
  return result.sort()
}

export function verifyReferenceInputs() {
  if (!fs.existsSync(REFERENCE_MANIFEST)) {
    throw new Error(`reference manifest is missing: ${REFERENCE_MANIFEST}`)
  }
  const manifest = JSON.parse(fs.readFileSync(REFERENCE_MANIFEST, 'utf8'))
  if (!isRecord(manifest) || typeof manifest.sourceHead !== 'string' || !Array.isArray(manifest.files)) {
    throw new Error('reference manifest is malformed')
  }
  const snapshotRoot = path.resolve(REFERENCE_ROOT, 'soullink')
  assertInside(REFERENCE_ROOT, snapshotRoot, 'snapshot root')

  const declared = new Map()
  for (const entry of manifest.files) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.bytes !== 'number' || typeof entry.sha256 !== 'string') {
      throw new Error('reference manifest has a malformed file entry')
    }
    if (entry.path.split('/').includes('..') || path.isAbsolute(entry.path)) {
      throw new Error(`reference manifest path escapes the snapshot: ${entry.path}`)
    }
    if (declared.has(entry.path)) throw new Error(`duplicate reference manifest entry: ${entry.path}`)
    const absolute = path.resolve(snapshotRoot, entry.path)
    assertInside(snapshotRoot, absolute, entry.path)
    if (!fs.existsSync(absolute)) throw new Error(`missing reference file: ${entry.path}`)
    const data = fs.readFileSync(absolute)
    if (data.length !== entry.bytes) throw new Error(`reference size mismatch: ${entry.path}`)
    const digest = sha256(data)
    if (digest !== entry.sha256) throw new Error(`reference sha256 mismatch: ${entry.path}`)
    declared.set(entry.path, { bytes: entry.bytes, sha256: digest })
  }

  const actual = walkFiles(snapshotRoot)
    .map((absolute) => path.relative(snapshotRoot, absolute).replaceAll('\\', '/'))
  const extra = actual.filter((relative) => !declared.has(relative))
  const missing = [...declared.keys()].filter((relative) => !actual.includes(relative))
  if (extra.length > 0) throw new Error(`undeclared files in reference snapshot: ${extra.join(', ')}`)
  if (missing.length > 0) throw new Error(`declared files missing from reference snapshot: ${missing.join(', ')}`)

  const noticeFiles = actual.filter((relative) => /(^|\/)NOTICE(\.[^/]*)?$/i.test(relative))
  const licenseHashes = new Map()
  for (const relative of actual.filter((entry) => /(^|\/)LICENSE$/i.test(entry))) {
    licenseHashes.set(relative, sha256(fs.readFileSync(path.join(snapshotRoot, relative))))
  }

  return {
    sourceHead: manifest.sourceHead,
    scope: manifest.scope,
    fileCount: actual.length,
    totalBytes: [...declared.values()].reduce((total, entry) => total + entry.bytes, 0),
    manifestSha256: sha256(fs.readFileSync(REFERENCE_MANIFEST)),
    standaloneNoticeFound: manifest.standaloneNoticeFound === true,
    noticeFiles,
    licenseHashes: Object.fromEntries(licenseHashes),
    enginePackageRealPath: fs.realpathSync(ENGINE_SNAPSHOT),
    files: Object.fromEntries(declared),
  }
}
