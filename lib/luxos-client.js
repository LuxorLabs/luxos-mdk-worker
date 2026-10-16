'use strict'

const { sendRequest, assertSuccess } = require('./tcp-api')
const { DEFAULTS, SNAPSHOT_COMMANDS, POWER_MODE } = require('./constants')

/**
 * Client for one miner running LuxOS, over the TCP API.
 *
 * Reads: `getSnapshot()` reads every telemetry source in one multi-command
 * request and caches it for `cacheMs`. Concurrent readers share one request.
 * A failed command inside the snapshot fails only the channels that need it.
 *
 * Writes: LuxOS requires a session for configuration changes. `withSession`
 * opens one with `logon`, runs the write, and always drops it with `logoff`.
 * It never uses `kill`: a session held by another tool or operator is
 * reported as ERR_SESSION_BUSY and left alone.
 */
class LuxosClient {
  constructor (opts) {
    this.target = {
      address: opts.address,
      port: opts.port ?? DEFAULTS.PORT,
      timeout: opts.timeout ?? DEFAULTS.TIMEOUT_MS
    }
    this.cacheMs = opts.cacheMs ?? DEFAULTS.CACHE_MS
    this._snapshot = null
    this._failure = null
    this._inFlight = null
  }

  /** One command. Throws ERR_API_STATUS_ERROR when LuxOS answers STATUS E. */
  async request (command, parameter) {
    const body = await sendRequest(this.target, parameter === undefined ? { command } : { command, parameter })
    return assertSuccess(command, body)
  }

  /** @returns {Promise<Snapshot>} */
  getSnapshot () {
    if (this._snapshot && this._snapshot.at >= Date.now() - this.cacheMs) {
      return Promise.resolve(this._snapshot)
    }
    // MDK collects a metrics pull one handler at a time. Without this, an
    // unreachable miner would cost one full timeout per channel.
    if (this._failure && this._failure.at >= Date.now() - this.cacheMs) {
      return Promise.reject(this._failure.error)
    }
    if (!this._inFlight) {
      this._inFlight = this._readSnapshot()
        .catch((error) => {
          this._failure = { at: Date.now(), error }
          throw error
        })
        .finally(() => { this._inFlight = null })
    }
    return this._inFlight
  }

  async _readSnapshot () {
    const body = await sendRequest(this.target, { command: SNAPSHOT_COMMANDS.join('+') })
    const snapshot = new Snapshot(Date.now())
    for (const command of SNAPSHOT_COMMANDS) {
      const output = Array.isArray(body[command]) ? body[command][0] : undefined
      try {
        snapshot.outputs.set(command, assertSuccess(command, output))
      } catch (err) {
        snapshot.errors.set(command, err)
      }
    }
    this._snapshot = snapshot
    this._failure = null
    return snapshot
  }

  invalidate () {
    this._snapshot = null
    this._failure = null
  }

  async withSession (fn) {
    let sessionId
    try {
      const output = await this.request('logon')
      sessionId = output.SESSION?.[0]?.SessionID
    } catch (err) {
      if (/ERR_API_STATUS_ERROR/.test(err.message)) {
        throw new Error(`ERR_SESSION_BUSY: ${err.message.replace(/^ERR_API_STATUS_ERROR: logon: /, '')}`)
      }
      throw err
    }
    if (typeof sessionId !== 'string' || !sessionId) {
      throw new Error('ERR_API_RESPONSE_INVALID: logon.SessionID')
    }

    try {
      return await fn(sessionId)
    } finally {
      this.invalidate()
      // Best effort: after rebootdevice the miner may already be gone.
      await this.request('logoff', sessionId).catch(() => {})
    }
  }

  reboot () {
    return this.withSession((session) => this.request('rebootdevice', session))
  }

  /** Blinks the red LED to locate the miner, or returns it to automatic. */
  setLED (enabled) {
    const mode = enabled ? 'blink' : 'auto'
    return this.withSession((session) => this.request('ledset', `${session},red,${mode}`))
  }

  setPowerMode (mode) {
    const action = mode === POWER_MODE.SLEEP ? 'sleep' : 'wakeup'
    return this.withSession((session) => this.request('curtail', `${session},${action}`))
  }

  async listProfiles () {
    const output = await this.request('profiles')
    return (output.PROFILES || []).map((profile) => profile['Profile Name']).filter((name) => typeof name === 'string')
  }

  async setProfile (name) {
    const profiles = await this.listProfiles()
    if (!profiles.includes(name)) {
      throw new Error(`ERR_PROFILE_UNKNOWN: ${name}`)
    }
    return this.withSession((session) => this.request('profileset', `${session},${name}`))
  }

  /**
   * Replaces the pool list of a single-group miner.
   *
   * LuxOS pool IDs are positions in the pool list, and `addpool` appends to
   * the first group. The worker adds the new pools first, reads the list
   * again to confirm the old pools still hold positions 0..k-1 with the new
   * ones after them, and only then removes the old ones, highest position
   * first. If anything differs, it stops with the old pools still in place.
   */
  async setupPools (pools) {
    const before = poolRows(await this.request('pools'))
    if (before.some((pool) => (pool.GROUP ?? 0) !== 0)) {
      throw new Error('ERR_POOLS_GROUPS_UNSUPPORTED')
    }

    try {
      for (const [i, pool] of pools.entries()) {
        try {
          await this.request('addpool', `${pool.url},${pool.user},${pool.password ?? ''}`)
        } catch (err) {
          throw new Error(`ERR_POOLS_PARTIAL: added ${i} of ${pools.length} pools, old pools kept: ${err.message}`)
        }
      }

      const expected = [
        ...before.map((pool) => [pool.URL, pool.User]),
        ...pools.map((pool) => [pool.url, pool.user])
      ]
      const after = poolRows(await this.request('pools'))
      const isExpected = after.length === expected.length && after.every((pool, i) =>
        pool.POOL === i && pool.URL === expected[i][0] && pool.User === expected[i][1])
      if (!isExpected) {
        throw new Error('ERR_POOLS_PARTIAL: new pools added, but the pool list is not as expected; old pools kept')
      }

      for (let id = before.length - 1; id >= 0; id--) {
        try {
          await this.request('removepool', String(id))
        } catch (err) {
          throw new Error(`ERR_POOLS_PARTIAL: new pools added, removing old pool ${id} failed: ${err.message}`)
        }
      }
    } finally {
      this.invalidate()
    }

    return { success: true, added: pools.length, removed: before.length }
  }
}

function poolRows (output) {
  const rows = output.POOLS ?? []
  if (!Array.isArray(rows) || !rows.every((pool) => Number.isInteger(pool?.POOL))) {
    throw new Error('ERR_API_RESPONSE_INVALID: pools.POOL')
  }
  return [...rows].sort((a, b) => a.POOL - b.POOL)
}

/** Outputs of one snapshot request, keyed by command. */
class Snapshot {
  constructor (at) {
    this.at = at
    this.outputs = new Map()
    this.errors = new Map()
  }

  /** The output of `command`, or its error. */
  get (command) {
    if (this.errors.has(command)) throw this.errors.get(command)
    return this.outputs.get(command)
  }

  /** The output of `command`, or null when it failed. */
  optional (command) {
    return this.outputs.get(command) ?? null
  }
}

module.exports = { LuxosClient, Snapshot }
