/**
 * 归档会话管理 (Archive Manager) — the archived-session snapshot.
 *
 * ## Why this module exists
 *
 * The first version of this page described the archived set by folding every
 * session's title out of its log. On a machine with 160 archived sessions that
 * meant opening and replaying 160 logs before the first row could paint, which is
 * where the "several seconds per refresh" came from. The work was never the
 * problem; doing it *before* painting was.
 *
 * The snapshot is now built in two tiers:
 *
 * 1. **Fast tier** — one header listing (`sessionQuery.listSessions`, which merges
 *    the live store over persistence), one directory walk of the session root, and
 *    one title lookup per row against the Host's own projection cache, which is
 *    already in memory. No session log is opened. This is what the page paints.
 * 2. **Title tier** — sessions whose projection cache holds no title are folded
 *    later, in bounded batches, through `/api/archive/titles`. The page patches
 *    those rows in as they arrive.
 *
 * Both tiers sit behind short-lived caches keyed by a generation counter, so a
 * refresh after a batch operation re-reads, and a refresh a second later does not.
 *
 * @module @local/dsh-archive-manager/snapshot
 */

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { mapLimit } from './concurrency.js'
import {
  SESSION_LOG_FILENAME,
  assertDeletableDirectory,
  encodeSegment,
  resolveDshHome,
  sessionDirectory,
  sessionsRoot,
} from './layout.js'

/** Defaults for every cache and bound this plugin applies. */
export const DEFAULTS = Object.freeze({
  /** How long a header listing is reused, in milliseconds. */
  headersTtlMs: 15_000,
  /** How long a built snapshot is reused, in milliseconds. */
  snapshotTtlMs: 4_000,
  /** How long one directory's file facts are reused, in milliseconds. */
  diskTtlMs: 3_000,
  /** How long a folded title is reused, in milliseconds. */
  titleTtlMs: 600_000,
  /** How many titles one deep read may fold. */
  titleBatchSize: 24,
  /** Wall-clock budget for one deep title read, in milliseconds. */
  titleBudgetMs: 6_000,
  /** How many directory inspections run at once. */
  concurrency: 12,
  /** Hard cap on one batch operation's id count. */
  maxBatchSize: 500,
})

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
 * Unwrap the several shapes a title projection value may take.
 *
 * The title unit stores a snapshot object; older checkpoints stored the bare
 * string. Both are read here so a cache hit never depends on the writer's shape.
 *
 * @param value - the projection value.
 * @returns the title text, or `undefined` when there is none.
 */
export function titleText(value) {
  if (typeof value === 'string') return value.trim().length > 0 ? value.trim() : undefined
  if (value === null || typeof value !== 'object') return undefined
  const direct = value.title
  if (typeof direct === 'string') return direct.trim().length > 0 ? direct.trim() : undefined
  if (direct !== null && typeof direct === 'object' && typeof direct.title === 'string') {
    return direct.title.trim().length > 0 ? direct.title.trim() : undefined
  }
  return undefined
}

/**
 * Rewrite an absolute path under the harness home as `$DSH_HOME/...`.
 *
 * Paths are what users compare against their own shell, so they are shown with
 * forward slashes and with the home collapsed, never as a bare Windows path.
 *
 * @param home - the resolved harness home.
 * @param target - an absolute path.
 * @returns the display form.
 */
export function displayPath(home, target) {
  if (typeof target !== 'string' || target.length === 0) return ''
  const normalizedHome = home.replace(/[\\/]+$/, '')
  const normalizedTarget = target.replace(/[\\/]+$/, '')
  const lowerTarget = normalizedTarget.toLowerCase()
  const lowerHome = normalizedHome.toLowerCase()
  const relative = lowerTarget === lowerHome
    ? ''
    : lowerTarget.startsWith(lowerHome + '\\') || lowerTarget.startsWith(lowerHome + '/')
      ? normalizedTarget.slice(normalizedHome.length + 1)
      : undefined
  if (relative === undefined) return normalizedTarget.replace(/\\/g, '/')
  return relative.length === 0 ? '$DSH_HOME' : '$DSH_HOME/' + relative.replace(/\\/g, '/')
}

/**
 * The last readable segment of a project path, for the compact column.
 *
 * @param cwd - the session's project directory.
 * @returns the label, or an empty string.
 */
export function projectLabel(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return ''
  const parts = cwd.split(/[\\/]+/).filter((part) => part.length > 0)
  return parts.at(-1) ?? cwd
}

