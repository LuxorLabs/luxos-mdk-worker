'use strict'

const { id } = require('@tetherto/mdk-worker/device')

// WorkerRuntimeV2 loads this module once per device, so this state is
// already scoped to one device.
const running = new Set()
const lastAttemptAt = new Map()

function audit (command, outcome, errorCode) {
  console.info(JSON.stringify({
    event: 'physical_command',
    command,
    deviceId: id,
    outcome,
    ...(errorCode ? { errorCode } : {})
  }))
}

/**
 * Runs one physical write with an audit line, one-at-a-time per command and
 * an optional cooldown. The cooldown starts before device I/O: a timed-out
 * write may still have reached the miner.
 */
async function guarded (command, { cooldownMs = 0 } = {}, fn) {
  if (running.has(command)) {
    audit(command, 'rejected', 'ERR_COMMAND_IN_PROGRESS')
    throw new Error(`ERR_COMMAND_IN_PROGRESS: ${command}`)
  }

  const remaining = cooldownMs - (Date.now() - (lastAttemptAt.get(command) ?? -Infinity))
  if (remaining > 0) {
    audit(command, 'rejected', 'ERR_COMMAND_COOLDOWN')
    throw new Error(`ERR_COMMAND_COOLDOWN: ${command} ${remaining}ms`)
  }

  lastAttemptAt.set(command, Date.now())
  running.add(command)
  audit(command, 'started')
  try {
    const result = await fn()
    audit(command, 'succeeded')
    return result
  } catch (err) {
    audit(command, 'failed', /ERR_[A-Z0-9_]+/.exec(err?.message)?.[0] || 'ERR_COMMAND_FAILED')
    throw err
  } finally {
    running.delete(command)
  }
}

module.exports = { guarded }
