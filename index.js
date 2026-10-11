/**
 * 归档会话管理 (Archive Manager) — host half.
 *
 * Three authenticated routes on the connection's shared `/api` channel. Every
 * answer is HTTP 200 with an `ok` discriminator, so a domain refusal can never be
 * mistaken for the channel's own session authentication:
 *
 *   GET  /api/archive/sessions — every archived session, with the project it
 *                               belongs to, its size and last write on disk.
 *   POST /api/archive/restore  — 复原回工作区: drop one id from the archive set.
 *   POST /api/archive/delete   — 永久删除: remove one session's log directory and
 *                               its projection-cache entry, then drop the id.
 *
 * Why the Host half owns the destructive half: unarchiving is a registry write
 * (`ctx.workspaceRegistry.unarchiveSession`), which only a Host plugin may issue.
 * Permanent deletion is not an API the Harness has at all — session persistence
 * exposes no deletion seam and the storage layout is deliberately private — so
 * this plugin deletes the artifacts itself, from paths it derives with ported
 * layout rules (see `lib/layout.js`) and then proves before touching anything.
 *
 * Nothing here trusts a browser-supplied path: the only input is a session id,
 * which must already be in the archive set, must not be live in this process, and
 * whose resolved directory must pass `assertDeletableDirectory` — root
 * containment, exact encoded-name equality, and the presence of a session log
 * file. A failure on any of those is a refusal, never a best-effort delete.
 *
 * @module @local/dsh-archive-manager
 */

import { existsSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import {
  DSH_HOME_ENV,
  SESSION_LOG_FILENAME,
  assertDeletableDirectory,
  projectionCacheFile,
  resolveDshHome,
  sessionDirectory,
  sessionsRoot,
} from './lib/layout.js'

/** Cordis plugin name. */
export const name = 'dsh-archive-manager'

/**
 * The connection service owns the `/api` channel these routes register on, so
 * browser-session authentication and Host/Origin checks are applied by that
 * channel before any handler here runs.
 */
export const inject = ['connection']

/** The three route paths this plugin owns. */
const ROUTE_LIST = '/api/archive/sessions'
const ROUTE_RESTORE = '/api/archive/restore'
const ROUTE_DELETE = '/api/archive/delete'

/**
 * How long the archived list waits for folded titles before answering without
 * them. Titles are a convenience on this page — the id, project, size, and time
 * are the decision inputs — so a slow fold must never hold the whole list.
 */
const TITLE_READ_TIMEOUT_MS = 12_000

/**
 * Register the plugin's three routes.
 *
 * @param {any} ctx host plugin context.
 */
export function apply(ctx) {
  for (const [path, methods, handler, label] of [
    [ROUTE_LIST, ['GET'], handleList, 'list route'],
    [ROUTE_RESTORE, ['POST'], handleRestore, 'restore route'],
    [ROUTE_DELETE, ['POST'], handleDelete, 'delete route'],
  ]) {
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path,
          methods,
          requestBody: 'buffered',
          fetch: (request) => handler(ctx, request),
        }),
      `dsh-archive-manager: ${label}`,
    )
  }
}

/**
 * Answer one value as JSON.
 *
 * @param {any} payload
 * @param {number} [status]
 * @returns {Response}
 */
function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Handler for `GET /api/archive/sessions`.
 *
 * @param {any} ctx
 * @returns {Promise<Response>}
 */
async function handleList(ctx) {
  try {
    return json(await buildSnapshot(ctx))
  } catch (error) {
    return json({ ok: false, code: 'INTERNAL', message: describeError(error) })
  }
}

