'use strict'

const withDevice = require('../with-device')
const { guarded } = require('./guard')

// LuxOS profile names: ASCII letters and digits plus '_', '-', '+', '.' and
// space, not starting or ending with a special character. None of these is
// the ',' that separates API parameters.
const PROFILE_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9_+. -]{0,62}[A-Za-z0-9])?$/

module.exports = withDevice(async (device, params) => {
  if (typeof params.profile !== 'string' || !PROFILE_NAME.test(params.profile)) {
    throw new Error('ERR_SET_PROFILE_INVALID')
  }
  await guarded('setProfile', {}, () => device.setProfile(params.profile))
  return { success: true, profile: params.profile }
})
