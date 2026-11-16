'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const createLoader = require('./support/settings-loader.cjs')

function setup(t, timeoutMs = 5000) {
  function contents() {
    return Object.assign(new EventEmitter(), {
      mainFrame: {}, sent: [], destroyed: false,
      isDestroyed() { return this.destroyed },
      send(channel, payload) { this.sent.push({ channel, payload }) },
    })
  }
  const settings = contents(), pet = contents()
  const event = sender => ({ sender, senderFrame: sender.mainFrame })
  const { SettingsPetCommands } = createLoader({ electron: { ipcMain: {} } })('main/settings-ipc/pet-commands')
  const controller = new SettingsPetCommands({
    getPet: () => pet.destroyed ? null : pet,
    isSettingsSender: e => e.sender === settings && e.senderFrame === settings.mainFrame && !settings.destroyed,
    isPetSender: e => e.sender === pet && e.senderFrame === pet.mainFrame && !pet.destroyed,
    timeoutMs,
  })
  t.after(() => controller.dispose())
  const run = (command, model) => controller.run(event(settings), command, model)
  const latest = () => pet.sent.at(-1).payload
  const reply = result => controller.receive(event(pet), { id: latest().id, result })
  return { controller, settings, pet, event, run, latest, reply }
}

test('main waits for the real pet receipt and rejects foreign/subframe receipts', async t => {
  const h = setup(t)
  let settled = false
  const response = h.run({ type: 'trigger-preset', preset: 'neutral' }).then(result => { settled = true; return result })
  await Promise.resolve()
  assert.equal(settled, false)
  const payload = { id: h.latest().id, result: { ok: true } }
  h.controller.receive({ sender: h.pet, senderFrame: {} }, payload)
  await Promise.resolve(); assert.equal(settled, false)
  h.reply({ ok: false, error: 'action-rejected' })
  assert.equal((await response).error, 'action-rejected')
})

for (const lifecycle of ['destroyed', 'render-process-gone', 'reload']) {
  test(`settings ${lifecycle} cancels pending work and releases its workshop without pagehide`, async t => {
    const h = setup(t)
    const response = h.run({ type: 'set-edit-lock', locked: true })
    const original = h.latest()
    if (lifecycle === 'reload') h.settings.emit('did-start-navigation', {}, 'file:///settings', false, true)
    else h.settings.emit(lifecycle)
    assert.equal((await response).error, 'session-closed')
    assert.equal(h.latest().command.type, 'release-workshop')
    assert.equal(h.latest().session, original.session)
    h.controller.receive(h.event(h.pet), { id: original.id, result: { ok: true } })
  })
}

test('in-page navigation does not release a live editor and explicit release creates a new session', async t => {
  const h = setup(t)
  const first = h.run({ type: 'snapshot' }); const firstSession = h.latest().session
  h.settings.emit('did-start-navigation', {}, 'file:///settings#studio', true, true)
  h.reply({ ok: true, data: {} }); await first
  assert.equal(h.latest().command.type, 'snapshot')
  await h.run({ type: 'release-workshop' })
  const next = h.run({ type: 'snapshot' })
  assert.ok(h.latest().session > firstSession)
  h.reply({ ok: true, data: {} }); await next
})

test('pet reload invalidates its model epoch and rejects previously bound model commands', async t => {
  const h = setup(t)
  const read = h.run({ type: 'snapshot' })
  h.reply({ ok: true, data: { modelUrl: 'model-a', modelGeneration: 1 } })
  const model = (await read).data
  const pending = h.run({ type: 'preview-step', step: {}, gaze: true }, model)
  h.pet.mainFrame = {}
  h.pet.emit('did-start-navigation', {}, 'file:///pet', false, true)
  assert.equal((await pending).error, 'pet-reloaded')
  assert.equal((await h.run({ type: 'preview-step', step: {}, gaze: true }, model)).error, 'model-changed')
})

test('timeout cancels the owning session and sends cleanup instead of leaving an uncertain lock', async t => {
  const h = setup(t, 10)
  const result = await h.run({ type: 'set-edit-lock', locked: true })
  assert.equal(result.error, 'timeout')
  assert.equal(h.latest().command.type, 'release-workshop')
})

test('malformed model context, unauthorized calls and non-boolean replies never report success', async t => {
  const h = setup(t)
  assert.equal((await h.controller.run({ sender: h.settings, senderFrame: {} }, { type: 'snapshot' })).error, 'unauthorized')
  assert.equal((await h.run({ type: 'snapshot' }, { modelUrl: 'x', modelGeneration: NaN, petEpoch: 1 })).error, 'invalid-command')
  const pending = h.run({ type: 'snapshot' })
  h.reply({ ok: 'yes' })
  assert.equal((await pending).error, 'invalid-result')
})
