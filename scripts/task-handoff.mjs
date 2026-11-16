#!/usr/bin/env node
/** Desktop task preflight and local handoff receipt. Does not launch agents, commit or merge. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const local = path.join(root, '.uta-task')
const [command = 'status'] = process.argv.slice(2)
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')).digest('hex')
const atomicWrite = (file, value) => {
  const temporary = file + '.pending'
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n')
  fs.renameSync(temporary, file)
}

try {
  if (!['status', 'preflight', 'checkpoint', 'submit'].includes(command)) throw Error('Use status | preflight | checkpoint | submit')
  const a = JSON.parse(fs.readFileSync(path.join(local, 'assignment.json'), 'utf8'))
  if (path.resolve(a.directory).toLowerCase() !== root.toLowerCase()) throw Error('Task directory mismatch')
  if (git('branch', '--show-current') !== a.branch) throw Error('Task branch mismatch')
  git('merge-base', '--is-ancestor', a.base, 'HEAD')
  for (const [file, hash] of Object.entries(a.contractHashes)) if (digest(file) !== hash) throw Error('Frozen contract changed: ' + file)
  const changed = git('diff', '--name-only', a.base, '--').split(/\r?\n/).filter(Boolean)
  const untracked = git('ls-files', '--others', '--exclude-standard').split(/\r?\n/).filter(Boolean)
  const allowed = file => a.allowedFiles.includes(file) || a.allowedDirectories.some(dir => file.startsWith(dir))
  const outside = [...new Set([...changed, ...untracked])].filter(file => !allowed(file))
  if (outside.length) throw Error('Outside task scope: ' + outside.join(', '))
  const head = git('rev-parse', 'HEAD')
  const dirty = git('status', '--short') !== ''
  const statusFile = path.join(local, 'status.json')
  const previous = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile, 'utf8')) : { state: 'prepared' }
  if (command === 'submit') {
    if (dirty) throw Error('Commit task changes before submit; helper will not commit for you')
    if (head === a.base || !changed.length) throw Error('No task implementation commit to submit')
    for (const file of a.requiredResults) if (!fs.existsSync(path.join(root, file))) throw Error('Missing result: ' + file)
    for (const dir of a.implementationDirectories ?? []) if (!changed.some(file => file.startsWith(dir))) throw Error('Missing implementation changes: ' + dir)
  }
  const result = { task: a.task, owner: a.owner, directory: root, branch: a.branch, base: a.base, head, dirty,
    state: command === 'submit' ? 'submitted-awaiting-codex-review' : command === 'checkpoint' ? 'in-progress' : previous.state,
    changed, untracked, profile: a.env.UTA_PROFILE, checkedAt: new Date().toISOString(),
    note: 'Local receipt only; model selection, test results and product acceptance require separate evidence.' }
  if (command === 'checkpoint' || command === 'submit') atomicWrite(statusFile, result)
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
