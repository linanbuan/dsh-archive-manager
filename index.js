/**
 * 归档会话管理 (Archive Manager) — host half.
 *
 * Five authenticated routes on the connection's shared `/api` channel. Every
 * answer is HTTP 200 with an `ok` discriminator, so a domain refusal can never be
 * mistaken for the channel's own session authentication:
 *
 *   GET  /api/archive/sessions — the archived set, painted from cached state.
 *   GET  /api/archive/titles   — folded titles for the rows that need them.
 *   GET  /api/archive/search   — optional full-text scan of archived logs.
 *   POST /api/archive/restore  — 批量复原: drop ids from the archive set.
 *   POST /api/archive/delete   — 批量删除: remove session directories, then ids.
 *
 * Why the Host half owns the destructive half: unarchiving is a registry write
 * (`ctx.workspaceRegistry.unarchiveSession`), which only a Host plugin may issue.
 * Permanent deletion is not an API the Harness has at all — session persistence
 * exposes no deletion seam and the storage layout is deliberately private — so
 * this plugin deletes the artifacts itself, from paths it derives with ported
 * layout rules (see `lib/layout.js`) and then proves before touching anything.
 *
 * Nothing here trusts a browser-supplied path: the only input is a list of session
 * ids, each of which must already be in the archive set, must not be live in this
 * process, and whose resolved directory must pass `assertDeletableDirectory` —
 * root containment, exact encoded-name equality, and the presence of a session log
 * file. A failure on any of those is a per-id refusal, never a best-effort delete.
 *
 * @module @local/dsh-archive-manager
 */

import { ArchiveOperations, BatchInputError, errorMessage } from './lib/ops.js'
import { compileQuery, matchedFields, MAX_QUERY_CHARS, rowMatches, snippetAround } from './lib/search.js'
import { ArchiveSnapshot, DEFAULTS } from './lib/snapshot.js'

/** Cordis plugin name. */
export const name = 'dsh-archive-manager'

/**
 * The connection service owns the `/api` channel these routes register on, so
 * browser-session authentication and Host/Origin checks are applied by that
 * channel before any handler here runs.
 */
export const inject = ['connection']

/** The route paths this plugin owns. */
const ROUTE_LIST = '/api/archive/sessions'
const ROUTE_TITLES = '/api/archive/titles'
const ROUTE_SEARCH = '/api/archive/search'
const ROUTE_RESTORE = '/api/archive/restore'
const ROUTE_DELETE = '/api/archive/delete'

/** Most ids one title read accepts. */
const MAX_TITLE_IDS = 200

/** Bounds for the optional full-text scan, in sessions per request. */
const SEARCH_BATCH = 8
const SEARCH_BATCH_MAX = 24
const SEARCH_BUDGET_MS = 2_500
const SEARCH_BUDGET_MAX = 8_000

/**
 * Read one numeric setting, falling back to its default.
 *
 * @param config - the row's configuration.
 * @param key - the key to read.
 * @returns the configured number, or the default.
 */
function numberSetting(config, key) {
  const value = config?.[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULTS[key]
}

/**
 * Register the plugin's routes.
 *
 * @param ctx host plugin context.
 * @param config the row's configuration.
 */
export function apply(ctx, config = {}) {
  const snapshot = new ArchiveSnapshot(ctx, config)
  const operations = new ArchiveOperations(ctx, snapshot, numberSetting(config, 'maxBatchSize'))
  const handlers = {
    [ROUTE_LIST]: {
      methods: ['GET'],
      label: 'list route',
      handle: (request) => listRoute(snapshot, request),
    },
    [ROUTE_TITLES]: {
      methods: ['GET'],
      label: 'titles route',
      handle: (request) => titlesRoute(snapshot, request),
    },
    [ROUTE_SEARCH]: {
      methods: ['GET'],
      label: 'search route',
      handle: (request) => searchRoute(ctx, snapshot, request),
    },
    [ROUTE_RESTORE]: {
      methods: ['POST'],
      label: 'restore route',
      handle: (request) => restoreRoute(snapshot, operations, request),
    },
    [ROUTE_DELETE]: {
      methods: ['POST'],
      label: 'delete route',
      handle: (request) => deleteRoute(snapshot, operations, request),
    },
  }
  for (const [path, route] of Object.entries(handlers)) {
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path,
          methods: route.methods,
          requestBody: 'buffered',
          fetch: (request) => guard(route.handle, request),
        }),
      'dsh-archive-manager: ' + route.label,
    )
  }
}

