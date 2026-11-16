'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { pathToFileURL } = require('node:url')

test('OpenCode 1.14 server hooks preserve SDK receipts, exact targets, approvals and lifecycle', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-opencode-v1-'))
  const keys = ['UTA_PROFILE', 'UTA_USER_DATA_DIR', 'UTA_RUNTIME_DIR', 'UTA_ENDPOINT_FILE', 'DESKPET_ENDPOINT_FILE']
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  for (const key of keys) delete process.env[key]
  Object.assign(process.env, { UTA_PROFILE: 'opencode-v1-test', UTA_USER_DATA_DIR: root,
    UTA_RUNTIME_DIR: root, UTA_ENDPOINT_FILE: path.join(root, 'runtime-endpoint.json') })
  const commands = [], approvals = [], cancellations = [], replies = [], prompts = []
  let outcome = 'unavailable'
  let delayedApproval
  const server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    if (req.url === '/command') commands.push(body)
    else if (req.url === '/approval/cancel') cancellations.push(body)
    else {
      approvals.push(body)
      if (outcome === 'delayed') await new Promise(resolve => { delayedApproval = resolve })
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, outcome: outcome === 'delayed' ? 'allowed-once' : outcome }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  fs.writeFileSync(process.env.UTA_ENDPOINT_FILE, JSON.stringify({ port: server.address().port, token: 'fixture' }))
  const client = {
    session: {
      get: async ({ path: target, query }) => {
        assert.equal(query.directory, root)
        return target.id === 'A' ? { data: { id: 'A', directory: root } } : { error: { name: 'NotFoundError' } }
      },
      promptAsync: async options => {
        prompts.push(options)
        return options.body.parts[0].text === 'lost' ? { error: { name: 'TransportError' } } : { response: { ok: true, status: 204 } }
      },
    },
    postSessionIdPermissionsPermissionId: async options => { replies.push(options); return { data: true } },
  }
  const plugin = (await import(pathToFileURL(path.resolve(__dirname, '../plugins/opencode/uta-opencode.mjs')).href)).default
  const hooks = await plugin.server({ client, directory: root })
  const event = (type, properties) => hooks.event({ event: { type, properties } })
  t.after(async () => {
    await event('server.instance.disposed', { directory: root })
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key]
    fs.rmSync(root, { recursive: true, force: true })
  })
  const bridgeFile = path.join(root, 'hooks/opencode-native-bridge.json')
  const bridge = JSON.parse(fs.readFileSync(bridgeFile, 'utf8'))
  const post = async body => {
    const res = await fetch(`http://127.0.0.1:${bridge.port}/message`, {
      method: 'POST', headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  }
  await t.test('asynchronous admission is not mislabeled as queued and SDK errors cannot report success', async () => {
    assert.equal((await post({ sessionId: 'missing', text: 'hello' })).status, 409)
    assert.equal((await post({ sessionId: 'A', cwd: path.join(root, 'other'), text: 'hello' })).status, 409)
    assert.equal(prompts.length, 0)
    const receipt = await post({ sessionId: 'A', cwd: root, text: 'hello' })
    assert.equal(receipt.body.delivery, 'accepted')
    assert.equal(receipt.body.sessionId, 'A')
    assert.deepEqual(prompts[0], { path: { id: 'A' }, query: { directory: root }, body: { parts: [{ type: 'text', text: 'hello' }] } })
    assert.equal((await post({ sessionId: 'A', text: 'lost' })).body.error, 'delivery-unknown')
  })
  await t.test('properties events and split tool arguments route work and successful todos to the original session', async () => {
    await event('session.created', { info: { id: 'A', directory: root } })
    await hooks['tool.execute.before']({ sessionID: 'A', tool: 'todowrite', callID: 'todo-1' }, { args: { todos: [{ content: 'Keep target', status: 'pending' }] } })
    assert.ok(commands.some(value => value.command.command === 'agent_state' && value.command.state === 'tool_running'))
    assert.equal(commands.filter(value => value.command.command === 'todo_snapshot').length, 0)
    await event('todo.updated', { sessionID: 'A', todos: [{ content: 'Keep target', status: 'completed' }] })
    const snapshot = commands.find(value => value.command.command === 'todo_snapshot')
    assert.equal(snapshot.command.items[0].text, 'Keep target')
    assert.equal(snapshot.meta.sessionId, 'A')
    assert.ok(commands.every(value => value.meta.hostId === 'opencode' && value.meta.sessionId === 'A'))
  })
  await t.test('real permission events answer once or reject; offline and already answered requests stay native', async () => {
    const permission = { id: 'p1', sessionID: 'A', permission: 'write', patterns: ['example.txt'] }
    await event('permission.asked', permission)
    assert.equal(replies.length, 0)
    assert.equal(approvals[0].sessionId, 'A')
    outcome = 'allowed-once'
    await event('permission.asked', { ...permission, id: 'p2' })
    assert.deepEqual(replies[0].path, { id: 'A', permissionID: 'p2' })
    assert.equal(replies[0].body.response, 'once')
    outcome = 'rejected'
    await event('permission.asked', { ...permission, id: 'p3' })
    assert.equal(replies[1].body.response, 'reject')
    outcome = 'delayed'
    const pending = event('permission.asked', { ...permission, id: 'p4' })
    while (!delayedApproval) await new Promise(resolve => setTimeout(resolve, 5))
    await event('permission.replied', { sessionID: 'A', requestID: 'p4', reply: 'reject' })
    delayedApproval()
    await pending
    assert.equal(replies.length, 2)
    assert.equal(cancellations.length, 1)
    assert.equal(cancellations[0].requestId, approvals.at(-1).requestId)
    assert.equal(cancellations[0].sessionId, 'A')
  })
  await t.test('questions stay in the host instead of becoming tool approvals', async () => {
    const count = approvals.length
    await event('question.asked', { id: 'q1', sessionID: 'A', questions: [{ question: 'Choose an option' }] })
    assert.equal(approvals.length, count)
    assert.ok(commands.some(value => value.command.command === 'choice_hint' && value.meta.sessionId === 'A'))
  })
  await t.test('assistant text is distinguished from user and stale history parts', async () => {
    await hooks['chat.message']({ sessionID: 'A' })
    await event('message.updated', { info: { id: 'user-1', sessionID: 'A', role: 'user' } })
    await event('message.part.updated', { part: { type: 'text', sessionID: 'A', messageID: 'user-1', text: 'User prompt must stay private' } })
    await event('message.updated', { info: { id: 'assistant-1', sessionID: 'A', role: 'assistant' } })
    await event('message.part.updated', { part: { type: 'text', sessionID: 'A', messageID: 'assistant-1', text: 'Assistant only.' } })
    await event('message.part.updated', { part: { type: 'text', sessionID: 'A', messageID: 'user-1', text: 'Stale user text' } })
    await event('session.idle', { sessionID: 'A' })
    const deadline = Date.now() + 2000
    while (!commands.some(value => value.command.command === 'rp_reply')) {
      assert.ok(Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    const reply = commands.find(value => value.command.command === 'rp_reply')
    assert.equal(reply.command.text, 'Assistant only.')
  })
  await event('server.instance.disposed', { directory: root })
  assert.equal(fs.existsSync(bridgeFile), false)
  assert.equal(fs.readdirSync(path.join(root, 'hooks/native-bridges/opencode')).length, 0)
})
