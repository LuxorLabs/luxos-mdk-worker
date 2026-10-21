'use strict'

const net = require('node:net')
const { randomBytes } = require('node:crypto')
const defaultState = require('./state')

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 14028
const LED_MODES = ['auto', 'on', 'off', 'blink']
const SESSION_COMMANDS = new Set(['rebootdevice', 'ledset', 'curtail', 'profileset', 'logoff'])

/**
 * Stateful fake of the LuxOS TCP API. It reads one JSON request per
 * connection, answers in the documented shape, ends the answer with a NUL
 * byte like CGMiner, and closes the connection. Writes change `state`, and
 * every request is recorded in `requests`.
 *
 * Sessions behave like LuxOS: `logon` fails while a session is active, and
 * session commands fail without the active session ID.
 */
function createServer (options = {}) {
  const { host = DEFAULT_HOST, port = DEFAULT_PORT, state = defaultState(), failCommands = [] } = options
  const requests = []
  const failing = new Set(failCommands)

  const server = net.createServer((socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk
      let request
      try {
        request = JSON.parse(buffer)
      } catch {
        return // wait for the rest of the request
      }
      requests.push(request)
      socket.end(JSON.stringify(respond(state, request, failing)) + '\0')
    })
    socket.on('error', () => {})
  })

  const ready = new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve(server.address()))
  })

  return {
    server,
    state,
    requests,
    ready,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}

function status (code, msg, ok = true) {
  return { STATUS: [{ Code: code, Description: 'LUXminer mock', Msg: msg, STATUS: ok ? 'S' : 'E', When: Math.floor(Date.now() / 1000) }], id: 1 }
}

const fail = (msg) => status(14, msg, false)

function respond (state, { command, parameter }, failing) {
  if (typeof command !== 'string') return fail('Missing command')

  if (command.includes('+')) {
    if (parameter !== undefined) return fail('Multiple commands take no parameter')
    const result = { id: 1 }
    for (const name of command.split('+')) result[name] = [run(state, name, [], failing)]
    return result
  }

  const params = typeof parameter === 'string' ? parameter.split(',') : []
  return run(state, command, params, failing)
}

function run (state, command, params, failing) {
  if (failing.has(command)) return fail(`Mock failure: ${command}`)

  if (SESSION_COMMANDS.has(command)) {
    if (!state.session || params[0] !== state.session) return fail('Invalid session id')
  }

  switch (command) {
    case 'version': return { ...status(22, 'LUXminer versions'), VERSION: [state.version] }
    case 'config': return { ...status(33, 'Configuration'), CONFIG: [state.config] }
    case 'summary': return { ...status(11, 'Summary'), SUMMARY: [state.summary] }
    case 'devs': return { ...status(9, `${state.devs.length} ASC(s)`), DEVS: state.devs }
    case 'pools': return { ...status(7, `${state.pools.length} Pool(s)`), POOLS: state.pools }
    case 'temps': return { ...status(201, 'Temps'), ...state.temps }
    case 'fans': return state.config.Cooling === 'Air'
      ? { ...status(202, `${state.fans.length} Fan(s)`), FANS: state.fans }
      : status(202, '0 Fan(s)')
    case 'power': return { ...status(311, 'Power usage'), POWER: [state.power] }
    case 'events': return { ...status(357, 'Miner Events'), EVENTS: state.events }
    case 'profiles':
      return { ...status(323, 'List profiles'), PROFILES: state.profiles.map((name) => ({ 'Profile Name': name })) }
    case 'session': return { ...status(319, 'Session information'), SESSION: [{ SessionID: state.session }] }
    case 'logon':
      if (state.session) return fail('Another session is active')
      state.session = randomBytes(6).toString('base64url')
      return { ...status(316, 'Session created'), SESSION: [{ SessionID: state.session }] }
    case 'logoff':
      state.session = ''
      return status(317, 'Session dropped')
    case 'rebootdevice':
      state.reboots++
      state.summary.Elapsed = 0
      return status(328, 'Rebooting device')
    case 'ledset': {
      const [, color, mode] = params
      if (!['red', 'green'].includes(color) || !LED_MODES.includes(mode)) return fail('Invalid LED parameters')
      state.led[color] = mode
      state.config[color === 'red' ? 'RedLed' : 'GreenLed'] = mode
      return status(320, 'LED mode set')
    }
    case 'curtail': {
      const action = params[1]
      if (action === 'sleep') state.config.CurtailMode = 'Sleep'
      else if (action === 'wakeup') state.config.CurtailMode = 'WakeUp'
      else return fail('Invalid curtail action')
      return { ...status(335, 'Curtailment command sent'), CURTAIL: [{ Action: action === 'sleep' ? 'sleep mode' : 'wake up' }] }
    }
    case 'profileset': {
      const name = params[1]
      if (!state.profiles.includes(name)) return fail(`Profile not found: ${name}`)
      state.config.Profile = name
      return { ...status(321, 'Profile Set'), PROFILE: [{ Profile: name }] }
    }
    case 'addpool': {
      const [url, user, password = ''] = params
      if (!url || !user) return fail('Invalid pool parameters')
      // Like LuxOS: append to the first group; IDs are list positions.
      const lastInFirstGroup = state.pools.findLastIndex((pool) => (pool.GROUP ?? 0) === 0)
      const row = { GROUP: 0, URL: url, User: user, Status: 'Alive', 'Stratum Active': false, Accepted: 0, Rejected: 0, Stale: 0, Quota: 1 }
      state.pools.splice(lastInFirstGroup + 1, 0, row)
      renumber(state.pools)
      // The API never returns pool passwords; keep them aside for tests.
      state.poolPasswords = { ...state.poolPasswords, [url]: password }
      return status(55, `Added pool ${row.POOL}: '${url}'`)
    }
    case 'removepool': {
      const id = Number(params[0])
      const index = state.pools.findIndex((pool) => pool.POOL === id)
      if (index === -1) return fail(`Invalid pool id ${params[0]}`)
      state.pools.splice(index, 1)
      renumber(state.pools)
      return status(68, `Removed pool ${id}`)
    }
    default:
      return fail(`Invalid command: ${command}`)
  }
}

function renumber (pools) {
  pools.forEach((pool, i) => {
    pool.POOL = i
    pool.Priority = i
  })
}

if (require.main === module) {
  const port = Number(process.env.PORT || DEFAULT_PORT)
  const mock = createServer({ port })
  mock.ready.then((address) => {
    console.log(`LuxOS mock listening on ${address.address}:${address.port}`)
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => mock.close())
  }).catch((err) => {
    console.error(err.message)
    process.exitCode = 1
  })
}

module.exports = { createServer }