/**
 * Read the title a session's projection cache already holds.
 *
 * A cache hit is zero I/O: the cache table is loaded by the Host at startup. The
 * three outcomes matter — a text, a folded-empty title (a real answer: this
 * session has no title), and no usable row (the page must ask for a deep read).
 *
 * @param cache - the `sessionProjectionCache` service, when mounted.
 * @param header - the session header.
 * @returns `{ state: 'text', text }`, `{ state: 'empty' }`, or `{ state: 'unknown' }`.
 */
export function projectionTitle(cache, header) {
  if (cache === undefined || header === undefined) return { state: 'unknown' }
  let block
  try {
    block = cache.cachedSnapshot(header) ?? cache.cachedPredecessorTitle(header)
  } catch {
    return { state: 'unknown' }
  }
  const values = block?.values
  if (values === undefined || values === null || !Object.hasOwn(values, 'title')) return { state: 'unknown' }
  const text = titleText(values.title)
  return text === undefined ? { state: 'empty' } : { state: 'text', text }
}

/**
 * Index every workspace by the session ids it owns.
 *
 * @param registry - the `workspaceRegistry` service.
 * @returns one entry per owned session id.
 */
export function workspaceIndex(registry) {
  const index = new Map()
  if (registry === undefined) return index
  let workspaces = []
  try {
    workspaces = registry.list() ?? []
  } catch {
    return index
  }
  for (const workspace of workspaces) {
    const ids = workspace?.sessionIds
    if (!ids) continue
    for (const id of ids) {
      if (!index.has(id)) {
        index.set(id, {
          id: String(workspace.id ?? ''),
          path: String(workspace.path ?? ''),
          title: String(workspace.title ?? ''),
        })
      }
    }
  }
  return index
}

/**
 * The archived-session snapshot of one plugin instance.
 *
 * One instance owns the caches; {@link ArchiveSnapshot#invalidate} is what a
 * batch operation calls so the next read sees its own writes.
 */
export class ArchiveSnapshot {
  #ctx
  #config
  #generation = 0
  #headers
  #directories
  #disk = new Map()
  #titles = new Map()
  #built

  /**
   * @param ctx - the plugin context.
   * @param config - the row's configuration.
   */
  constructor(ctx, config = {}) {
    this.#ctx = ctx
    this.#config = config ?? {}
  }

  /** The harness home this snapshot describes. */
  get home() {
    return resolveDshHome()
  }

  /** The session root this snapshot describes. */
  get root() {
    return sessionsRoot(this.home)
  }

  /**
   * Drop every cache so the next read reflects a change this plugin made.
   *
   * @param reason - what invalidated the snapshot; for logging only.
   */
  invalidate(reason = 'mutation') {
    this.#generation += 1
    this.#headers = undefined
    this.#built = undefined
    this.#disk.clear()
    if (reason !== 'mutation') this.#ctx.logger?.debug?.('archive-manager: snapshot invalidated (' + reason + ')')
  }

