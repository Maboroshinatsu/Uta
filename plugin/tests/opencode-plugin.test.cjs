'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { pathToFileURL } = require('node:url')

async function until(predicate) {
  const deadline = Date.now() + 3000
  while (!predicate()) {
    if (Date.now() > deadline) throw Error('event did not arrive')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('OpenCode v2 native queue, event attribution and confirmed Todo stay isolated', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-opencode-'))
  const keys = ['UTA_PROFILE', 'UTA_USER_DATA_DIR', 'UTA_RUNTIME_DIR', 'UTA_ENDPOINT_FILE', 'DESKPET_ENDPOINT_FILE']
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  for (const key of keys) delete process.env[key]
  process.env.UTA_PROFILE = 'opencode-test'
  process.env.UTA_USER_DATA_DIR = directory
  process.env.UTA_RUNTIME_DIR = directory
  process.env.UTA_ENDPOINT_FILE = path.join(directory, 'runtime-endpoint.json')
  const commands = []
  const approvals = []
  const runtime = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    if (req.url === '/command') commands.push(body)
    else approvals.push(body)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, outcome: 'unavailable' }))
  })
  await new Promise(resolve => runtime.listen(0, '127.0.0.1', resolve))
  fs.writeFileSync(process.env.UTA_ENDPOINT_FILE, JSON.stringify({ port: runtime.address().port, token: 'test-runtime-token' }))
  const events = []
  let nextEvent
  let closed = false
  const hooks = {}
  const prompts = []
  const emit = event => { events.push(event); nextEvent?.(); nextEvent = null }
  const ctx = {
    session: {
      get: async ({ sessionID }) => ['A', 'B'].includes(sessionID) ? { id: sessionID, directory: path.join(directory, sessionID) } : null,
      prompt: async body => { prompts.push(body); if (body.text === 'lost') throw Error('lost receipt'); return { id: 'inbox-1', sessionID: body.sessionID } },
    },
    event: { subscribe: ({ signal }) => {
      signal.addEventListener('abort', () => { closed = true; nextEvent?.() })
      return (async function * () {
        while (!closed) {
          if (!events.length) await new Promise(resolve => { nextEvent = resolve })
          if (events.length) yield events.shift()
        }
      })()
    } },
    tool: { hook: (name, handler) => { hooks[name] = handler } },
    permission: { hook: (name, handler) => { hooks[name] = handler } },
  }
  const { UtaPlugin, endpointCandidates } = await import(pathToFileURL(path.resolve(__dirname, '../plugins/opencode/uta-opencode.mjs')).href)
  const dispose = await UtaPlugin(ctx)
  t.after(async () => {
    dispose()
    runtime.closeAllConnections()
    await new Promise(resolve => runtime.close(resolve))
    for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key]
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const metadata = path.join(directory, 'hooks/opencode-native-bridge.json')
  const bridge = JSON.parse(fs.readFileSync(metadata, 'utf8'))
  const post = async (body, token = bridge.token) => {
    const response = await fetch(`http://127.0.0.1:${bridge.port}/message`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }

  await t.test('only an authenticated exact session and directory can admit input', async () => {
    assert.equal((await post({ sessionId: 'A', text: 'hello' }, 'wrong')).status, 401)
    assert.equal((await post({ sessionId: 'missing', text: 'hello' })).status, 409)
    assert.equal((await post({ sessionId: 'A', text: 'hello', cwd: path.join(directory, 'B') })).status, 409)
    assert.equal(prompts.length, 0)
    const response = await post({ sessionId: 'A', text: 'hello', cwd: path.join(directory, 'A') })
    assert.deepEqual({ accepted: response.body.accepted, sessionId: response.body.sessionId, delivery: response.body.delivery }, { accepted: true, sessionId: 'A', delivery: 'queued' })
    assert.equal(prompts[0].delivery, 'queue')
    assert.equal(prompts[0].sessionID, 'A')
    assert.equal((await post({ sessionId: 'A', text: 'lost' })).body.error, 'delivery-unknown')
    assert.deepEqual(endpointCandidates(), [process.env.UTA_ENDPOINT_FILE])
  })

  await t.test('Todo is committed on success and another session failure cannot clear it', async () => {
    for (const sessionID of ['A', 'B']) await hooks['execute.before']({ sessionID, callID: 'same', tool: 'todowrite', args: { todos: [{ content: sessionID, status: 'pending' }] } })
    assert.equal(commands.filter(value => value.command.command === 'todo_snapshot').length, 0)
    emit({ type: 'session.execution.failed', data: { sessionID: 'A' } })
    emit({ type: 'session.tool.success', data: { sessionID: 'B', id: 'same' } })
    await until(() => commands.some(value => value.command.command === 'todo_snapshot'))
    const snapshot = commands.find(value => value.command.command === 'todo_snapshot')
    assert.equal(snapshot.meta.sessionId, 'B')
    assert.equal(snapshot.command.items[0].text, 'B')
    assert.equal(snapshot.command.cwd, path.join(directory, 'B'))
    assert.ok(commands.every(value => value.protocolVersion === '2.0' && value.meta.hostId === 'opencode' && value.meta.sessionId))
    assert.ok(commands.some(value => value.command.command === 'session_bind' && value.meta.sessionId === 'A'))
    assert.ok(fs.existsSync(path.join(directory, 'hooks/sessions/opencode')))
    const record = JSON.parse(fs.readFileSync(path.join(directory, 'hooks/opencode-session.json'), 'utf8'))
    assert.match(record.nativeBridgeId, /^[a-f0-9-]{36}$/)
    assert.ok(fs.existsSync(path.join(directory, 'hooks/native-bridges/opencode', `${record.nativeBridgeId}.json`)))
  })

  await t.test('permission unavailable leaves the host decision unchanged and carries session ownership', async () => {
    const request = { sessionID: 'B', action: 'write', effect: 'ask' }
    await hooks.evaluate(request)
    assert.equal(request.effect, 'ask')
    assert.equal(approvals[0].sessionId, 'B')
  })

  dispose()
  assert.equal(fs.existsSync(metadata), false)
  assert.equal(fs.readdirSync(path.join(directory, 'hooks/native-bridges/opencode')).length, 0)
})
