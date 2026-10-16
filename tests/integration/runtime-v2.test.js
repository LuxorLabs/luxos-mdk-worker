'use strict'

const test = require('brittle')
const { WORKER_DIR, WorkerRuntimeV2, envelope, actions } = require('../helpers')
const { createServer } = require('../../mock/luxos-server')

const { ACTIONS, MESSAGE_TYPES } = actions

const request = (action, deviceId, payload = {}) => envelope.build({
  action,
  type: MESSAGE_TYPES.REQUEST,
  sender: 'runtime-v2-test',
  target: 'luxos-test',
  deviceId,
  payload
})

async function start (t, devices) {
  const runtime = new WorkerRuntimeV2(WORKER_DIR, { workerId: 'luxos-test', devices })
  t.teardown(() => runtime.stop())
  await runtime.start()
  return runtime
}

test('WorkerRuntimeV2 loads the package and serves a LuxOS miner', async (t) => {
  const mock = createServer({ port: 0 })
  const { port } = await mock.ready
  t.teardown(() => mock.close())
  const runtime = await start(t, [{ deviceId: 'lux-0', config: { address: '127.0.0.1', port } }])

  const identity = await runtime.handleRequest(request(ACTIONS.IDENTITY_REQUEST, null))
  t.is(identity.payload.devices[0].deviceId, 'lux-0')

  const capability = await runtime.handleRequest(request(ACTIONS.CAPABILITY_REQUEST, null))
  const { contract } = capability.payload
  t.is(contract.metadata.brand, 'LuxOS')
  t.is(contract.capabilities.telemetry.length, 20)
  t.is(contract.capabilities.commands.length, 5)
  t.ok(contract.capabilities.telemetry.every((entry) => entry.handler === undefined), 'handler paths are not published')

  const metrics = await runtime.handleRequest(request(ACTIONS.TELEMETRY_PULL, 'lux-0', { query: { type: 'metrics' } }))
  t.is(metrics.payload.metrics.hashrate_rt, 140.25)
  t.is(metrics.payload.metrics.power, 3010)
  t.is(metrics.payload.metrics.temperature, 72)
  t.is(metrics.payload.metrics.status, 'mining')
  t.is(mock.requests.length, 1, 'one TCP request serves the whole metrics pull')

  const info = console.info
  console.info = () => {}
  t.teardown(() => { console.info = info })
  const led = await runtime.handleRequest(request(ACTIONS.COMMAND_REQUEST, 'lux-0', {
    commandId: 'cmd-1', command: 'setLED', params: { enabled: true }
  }))
  t.is(led.payload.status, 'SUCCESS')
  t.is(mock.state.led.red, 'blink')

  const invalid = await runtime.handleRequest(request(ACTIONS.COMMAND_REQUEST, 'lux-0', {
    commandId: 'cmd-2', command: 'setPowerMode', params: { mode: 'turbo' }
  }))
  t.is(invalid.payload.status, 'FAILED')
  t.ok(/ERR_SET_POWER_MODE_INVALID/.test(invalid.payload.error))
})

test('a failed source fails only the channels that need it', async (t) => {
  const mock = createServer({ port: 0, failCommands: ['power'] })
  const { port } = await mock.ready
  t.teardown(() => mock.close())
  const runtime = await start(t, [{ deviceId: 'lux-1', config: { address: '127.0.0.1', port } }])

  const { metrics } = (await runtime.handleRequest(request(ACTIONS.TELEMETRY_PULL, 'lux-1', { query: { type: 'metrics' } }))).payload
  t.ok(/ERR_API_STATUS_ERROR: power/.test(metrics.power.error))
  t.ok(/ERR_API_STATUS_ERROR: power/.test(metrics.efficiency.error))
  t.is(metrics.hashrate_rt, 140.25, 'other channels still report')
})

test('a silent miner costs one timeout per metrics pull, not one per channel', async (t) => {
  const net = require('node:net')
  const sockets = new Set()
  const silent = net.createServer((socket) => sockets.add(socket))
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve))
  t.teardown(() => new Promise((resolve) => {
    sockets.forEach((socket) => socket.destroy())
    silent.close(resolve)
  }))
  const runtime = await start(t, [{ deviceId: 'lux-silent', config: { address: '127.0.0.1', port: silent.address().port, timeout: 300 } }])

  const started = Date.now()
  const { metrics } = (await runtime.handleRequest(request(ACTIONS.TELEMETRY_PULL, 'lux-silent', { query: { type: 'metrics' } }))).payload
  t.ok(/ERR_TCP_TIMEOUT/.test(metrics.hashrate_rt.error))
  t.ok(/ERR_TCP_TIMEOUT/.test(metrics.snap.error))
  t.is(sockets.size, 1, 'one connection for the whole pull')
  t.ok(Date.now() - started < 2000)
})

test('an unreachable miner surfaces as a telemetry error', async (t) => {
  const runtime = await start(t, [{ deviceId: 'lux-down', config: { address: '127.0.0.1', port: 1, timeout: 500 } }])
  const { metrics } = (await runtime.handleRequest(request(ACTIONS.TELEMETRY_PULL, 'lux-down', { query: { type: 'metrics' } }))).payload
  t.ok(/ERR_TCP_CONNECTION/.test(metrics.hashrate_rt.error))
})
