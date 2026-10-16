'use strict'

const withDevice = require('../with-device')

/**
 * Builds a telemetry handler from the snapshot sections it needs. Required
 * sections throw their own error; optional ones are null when they failed.
 */
module.exports = (required, optional, fn) => withDevice(async (device) => {
  const snapshot = await device.getSnapshot()
  const sections = {}
  for (const name of required) sections[name] = snapshot.get(name)
  for (const name of optional) sections[name] = snapshot.optional(name)
  return fn(sections)
})
