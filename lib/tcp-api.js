'use strict'

const net = require('node:net')
const { DEFAULTS } = require('./constants')

/**
 * One request on the LuxOS TCP API (port 4028). The protocol follows the
 * CGMiner API: the client sends one JSON object, the miner answers and closes
 * the connection. Some builds end the answer with a NUL byte.
 *
 * Errors carry stable codes:
 *   ERR_TCP_TIMEOUT          no complete answer within `timeout`
 *   ERR_TCP_CONNECTION       connect failed or the socket broke
 *   ERR_API_RESPONSE_INVALID the answer is not a JSON object or is too large
 *
 * For a write, a timeout or broken connection means the outcome is unknown.
 * Callers must not retry writes automatically.
 *
 * @param {{ address: string, port?: number, timeout?: number }} target
 * @param {{ command: string, parameter?: string }} request
 * @returns {Promise<object>}
 */
function sendRequest (target, request) {
  const { address, port = DEFAULTS.PORT, timeout = DEFAULTS.TIMEOUT_MS } = target

  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false

    const socket = net.createConnection({ host: address, port })
    const timer = setTimeout(() => fail('ERR_TCP_TIMEOUT'), timeout)

    function finish (err, value) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      err ? reject(err) : resolve(value)
    }

    function fail (code, detail) {
      finish(new Error(detail ? `${code}: ${detail}` : code))
    }

    socket.on('connect', () => socket.write(JSON.stringify(request)))
    socket.on('data', (chunk) => {
      size += chunk.length
      if (size > DEFAULTS.MAX_RESPONSE_BYTES) return fail('ERR_API_RESPONSE_INVALID', 'response too large')
      chunks.push(chunk)
    })
    socket.on('error', (err) => fail('ERR_TCP_CONNECTION', err.code || 'socket error'))
    socket.on('end', () => {
      try {
        finish(null, parseResponse(Buffer.concat(chunks)))
      } catch (err) {
        finish(err)
      }
    })
  })
}

function parseResponse (buffer) {
  const text = buffer.toString('utf8').replace(/\0+$/, '').trim()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error('ERR_API_RESPONSE_INVALID: not JSON')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('ERR_API_RESPONSE_INVALID: not an object')
  }
  return body
}

/**
 * The STATUS block of one command output, checked for success.
 * @returns {object} the output itself
 */
function assertSuccess (command, output) {
  const status = Array.isArray(output?.STATUS) ? output.STATUS[0] : null
  if (!status || (status.STATUS !== 'S' && status.STATUS !== 'I')) {
    const message = typeof status?.Msg === 'string' ? status.Msg : 'missing STATUS'
    throw new Error(`ERR_API_STATUS_ERROR: ${command}: ${message}`)
  }
  return output
}

module.exports = { sendRequest, parseResponse, assertSuccess }
