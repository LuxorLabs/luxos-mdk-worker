'use strict'

const path = require('node:path')

// MDK is not on npm yet. The pinned git dependency exposes its packages by path.
const MDK = path.dirname(require.resolve('@tetherto/mdk/package.json'))
const mdk = (file) => require(path.join(MDK, 'backend/core', file))

module.exports = {
  WORKER_DIR: path.resolve(__dirname, '..'),
  kernel: mdk('mdk'),
  client: mdk('client'),
  WorkerRuntimeV2: mdk('mdk-worker/lib/worker-runtime-v2'),
  loadContract: mdk('mdk-worker/lib/contract-loader').loadContract,
  createInstance: mdk('mdk-worker/lib/instance-loader').createInstance,
  envelope: mdk('kernel/lib/protocol/envelope'),
  actions: mdk('kernel/lib/protocol/actions')
}
