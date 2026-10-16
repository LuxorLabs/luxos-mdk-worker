'use strict'

const test = require('brittle')
const { LuxosClient } = require('../../lib/luxos-client')
const { createServer } = require('../../mock/luxos-server')

async function setup (t, options = {}) {
  const mock = createServer({ port: 0, ...options })
  const { port } = await mock.ready
  t.teardown(() => mock.close())
  const client = new LuxosClient({ address: '127.0.0.1', port, timeout: 2000 })
  return { mock, client }
}

test('concurrent readers share one multi-command snapshot request', async (t) => {
  const { mock, client } = await setup(t)
  const [a, b] = await Promise.all([client.getSnapshot(), client.getSnapshot()])
  t.is(a, b)
  t.is(mock.requests.length, 1)
  t.is(mock.requests[0].command, 'version+config+summary+devs+pools+temps+fans+power+events')
  await client.getSnapshot()
  t.is(mock.requests.length, 1, 'cached within cacheMs')
  client.invalidate()
  await client.getSnapshot()
  t.is(mock.requests.length, 2)
})

test('a failed command fails only its own section', async (t) => {
  const { client } = await setup(t, { failCommands: ['events'] })
  const snapshot = await client.getSnapshot()
  t.ok(snapshot.get('summary').SUMMARY)
  t.exception(() => snapshot.get('events'), /ERR_API_STATUS_ERROR: events/)
  t.is(snapshot.optional('events'), null)
})

test('writes open a session and always drop it', async (t) => {
  const { mock, client } = await setup(t)
  await client.setLED(true)
  t.is(mock.state.led.red, 'blink')
  t.is(mock.state.session, '', 'session dropped after the write')
  await client.setPowerMode('sleep')
  t.is(mock.state.config.CurtailMode, 'Sleep')
  await client.reboot()
  t.is(mock.state.reboots, 1)
  t.is(mock.state.session, '')
  t.alike(mock.requests.map((r) => r.command).slice(0, 3), ['logon', 'ledset', 'logoff'])
})

test('a session held by someone else is busy and is never killed', async (t) => {
  const { mock, client } = await setup(t)
  mock.state.session = 'operator'
  await t.exception(client.setLED(true), /ERR_SESSION_BUSY: Another session is active/)
  t.is(mock.state.session, 'operator')
  t.absent(mock.requests.some((r) => r.command === 'kill' || r.command === 'logoff'))
})

test('a failed write still drops the session', async (t) => {
  const { mock, client } = await setup(t, { failCommands: ['curtail'] })
  await t.exception(client.setPowerMode('sleep'), /ERR_API_STATUS_ERROR: curtail/)
  t.is(mock.state.session, '')
})

test('setProfile checks the profile exists before opening a session', async (t) => {
  const { mock, client } = await setup(t)
  await t.exception(client.setProfile('nope'), /ERR_PROFILE_UNKNOWN/)
  t.absent(mock.requests.some((r) => r.command === 'logon'))
  await client.setProfile('450MHz')
  t.is(mock.state.config.Profile, '450MHz')
})

test('setupPools adds new pools before removing old ones', async (t) => {
  const { mock, client } = await setup(t)
  mock.state.pools.push({ ...mock.state.pools[0], POOL: 1, Priority: 1 })
  const result = await client.setupPools([
    { url: 'stratum+tcp://new.example:700', user: 'acct.w1', password: 'x' },
    { url: 'stratum+tcp://backup.example:700', user: 'acct.w1' }
  ])
  t.alike(result, { success: true, added: 2, removed: 2 })
  t.alike(mock.state.pools.map((p) => p.URL), ['stratum+tcp://new.example:700', 'stratum+tcp://backup.example:700'])
  const order = mock.requests.map((r) => `${r.command}${r.parameter && r.command === 'removepool' ? ':' + r.parameter : ''}`)
  t.alike(order, ['pools', 'addpool', 'addpool', 'pools', 'removepool:1', 'removepool:0'])
})

test('setupPools refuses a multi-group pool list before writing', async (t) => {
  const { mock, client } = await setup(t)
  mock.state.pools.push({ ...mock.state.pools[0], POOL: 1, Priority: 1, GROUP: 1 })
  await t.exception(client.setupPools([{ url: 'stratum+tcp://new.example:700', user: 'u' }]), /ERR_POOLS_GROUPS_UNSUPPORTED/)
  t.alike(mock.requests.map((r) => r.command), ['pools'])
})

test('setupPools removes nothing when the list after adding is not as expected', async (t) => {
  const { mock, client } = await setup(t)
  const request = client.request.bind(client)
  let reads = 0
  client.request = async (command, parameter) => {
    const output = await request(command, parameter)
    // Second read: LuxOS reordered the list, so positions are not trustworthy.
    if (command === 'pools' && ++reads === 2) output.POOLS.reverse().forEach((pool, i) => { pool.POOL = i })
    return output
  }
  await t.exception(client.setupPools([{ url: 'stratum+tcp://new.example:700', user: 'u' }]), /ERR_POOLS_PARTIAL: new pools added, but the pool list is not as expected/)
  t.is(mock.state.pools.length, 2, 'old and new pools both kept')
  t.absent(mock.requests.some((r) => r.command === 'removepool'))
})

test('a failed snapshot is shared for cacheMs so a dead miner costs one timeout', async (t) => {
  const { client } = await setup(t)
  client.target.port = 1
  await t.exception(client.getSnapshot(), /ERR_TCP_CONNECTION/)
  let sent = 0
  const original = client._readSnapshot.bind(client)
  client._readSnapshot = () => { sent++; return original() }
  await t.exception(client.getSnapshot(), /ERR_TCP_CONNECTION/)
  t.is(sent, 0, 'the cached failure answers without a new request')
  client.invalidate()
  await t.exception(client.getSnapshot(), /ERR_TCP_CONNECTION/)
  t.is(sent, 1)
})

test('a failed add keeps the old pools and reports a partial change', async (t) => {
  const { mock, client } = await setup(t, { failCommands: ['addpool'] })
  await t.exception(client.setupPools([{ url: 'stratum+tcp://new.example:700', user: 'u' }]), /ERR_POOLS_PARTIAL: added 0 of 1 pools, old pools kept/)
  t.is(mock.state.pools.length, 1)
  t.absent(mock.requests.some((r) => r.command === 'removepool'))
})
