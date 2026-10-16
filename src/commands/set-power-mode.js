'use strict'

const withDevice = require('../with-device')
const { guarded } = require('./guard')
const { POWER_MODE } = require('../../lib/constants')

const MODES = Object.values(POWER_MODE)

module.exports = withDevice(async (device, params) => {
  if (!MODES.includes(params.mode)) {
    throw new Error('ERR_SET_POWER_MODE_INVALID')
  }
  await guarded('setPowerMode', {}, () => device.setPowerMode(params.mode))
  return { success: true, mode: params.mode }
})
