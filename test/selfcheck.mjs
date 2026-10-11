#!/usr/bin/env node
/**
 * Self-check for `@local/dsh-archive-manager`.
 *
 * Run with `node test/selfcheck.mjs` (or `npm test`) from this package. No
 * network, no Harness, no React: the Host half is driven through a stub context
 * and a throwaway `$DSH_HOME`, and the browser half is driven through a stub
 * `window.__ModuleLoader__`.
 *
 * The destructive path is the reason this file exists. Permanent deletion is not
 * a Harness API — this plugin removes session directories itself — so every
 * guard that stands between a click and `rm -r` is exercised against real
 * directories here: the archive-set gate, the liveness gate, the encoded-name
 * equality, root containment, and the log-file presence check. A refusal must
 * leave the directory untouched.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-archive-manager-'))

const host = await import('../index.js')
const layout = await import('../lib/layout.js')

/** Results of every check, printed at the end. */
const results = []

/**
 * Run one named check.
 *
 * @param {string} label
 * @param {() => any | Promise<any>} body
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
// Fixtures
// ---------------------------------------------------------------------------

/** A Windows project path with only ASCII-safe characters. */
const CWD_ORB = 'C:\\Users\\dev\\.dsh\\dsh_orb'
/** A Windows project path with characters the layout must escape. */
const CWD_NOVEL = 'D:\\AI\\小说示例'

const HOME = process.env.DSH_HOME
const ROOT = join(HOME, 'sessions')

/** Paths the current fixture set wrote; refreshed by {@link resetFixtures}. */
const fixture = { orb: '', bad: '', live: '', cache: '' }

/** Write one session's log directory under the derived project directory. */
async function writeSession(id, cwd, { log = true, extra } = {}) {
  const directory = layout.sessionDirectory(ROOT, { id, cwd })
  await mkdir(directory, { recursive: true })
  if (log) await writeFile(join(directory, 'session.v4.jsonl.zstd'), 'x'.repeat(64))
  if (extra !== undefined) await writeFile(join(directory, extra), 'not a session log')
  return directory
}

/** Write one projection-cache entry. */
async function writeCache(id) {
  const file = layout.projectionCacheFile(HOME, id)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, '{"version":7}')
  return file
}

/**
 * Rebuild the whole fixture tree.
 *
 * Each host check starts from this, because the destructive checks are supposed
 * to consume the tree: an assertion that nothing was deleted is only meaningful
 * when the thing that *should* have been deleted is still there to begin with.
 */
async function resetFixtures() {
  await rm(ROOT, { recursive: true, force: true })
  await rm(join(HOME, 'storages'), { recursive: true, force: true })
  fixture.orb = await writeSession('session-orb-1', CWD_ORB)
  await writeSession('session-orb-2', CWD_ORB)
  fixture.bad = await writeSession('session-bad-1', CWD_ORB, { log: false, extra: 'notes.txt' })
  fixture.live = await writeSession('session-live-1', CWD_ORB)
  fixture.cache = await writeCache('session-orb-1')
}

await resetFixtures()

/** The archive set and the persistence headers the fake Host answers with. */
const archived = () => [
  'session-orb-1',
  'session-orb-2',
  'session-bad-1',
  'session-live-1',
  'session-gone-1',
  'session-unknown-1',
]

const headers = [
  { header: { id: 'session-orb-1', cwd: CWD_ORB, createdAt: 1_700_000_000_000 }, sizeBytes: 64, revision: 'r1' },
  { header: { id: 'session-orb-2', cwd: CWD_ORB, createdAt: 1_700_000_100_000 }, sizeBytes: 64, revision: 'r2' },
  { header: { id: 'session-bad-1', cwd: CWD_ORB, createdAt: 1_700_000_200_000 }, sizeBytes: 0, revision: 'r3' },
  { header: { id: 'session-live-1', cwd: CWD_ORB, createdAt: 1_700_000_300_000 }, sizeBytes: 64, revision: 'r4' },
  { header: { id: 'session-gone-1', cwd: CWD_ORB, createdAt: 1_700_000_400_000 }, sizeBytes: 0, revision: 'r5' },
]