/**
 * Handler for `POST /api/archive/restore` — 复原回工作区.
 *
 * The registry already owns the accounting slot of an archived session, so
 * removing the id from the archive set returns it to its recorded position in
 * its project with no further write.
 *
 * @param {any} ctx
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleRestore(ctx, request) {
  try {
    const parsed = await readId(request)
    if (parsed.ok !== true) return json(parsed)
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined) return json({ ok: false, code: 'NO_REGISTRY', message: NO_REGISTRY_MESSAGE })
    if (!registry.archivedSessionIds.includes(parsed.id)) {
      return json({
        ok: false,
        code: 'NOT_ARCHIVED',
        message: '该会话不在归档列表中：本页只管理已归档会话。',
        snapshot: await buildSnapshot(ctx),
      })
    }
    await registry.unarchiveSession(parsed.id)
    return json({ ok: true, id: parsed.id, restored: true, snapshot: await buildSnapshot(ctx) })
  } catch (error) {
    return json({ ok: false, code: 'INTERNAL', message: describeError(error) })
  }
}

/**
 * Handler for `POST /api/archive/delete` — 永久删除.
 *
 * Order matters: the archive set is checked first (so this route can never reach
 * a session the user has not already hidden), then liveness (a live session's
 * log may still be appended to), then the on-disk proof. The registry entry is
 * dropped last, so a failure halfway leaves the session archived and visible
 * rather than silently unlisted.
 *
 * @param {any} ctx
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleDelete(ctx, request) {
  try {
    const parsed = await readId(request)
    if (parsed.ok !== true) return json(parsed)
    const id = parsed.id
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined) return json({ ok: false, code: 'NO_REGISTRY', message: NO_REGISTRY_MESSAGE })
    if (!registry.archivedSessionIds.includes(id)) {
      return json({
        ok: false,
        code: 'NOT_ARCHIVED',
        message: '该会话不在归档列表中：本页只永久删除已归档会话。请先在侧栏归档它。',
      })
    }
    if (ctx.get('sessions')?.get(id) !== undefined) {
      return json({
        ok: false,
        code: 'SESSION_LIVE',
        message: '该会话仍在本进程中打开或运行，删除可能丢弃仍在写入的内容。请先关闭它（或重启应用）再永久删除。',
      })
    }

    const dshHome = resolveDshHome()
    const root = sessionsRoot(dshHome)
    const label = displayHomeLabel()
    const removed = []
    const notes = []

    const records = await collectRecords(ctx)
    const header = records.get(id)?.header
    if (header === undefined) {
      notes.push('会话持久化中已没有该会话的记录。')
    } else {
      const artifact = await inspectArtifact(root, header)
      if (artifact.found !== true) {
        notes.push(artifact.error === undefined
          ? '磁盘上已没有该会话的日志目录。'
          : `无法读取会话目录：${artifact.error}`)
      } else {
        const verdict = artifact.deletable
        if (verdict.ok !== true) {
          return json({ ok: false, code: verdict.reason, message: verdict.message, snapshot: await buildSnapshot(ctx) })
        }
        await rm(artifact.directory, { recursive: true, force: true })
        removed.push(symbolicPath(dshHome, label, artifact.directory))
      }
    }

    const cacheFile = projectionCacheFile(dshHome, id)
    if (existsSync(cacheFile)) {
      try {
        await rm(cacheFile, { force: true })
        removed.push(symbolicPath(dshHome, label, cacheFile))
      } catch (error) {
        notes.push(`投影缓存条目未能删除：${describeError(error)}`)
      }
    } else {
      notes.push('投影缓存中没有该会话的条目。')
    }

    await registry.unarchiveSession(id)
    // The sidebar hides a row when the client's session list marks it removed.
    // A deleted session never becomes live, so nothing else announces it; this is
    // the same event the session controller emits when a session is disposed.
    try {
      ctx.emit('api-session/removed', id)
    } catch {
      /* the list refresh is a courtesy, not part of the deletion */
    }
    return json({ ok: true, id, removed, notes, snapshot: await buildSnapshot(ctx) })
  } catch (error) {
    return json({ ok: false, code: 'INTERNAL', message: describeError(error) })
  }
}

/** Copy for a composition that mounts no workspace registry. */
const NO_REGISTRY_MESSAGE = '本组合未挂载 workspaceRegistry（工作区注册表），无法读取归档列表。'

/**
 * Read and validate the one field both write routes accept.
 *
 * @param {Request} request
 * @returns {Promise<{ ok: true, id: string } | { ok: false, code: string, message: string }>}
 */
async function readId(request) {
  let text
  try {
    text = await request.text()
  } catch (error) {
    return { ok: false, code: 'BAD_REQUEST', message: `请求体读取失败：${describeError(error)}` }
  }
  let body
  try {
    body = text.trim().length === 0 ? {} : JSON.parse(text)
  } catch {
    return { ok: false, code: 'BAD_REQUEST', message: '请求体不是合法 JSON。' }
  }
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  if (id.length === 0) return { ok: false, code: 'BAD_REQUEST', message: '缺少会话 id。' }
  return { ok: true, id }
}

