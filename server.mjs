import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  assignOrders,
  resolveException,
  seedState,
  simulateDelay,
  summarizeState,
} from './src/engine.mjs'

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(ROOT_DIR, 'public')

let dispatchState = seedState()

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

export function createAppServer({ logger = console.log } = {}) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')

      if (url.pathname.startsWith('/api/')) {
        await handleApi(request, response, url, logger)
        return
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: 'Method not allowed' })
        return
      }

      await serveStatic(response, url.pathname, request.method === 'HEAD')
    } catch (error) {
      const status = error instanceof RangeError || error.message?.startsWith('No ') ? 400 : 500
      sendJson(response, status, { error: error.message || 'Unexpected server error' })
      logger(`[hermes] ${status} ${error.message}`)
    }
  })
}

export function snapshot() {
  return {
    state: structuredClone(dispatchState),
    summary: summarizeState(dispatchState),
  }
}

async function handleApi(request, response, url, logger) {
  if (request.method === 'GET' && url.pathname === '/api/state') {
    sendJson(response, 200, snapshot())
    return
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'API actions require POST' })
    return
  }

  if (url.pathname === '/api/reset') {
    dispatchState = seedState()
    logger('[hermes] state reset')
    sendJson(response, 200, snapshot())
    return
  }

  if (url.pathname === '/api/assign') {
    dispatchState = assignOrders(dispatchState)
    logger('[hermes] autopilot assignment run')
    sendJson(response, 200, snapshot())
    return
  }

  const delayMatch = /^\/api\/drivers\/([^/]+)\/delay$/.exec(url.pathname)
  if (delayMatch) {
    dispatchState = simulateDelay(dispatchState, decodeURIComponent(delayMatch[1]))
    logger(`[hermes] delay simulated for ${delayMatch[1]}`)
    sendJson(response, 200, snapshot())
    return
  }

  const resolveMatch = /^\/api\/exceptions\/([^/]+)\/resolve$/.exec(url.pathname)
  if (resolveMatch) {
    dispatchState = resolveException(dispatchState, decodeURIComponent(resolveMatch[1]))
    logger(`[hermes] exception resolved for ${resolveMatch[1]}`)
    sendJson(response, 200, snapshot())
    return
  }

  sendJson(response, 404, { error: 'Unknown API route' })
}

async function serveStatic(response, pathname, headOnly) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname
  const relativePath = decodeURIComponent(requestedPath).replace(/^[/\\]+/, '')
  const filePath = path.resolve(PUBLIC_DIR, relativePath)
  const publicRoot = `${PUBLIC_DIR}${path.sep}`

  if (filePath !== PUBLIC_DIR && !filePath.startsWith(publicRoot)) {
    sendJson(response, 403, { error: 'Forbidden' })
    return
  }

  try {
    const file = await fs.readFile(filePath)
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
    })
    if (!headOnly) response.end(file)
    else response.end()
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendJson(response, 404, { error: 'Not found' })
      return
    }
    throw error
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isEntrypoint) {
  const port = Number(process.env.PORT || 3000)
  const server = createAppServer()
  server.listen(port, () => {
    console.log(`Hermes Autopilot running at http://localhost:${port}`)
  })
}
