const BASE_TIME = '2026-01-01T08:00:00.000Z'

const PRIORITY_RANK = Object.freeze({
  critical: 0,
  urgent: 1,
  high: 2,
  normal: 3,
  standard: 3,
  low: 4,
})

const ACTIVE_ASSIGNMENT_STATUSES = new Set(['assigned', 'in_transit', 'picked_up'])

/**
 * Return a fresh, deterministic dispatch scenario for local development and demos.
 * Every public operation returns a new state rather than changing its input.
 */
export function seedState() {
  return {
    version: 1,
    drivers: [
      {
        id: 'driver-101',
        name: 'Avery Stone',
        status: 'available',
        capacity: 2,
        currentLoad: 0,
        location: { x: 0, y: 0 },
      },
      {
        id: 'driver-102',
        name: 'Blair Chen',
        status: 'available',
        capacity: 4,
        currentLoad: 0,
        location: { x: 10, y: 0 },
      },
      {
        id: 'driver-103',
        name: 'Casey Rivera',
        status: 'available',
        capacity: 3,
        currentLoad: 0,
        location: { x: 5, y: 5 },
      },
    ],
    orders: [
      {
        id: 'order-201',
        customer: 'Northstar Market',
        status: 'pending',
        priority: 'high',
        size: 1,
        location: { x: 1, y: 1 },
      },
      {
        id: 'order-202',
        customer: 'Harbor Pharmacy',
        status: 'pending',
        priority: 'standard',
        size: 2,
        location: { x: 8, y: 1 },
      },
      {
        id: 'order-203',
        customer: 'Cedar Cafe',
        status: 'pending',
        priority: 'urgent',
        size: 1,
        location: { x: 6, y: 7 },
      },
      {
        id: 'order-204',
        customer: 'Westside Studio',
        status: 'pending',
        priority: 'low',
        size: 1,
        location: { x: 4, y: 4 },
      },
      {
        id: 'order-205',
        customer: 'Eastline Grocer',
        status: 'pending',
        priority: 'high',
        size: 1,
        location: { x: 12, y: 2 },
      },
    ],
    assignments: [],
    exceptions: [],
    activityLog: [
      {
        id: 'activity-001',
        timestamp: BASE_TIME,
        type: 'state.seeded',
        message: 'Hermes Autopilot dispatch state initialized',
      },
    ],
  }
}

/**
 * Summarize the state for a dashboard or API response.
 * Flat aliases are included alongside grouped counts to keep HTTP clients simple.
 */
export function summarizeState(state) {
  const orders = Array.isArray(state?.orders) ? state.orders : []
  const drivers = Array.isArray(state?.drivers) ? state.drivers : []
  const assignments = Array.isArray(state?.assignments) ? state.assignments : []
  const exceptions = Array.isArray(state?.exceptions) ? state.exceptions : []
  const activityLog = Array.isArray(state?.activityLog) ? state.activityLog : []

  const orderCounts = countBy(orders, (order) => order.status ?? 'unknown')
  const driverCounts = countBy(drivers, (driver) => driver.status ?? 'unknown')
  const assignmentCounts = countBy(assignments, (assignment) => assignment.status ?? 'unknown')
  const exceptionCounts = countBy(exceptions, (exception) => exception.status ?? 'unknown')
  const activeAssignments = assignments.filter(isActiveAssignment)
  const usedCapacity = activeAssignments.reduce((total, assignment) => {
    const order = orders.find((candidate) => candidate.id === assignment.orderId)
    return total + orderSize(order)
  }, 0)
  const totalCapacity = drivers.reduce((total, driver) => total + driverCapacity(driver), 0)

  const ordersSummary = {
    total: orders.length,
    pending: orderCounts.pending ?? 0,
    assigned: orderCounts.assigned ?? 0,
    inTransit: orderCounts.in_transit ?? 0,
    delivered: orderCounts.delivered ?? 0,
    exception: orderCounts.exception ?? 0,
    cancelled: orderCounts.cancelled ?? 0,
  }
  const driversSummary = {
    total: drivers.length,
    available: driverCounts.available ?? 0,
    delayed: driverCounts.delayed ?? 0,
    offline: driverCounts.offline ?? 0,
    busy: drivers.filter((driver) => activeAssignments.some((assignment) => assignment.driverId === driver.id)).length,
  }
  const exceptionsSummary = {
    total: exceptions.length,
    open: exceptionCounts.open ?? 0,
    resolved: exceptionCounts.resolved ?? 0,
  }
  const assignmentsSummary = {
    total: assignments.length,
    active: activeAssignments.length,
    assigned: assignmentCounts.assigned ?? 0,
    exception: assignmentCounts.exception ?? 0,
  }

  return {
    orders: ordersSummary,
    drivers: driversSummary,
    assignments: assignmentsSummary,
    exceptions: exceptionsSummary,
    capacity: {
      total: totalCapacity,
      used: usedCapacity,
      available: Math.max(0, totalCapacity - usedCapacity),
    },
    activity: { total: activityLog.length },

    totalOrders: ordersSummary.total,
    pendingOrders: ordersSummary.pending,
    assignedOrders: ordersSummary.assigned,
    inTransitOrders: ordersSummary.inTransit,
    deliveredOrders: ordersSummary.delivered,
    exceptionOrders: ordersSummary.exception,
    totalDrivers: driversSummary.total,
    availableDrivers: driversSummary.available,
    delayedDrivers: driversSummary.delayed,
    busyDrivers: driversSummary.busy,
    totalAssignments: assignmentsSummary.total,
    activeAssignments: assignmentsSummary.active,
    openExceptions: exceptionsSummary.open,
    resolvedExceptions: exceptionsSummary.resolved,
    activityEntries: activityLog.length,
  }
}