  /**
   * List the logical corpus once, merging live sessions over persistence.
   *
   * @param refresh - ignore the cached listing.
   * @returns one record per session id.
   */
  async #readHeaders(refresh) {
    const ttl = numberSetting(this.#config, 'headersTtlMs')
    const now = Date.now()
    if (!refresh && this.#headers !== undefined && now - this.#headers.at < ttl) return this.#headers.map

    const query = this.#ctx.get('sessionQuery')
    const persistence = this.#ctx.get('sessionPersistence')
    const map = new Map()
    let listed = false
    if (query !== undefined && typeof query.listSessions === 'function') {
      for (const record of await query.listSessions()) {
        map.set(record.header.id, { header: record.header, live: record.live === true })
      }
      listed = true
    }
    if (!listed && persistence !== undefined) {
      for (const record of await persistence.list()) {
        map.set(record.header.id, { header: record.header, live: false })
      }
    }
    // The live store is authoritative about liveness even when the corpus
    // listing is cached: a session that just started must not look deletable.
    const sessions = this.#ctx.get('sessions')
    if (sessions !== undefined && typeof sessions.list === 'function') {
      for (const session of sessions.list()) {
        const id = session?.header?.id ?? session?.id
        if (typeof id !== 'string') continue
        const existing = map.get(id)
        if (existing !== undefined) existing.live = true
        else map.set(id, { header: session.header ?? { id }, live: true })
      }
    }
    this.#headers = { at: now, map }
    return map
  }

  /**
   * Walk the session root once, mapping each encoded id to its directory.
   *
   * Two `readdir` levels are cheaper than 160 derived-path `stat`s and, unlike a
   * derived path, this finds a session whose directory is not where its header
   * says it should be — which is exactly the case a cleanup page must show.
   *
   * @param refresh - ignore the cached walk.
   * @returns encoded id to absolute directory.
   */
  async #readDirectories(refresh) {
    const ttl = numberSetting(this.#config, 'headersTtlMs')
    const now = Date.now()
    if (!refresh && this.#directories !== undefined && now - this.#directories.at < ttl) return this.#directories.map

    const root = this.root
    const map = new Map()
    let projects
    try {
      projects = await readdir(root, { withFileTypes: true })
    } catch {
      this.#directories = { at: now, map }
      return map
    }
    const directories = projects.filter((entry) => entry.isDirectory())
    await mapLimit(directories, 8, async (entry) => {
      const projectPath = join(root, entry.name)
      let sessions
      try {
        sessions = await readdir(projectPath, { withFileTypes: true })
      } catch {
        return
      }
      for (const session of sessions) {
        if (!session.isDirectory()) continue
        if (!map.has(session.name)) map.set(session.name, join(projectPath, session.name))
      }
    })
    this.#directories = { at: now, map }
    return map
  }

  /**
   * Inspect one session directory: which artifacts it holds, how large, how old.
   *
   * @param directory - the absolute session directory.
   * @param refresh - ignore the cached facts.
   * @returns the directory's file facts.
   */
  async #readDisk(directory, refresh) {
    const ttl = numberSetting(this.#config, 'diskTtlMs')
    const now = Date.now()
    const cached = this.#disk.get(directory)
    if (!refresh && cached !== undefined && now - cached.at < ttl) return cached.facts

    const facts = { exists: false, entries: [], files: [], sizeBytes: 0, updatedAt: null }
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      this.#disk.set(directory, { at: now, facts })
      return facts
    }
    facts.exists = true
    facts.entries = entries.map((entry) => entry.name)
    const logs = entries.filter((entry) => entry.isFile() && SESSION_LOG_FILENAME.test(entry.name))
    const stats = await mapLimit(logs, 4, async (entry) => {
      try {
        return { name: entry.name, stats: await stat(join(directory, entry.name)) }
      } catch {
        return undefined
      }
    })
    for (const item of stats) {
      if (item === undefined) continue
      facts.files.push({ name: item.name, sizeBytes: item.stats.size, mtimeMs: item.stats.mtimeMs })
      facts.sizeBytes += item.stats.size
      facts.updatedAt = Math.max(facts.updatedAt ?? 0, item.stats.mtimeMs)
    }
    this.#disk.set(directory, { at: now, facts })
    return facts
  }

  /**
   * Fold titles for sessions whose projection cache has no answer.
   *
   * @param ids - session ids to resolve.
   * @param options - bounds for this read.
   * @returns resolved titles plus the ids still waiting.
   */
  async readTitles(ids, options = {}) {
    const budgetMs = options.budgetMs ?? numberSetting(this.#config, 'titleBudgetMs')
    const batch = Math.max(1, options.batch ?? numberSetting(this.#config, 'titleBatchSize'))
    const ttl = numberSetting(this.#config, 'titleTtlMs')
    const now = Date.now()
    const wanted = []
    for (const id of new Set(ids)) {
      if (typeof id !== 'string' || id.length === 0) continue
      const memo = this.#titles.get(id)
      if (memo !== undefined && now - memo.at < ttl) continue
      wanted.push(id)
    }
    const titles = {}
    const pending = wanted.slice(batch)
    const slice = wanted.slice(0, batch)
    if (slice.length === 0) return { titles, pending, failed: [] }

    const query = this.#ctx.get('sessionQuery')
    if (query === undefined || typeof query.readTitleSnapshots !== 'function') {
      return { titles, pending: wanted, failed: [] }
    }
    let results
    try {
      results = await query.readTitleSnapshots(slice, AbortSignal.timeout(budgetMs))
    } catch (error) {
      this.#ctx.logger?.warn?.('archive-manager: title read failed: ' + String(error))
      return { titles, pending: wanted, failed: [] }
    }
    const failed = []
    for (const result of results ?? []) {
      const id = result?.sessionId
      if (typeof id !== 'string') continue
      if (result.status === 'rejected') {
        failed.push(id)
        continue
      }
      const text = titleText(result.value?.title) ?? null
      this.#titles.set(id, { at: now, text })
      titles[id] = text
    }
    return { titles, pending, failed }
  }

  /**
   * Build (or reuse) the archived-session snapshot.
   *
   * @param options - read options.
   * @returns the payload the page consumes.
   */
  async read(options = {}) {
    const refresh = options.refresh === true
    const ttl = numberSetting(this.#config, 'snapshotTtlMs')
    const now = Date.now()
    if (!refresh && this.#built !== undefined && this.#built.generation === this.#generation && now - this.#built.at < ttl) {
      return this.#built.payload
    }

    const registry = this.#ctx.get('workspaceRegistry')
    const archivedIds = Array.isArray(registry?.archivedSessionIds) ? [...registry.archivedSessionIds] : []
    const pinnedIds = new Set(Array.isArray(registry?.pinnedSessionIds) ? registry.pinnedSessionIds : [])
    const headersAndDirectories = await Promise.all([
      this.#readHeaders(refresh),
      this.#readDirectories(refresh),
    ])
    const headers = headersAndDirectories[0]
    const directories = headersAndDirectories[1]
    const workspaces = workspaceIndex(registry)
    const cache = this.#ctx.get('sessionProjectionCache')
    const home = this.home
    const root = this.root
    const concurrency = numberSetting(this.#config, 'concurrency')
    const titleTtl = numberSetting(this.#config, 'titleTtlMs')

    const rows = await mapLimit(archivedIds, concurrency, async (id) => {
      const record = headers.get(id)
      const header = record?.header
      const live = record?.live === true
      const encoded = encodeSegment(id)
      const directory = directories.get(encoded) ?? sessionDirectory(root, header ?? { id })
      const facts = await this.#readDisk(directory, refresh)

      let title = null
      let titleSource = 'none'
      const memo = this.#titles.get(id)
      if (memo !== undefined && Date.now() - memo.at < titleTtl) {
        title = memo.text
        titleSource = 'memo'
      } else {
        const projected = projectionTitle(cache, header)
        if (projected.state === 'text') {
          title = projected.text
          titleSource = 'cache'
        } else if (projected.state === 'empty') {
          titleSource = 'cache'
        }
      }

      const guard = facts.exists
        ? assertDeletableDirectory(root, directory, header, facts.entries)
        : { ok: false, reason: 'NOT_ON_DISK', message: '会话目录不在磁盘上' }
      const deletable = guard.ok === true && !live
      const blocked = live
        ? { reason: 'LIVE_SESSION', message: '会话正在运行，不能删除' }
        : guard.ok === true
          ? null
          : { reason: guard.reason, message: guard.message }

      const workspace = workspaces.get(id) ?? null
      const cwd = typeof header?.cwd === 'string' ? header.cwd : undefined
      return {
        id,
        title,
        titleSource,
        cwd: cwd ?? null,
        project: {
          key: cwd === undefined ? '_no-cwd' : (directory.split(/[\\/]/).at(-2) ?? ''),
          label: cwd === undefined ? '（无项目路径）' : projectLabel(cwd),
          title: workspace?.title || (cwd === undefined ? '' : projectLabel(cwd)),
        },
        workspace,
        createdAt: typeof header?.createdAt === 'number' ? header.createdAt : null,
        updatedAt: facts.updatedAt,
        parentSession: typeof header?.parentSession === 'string' ? header.parentSession : null,
        seeded: header?.isSeeded === true,
        directory: displayPath(home, directory),
        directoryPath: directory.replace(/\\/g, '/'),
        onDisk: facts.exists,
        live,
        files: facts.files.length,
        logName: facts.files[0]?.name ?? null,
        sizeBytes: facts.sizeBytes,
        pinned: pinnedIds.has(id),
        deletable,
        deleteBlockedBy: blocked?.reason ?? null,
        deleteBlockedMessage: blocked?.message ?? null,
        hasHeader: header !== undefined,
      }
    })

    const totals = { archived: rows.length, onDisk: 0, live: 0, bytes: 0, deletable: 0 }
    for (const row of rows) {
      if (row.onDisk) totals.onDisk += 1
      if (row.live) totals.live += 1
      if (row.deletable) totals.deletable += 1
      totals.bytes += row.sizeBytes
    }

    const payload = {
      ok: true,
      generatedAt: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
      home: displayPath(home, home),
      homePath: home.replace(/\\/g, '/'),
      sessionsRoot: displayPath(home, root),
      sessionsRootPath: root.replace(/\\/g, '/'),
      totals,
      capabilities: {
        batchLimit: numberSetting(this.#config, 'maxBatchSize'),
        titles: true,
        contentSearch: true,
      },
      items: rows,
    }
    this.#built = { at: Date.now(), generation: this.#generation, payload }
    return payload
  }
}
