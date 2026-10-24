/**
 * 归档会话管理 (Archive Manager) — session-storage layout.
 *
 * The Host's persistence seam (`ctx.sessionPersistence`) deliberately exposes no
 * file paths: a snapshot carries the header, not the artifact it came from. So a
 * cleanup that must address one session directory on disk has to derive that
 * path, and the only honest way to do it is to port the shipped JSONL backend's
 * own layout rules — `<root>/--<projectKey(cwd)>--/<encodeSegment(id)>/`.
 *
 * Everything here is pure and side-effect free, so `test/selfcheck.mjs` can hold
 * it against the real on-disk names this machine already has. The two escape
 * rules are load-bearing, not cosmetic: `encodeSegment` is what makes an
 * arbitrary session id safe as one path segment (no separators, no `..`), and
 * `projectKey` is what turns a Windows cwd such as
 * `C:\Users\dev\.dsh\dsh_orb` into `--C-Users-dev-.dsh-dsh_orb--`.
 *
 * @module @local/dsh-archive-manager/layout
 */

import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

/** Home directory name the harness owns (mirrors `dsh-home-paths`). */
export const DSH_HOME_DIR_NAME = '.dsh'

/** Environment variable that overrides the harness home. */
export const DSH_HOME_ENV = 'DSH_HOME'

/** Directory under the harness home that holds every project's session logs. */
export const SESSIONS_DIR_NAME = 'sessions'

/** Project directory used for sessions that carry no cwd. */
export const NO_CWD_DIR_NAME = '_no-cwd'

/**
 * Expand a leading `~` the way the harness does, leaving every other form alone.
 *
 * @param raw - a possibly tilde-prefixed path.
 * @param home - the user's home directory.
 * @returns the expanded path.
 */
function expandHomePath(raw, home) {
  if (raw === '~') return home
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return join(home, raw.slice(2))
  return raw
}

/**
 * Resolve the single-root harness home.
 *
 * Precedence, highest first: `$DSH_HOME`, then `~/.dsh`. An empty or
 * whitespace-only override counts as unset, so a blank value never resolves the
 * home to the current working directory.
 *
 * @param env - environment mapping read for `$DSH_HOME`.
 * @param home - the user's home directory.
 * @returns the normalized absolute harness home path.
 */
export function resolveDshHome(env = process.env, home = homedir()) {
  const fromEnv = env?.[DSH_HOME_ENV]
  const chosen = typeof fromEnv === 'string' && fromEnv.trim().length > 0
    ? fromEnv
    : join(home, DSH_HOME_DIR_NAME)
  return resolve(expandHomePath(chosen, home))
}

/**
 * The session root the JSONL backend is configured with by default.
 *
 * @param dshHome - a resolved harness home.
 * @returns `<home>/sessions`.
 */
export function sessionsRoot(dshHome) {
  return join(dshHome, SESSIONS_DIR_NAME)
}

/**
 * Encode an arbitrary string as one safe path segment.
 *
 * Ported verbatim from the JSONL backend's `encodeSegment`: safe code units stay
 * literal, everything else (including `~`, separators, and `.`/`..` as a whole
 * segment) becomes `~XXXX`. The encoding is injective over all JS strings, which
 * is what makes "does this directory belong to this session id?" a decidable
 * equality check rather than a guess.
 *
 * @param raw - the string to encode; must be non-empty.
 * @returns the escaped single path segment.
 */
export function encodeSegment(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('cannot encode an empty path segment')
  }
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/**
 * Build the readable project directory key for one cwd.
 *
 * Ported verbatim from the JSONL backend's `projectKey`: separators and drive
 * separators collapse into `-`, unsafe code units take the same `~XXXX` escape
 * as session ids, and the result is bounded for filesystem component limits.
 *
 * @param cwd - the session's project directory; must be non-empty.
 * @returns a single filesystem-safe project directory name.
 */
export function projectKey(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new Error('cannot encode an empty project path')
  }
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i += 1) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/**
 * The project directory that groups one cwd's sessions.
 *
 * @param root - the session root.
 * @param cwd - the session's project directory; `undefined` selects `_no-cwd`.
 * @returns the project directory path under `root`.
 */
