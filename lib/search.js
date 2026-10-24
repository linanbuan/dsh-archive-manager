/**
 * 归档会话管理 (Archive Manager) — matching rules for the page's search box.
 *
 * One matcher serves both halves of the feature: the Host filters the archived
 * set with it, and the deep (content) scan reuses the same term rules for its
 * snippets. Keeping the rules here — instead of in the browser bundle — means the
 * page has exactly one definition of "matches" to show and to test.
 *
 * Terms are literal, case-insensitive, and whitespace-flexible (a query of two
 * words matches text where they are separated by any run of whitespace), which is
 * what the Harness's own session search does. Every term must match somewhere in
 * the row (AND), and each term may match any of the row's fields.
 *
 * @module @local/dsh-archive-manager/search
 */

/** Longest query the page accepts, mirroring the Harness's own session search. */
export const MAX_QUERY_CHARS = 500

/** Fields a row is searched by, in the order a highlight should prefer them. */
export const SEARCH_FIELDS = ['title', 'project', 'cwd', 'directory', 'id', 'workspacePath']

/**
 * Normalize one query into its terms.
 *
 * @param {unknown} query - raw text from the page.
 * @returns {{ text: string, terms: string[] }} the trimmed query and its terms;
 *   `terms` is empty when the query is blank, which matches everything.
 */
export function compileQuery(query) {
  const text = typeof query === 'string' ? query.trim().slice(0, MAX_QUERY_CHARS) : ''
  if (text.length === 0) return { text: '', terms: [] }
  return { text, terms: text.split(/\s+/).filter((term) => term.length > 0).map((term) => term.toLowerCase()) }
}

/**
 * Build a case-insensitive, whitespace-flexible literal pattern for one term.
 *
 * @param {string} term - one already-lowercased term.
 * @returns {RegExp} a pattern that never throws on regex metacharacters.
 */
export function termPattern(term) {
  const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = escaped.split(/\s+/).join('\\s+')
  return new RegExp(body, 'i')
}

/**
 * Whether one row satisfies every term.
 *
 * @param {Record<string, unknown>} row - one archived-session row.
 * @param {readonly string[]} terms - lowercased terms; empty matches everything.
 * @returns {boolean}
 */
export function rowMatches(row, terms) {
  if (terms.length === 0) return true
  const fields = SEARCH_FIELDS
    .map((field) => (typeof row[field] === 'string' ? row[field] : ''))
    .filter((value) => value.length > 0)
    .join('\n')
    .toLowerCase()
  if (fields.length === 0) return false
  return terms.every((term) => fields.includes(term))
}

/**
 * The fields of one row that satisfied the query, for the page's highlight.
 *
 * @param {Record<string, unknown>} row - one archived-session row.
 * @param {readonly string[]} terms - lowercased terms.
 * @returns {string[]} field names that contain at least one term.
 */
export function matchedFields(row, terms) {
  if (terms.length === 0) return []
  return SEARCH_FIELDS.filter((field) => {
    const value = row[field]
    if (typeof value !== 'string' || value.length === 0) return false
    const lower = value.toLowerCase()
    return terms.some((term) => lower.includes(term))
  })
}

/**
 * Cut a readable snippet around the first term found in one text.
 *
 * @param {string} text - document text, already known to contain a term.
 * @param {readonly string[]} terms - lowercased terms.
 * @param {number} [radius] - characters of context on each side.
 * @returns {string} a single-line snippet, or an empty string when nothing matched.
 */
export function snippetAround(text, terms, radius = 60) {
  const source = typeof text === 'string' ? text : ''
  if (source.length === 0 || terms.length === 0) return ''
  const lower = source.toLowerCase()
  let at = -1
  let length = 0
  for (const term of terms) {
    const found = lower.indexOf(term)
    if (found !== -1 && (at === -1 || found < at)) {
      at = found
      length = term.length
    }
  }
  if (at === -1) return ''
  const start = Math.max(0, at - radius)
  const end = Math.min(source.length, at + length + radius)
  const body = source.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${body}${end < source.length ? '…' : ''}`
}
