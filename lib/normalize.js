'use strict'

const { STATUS, POWER_MODE } = require('./constants')

// Pure mapping from LuxOS API sections to MDK telemetry values. Each function
// takes the outputs it needs and throws ERR_API_RESPONSE_INVALID when a field
// it depends on is missing, so a missing reading never becomes a zero.

const round2 = (value) => Math.round(value * 100) / 100

function first (output, key, command) {
  const rows = output?.[key]
  if (!Array.isArray(rows) || rows.length === 0 || !rows[0] || typeof rows[0] !== 'object') {
    throw new Error(`ERR_API_RESPONSE_INVALID: ${command}.${key}`)
  }
  return rows[0]
}

function rows (output, key, command, { optional = false } = {}) {
  const value = output?.[key]
  if (value === undefined && optional) return []
  if (!Array.isArray(value)) {
    throw new Error(`ERR_API_RESPONSE_INVALID: ${command}.${key}`)
  }
  return value
}

function num (value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`ERR_API_RESPONSE_INVALID: ${field}`)
  }
  return value
}

function str (value) {
  return typeof value === 'string' ? value : null
}

const summaryOf = (summary) => first(summary, 'SUMMARY', 'summary')
const configOf = (config) => first(config, 'CONFIG', 'config')

/** TH/s over the last 5 seconds. */
function hashrateRt (summary) {
  return round2(num(summaryOf(summary)['GHS 5s'], 'summary.GHS 5s') / 1000)
}

/** TH/s since the miner application started. */
function hashrateAvg (summary) {
  return round2(num(summaryOf(summary)['GHS av'], 'summary.GHS av') / 1000)
}

/** TH/s over the last 30 minutes, the base for efficiency. */
function hashrate30m (summary) {
  return num(summaryOf(summary)['GHS 30m'], 'summary.GHS 30m') / 1000
}

/** Sum of the boards' nominal hashrate, TH/s. */
function hashrateIdeal (devs) {
  const boards = rows(devs, 'DEVS', 'devs')
  const total = boards.reduce((sum, board) => sum + num(board['Nominal MHS'], 'devs.Nominal MHS'), 0)
  return round2(total / 1e6)
}

/** Watts, measured by newer PSUs and estimated for older ones. */
function power (powerOutput) {
  return num(first(powerOutput, 'POWER', 'power').Watts, 'power.Watts')
}

/** W/TH from power and the 30-minute hashrate. Null while not hashing. */
function efficiency (powerOutput, summary) {
  const ths = hashrate30m(summary)
  if (ths <= 0) return null
  return round2(power(powerOutput) / ths)
}

/** Highest board temperature, °C. Null when no board reports one. */
function temperature (devs) {
  const temps = rows(devs, 'DEVS', 'devs')
    .map((board) => board.Temperature)
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
  return temps.length ? Math.max(...temps) : null
}

/**
 * Fan speeds. Hydro and immersion machines have no FANS section, which is an
 * empty list, not an error.
 */
function fans (fansOutput) {
  return rows(fansOutput, 'FANS', 'fans', { optional: true }).map((fan) => ({
    index: num(fan.ID, 'fans.ID'),
    rpm: num(fan.RPM, 'fans.RPM'),
    speed_pct: typeof fan.Speed === 'number' ? fan.Speed : null,
    connector: str(fan.FAN)
  }))
}

function uptime (summary) {
  return num(summaryOf(summary).Elapsed, 'summary.Elapsed')
}

function powerMode (config) {
  return configOf(config).CurtailMode === 'Sleep' ? POWER_MODE.SLEEP : POWER_MODE.NORMAL
}

function profile (config) {
  return str(configOf(config).Profile)
}

function acceptedShares (summary) {
  return num(summaryOf(summary).Accepted, 'summary.Accepted')
}

function rejectedShares (summary) {
  return num(summaryOf(summary).Rejected, 'summary.Rejected')
}

/** Pools in priority order. The API never returns pool passwords. */
function pools (poolsOutput) {
  return rows(poolsOutput, 'POOLS', 'pools')
    .map((pool) => ({
      index: num(pool.POOL, 'pools.POOL'),
      priority: typeof pool.Priority === 'number' ? pool.Priority : pool.POOL,
      group: typeof pool.GROUP === 'number' ? pool.GROUP : null,
      url: str(pool.URL),
      user: str(pool.User),
      status: str(pool.Status),
      stratum_active: pool['Stratum Active'] === true,
      accepted: num(pool.Accepted, 'pools.Accepted'),
      rejected: num(pool.Rejected, 'pools.Rejected'),
      stale: num(pool.Stale, 'pools.Stale')
    }))
    .sort((a, b) => a.priority - b.priority)
}

