#!/usr/bin/env node
/**
 * Self-check for `@local/dsh-archive-manager`.
 *
 * Run with `node test/selfcheck.mjs` (or `npm test`) from this package.
 * No network, no Harness, no React: the Host half is driven through a stub
 * context and a throwaway `$DSH_HOME`, and the browser half through a stub
 * `window.__ModuleLoader__` and a handful of React hooks that only have to exist.
 *
 * The destructive path is the reason this file exists. Permanent deletion is not
 * a Harness API — `lib/ops.js` removes the session directory itself — so every
 * guard that stands between a click and `rm -r` is exercised against real
 * directories here: the archive-set gate, the liveness gate, the no-header gate,
 * the encoded-name equality, root containment, and the log-file presence check.
 * A refusal must leave the directory, its projection-cache entry, the archive
 * set and the broadcast channel untouched; only a session whose files really
 * went may be announced as removed.
 *
 * The cache tiers are here for the same reason. The page paints from cached
 * state, so a cache that outlives a mutation is the failure mode that makes a
 * cleanup page dangerous: it would offer to delete a session whose files are
 * already gone, or hide one whose files are still there.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The harness home must exist before the Host half is imported: both halves
// resolve `$DSH_HOME` at call time, but a temp home chosen later would still
// be the one the first fixture wrote into.
process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-archive-manager-'))

const host = await import('../index.js')
const layout = await import('../lib/layout.js')
const search = await import('../lib/search.js')
const concurrency = await import('../lib/concurrency.js')
const { ArchiveSnapshot, DEFAULTS, projectionTitle, titleText } = await import('../lib/snapshot.js')
const { ArchiveOperations } = await import('../lib/ops.js')

/** Results of every check, printed at the end. */
const results = []

/**
 * Run one named check.
 *
 * @param {string} label - what the check proves.
 * @param {() => any | Promise<any>} body - the assertions.
 */
async function check(label, body) {
  try {
    await body()
    results.push({ label, ok: true })
    console.log(`ok   ${label}`)
  } catch (error) {
    results.push({ label, ok: false, error })
    console.log(`FAIL ${label}\n     ${error?.message ?? error}`)
  }
}

// ---------------------------------------------------------------------------
// Fixtures — one archived session per shape the page has to survive
// ---------------------------------------------------------------------------

/** A Windows project path with only ASCII-safe characters. */
const CWD_ORB = 'C:\\Users\\dev\\.dsh\\dsh_orb'
/** A Windows project path with characters the layout must escape. */
const CWD_NOVEL = 'D:\\AI\\小说示例'

/** The session artifact filename every fixture writes. */
const LOG_FILE = 'session.v4.jsonl.zstd'

/** 正常：cached title, on disk, deletable. */
const ID_NORMAL = 'session-orb-1'
/** 缓存里折叠成空标题：a real answer that must not trigger a deep read. */
const ID_CACHED_EMPTY = 'session-orb-2'
/** 目录里没有会话日志：a directory the layout rules refuse to call a session. */
const ID_BAD = 'session-bad-1'
/** 运行中：live in this process, so never deletable. */
const ID_LIVE = 'session-live-1'
/** 只剩归档记录：the artifacts are already gone. */
const ID_GONE = 'session-gone-1'
/** 放错项目层：the directory sits under a project the header does not derive. */
const ID_MISPLACED = 'session-misplaced-1'
/** 没有会话头：archived, on disk, but persistence no longer lists it. */
const ID_UNKNOWN = 'session-unknown-1'

/** The archive set, in the order the registry lists it. */
const ARCHIVED = [ID_NORMAL, ID_CACHED_EMPTY, ID_BAD, ID_LIVE, ID_GONE, ID_MISPLACED, ID_UNKNOWN]

/** Folded titles the deep read answers with. */
const TITLES = new Map([
  [ID_BAD, '边界情况排查'],
  [ID_MISPLACED, '错放目录验证'],
  [ID_UNKNOWN, '无头会话'],
  [ID_GONE, '已消失的会话'],
])

/** The one id whose fold rejects, to prove failures stay per-session. */
const TITLE_REJECTED_ID = ID_GONE

/** The rows the fake projection cache already holds. */
const CACHE_ROWS = new Map([
  // A cache hit whose title value is a plain string: what the shipped cache writes.
  [ID_NORMAL, { values: { title: '悬浮球插件调试' } }],
  // A cached row whose title value is null: folded, no title — an answer, not a miss.
  [ID_CACHED_EMPTY, { values: { title: null } }],
])

/** The headers the fake persistence reports, keyed by id. */
const HEADERS = new Map([
  [ID_NORMAL, { id: ID_NORMAL, cwd: CWD_ORB, createdAt: 1_700_000_000_000 }],
  [ID_CACHED_EMPTY, { id: ID_CACHED_EMPTY, cwd: CWD_ORB, createdAt: 1_700_000_100_000, parentSession: ID_NORMAL, isSeeded: true }],
  [ID_BAD, { id: ID_BAD, cwd: CWD_ORB, createdAt: 1_700_000_200_000 }],
  [ID_LIVE, { id: ID_LIVE, cwd: CWD_ORB, createdAt: 1_700_000_300_000 }],
  [ID_GONE, { id: ID_GONE, cwd: CWD_ORB, createdAt: 1_700_000_400_000 }],
  [ID_MISPLACED, { id: ID_MISPLACED, cwd: CWD_NOVEL, createdAt: 1_700_000_500_000 }],
])

/** The workspaces the fake registry reports. */
const WORKSPACES = [
  { id: 'ws-orb', path: CWD_ORB, title: 'dsh_orb', sessionIds: [ID_NORMAL, ID_CACHED_EMPTY, ID_LIVE] },
]

/** The one pinned session, so the row's pinned flag has both answers. */
const PINNED = [ID_CACHED_EMPTY]

/** What the fake `filterEvents` reports per session id. */
const SEARCH_DOCUMENTS = new Map([
  [ID_NORMAL, [
    { seq: 12, time: '2024-05-01T00:00:00.000Z', text: 'x'.repeat(120) + '我们讨论边界情况：目录不存在时如何拒绝删除。' + 'y'.repeat(120) },
    { seq: 13, time: '2024-05-01T00:01:00.000Z', text: '另一处边界也在这一段里。' },
  ]],
  [ID_CACHED_EMPTY, [
    { seq: 3, time: '2024-05-02T00:00:00.000Z', text: '归档之后又提到过一次边界。' },
  ]],
])

const HOME = process.env.DSH_HOME
const ROOT = join(HOME, 'sessions')

/** Paths the current fixture set wrote; refreshed by {@link resetFixtures}. */
const fixture = {
  normal: '',
  cachedEmpty: '',
  bad: '',
  live: '',
  unknown: '',
  misplaced: '',
  cacheNormal: '',
  cacheCachedEmpty: '',
}

/**
 * Write one session's log directory under the project directory its header derives.
 *
 * @param {string} id - the session id.
 * @param {string | undefined} cwd - the session's project directory.
 * @param {{ log?: number, extra?: string }} [options] - log size in bytes (`0` writes
 *   no log at all), plus an optional non-log file.
 * @returns {Promise<string>} the absolute session directory.
 */
async function writeSession(id, cwd, options = {}) {
  const log = options.log ?? 64
  const directory = layout.sessionDirectory(ROOT, { id, cwd })
  await mkdir(directory, { recursive: true })
  if (log > 0) await writeFile(join(directory, LOG_FILE), 'x'.repeat(log))
  if (options.extra !== undefined) await writeFile(join(directory, options.extra), 'not a session log')
  return directory
}

/**
 * Write one projection-cache entry, the file a permanent deletion also removes.
 *
 * @param {string} id - the session id.
 * @returns {Promise<string>} the absolute cache file.
 */
async function writeCache(id) {
  const file = layout.projectionCacheFile(HOME, id)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, '{"version":7}')
  return file
}

/**
 * Rebuild the whole fixture tree.
 *
 * Each check that touches the filesystem starts from this, because the
 * destructive checks are supposed to consume the tree: an assertion that nothing
 * was deleted is only meaningful when the thing that *should* have been deleted
 * is still there to begin with.
 */
async function resetFixtures() {
  await rm(ROOT, { recursive: true, force: true })
  await rm(join(HOME, 'storages'), { recursive: true, force: true })
  fixture.normal = await writeSession(ID_NORMAL, CWD_ORB, { log: 64 })
  fixture.cachedEmpty = await writeSession(ID_CACHED_EMPTY, CWD_ORB, { log: 64 })
  fixture.bad = await writeSession(ID_BAD, CWD_ORB, { log: 0, extra: 'notes.txt' })
  fixture.live = await writeSession(ID_LIVE, CWD_ORB, { log: 64 })
  fixture.unknown = await writeSession(ID_UNKNOWN, undefined, { log: 64 })
  // A directory whose project layer is not the one this header derives.
  fixture.misplaced = join(ROOT, layout.projectKey(CWD_ORB), layout.encodeSegment(ID_MISPLACED))
  await mkdir(fixture.misplaced, { recursive: true })
  await writeFile(join(fixture.misplaced, LOG_FILE), 'y'.repeat(32))
  fixture.cacheNormal = await writeCache(ID_NORMAL)
  fixture.cacheCachedEmpty = await writeCache(ID_CACHED_EMPTY)
}

