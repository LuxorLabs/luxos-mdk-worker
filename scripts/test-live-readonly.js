'use strict'

// Read-only check against a real LuxOS miner. It runs every telemetry
// handler from mdk-contract.json, so it checks exactly what MDK will
// publish. It never opens a session and never writes.
// Usage: npm run test:live -- <ip> [port]

const path = require('node:path')

const MDK = path.dirname(require.resolve('@tetherto/mdk/package.json'))
const { loadContract } = require(path.join(MDK, 'backend/core/mdk-worker/lib/contract-loader'))
const { createInstance } = require(path.join(MDK, 'backend/core/mdk-worker/lib/instance-loader'))

const WORKER_DIR = path.resolve(__dirname, '..')

async function main () {
  const [address, port = '4028'] = process.argv.slice(2)
  if (!address) throw new Error('Usage: npm run test:live -- <ip> [port]')

  const { entries } = loadContract(WORKER_DIR)
  const instance = createInstance({
    dir: WORKER_DIR,
    entries,
    device: { id: 'live', opts: { address, port: Number(port) } }
  })

  let failed = 0
  for (const name of entries.telemetry.keys()) {
    try {
      const value = await instance.telemetry.get(name)({})
      console.log(`${name}: ${JSON.stringify(value)}`)
    } catch (err) {
      failed++
      console.log(`${name}: FAILED ${err.message}`)
    }
  }
  if (failed) throw new Error(`${failed} channel(s) failed`)
  console.log('LuxOS live read-only check passed')
}

main().catch((err) => {
  console.error(err.message)
  process.exitCode = 1
})