/**
 * Build the whole page payload from the archive set and the sessions behind it.
 *
 * @param {any} ctx
 * @returns {Promise<any>}
 */
async function buildSnapshot(ctx) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) return { ok: false, code: 'NO_REGISTRY', message: NO_REGISTRY_MESSAGE }
  let archivedIds
  try {
    archivedIds = [...registry.archivedSessionIds]
  } catch (error) {
    return { ok: false, code: 'NO_REGISTRY', message: `归档列表不可读：${describeError(error)}` }
  }

  const dshHome = resolveDshHome()
  const root = sessionsRoot(dshHome)
  const label = displayHomeLabel()
  const records = await collectRecords(ctx)
  const owners = workspaceOwners(registry)
  const titles = await readTitles(ctx, archivedIds)

  const items = []
  for (const id of archivedIds) {
    items.push(await describeArchived({
      id,
      record: records.get(id),
      owner: owners.get(id),
      title: titles.get(id),
      dshHome,
      root,
      label,
    }))
  }
  items.sort((left, right) => right.updatedAt - left.updatedAt || String(left.id).localeCompare(String(right.id)))

  return {
    ok: true,
    generatedAt: Date.now(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    home: label,
    sessionsRoot: symbolicPath(dshHome, label, root),
    totals: {
      archived: items.length,
      onDisk: items.filter((item) => item.onDisk === true).length,
      live: items.filter((item) => item.live === true).length,
      bytes: items.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0),
      deletable: items.filter((item) => item.deletable === true).length,
    },
    items,
  }
}

/**
 * Describe one archived session for the page.
 *
 * @param {any} input
 * @returns {Promise<any>}
 */
async function describeArchived({ id, record, owner, title, dshHome, root, label }) {
  const header = record?.header
  const live = record?.live === true
  const artifact = header === undefined ? { found: false } : await inspectArtifact(root, header)
  const files = artifact.files ?? []
  const updatedAt = files.reduce((max, file) => Math.max(max, file.mtimeMs), 0)
  // A live session is refused outright; a layout the ported rules do not describe
  // is refused too. A session whose artifacts are already gone is *not* refused:
  // deleting it just drops the archive entry, which is the only cleanup available.
  const blocked = live
    ? { code: 'SESSION_LIVE', message: '仍在本进程中打开或运行，关闭后才能永久删除。' }
    : artifact.found === true && artifact.deletable.ok !== true
      ? { code: artifact.deletable.reason, message: artifact.deletable.message }
      : null

  return {
    id,
    title: title ?? null,
    cwd: header?.cwd ?? null,
    parentSession: header?.parentSession ?? null,
    createdAt: header?.createdAt ?? null,
    updatedAt: updatedAt > 0 ? updatedAt : (header?.createdAt ?? 0),
    sizeBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    live,
    persisted: record?.persisted === true,
    onDisk: artifact.found === true,
    directory: header === undefined ? null : symbolicPath(dshHome, label, artifact.directory ?? sessionDirectory(root, header)),
    files: files.map((file) => file.name),
    deleteBlockedBy: blocked,
    deletable: blocked === null,
    workspace: owner ?? null,
  }
}

/**
 * Read one session directory's artifacts without touching them.
 *
 * @param {string} root
 * @param {any} header
 * @returns {Promise<any>}
 */
async function inspectArtifact(root, header) {
  let directory
  try {
    directory = sessionDirectory(root, header)
  } catch (error) {
    return { found: false, error: describeError(error) }
  }
  let entries
  try {
    entries = await readdir(directory)
  } catch (error) {
    return { found: false, directory, error: isENOENT(error) ? undefined : describeError(error) }
  }
  const files = []
  for (const entry of entries) {
    if (!SESSION_LOG_FILENAME.test(entry)) continue
    try {
      const info = await stat(join(directory, entry))
      files.push({ name: entry, sizeBytes: info.size, mtimeMs: info.mtimeMs })
    } catch {
      /* an entry that vanished between listing and stat simply drops out */
    }
  }
  return {
    found: true,
    directory,
    files,
    deletable: assertDeletableDirectory(root, directory, header, entries),
  }
}

