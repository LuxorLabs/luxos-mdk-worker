'use strict'

const net = require('node:net')
const test = require('brittle')
const { sendRequest, parseResponse, assertSuccess } = require('../../lib/tcp-api')

async function server (t, onConnection) {
  const sockets = new Set()
  const srv = net.createServer((socket) => {
    sockets.add(socket)
    onConnection(socket)
  })
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  t.teardown(() => new Promise((resolve) => {
    sockets.forEach((socket) => socket.destroy())
    srv.close(resolve)
  }))
  return { address: '127.0.0.1', port: srv.address().port }
}

test('sends one JSON request and parses the answer up to the NUL byte', async (t) => {
  let received
  const target = await server(t, (socket) => socket.on('data', (chunk) => {
    received = JSON.parse(chunk)
    socket.end('{"STATUS":[{"STATUS":"S"}],"id":1}\0')
  }))
  const body = await sendRequest(target, { command: 'summary' })
  t.alike(received, { command: 'summary' })
  t.is(body.id, 1)
})

test('a silent miner times out; a closed port is a connection error', async (t) => {
  const target = await server(t, () => {})
  await t.exception(sendRequest({ ...target, timeout: 50 }, { command: 'summary' }), /ERR_TCP_TIMEOUT/)

  const srv = net.createServer()
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  const { port } = srv.address()
  await new Promise((resolve) => srv.close(resolve))
  await t.exception(sendRequest({ address: '127.0.0.1', port, timeout: 1000 }, { command: 'summary' }), /ERR_TCP_CONNECTION: ECONNREFUSED/)
})

test('rejects answers that are not a JSON object', (t) => {
  t.exception(() => parseResponse(Buffer.from('STATUS=S,When=1|')), /ERR_API_RESPONSE_INVALID/)
  t.exception(() => parseResponse(Buffer.from('[1]\0')), /ERR_API_RESPONSE_INVALID/)
})

test('STATUS E becomes ERR_API_STATUS_ERROR with the firmware message', (t) => {
  t.exception(() => assertSuccess('ledset', { STATUS: [{ STATUS: 'E', Msg: 'Invalid session id' }] }), /ERR_API_STATUS_ERROR: ledset: Invalid session id/)
  t.exception(() => assertSuccess('summary', {}), /missing STATUS/)
  t.ok(assertSuccess('summary', { STATUS: [{ STATUS: 'S' }] }))
})
