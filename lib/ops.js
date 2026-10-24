/**
 * 归档会话管理 (Archive Manager) — batch restore and batch delete.
 *
 * ## Why the guards live here and not in the route
 *
 * Deleting a session is not a Harness API: the plugin removes the session
 * directory itself. That makes every check between a click and an `rm -r`
 * load-bearing, and it makes them worth writing once, in a place that a batch of
 * five hundred ids cannot bypass. A batch is therefore not "the single operation
 * in a loop": it is one fresh observation of the archived set, then one guarded
 * removal per id, then one ordered unarchive per success, and every per-id
 * failure is reported instead of aborting the rest.
 *
 * The order is deliberate. Artifacts go first and the archive entry second, so a
 * failure part-way through leaves the session archived and visible — recoverable
 * by a human — rather than silently deleted from the list while its files stay on
 * disk forever.
 *
 * @module @local/dsh-archive-manager/ops
 */

import { readdir, rm, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

import { mapLimit } from './concurrency.js'
import { assertDeletableDirectory, projectionCacheFile } from './layout.js'

/** How many directory removals may overlap. */
const REMOVAL_CONCURRENCY = 4

/** A batch request this plugin refuses to act on. */
export class BatchInputError extends Error {
  /**
   * @param code - machine-readable reason.
   * @param message - text shown to the caller.
   */
  constructor(code, message) {
    super(message)
    this.name = 'BatchInputError'
    this.code = code
  }
}

/**
 * Normalize a requested id list into the ids this plugin will act on.
 *
 * @param input - the raw request field.
 * @param limit - the largest batch this deployment accepts.
 * @returns the trimmed, de-duplicated ids in request order.
 * @throws {BatchInputError} when the field is unusable or too large.
 */
export function normalizeIds(input, limit) {
  if (!Array.isArray(input)) throw new BatchInputError('INVALID_IDS', 'ids 必须是字符串数组')
  const seen = new Set()
  const ids = []
  for (const value of input) {
    if (typeof value !== 'string') continue
    const id = value.trim()
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  if (ids.length === 0) throw new BatchInputError('EMPTY_SELECTION', '没有可操作的会话')
  if (ids.length > limit) throw new BatchInputError('TOO_MANY_IDS', '一次最多操作 ' + String(limit) + ' 个会话，请分批处理')
  return ids
}

/**
 * Count a batch's outcomes the way the page summarizes them.
 *
 * @param results - per-id results.
 * @returns counts plus the bytes freed by the successful removals.
 */
function summarize(results) {
  const summary = { requested: results.length, succeeded: 0, failed: 0, bytes: 0 }
  for (const result of results) {
    if (result.ok) {
      summary.succeeded += 1
      summary.bytes += result.bytes ?? 0
      continue
    }
    summary.failed += 1
    // A failure after the artifacts were already removed (the archive entry is
    // what refused) still freed those bytes; reporting zero would be a lie.
    if (result.deleted === true) summary.bytes += result.bytes ?? 0
  }
  return summary
}

/**
 * Batch restore and batch delete against one plugin instance.
 */
export class ArchiveOperations {
  #ctx
  #snapshot
  #limit

  /**
   * @param ctx - the plugin context.
   * @param snapshot - the snapshot this instance owns.
   * @param limit - the largest batch this deployment accepts.
   */
  constructor(ctx, snapshot, limit) {
    this.#ctx = ctx
    this.#snapshot = snapshot
    this.#limit = limit
  }

  /** The largest batch this instance accepts. */
  get batchLimit() {
    return this.#limit
  }

  /**
   * Restore archived sessions, reporting one outcome per id.
   *
   * @param input - the raw request field.
   * @returns per-id results and their summary.
   */
  async restore(input) {
    const ids = normalizeIds(input, this.#limit)
    const registry = this.#ctx.get('workspaceRegistry')
    if (registry === undefined) throw new BatchInputError('UNAVAILABLE', '当前部署没有工作区注册表，无法复原会话')
    const archived = new Set(registry.archivedSessionIds ?? [])
    const results = []
    for (const id of ids) {
      if (!archived.has(id)) {
        results.push({ id, ok: false, code: 'NOT_ARCHIVED', message: '该会话不在归档中' })
        continue
      }
      try {
        await registry.unarchiveSession(id)
        archived.delete(id)
        results.push({ id, ok: true })
      } catch (error) {
        results.push({ id, ok: false, code: 'RESTORE_FAILED', message: errorMessage(error) })
      }
    }
    this.#snapshot.invalidate('restore')
    return { results, summary: summarize(results) }
  }

  /**
   * Permanently remove archived sessions, reporting one outcome per id.
   *
   * @param input - the raw request field.
   * @param options - `dryRun` reports what would be removed without removing it.
   * @returns per-id results and their summary.
   */
  async remove(input, options = {}) {
    const dryRun = options.dryRun === true
    const ids = normalizeIds(input, this.#limit)
    const registry = this.#ctx.get('workspaceRegistry')
    if (registry === undefined) throw new BatchInputError('UNAVAILABLE', '当前部署没有工作区注册表，无法删除会话')
    const rows = await this.#snapshot.read({ refresh: true })
    const byId = new Map(rows.items.map((row) => [row.id, row]))
    const archived = new Set(registry.archivedSessionIds ?? [])

    const attempted = await mapLimit(ids, REMOVAL_CONCURRENCY, async (id) => {
      const row = byId.get(id)
      if (row === undefined) return { id, ok: false, code: 'NOT_ARCHIVED', message: '该会话不在归档中' }
      if (!archived.has(id)) return { id, ok: false, code: 'NOT_ARCHIVED', message: '该会话不在归档中' }
      if (row.live) return { id, ok: false, code: 'LIVE_SESSION', message: '会话正在运行，不能删除' }
      if (!row.hasHeader) return { id, ok: false, code: 'NO_HEADER', message: '缺少会话头信息，无法确认目录归属' }
      if (!row.onDisk) return { id, ok: false, code: 'NOT_ON_DISK', message: '会话目录不在磁盘上' }
      const directory = resolve(row.directoryPath)
      let entries
      try {
        entries = await readdir(directory)
      } catch (error) {
        return { id, ok: false, code: 'NOT_ON_DISK', message: errorMessage(error) }
      }
      const guard = assertDeletableDirectory(this.#snapshot.root, directory, { id, cwd: row.cwd ?? undefined }, entries)
      if (!guard.ok) return { id, ok: false, code: guard.reason, message: guard.message }
      if (dryRun) return { id, ok: true, bytes: row.sizeBytes, dryRun: true }
      try {
        await rm(directory, { recursive: true, force: false, maxRetries: 3 })
      } catch (error) {
        return { id, ok: false, code: 'REMOVE_FAILED', message: errorMessage(error) }
      }
      await this.#forgetCache(id)
      return { id, ok: true, bytes: row.sizeBytes }
    })

    const results = []
    for (const result of attempted) {
      if (!result.ok || dryRun) {
        results.push(result)
        continue
      }
      try {
        await registry.unarchiveSession(result.id)
        results.push(result)
      } catch (error) {
        // The artifacts are gone; the archive entry is what remains. Say so
        // instead of pretending the whole operation failed.
        results.push({
          ...result,
          ok: false,
          code: 'UNARCHIVE_FAILED',
          message: '文件已删除，但归档记录未能移除：' + errorMessage(error),
          bytes: result.bytes,
          deleted: true,
        })
      }
    }
    if (!dryRun) {
      this.#snapshot.invalidate('delete')
      for (const result of results) {
        if (!result.ok && result.code !== 'UNARCHIVE_FAILED') continue
        try {
          this.#ctx.emit('api-session/removed', result.id)
        } catch (error) {
          this.#ctx.logger?.warn?.('archive-manager: session removal broadcast failed: ' + errorMessage(error))
        }
      }
    }
    return { results, summary: summarize(results), dryRun }
  }

  /**
   * Drop one session's projection-cache entry, best effort.
   *
   * A leftover entry is harmless — the cache validates its identity against the
   * listed header — but a removed session's entry can never match again, so it is
   * only clutter. Failure here must not fail the removal.
   *
   * @param id - the removed session id.
   */
  async #forgetCache(id) {
    try {
      await unlink(projectionCacheFile(this.#snapshot.home, id))
    } catch {
      /* absent or unwritable: nothing to clean up */
    }
  }
}

/**
 * Render an unknown failure as one line of text.
 *
 * @param error - the thrown value.
 * @returns a message safe to show in the page.
 */
export function errorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error)
}
