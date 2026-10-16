'use strict'

const withDevice = require('../with-device')
const { guarded } = require('./guard')

module.exports = withDevice(async (device, params) => {
  if (typeof params.enabled !== 'boolean') {
    throw new Error('ERR_SET_LED_ENABLED_INVALID')
  }
  await guarded('setLED', {}, () => device.setLED(params.enabled))
  return { success: true, enabled: params.enabled }
})
