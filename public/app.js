const ui = {
  ordersTotal: document.querySelector('#orders-total'),
  ordersFoot: document.querySelector('#orders-foot'),
  assignmentsTotal: document.querySelector('#assignments-total'),
  exceptionsTotal: document.querySelector('#exceptions-total'),
  exceptionsFoot: document.querySelector('#exceptions-foot'),
  capacityTotal: document.querySelector('#capacity-total'),
  capacityFoot: document.querySelector('#capacity-foot'),
  planStatus: document.querySelector('#plan-status'),
  recommendation: document.querySelector('#recommendation'),
  recommendationDetail: document.querySelector('#recommendation-detail'),
  confidenceValue: document.querySelector('#confidence-value'),
  confidenceBar: document.querySelector('#confidence-bar'),
  activityCount: document.querySelector('#activity-count'),
  activityList: document.querySelector('#activity-list'),
  fleetList: document.querySelector('#fleet-list'),
  orderCaption: document.querySelector('#order-caption'),
  ordersList: document.querySelector('#orders-list'),
  toast: document.querySelector('#toast'),
}

let toastTimer

document.querySelector('#assign-button').addEventListener('click', () => runAction('/api/assign', 'Autopilot plan applied'))
document.querySelector('#reset-button').addEventListener('click', () => runAction('/api/reset', 'Demo state reset'))
document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')
  if (!action) return

  const { action: actionName, id } = action.dataset
  if (actionName === 'delay') runAction(`/api/drivers/${encodeURIComponent(id)}/delay`, 'Delay detected and exceptions created')
  if (actionName === 'resolve') runAction(`/api/exceptions/${encodeURIComponent(id)}/resolve`, 'Exception resolved and order reassigned')
})

async function runAction(endpoint, successMessage) {
  setBusy(true)
  try {
    const payload = await requestJson(endpoint, { method: 'POST' })
    setBusy(false)
    render(payload)
    showToast(successMessage)
  } catch (error) {
    setBusy(false)
    showToast(error.message, true)
  }
}

async function requestJson(endpoint, options = {}) {
  const response = await fetch(endpoint, options)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'The operation could not be completed.')
  return payload
}

async function loadState() {
  try {
    render(await requestJson('/api/state'))
  } catch (error) {
    showToast(`Connection error: ${error.message}`, true)
  }
}

function render(payload) {
  const { state, summary } = payload
  const driversById = new Map(state.drivers.map((driver) => [driver.id, driver]))

  ui.ordersTotal.textContent = summary.totalOrders
  ui.ordersFoot.textContent = `${summary.pendingOrders} waiting for a plan`
  ui.assignmentsTotal.textContent = summary.activeAssignments
  ui.exceptionsTotal.textContent = summary.openExceptions
  ui.exceptionsFoot.textContent = summary.openExceptions ? 'Manager attention recommended' : 'No incidents detected'
  ui.capacityTotal.textContent = `${summary.capacity.used}/${summary.capacity.total}`
  ui.capacityFoot.textContent = `${summary.capacity.available} units available`
  ui.orderCaption.textContent = `${summary.totalOrders} tracked orders`
  ui.activityCount.textContent = `${summary.activityEntries} events`

  const intelligence = deriveIntelligence(state, summary)
  ui.planStatus.textContent = intelligence.status
  ui.planStatus.classList.toggle('incident', intelligence.hasIncident)
  ui.recommendation.textContent = intelligence.title
  ui.recommendationDetail.textContent = intelligence.detail
  ui.confidenceValue.textContent = `${intelligence.confidence}%`
  ui.confidenceBar.style.width = `${intelligence.confidence}%`

  renderFleet(state, driversById)
  renderOrders(state, driversById)
  renderActivity(state.activityLog)
}

function deriveIntelligence(state, summary) {
  if (summary.openExceptions > 0) {
    const exception = state.exceptions.find((item) => item.status === 'open')
    const order = state.orders.find((item) => item.id === exception?.orderId)
    const candidates = exception?.candidateDriverIds?.length ?? 0
    return {
      status: 'ATTENTION',
      hasIncident: true,
      confidence: candidates ? 91 : 72,
      title: `${order?.customer ?? 'An order'} needs a recovery decision.`,
      detail: `${candidates} replacement driver${candidates === 1 ? '' : 's'} can carry this order. Resolve the exception below to keep the route moving.`,
    }
  }

  if (summary.pendingOrders > 0) {
    return {
      status: 'READY',
      hasIncident: false,
      confidence: 96,
      title: `${summary.pendingOrders} order${summary.pendingOrders === 1 ? '' : 's'} are ready for dispatch.`,
      detail: 'Run the autopilot plan to prioritize urgent work and match each order to the closest driver with capacity.',
    }
  }

  return {
    status: 'OPTIMIZED',
    hasIncident: false,
    confidence: 98,
    title: 'The active dispatch plan is stable.',
    detail: 'All current orders have a driver. Simulate a delay to see Hermes create and recover an exception.',
  }
}