/**
 * Answer one value as JSON.
 *
 * @param payload - the value to serialize.
 * @param status - the HTTP status.
 * @returns a JSON response that is never cached.
 */
function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Run one handler, turning any thrown value into a refusal payload.
 *
 * @param handle - the handler to run.
 * @param request - the incoming request.
 * @returns the handler's response, or a refusal.
 */
async function guard(handle, request) {
  try {
    return await handle(request)
  } catch (error) {
    if (error instanceof BatchInputError) return json({ ok: false, code: error.code, message: error.message })
    return json({ ok: false, code: 'INTERNAL', message: errorMessage(error) })
  }
}

/**
 * Read a JSON object body.
 *
 * @param request - the incoming request.
 * @returns the parsed object.
 * @throws {BatchInputError} when the body is absent or not an object.
 */
async function readBody(request) {
  let body
  try {
    body = await request.json()
  } catch {
    throw new BatchInputError('INVALID_BODY', '请求体不是合法的 JSON')
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BatchInputError('INVALID_BODY', '请求体必须是 JSON 对象')
  }
  return body
}

/**
 * Handler for `GET /api/archive/sessions`.
 *
 * @param snapshot - the snapshot this instance owns.
 * @param request - the incoming request.
 * @returns the archived set, optionally filtered by `q`.
 */
async function listRoute(snapshot, request) {
  const url = new URL(request.url)
  const refresh = url.searchParams.get('refresh') === '1'
  const payload = await snapshot.read({ refresh })
  const query = compileQuery(url.searchParams.get('q') ?? '')
  if (query.terms.length === 0) return json({ ...payload, query: { text: '', terms: [] }, matchCount: payload.items.length })
  const items = payload.items.filter((row) => rowMatches(row, query.terms))
  return json({
    ...payload,
    items: items.map((row) => ({ ...row, matched: matchedFields(row, query.terms) })),
    query,
    matchCount: items.length,
  })
}

/**
 * Handler for `GET /api/archive/titles`.
 *
 * @param snapshot - the snapshot this instance owns.
 * @param request - the incoming request.
 * @returns folded titles plus the ids still waiting.
 */
async function titlesRoute(snapshot, request) {
  const url = new URL(request.url)
  const raw = url.searchParams.get('ids') ?? ''
  const ids = raw.split(',').map((value) => value.trim()).filter((value) => value.length > 0).slice(0, MAX_TITLE_IDS)
  if (ids.length === 0) return json({ ok: false, code: 'EMPTY_SELECTION', message: '没有要读取标题的会话' })
  const budgetMs = Math.min(Number(url.searchParams.get('budgetMs')) || DEFAULTS.titleBudgetMs, 30_000)
  const batch = Math.min(Number(url.searchParams.get('batch')) || DEFAULTS.titleBatchSize, MAX_TITLE_IDS)
  const result = await snapshot.readTitles(ids, { budgetMs, batch })
  return json({ ok: true, ...result })
}

/**
 * Handler for `GET /api/archive/search`: the optional full-text scan.
 *
 * The scan is paged and time-boxed because it is the one operation here that
 * opens session logs: the page asks for a slice, shows what it found, and asks
 * again while the query stays the same. A cursor is an index into the id list, and
 * the list is sorted so a cursor stays meaningful between requests.
 *
 * @param ctx - the plugin context.
 * @param snapshot - the snapshot this instance owns.
 * @param request - the incoming request.
 * @returns matching sessions, the scan position, and whether it finished.
 */