await resetFixtures()

// ---------------------------------------------------------------------------
// The fake Host
// ---------------------------------------------------------------------------

/**
 * A stub plugin context exposing exactly the services this plugin reads.
 *
 * @param {{
 *   archived?: string[],
 *   live?: string[],
 *   omit?: string[],
 *   throwingUnarchive?: string[],
 *   brokenRegistry?: boolean,
 * }} [options] - per-check variations.
 * @returns {{ ctx: any, state: any }} the context plus what it observed.
 */
function fakeContext(options = {}) {
  const live = new Set(options.live ?? [ID_LIVE])
  const omitted = new Set(options.omit ?? [])
  const throwing = new Set(options.throwingUnarchive ?? [])
  const state = {
    /** The archive set the registry currently holds. */
    ids: [...(options.archived ?? ARCHIVED)],
    /** Every route `ctx.connection.fetch.register` was handed. */
    registered: [],
    /** Every effect label, in registration order. */
    effects: [],
    /** Every broadcast, as `[event, ...args]`. */
    emitted: [],
    /** Ids whose unarchive write succeeded. */
    unarchived: [],
    /** Ids whose unarchive write was attempted. */
    unarchiveAttempts: [],
    /** Ids handed to `readTitleSnapshots`, in call order. */
    titleReadIds: [],
    /** How often each seam was called. */
    counts: { listSessions: 0, persistenceList: 0, readTitleSnapshots: 0, filterEvents: 0 },
    /** Every `filterEvents` call, as `{ id, filters }`. */
    searchFilters: [],
  }

  const registry = {
    get archivedSessionIds() {
      if (options.brokenRegistry === true) throw new Error('registry exploded')
      return [...state.ids]
    },
    pinnedSessionIds: options.pinned ?? PINNED,
    list: () => WORKSPACES,
    async unarchiveSession(id) {
      state.unarchiveAttempts.push(id)
      if (throwing.has(id)) throw new Error('registry write failed for ' + id)
      state.unarchived.push(id)
      state.ids = state.ids.filter((candidate) => candidate !== id)
    },
  }

  const sessionQuery = {
    listSessions: async () => {
      state.counts.listSessions += 1
      return [...HEADERS.values()].map((header) => ({ header: { ...header } }))
    },
    /**
     * Mirrors the shipped service: one envelope per requested id, de-duplicated
     * in first-occurrence order, with the title as a snapshot object rather than
     * a bare string.
     */
    readTitleSnapshots: async (ids) => {
      state.counts.readTitleSnapshots += 1
      state.titleReadIds.push(...ids)
      return [...new Set(ids)].map((id) => {
        if (id === TITLE_REJECTED_ID) return { sessionId: id, status: 'rejected', reason: new Error('no such session') }
        const text = TITLES.get(id)
        return {
          sessionId: id,
          status: 'fulfilled',
          value: text === undefined
            ? { session: { id } }
            : { session: { id }, title: { title: text, messageSeqs: [1], source: { kind: 'user' }, eventSeq: 7, updatedAt: 1_700_000_000_000 } },
        }
      })
    },
    filterEvents: async (id, filters) => {
      state.counts.filterEvents += 1
      state.searchFilters.push({ id, filters })
      if (id === ID_LIVE) throw new Error('session log unreadable')
      return SEARCH_DOCUMENTS.get(id) ?? []
    },
  }

  const services = {
    sessionQuery,
    sessionPersistence: {
      list: async () => {
        state.counts.persistenceList += 1
        return [...HEADERS.values()].map((header) => ({ header: { ...header } }))
      },
    },
    sessions: {
      list: () => [...live].map((id) => ({ header: HEADERS.get(id) ?? { id, cwd: CWD_ORB, createdAt: 1 } })),
      get: (id) => (live.has(id) ? { header: HEADERS.get(id) ?? { id } } : undefined),
    },
    sessionProjectionCache: {
      cachedSnapshot: (header) => CACHE_ROWS.get(header?.id),
      cachedPredecessorTitle: () => undefined,
    },
    workspaceRegistry: registry,
  }

  const ctx = {
    connection: {
      fetch: {
        register(route) {
          state.registered.push(route)
          return () => {}
        },
      },
    },
    get(service) {
      if (omitted.has(service)) return undefined
      return services[service]
    },
    effect(factory, label) {
      state.effects.push(label)
      const dispose = factory()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    emit(event, ...args) {
      state.emitted.push([event, ...args])
    },
    logger: { debug() {}, warn() {} },
  }

  return { ctx, state }
}

/**
 * Call one registered route the way the connection channel would.
 *
 * Every route answers HTTP 200; a refusal is visible in the body's `ok` field,
 * and a mutation nests the fresh list payload under `payload`.
 *
 * @param {any} state - the fake context's state.
 * @param {string} path - the route path.
 * @param {{ method?: string, query?: Record<string, string>, body?: any }} [options]
 * @returns {Promise<{ status: number, body: any }>}
 */
async function callRoute(state, path, options = {}) {
  const route = state.registered.find((candidate) => candidate.path === path)
  assert.ok(route !== undefined, `no route registered for ${path}`)
  const query = options.query === undefined ? '' : `?${new URLSearchParams(options.query).toString()}`
  const init = { method: options.method ?? 'GET', headers: {} }
  if (options.body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
  }
  const response = await route.fetch(new Request(`http://127.0.0.1${path}${query}`, init))
  return { status: response.status, body: await response.json() }
}

/**
 * Index one list payload's rows by session id.
 *
 * @param {any} body - a list payload.
 * @returns {Map<string, any>}
 */
function rowsById(body) {
  return new Map(body.items.map((row) => [row.id, row]))
}

// ---------------------------------------------------------------------------
// 1. Layout rules, against the shipped backend's own names
// ---------------------------------------------------------------------------

await check('encodeSegment matches the shipped escaping, including ids', () => {
  assert.equal(layout.encodeSegment('session-98d72200-ee38-4e36-946a-114b9eb3afbb'), 'session-98d72200-ee38-4e36-946a-114b9eb3afbb')
  assert.equal(layout.encodeSegment('.'), '~002E')
  assert.equal(layout.encodeSegment('..'), '~002E~002E')
  assert.equal(layout.encodeSegment('a/b\\c:d'), 'a~002Fb~005Cc~003Ad')
  assert.equal(layout.encodeSegment('~'), '~007E')
  assert.equal(layout.encodeSegment('小说'), '~5C0F~8BF4')
  assert.throws(() => layout.encodeSegment(''))
})

await check('projectKey reproduces real on-disk project directories', () => {
  assert.equal(layout.projectKey(CWD_ORB), '--C-Users-dev-.dsh-dsh_orb--')
  assert.equal(layout.projectKey(CWD_NOVEL), '--D-AI-~5C0F~8BF4~793A~4F8B--')
  assert.equal(layout.projectKey('D:\\AI\\my notes 笔记'), '--D-AI-my~0020notes~0020~7B14~8BB0--')
  assert.equal(layout.projectKey('/'), '--root--')
  assert.throws(() => layout.projectKey(''))
})

await check('sessionDirectory joins root, project key, and encoded id', () => {
  assert.equal(
    layout.sessionDirectory(ROOT, { id: ID_NORMAL, cwd: CWD_ORB }),
    join(ROOT, '--C-Users-dev-.dsh-dsh_orb--', ID_NORMAL),
  )
  // A session with no project path is grouped apart, not at the root.
  assert.equal(layout.projectDirectory(ROOT, undefined), join(ROOT, '_no-cwd'))
  assert.equal(layout.sessionDirectory(ROOT, { id: ID_UNKNOWN, cwd: undefined }), join(ROOT, '_no-cwd', ID_UNKNOWN))
  assert.equal(
    layout.projectionCacheFile(HOME, ID_NORMAL),
    join(HOME, 'storages', 'session_projcache', 'sessions', ID_NORMAL + '.json'),
  )
  assert.equal(layout.sessionsRoot(HOME), ROOT)
})

await check('assertDeletableDirectory refuses anything it cannot prove', async () => {
  await resetFixtures()
  const header = { id: ID_NORMAL, cwd: CWD_ORB }
  const inside = layout.sessionDirectory(ROOT, header)
  assert.equal(layout.assertDeletableDirectory(ROOT, inside, header, [LOG_FILE]).ok, true)
  // A directory whose last segment is not this id's encoded segment.
  assert.equal(layout.assertDeletableDirectory(ROOT, inside, { id: 'session-other', cwd: CWD_ORB }, [LOG_FILE]).reason, 'ID_MISMATCH')
  // A directory under a project key this session's cwd does not derive.
  assert.equal(layout.assertDeletableDirectory(ROOT, inside, { id: ID_NORMAL, cwd: CWD_NOVEL }, [LOG_FILE]).reason, 'PROJECT_MISMATCH')
  // A directory holding no session log.
  assert.equal(layout.assertDeletableDirectory(ROOT, fixture.bad, { id: ID_BAD, cwd: CWD_ORB }, ['notes.txt']).reason, 'NOT_A_SESSION_DIRECTORY')
  // The root itself, a sibling tree, and the project layer.
  assert.equal(layout.assertDeletableDirectory(ROOT, ROOT, header, []).reason, 'OUTSIDE_ROOT')
  assert.equal(layout.assertDeletableDirectory(ROOT, join(ROOT, '..', 'storages'), header, []).reason, 'OUTSIDE_ROOT')
  assert.equal(layout.assertDeletableDirectory(ROOT, join(ROOT, '--C-Users-dev-.dsh-dsh_orb--'), header, []).reason, 'MISPLACED')
  // A directory claimed by a session persistence no longer lists: the guard must
  // refuse, never throw, because a throw here fails the whole list request.
  const headerless = layout.assertDeletableDirectory(ROOT, join(ROOT, '_no-cwd', ID_UNKNOWN), undefined, [LOG_FILE])
  assert.equal(headerless.ok, false, 'no header means no proof')
  assert.equal(typeof headerless.reason, 'string')
  assert.equal(headerless.reason, 'NO_HEADER')
})

// ---------------------------------------------------------------------------
// 2. The route surface
// ---------------------------------------------------------------------------

await check('apply registers exactly the five archive routes on the connection channel', () => {
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  assert.equal(host.name, 'dsh-archive-manager')
  assert.deepEqual(host.inject, ['connection'])
  assert.equal(host.CONFIG_DEFAULTS, DEFAULTS)
  assert.deepEqual(
    state.registered.map((route) => [route.path, [...route.methods].join(',')]),
    [
      ['/api/archive/sessions', 'GET'],
      ['/api/archive/titles', 'GET'],
      ['/api/archive/search', 'GET'],
      ['/api/archive/restore', 'POST'],
      ['/api/archive/delete', 'POST'],
    ],
  )
  for (const route of state.registered) {
    assert.equal(route.requestBody, 'buffered', route.path + ' buffers its own body')
    assert.equal(typeof route.fetch, 'function', route.path + ' has a handler')
  }
  assert.deepEqual(state.effects, [
    'dsh-archive-manager: list route',
    'dsh-archive-manager: titles route',
    'dsh-archive-manager: search route',
    'dsh-archive-manager: restore route',
    'dsh-archive-manager: delete route',
  ])
})

await check('an unexpected failure is an ok:false refusal, never a thrown request', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext({ brokenRegistry: true })
  host.apply(ctx)
  const { status, body } = await callRoute(state, '/api/archive/restore', { method: 'POST', body: { ids: [ID_NORMAL] } })
  assert.equal(status, 200)
  assert.equal(body.ok, false)
  assert.equal(body.code, 'INTERNAL')
  assert.match(body.message, /registry exploded/)
  assert.equal(existsSync(fixture.normal), true)
})

