import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'

import { createAppServer } from '../server.mjs'

let server
let baseUrl

before(async () => {
  server = createAppServer({ logger: () => {} })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  baseUrl = `http://127.0.0.1:${port}`
})

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

test('serves the rebuildable dashboard shell', async () => {
  const response = await fetch(`${baseUrl}/`)
  const html = await response.text()

  assert.equal(response.status, 200)
  assert.match(html, /Hermes Autopilot/)
  assert.match(html, /Run autopilot plan/)
})

test('runs the delivery recovery loop through the HTTP API', async () => {
  await post('/api/reset')

  const initial = await get('/api/state')
  assert.equal(initial.summary.pendingOrders, 5)

  const assigned = await post('/api/assign')
  assert.equal(assigned.summary.pendingOrders, 0)
  assert.equal(assigned.summary.activeAssignments, 5)

  const delayed = await post('/api/drivers/driver-101/delay')
  assert.equal(delayed.summary.openExceptions, 1)
  assert.equal(delayed.state.drivers.find((driver) => driver.id === 'driver-101').status, 'delayed')

  const resolved = await post('/api/exceptions/order-201/resolve')
  assert.equal(resolved.summary.openExceptions, 0)
  assert.equal(resolved.summary.resolvedExceptions, 1)
})

test('returns a useful error for an unknown API route', async () => {
  const response = await fetch(`${baseUrl}/api/not-a-route`)
  const body = await response.json()

  assert.equal(response.status, 405)
  assert.equal(body.error, 'API actions require POST')
})

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`)
  assert.equal(response.status, 200)
  return response.json()
}

async function post(path) {
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST' })
  const body = await response.json()
  assert.equal(response.status, 200, body.error)
  return body
}