async function searchRoute(ctx, snapshot, request) {
  const url = new URL(request.url)
  const query = compileQuery(url.searchParams.get('q') ?? '')
  if (query.terms.length === 0) return json({ ok: false, code: 'EMPTY_QUERY', message: '请输入要搜索的内容' })
  const queryService = ctx.get('sessionQuery')
  if (queryService === undefined || typeof queryService.filterEvents !== 'function') {
    return json({ ok: false, code: 'UNAVAILABLE', message: '当前部署没有挂载 sessionQuery，无法搜索会话内容' })
  }
  const payload = await snapshot.read({})
  const ids = payload.items.map((row) => row.id).sort()
  const cursor = Math.max(0, Math.min(Number(url.searchParams.get('cursor')) || 0, ids.length))
  const batch = Math.max(1, Math.min(Number(url.searchParams.get('batch')) || SEARCH_BATCH, SEARCH_BATCH_MAX))
  const budgetMs = Math.max(200, Math.min(Number(url.searchParams.get('budgetMs')) || SEARCH_BUDGET_MS, SEARCH_BUDGET_MAX))
  const startedAt = Date.now()
  const filters = [
    { kind: 'type', values: ['user/message', 'assistant/message'] },
    { kind: 'surface', values: ['current'] },
    { kind: 'text', text: query.text.slice(0, MAX_QUERY_CHARS) },
  ]
  const hits = []
  const skipped = []
  let scanned = 0
  let exhausted = false
  while (scanned < batch && cursor + scanned < ids.length) {
    if (Date.now() - startedAt > budgetMs) {
      exhausted = true
      break
    }
    const id = ids[cursor + scanned]
    scanned += 1
    let documents
    try {
      documents = await queryService.filterEvents(id, filters)
    } catch {
      skipped.push(id)
      continue
    }
    if (documents.length === 0) continue
    hits.push({
      id,
      count: documents.length,
      seq: documents[0].seq,
      time: documents[0].time,
      snippet: snippetAround(documents[0].text, query.terms),
    })
  }
  const nextCursor = cursor + scanned
  return json({
    ok: true,
    hits,
    skipped,
    scanned,
    cursor,
    nextCursor,
    total: ids.length,
    done: nextCursor >= ids.length,
    truncated: exhausted,
  })
}

/**
 * Handler for `POST /api/archive/restore`.
 *
 * @param snapshot - the snapshot this instance owns.
 * @param operations - the batch operations this instance owns.
 * @param request - the incoming request.
 * @returns per-id results plus the refreshed snapshot.
 */
async function restoreRoute(snapshot, operations, request) {
  const body = await readBody(request)
  const { results, summary } = await operations.restore(body.ids ?? (body.id === undefined ? [] : [body.id]))
  return json({ ok: true, results, summary, payload: await snapshot.read({ refresh: true }) })
}

/**
 * Handler for `POST /api/archive/delete`.
 *
 * `confirm: true` is required: the page's own confirmation dialog is a courtesy,
 * not the protocol, and a stray POST must not be able to erase sessions.
 *
 * @param snapshot - the snapshot this instance owns.
 * @param operations - the batch operations this instance owns.
 * @param request - the incoming request.
 * @returns per-id results plus the refreshed snapshot.
 */
async function deleteRoute(snapshot, operations, request) {
  const body = await readBody(request)
  const dryRun = body.dryRun === true
  if (!dryRun && body.confirm !== true) {
    throw new BatchInputError('CONFIRM_REQUIRED', '永久删除需要在请求中显式确认（confirm: true）')
  }
  const { results, summary } = await operations.remove(body.ids ?? (body.id === undefined ? [] : [body.id]), { dryRun })
  const payload = dryRun ? await snapshot.read({}) : await snapshot.read({ refresh: true })
  return json({ ok: true, dryRun, results, summary, payload })
}

/** Re-exported for the settings row's documentation and for tests. */
export const CONFIG_DEFAULTS = DEFAULTS