function renderFleet(state, driversById) {
  if (!state.drivers.length) {
    ui.fleetList.innerHTML = '<p class="empty-state">No drivers in the current fleet.</p>'
    return
  }

  ui.fleetList.innerHTML = state.drivers.map((driver) => {
    const load = Number(driver.currentLoad || 0)
    const capacity = Number(driver.capacity || 0)
    const percentage = capacity ? Math.min(100, Math.round((load / capacity) * 100)) : 0
    const status = driver.status === 'delayed' ? 'delayed' : 'available'
    const assignedOrders = state.orders.filter((order) => order.assignedDriverId === driver.id).length
    const label = assignedOrders ? `${assignedOrders} order${assignedOrders === 1 ? '' : 's'}` : 'No active orders'

    return `
      <div class="driver-card">
        <div class="driver-line">
          <span class="driver-name">${escapeHtml(driver.name)}</span>
          <span class="driver-status ${status}"><i></i>${status}</span>
        </div>
        <div class="driver-meta">
          <span>${label}</span>
          <div class="driver-bar" aria-label="${load} of ${capacity} capacity used"><span style="width:${percentage}%"></span></div>
          <span>${load}/${capacity}</span>
          <button data-action="delay" data-id="${escapeHtml(driver.id)}" ${driver.status !== 'available' ? 'disabled' : ''}>
            ${driver.status === 'delayed' ? 'Delay active' : 'Simulate delay'}
          </button>
        </div>
      </div>
    `
  }).join('')
}

function renderOrders(state, driversById) {
  ui.ordersList.innerHTML = state.orders.map((order) => {
    const driver = order.assignedDriverId ? driversById.get(order.assignedDriverId) : null
    const status = order.status.replace('_', ' ')
    const action = order.status === 'exception'
      ? `<button class="resolve-button" data-action="resolve" data-id="${escapeHtml(order.id)}">Resolve</button>`
      : '<span class="panel-caption">—</span>'

    return `
      <tr>
        <td>${escapeHtml(order.customer)}</td>
        <td><span class="priority ${escapeHtml(order.priority)}">${escapeHtml(order.priority)}</span></td>
        <td><span class="order-status ${escapeHtml(order.status)}">${escapeHtml(status)}</span></td>
        <td>${driver ? escapeHtml(driver.name) : '<span class="panel-caption">Unassigned</span>'}</td>
        <td>${action}</td>
      </tr>
    `
  }).join('')
}

function renderActivity(entries) {
  const recent = [...entries].reverse().slice(0, 6)
  if (!recent.length) {
    ui.activityList.innerHTML = '<li class="empty-state">Waiting for the first event.</li>'
    return
  }

  ui.activityList.innerHTML = recent.map((entry) => {
    const isException = entry.type.includes('exception') || entry.type.includes('delayed')
    return `
      <li class="activity-item ${isException ? 'exception' : ''}">
        <span class="activity-dot"></span>
        <div>
          <div class="activity-message">${escapeHtml(entry.message)}</div>
          <span class="activity-type">${escapeHtml(entry.type.replaceAll('.', ' · '))}</span>
        </div>
        <time class="activity-time">${formatTime(entry.timestamp)}</time>
      </li>
    `
  }).join('')
}

function setBusy(isBusy) {
  document.querySelectorAll('#assign-button, #reset-button').forEach((button) => { button.disabled = isBusy })
  document.body.classList.toggle('is-busy', isBusy)
}

function showToast(message, isError = false) {
  window.clearTimeout(toastTimer)
  ui.toast.textContent = message
  ui.toast.style.background = isError ? 'var(--orange)' : 'var(--lime)'
  ui.toast.classList.add('visible')
  toastTimer = window.setTimeout(() => ui.toast.classList.remove('visible'), 3200)
}

function formatTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'now' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]))
}

loadState()
