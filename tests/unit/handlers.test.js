'use strict'

const test = require('brittle')
const { WORKER_DIR, loadContract, createInstance } = require('../helpers')
const { createServer } = require('../../mock/luxos-server')

const { entries } = loadContract(WORKER_DIR)

async function setup (t, opts = {}) {
  const mock = createServer({ port: 0 })
  const { port } = await mock.ready
  t.teardown(() => mock.close())
  const instance = createInstance({
    dir: WORKER_DIR,
    entries,
    device: { id: 'luxos-0', opts: { address: '127.0.0.1', port, ...opts } }
  })
  return { mock, instance }
}

const quiet = (t) => {
  const info = console.info
  console.info = () => {}
  t.teardown(() => { console.info = info })
}

test('every contract handler loads and the telemetry channels answer', async (t) => {
  const { instance } = await setup(t)
  const values = {}
  for (const [name, fn] of instance.telemetry) values[name] = await fn({})
  t.is(values.hashrate_rt, 140.25)
  t.is(values.status, 'mining')
  t.is(values.power_mode, 'normal')
  t.is(values.profile, 'default')
  t.is(values.fans.length, 4)
  t.is(values.hashboards.length, 3)
  t.alike(values.errors.map((e) => [e.code, e.severity]), [['MINER_TUNED', 'Info']], 'a tuned miner keeps an Info event and still reports mining')
  t.is(values.pool_url, 'stratum+tcp://btc.global.luxor.tech:700')
  t.is(values.snap.stats.hashrate_ths.ideal, 140)
  t.is(values.health.status, 'OK')
})

test('commands validate parameters before touching the miner', async (t) => {
  quiet(t)
  const { mock, instance } = await setup(t)
  const run = (name, params) => instance.commands.get(name)(params)
  await t.exception(run('setLED', { enabled: 'yes' }), /ERR_SET_LED_ENABLED_INVALID/)
  await t.exception(run('setPowerMode', { mode: 'turbo' }), /ERR_SET_POWER_MODE_INVALID/)
  await t.exception(run('setProfile', { profile: 'a,b' }), /ERR_SET_PROFILE_INVALID/)
  await t.exception(run('setProfile', { profile: ' eco' }), /ERR_SET_PROFILE_INVALID/)
  await t.exception(run('setProfile', { profile: 'eco+' }), /ERR_SET_PROFILE_INVALID/)
  await t.exception(run('setupPools', { pools: [] }), /ERR_POOLS_INVALID/)
  await t.exception(run('setupPools', { pools: [{ url: 'http://x', user: 'u' }] }), /ERR_POOLS_INVALID/)
  await t.exception(run('setupPools', { pools: [{ url: 'stratum+tcp://x:1', user: 'a,b' }] }), /ERR_POOLS_INVALID/)
  t.is(mock.requests.length, 0)
})

test('commands change the miner and accept Antminer-style pool fields', async (t) => {
  quiet(t)
  const { mock, instance } = await setup(t)
  const run = (name, params) => instance.commands.get(name)(params)
  t.alike(await run('setLED', { enabled: true }), { success: true, enabled: true })
  await run('setPowerMode', { mode: 'sleep' })
  t.is(await instance.telemetry.get('status')({}), 'sleeping', 'writes invalidate the cached snapshot')
  await run('setProfile', { profile: '750MHz' })
  t.is(mock.state.config.Profile, '750MHz')
  mock.state.profiles.push('summer eco', 'eco+1')
  await run('setProfile', { profile: 'summer eco' })
  await run('setProfile', { profile: 'eco+1' })
  t.is(mock.state.config.Profile, 'eco+1', 'LuxOS names may contain spaces and plus signs')
  await run('setupPools', { pools: [{ url: 'stratum+tcp://new.example:700', worker_name: 'acct.w', worker_password: 'x' }] })
  t.is(mock.state.pools[0].User, 'acct.w')
})

test('reboot has a cooldown that every attempt consumes', async (t) => {
  quiet(t)
  const { mock, instance } = await setup(t)
  const reboot = instance.commands.get('reboot')
  await reboot({})
  await t.exception(reboot({}), /ERR_COMMAND_COOLDOWN/)
  t.is(mock.state.reboots, 1)
})

test('bad device config fails the handler, not the load', async (t) => {
  const { instance } = await setup(t, { port: 'x' })
  await t.exception(instance.telemetry.get('power')({}), /ERR_DEVICE_CONFIG_INVALID/)
})
