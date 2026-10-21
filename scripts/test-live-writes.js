'use strict'

// Write check against a real LuxOS miner on controlled test hardware. Steps
// run one command each through its contract handler and only when named, in
// the order given. power and profile confirm the change through telemetry,
// then always restore the previous state and confirm that too, also after a
// failure or a first Ctrl-C. If a restore fails, the script says what state
// the miner was left in.
//
// Usage:
//   node scripts/test-live-writes.js <ip> [port] --steps led,power,profile,pools,reboot
//     [--profile <name>]        profile to switch to (default: first other one)
//     [--pool-password <pw>]    password sent for every current pool (required by pools)
//
// led      blinks the locate LED for 10s, then sets it to automatic; only
//          someone at the miner can confirm the blink
// power    curtails the miner (sleep), then wakes it up again
// profile  switches profile, then switches back
// pools    replaces the pool list with the same URLs and users. LuxOS never
//          returns pool passwords, so every pool gets --pool-password: this
//          step cannot restore a different password the miner had
// reboot   reboots and waits for the miner to come back with a lower uptime

const path = require('node:path')

const MDK = path.dirname(require.resolve('@tetherto/mdk/package.json'))
const { loadContract } = require(path.join(MDK, 'backend/core/mdk-worker/lib/contract-loader'))
const { createInstance } = require(path.join(MDK, 'backend/core/mdk-worker/lib/instance-loader'))
const { LuxosClient } = require('../lib/luxos-client')

const WORKER_DIR = path.resolve(__dirname, '..')
const STEPS = ['led', 'power', 'profile', 'pools', 'reboot']
const POLL_MS = 5000

