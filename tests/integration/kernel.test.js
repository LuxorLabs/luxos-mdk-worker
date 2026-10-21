'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('brittle')
const { WORKER_DIR, WorkerRuntimeV2, kernel: mdk, client } = require('../helpers')
const { createServer } = require('../../mock/luxos-server')
const contract = require('../../mdk-contract.json')

const TYPE_OK = {
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  string: (v) => typeof v === 'string',
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
}

// The Kernel queues commands, dispatches them asynchronously and drops them
// from its store once finished, so the outcome only arrives as an event.
function commandDone (kernel, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ERR_COMMAND_NOT_DONE')), timeoutMs)
    kernel.stateMachine.once('command:done', (event) => {
      clearTimeout(timer)
      resolve(event)
    })
  })
}

test('a real Kernel takes the worker to READY and serves it end to end', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'luxos-kernel-'))
  t.teardown(() => fs.rmSync(root, { recursive: true, force: true }))

  const mock = createServer({ port: 0 })
  const { port } = await mock.ready
  t.teardown(() => mock.close())

  const runtime = new WorkerRuntimeV2(WORKER_DIR, {
    workerId: 'luxos-kernel-test',
    devices: [{ deviceId: 'lux-0', config: { address: '127.0.0.1', port } }],
    storeDir: path.join(root, 'worker')
  })
  t.teardown(() => runtime.stop())
  await runtime.start()

  const kernel = await mdk.getKernel({ root, discovery: { mode: 'local' } })
  t.teardown(() => mdk.shutdown(kernel))
  await kernel.registerWorker(runtime.getPublicKey())

  const workers = await mdk.waitForDiscovery(kernel, { minWorkers: 1, timeoutMs: 15000 })
  const worker = workers.find((w) => w.workerId === 'luxos-kernel-test')
  t.is(worker && worker.state, 'READY')
  t.alike(worker && worker.deviceIds, ['lux-0'])

  const mdkClient = client.createMdkClient({ kernelKey: kernel.getPublicKey() })
  t.teardown(() => mdkClient.close())
  await mdkClient.connect()

  const { metrics } = await mdkClient.pullTelemetry('lux-0', 'metrics')
  for (const entry of contract.capabilities.telemetry) {
    const value = metrics[entry.name]
    t.ok(TYPE_OK[entry.type](value), `${entry.name} is a ${entry.type} through the Kernel`)
  }
  t.is(metrics.hashrate_rt, 140.25)

  const info = console.info
  console.info = () => {}
  t.teardown(() => { console.info = info })

  const finished = commandDone(kernel)
  const queued = await mdkClient.sendCommand('lux-0', 'setLED', { enabled: true })
  t.is(queued.status, 'QUEUED')
  const done = await finished
  t.is(done.commandId, queued.commandId)
  t.is(done.state, 'SUCCESS', 'a command reaches the miner through the Kernel')
  t.ok(mock.requests.some((r) => r.command === 'ledset'), 'the mock received the LED write')
})