const workspaces = [
  { id: 'ws-orb', path: CWD_ORB, title: 'dsh_orb', sessionIds: ['session-orb-1', 'session-orb-2', 'session-live-1'] },
]

const titles = new Map([
  ['session-orb-1', '悬浮球插件调试'],
  ['session-orb-2', '归档流程验证'],
])

/** The one id whose title read fails, to prove failures stay per-session. */
const TITLE_REJECTED_ID = 'session-gone-1'

/**
 * A stub plugin context exposing exactly the services this plugin consumes.
 *
 * @param {{ live?: string[] }} [options]
 */
function fakeContext(options = {}) {
  const live = new Set(options.live ?? ['session-live-1'])
  const state = {
    ids: archived(),
    routes: [],
    emitted: [],
    unarchived: [],
    registered: [],
  }
  const registry = {
    get archivedSessionIds() {
      return [...state.ids]
    },
    async unarchiveSession(id) {
      state.unarchived.push(id)
      state.ids = state.ids.filter((candidate) => candidate !== id)
    },
    list: () => workspaces,
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
      if (service === 'workspaceRegistry') return registry
      if (service === 'sessionPersistence') return { list: async () => headers }
      if (service === 'sessions') {
        return {
          list: () => [...live].map((id) => ({ header: { id, cwd: CWD_ORB, createdAt: 1 } })),
          get: (id) => (live.has(id) ? { header: { id, cwd: CWD_ORB, createdAt: 1 } } : undefined),
        }
      }
      if (service === 'sessionQuery') {
        return {
          /**
           * Mirrors the shipped service: `projectMany` de-duplicates ids and
           * keeps first-occurrence order, each result is a fulfilled/rejected
           * envelope, and the folded title is a snapshot object rather than a
           * string (its own `title` field is `null` when the log folded to
           * nothing, and the field is absent when no title event exists).
           */
          readTitleSnapshots: async (ids) =>
            [...new Set(ids)].map((id) => {
              if (id === TITLE_REJECTED_ID) return { sessionId: id, status: 'rejected', reason: new Error('no such session') }
              const text = titles.get(id)
              return {
                sessionId: id,
                status: 'fulfilled',
                value: text === undefined
                  ? { session: { id } }
                  : {
                    session: { id },
                    title: { title: text, messageSeqs: [1, 2], source: { kind: 'user' }, eventSeq: 7, updatedAt: 1_700_000_000_000 },
                  },
              }
            }),
        }
      }
      return undefined
    },
    effect(factory) {
      factory()
      return () => {}
    },
    emit(...args) {
      state.emitted.push(args)
    },
  }
  return { ctx, state }
}