function parseArgs (argv) {
  const args = { positional: [], steps: [], profile: null, poolPassword: null }
  // A flag given last with no value must fail, not become undefined: an
  // undefined pool password would wipe the miner's real ones. '' is a value.
  const value = (i) => {
    if (i >= argv.length || argv[i].startsWith('--')) throw new Error(`ERR_LIVE_USAGE: ${argv[i - 1]} needs a value`)
    return argv[i]
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--steps') args.steps = value(++i).split(',').filter(Boolean)
    else if (argv[i] === '--profile') args.profile = value(++i)
    else if (argv[i] === '--pool-password') args.poolPassword = value(++i)
    else args.positional.push(argv[i])
  }
  const [address, port = '4028'] = args.positional
  const unknown = args.steps.filter((step) => !STEPS.includes(step))
  if (!address || !args.steps.length || unknown.length || !/^\d+$/.test(port)) {
    throw new Error(`Usage: node scripts/test-live-writes.js <ip> [port] --steps ${STEPS.join(',')}` +
      (unknown.length ? ` (unknown: ${unknown.join(',')})` : ''))
  }
  if (args.steps.includes('pools') && args.poolPassword === null) {
    throw new Error('ERR_LIVE_PRECONDITION: pools needs --pool-password, the password the miner\'s pools use')
  }
  return { ...args, address, port: Number(port) }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// First Ctrl-C stops waiting for a change and goes straight to the restore;
// a second one exits without restoring.
let interrupted = false
process.on('SIGINT', () => {
  if (interrupted) process.exit(130)
  interrupted = true
  console.error('  interrupted: restoring the miner, Ctrl-C again to exit without restoring')
})

async function main () {
  const args = parseArgs(process.argv.slice(2))
  const { entries } = loadContract(WORKER_DIR)
  const instance = createInstance({
    dir: WORKER_DIR,
    entries,
    device: { id: 'live', opts: { address: args.address, port: args.port } }
  })

  const read = (name) => instance.telemetry.get(name)({})
  const run = (name, params) => instance.commands.get(name)(params)

  async function waitFor (label, timeoutMs, check, { restoring = false } = {}) {
    const start = Date.now()
    let last
    while (Date.now() - start < timeoutMs) {
      if (interrupted && !restoring) throw new Error(`ERR_LIVE_INTERRUPTED: ${label}`)
      try {
        last = await check()
        if (last === true) {
          console.log(`  confirmed: ${label} (${Math.round((Date.now() - start) / 1000)}s)`)
          return
        }
      } catch (err) {
        last = err.message
      }
      await sleep(POLL_MS)
    }
    throw new Error(`ERR_LIVE_NOT_CONFIRMED: ${label} after ${timeoutMs / 1000}s, last=${JSON.stringify(last)}`)
  }

  // Runs apply, then restore whatever happened. A failed restore reports
  // both errors and the state the miner was left in.
  async function applyThenRestore (apply, restore, leftIn) {
    let failure = null
    try {
      await apply()
    } catch (err) {
      failure = err
    }
    try {
      await restore()
    } catch (err) {
      console.error(`  MINER LEFT IN ${leftIn}: restore failed (${err.message}), restore it by hand`)
      throw failure ? new Error(`${failure.message}; then the restore failed: ${err.message}`) : err
    }
    if (failure) throw failure
  }

  const steps = {
    async led () {
      await applyThenRestore(async () => {
        await run('setLED', { enabled: true })
        console.log('  LED blinking for 10s, check the miner')
        await sleep(10000)
      }, async () => {
        await run('setLED', { enabled: false })
        console.log('  LED back to automatic')
      }, 'LED blinking')
    },

    async power () {
      const before = await read('power_mode')
      if (before !== 'normal') throw new Error(`ERR_LIVE_PRECONDITION: power_mode is ${before}, expected normal`)
      await applyThenRestore(async () => {
        await run('setPowerMode', { mode: 'sleep' })
        await waitFor('power_mode sleep', 120000, async () => (await read('power_mode')) === 'sleep')
      }, async () => {
        await run('setPowerMode', { mode: 'normal' })
        await waitFor('power_mode normal', 600000, async () => (await read('power_mode')) === 'normal', { restoring: true })
      }, 'sleep (curtailed)')
    },

    async profile () {
      const before = await read('profile')
      const profiles = await new LuxosClient({ address: args.address, port: args.port }).listProfiles()
      const target = args.profile || profiles.find((name) => name !== before)
      if (!target || target === before) throw new Error(`ERR_LIVE_PRECONDITION: no other profile, have ${JSON.stringify(profiles)}`)
      console.log(`  ${before} -> ${target}`)
      await applyThenRestore(async () => {
        await run('setProfile', { profile: target })
        await waitFor(`profile ${target}`, 300000, async () => (await read('profile')) === target)
      }, async () => {
        await run('setProfile', { profile: before })
        await waitFor(`profile ${before}`, 300000, async () => (await read('profile')) === before, { restoring: true })
      }, `profile ${target} (was ${before})`)
    },

    async pools () {
      const key = (pools) => JSON.stringify(pools.map((pool) => [pool.url, pool.user]))
      const before = await read('pools')
      console.log(`  current pools: ${key(before)}`)
      let result
      try {
        result = await run('setupPools', {
          pools: before.map((pool) => ({ url: pool.url, user: pool.user, password: args.poolPassword }))
        })
      } catch (err) {
        console.error(`  POOLS MAY BE CHANGED: the original list was ${key(before)}`)
        throw err
      }
      if (result?.added !== before.length || result?.removed !== before.length) {
        throw new Error(`ERR_LIVE_NOT_CONFIRMED: setupPools returned ${JSON.stringify(result)}, expected ${before.length} added and removed`)
      }
      await waitFor('same pool list after replace', 60000, async () => key(await read('pools')) === key(before))
    },

    async reboot () {
      const before = await read('uptime')
      try {
        await run('reboot', {})
      } catch (err) {
        // The miner can drop the connection before it answers; the uptime check decides.
        if (!/ERR_TCP/.test(err.message)) throw err
        console.log(`  no reply to reboot (${err.message}), checking uptime`)
      }
      await waitFor('miner back with a lower uptime', 600000, async () => (await read('uptime')) < before)
    }
  }

  for (const step of args.steps) {
    if (interrupted) throw new Error(`ERR_LIVE_INTERRUPTED: before ${step}`)
    console.log(`${step}:`)
    await steps[step]()
  }
  console.log(`LuxOS live write check passed: ${args.steps.join(', ')}`)
}

main().catch((err) => {
  console.error(err.message)
  process.exitCode = 1
})
