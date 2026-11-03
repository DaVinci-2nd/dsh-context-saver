/**
 * Host half of the DSH context saver.
 *
 * The plugin intercepts the `llm/stream` waterfall, rebuilds the request with a
 * trimmed message list, and dispatches that request instead. The trimmed list
 * exists only for the duration of one dispatch: the Session log, the chat
 * transcript, and every derived projection keep the complete history.
 *
 * The rebuilt request is dispatched with `ctx.llm.stream(...)` rather than
 * `next()`, because a waterfall `next` continuation cannot accept replacement
 * arguments. The `trimmedRequests` guard stops the second waterfall pass from
 * trimming the same request again.
 */
import { trimMessages } from './src/trim.js'
import { loadSettings, normalizeSettings, saveSettings } from './src/settings.js'

export const name = 'dsh-context-saver'

export const inject = ['llm']

const ROUTE = '/dsh-context-saver/settings'
const BODY_LIMIT = 64 * 1024

/** Requests this plugin already trimmed, so re-entry falls through to `next()`. */
const trimmedRequests = new WeakSet()

function sendJson(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  })
  response.end(text)
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        request.removeAllListeners('data')
        request.resume()
        reject(new Error('body-too-large'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text.length === 0 ? {} : JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

/** Reject a cross-site page: the control is served from the DSH origin itself. */
function sameOrigin(request) {
  const origin = request.headers?.origin ?? request.headers?.referer
  if (origin === undefined) return true
  if (origin === 'null') return false
  const host = request.headers?.host
  if (host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function jsonContentType(request) {
  const type = String(request.headers?.['content-type'] ?? '').toLowerCase()
  return type === 'application/json' || type.startsWith('application/json;')
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  let settings = loadSettings()

  ctx.on('llm/stream', (options, next) => {
    if (trimmedRequests.has(options)) return next()
    // Compaction and session-title calls summarize; trimming them would silently
    // change their input, so only ordinary conversation requests are rewritten.
    if (options.purpose !== undefined) return next()
    if (!settings.enabled) return next()
    const messages = trimMessages(options.messages, settings)
    if (messages === options.messages) return next()
    const rebuilt = { ...options, messages }
    trimmedRequests.add(rebuilt)
    return ctx.llm.stream(rebuilt)
  }, { global: true, prepend: true })

  // The route exists only where a browser can reach it; trimming above works in
  // any composition that has the LLM service.
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => scope.webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: async (request, response) => {
        try {
          if (request.method === 'GET') {
            sendJson(response, 200, { ok: true, settings })
            return
          }
          if (request.method !== 'POST') {
            sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          if (!sameOrigin(request)) {
            sendJson(response, 403, { ok: false, error: 'forbidden' })
            return
          }
          if (!jsonContentType(request)) {
            sendJson(response, 415, { ok: false, error: 'unsupported-media-type' })
            return
          }
          const body = await readJsonBody(request)
          const patch = body !== null && typeof body === 'object' && body.patch !== null && typeof body.patch === 'object'
            ? body.patch
            : body
          settings = normalizeSettings({ ...settings, ...patch })
          saveSettings(settings)
          sendJson(response, 200, { ok: true, settings })
        } catch {
          sendJson(response, 500, { ok: false, error: 'internal' })
        }
      },
    }), 'dsh-context-saver: settings route')
  })
}