export function projectDirectory(root, cwd) {
  return cwd === undefined ? join(root, NO_CWD_DIR_NAME) : join(root, projectKey(cwd))
}

/**
 * The directory one session owns inside the session root.
 *
 * @param root - the session root.
 * @param header - the session's authoritative header (`cwd` and `id`).
 * @returns the absolute session directory this id's log would live in.
 */
export function sessionDirectory(root, header) {
  if (header === undefined || typeof header !== 'object') {
    throw new Error('a session header is required to resolve a session directory')
  }
  return join(projectDirectory(root, header.cwd), encodeSegment(header.id))
}

/**
 * The one projection-cache file the session list keeps per session.
 *
 * The cache is keyed by session id under the storage domain's own directory, so
 * the same encoding applies. A miss is harmless: the entry is only read back for
 * a session that is loaded again.
 *
 * @param dshHome - a resolved harness home.
 * @param id - the session id.
 * @returns the absolute projection-cache file path for that id.
 */
export function projectionCacheFile(dshHome, id) {
  return join(dshHome, 'storages', 'session_projcache', 'sessions', `${encodeSegment(id)}.json`)
}

/** Matches one session artifact filename inside a session directory. */
export const SESSION_LOG_FILENAME = /^session(\.v\d+)?\.jsonl(\.zstd)?$/

/**
 * Prove that a resolved session directory may be deleted, or say why not.
 *
 * Deletion here is destructive and irreversible through any Harness API, so the
 * check is deliberately narrow: the path must sit strictly inside the session
 * root, it must be exactly the two levels this layout defines (`<project>/<id>`),
 * both levels must be the ones this header derives, and the directory must hold
 * at least one session artifact. Anything else is a layout the ported rules do
 * not describe, which is a refusal — never a best-effort delete.
 *
 * @param root - the session root.
 * @param directory - the directory {@link sessionDirectory} resolved.
 * @param header - the session header the directory is claimed to belong to.
 * @param entries - the directory's entry names; required, because deletion is
 *   only ever attempted against a directory that was observed to exist.
 * @returns `{ ok: true }`, or `{ ok: false, reason, message }`.
 */
export function assertDeletableDirectory(root, directory, header, entries) {
  const rootPath = resolve(root)
  const target = resolve(directory)
  const prefix = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`
  if (target === rootPath || !target.startsWith(prefix)) {
    return { ok: false, reason: 'OUTSIDE_ROOT', message: `拒绝删除会话根目录之外的路径：${target}` }
  }
  const segments = target.slice(prefix.length).split(sep)
  if (segments.length !== 2 || segments.some((segment) => segment.length === 0)) {
    return { ok: false, reason: 'MISPLACED', message: `会话目录不在“项目层/会话层”两级之下：${target}` }
  }
  const [projectSegment, idSegment] = segments
  // A session can still be in the archive set while no listing describes it any
  // more: its log was dropped by something else, or the header is unreadable.
  // That directory cannot be proven to belong to this id, so it is refused here
  // rather than allowed to throw — one unprovable id must not take the whole
  // page down.
  if (header === undefined || header === null || typeof header.id !== 'string' || header.id.length === 0) {
    return { ok: false, reason: 'NO_HEADER', message: `缺少会话头信息，无法确认目录归属：${target}` }
  }
  const expectedProject = basename(projectDirectory(rootPath, header.cwd))
  if (projectSegment !== expectedProject) {
    return { ok: false, reason: 'PROJECT_MISMATCH', message: `项目目录与该会话的项目路径不符：${projectSegment} ≠ ${expectedProject}` }
  }
  const expectedId = encodeSegment(header?.id)
  if (idSegment !== expectedId) {
    return { ok: false, reason: 'ID_MISMATCH', message: `目录名与编码后的会话 id 不一致：${idSegment} ≠ ${expectedId}` }
  }
  if (!Array.isArray(entries) || !entries.some((entry) => SESSION_LOG_FILENAME.test(entry))) {
    return { ok: false, reason: 'NOT_A_SESSION_DIRECTORY', message: `目录中没有会话日志文件，按不确定处理：${target}` }
  }
  return { ok: true }
}