// ---------------------------------------------------------------------------
// 3. The list payload
// ---------------------------------------------------------------------------

await check('the list route describes the archive set and its totals', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const { status, body } = await callRoute(state, '/api/archive/sessions')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.home, '$DSH_HOME')
  assert.equal(body.homePath, HOME.replace(/\\/g, '/'))
  assert.equal(body.sessionsRoot, '$DSH_HOME/sessions')
  assert.equal(body.sessionsRootPath, ROOT.replace(/\\/g, '/'))
  assert.equal(typeof body.timeZone, 'string')
  assert.equal(Number.isNaN(Date.parse(body.generatedAt)), false)
  assert.deepEqual(body.totals, { archived: 7, onDisk: 6, live: 1, bytes: 288, deletable: 2 })
  assert.deepEqual(body.capabilities, { batchLimit: DEFAULTS.maxBatchSize, titles: true, contentSearch: true })
  assert.deepEqual(body.query, { text: '', terms: [] })
  assert.equal(body.matchCount, 7)
  // Rows come back in the archive set's own order.
  assert.deepEqual(body.items.map((row) => row.id), ARCHIVED)
  // ...and the first paint folds no session log.
  assert.equal(state.counts.readTitleSnapshots, 0, 'the fast tier never opens a log')
})

await check('a row carries every field the page renders', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const { body } = await callRoute(state, '/api/archive/sessions')
  const rows = rowsById(body)

  const normal = rows.get(ID_NORMAL)
  assert.equal(normal.title, '悬浮球插件调试')
  assert.equal(normal.titleSource, 'cache')
  assert.equal(normal.cwd, CWD_ORB)
  assert.deepEqual(normal.project, { key: layout.projectKey(CWD_ORB), label: 'dsh_orb', title: 'dsh_orb' })
  assert.deepEqual(normal.workspace, { id: 'ws-orb', path: CWD_ORB, title: 'dsh_orb' })
  assert.equal(normal.createdAt, 1_700_000_000_000)
  assert.ok(normal.updatedAt > 0, 'the write time comes from the log file')
  assert.equal(normal.parentSession, null)
  assert.equal(normal.seeded, false)
  assert.equal(normal.directory, '$DSH_HOME/sessions/--C-Users-dev-.dsh-dsh_orb--/' + ID_NORMAL)
  assert.equal(normal.directoryPath, join(fixture.normal).replace(/\\/g, '/'))
  assert.equal(normal.onDisk, true)
  assert.equal(normal.live, false)
  assert.equal(normal.files, 1)
  assert.equal(normal.logName, LOG_FILE)
  assert.equal(normal.sizeBytes, 64)
  assert.equal(normal.pinned, false)
  assert.equal(normal.deletable, true)
  assert.equal(normal.deleteBlockedBy, null)
  assert.equal(normal.deleteBlockedMessage, null)
  assert.equal(normal.hasHeader, true)

  // 缓存里折叠成空标题的那一行：a cached null title is an answer, and it is pinned.
  const cachedEmpty = rows.get(ID_CACHED_EMPTY)
  assert.equal(cachedEmpty.title, null)
  assert.equal(cachedEmpty.titleSource, 'cache')
  assert.equal(cachedEmpty.pinned, true)
  assert.equal(cachedEmpty.parentSession, ID_NORMAL)
  assert.equal(cachedEmpty.seeded, true)
  assert.equal(cachedEmpty.deletable, true)
})

await check('the odd shapes stay describable instead of being dropped', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const { body } = await callRoute(state, '/api/archive/sessions')
  const rows = rowsById(body)

  // 只剩归档记录：the row survives its artifacts, because the page is where it
  // can be dismissed from the archive list.
  const gone = rows.get(ID_GONE)
  assert.equal(gone.hasHeader, true)
  assert.equal(gone.onDisk, false)
  assert.equal(gone.files, 0)
  assert.equal(gone.logName, null)
  assert.equal(gone.sizeBytes, 0)
  assert.equal(gone.updatedAt, null)
  assert.equal(gone.deletable, false)

  // 目录里没有会话日志：notes.txt is not a session artifact.
  const bad = rows.get(ID_BAD)
  assert.equal(bad.onDisk, true)
  assert.equal(bad.files, 0)
  assert.equal(bad.sizeBytes, 0)
  assert.equal(bad.deletable, false)

  // 没有会话头：the row still renders, grouped under _no-cwd, and it is not
  // deletable — the delete path needs a header to prove the directory.
  const unknown = rows.get(ID_UNKNOWN)
  assert.equal(unknown.hasHeader, false)
  assert.equal(unknown.cwd, null)
  assert.equal(unknown.onDisk, true)
  assert.equal(unknown.files, 1)
  assert.equal(unknown.deletable, false)
  assert.equal(unknown.project.key, '_no-cwd')
  assert.equal(unknown.project.label, '（无项目路径）')
  assert.equal(unknown.project.title, '')
  assert.equal(unknown.workspace, null)

  // 放错项目层：the key describes where the directory actually is, so the page
  // can show it and the Host can refuse it.
  const misplaced = rows.get(ID_MISPLACED)
  assert.equal(misplaced.cwd, CWD_NOVEL)
  assert.equal(misplaced.project.key, layout.projectKey(CWD_ORB))
  assert.equal(misplaced.project.label, '小说示例')
  assert.equal(misplaced.sizeBytes, 32)
})

await check('the list names why each row cannot be deleted', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const { body } = await callRoute(state, '/api/archive/sessions')
  const rows = rowsById(body)

  assert.equal(rows.get(ID_NORMAL).deleteBlockedBy, null)
  assert.equal(rows.get(ID_CACHED_EMPTY).deleteBlockedBy, null)
  assert.equal(rows.get(ID_BAD).deleteBlockedBy, 'NOT_A_SESSION_DIRECTORY')
  assert.equal(rows.get(ID_LIVE).deleteBlockedBy, 'LIVE_SESSION')
  assert.equal(rows.get(ID_GONE).deleteBlockedBy, 'NOT_ON_DISK')
  assert.equal(rows.get(ID_MISPLACED).deleteBlockedBy, 'PROJECT_MISMATCH')
  assert.equal(rows.get(ID_UNKNOWN).deleteBlockedBy, 'NO_HEADER')
  assert.equal(rows.get(ID_LIVE).deletable, false, 'a running session is never deletable')
  assert.equal(rows.get(ID_UNKNOWN).deletable, false, 'a row the delete path must refuse is not deletable')

  // A refusal always carries the sentence the page shows next to the row.
  for (const row of body.items) {
    if (row.deleteBlockedBy === null) {
      assert.equal(row.deleteBlockedMessage, null, row.id)
      continue
    }
    assert.equal(typeof row.deleteBlockedMessage, 'string', row.id)
    assert.ok(row.deleteBlockedMessage.length > 0, row.id)
  }
})

