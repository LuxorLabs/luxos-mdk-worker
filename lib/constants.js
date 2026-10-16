'use strict'

const DEFAULTS = {
  PORT: 4028,
  TIMEOUT_MS: 10000,
  // A metrics pull calls every telemetry handler at once. They share one
  // snapshot request instead of one TCP request each.
  CACHE_MS: 2000,
  MAX_RESPONSE_BYTES: 4 * 1024 * 1024,
  REBOOT_COOLDOWN_MS: 5 * 60 * 1000,
  MAX_POOLS: 3
}

// Parameterless commands read together in one multi-command request.
const SNAPSHOT_COMMANDS = ['version', 'config', 'summary', 'devs', 'pools', 'temps', 'fans', 'power', 'events']

const STATUS = {
  ERROR: 'error',
  SLEEPING: 'sleeping',
  MINING: 'mining',
  NOT_MINING: 'not_mining'
}

const POWER_MODE = {
  NORMAL: 'normal',
  SLEEP: 'sleep'
}

module.exports = { DEFAULTS, SNAPSHOT_COMMANDS, STATUS, POWER_MODE }