/**
 * Assign pending orders in priority order to the nearest available driver with
 * enough remaining capacity. Ties are broken by remaining capacity, current
 * load, then stable IDs so the result is reproducible.
 */
export function assignOrders(state) {
  const next = cloneState(state)
  normalizeState(next)
  recalculateDriverLoads(next)

  const assignedOrderIds = new Set(
    next.assignments.filter(isActiveAssignment).map((assignment) => assignment.orderId),
  )
  const pendingOrders = next.orders
    .filter((order) => order.status === 'pending' && !assignedOrderIds.has(order.id))
    .sort(compareOrders)

  for (const order of pendingOrders) {
    const driver = rankAvailableDrivers(next, order)[0]
    if (!driver) continue

    const assignment = {
      id: nextEntityId(next.assignments, 'assignment'),
      orderId: order.id,
      driverId: driver.id,
      status: 'assigned',
      priority: order.priority,
      size: orderSize(order),
      distance: distanceBetween(driver.location, order.location),
      assignedAt: nextTimestamp(next),
    }
    next.assignments.push(assignment)
    order.status = 'assigned'
    order.assignedDriverId = driver.id
    order.assignmentId = assignment.id
    order.reassignmentCandidates = []
    appendActivity(next, {
      type: 'order.assigned',
      message: `${order.id} assigned to ${driver.name}`,
      orderId: order.id,
      driverId: driver.id,
      metadata: { distance: assignment.distance, priority: order.priority },
    })
    recalculateDriverLoads(next)
  }

  recalculateDriverLoads(next)
  return next
}

/**
 * Put a driver into a delayed state and turn that driver's active work into
 * open exceptions. Each affected order records the available reassignment
 * candidates at the time of the delay.
 */
export function simulateDelay(state, driverId) {
  const next = cloneState(state)
  normalizeState(next)
  const driver = next.drivers.find((candidate) => candidate.id === driverId)
  if (!driver) throw new RangeError(`Unknown driver: ${driverId}`)
  if (driver.status === 'delayed') return next

  recalculateDriverLoads(next)
  driver.status = 'delayed'
  driver.delay = {
    reason: 'Simulated traffic delay',
    startedAt: nextTimestamp(next),
  }
  appendActivity(next, {
    type: 'driver.delayed',
    message: `${driver.name} reported a simulated delay`,
    driverId,
  })

  const affectedAssignments = next.assignments.filter(
    (assignment) => assignment.driverId === driverId && isActiveAssignment(assignment),
  )
  for (const assignment of affectedAssignments) {
    const order = next.orders.find((candidate) => candidate.id === assignment.orderId)
    if (!order) continue

    assignment.status = 'exception'
    assignment.exceptionId = nextEntityId(next.exceptions, 'exception')
    assignment.exceptionAt = nextTimestamp(next)

    order.status = 'exception'
    order.previousDriverId = driverId
    order.assignedDriverId = null
    order.assignmentId = null
    recalculateDriverLoads(next)
    const candidates = rankAvailableDrivers(next, order, new Set([driverId]))
    const candidateDriverIds = candidates.map((candidate) => candidate.id)
    order.reassignmentCandidates = candidateDriverIds

    const exception = {
      id: assignment.exceptionId,
      orderId: order.id,
      driverId,
      assignmentId: assignment.id,
      status: 'open',
      reason: 'Driver delay',
      candidateDriverIds,
      createdAt: assignment.exceptionAt,
    }
    next.exceptions.push(exception)
    appendActivity(next, {
      type: 'order.exception.created',
      message: `${order.id} needs reassignment after ${driver.name}'s delay`,
      orderId: order.id,
      driverId,
      metadata: { exceptionId: exception.id, candidateDriverIds },
    })
  }

  recalculateDriverLoads(next)
  return next
}

/**
 * Resolve an open exception by assigning its order to another available driver.
 * The delayed/original driver is always excluded, even if a caller manually
 * changes its status before resolving.
 */