// ---------------------------------------------------------------------------
// 4. The caches the first paint depends on
// ---------------------------------------------------------------------------

await check('two list reads inside the TTL share one header listing', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const first = await callRoute(state, '/api/archive/sessions')
  assert.equal(state.counts.listSessions, 1)
  const second = await callRoute(state, '/api/archive/sessions')
  assert.equal(state.counts.listSessions, 1, 'the second read is served from the snapshot cache')
  assert.equal(second.body.generatedAt, first.body.generatedAt)
  assert.deepEqual(second.body.items, first.body.items)
  // `refresh=0` is not a refresh.
  await callRoute(state, '/api/archive/sessions', { query: { refresh: '0' } })
  assert.equal(state.counts.listSessions, 1)
})

await check('?refresh=1 re-reads the corpus and the directory tree', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  await callRoute(state, '/api/archive/sessions')
  assert.equal(state.counts.listSessions, 1)
  const refreshed = await callRoute(state, '/api/archive/sessions', { query: { refresh: '1' } })
  assert.equal(state.counts.listSessions, 2, 'a refresh goes back to the seam')
  assert.equal(refreshed.body.items.length, 7)
})

await check('a batch mutation invalidates the built snapshot', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  const snapshot = new ArchiveSnapshot(ctx, {})
  const operations = new ArchiveOperations(ctx, snapshot, DEFAULTS.maxBatchSize)
  const before = await snapshot.read()
  assert.equal(before.items.some((row) => row.id === ID_NORMAL), true)
  assert.equal(state.counts.listSessions, 1)

  const { results: removed } = await operations.remove([ID_NORMAL], {})
  assert.equal(removed[0].ok, true)
  assert.equal(state.counts.listSessions, 2, 'the removal observes the set it is about to change')

  // Without the invalidation this read would replay the build the removal made
  // *before* deleting anything.
  const after = await snapshot.read()
  assert.equal(state.counts.listSessions, 3, 'the invalidated snapshot is rebuilt, not reused')
  assert.equal(after.items.some((row) => row.id === ID_NORMAL), false)
  assert.equal(after.totals.archived, 6)
})

// ---------------------------------------------------------------------------
// 5. Titles — the second tier
// ---------------------------------------------------------------------------

await check('a cached title wins, and a cached null is an answer too', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const { body } = await callRoute(state, '/api/archive/sessions')
  const rows = rowsById(body)
  assert.equal(rows.get(ID_NORMAL).title, '悬浮球插件调试')
  assert.equal(rows.get(ID_NORMAL).titleSource, 'cache')
  assert.equal(rows.get(ID_CACHED_EMPTY).title, null)
  assert.equal(rows.get(ID_CACHED_EMPTY).titleSource, 'cache', 'a folded-empty cache row must not ask for a deep read')
  for (const id of [ID_BAD, ID_LIVE, ID_GONE, ID_MISPLACED, ID_UNKNOWN]) {
    assert.equal(rows.get(id).title, null, id)
    assert.equal(rows.get(id).titleSource, 'none', id)
  }
  assert.equal(state.counts.readTitleSnapshots, 0)
})

await check('the titles route resolves the rows the cache could not answer', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const ids = [ID_BAD, ID_MISPLACED]
  const { status, body } = await callRoute(state, '/api/archive/titles', { query: { ids: ids.join(',') } })
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.deepEqual(body.titles, { [ID_BAD]: '边界情况排查', [ID_MISPLACED]: '错放目录验证' })
  assert.deepEqual(body.pending, [])
  assert.deepEqual(body.failed, [])
  assert.equal(state.counts.readTitleSnapshots, 1)
  assert.deepEqual(state.titleReadIds, ids)

  // The memo becomes the snapshot's own answer on the next read...
  const after = await callRoute(state, '/api/archive/sessions', { query: { refresh: '1' } })
  const rows = rowsById(after.body)
  assert.equal(rows.get(ID_BAD).title, '边界情况排查')
  assert.equal(rows.get(ID_BAD).titleSource, 'memo')
  assert.equal(rows.get(ID_MISPLACED).titleSource, 'memo')

  // ...and the same ids are never folded twice.
  const again = await callRoute(state, '/api/archive/titles', { query: { ids: ids.join(',') } })
  assert.deepEqual(again.body.titles, {})
  assert.deepEqual(again.body.pending, [])
  assert.equal(state.counts.readTitleSnapshots, 1, 'a memoized title is not read again')
})

await check('the titles route pages past its batch and tolerates a rejected read', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const first = await callRoute(state, '/api/archive/titles', { query: { ids: [ID_MISPLACED, ID_UNKNOWN].join(','), batch: '1' } })
  assert.deepEqual(first.body.titles, { [ID_MISPLACED]: '错放目录验证' })
  assert.deepEqual(first.body.pending, [ID_UNKNOWN], 'the rest stays pending for the next page')
  const second = await callRoute(state, '/api/archive/titles', { query: { ids: [ID_UNKNOWN].join(','), batch: '1' } })
  assert.deepEqual(second.body.titles, { [ID_UNKNOWN]: '无头会话' })
  assert.deepEqual(second.body.pending, [])
  assert.equal(state.counts.readTitleSnapshots, 2)

  // One rejected fold is reported per id, never as a whole-route failure.
  const rejected = await callRoute(state, '/api/archive/titles', { query: { ids: TITLE_REJECTED_ID } })
  assert.equal(rejected.body.ok, true)
  assert.deepEqual(rejected.body.failed, [TITLE_REJECTED_ID])
  assert.equal(Object.hasOwn(rejected.body.titles, TITLE_REJECTED_ID), false)
  const list = await callRoute(state, '/api/archive/sessions', { query: { refresh: '1' } })
  assert.equal(rowsById(list.body).get(TITLE_REJECTED_ID).titleSource, 'none', 'a failed fold leaves the row askable')
})

await check('the titles route refuses an empty id list', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  for (const query of [undefined, { ids: '' }, { ids: ' , ,' }]) {
    const { status, body } = await callRoute(state, '/api/archive/titles', { query })
    assert.equal(status, 200)
    assert.equal(body.ok, false)
    assert.equal(body.code, 'EMPTY_SELECTION')
    assert.equal(typeof body.message, 'string')
  }
  assert.equal(state.counts.readTitleSnapshots, 0)
})

await check('lib/snapshot.js unwraps every title shape the writer produced', () => {
  assert.equal(titleText('  悬浮球  '), '悬浮球')
  assert.equal(titleText(''), undefined)
  assert.equal(titleText('   '), undefined)
  assert.equal(titleText(null), undefined)
  assert.equal(titleText(42), undefined)
  assert.equal(titleText({ title: '归档流程验证' }), '归档流程验证')
  assert.equal(titleText({ title: { title: '  旧快照  ' } }), '旧快照')
  assert.equal(titleText({ title: null }), undefined)

  // The three outcomes the snapshot depends on: a text, a folded-empty title,
  // and "no cached row at all".
  const cache = {
    cachedSnapshot: (header) => CACHE_ROWS.get(header?.id),
    cachedPredecessorTitle: () => undefined,
  }
  assert.deepEqual(projectionTitle(cache, { id: ID_NORMAL }), { state: 'text', text: '悬浮球插件调试' })
  assert.deepEqual(projectionTitle(cache, { id: ID_CACHED_EMPTY }), { state: 'empty' })
  assert.deepEqual(projectionTitle(cache, { id: ID_BAD }), { state: 'unknown' })
  assert.deepEqual(projectionTitle(undefined, { id: ID_NORMAL }), { state: 'unknown' })
  assert.deepEqual(projectionTitle({ cachedSnapshot: () => { throw new Error('boom') } }, { id: ID_NORMAL }), { state: 'unknown' })
  // A row without a title key is a miss, not an empty answer.
  assert.deepEqual(projectionTitle({ cachedSnapshot: () => ({ values: { session: {} } }) }, { id: ID_NORMAL }), { state: 'unknown' })
})

// ---------------------------------------------------------------------------
// 6. Search — the in-memory filter and the content scan
// ---------------------------------------------------------------------------

