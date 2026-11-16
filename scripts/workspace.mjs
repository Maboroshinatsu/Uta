#!/usr/bin/env node
/** 本机任务目录管理；不派发模型消息、不修改平台全局配置、不删除任务。 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8', windowsHide: true }).trim()
const common = git('rev-parse', '--path-format=absolute', '--git-common-dir')
const primary = path.dirname(common)
const workspace = path.resolve(process.env.UTA_WORKSPACE_ROOT || path.join(primary, '..', 'Uta-Workspace'))
const operations = path.join(workspace, 'operations')
const [command, platform, task] = process.argv.slice(2)

try {
  if (command === 'status') {
    console.log(git('worktree', 'list'))
    const assignments = path.join(operations, 'assignments')
    if (fs.existsSync(assignments)) {
      for (const name of fs.readdirSync(assignments).filter((n) => n.endsWith('.json'))) {
        const record = JSON.parse(fs.readFileSync(path.join(assignments, name), 'utf8'))
        console.log(JSON.stringify(record, null, 2))
      }
    }
  } else if (command === 'new') {
    if (!['codex', 'qoder', 'harness', 'antigravity'].includes(platform) || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(task || '')) {
      throw new Error('Usage: node scripts/workspace.mjs new <codex|qoder|harness|antigravity> <task-name>')
    }
    const id = `${platform}-${task}`
    const directory = path.join(workspace, 'tasks', id)
    const branch = `task/${platform}/${task}`
    const assignment = path.join(operations, 'assignments', `${id}.json`)
    if (fs.existsSync(directory) || fs.existsSync(assignment)) throw new Error('Task directory or assignment already exists')
    const base = git('rev-parse', 'main')
    fs.mkdirSync(path.dirname(directory), { recursive: true })
    git('worktree', 'add', directory, '-b', branch, base)
    const userData = path.join(workspace, 'runtime', 'profiles', id)
    const record = {
      task, platform, directory, branch, base,
      createdAt: new Date().toISOString(),
      env: { UTA_PROFILE: id, UTA_USER_DATA_DIR: userData, UTA_RUNTIME_DIR: userData, UTA_ENDPOINT_FILE: path.join(userData, 'runtime-endpoint.json') },
      instructions: 'Read AGENTS.md and the task contract. Install dependencies with npm ci in app. Do not merge or install global plugins.',
    }
    fs.mkdirSync(path.dirname(assignment), { recursive: true })
    fs.writeFileSync(assignment, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
    console.log(JSON.stringify(record, null, 2))
  } else {
    throw new Error('Usage: node scripts/workspace.mjs status | new <platform> <task-name>')
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