/**
 * Index every session the Host can currently describe: what persistence holds,
 * with live sessions overlaid so an unpersisted-but-open session still shows.
 *
 * @param {any} ctx
 * @returns {Promise<Map<string, any>>}
 */
async function collectRecords(ctx) {
  const records = new Map()
  const persistence = ctx.get('sessionPersistence')
  if (persistence !== undefined && typeof persistence.list === 'function') {
    for (const snapshot of await persistence.list()) {
      const header = snapshot?.header
      if (header?.id === undefined) continue
      records.set(header.id, { header, persisted: true, sizeBytes: snapshot.sizeBytes })
    }
  }
  const sessions = ctx.get('sessions')
  if (sessions !== undefined && typeof sessions.list === 'function') {
    for (const session of sessions.list()) {
      const header = session?.header
      if (header?.id === undefined) continue
      const existing = records.get(header.id)
      records.set(header.id, { header, live: true, persisted: existing?.persisted === true })
    }
  }
  return records
}

/**
 * Map every accounted session id to the workspace that owns it.
 *
 * @param {any} registry
 * @returns {Map<string, { id: string, path: string, title: string }>}
 */
function workspaceOwners(registry) {
  const owners = new Map()
  try {
    for (const entity of registry.list()) {
      for (const sessionId of entity.sessionIds ?? []) {
        owners.set(sessionId, { id: entity.id, path: entity.path, title: entity.title })
      }
    }
  } catch {
    /* an uninitialized registry yields no owners; rows fall back to their cwd */
  }
  return owners
}

/**
 * Fold the latest title per archived session, tolerating individual failures.
 *
 * Titles come from the session-query service, which folds over each session's
 * log and therefore costs real work per session. A refused or timed-out batch
 * leaves the rows titled by their project and id instead of failing the page.
 *
 * @param {any} ctx
 * @param {string[]} ids
 * @returns {Promise<Map<string, string>>}
 */
async function readTitles(ctx, ids) {
  const titles = new Map()
  const query = ctx.get('sessionQuery')
  const unique = [...new Set(ids)]
  if (unique.length === 0 || query === undefined || typeof query.readTitleSnapshots !== 'function') return titles
  let settled
  try {
    settled = await query.readTitleSnapshots(unique, AbortSignal.timeout(TITLE_READ_TIMEOUT_MS))
  } catch {
    return titles
  }
  unique.forEach((id, index) => {
    const result = settled?.[index]
    if (result?.status !== 'fulfilled') return
    // Each fulfilled value is `{ session, title? }`; the title is the folded
    // snapshot `{ title, messageSeqs, source, eventSeq, updatedAt }`, and its
    // own `title` field is `null` when the log folded to nothing.
    const snapshot = result.value?.title
    const text = typeof snapshot === 'string' ? snapshot : snapshot?.title
    if (typeof text === 'string' && text.trim().length > 0) titles.set(id, text.trim())
  })
  return titles
}

/**
 * How the harness home is named for display.
 *
 * The shipped `dsh-home-paths` never hands a resolved home to a browser as an
 * absolute path: the default home is labelled `~/.dsh`, an overridden one
 * `$DSH_HOME`.
 *
 * @returns {string}
 */
function displayHomeLabel() {
  const fromEnv = process.env?.[DSH_HOME_ENV]
  return typeof fromEnv === 'string' && fromEnv.trim().length > 0 ? `$${DSH_HOME_ENV}` : '~/.dsh'
}

/**
 * Spell one absolute path the way the page shows it.
 *
 * @param {string} dshHome
 * @param {string} label
 * @param {string} absolute
 * @returns {string}
 */
function symbolicPath(dshHome, label, absolute) {
  const rest = relative(dshHome, absolute)
  if (rest.length === 0) return label
  return `${label}/${rest.split(sep).join('/')}`
}

/**
 * Whether an error is a missing path.
 *
 * @param {any} error
 * @returns {boolean}
 */
function isENOENT(error) {
  return error?.code === 'ENOENT'
}

/**
 * One-line error text for a response body.
 *
 * @param {any} error
 * @returns {string}
 */
function describeError(error) {
  return String(error?.message ?? error)
}