await check('the list route filters by title, project path, directory and id', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)

  const byTitle = await callRoute(state, '/api/archive/sessions', { query: { q: '悬浮球' } })
  assert.equal(byTitle.body.matchCount, 1)
  assert.deepEqual(byTitle.body.query, { text: '悬浮球', terms: ['悬浮球'] })
  assert.equal(byTitle.body.items[0].id, ID_NORMAL)
  assert.deepEqual(byTitle.body.items[0].matched, ['title'])
  assert.equal(byTitle.body.totals.archived, 7, 'the totals still describe the whole set')

  const byProject = await callRoute(state, '/api/archive/sessions', { query: { q: 'dsh_orb' } })
  assert.equal(byProject.body.matchCount, 6)
  assert.equal(byProject.body.items.some((row) => row.id === ID_UNKNOWN), false, 'the _no-cwd row has no project path')
  assert.deepEqual(rowsById(byProject.body).get(ID_NORMAL).matched, ['cwd', 'directory'])
  assert.deepEqual(rowsById(byProject.body).get(ID_MISPLACED).matched, ['directory'], 'the directory is where the row is, not where the header says')

  const byCwd = await callRoute(state, '/api/archive/sessions', { query: { q: '小说示例' } })
  assert.deepEqual(byCwd.body.items.map((row) => row.id), [ID_MISPLACED])
  assert.deepEqual(byCwd.body.items[0].matched, ['cwd'])

  const byId = await callRoute(state, '/api/archive/sessions', { query: { q: 'unknown-1' } })
  assert.deepEqual(byId.body.items.map((row) => row.id), [ID_UNKNOWN])
  assert.deepEqual(byId.body.items[0].matched, ['directory', 'id'])
})

await check('every term must match, case-insensitively, or the row is out', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const both = await callRoute(state, '/api/archive/sessions', { query: { q: 'DSH_ORB 悬浮球' } })
  assert.deepEqual(both.body.query.terms, ['dsh_orb', '悬浮球'])
  assert.deepEqual(both.body.items.map((row) => row.id), [ID_NORMAL])
  const nothing = await callRoute(state, '/api/archive/sessions', { query: { q: 'dsh_orb zzz-not-there' } })
  assert.equal(nothing.body.matchCount, 0)
  assert.deepEqual(nothing.body.items, [])
  // A blank query answers the whole set and adds no highlight data.
  const blank = await callRoute(state, '/api/archive/sessions', { query: { q: '   ' } })
  assert.equal(blank.body.matchCount, 7)
  assert.deepEqual(blank.body.query, { text: '', terms: [] })
  assert.equal(Object.hasOwn(blank.body.items[0], 'matched'), false)
})

await check('content search refuses a blank query and an unmounted sessionQuery', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const blank = await callRoute(state, '/api/archive/search')
  assert.equal(blank.status, 200)
  assert.equal(blank.body.ok, false)
  assert.equal(blank.body.code, 'EMPTY_QUERY')
  const spaces = await callRoute(state, '/api/archive/search', { query: { q: '   ' } })
  assert.equal(spaces.body.code, 'EMPTY_QUERY')

  // A deployment without sessionQuery says so instead of scanning nothing.
  const bare = fakeContext({ omit: ['sessionQuery'] })
  host.apply(bare.ctx)
  const unavailable = await callRoute(bare.state, '/api/archive/search', { query: { q: '边界' } })
  assert.equal(unavailable.body.ok, false)
  assert.equal(unavailable.body.code, 'UNAVAILABLE')
  assert.equal(typeof unavailable.body.message, 'string')
})

await check('content search reports hits, snippets and skipped sessions', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  await callRoute(state, '/api/archive/sessions')
  const { status, body } = await callRoute(state, '/api/archive/search', { query: { q: '边界', batch: '24', budgetMs: '8000' } })
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.total, 7)
  assert.equal(body.cursor, 0)
  assert.equal(body.scanned, 7)
  assert.equal(body.nextCursor, 7)
  assert.equal(body.done, true)
  assert.equal(body.truncated, false)
  // One unreadable log is skipped, not fatal.
  assert.deepEqual(body.skipped, [ID_LIVE])
  assert.deepEqual(body.hits.map((hit) => [hit.id, hit.count]), [[ID_NORMAL, 2], [ID_CACHED_EMPTY, 1]])
  assert.equal(state.counts.filterEvents, 7)

  const hit = body.hits[0]
  assert.equal(hit.seq, 12)
  assert.equal(hit.time, '2024-05-01T00:00:00.000Z')
  assert.match(hit.snippet, /边界/)
  assert.ok(hit.snippet.startsWith('…'), 'a snippet cut from the middle says so')
  assert.ok(hit.snippet.endsWith('…'), '...on both sides')
  assert.equal(hit.snippet.includes('\n'), false, 'a snippet is one line')

  // The scan asks for messages of the current surface only, with the query text.
  const filters = state.searchFilters[0].filters
  assert.deepEqual(filters.map((filter) => filter.kind), ['type', 'surface', 'text'])
  assert.deepEqual(filters[0].values, ['user/message', 'assistant/message'])
  assert.deepEqual(filters[1].values, ['current'])
  assert.equal(filters[2].text, '边界')
})

await check('content search advances one page at a time until it is done', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  await callRoute(state, '/api/archive/sessions')
  const pages = []
  let cursor = 0
  for (let round = 0; round < 10; round += 1) {
    const { body } = await callRoute(state, '/api/archive/search', {
      query: { q: '边界', batch: '2', budgetMs: '8000', cursor: String(cursor) },
    })
    assert.equal(body.ok, true)
    assert.equal(body.cursor, cursor, 'the answer echoes the cursor it was asked for')
    pages.push(body)
    cursor = body.nextCursor
    if (body.done) break
  }
  assert.deepEqual(pages.map((page) => page.nextCursor), [2, 4, 6, 7])
  assert.deepEqual(pages.map((page) => page.done), [false, false, false, true])
  assert.deepEqual(pages.map((page) => page.scanned), [2, 2, 2, 1])
  assert.equal(pages.every((page) => page.total === 7), true)
  assert.deepEqual(pages.flatMap((page) => page.hits).map((hit) => hit.id), [ID_NORMAL, ID_CACHED_EMPTY])
  assert.deepEqual(pages.flatMap((page) => page.skipped), [ID_LIVE])
})

// ---------------------------------------------------------------------------
// 7. Restore — the reversible half
// ---------------------------------------------------------------------------

await check('restore drops one id from the archive set and leaves the log alone', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const { status, body } = await callRoute(state, '/api/archive/restore', { method: 'POST', body: { ids: [ID_NORMAL] } })
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.deepEqual(body.results, [{ id: ID_NORMAL, ok: true }])
  assert.deepEqual(body.summary, { requested: 1, succeeded: 1, failed: 0, bytes: 0 })
  assert.deepEqual(state.unarchived, [ID_NORMAL])
  assert.equal(existsSync(fixture.normal), true, 'restoring never touches the log')
  assert.equal(body.payload.items.some((row) => row.id === ID_NORMAL), false)
  assert.equal(body.payload.totals.archived, 6)
  // The plain read agrees afterwards, so the mutation invalidated the snapshot.
  const after = await callRoute(state, '/api/archive/sessions')
  assert.equal(after.body.items.some((row) => row.id === ID_NORMAL), false)
  // A legacy single-id body still works.
  const legacy = await callRoute(state, '/api/archive/restore', { method: 'POST', body: { id: ID_CACHED_EMPTY } })
  assert.deepEqual(legacy.body.results, [{ id: ID_CACHED_EMPTY, ok: true }])
})

await check('restore takes a batch and reports the ids outside it', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const ids = [ID_NORMAL, ID_CACHED_EMPTY, ID_LIVE, 'session-never-seen']
  const { body } = await callRoute(state, '/api/archive/restore', { method: 'POST', body: { ids } })
  assert.equal(body.ok, true)
  assert.deepEqual(body.results, [
    { id: ID_NORMAL, ok: true },
    { id: ID_CACHED_EMPTY, ok: true },
    { id: ID_LIVE, ok: true },
    { id: 'session-never-seen', ok: false, code: 'NOT_ARCHIVED', message: '该会话不在归档中' },
  ])
  assert.deepEqual(body.summary, { requested: 4, succeeded: 3, failed: 1, bytes: 0 })
  assert.deepEqual(state.unarchived, [ID_NORMAL, ID_CACHED_EMPTY, ID_LIVE])
  assert.deepEqual(body.payload.items.map((row) => row.id), [ID_BAD, ID_GONE, ID_MISPLACED, ID_UNKNOWN])
  // Nothing on disk moved.
  for (const path of [fixture.normal, fixture.cachedEmpty, fixture.live]) assert.equal(existsSync(path), true)
})

await check('one failing unarchive does not abort the rest of the batch', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext({ throwingUnarchive: [ID_CACHED_EMPTY] })
  host.apply(ctx)
  const ids = [ID_NORMAL, ID_CACHED_EMPTY, ID_LIVE]
  const { body } = await callRoute(state, '/api/archive/restore', { method: 'POST', body: { ids } })
  assert.equal(body.ok, true)
  assert.deepEqual(body.results.map((result) => [result.id, result.ok]), [[ID_NORMAL, true], [ID_CACHED_EMPTY, false], [ID_LIVE, true]])
  assert.equal(body.results[1].code, 'RESTORE_FAILED')
  assert.match(body.results[1].message, /registry write failed/)
  assert.deepEqual(body.summary, { requested: 3, succeeded: 2, failed: 1, bytes: 0 })
  assert.deepEqual(state.unarchiveAttempts, ids)
  assert.deepEqual(state.unarchived, [ID_NORMAL, ID_LIVE])
  // The id whose registry write failed is still archived, so it is still listed.
  assert.equal(body.payload.items.some((row) => row.id === ID_CACHED_EMPTY), true)
})

