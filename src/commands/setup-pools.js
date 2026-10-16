'use strict'

const withDevice = require('../with-device')
const { guarded } = require('./guard')
const { DEFAULTS } = require('../../lib/constants')

// Values go into a comma-separated API parameter, so commas and control
// characters cannot be sent safely.
const isSafe = (value) => typeof value === 'string' &&
  [...value].every((char) => char !== ',' && char.charCodeAt(0) >= 0x20)

// Accepts `user`/`password` and the Antminer worker's `worker_name`/`worker_password`.
function normalizePool (pool) {
  if (!pool || typeof pool !== 'object') return null
  return { url: pool.url, user: pool.user ?? pool.worker_name, password: pool.password ?? pool.worker_password }
}

function validatePools (input) {
  const isList = Array.isArray(input) && input.length >= 1 && input.length <= DEFAULTS.MAX_POOLS
  const pools = isList ? input.map(normalizePool) : []
  const valid = isList && pools.every((pool) =>
    pool !== null &&
    isSafe(pool.url) && /^stratum(\+tcp|\+ssl|2\+tcp)?:\/\/\S+$/.test(pool.url) &&
    isSafe(pool.user) && pool.user.length > 0 &&
    (pool.password === undefined || isSafe(pool.password))
  )
  if (!valid) throw new Error('ERR_POOLS_INVALID')
  return pools
}

module.exports = withDevice(async (device, params) => {
  const pools = validatePools(params.pools)
  return guarded('setupPools', {}, () => device.setupPools(pools))
})