/** URL of the first alive pool, else the first configured pool. */
function poolUrl (poolsOutput) {
  const list = pools(poolsOutput)
  const alive = list.find((pool) => pool.status === 'Alive')
  return (alive || list[0])?.url ?? null
}

/**
 * Per-board state. Sensor readings from `temps` are matched by board ID and
 * named with the labels from its METADATA block (e.g. "Board Inlet").
 */
function hashboards (devs, temps) {
  const sensors = boardSensors(temps)
  return rows(devs, 'DEVS', 'devs').map((board) => {
    const id = num(board.ID, 'devs.ID')
    return {
      index: id,
      connector: str(board.Connector),
      status: str(board.Status),
      enabled: board.Enabled === 'Y',
      profile: str(board.Profile),
      serial_number: str(board.SerialNumber),
      hashrate_rt_ths: round2(num(board['MHS 5s'], 'devs.MHS 5s') / 1e6),
      hashrate_avg_ths: round2(num(board['MHS av'], 'devs.MHS av') / 1e6),
      hashrate_ideal_ths: round2(num(board['Nominal MHS'], 'devs.Nominal MHS') / 1e6),
      temperature_c: typeof board.Temperature === 'number' ? board.Temperature : null,
      sensors_c: sensors.get(id) || {},
      hardware_errors: num(board['Hardware Errors'], 'devs.Hardware Errors'),
      is_ramping: board.IsRamping === true,
      is_user_shutdown: board.IsUserShutdown === true
    }
  })
}

function boardSensors (temps) {
  const result = new Map()
  if (!temps) return result
  const metadata = Array.isArray(temps.METADATA) ? temps.METADATA[0] || {} : {}
  for (const row of rows(temps, 'TEMPS', 'temps', { optional: true })) {
    const readings = {}
    for (const [position, info] of Object.entries(metadata)) {
      if (typeof row[position] === 'number') {
        readings[info?.Label || position] = row[position]
      }
    }
    result.set(row.ID, readings)
  }
  return result
}

/** Active LuxOS events. An empty list means no active problem. */
function errors (events) {
  return rows(events, 'EVENTS', 'events', { optional: true }).map((event) => ({
    code: str(event.Code),
    description: str(event.Description),
    severity: str(event.Severity),
    details: str(event.Details),
    target: str(event.Target),
    target_id: typeof event.ID === 'number' ? event.ID : null,
    created_at: str(event.CreatedAt),
    doc_url: str(event.DocUrl)
  }))
}

/**
 * error when LuxOS reports an active event not marked Info severity, sleeping
 * when curtailed, else mining or not_mining from the 5-second hashrate. An
 * event without a severity counts as an error: firmware that does not send
 * one only lists problems. `events` is null on firmware without the events
 * command.
 */
function status ({ config, summary, events }) {
  if (events && errors(events).some((e) => e.severity?.toLowerCase() !== 'info')) return STATUS.ERROR
  if (powerMode(config) === POWER_MODE.SLEEP) return STATUS.SLEEPING
  return hashrateRt(summary) > 0 ? STATUS.MINING : STATUS.NOT_MINING
}

function deviceInfo (config, version) {
  const conf = configOf(config)
  return {
    model: str(conf.Model) ?? str(first(version, 'VERSION', 'version').Type),
    serial_number: str(conf.SerialNumber),
    mac: str(conf.MACAddr),
    ip: str(conf.IPAddr),
    hostname: str(conf.Hostname),
    dhcp: typeof conf.DHCP === 'boolean' ? conf.DHCP : null,
    control_board: str(conf.ControlBoardType),
    cooling: str(conf.Cooling),
    psu: str(conf.PSULabel),
    nameplate_ths: typeof conf.NameplateTHS === 'number' ? conf.NameplateTHS : null
  }
}

function firmwareInfo (version, config) {
  const ver = first(version, 'VERSION', 'version')
  const conf = config ? configOf(config) : {}
  return {
    firmware: 'LuxOS',
    version: str(ver.LUXminer),
    api_version: str(ver.API),
    compile_time: str(ver.CompileTime),
    type: str(ver.Type),
    os: str(conf.OS)
  }
}

module.exports = {
  hashrateRt,
  hashrateAvg,
  hashrateIdeal,
  power,
  efficiency,
  temperature,
  fans,
  uptime,
  powerMode,
  profile,
  acceptedShares,
  rejectedShares,
  pools,
  poolUrl,
  hashboards,
  errors,
  status,
  deviceInfo,
  firmwareInfo
}