// ---------------------------------------------------------------------------
// 8. Delete — the destructive half
// ---------------------------------------------------------------------------

await check('permanent deletion removes the directory, its cache entry, and the archive record', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  // The page loads first, so the snapshot is warm and the invalidation matters.
  await callRoute(state, '/api/archive/sessions')
  const { status, body } = await callRoute(state, '/api/archive/delete', {
    method: 'POST',
    body: { ids: [ID_NORMAL], confirm: true },
  })
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.dryRun, false)
  assert.deepEqual(body.results, [{ id: ID_NORMAL, ok: true, bytes: 64 }])
  assert.deepEqual(body.summary, { requested: 1, succeeded: 1, failed: 0, bytes: 64 })
  assert.equal(existsSync(fixture.normal), false, 'the session directory is gone')
  assert.equal(existsSync(join(ROOT, '--C-Users-dev-.dsh-dsh_orb--')), true, 'its project layer stays')
  assert.equal(existsSync(fixture.cacheNormal), false, "the session's projection-cache entry is gone")
  assert.equal(existsSync(fixture.cacheCachedEmpty), true, "another session's cache entry is not")
  assert.deepEqual(state.unarchived, [ID_NORMAL])
  // The returned payload is the new set, and a plain read agrees with it.
  assert.equal(body.payload.items.some((row) => row.id === ID_NORMAL), false)
  assert.deepEqual(body.payload.totals, { archived: 6, onDisk: 5, live: 1, bytes: 224, deletable: 1 })
  const after = await callRoute(state, '/api/archive/sessions')
  assert.equal(after.body.items.some((row) => row.id === ID_NORMAL), false)
})

await check('a dry run reports what would go and removes nothing', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const ids = [ID_NORMAL, ID_CACHED_EMPTY]
  const { body } = await callRoute(state, '/api/archive/delete', {
    method: 'POST',
    body: { ids, dryRun: true },
  })
  assert.equal(body.ok, true)
  assert.equal(body.dryRun, true)
  assert.deepEqual(body.results, [
    { id: ID_NORMAL, ok: true, bytes: 64, dryRun: true },
    { id: ID_CACHED_EMPTY, ok: true, bytes: 64, dryRun: true },
  ])
  assert.deepEqual(body.summary, { requested: 2, succeeded: 2, failed: 0, bytes: 128 })
  assert.equal(existsSync(fixture.normal), true)
  assert.equal(existsSync(fixture.cachedEmpty), true)
  assert.equal(existsSync(fixture.cacheNormal), true)
  assert.deepEqual(state.unarchived, [])
  assert.deepEqual(state.emitted, [])
  assert.equal(body.payload.items.length, 7, 'the archive set is untouched')
})

await check('deletion without an explicit confirm is refused', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  for (const body of [{ ids: [ID_NORMAL] }, { ids: [ID_NORMAL], confirm: false }, { ids: [ID_NORMAL], confirm: 'yes' }]) {
    const answer = await callRoute(state, '/api/archive/delete', { method: 'POST', body })
    assert.equal(answer.status, 200)
    assert.equal(answer.body.ok, false)
    assert.equal(answer.body.code, 'CONFIRM_REQUIRED')
    assert.equal(typeof answer.body.message, 'string')
  }
  assert.equal(existsSync(fixture.normal), true)
  assert.deepEqual(state.unarchived, [])
  assert.deepEqual(state.emitted, [])
})

await check('deletion refuses a running session and leaves its log alone', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const { body } = await callRoute(state, '/api/archive/delete', { method: 'POST', body: { ids: [ID_LIVE], confirm: true } })
  assert.equal(body.ok, true, 'the batch is accepted; the row is what is refused')
  assert.deepEqual(body.results, [{ id: ID_LIVE, ok: false, code: 'LIVE_SESSION', message: '会话正在运行，不能删除' }])
  assert.deepEqual(body.summary, { requested: 1, succeeded: 0, failed: 1, bytes: 0 })
  assert.equal(existsSync(fixture.live), true)
  assert.equal(existsSync(join(fixture.live, LOG_FILE)), true)
  assert.deepEqual(state.unarchived, [])
})

await check('deletion distinguishes a missing directory from a missing header', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const gone = await callRoute(state, '/api/archive/delete', { method: 'POST', body: { ids: [ID_GONE], confirm: true } })
  assert.deepEqual(gone.body.results.map((result) => [result.id, result.ok, result.code]), [[ID_GONE, false, 'NOT_ON_DISK']])

  const unknown = await callRoute(state, '/api/archive/delete', { method: 'POST', body: { ids: [ID_UNKNOWN], confirm: true } })
  assert.deepEqual(unknown.body.results.map((result) => [result.id, result.ok, result.code]), [[ID_UNKNOWN, false, 'NO_HEADER']])
  assert.equal(existsSync(fixture.unknown), true, 'a row with no header never authorizes a removal')
  assert.deepEqual(state.unarchived, [])
})

await check('deletion refuses a directory with no session log in it', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const { body } = await callRoute(state, '/api/archive/delete', { method: 'POST', body: { ids: [ID_BAD], confirm: true } })
  assert.deepEqual(body.results.map((result) => [result.id, result.ok, result.code]), [[ID_BAD, false, 'NOT_A_SESSION_DIRECTORY']])
  assert.equal(existsSync(fixture.bad), true, 'the unexplained directory is untouched')
  assert.equal(existsSync(join(fixture.bad, 'notes.txt')), true)
  assert.deepEqual(state.unarchived, [])
})

await check('deletion refuses a directory under the wrong project layer', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const { body } = await callRoute(state, '/api/archive/delete', { method: 'POST', body: { ids: [ID_MISPLACED], confirm: true } })
  assert.deepEqual(body.results.map((result) => [result.id, result.ok, result.code]), [[ID_MISPLACED, false, 'PROJECT_MISMATCH']])
  assert.equal(existsSync(fixture.misplaced), true)
  assert.equal(existsSync(join(fixture.misplaced, LOG_FILE)), true)
  assert.deepEqual(state.unarchived, [])
})

await check('deletion rejects an unusable id list before touching anything', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  // A deployment configured for two ids per batch.
  host.apply(ctx, { maxBatchSize: 2 })
  const list = await callRoute(state, '/api/archive/sessions')
  assert.equal(list.body.capabilities.batchLimit, 2, 'the configured limit reaches the page')
  assert.deepEqual(list.body.totals.archived, 7)

  const cases = [
    [{ ids: ID_NORMAL, confirm: true }, 'INVALID_IDS'],
    [{ ids: [], confirm: true }, 'EMPTY_SELECTION'],
    [{ ids: ['  ', 42, ''], confirm: true }, 'EMPTY_SELECTION'],
    [{ ids: [ID_NORMAL, ID_CACHED_EMPTY, ID_LIVE], confirm: true }, 'TOO_MANY_IDS'],
    ['{not json', 'INVALID_BODY'],
    ['["session-orb-1"]', 'INVALID_BODY'],
    ['null', 'INVALID_BODY'],
  ]
  for (const [raw, code] of cases) {
    const answer = await callRoute(state, '/api/archive/delete', { method: 'POST', body: raw })
    assert.equal(answer.status, 200)
    assert.equal(answer.body.ok, false, JSON.stringify(raw))
    assert.equal(answer.body.code, code, JSON.stringify(raw))
  }
  // A POST with no body at all is the same refusal.
  const empty = await callRoute(state, '/api/archive/delete', { method: 'POST' })
  assert.equal(empty.body.code, 'INVALID_BODY')
  // None of it reached the disk, the archive set, or the channel.
  assert.deepEqual(state.unarchiveAttempts, [])
  assert.deepEqual(state.emitted, [])
  for (const path of [fixture.normal, fixture.cachedEmpty, fixture.bad, fixture.live, fixture.unknown, fixture.misplaced]) {
    assert.equal(existsSync(path), true)
  }
  assert.equal(state.ids.length, 7)
})

await check('every refusal leaves every session directory on disk', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const refused = [ID_LIVE, ID_BAD, ID_GONE, ID_MISPLACED, ID_UNKNOWN, 'session-never-seen']
  const codes = []
  for (const id of refused) {
    const { body } = await callRoute(state, '/api/archive/delete', { method: 'POST', body: { ids: [id], confirm: true } })
    assert.equal(body.ok, true, id + ' is a per-id refusal, not a batch failure')
    assert.equal(body.results[0].ok, false, id)
    codes.push(body.results[0].code)
  }
  assert.deepEqual(codes, ['LIVE_SESSION', 'NOT_A_SESSION_DIRECTORY', 'NOT_ON_DISK', 'PROJECT_MISMATCH', 'NO_HEADER', 'NOT_ARCHIVED'])
  for (const path of [fixture.normal, fixture.cachedEmpty, fixture.bad, fixture.live, fixture.unknown, fixture.misplaced]) {
    assert.equal(existsSync(path), true, path + ' survived every refusal')
  }
  assert.deepEqual(state.unarchived, [])
  assert.deepEqual(state.emitted, [])
  // A refusal in a mixed batch does not cost the neighbour its deletion either.
  const mixed = await callRoute(state, '/api/archive/delete', { method: 'POST', body: { ids: [ID_NORMAL, ID_LIVE], confirm: true } })
  assert.deepEqual(mixed.body.results.map((result) => [result.id, result.ok]), [[ID_NORMAL, true], [ID_LIVE, false]])
  assert.equal(existsSync(fixture.normal), false)
  assert.equal(existsSync(fixture.live), true)
  assert.equal(existsSync(fixture.cachedEmpty), true)
})

