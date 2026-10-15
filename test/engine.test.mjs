import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assignOrders,
  resolveException,
  seedState,
  simulateDelay,
  summarizeState,
} from '../src/engine.mjs'

test('seedState provides a useful initial summary', () => {
  const state = seedState()
  const summary = summarizeState(state)

  assert.equal(summary.totalOrders, 5)
  assert.equal(summary.pendingOrders, 5)
  assert.equal(summary.totalDrivers, 3)
  assert.equal(summary.availableDrivers, 3)
  assert.equal(summary.totalAssignments, 0)
  assert.equal(summary.openExceptions, 0)
  assert.equal(summary.activityEntries, 1)
})

test('assignOrders is deterministic and respects priority, distance, and capacity', () => {
  const first = assignOrders(seedState())
  const second = assignOrders(seedState())

  assert.deepEqual(first.assignments, second.assignments)
  assert.deepEqual(
    first.assignments.map(({ orderId, driverId }) => ({ orderId, driverId })),
    [
      { orderId: 'order-203', driverId: 'driver-103' },
      { orderId: 'order-201', driverId: 'driver-101' },
      { orderId: 'order-205', driverId: 'driver-102' },
      { orderId: 'order-202', driverId: 'driver-102' },
      { orderId: 'order-204', driverId: 'driver-103' },
    ],
  )
  assert.equal(summarizeState(first).pendingOrders, 0)
  assert.equal(summarizeState(first).assignedOrders, 5)
  assert.equal(first.drivers.find((driver) => driver.id === 'driver-102').currentLoad, 3)
  assert.equal(first.drivers.find((driver) => driver.id === 'driver-102').availableCapacity, 1)
})

test('simulateDelay creates exceptions and reassignment candidates for affected work', () => {
  const assigned = assignOrders(seedState())
  const delayed = simulateDelay(assigned, 'driver-101')
  const order = delayed.orders.find((candidate) => candidate.id === 'order-201')
  const exception = delayed.exceptions.find((candidate) => candidate.orderId === 'order-201')
  const originalAssignment = delayed.assignments.find((candidate) => candidate.orderId === 'order-201')

  assert.equal(delayed.drivers.find((driver) => driver.id === 'driver-101').status, 'delayed')
  assert.equal(order.status, 'exception')
  assert.equal(originalAssignment.status, 'exception')
  assert.equal(exception.status, 'open')
  assert.ok(exception.candidateDriverIds.length > 0)
  assert.deepEqual(order.reassignmentCandidates, exception.candidateDriverIds)
  assert.equal(summarizeState(delayed).openExceptions, 1)
  assert.equal(summarizeState(assigned).openExceptions, 0)
})

test('resolveException assigns the affected order to another available driver', () => {
  const delayed = simulateDelay(assignOrders(seedState()), 'driver-101')
  const resolved = resolveException(delayed, 'order-201')
  const order = resolved.orders.find((candidate) => candidate.id === 'order-201')
  const exception = resolved.exceptions.find((candidate) => candidate.orderId === 'order-201')
  const replacement = resolved.assignments.find(
    (candidate) => candidate.id === exception.resolutionAssignmentId,
  )

  assert.equal(order.status, 'assigned')
  assert.equal(exception.status, 'resolved')
  assert.equal(replacement.status, 'assigned')
  assert.notEqual(replacement.driverId, 'driver-101')
  assert.equal(order.assignedDriverId, replacement.driverId)
  assert.equal(summarizeState(resolved).openExceptions, 0)
  assert.equal(summarizeState(resolved).resolvedExceptions, 1)
})
