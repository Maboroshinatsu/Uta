#!/usr/bin/env node
import { verifyReferenceInputs } from './lib/verify-reference.mjs'
import { taskRelative, REFERENCE_MANIFEST } from './lib/paths.mjs'

try {
  const result = verifyReferenceInputs()
  console.log(JSON.stringify({
    manifest: taskRelative(REFERENCE_MANIFEST),
    sourceHead: result.sourceHead,
    fileCount: result.fileCount,
    totalBytes: result.totalBytes,
    manifestSha256: result.manifestSha256,
    standaloneNoticeFound: result.standaloneNoticeFound,
    noticeFiles: result.noticeFiles,
    licenseHashes: result.licenseHashes,
    status: 'verified',
  }, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