// ---------------------------------------------------------------------------
// 9. Broadcasts — one per deleted id, never for a refusal
// ---------------------------------------------------------------------------

await check('a removed session is broadcast once and a refused one never', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const { body } = await callRoute(state, '/api/archive/delete', {
    method: 'POST',
    body: { ids: [ID_NORMAL, ID_LIVE], confirm: true },
  })
  assert.deepEqual(body.results.map((result) => [result.id, result.ok]), [[ID_NORMAL, true], [ID_LIVE, false]])
  assert.deepEqual(state.emitted, [['api-session/removed', ID_NORMAL]])
  // A dry run deletes nothing, so it announces nothing.
  await callRoute(state, '/api/archive/delete', { method: 'POST', body: { ids: [ID_CACHED_EMPTY], dryRun: true } })
  assert.deepEqual(state.emitted, [['api-session/removed', ID_NORMAL]], 'a dry run is not a removal')
})

await check('a removal whose archive record survives says so and still broadcasts', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext({ throwingUnarchive: [ID_CACHED_EMPTY] })
  host.apply(ctx)
  const { body } = await callRoute(state, '/api/archive/delete', {
    method: 'POST',
    body: { ids: [ID_CACHED_EMPTY], confirm: true },
  })
  const [result] = body.results
  assert.equal(result.ok, false)
  assert.equal(result.code, 'UNARCHIVE_FAILED')
  assert.equal(result.deleted, true, 'the page is told the files really went')
  assert.equal(result.bytes, 64)
  assert.match(result.message, /文件已删除/)
  // The record survived, but the bytes really were freed, so the page's
  // "释放 X" must not read zero.
  assert.deepEqual(body.summary, { requested: 1, succeeded: 0, failed: 1, bytes: 64 })
  assert.equal(existsSync(fixture.cachedEmpty), false)
  // The artifacts are gone, so the session is announced; only its record remains.
  assert.deepEqual(state.emitted, [['api-session/removed', ID_CACHED_EMPTY]])
  assert.equal(body.payload.items.some((row) => row.id === ID_CACHED_EMPTY), true)
  assert.equal(rowsById(body.payload).get(ID_CACHED_EMPTY).onDisk, false)
})

// ---------------------------------------------------------------------------
// 10. lib/search.js units
// ---------------------------------------------------------------------------

await check('lib/search.js compiles a query into its terms', () => {
  assert.deepEqual(search.compileQuery('  悬浮球  插件 '), { text: '悬浮球  插件', terms: ['悬浮球', '插件'] })
  assert.deepEqual(search.compileQuery('A B').terms, ['a', 'b'])
  assert.deepEqual(search.compileQuery(''), { text: '', terms: [] })
  assert.deepEqual(search.compileQuery('   '), { text: '', terms: [] })
  assert.deepEqual(search.compileQuery(undefined), { text: '', terms: [] })
  assert.deepEqual(search.compileQuery(null), { text: '', terms: [] })
  assert.deepEqual(search.compileQuery(42), { text: '', terms: [] })
  const long = search.compileQuery('x'.repeat(900))
  assert.equal(long.text.length, search.MAX_QUERY_CHARS)
})

await check('lib/search.js matches every term, case-insensitively, across fields', () => {
  const row = {
    id: 'session-orb-1',
    title: '悬浮球插件调试',
    cwd: CWD_ORB,
    directory: '$DSH_HOME/sessions/--C-Users-dev-.dsh-dsh_orb--/session-orb-1',
    project: { title: 'dsh_orb' },
  }
  assert.equal(search.rowMatches(row, []), true, 'an empty query matches everything')
  assert.equal(search.rowMatches(row, search.compileQuery('悬浮球').terms), true)
  assert.equal(search.rowMatches(row, search.compileQuery('DSH_ORB').terms), true, 'terms are case-insensitive')
  assert.equal(search.rowMatches(row, search.compileQuery('dsh_orb 悬浮球').terms), true)
  assert.equal(search.rowMatches(row, search.compileQuery('dsh_orb 归档流程验证').terms), false, 'every term must match')
  assert.equal(search.rowMatches({ id: 'bare' }, search.compileQuery('anything').terms), false, 'a row with no text cannot match')

  assert.deepEqual(search.matchedFields(row, search.compileQuery('悬浮球').terms), ['title'])
  assert.deepEqual(search.matchedFields(row, search.compileQuery('dsh_orb').terms), ['cwd', 'directory'])
  assert.deepEqual(search.matchedFields(row, []), [])
})

await check('lib/search.js cuts a one-line snippet around the first term', () => {
  const text = 'x'.repeat(120) + '边界情况' + 'y'.repeat(120)
  const snippet = search.snippetAround(text, ['边界'])
  assert.ok(snippet.startsWith('…'))
  assert.ok(snippet.endsWith('…'))
  assert.ok(snippet.includes('边界情况'))
  assert.equal(snippet.includes('\n'), false)
  // A short text needs no ellipsis at all.
  assert.equal(search.snippetAround('短文本里的边界', ['边界']), '短文本里的边界')
  // Line breaks and runs of whitespace collapse into one line.
  assert.equal(search.snippetAround('line one\n\nline two   边界 tail', ['边界']), 'line one line two 边界 tail')
  assert.equal(search.snippetAround('nothing here', ['边界']), '')
  assert.equal(search.snippetAround('', ['边界']), '')
  assert.equal(search.snippetAround('边界', []), '')
  assert.equal(search.snippetAround(null, ['边界']), '')
})

// ---------------------------------------------------------------------------
// 11. lib/concurrency.js units
// ---------------------------------------------------------------------------

await check('lib/concurrency.js mapLimit keeps input order under a small limit', async () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  let inFlight = 0
  let peak = 0
  let visits = 0
  const order = await concurrency.mapLimit(items, 3, async (value) => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    visits += 1
    await new Promise((resolve) => setTimeout(resolve, (10 - value) * 2))
    inFlight -= 1
    return value * 2
  })
  assert.deepEqual(order, items.map((value) => value * 2), 'results come back in input order')
  assert.equal(visits, items.length)
  assert.ok(peak <= 3, 'the limit is respected, peak was ' + peak)
  assert.ok(peak >= 2, 'the waits are overlapped, not serialized')
})

await check('lib/concurrency.js mapLimit rethrows the first failure and maps nothing', async () => {
  const failure = new Error('third item exploded')
  await assert.rejects(
    concurrency.mapLimit([1, 2, 3, 4, 5], 2, async (value) => {
      if (value === 3) throw failure
      return value
    }),
    (error) => error === failure,
  )
  assert.deepEqual(await concurrency.mapLimit([], 4, async () => { throw new Error('never runs') }), [])
  assert.deepEqual(await concurrency.mapLimit([7], 0, async (value) => value), [7], 'a limit below one still runs')
})

await check('lib/concurrency.js settleLimit isolates each failure', async () => {
  const settled = await concurrency.settleLimit([1, 2, 3], 2, async (value) => {
    if (value === 2) throw new Error('two failed')
    return value * 10
  })
  assert.equal(settled.length, 3)
  assert.deepEqual(settled[0], { ok: true, value: 10 })
  assert.equal(settled[1].ok, false)
  assert.match(settled[1].error.message, /two failed/)
  assert.deepEqual(settled[2], { ok: true, value: 30 })
})

// ---------------------------------------------------------------------------
// 12. The browser bundle
// ---------------------------------------------------------------------------

/** Enough of `react` for the bundle to load; nothing here renders. */
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
}

/**
 * Load the browser bundle the way the shell's module loader does: give it a
 * global `window`, capture the entry it registers, and materialize its
 * exports against a stub `react`.
 *
 * @returns {Promise<{ id: string, exports: any, required: string[] }>}
 */
async function loadClient() {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const required = []
  let entry
  globalThis.window = {
    __ModuleLoader__: {
      load(load) {
        entry = {
          id: load.id,
          exports: load.factory((name) => {
            required.push(name)
            if (name === 'react') return reactStub
            throw new Error('unexpected require(' + name + ')')
          }),
        }
      },
    },
  }
  new Function('window', source)(globalThis.window)
  assert.ok(entry !== undefined, 'the bundle registered itself with window.__ModuleLoader__')
  return { id: entry.id, exports: entry.exports, required }
}

const client = await loadClient()

