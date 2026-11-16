'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { test } = require('node:test')

const clientPromise = import(
  pathToFileURL(path.join(__dirname, '../shared/uta-runtime-client.mjs')).href
)
const TOKEN = 'runtime-client-test-token'
const tempDirs = new Set()
const servers = new Set()

function makeEndpointFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-client-'))
  tempDirs.add(dir)
  const file = path.join(dir, 'runtime-endpoint.json')
  return { dir, file }
}

async function startServer(mode) {
  const received = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      let body = null
      try {
        body = raw ? JSON.parse(raw) : null
      } catch {
        /* ignore */
      }
      received.push({ url: req.url, method: req.method, body })
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/health') {
        res.end(
          JSON.stringify(
            mode === 'v2'
              ? { ok: true, protocolVersion: '2.0', protocolVersions: ['1.0', '2.0'] }
              : { ok: true },
          ),
        )
        return
      }
      res.end(JSON.stringify({ ok: true }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.add(server)
  return { port: server.address().port, received }
}

function writeEndpoint(file, port) {
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 2,
      port,
      token: TOKEN,
      createdAt: new Date().toISOString(),
    }),
  )
}

test.after(() => {
  for (const server of servers) {
    try {
      server.close()
    } catch {}
  }
  servers.clear()
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
  tempDirs.clear()
})

test('per-call environments still route commands to the bound host endpoint', async () => {
  const { createHostClient } = await clientPromise
  const { dir } = makeEndpointFile()
  const { port, received } = await startServer('v2')
  const scope = path.join(dir, 'uta', 'host-pets', 'codex')
  fs.mkdirSync(scope, { recursive: true })
  writeEndpoint(path.join(scope, 'runtime-endpoint.json'), port)
  const env = { APPDATA: dir, HOME: dir, USERPROFILE: dir }
  const client = createHostClient({ hostId: 'codex', sessionId: 'isolated', env })
  await client.hello()
  await client.send({ command: 'agent_state', state: 'completed' }, { env })
  assert.equal(received.at(-1).body.meta.hostId, 'codex')
  assert.equal(received.at(-1).body.command.state, 'completed')
})

test('an unavailable health probe does not send an unscoped legacy command or cache v1', async () => {
  const { createHostClient } = await clientPromise
  const { file } = makeEndpointFile()
  let healthy = false
  const received = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (part) => { raw += part })
    req.on('end', () => {
      received.push({ url: req.url, body: raw ? JSON.parse(raw) : null })
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/health' && !healthy) {
        res.writeHead(503)
        res.end(JSON.stringify({ ok: false, error: 'starting' }))
      } else {
        res.end(JSON.stringify({ ok: true, protocolVersions: ['1.0', '2.0'] }))
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.add(server)
  writeEndpoint(file, server.address().port)
  const client = createHostClient({ hostId: 'codex', sessionId: 'isolated', env: { UTA_ENDPOINT_FILE: file } })
  await assert.rejects(client.send({ command: 'notify', text: 'first' }), /starting/)
  assert.equal(received.filter((r) => r.url === '/command').length, 0)
  healthy = true
  await client.send({ command: 'notify', text: 'recovered' })
  assert.equal(received.at(-1).body.meta.sessionId, 'isolated')
  assert.equal(received.at(-1).body.protocolVersion, '2.0')
})

test('a new instance token at the same port invalidates cached protocol capabilities', async () => {
  const { createHostClient } = await clientPromise
  const { file } = makeEndpointFile()
  let v2 = false
  let probes = 0
  const commands = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (part) => { raw += part })
    req.on('end', () => {
      if (req.url === '/health') probes++
      else commands.push(JSON.parse(raw))
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, protocolVersions: v2 ? ['2.0'] : ['1.0'] }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.add(server)
  writeEndpoint(file, server.address().port)
  const client = createHostClient({ hostId: 'codex', env: { UTA_ENDPOINT_FILE: file } })
  await client.send({ command: 'notify', text: 'v1' })
  const endpoint = JSON.parse(fs.readFileSync(file))
  endpoint.token = 'replacement-instance-token'
  fs.writeFileSync(file, JSON.stringify(endpoint))
  v2 = true
  await client.send({ command: 'notify', text: 'v2' })
  assert.equal(probes, 2)
  assert.equal(commands[0].command, 'notify')
  assert.equal(commands[1].protocolVersion, '2.0')
})

test('v2 runtime receives an envelope with host and session identity', async () => {
  const { createHostClient } = await clientPromise
  const { file } = makeEndpointFile()
  const server = await startServer('v2')
  writeEndpoint(file, server.port)
  const env = { ...process.env, DESKPET_ENDPOINT_FILE: file }

  const client = createHostClient({ hostId: 'qoder', sessionId: 's1', label: 'Qoder', env })
  await client.hello()
  await client.send({ command: 'notify', text: 'hello' })

  const commands = server.received.filter((entry) => entry.url === '/command')
  assert.ok(server.received.some((entry) => entry.url === '/health'))
  assert.equal(commands.length, 2)
  assert.equal(commands[0].body.protocolVersion, '2.0')
  assert.equal(commands[0].body.meta.hostId, 'qoder')
  assert.equal(commands[0].body.meta.sessionId, 's1')
  assert.equal(commands[0].body.command.command, 'hello')
  assert.equal(commands[1].body.command.command, 'notify')
})

test('v1 runtime receives bare commands and skips v2-only control commands', async () => {
  const { createHostClient } = await clientPromise
  const { file } = makeEndpointFile()
  const server = await startServer('v1')
  writeEndpoint(file, server.port)
  const env = { ...process.env, DESKPET_ENDPOINT_FILE: file }

  const client = createHostClient({ hostId: 'qoder', sessionId: 's1', env })
  await client.hello()
  await client.bindSession('s1', { label: 'Qoder' })
  await client.send({ command: 'notify', text: 'hello' })

  const commands = server.received.filter((entry) => entry.url === '/command')
  assert.equal(commands.length, 1)
  assert.equal(commands[0].body.command, 'notify')
  assert.equal(commands[0].body.protocolVersion, undefined)
  assert.equal(commands[0].body.meta, undefined)
})

test('a v1 endpoint keeps working after an explicit session change', async () => {
  const { createHostClient } = await clientPromise
  const { file } = makeEndpointFile()
  const server = await startServer('v1')
  writeEndpoint(file, server.port)
  const env = { ...process.env, DESKPET_ENDPOINT_FILE: file }

  const client = createHostClient({ hostId: 'qoder', env })
  assert.equal(client.setSession('s2'), 's2')
  await client.send({ command: 'agent_state', state: 'thinking' })

  const commands = server.received.filter((entry) => entry.url === '/command')
  assert.equal(commands[0].body.command, 'agent_state')
  assert.equal(commands[0].body.state, 'thinking')
})

test('changing sessions clears a previous turn id, while binding the same session preserves it', async () => {
  const { createHostClient } = await clientPromise
  const { file } = makeEndpointFile()
  const server = await startServer('v2')
  writeEndpoint(file, server.port)
  const client = createHostClient({ hostId: 'codex', env: { ...process.env, DESKPET_ENDPOINT_FILE: file } })
  client.setSession('s1', { turnId: 'turn-1' })
  await client.bindSession('s1')
  client.setSession('s2')
  await client.send({ command: 'agent_state', state: 'thinking' })
  const bodies = server.received.filter(entry => entry.url === '/command').map(entry => entry.body)
  assert.equal(bodies[0].meta.turnId, 'turn-1')
  assert.equal(bodies[1].meta.sessionId, 's2')
  assert.equal(bodies[1].meta.turnId, undefined)
})
