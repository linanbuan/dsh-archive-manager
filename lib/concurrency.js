/**
 * 归档会话管理 (Archive Manager) — bounded concurrency.
 *
 * Every directory the page describes costs one `readdir` plus one `stat` per log
 * file, and the archived set on a long-lived machine reaches the hundreds. Doing
 * that one row at a time is what made the old page take seconds: the waits were
 * sequential, not the work. This helper keeps the waits overlapped while keeping
 * the number of open handles bounded, so a cold snapshot stays fast without
 * turning into an unbounded fan-out of file operations.
 *
 * @module @local/dsh-archive-manager/concurrency
 */

/**
 * Map over items with at most `limit` workers in flight, preserving input order.
 *
 * The first rejection aborts the remaining work and is rethrown, so a caller that
 * wants per-item isolation must catch inside `worker`.
 *
 * @template T, R
 * @param {readonly T[]} items - inputs to visit.
 * @param {number} limit - maximum concurrent workers; values below 1 mean 1.
 * @param {(item: T, index: number) => Promise<R>} worker - per-item work.
 * @returns {Promise<R[]>} one result per input, in input order.
 */
export async function mapLimit(items, limit, worker) {
  const size = items.length
  const results = new Array(size)
  if (size === 0) return results
  const width = Math.max(1, Math.min(Math.floor(Number(limit) || 1), size))
  let next = 0
  let failure
  const runners = new Array(width).fill(undefined).map(async () => {
    for (;;) {
      if (failure !== undefined) return
      const index = next
      next += 1
      if (index >= size) return
      try {
        results[index] = await worker(items[index], index)
      } catch (error) {
        failure ??= error
        return
      }
    }
  })
  await Promise.all(runners)
  if (failure !== undefined) throw failure
  return results
}

/**
 * Map over items, isolating each failure into its own settled envelope.
 *
 * @template T, R
 * @param {readonly T[]} items - inputs to visit.
 * @param {number} limit - maximum concurrent workers.
 * @param {(item: T, index: number) => Promise<R>} worker - per-item work.
 * @returns {Promise<Array<{ ok: true, value: R } | { ok: false, error: unknown }>>}
 */
export async function settleLimit(items, limit, worker) {
  return mapLimit(items, limit, async (item, index) => {
    try {
      return { ok: true, value: await worker(item, index) }
    } catch (error) {
      return { ok: false, error }
    }
  })
}