await check('the browser bundle exports apply, inject, and its pure helpers', () => {
  assert.equal(client.id, '@local/dsh-archive-manager')
  assert.deepEqual(client.required, ['react'], 'no other package is required')
  assert.equal(typeof client.exports.apply, 'function')
  assert.deepEqual(client.exports.inject, ['slots', 'locale'])
  assert.equal(typeof client.exports.__test, 'object')
  for (const name of ['formatBytes', 'compileTerms', 'rowMatchesQuery', 'filterRows', 'sortRows', 'selectRange', 'applyTitles', 'selectedBytes', 'DICT']) {
    assert.ok(name in client.exports.__test, 'the bundle exposes ' + name)
  }
})

await check('the client registers its dictionaries and one settings section', () => {
  const injected = []
  const sections = []
  const dictionaries = []
  client.exports.apply({
    get: (service) => (service === 'locale'
      ? {
        register: (ns, dictionary) => {
          dictionaries.push({ ns, dictionary })
          return () => {}
        },
        bind: () => undefined,
      }
      : undefined),
    effect: (factory) => {
      factory()
      return () => {}
    },
    slots: {
      inject: (name, register) => {
        injected.push(name)
        register()
      },
      register: (descriptor, component) => {
        sections.push({ descriptor, component })
        return () => {}
      },
    },
  })
  assert.deepEqual(injected, ['settings.section'])
  assert.equal(dictionaries.length, 1)
  assert.equal(dictionaries[0].ns, 'archiveManager')
  assert.deepEqual(Object.keys(dictionaries[0].dictionary).sort(), ['en', 'zh'])

  assert.equal(sections.length, 1)
  const { descriptor, component } = sections[0]
  assert.equal(descriptor.name, 'settings.section')
  assert.equal(descriptor.id, 'archived-sessions')
  assert.equal(descriptor.order, 100)
  assert.equal(typeof component, 'function', 'the slot receives a component')
  assert.equal(typeof descriptor.label, 'function', 'the nav label is a thunk')
  assert.equal(typeof descriptor.label(), 'string')
  assert.ok(descriptor.label().length > 0)
})

await check('the client renders byte counts the way a file manager does', () => {
  const { formatBytes } = client.exports.__test
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(-1), '0 B')
  assert.equal(formatBytes(undefined), '0 B')
  assert.equal(formatBytes(Number.NaN), '0 B')
  assert.equal(formatBytes(999), '999 B')
  assert.equal(formatBytes(1024), '1 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(10 * 1024), '10 KB')
  assert.equal(formatBytes(2 * 1024 * 1024), '2 MB')
  assert.equal(formatBytes(1.5 * 1024 ** 3), '1.5 GB')
})

await check('the client filters rows by every term and by the status chips', () => {
  const { compileTerms, rowMatchesQuery, filterRows } = client.exports.__test
  assert.deepEqual(compileTerms('  悬浮球  插件 '), ['悬浮球', '插件'])
  assert.deepEqual(compileTerms(''), [])
  assert.deepEqual(compileTerms(undefined), [])

  const rows = [
    { id: 'a', title: '悬浮球插件调试', cwd: CWD_ORB, directory: '$DSH_HOME/sessions/x/a', project: { title: 'dsh_orb' }, deletable: true, live: false, onDisk: true, sizeBytes: 10, updatedAt: 300, createdAt: 1 },
    { id: 'b', title: null, cwd: null, directory: '$DSH_HOME/sessions/x/b', project: { title: 'dsh_orb' }, deletable: false, live: true, onDisk: true, sizeBytes: 20, updatedAt: 200, createdAt: 3 },
    { id: 'c', title: '归档流程验证', cwd: CWD_NOVEL, directory: '$DSH_HOME/sessions/y/c', project: { title: '' }, deletable: false, live: false, onDisk: false, sizeBytes: 30, updatedAt: 100, createdAt: 2 },
  ]
  assert.equal(rowMatchesQuery(rows[0], ['悬浮球']), true)
  assert.equal(rowMatchesQuery(rows[1], ['悬浮球']), false)
  assert.equal(rowMatchesQuery(rows[0], ['dsh_orb', '悬浮球']), true, 'terms are ANDed')
  assert.equal(rowMatchesQuery(rows[0], ['dsh_orb', 'zzz']), false)
  assert.equal(rowMatchesQuery(rows[1], ['dsh_orb']), true, 'the project title is searched too')
  assert.equal(rowMatchesQuery(rows[2], []), true)

  assert.deepEqual(filterRows(rows, { terms: [], filter: 'deletable' }).map((row) => row.id), ['a'])
  assert.deepEqual(filterRows(rows, { terms: [], filter: 'live' }).map((row) => row.id), ['b'])
  assert.deepEqual(filterRows(rows, { terms: [], filter: 'missing' }).map((row) => row.id), ['c'])
  assert.deepEqual(filterRows(rows, { terms: [], filter: 'all' }).map((row) => row.id), ['a', 'b', 'c'])
  assert.deepEqual(filterRows(rows, { terms: compileTerms('归档'), filter: 'missing' }).map((row) => row.id), ['c'])
  assert.deepEqual(filterRows(rows, { terms: [], filter: 'all', only: new Set(['b', 'c']) }).map((row) => row.id), ['b', 'c'])

  const { sortRows } = client.exports.__test
  assert.deepEqual(sortRows(rows, 'updated').map((row) => row.id), ['a', 'b', 'c'])
  assert.deepEqual(sortRows(rows, 'created').map((row) => row.id), ['b', 'c', 'a'])
  assert.deepEqual(sortRows(rows, 'size').map((row) => row.id), ['c', 'b', 'a'])
})

await check('the client sorts by title with the untitled rows last', () => {
  const { sortRows } = client.exports.__test
  const rows = [
    { id: 'untitled', title: null },
    { id: 'gamma', title: 'Gamma' },
    { id: 'alpha', title: 'Alpha' },
    { id: 'blank', title: '' },
    { id: 'beta', title: 'beta' },
  ]
  assert.deepEqual(sortRows(rows, 'title').map((row) => row.id), ['alpha', 'beta', 'gamma', 'untitled', 'blank'])
  // Sorting never mutates the input.
  assert.deepEqual(rows.map((row) => row.id), ['untitled', 'gamma', 'alpha', 'blank', 'beta'])
})

await check('the client applies a range selection, title patches and a byte total', () => {
  const { selectRange, applyTitles, selectedBytes } = client.exports.__test
  const ordered = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  assert.deepEqual([...selectRange(ordered, new Set(), 'b', 'd')], ['b', 'c', 'd'], 'a forward range')
  assert.deepEqual([...selectRange(ordered, new Set(), 'd', 'b')], ['b', 'c', 'd'], 'a backward range')
  assert.deepEqual([...selectRange(ordered, new Set(['a']), 'b', 'c')], ['a', 'b', 'c'], 'an existing selection is kept')
  assert.deepEqual([...selectRange(ordered, new Set(), 'ghost', 'c')], ['c'], 'an unknown anchor falls back to the click')

  const payload = {
    ok: true,
    items: [
      { id: 'a', title: null, titleSource: 'none', sizeBytes: 10 },
      { id: 'b', title: '旧标题', titleSource: 'cache', sizeBytes: 30 },
    ],
  }
  const patched = applyTitles(payload, { a: '新标题', ghost: '不存在' })
  assert.equal(patched.items[0].title, '新标题')
  assert.equal(patched.items[0].titleSource, 'memo')
  assert.equal(patched.items[0].sizeBytes, 10, 'a patch keeps the rest of the row')
  assert.equal(patched.items[1], payload.items[1], 'an id the patch does not know is left alone')
  assert.equal(patched.ok, true)
  assert.equal(applyTitles(payload, {}), payload, 'a patch that changes nothing keeps the payload')
  assert.equal(applyTitles(null, { a: 'x' }), null)
  const emptied = applyTitles(payload, { a: null })
  assert.equal(emptied.items[0].title, null)
  assert.equal(emptied.items[0].titleSource, 'memo', 'a folded-empty title is still a memo')

  assert.equal(selectedBytes(payload.items, new Set(['a', 'b'])), 40)
  assert.equal(selectedBytes(payload.items, new Set()), 0)
  assert.equal(selectedBytes(payload.items, new Set(['ghost'])), 0)
})

await check('both dictionaries carry the same keys', () => {
  const { DICT } = client.exports.__test
  assert.deepEqual(Object.keys(DICT.zh).sort(), Object.keys(DICT.en).sort())
  for (const key of ['nav', 'heading', 'confirmTitle', 'confirmBody', 'removeMany', 'restoreMany']) {
    assert.ok(key in DICT.zh && key in DICT.en, key)
  }
  assert.equal(DICT.zh.nav, '归档会话')
  assert.equal(DICT.en.nav, 'Archived sessions')
})

// ---------------------------------------------------------------------------

await rm(HOME, { recursive: true, force: true })

// ---------------------------------------------------------------------------

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length} checks, ${failed.length} failed`)
if (failed.length > 0) {
  for (const result of failed) console.log(`  FAIL ${result.label}: ${result.error?.message ?? result.error}`)
  process.exitCode = 1
}
