# Hermes Autopilot

Hermes Autopilot is a rebuildable delivery operations control room. It turns a
queue of delivery orders into a dispatch plan, shows driver capacity, and
recovers when a driver reports a delay.

This is a focused buildathon MVP for **Agents & Automation**. The local demo
uses an explainable deterministic planner so a judge can rebuild and run it
without API keys or external services. The planner is the seam where a hosted
LLM or live logistics provider can be connected later.

## The user flow

1. Open the control room and inspect the incoming order queue.
2. Click **Run autopilot plan** to prioritize orders and assign drivers based on
   priority, distance, and remaining capacity.
3. Click **Simulate delay** for an active driver.
4. Hermes turns affected work into an exception and shows replacement options.
5. Click **Resolve** to reassign the order and keep the delivery plan moving.

## Run locally

Requirements:

- Node.js 22 (the version is pinned in `.nvmrc` and the Dockerfile)
- npm 10+

```bash
npm ci
npm test
npm start
```

Open <http://localhost:3000>.

For development with automatic server restarts:

```bash
npm run dev
```

To use another port, copy `.env.example` to `.env` or set `PORT` in the
environment. The server only reads `PORT`; no secrets are required.

## Rebuild from a clean machine

The project intentionally has no runtime dependencies. The rebuild path is:

```bash
git clone <repository-url>
cd hermes-autopilot
npm ci
npm test
npm start
```

The judge can also run the exact container used for the demo:

```bash
docker build -t hermes-autopilot .
docker run --rm -p 3000:3000 hermes-autopilot
```

## HTTP API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/state` | Return the current state and dashboard summary |
| `POST` | `/api/reset` | Restore the deterministic demo scenario |
| `POST` | `/api/assign` | Run the priority/distance/capacity planner |
| `POST` | `/api/drivers/:driverId/delay` | Simulate a driver delay |
| `POST` | `/api/exceptions/:orderId/resolve` | Reassign an open exception |

## Project structure

```text
.
├── public/
│   ├── index.html       # Control-room layout
│   ├── styles.css       # Responsive visual system
│   └── app.js            # API client and UI state rendering
├── src/
│   └── engine.mjs       # Pure dispatch and recovery rules
├── test/
│   ├── engine.test.mjs  # Domain behavior tests
│   └── server.test.mjs  # HTTP smoke and recovery-loop tests
├── Dockerfile
├── .env.example
├── .nvmrc
├── package.json
└── server.mjs
```

## What makes the automation explainable

Hermes does not silently mutate a route. Each decision creates an activity
event, exposes the assigned driver and capacity, and surfaces a manager-facing
exception when an active delivery becomes unsafe to continue. The seeded
scenario makes this behavior repeatable for a demo and for tests.

## Checks

Run the project's meaningful check with:

```bash
npm test
```

The test suite covers deterministic assignment, capacity-aware dispatch,
driver-delay exception creation, recovery assignment, the dashboard shell,
and the end-to-end HTTP recovery loop.
