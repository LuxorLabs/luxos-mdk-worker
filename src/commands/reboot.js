'use strict'

const withDevice = require('../with-device')
const { guarded } = require('./guard')
const { DEFAULTS } = require('../../lib/constants')

module.exports = withDevice(async (device) => {
  await guarded('reboot', { cooldownMs: DEFAULTS.REBOOT_COOLDOWN_MS }, () => device.reboot())
  return { success: true }
})
