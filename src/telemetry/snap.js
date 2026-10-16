'use strict'

const withDevice = require('../with-device')
const n = require('../../lib/normalize')

// Every field is computed on its own, so one failed source reports
// `{ error }` in its place instead of failing the whole snapshot.
function attempt (fn) {
  try {
    return fn()
  } catch (err) {
    return { error: err.message }
  }
}

module.exports = withDevice(async (device) => {
  const snapshot = await device.getSnapshot()
  const get = (name) => snapshot.get(name)
  return {
    stats: {
      status: attempt(() => n.status({ config: get('config'), summary: get('summary'), events: snapshot.optional('events') })),
      uptime_s: attempt(() => n.uptime(get('summary'))),
      power_w: attempt(() => n.power(get('power'))),
      efficiency_w_th: attempt(() => n.efficiency(get('power'), get('summary'))),
      hashrate_ths: {
        rt: attempt(() => n.hashrateRt(get('summary'))),
        avg: attempt(() => n.hashrateAvg(get('summary'))),
        ideal: attempt(() => n.hashrateIdeal(get('devs')))
      },
      temperature_c: { max: attempt(() => n.temperature(get('devs'))) },
      fans: attempt(() => n.fans(get('fans'))),
      hashboards: attempt(() => n.hashboards(get('devs'), snapshot.optional('temps'))),
      pools: attempt(() => n.pools(get('pools'))),
      errors: attempt(() => n.errors(get('events'))),
      shares: {
        accepted: attempt(() => n.acceptedShares(get('summary'))),
        rejected: attempt(() => n.rejectedShares(get('summary')))
      }
    },
    config: {
      power_mode: attempt(() => n.powerMode(get('config'))),
      profile: attempt(() => n.profile(get('config'))),
      device: attempt(() => n.deviceInfo(get('config'), get('version'))),
      firmware: attempt(() => n.firmwareInfo(get('version'), snapshot.optional('config')))
    },
    ts: snapshot.at
  }
})
