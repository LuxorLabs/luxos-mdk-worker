'use strict'

const { id, opts, logger } = require('@tetherto/mdk-worker/device')
const { LuxosClient } = require('../lib/luxos-client')
const { DEFAULTS } = require('../lib/constants')

let client

function deviceConfig () {
  const address = opts.address || opts.host
  if (typeof address !== 'string' || !address) throw new Error('ERR_DEVICE_CONFIG_INVALID')
  const port = opts.port ?? DEFAULTS.PORT
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ERR_DEVICE_CONFIG_INVALID')
  const timeout = opts.timeout ?? DEFAULTS.TIMEOUT_MS
  if (!Number.isInteger(timeout) || timeout < 1) throw new Error('ERR_DEVICE_CONFIG_INVALID')
  return { address, port, timeout }
}

// WorkerRuntimeV2 loads this module once per device, so `client` belongs to
// the device this instance serves. The client opens a TCP connection per
// request, so there is nothing to connect up front.
function getDevice () {
  if (!client) {
    const config = deviceConfig()
    client = new LuxosClient(config)
    logger('device %s uses LuxOS API at %s:%d', id, config.address, config.port)
  }
  return client
}

module.exports = { getDevice }