export function resolveException(state, orderId) {
  const next = cloneState(state)
  normalizeState(next)
  const exception = next.exceptions.find(
    (candidate) => candidate.orderId === orderId && candidate.status === 'open',
  )
  if (!exception) throw new Error(`No open exception for order: ${orderId}`)

  const order = next.orders.find((candidate) => candidate.id === orderId)
  if (!order) throw new Error(`Unknown order: ${orderId}`)

  recalculateDriverLoads(next)
  const driver = rankAvailableDrivers(next, order, new Set([exception.driverId]))[0]
  if (!driver) throw new Error(`No available driver can carry order: ${orderId}`)

  const assignment = {
    id: nextEntityId(next.assignments, 'assignment'),
    orderId,
    driverId: driver.id,
    status: 'assigned',
    priority: order.priority,
    size: orderSize(order),
    distance: distanceBetween(driver.location, order.location),
    assignedAt: nextTimestamp(next),
    reassignedFromAssignmentId: exception.assignmentId,
    reassignedFromExceptionId: exception.id,
  }
  next.assignments.push(assignment)
  exception.status = 'resolved'
  exception.resolvedAt = nextTimestamp(next)
  exception.resolvedDriverId = driver.id
  exception.resolutionAssignmentId = assignment.id
  order.status = 'assigned'
  order.assignedDriverId = driver.id
  order.assignmentId = assignment.id
  order.reassignmentCandidates = []

  appendActivity(next, {
    type: 'order.exception.resolved',
    message: `${order.id} reassigned to ${driver.name}`,
    orderId,
    driverId: driver.id,
    metadata: { exceptionId: exception.id, assignmentId: assignment.id },
  })
  recalculateDriverLoads(next)
  return next
}

function cloneState(state) {
  if (!state || typeof state !== 'object') throw new TypeError('A dispatch state is required')
  return structuredClone(state)
}

function normalizeState(state) {
  for (const key of ['drivers', 'orders', 'assignments', 'exceptions', 'activityLog']) {
    if (!Array.isArray(state[key])) state[key] = []
  }
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item)
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
}

function orderSize(order) {
  const value = Number(order?.size ?? order?.weight ?? 1)
  return Number.isFinite(value) && value > 0 ? value : 1
}

function driverCapacity(driver) {
  const value = Number(driver?.capacity ?? driver?.maxCapacity ?? 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function isActiveAssignment(assignment) {
  return ACTIVE_ASSIGNMENT_STATUSES.has(assignment?.status)
}

function recalculateDriverLoads(state) {
  const loads = new Map(state.drivers.map((driver) => [driver.id, 0]))
  const ordersById = new Map(state.orders.map((order) => [order.id, order]))
  for (const assignment of state.assignments) {
    if (!isActiveAssignment(assignment)) continue
    loads.set(assignment.driverId, (loads.get(assignment.driverId) ?? 0) + orderSize(ordersById.get(assignment.orderId)))
  }
  for (const driver of state.drivers) {
    driver.currentLoad = loads.get(driver.id) ?? 0
    driver.availableCapacity = Math.max(0, driverCapacity(driver) - driver.currentLoad)
  }
}

function rankAvailableDrivers(state, order, excludedDriverIds = new Set()) {
  const size = orderSize(order)
  return state.drivers
    .filter((driver) => driver.status === 'available' && !excludedDriverIds.has(driver.id))
    .map((driver) => ({
      driver,
      distance: distanceBetween(driver.location, order.location),
      remainingAfter: (driver.availableCapacity ?? driverCapacity(driver)) - size,
    }))
    .filter((candidate) => candidate.remainingAfter >= 0)
    .sort((a, b) =>
      a.distance - b.distance ||
      a.remainingAfter - b.remainingAfter ||
      (a.driver.currentLoad ?? 0) - (b.driver.currentLoad ?? 0) ||
      a.driver.id.localeCompare(b.driver.id),
    )
    .map((candidate) => candidate.driver)
}

function compareOrders(a, b) {
  return (
    priorityRank(a.priority) - priorityRank(b.priority) ||
    String(a.dueAt ?? '').localeCompare(String(b.dueAt ?? '')) ||
    String(a.id).localeCompare(String(b.id))
  )
}

function priorityRank(priority) {
  if (typeof priority === 'number' && Number.isFinite(priority)) return priority
  return PRIORITY_RANK[String(priority ?? 'standard').toLowerCase()] ?? PRIORITY_RANK.standard
}

function distanceBetween(a = {}, b = {}) {
  const ax = Number(a.x ?? a.longitude ?? 0)
  const ay = Number(a.y ?? a.latitude ?? 0)
  const bx = Number(b.x ?? b.longitude ?? 0)
  const by = Number(b.y ?? b.latitude ?? 0)
  return Number(Math.hypot(ax - bx, ay - by).toFixed(2))
}

function nextEntityId(items, prefix) {
  const highest = items.reduce((max, item) => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(String(item?.id ?? ''))
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `${prefix}-${String(highest + 1).padStart(3, '0')}`
}

function nextTimestamp(state) {
  const offset = state.activityLog.length
  const date = new Date(BASE_TIME)
  date.setUTCMinutes(date.getUTCMinutes() + offset)
  return date.toISOString()
}

function appendActivity(state, entry) {
  state.activityLog.push({
    id: nextEntityId(state.activityLog, 'activity'),
    timestamp: nextTimestamp(state),
    ...entry,
  })
}
