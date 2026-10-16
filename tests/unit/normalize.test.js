'use strict'

const test = require('brittle')
const n = require('../../lib/normalize')
const defaultState = require('../../mock/state')

function outputs (state = defaultState()) {
  return {
    version: { VERSION: [state.version] },
    config: { CONFIG: [state.config] },
    summary: { SUMMARY: [state.summary] },
    devs: { DEVS: state.devs },
    pools: { POOLS: state.pools },
    temps: state.temps,
    fans: { FANS: state.fans },
    power: { POWER: [state.power] },
    events: { EVENTS: state.events }
  }
}

test('converts API units to TH/s, W/TH and seconds', (t) => {
  const o = outputs()
  t.is(n.hashrateRt(o.summary), 140.25)
  t.is(n.hashrateAvg(o.summary), 139.5)
  t.is(n.hashrateIdeal(o.devs), 140)
  t.is(n.power(o.power), 3010)
  t.is(n.efficiency(o.power, o.summary), 21.53)
  t.is(n.temperature(o.devs), 72)
  t.is(n.uptime(o.summary), 2330)
})

test('a missing reading is an error, not zero', (t) => {
  const o = outputs()
  delete o.summary.SUMMARY[0]['GHS 5s']
  t.exception(() => n.hashrateRt(o.summary), /ERR_API_RESPONSE_INVALID: summary.GHS 5s/)
  t.exception(() => n.power({ POWER: [] }), /ERR_API_RESPONSE_INVALID/)
  const state = defaultState()
  state.pools[0].Rejected = 'unknown'
  t.exception(() => n.pools(outputs(state).pools), /pools.Rejected/)
  delete state.devs[1]['Hardware Errors']
  t.exception(() => n.hashboards(outputs(state).devs, null), /devs.Hardware Errors/)
})

test('efficiency is null while not hashing', (t) => {
  const state = defaultState()
  state.summary['GHS 30m'] = 0
  const o = outputs(state)
  t.is(n.efficiency(o.power, o.summary), null)
})

test('machines without fans report an empty fan list', (t) => {
  t.alike(n.fans({ STATUS: [{ STATUS: 'S' }] }), [])
  t.is(n.fans(outputs().fans)[0].rpm, 3900)
})

test('status: events win, then curtailment, then hashrate', (t) => {
  const state = defaultState()
  t.is(n.status(outputs(state)), 'mining')
  t.is(n.status({ ...outputs(state), events: null }), 'mining', 'firmware without events still reports a status')
  state.config.CurtailMode = 'Sleep'
  t.is(n.status(outputs(state)), 'sleeping')
  t.is(n.powerMode(outputs(state).config), 'sleep')
  state.events = [{ Code: 'FAN_FAILURE', Description: 'Fan failure', Target: 'FAN', ID: 2 }]
  t.is(n.status(outputs(state)), 'error')
  t.alike(n.errors(outputs(state).events)[0], { code: 'FAN_FAILURE', description: 'Fan failure', details: null, target: 'FAN', target_id: 2, created_at: null, doc_url: null })
  state.config.CurtailMode = 'None'
  state.events = []
  state.summary['GHS 5s'] = 0
  t.is(n.status(outputs(state)), 'not_mining')
})

test('pools are sorted by priority and pool_url prefers an alive pool', (t) => {
  const state = defaultState()
  state.pools = [
    { POOL: 1, Priority: 1, URL: 'stratum+tcp://b:1', User: 'u', Status: 'Alive', Accepted: 0, Rejected: 0, Stale: 0 },
    { POOL: 0, Priority: 0, URL: 'stratum+tcp://a:1', User: 'u', Status: 'Dead', Accepted: 0, Rejected: 0, Stale: 0 }
  ]
  const o = outputs(state)
  t.alike(n.pools(o.pools).map((pool) => pool.index), [0, 1])
  t.is(n.poolUrl(o.pools), 'stratum+tcp://b:1')
  state.pools[0].Status = 'Dead'
  t.is(n.poolUrl(outputs(state).pools), 'stratum+tcp://a:1')
  t.is(n.poolUrl({ POOLS: [] }), null)
})

test('hashboards carry labeled sensor readings from temps', (t) => {
  const [board] = n.hashboards(outputs().devs, outputs().temps)
  t.is(board.hashrate_rt_ths, 46.75)
  t.is(board.enabled, true)
  t.alike(board.sensors_c, { 'Board Outlet': 58, 'Chip Outlet': 70, 'Board Inlet': 45, 'Chip Inlet': 60 })
  t.alike(n.hashboards(outputs().devs, null)[0].sensors_c, {})
})

test('device and firmware info', (t) => {
  const o = outputs()
  t.is(n.deviceInfo(o.config, o.version).model, 'Antminer S19 XP')
  t.is(n.deviceInfo(o.config, o.version).cooling, 'Air')
  t.is(n.firmwareInfo(o.version, o.config).version, '2026.9.21.131955-0a1b2c3d')
  t.is(n.firmwareInfo(o.version, null).os, null)
})