/** Call one registered route the way the connection channel would. */
async function callRoute(state, path, { method = 'GET', body } = {}) {
  const route = state.registered.find((candidate) => candidate.path === path)
  assert.ok(route !== undefined, `no route registered for ${path}`)
  const request = new Request(`http://127.0.0.1${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const response = await route.fetch(request)
  return { status: response.status, payload: await response.json() }
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
  assert.throws(() => layout.encodeSegment(''))
})

await check('projectKey reproduces real on-disk project directories', () => {
  // The escaping rules were checked against this machine's own ~/.dsh/sessions
  // tree during development; the project paths here are genericised examples.
  assert.equal(layout.projectKey(CWD_ORB), '--C-Users-dev-.dsh-dsh_orb--')
  assert.equal(layout.projectKey(CWD_NOVEL), '--D-AI-~5C0F~8BF4~793A~4F8B--')
  assert.equal(layout.projectKey('D:\\AI\\my notes 笔记'), '--D-AI-my~0020notes~0020~7B14~8BB0--')
  assert.equal(layout.projectKey('/'), '--root--')
  assert.throws(() => layout.projectKey(''))
})

await check('sessionDirectory joins root, project key, and encoded id', () => {
  assert.equal(
    layout.sessionDirectory(ROOT, { id: 'session-orb-1', cwd: CWD_ORB }),
    join(ROOT, '--C-Users-dev-.dsh-dsh_orb--', 'session-orb-1'),
  )
})

await check('assertDeletableDirectory refuses anything it cannot prove', () => {
  const header = { id: 'session-orb-1', cwd: CWD_ORB }
  const inside = layout.sessionDirectory(ROOT, header)
  assert.equal(layout.assertDeletableDirectory(ROOT, inside, header, ['session.v4.jsonl.zstd']).ok, true)
  // A directory whose last segment is not this id's encoded segment.
  assert.equal(layout.assertDeletableDirectory(ROOT, inside, { id: 'session-other', cwd: CWD_ORB }, ['session.v4.jsonl.zstd']).reason, 'ID_MISMATCH')
  // A directory under a project key this session's cwd does not derive.
  assert.equal(layout.assertDeletableDirectory(ROOT, inside, { id: 'session-orb-1', cwd: CWD_NOVEL }, ['session.v4.jsonl.zstd']).reason, 'PROJECT_MISMATCH')
  // A directory holding no session log.
  assert.equal(layout.assertDeletableDirectory(ROOT, fixture.bad, { id: 'session-bad-1', cwd: CWD_ORB }, ['notes.txt']).reason, 'NOT_A_SESSION_DIRECTORY')
  // The root itself, a project layer, and a sibling tree.
  assert.equal(layout.assertDeletableDirectory(ROOT, ROOT, header, []).reason, 'OUTSIDE_ROOT')
  assert.equal(layout.assertDeletableDirectory(ROOT, join(ROOT, '..', 'storages'), header, []).reason, 'OUTSIDE_ROOT')
  assert.equal(
    layout.assertDeletableDirectory(ROOT, join(ROOT, '--C-Users-dev-.dsh-dsh_orb--'), header, []).reason,
    'MISPLACED',
  )
})

// ---------------------------------------------------------------------------
// 2. Host routes
// ---------------------------------------------------------------------------

await check('apply registers three effect-owned routes on the connection channel', () => {
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  assert.equal(host.name, 'dsh-archive-manager')
  assert.deepEqual(host.inject, ['connection'])
  assert.deepEqual(
    state.registered.map((route) => [route.path, [...route.methods].join(',')]),
    [
      ['/api/archive/sessions', 'GET'],
      ['/api/archive/restore', 'POST'],
      ['/api/archive/delete', 'POST'],
    ],
  )
  for (const route of state.registered) {
    assert.equal(route.requestBody, 'buffered')
    assert.equal(typeof route.fetch, 'function')
  }
})

await check('the list route describes every archived session', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const { status, payload } = await callRoute(state, '/api/archive/sessions')
  assert.equal(status, 200)
  assert.equal(payload.ok, true)
  assert.equal(payload.home, '$DSH_HOME')
  assert.equal(payload.sessionsRoot, '$DSH_HOME/sessions')
  assert.equal(payload.items.length, 6)
  assert.deepEqual(payload.totals, { archived: 6, onDisk: 4, live: 1, bytes: 192, deletable: 4 })

  const byId = new Map(payload.items.map((item) => [item.id, item]))
  const orb = byId.get('session-orb-1')
  // The title arrives as a folded snapshot object from the shipped service and
  // must be unwrapped; a snapshot whose own title folded to nothing stays null.
  assert.equal(orb.title, '悬浮球插件调试')
  assert.equal(orb.workspace.title, 'dsh_orb')
  assert.equal(orb.onDisk, true)
  assert.equal(orb.deletable, true)
  assert.equal(orb.deleteBlockedBy, null)
  assert.equal(orb.sizeBytes, 64)
  assert.equal(orb.directory, '$DSH_HOME/sessions/--C-Users-dev-.dsh-dsh_orb--/session-orb-1')
  assert.ok(orb.updatedAt > 0)
  assert.equal(byId.get('session-orb-2').title, '归档流程验证')
  // A session whose title read failed is still listed, just without a title.
  assert.equal(byId.get('session-gone-1').title, null)
  assert.equal(byId.get('session-bad-1').title, null)

  // The three sessions that must not be deletable, each for its own reason.
  assert.equal(byId.get('session-live-1').deleteBlockedBy.code, 'SESSION_LIVE')
  assert.equal(byId.get('session-bad-1').deleteBlockedBy.code, 'NOT_A_SESSION_DIRECTORY')
  const gone = byId.get('session-gone-1')
  assert.equal(gone.onDisk, false)
  assert.equal(gone.deletable, true, 'a session whose artifacts are gone can still be dropped from the archive list')
  assert.equal(byId.get('session-unknown-1').deletable, true)
  // Ordered newest write first. A session with no log left falls back to its
  // header's creation time, and one with no header at all sorts last.
  assert.equal(payload.items[0].onDisk, true)
  assert.deepEqual(
    payload.items.slice(-3).map((item) => item.id),
    ['session-gone-1', 'session-bad-1', 'session-unknown-1'],
  )
})

await check('permanent deletion removes the log directory, the cache entry, and the archive entry', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const { payload } = await callRoute(state, '/api/archive/delete', { method: 'POST', body: { id: 'session-orb-1' } })
  assert.equal(payload.ok, true)
  assert.equal(existsSync(fixture.orb), false, 'the session directory is gone')
  assert.equal(existsSync(fixture.cache), false, 'the projection-cache entry is gone')
  assert.deepEqual(state.unarchived, ['session-orb-1'])
  assert.deepEqual(payload.removed, [
    '$DSH_HOME/sessions/--C-Users-dev-.dsh-dsh_orb--/session-orb-1',
    '$DSH_HOME/storages/session_projcache/sessions/session-orb-1.json',
  ])
  assert.equal(payload.snapshot.items.some((item) => item.id === 'session-orb-1'), false)
  // A second pass over the same id is refused: it is no longer archived.
  const again = await callRoute(state, '/api/archive/delete', { method: 'POST', body: { id: 'session-orb-1' } })
  assert.equal(again.payload.ok, false)
  assert.equal(again.payload.code, 'NOT_ARCHIVED')
})

await check('deletion refuses a live session and leaves its log alone', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const { payload } = await callRoute(state, '/api/archive/delete', { method: 'POST', body: { id: 'session-live-1' } })
  assert.equal(payload.ok, false)
  assert.equal(payload.code, 'SESSION_LIVE')
  assert.equal(existsSync(fixture.live), true)
  assert.deepEqual(state.unarchived, [])
})

await check('deletion refuses a directory it cannot prove belongs to the session', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const { payload } = await callRoute(state, '/api/archive/delete', { method: 'POST', body: { id: 'session-bad-1' } })
  assert.equal(payload.ok, false)
  assert.equal(payload.code, 'NOT_A_SESSION_DIRECTORY')
  assert.equal(existsSync(fixture.bad), true, 'the unexplained directory is untouched')
  assert.equal(existsSync(join(fixture.bad, 'notes.txt')), true)
  assert.deepEqual(state.unarchived, [])
})

await check('deletion refuses an id that is not archived at all', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const { payload } = await callRoute(state, '/api/archive/delete', { method: 'POST', body: { id: 'session-orb-2' } })
  assert.equal(payload.ok, true)
  const second = await callRoute(state, '/api/archive/delete', { method: 'POST', body: { id: 'session-never-seen' } })
  assert.equal(second.payload.ok, false)
  assert.equal(second.payload.code, 'NOT_ARCHIVED')
  // The id that was never archived is still not in the archive set afterwards.
  assert.equal(state.ids.includes('session-never-seen'), false)
})

await check('cleanup of a session with no artifacts still drops the archive entry', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const { payload } = await callRoute(state, '/api/archive/delete', { method: 'POST', body: { id: 'session-gone-1' } })
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.removed, [])
  assert.ok(payload.notes.some((note) => note.includes('磁盘上已没有')), payload.notes.join(' | '))
  assert.deepEqual(state.unarchived, ['session-gone-1'])
})

await check('restore drops the id from the archive set and reports the new list', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const { payload } = await callRoute(state, '/api/archive/restore', { method: 'POST', body: { id: 'session-orb-1' } })
  assert.equal(payload.ok, true)
  assert.equal(payload.restored, true)
  assert.deepEqual(state.unarchived, ['session-orb-1'])
  assert.equal(existsSync(fixture.orb), true, 'restoring never touches the log')
  assert.equal(payload.snapshot.items.some((item) => item.id === 'session-orb-1'), false)
  const again = await callRoute(state, '/api/archive/restore', { method: 'POST', body: { id: 'session-orb-1' } })
  assert.equal(again.payload.code, 'NOT_ARCHIVED')
})

await check('write routes reject a malformed body without touching anything', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  for (const id of [undefined, '', '   ', 42, null, { nested: 'session-orb-1' }]) {
    const { payload } = await callRoute(state, '/api/archive/delete', { method: 'POST', body: { id } })
    assert.equal(payload.ok, false)
    assert.equal(payload.code, 'BAD_REQUEST')
    // `{ id: undefined }` stringifies to `{}`, which is exactly what the shipped
    // client sent and what the user saw as 缺少会话 id。
    assert.equal(payload.message, '缺少会话 id。')
  }
  const route = state.registered.find((candidate) => candidate.path === '/api/archive/delete')
  const broken = await route.fetch(new Request('http://127.0.0.1/api/archive/delete', { method: 'POST', body: '{not json' }))
  assert.equal((await broken.json()).code, 'BAD_REQUEST')
  assert.equal(existsSync(fixture.orb), true)
  assert.deepEqual(state.unarchived, [])
})

await check('a POST shaped like the connection bridge keeps its id', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  host.apply(ctx)
  const route = state.registered.find((candidate) => candidate.path === '/api/archive/restore')
  // dsh-client-connection's bridge() reads the body bytes and hands the route a
  // Request built from that Buffer, with the client's own content-type header.
  const request = new Request('http://127.0.0.1/api/archive/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: Buffer.from(JSON.stringify({ id: 'session-orb-1' })),
  })
  const payload = await (await route.fetch(request)).json()
  assert.equal(payload.ok, true, payload.message)
  assert.deepEqual(state.unarchived, ['session-orb-1'])
  assert.equal(existsSync(fixture.orb), true)
})

await check('a composition without the registry answers a readable refusal', async () => {
  await resetFixtures()
  const { ctx, state } = fakeContext()
  const withoutRegistry = { ...ctx, get: (service) => (service === 'workspaceRegistry' ? undefined : ctx.get(service)) }
  host.apply(withoutRegistry)
  const list = await callRoute(state, '/api/archive/sessions')
  assert.equal(list.payload.ok, false)
  assert.equal(list.payload.code, 'NO_REGISTRY')
  const del = await callRoute(state, '/api/archive/delete', { method: 'POST', body: { id: 'session-orb-1' } })
  assert.equal(del.payload.code, 'NO_REGISTRY')
  assert.equal(existsSync(fixture.orb), true)
})

// ---------------------------------------------------------------------------
// 3. Browser half
// ---------------------------------------------------------------------------

await check('the client bundle registers its locale dictionaries and one settings section', async () => {
  const dictionaries = new Map()
  const sections = []
  const styles = []
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: (tag) => styles.push(tag) },
  }
  globalThis.window = {
    __ModuleLoader__: {
      load(entry) {
        globalThis.window.__loaded = entry
      },
    },
  }
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  // The bundle is a plain script: evaluate it the way the loader would.
  new Function('window', 'document', source)(globalThis.window, globalThis.document)
  const entry = globalThis.window.__loaded
  assert.equal(entry.id, '@local/dsh-archive-manager')
  const module = entry.factory((request) => {
    if (request === 'react') {
      return { createElement: (type, props, ...children) => ({ type, props, children }), useCallback: (fn) => fn, useEffect: () => {}, useMemo: (fn) => fn(), useState: (value) => [value, () => {}] }
    }
    throw new Error(`unexpected require(${request})`)
  })
  assert.equal(typeof module.apply, 'function')
  assert.deepEqual(module.inject, ['slots'])

  module.apply({
    get: (service) => (service === 'locale' ? { register: (ns, lang, dict) => {
      dictionaries.set(`${ns}:${lang}`, dict)
      return () => {}
    }, bind: (ns) => (key) => dictionaries.get(`${ns}:zh`)?.[key] ?? key } : undefined),
    effect: (factory) => factory(),
    slots: {
      inject: (name, register) => {
        assert.equal(name, 'settings.section')
        register()
      },
      register: (descriptor, component) => {
        sections.push({ descriptor, component })
        return () => {}
      },
    },
  })

  assert.deepEqual([...dictionaries.keys()], ['archiveManager:zh', 'archiveManager:en'])
  assert.deepEqual(
    Object.keys(dictionaries.get('archiveManager:zh')).sort(),
    Object.keys(dictionaries.get('archiveManager:en')).sort(),
    'both dictionaries carry the same keys',
  )
  assert.equal(sections.length, 1)
  assert.equal(sections[0].descriptor.id, 'archive-manager')
  assert.equal(sections[0].descriptor.order, 100)
  assert.equal(typeof sections[0].component, 'function')
  const label = sections[0].descriptor.label()
  assert.equal(label.type, 'span')
  assert.equal(label.props.className, 'dsam-navItem')
  assert.equal(styles.length, 1, 'the plugin stylesheet is installed once')
  assert.match(styles[0].textContent, /\.dsam-root/)
  assert.match(styles[0].textContent, /--dsw-alias-label-primary/)
})

await check('the client bundle never reaches for another package', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const requires = [...source.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((match) => match[2])
  assert.deepEqual([...new Set(requires)], ['react'])
  assert.doesNotMatch(source, /https?:\/\/(?!127\.0\.0\.1)/, 'no remote module or CDN reference')
})

// ---------------------------------------------------------------------------
// 4. Browser half, driven: the buttons a user actually presses
// ---------------------------------------------------------------------------

/**
 * A minimal hook runtime, enough to drive the one component this bundle
 * registers: state slots, dependency-aware `useEffect`/`useMemo`/`useCallback`,
 * and a render loop that re-renders while state keeps changing.
 *
 * @returns {any}
 */
function hookRuntime() {
  const slots = []
  let cursor = 0
  let dirty = false
  let pending = []
  const sameDeps = (left, right) =>
    Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  return {
    reset() {
      cursor = 0
      pending = []
    },
    /** Whether the previous render's state setters were ever called. */
    takeDirty() {
      const value = dirty
      dirty = false
      return value
    },
    /** The effects queued by the render that just finished. */
    takeEffects() {
      const effects = pending
      pending = []
      return effects
    },
    hooks: {
      createElement: (type, props, ...children) => ({ type, props, children }),
      useState: (initial) => {
        const index = cursor++
        if (!(index in slots)) slots[index] = initial
        return [
          slots[index],
          (next) => {
            const value = typeof next === 'function' ? next(slots[index]) : next
            if (!Object.is(value, slots[index])) {
              slots[index] = value
              dirty = true
            }
          },
        ]
      },
      useMemo: (compute, deps) => {
        const index = cursor++
        const previous = slots[index]
        if (previous === undefined || !sameDeps(previous.deps, deps)) slots[index] = { deps, value: compute() }
        return slots[index].value
      },
      useCallback: (fn, deps) => {
        const index = cursor++
        const previous = slots[index]
        if (previous === undefined || !sameDeps(previous.deps, deps)) slots[index] = { deps, value: fn }
        return slots[index].value
      },
      useEffect: (effect, deps) => {
        const index = cursor++
        const previous = slots[index]
        if (previous === undefined || !sameDeps(previous.deps, deps)) {
          slots[index] = { deps }
          pending.push(effect)
        }
      },
    },
  }
}

/** Every node in a rendered tree, depth first. */
function walk(node, visit) {
  if (node === null || node === undefined || node === false || typeof node === 'string' || typeof node === 'number') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

/** The text one subtree renders, flattened. */
function textOf(node) {
  let text = ''
  walk(node, (visit) => {
    for (const child of visit.children ?? []) {
      if (typeof child === 'string' || typeof child === 'number') text += child
    }
  })
  return text
}

/**
 * Mount the section this bundle registers against a stubbed Host, and drive it
 * the way the settings shell does: render, run queued effects, settle pending
 * work, and re-render until two consecutive passes change nothing.
 *
 * @param {any} deps
 * @returns {Promise<any>}
 */
async function mountSection(deps) {
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  const calls = []
  const timers = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init })
    return deps.respond(url, init)
  }
  globalThis.setTimeout = (fn, delay) => {
    timers.push({ fn, delay })
    return timers.length
  }
  globalThis.clearTimeout = () => {}
  const unmount = () => {
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout
  }

  const runtime = hookRuntime()
  const dictionaries = new Map()
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: () => {} },
  }
  globalThis.window = { __ModuleLoader__: { load: (entry) => { globalThis.window.__loaded = entry } } }
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  new Function('window', 'document', source)(globalThis.window, globalThis.document)
  const module = globalThis.window.__loaded.factory((request) => {
    if (request === 'react') return runtime.hooks
    throw new Error(`unexpected require(${request})`)
  })
  let component
  module.apply({
    get: (service) => (service === 'locale'
      ? { register: (ns, lang, dict) => { dictionaries.set(`${ns}:${lang}`, dict); return () => {} },
          bind: (ns) => (key) => dictionaries.get(`${ns}:zh`)?.[key] ?? key }
      : undefined),
    effect: (factory) => factory(),
    slots: {
      inject: (name, register) => register(),
      register: (descriptor, registered) => { component = registered; return () => {} },
    },
  })
  assert.equal(typeof component, 'function')

  /** Drain microtasks and pending callbacks. */
  const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0))

  const render = async () => {
    let tree = null
    let calm = 0
    for (let pass = 0; pass < 20; pass += 1) {
      runtime.reset()
      tree = component()
      const effects = runtime.takeEffects()
      if (effects.length === 0 && !runtime.takeDirty()) {
        calm += 1
        if (calm >= 2) break
      } else calm = 0
      for (const effect of effects) await effect()
      await settle()
    }
    return tree
  }

  return { render, calls, timers, unmount }
}

/** The node that renders `className`, when a test wants that exact element. */
function elementsWithClass(tree, className) {
  const found = []
  walk(tree, (element) => {
    if (element.props?.className === className) found.push(element)
  })
  return found
}

/** The button a user presses, identified by its tooltip. */
function buttonWithTitle(tree, title) {
  let found = null
  walk(tree, (element) => {
    if (element.type === 'button' && element.props?.title === title) found = element
  })
  return found
}

/** One archived row as the Host's list route renders it. */
function rowPayload(id, title) {
  return {
    id,
    title,
    cwd: CWD_ORB,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    sizeBytes: 64,
    live: false,
    persisted: true,
    onDisk: true,
    directory: `$DSH_HOME/sessions/--C-Users-dev-.dsh-dsh_orb--/${id}`,
    files: [],
    workspace: { id: 'ws-orb', path: CWD_ORB, title: 'dsh_orb' },
    deletable: true,
    deleteBlockedBy: null,
  }
}

await check('pressing 复原回工作区 posts the id of the row it belongs to', async () => {
  const lists = [
    {
      ok: true,
      generatedAt: 1_700_000_000_000,
      sessionsRoot: '/sessions',
      totals: { archived: 2, deletable: 2, live: 0, bytes: 128, onDisk: 2 },
      items: [
        rowPayload('session-orb-1', '悬浮球插件调试'),
        rowPayload('session-orb-2', null),
      ],
    },
    {
      ok: true,
      generatedAt: 1_700_000_001_000,
      sessionsRoot: '/sessions',
      totals: { archived: 1, deletable: 1, live: 0, bytes: 64, onDisk: 1 },
      items: [rowPayload('session-orb-2', null)],
    },
  ]
  let served = 0
  const mounted = await mountSection({
    respond: async (url, init) => {
      if (init.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ ok: true, removed: [], notes: [], snapshot: lists[1] }) }
      }
      const body = lists[Math.min(served, lists.length - 1)]
      served += 1
      return { ok: true, status: 200, json: async () => body }
    },
  })
  try {
    const first = await mounted.render()
    assert.equal(mounted.calls.length, 1, 'the section loads its list once')
    assert.equal(mounted.calls[0].url, '/api/archive/sessions')
    assert.equal(mounted.calls[0].init.credentials, 'include')
    const rows = elementsWithClass(first, 'dsam-row')
    assert.equal(rows.length, 2, 'both archived sessions are rendered as rows')
    assert.match(textOf(rows[0]), /悬浮球插件调试/)

    const restore = buttonWithTitle(rows[0], '复原')
    assert.ok(restore !== null, 'the row carries a restore button')
    restore.props.onClick()
    const posted = mounted.calls.find((call) => call.init.method === 'POST')
    await mounted.render()
    assert.ok(posted !== undefined, 'restoring posts to the Host')
    assert.equal(posted.url, '/api/archive/restore')
    assert.equal(posted.init.credentials, 'include')
    assert.equal(posted.init.headers['content-type'], 'application/json')
    assert.deepEqual(JSON.parse(posted.init.body), { id: 'session-orb-1' }, 'the body carries the id of the row that was pressed')
    assert.equal(mounted.timers.length, 1, 'the notice schedules its own dismissal')
    assert.equal(mounted.timers[0].delay, 12_000)

    // The fresh snapshot replaces the list, and the notice names the row.
    const after = await mounted.render()
    assert.equal(elementsWithClass(after, 'dsam-row').length, 1, 'the restored row is gone')
    assert.equal(textOf(after).includes('已复原回工作区：悬浮球插件调试'), true, textOf(after).slice(0, 300))
  } finally {
    mounted.unmount()
  }
})

await check('a row without a usable id reports locally instead of posting an empty id', async () => {
  const orphan = rowPayload('session-orphan', '孤儿行')
  delete orphan.id
  const mounted = await mountSection({
    respond: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        generatedAt: 1,
        sessionsRoot: '/sessions',
        totals: { archived: 1, deletable: 1, live: 0, bytes: 64, onDisk: 1 },
        // A payload whose row lost its id would otherwise post  and come
        // back as the Host's "缺少会话 id。".
        items: [orphan],
      }),
    }),
  })
  try {
    const tree = await mounted.render()
    const restore = buttonWithTitle(tree, '复原')
    assert.ok(restore !== null, 'the row still offers a restore button')
    restore.props.onClick()
    const after = await mounted.render()
    assert.equal(mounted.calls.filter((call) => call.init?.method === 'POST').length, 0, 'nothing is posted for an unusable target')
    assert.equal(textOf(after).includes('这一行没有可用的会话 id，请刷新后重试。'), true, textOf(after).slice(0, 300))
    assert.equal(textOf(after).includes('缺少会话 id'), false, 'the Host error text never reaches the user')
  } finally {
    mounted.unmount()
  }
})

// ---------------------------------------------------------------------------

await rm(HOME, { recursive: true, force: true })

// ---------------------------------------------------------------------------

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) {
  for (const result of failed) console.log(`  FAIL ${result.label}: ${result.error?.message ?? result.error}`)
  process.exitCode = 1
}
