/**
 * 归档会话管理 (Archive Manager) — browser half.
 *
 * A hand-authored lazy-CJS bundle in the shape `dsh-client-modules` serves and
 * `window.__ModuleLoader__` materializes: plain `React.createElement` over markup
 * this plugin styles itself, requiring only `react` from the shell's platform
 * module table — no build step, no external module requests, and no guessing at
 * another package's private component API.
 *
 * It registers exactly one `settings.section`, the same additive seat the shipped
 * 插件 / 通用设置 / 模型 pages use, and reads its data from this plugin's own
 * authenticated `/api/archive/*` routes. Every destructive decision — which
 * directory belongs to a session, whether it may be removed, whether the session
 * is still live — is made on the Host; this half only renders the answer and asks.
 *
 * ## Layout and look
 *
 * The page is built from the same primitives as the shipped 插件 manager page: a
 * 960px column inside `clamp(24px,4vw,48px)` gutters, a 20px/500 heading with a
 * 13px secondary intro, a flat list whose rows highlight on hover instead of
 * carrying borders, 28px icon buttons, and `--dsw-alias-*` theme tokens only. That
 * is what makes it read as part of Settings instead of as an embedded app.
 *
 * ## Interaction model
 *
 * Search and the status chips filter an already-loaded snapshot in memory, so
 * typing never waits on the network. Session *content* is searched only when asked
 * for — that mode is the one path that opens logs, so it is explicit, paged, and
 * reports its own progress.
 *
 * @module @local/dsh-archive-manager/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-archive-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const h = React.createElement

    /** Settings section id; the shell maps this id to its archive nav glyph. */
    const SECTION_ID = 'archived-sessions'

    /** Locale namespace this bundle registers its dictionary under. */
    const LOCALE_NS = 'archiveManager'

    /** The routes this page talks to. */
    const ROUTE_LIST = '/api/archive/sessions'
    const ROUTE_TITLES = '/api/archive/titles'
    const ROUTE_SEARCH = '/api/archive/search'
    const ROUTE_RESTORE = '/api/archive/restore'
    const ROUTE_DELETE = '/api/archive/delete'

    /** Rows rendered before the "show more" row appears. */
    const PAGE_SIZE = 60

    /** How long typing settles before the list is refiltered. */
    const SEARCH_DEBOUNCE_MS = 140

    /** Most ids one title request asks for. */
    const TITLE_BATCH = 24

    /** Safety stop for the progressive title loop. */
    const TITLE_ROUNDS = 24

    /** How long one notice stays on screen. */
    const NOTICE_MS = 9000

    /** The status chips, in display order. */
    const FILTERS = [
      { id: 'all', label: 'filterAll' },
      { id: 'deletable', label: 'filterDeletable' },
      { id: 'live', label: 'filterLive' },
      { id: 'missing', label: 'filterMissing' },
    ]

    /** The sort orders offered by the toolbar. */
    const SORTS = [
      { id: 'updated', label: 'sortUpdated' },
      { id: 'created', label: 'sortCreated' },
      { id: 'size', label: 'sortSize' },
      { id: 'title', label: 'sortTitle' },
    ]

    /** Every user-visible string, flat-keyed for the locale service. */
    const DICT = {
      zh: {
        nav: '归档会话',
        heading: '归档会话',
        intro: '归档的会话不会出现在项目列表里。可以复原回工作区，也可以从磁盘永久删除。',
        searchPlaceholder: '搜索标题、项目或路径',
        searchContentPlaceholder: '搜索会话内容（较慢）',
        contentMode: '搜索会话内容',
        contentModeOn: '内容搜索：开',
        contentModeOff: '内容搜索：关',
        contentStart: '开始搜索',
        contentScanning: '正在扫描 {done}/{total} 个会话…',
        contentDone: '已扫描 {total} 个会话，命中 {hits} 个',
        contentTruncated: '本次扫描已用尽时间预算，可继续',
        contentContinue: '继续搜索',
        contentStop: '停止',
        contentNoHit: '没有会话内容命中这个关键词。',
        contentUnavailable: '当前部署不支持内容搜索。',
        refresh: '刷新',
        refreshing: '正在刷新…',
        retry: '重试',
        loading: '正在读取归档会话…',
        loadFailed: '读取失败',
        empty: '还没有归档会话。在侧栏的会话菜单里选择“归档会话”，它就会出现在这里。',
        emptySearch: '没有匹配的归档会话。',
        emptyFilter: '当前筛选条件下没有会话。',
        clearFilters: '清除筛选',
        filterAll: '全部',
        filterDeletable: '可删除',
        filterLive: '运行中',
        filterMissing: '仅记录',
        sortUpdated: '最近更新',
        sortCreated: '创建时间',
        sortSize: '体积',
        sortTitle: '标题',
        live: '运行中',
        missing: '仅归档记录',
        pinned: '已置顶',
        untitled: '（无标题）',
        restore: '复原',
        restoreMany: '批量复原',
        remove: '永久删除',
        removeMany: '批量删除',
        selectAll: '全选',
        selectRow: '选择此会话',
        selected: '已选 {n} 项',
        selectedBytes: '共 {size}',
        clearSelection: '取消选择',
        confirmTitle: '永久删除 {n} 个会话？',
        confirmBody: '会话日志、投影缓存与归档记录会一起被删除，Harness 无法恢复。此操作不可撤销。',
        confirmList: '将被删除的会话',
        confirmMore: '还有 {n} 个未列出',
        confirmCancel: '取消',
        confirmAccept: '永久删除',
        deleting: '正在删除…',
        restoring: '正在复原…',
        resultRestored: '已复原 {n} 个会话',
        resultDeleted: '已删除 {n} 个会话，释放 {size}',
        resultPartial: '{ok} 个成功，{failed} 个失败',
        resultFailedTitle: '以下会话未能处理',
        dismiss: '关闭',
        summary: '{n} 个归档会话 · {size}',
        summaryDeletable: '可删除 {n}',
        summaryLive: '运行中 {n}',
        summaryMissing: '仅记录 {n}',
        dataAt: '数据时间 {time}',
        titleLoading: '正在读取标题…',
        sessionCount: '{n} 个会话',
        sessionCountFiltered: '{shown} / {n} 个会话',
        blockLive: '会话正在运行，请先关闭再删除。',
        blockNotOnDisk: '会话目录已不在磁盘上，只能从归档列表移除。',
        blockNoHeader: '缺少会话头信息，无法确认目录归属。',
        blockLayout: '磁盘布局与预期不符，为安全起见不执行删除。',
        blockNotArchived: '它已不在归档列表中，请刷新后重试。',
        showMore: '显示更多（还有 {n} 个）',
        footNote: '复原只把会话移出归档列表并回到它原来的工作区；永久删除会删掉磁盘上的会话日志与投影缓存，Harness 无法恢复。',
        sizeHint: '大小与时间来自磁盘上的会话日志。',
        timeJustNow: '刚刚',
        timeMinutes: '{n} 分钟前',
        timeHours: '{n} 小时前',
        timeDays: '{n} 天前',
      },
      en: {
        nav: 'Archived sessions',
        heading: 'Archived sessions',
        intro: 'Archived sessions stay out of the project list. Restore one back into its workspace, or delete it from disk for good.',
        searchPlaceholder: 'Search title, project or path',
        searchContentPlaceholder: 'Search session content (slower)',
        contentMode: 'Search session content',
        contentModeOn: 'Content search: on',
        contentModeOff: 'Content search: off',
        contentStart: 'Search',
        contentScanning: 'Scanning {done}/{total} sessions…',
        contentDone: 'Scanned {total} sessions, {hits} matched',
        contentTruncated: 'The time budget ran out; continue to scan the rest',
        contentContinue: 'Continue searching',
        contentStop: 'Stop',
        contentNoHit: 'No session content matched this keyword.',
        contentUnavailable: 'This deployment cannot search session content.',
        refresh: 'Refresh',
        refreshing: 'Refreshing…',
        retry: 'Retry',
        loading: 'Reading archived sessions…',
        loadFailed: 'Read failed',
        empty: 'No archived sessions yet. Choose “Archive session” in the sidebar menu and it appears here.',
        emptySearch: 'No archived session matches this search.',
        emptyFilter: 'No session matches the current filter.',
        clearFilters: 'Clear filters',
        filterAll: 'All',
        filterDeletable: 'Deletable',
        filterLive: 'Running',
        filterMissing: 'Entries only',
        sortUpdated: 'Last updated',
        sortCreated: 'Created',
        sortSize: 'Size',
        sortTitle: 'Title',
        live: 'Running',
        missing: 'Archive entry only',
        pinned: 'Pinned',
        untitled: '(untitled)',
        restore: 'Restore',
        restoreMany: 'Restore selected',
        remove: 'Delete permanently',
        removeMany: 'Delete selected',
        selectAll: 'Select all',
        selectRow: 'Select this session',
        selected: '{n} selected',
        selectedBytes: '{size} total',
        clearSelection: 'Clear selection',
        confirmTitle: 'Delete {n} sessions permanently?',
        confirmBody: 'The session logs, projection cache and archive entries are removed together. This cannot be undone.',
        confirmList: 'Sessions to delete',
        confirmMore: '{n} more not listed',
        confirmCancel: 'Cancel',
        confirmAccept: 'Delete permanently',
        deleting: 'Deleting…',
        restoring: 'Restoring…',
        resultRestored: 'Restored {n} sessions',
        resultDeleted: 'Deleted {n} sessions, {size} freed',
        resultPartial: '{ok} succeeded, {failed} failed',
        resultFailedTitle: 'These sessions could not be handled',
        dismiss: 'Dismiss',
        summary: '{n} archived sessions · {size}',
        summaryDeletable: '{n} deletable',
        summaryLive: '{n} running',
        summaryMissing: '{n} entries only',
        dataAt: 'Data as of {time}',
        titleLoading: 'Reading titles…',
        sessionCount: '{n} sessions',
        sessionCountFiltered: '{shown} / {n} sessions',
        blockLive: 'The session is running. Close it before deleting.',
        blockNotOnDisk: 'Its directory is already gone; it can only be dropped from the archive list.',
        blockNoHeader: 'No session header, so its directory cannot be proven.',
        blockLayout: 'The on-disk layout does not match the expected shape, so nothing was removed.',
        blockNotArchived: 'It is no longer in the archive list. Refresh and try again.',
        showMore: 'Show more ({n} left)',
        footNote: 'Restoring only drops the session from the archive list, returning it to its workspace. Permanent deletion removes the session log and projection cache from disk; the Harness cannot restore them.',
        sizeHint: 'Size and time come from the session log on disk.',
        timeJustNow: 'just now',
        timeMinutes: '{n} min ago',
        timeHours: '{n} h ago',
        timeDays: '{n} d ago',
      },
    }

    /** Live binder for the locale service; replaced when the service appears. */
    let boundTranslate

    /**
     * Translate one key, falling back to the Chinese dictionary.
     *
     * @param key - a key of {@link DICT}.
     * @param vars - values for `{name}` placeholders.
     * @returns the translated text.
     */
    function tr(key, vars) {
      let text
      if (boundTranslate !== undefined) {
        try {
          text = boundTranslate(key)
        } catch {
          text = undefined
        }
      }
      if (typeof text !== 'string' || text.length === 0 || text === key) text = DICT.zh[key] ?? key
      if (vars === undefined) return text
      return text.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])))
    }

    // -----------------------------------------------------------------------
    // Pure helpers — used by the component and exposed for the self-check
    // -----------------------------------------------------------------------

    /**
     * Render a byte count the way a file manager does.
     *
     * @param bytes - the size in bytes.
     * @returns a short human string.
     */
    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let value = bytes
      let index = 0
      while (value >= 1024 && index < units.length - 1) {
        value /= 1024
        index += 1
      }
      const rounded = index === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
      return String(rounded) + ' ' + units[index]
    }

    /** Pad a number to two digits. */
    function pad2(value) {
      return value < 10 ? '0' + String(value) : String(value)
    }

    /**
     * Render one timestamp as a relative age, then as a date.
     *
     * @param ms - epoch milliseconds.
     * @returns a short human string.
     */
    function formatTime(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
      const delta = Date.now() - ms
      if (delta >= 0 && delta < 60_000) return tr('timeJustNow')
      if (delta >= 0 && delta < 3_600_000) return tr('timeMinutes', { n: Math.floor(delta / 60_000) })
      if (delta >= 0 && delta < 86_400_000) return tr('timeHours', { n: Math.floor(delta / 3_600_000) })
      if (delta >= 0 && delta < 7 * 86_400_000) return tr('timeDays', { n: Math.floor(delta / 86_400_000) })
      const date = new Date(ms)
      return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
    }

    /**
     * Split a query into lowercased terms, the same rule the Host applies.
     *
     * @param query - raw text.
     * @returns the terms; empty means "match everything".
     */
    function compileTerms(query) {
      if (typeof query !== 'string') return []
      const trimmed = query.trim()
      if (trimmed.length === 0) return []
      return trimmed.split(/\s+/).filter((term) => term.length > 0).map((term) => term.toLowerCase())
    }

    /** Fields the in-memory search looks at. */
    const SEARCH_FIELDS = ['title', 'cwd', 'directory', 'id']

    /**
     * Whether one row satisfies every term.
     *
     * @param row - one archived-session row.
     * @param terms - lowercased terms.
     * @returns the match verdict.
     */
    function rowMatchesQuery(row, terms) {
      if (terms.length === 0) return true
      const values = SEARCH_FIELDS.map((field) => (typeof row[field] === 'string' ? row[field] : ''))
      values.push(typeof row.project?.title === 'string' ? row.project.title : '')
      const haystack = values.filter((value) => value.length > 0).join('\n').toLowerCase()
      if (haystack.length === 0) return false
      return terms.every((term) => haystack.indexOf(term) !== -1)
    }

    /**
     * Whether one row satisfies the active status chip.
     *
     * @param row - one archived-session row.
     * @param filter - a chip id.
     * @returns the match verdict.
     */
    function rowMatchesFilter(row, filter) {
      if (filter === 'deletable') return row.deletable === true
      if (filter === 'live') return row.live === true
      if (filter === 'missing') return row.onDisk !== true
      return true
    }

    /**
     * Filter rows by query, status chip, and an optional id set.
     *
     * @param rows - the loaded rows.
     * @param options - terms, chip id, and an optional id set to keep.
     * @returns the surviving rows in input order.
     */
    function filterRows(rows, options) {
      const terms = options?.terms ?? []
      const filter = options?.filter ?? 'all'
      const only = options?.only
      return rows.filter((row) => {
        if (only !== undefined && only !== null && !only.has(row.id)) return false
        if (!rowMatchesFilter(row, filter)) return false
        return rowMatchesQuery(row, terms)
      })
    }

    /**
     * Sort rows by one of the toolbar orders.
     *
     * @param rows - rows to order.
     * @param sort - a sort id.
     * @returns a new ordered array.
     */
    function sortRows(rows, sort) {
      const ordered = [...rows]
      const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
      if (sort === 'title') {
        ordered.sort((left, right) => {
          const a = String(left.title ?? '').toLocaleLowerCase()
          const b = String(right.title ?? '').toLocaleLowerCase()
          if (a.length === 0 && b.length > 0) return 1
          if (b.length === 0 && a.length > 0) return -1
          return a.localeCompare(b)
        })
        return ordered
      }
      if (sort === 'size') {
        ordered.sort((left, right) => number(right.sizeBytes) - number(left.sizeBytes))
        return ordered
      }
      if (sort === 'created') {
        ordered.sort((left, right) => number(right.createdAt) - number(left.createdAt))
        return ordered
      }
      ordered.sort((left, right) => number(right.updatedAt) - number(left.updatedAt))
      return ordered
    }

    /**
     * Apply a shift-click range to a selection.
     *
     * @param rows - the visible rows, in display order.
     * @param selected - the current selection.
     * @param anchorId - the last row clicked without shift.
     * @param targetId - the row clicked with shift.
     * @returns the new selection.
     */
    function selectRange(rows, selected, anchorId, targetId) {
      const next = new Set(selected)
      const from = rows.findIndex((row) => row.id === anchorId)
      const to = rows.findIndex((row) => row.id === targetId)
      if (from === -1 || to === -1) {
        next.add(targetId)
        return next
      }
      const start = Math.min(from, to)
      const end = Math.max(from, to)
      for (let index = start; index <= end; index += 1) next.add(rows[index].id)
      return next
    }

    /**
     * Merge freshly folded titles into a loaded snapshot.
     *
     * @param payload - the loaded snapshot.
     * @param titles - id to title text (null means "folded, no title").
     * @returns the same payload with patched rows.
     */
    function applyTitles(payload, titles) {
      if (payload === null || titles === null || typeof titles !== 'object') return payload
      let changed = false
      const items = payload.items.map((row) => {
        if (!Object.hasOwn(titles, row.id)) return row
        changed = true
        return { ...row, title: titles[row.id], titleSource: 'memo' }
      })
      return changed ? { ...payload, items } : payload
    }

    /**
     * Total size of a set of selected rows.
     *
     * @param rows - every loaded row.
     * @param selected - the selection.
     * @returns the byte total.
     */
    function selectedBytes(rows, selected) {
      let total = 0
      for (const row of rows) if (selected.has(row.id)) total += row.sizeBytes ?? 0
      return total
    }

    /**
     * POST one JSON body and parse the answer.
     *
     * @param url - the route.
     * @param body - the JSON body.
     * @returns the parsed payload.
     * @throws when the channel or the payload refuses the request.
     */
    async function postJson(url, body) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error('HTTP ' + String(response.status))
      return response.json()
    }

    /**
     * GET one route and parse the answer.
     *
     * @param url - the route.
     * @param signal - cancellation for a superseded request.
     * @returns the parsed payload.
     * @throws when the channel refuses the request.
     */
    async function getJson(url, signal) {
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal })
      if (!response.ok) throw new Error('HTTP ' + String(response.status))
      return response.json()
    }

    /**
     * Turn one Host result code into the sentence the page shows.
     *
     * @param code - a result code.
     * @returns the explanation.
     */
    function blockReason(code) {
      if (code === 'LIVE_SESSION') return tr('blockLive')
      if (code === 'NOT_ON_DISK') return tr('blockNotOnDisk')
      if (code === 'NO_HEADER') return tr('blockNoHeader')
      if (code === 'NOT_ARCHIVED') return tr('blockNotArchived')
      return tr('blockLayout')
    }

    // -----------------------------------------------------------------------
    // Styles — theme tokens only, so light/dark follow the shell
    // -----------------------------------------------------------------------

    /** The stylesheet identity the shell's inspector looks for. */
    const STYLE_PLUGIN = 'dsh-archive-manager'
    const STYLE_NAME = 'dsh-archive-manager/client.css'

    /** One stylesheet for the whole page. */
    const CSS = [
      // A settings section is a flow child of the shell's scroll container: it
      // must not claim height or its own scrollbar, and it must fit the ~564px
      // content column, so the column is capped like the shipped pages do.
      '.dsam-section{display:flex;flex-direction:column;gap:12px;width:100%;max-width:720px;color:var(--dsw-alias-label-primary)}',
      '.dsam-title{margin:0;font-size:16px;font-weight:500;line-height:24px}',
      '.dsam-intro{margin:-6px 0 0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}',
      '.dsam-toolbar{display:flex;align-items:center;gap:8px;min-width:0}',
      '.dsam-search{position:relative;display:flex;flex:1;min-width:120px;align-items:center;color:var(--dsw-alias-label-tertiary)}',
      '.dsam-searchIcon{position:absolute;inset-inline-start:11px;display:inline-flex;pointer-events:none}',
      '.dsam-input{box-sizing:border-box;width:100%;height:34px;padding:0 30px 0 34px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none}',
      '.dsam-input::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.dsam-input:focus-visible{border-color:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary)) 18%,transparent)}',
      '.dsam-clear{position:absolute;inset-inline-end:5px;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0}',
      '.dsam-clear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsam-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px}',
      '.dsam-chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border:0;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}',
      '.dsam-chip:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3)}',
      '.dsam-chip[data-active=true]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-ghost-active-fill);box-shadow:inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border)}',
      '.dsam-chip[data-active=true]:hover{background:var(--dsw-alias-button-ghost-active-hover,var(--dsw-alias-button-ghost-active-fill))}',
      '.dsam-chip:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
      '.dsam-chipCount{color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}',
      '.dsam-select{height:26px;padding:0 4px;border-radius:var(--dsw-radius-sm,6px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}',
      '.dsam-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 12px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}',
      '.dsam-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsam-btn:disabled{opacity:.5;cursor:default}',
      '.dsam-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
      '.dsam-btn[data-variant=primary]{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-inverted)}',
      '.dsam-btn[data-variant=primary]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
      '.dsam-btn[data-variant=danger]{background:var(--dsw-alias-state-error-primary);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}',
      '.dsam-btn[data-variant=danger]:hover:not(:disabled){filter:brightness(.94);background:var(--dsw-alias-state-error-primary)}',
      '.dsam-btn[data-variant=ghost]{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}',
      '.dsam-btn[data-variant=ghost]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsam-iconBtn{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-caption);cursor:pointer;padding:0;flex:none}',
      '.dsam-iconBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.dsam-iconBtn[data-danger]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-state-error-primary)}',
      '.dsam-iconBtn:disabled{opacity:.4;cursor:default}',
      '.dsam-iconBtn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
      '.dsam-summary{display:flex;flex-wrap:wrap;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-top:-8px}',
      '.dsam-dot{width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.6}',
      '.dsam-listHead{display:flex;align-items:center;gap:10px;padding:0 8px 4px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
      '.dsam-listHeadText{flex:1;min-width:0}',
      '.dsam-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}',
      '.dsam-row{display:flex;align-items:flex-start;gap:10px;margin:0 -8px;padding:8px;border-radius:var(--dsw-radius-lg,10px);position:relative}',
      '.dsam-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsam-row[data-selected=true]{background:var(--dsw-alias-bg-multi-select,var(--dsw-alias-bg-layer-2))}',
      '.dsam-check{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:none;margin-top:1px;cursor:pointer}',
      '.dsam-check input{width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}',
      '.dsam-rowMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.dsam-rowTitle{display:flex;align-items:center;gap:8px;min-width:0}',
      '.dsam-name{font-size:14px;font-weight:500;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.dsam-name[data-untitled=true]{color:var(--dsw-alias-label-tertiary);font-weight:400}',
      '.dsam-tags{display:inline-flex;align-items:center;gap:4px;flex:none}',
      '.dsam-tag{display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1;white-space:nowrap}',
      '.dsam-tag[data-tone=live]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent);color:var(--dsw-alias-state-success-primary)}',
      '.dsam-tag[data-tone=warn]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent);color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary))}',
      '.dsam-meta{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;min-width:0}',
      '.dsam-project{flex:none;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.dsam-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}',
      '.dsam-snippet{margin-top:2px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsam-snippet mark{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 28%,transparent);color:inherit;border-radius:3px;padding:0 1px}',
      '.dsam-rowEnd{display:flex;align-items:center;gap:10px;flex:none}',
      '.dsam-size{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;min-width:56px;text-align:end}',
      '.dsam-time{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;min-width:78px;text-align:end}',
      '.dsam-actions{display:flex;align-items:center;gap:2px}',
      '.dsam-skelRow{display:flex;align-items:center;gap:10px;padding:12px 8px}',
      '.dsam-skel{height:12px;border-radius:6px;background:var(--dsw-alias-bg-skeleton);position:relative;overflow:hidden}',
      '.dsam-skel:after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--dsw-alias-label-shimmer,var(--dsw-alias-label-secondary)) 22%,transparent),transparent);animation:dsam-shimmer 1.4s infinite}',
      '@keyframes dsam-shimmer{100%{transform:translateX(100%)}}',
      '@media (prefers-reduced-motion:reduce){.dsam-skel:after{animation:none}}',
      '.dsam-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:56px 16px;text-align:center;color:var(--dsw-alias-label-tertiary)}',
      '.dsam-emptyIcon{color:var(--dsw-alias-label-caption);opacity:.7;margin-bottom:2px}',
      '.dsam-emptyTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}',
      '.dsam-emptyBody{margin:0;max-width:520px;font-size:13px;line-height:20px}',
      '.dsam-error{display:flex;align-items:center;gap:10px;padding:12px;border-radius:var(--dsw-radius-lg,10px);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px}',
      '.dsam-progress{display:flex;align-items:center;gap:10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
      '.dsam-bar{flex:1;height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}',
      '.dsam-barFill{height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary);transition:width .2s ease}',
      '.dsam-selection{position:sticky;bottom:8px;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:10px;padding:8px 8px 8px 14px;border-radius:var(--dsw-radius-xl,12px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv2)}',
      '.dsam-selectionText{flex:1;min-width:0;font-size:13px;line-height:20px}',
      '.dsam-selectionMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;margin-inline-start:6px}',
      '.dsam-overlay{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.32))}',
      '.dsam-dialog{box-sizing:border-box;width:min(460px,100%);max-height:min(560px,80vh);display:flex;flex-direction:column;gap:12px;padding:20px;border-radius:var(--dsw-radius-xl,12px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv3)}',
      '.dsam-dialogTitle{margin:0;font-size:16px;font-weight:500;line-height:24px}',
      '.dsam-dialogBody{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}',
      '.dsam-dialogList{list-style:none;margin:0;padding:8px;max-height:220px;overflow:auto;border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:2px}',
      '.dsam-dialogItem{display:flex;align-items:center;gap:8px;padding:4px 6px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}',
      '.dsam-dialogItemName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsam-dialogItemMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;flex:none}',
      '.dsam-dialogMore{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:4px 6px}',
      '.dsam-dialogActions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:2px}',
      '.dsam-notice{position:fixed;inset-inline:0;bottom:24px;z-index:70;display:flex;justify-content:center;pointer-events:none;padding:0 24px}',
      '.dsam-noticeBody{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;max-width:min(640px,100%);padding:10px 12px;border-radius:var(--dsw-radius-xl,12px);background:var(--dsw-alias-toast-bg,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-toast-label,var(--dsw-alias-label-primary));box-shadow:var(--dsw-shadow-lv3);border:1px solid var(--dsw-alias-border-l2);font-size:13px;line-height:20px}',
      '.dsam-noticeBody[data-tone=success]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent)}',
      '.dsam-noticeBody[data-tone=error]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}',
      '.dsam-noticeText{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.dsam-noticeLines{margin:0;padding:0;list-style:none;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
      '.dsam-noticeLines li{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsam-foot{margin:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
      '.dsam-nav{display:inline-flex;align-items:center;gap:8px}',
      '.dsam-navText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsam-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}',
    ].join('')

    /** Inject the stylesheet once per document. */
    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="' + STYLE_NAME + '"]') !== null) return
      const element = document.createElement('style')
      element.setAttribute('data-plugin', STYLE_PLUGIN)
      element.setAttribute('data-plugin-css', STYLE_NAME)
      element.textContent = CSS
      document.head.append(element)
    }

    // -----------------------------------------------------------------------
    // Icons — one stroke weight, currentColor, 20px box
    // -----------------------------------------------------------------------

    /** Path data for every icon this page draws. */
    const ICONS = {
      search: 'M9 3.6a5.4 5.4 0 1 0 0 10.8A5.4 5.4 0 0 0 9 3.6ZM13.1 13.1 17 17',
      refresh: 'M16.2 8.4A6.4 6.4 0 1 0 16 12M16.4 4.6v3.9h-3.9',
      restore: 'M7.2 7.6h5.6a3.9 3.9 0 0 1 0 7.8H8.4M9.9 4.6 7 7.6l2.9 3',
      trash: 'M4.2 6.2h11.6M8.2 6.2V4.7h3.6v1.5M6.4 6.2l.6 9.1h6l.6-9.1',
      close: 'M5.4 5.4l9.2 9.2M14.6 5.4l-9.2 9.2',
      alert: 'M10 3.4 17 16.2H3ZM10 8v3.4M10 13.9v.2',
      stop: 'M6.6 6.6h6.8v6.8H6.6z',
      archive: 'M3.4 5.6h13.2v3H3.4zM4.6 8.6v7.2h10.8V8.6M8.2 11.6h3.6',
      check: 'M4.6 10.4l3.4 3.4 7.4-7.4',
    }

    /**
     * Render one icon.
     *
     * @param props - `name` plus optional `size`.
     * @returns an svg element.
     */
    function Icon(props) {
      const size = props.size ?? 20
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 20 20',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', { d: ICONS[props.name] ?? '' }),
      )
    }

    // -----------------------------------------------------------------------
    // Small building blocks
    // -----------------------------------------------------------------------

    /**
     * One icon-only button with a tooltip and an accessible name.
     *
     * @param props - `label`, `onClick`, `disabled`, `danger`, `name`.
     * @returns the button element.
     */
    function IconButton(props) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dsam-iconBtn',
          title: props.label,
          'aria-label': props.label,
          disabled: props.disabled === true,
          'data-danger': props.danger === true ? '' : undefined,
          onClick: props.onClick,
        },
        h(Icon, { name: props.name, size: props.size ?? 18 }),
      )
    }

    /**
     * Render one status tag.
     *
     * @param props - `tone` and children.
     * @returns the tag element.
     */
    function Tag(props) {
      return h('span', { className: 'dsam-tag', 'data-tone': props.tone }, props.children)
    }

    /**
     * Render one row of the list.
     *
     * @param props - the row and its handlers.
     * @returns the list item.
     */
    function Row(props) {
      const row = props.row
      const title = typeof row.title === 'string' && row.title.length > 0 ? row.title : tr('untitled')
      const untitled = title === tr('untitled')
      return h(
        'li',
        { className: 'dsam-row', 'data-selected': props.selected ? 'true' : undefined },
        h(
          'label',
          { className: 'dsam-check', title: tr('selectRow') },
          h('input', {
            type: 'checkbox',
            checked: props.selected,
            'aria-label': tr('selectRow') + ' ' + title,
            onChange: (event) => props.onToggle(row, event),
          }),
        ),
        h(
          'div',
          { className: 'dsam-rowMain' },
          h(
            'div',
            { className: 'dsam-rowTitle' },
            h('span', { className: 'dsam-name', 'data-untitled': untitled ? 'true' : undefined, title }, title),
            h(
              'span',
              { className: 'dsam-tags' },
              row.live ? h(Tag, { tone: 'live' }, tr('live')) : null,
              row.onDisk !== true ? h(Tag, { tone: 'warn' }, tr('missing')) : null,
              row.pinned ? h(Tag, { tone: 'default' }, tr('pinned')) : null,
            ),
          ),
          h(
            'div',
            { className: 'dsam-meta' },
            row.project?.title ? h('span', { className: 'dsam-project', title: row.cwd ?? '' }, row.project.title) : null,
            row.project?.title && row.cwd ? h('span', { className: 'dsam-dot' }) : null,
            h('span', { className: 'dsam-path', title: row.cwd ?? row.directory }, row.cwd ?? row.directory),
          ),
          props.snippet ? h('div', { className: 'dsam-snippet' }, props.snippet) : null,
        ),
        h(
          'div',
          { className: 'dsam-rowEnd' },
          h('span', { className: 'dsam-size', title: tr('sizeHint') }, formatBytes(row.sizeBytes)),
          h('span', { className: 'dsam-time' }, formatTime(row.updatedAt)),
          h(
            'div',
            { className: 'dsam-actions' },
            h(IconButton, {
              name: 'restore',
              label: tr('restore'),
              disabled: props.busy,
              onClick: () => props.onRestore(row),
            }),
            h(IconButton, {
              name: 'trash',
              label: row.deletable ? tr('remove') : row.deleteBlockedMessage ?? tr('remove'),
              danger: true,
              disabled: props.busy || row.deletable !== true,
              onClick: () => props.onRemove(row),
            }),
          ),
        ),
      )
    }

    /**
     * Render the placeholder rows shown before the first snapshot arrives.
     *
     * @returns a list of skeleton rows.
     */
    function SkeletonList() {
      const widths = ['46%', '58%', '38%', '52%', '44%', '60%']
      return h(
        'ul',
        { className: 'dsam-list', 'aria-hidden': 'true' },
        widths.map((width, index) =>
          h(
            'li',
            { className: 'dsam-skelRow', key: String(index) },
            h('span', { className: 'dsam-skel', style: { width: '14px', height: '14px', flex: 'none' } }),
            h(
              'span',
              { style: { flex: '1', display: 'flex', flexDirection: 'column', gap: '6px' } },
              h('span', { className: 'dsam-skel', style: { width } }),
              h('span', { className: 'dsam-skel', style: { width: '30%', height: '10px' } }),
            ),
            h('span', { className: 'dsam-skel', style: { width: '52px' } }),
          ),
        ),
      )
    }

    /**
     * Render the confirmation dialog for a permanent deletion.
     *
     * @param props - the rows, the busy flag, and the handlers.
     * @returns the overlay element, or null when closed.
     */
    function ConfirmDialog(props) {
      const cancelRef = useRef(null)
      useEffect(() => {
        if (!props.open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            props.onCancel()
          }
        }
        window.addEventListener('keydown', onKeyDown)
        if (cancelRef.current !== null) cancelRef.current.focus()
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [props.open, props.onCancel])
      if (!props.open) return null
      const rows = props.rows
      const shown = rows.slice(0, 8)
      return h(
        'div',
        {
          className: 'dsam-overlay',
          role: 'presentation',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && !props.busy) props.onCancel()
          },
        },
        h(
          'div',
          { className: 'dsam-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('confirmTitle', { n: rows.length }) },
          h('h2', { className: 'dsam-dialogTitle' }, tr('confirmTitle', { n: rows.length })),
          h('p', { className: 'dsam-dialogBody' }, tr('confirmBody')),
          h(
            'ul',
            { className: 'dsam-dialogList', 'aria-label': tr('confirmList') },
            shown.map((row) =>
              h(
                'li',
                { className: 'dsam-dialogItem', key: row.id },
                h('span', { className: 'dsam-dialogItemName' }, row.title || tr('untitled')),
                h('span', { className: 'dsam-dialogItemMeta' }, formatBytes(row.sizeBytes)),
              ),
            ),
            rows.length > shown.length ? h('li', { className: 'dsam-dialogMore' }, tr('confirmMore', { n: rows.length - shown.length })) : null,
          ),
          h(
            'div',
            { className: 'dsam-dialogActions' },
            h('button', { type: 'button', className: 'dsam-btn', ref: cancelRef, disabled: props.busy, onClick: props.onCancel }, tr('confirmCancel')),
            h('button', { type: 'button', className: 'dsam-btn', 'data-variant': 'danger', disabled: props.busy, onClick: props.onConfirm }, props.busy ? tr('deleting') : tr('confirmAccept')),
          ),
        ),
      )
    }

    /**
     * Render the transient result notice.
     *
     * @param props - the notice and its dismiss handler.
     * @returns the notice element, or null.
     */
    function Notice(props) {
      if (props.notice === null) return null
      const notice = props.notice
      return h(
        'div',
        { className: 'dsam-notice', role: 'status', 'aria-live': 'polite' },
        h(
          'div',
          { className: 'dsam-noticeBody', 'data-tone': notice.tone },
          h(Icon, { name: notice.tone === 'error' ? 'alert' : 'check', size: 18 }),
          h(
            'div',
            { className: 'dsam-noticeText' },
            h('span', null, notice.text),
            notice.lines !== undefined && notice.lines.length > 0
              ? h('ul', { className: 'dsam-noticeLines' }, notice.lines.map((line, index) => h('li', { key: String(index), title: line }, line)))
              : null,
          ),
          h(IconButton, { name: 'close', label: tr('dismiss'), onClick: props.onDismiss, size: 16 }),
        ),
      )
    }


    // -----------------------------------------------------------------------
    // The page
    // -----------------------------------------------------------------------

    /**
     * The archived-session settings section.
     *
     * @returns the section element.
     */
    function ArchiveSection() {
      const [state, setState] = useState({ phase: 'loading', payload: null, error: null })
      const [refreshing, setRefreshing] = useState(false)
      const [rawQuery, setRawQuery] = useState('')
      const [query, setQuery] = useState('')
      const [filter, setFilter] = useState('all')
      const [sort, setSort] = useState('updated')
      const [selected, setSelected] = useState(() => new Set())
      const [anchor, setAnchor] = useState(null)
      const [limit, setLimit] = useState(PAGE_SIZE)
      const [busy, setBusy] = useState(null)
      const [confirmIds, setConfirmIds] = useState(null)
      const [notice, setNotice] = useState(null)
      const [titleLoading, setTitleLoading] = useState(false)
      const [contentMode, setContentMode] = useState(false)
      const [deep, setDeep] = useState({ query: '', hits: [], scanned: 0, total: 0, done: true, running: false, truncated: false, error: null })
      const deepToken = useRef(0)

      /** Load the snapshot, optionally bypassing the Host's cache. */
      const load = useCallback(async (options) => {
        const refresh = options?.refresh === true
        if (refresh) setRefreshing(true)
        try {
          const payload = await getJson(ROUTE_LIST + (refresh ? '?refresh=1' : ''))
          if (payload.ok !== true) throw new Error(payload.message ?? tr('loadFailed'))
          setState({ phase: 'ready', payload, error: null })
        } catch (error) {
          setState((previous) => ({
            phase: previous.payload === null ? 'error' : 'ready',
            payload: previous.payload,
            error: error?.message ?? String(error),
          }))
        } finally {
          setRefreshing(false)
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      // Typing settles before the in-memory filter runs; nothing leaves the page.
      useEffect(() => {
        if (rawQuery.length === 0) {
          setQuery('')
          return undefined
        }
        const timer = setTimeout(() => setQuery(rawQuery), SEARCH_DEBOUNCE_MS)
        return () => clearTimeout(timer)
      }, [rawQuery])

      useEffect(() => {
        setLimit(PAGE_SIZE)
      }, [query, filter, sort, contentMode, deep.query])

      // A notice is a receipt, not a state: it clears itself.
      useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => setNotice(null), NOTICE_MS)
        return () => clearTimeout(timer)
      }, [notice])

      // Esc means "back out of what I was doing", in that order.
      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          if (confirmIds !== null) return
          if (selected.size > 0) {
            setSelected(new Set())
            return
          }
          if (rawQuery.length > 0) {
            setRawQuery('')
            setContentMode(false)
          }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [confirmIds, selected, rawQuery])

      const payload = state.payload
      const rows = payload?.items ?? []
      const terms = useMemo(() => compileTerms(query), [query])
      const only = useMemo(() => (deep.query.length > 0 && deep.query === query.trim() ? new Set(deep.hits.map((hit) => hit.id)) : null), [deep, query])
      const snippets = useMemo(() => {
        const map = new Map()
        for (const hit of deep.hits) if (typeof hit.snippet === 'string' && hit.snippet.length > 0) map.set(hit.id, hit.snippet)
        return map
      }, [deep.hits])
      const visible = useMemo(() => sortRows(filterRows(rows, { terms, filter, only }), sort), [rows, terms, filter, only, sort])
      const pageRows = useMemo(() => visible.slice(0, limit), [visible, limit])

      const counts = useMemo(() => {
        const result = { all: rows.length, deletable: 0, live: 0, missing: 0 }
        for (const row of rows) {
          if (row.deletable === true) result.deletable += 1
          if (row.live === true) result.live += 1
          if (row.onDisk !== true) result.missing += 1
        }
        return result
      }, [rows])

      // The selection only ever holds sessions that still exist.
      useEffect(() => {
        setSelected((previous) => {
          if (previous.size === 0) return previous
          const known = new Set(rows.map((row) => row.id))
          const next = new Set()
          let dropped = false
          for (const id of previous) {
            if (known.has(id)) next.add(id)
            else dropped = true
          }
          return dropped ? next : previous
        })
      }, [rows])

      // Titles the projection cache could not answer are folded in bounded
      // batches, so the first paint never waits for a log read.
      const generatedAt = payload?.generatedAt
      useEffect(() => {
        if (payload === null) return undefined
        const missing = payload.items.filter((row) => row.titleSource === 'none').map((row) => row.id)
        if (missing.length === 0) {
          setTitleLoading(false)
          return undefined
        }
        let cancelled = false
        const attempted = new Set()
        setTitleLoading(true)
        ;(async () => {
          let pending = missing
          for (let round = 0; round < TITLE_ROUNDS && !cancelled && pending.length > 0; round += 1) {
            const chunk = pending.slice(0, TITLE_BATCH)
            for (const id of chunk) attempted.add(id)
            try {
              const result = await getJson(ROUTE_TITLES + '?ids=' + encodeURIComponent(chunk.join(',')) + '&batch=' + String(TITLE_BATCH))
              if (cancelled) return
              if (result.ok === true) {
                setState((previous) =>
                  previous.payload === null ? previous : { ...previous, payload: applyTitles(previous.payload, result.titles) },
                )
                pending = (result.pending ?? []).filter((id) => !attempted.has(id))
              } else {
                pending = []
              }
            } catch {
              pending = []
            }
          }
          if (!cancelled) setTitleLoading(false)
        })()
        return () => {
          cancelled = true
        }
      }, [payload === null, generatedAt])

      const allSelected = pageRows.length > 0 && pageRows.every((row) => selected.has(row.id))
      const selectionBytes = selectedBytes(rows, selected)
      const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected])
      const confirmRows = useMemo(
        () => (confirmIds === null ? [] : rows.filter((row) => confirmIds.has(row.id))),
        [confirmIds, rows],
      )

      /** Merge one mutation's answer into the page. */
      const applyMutation = useCallback(
        (kind, result) => {
          const summary = result.summary ?? { succeeded: 0, failed: 0, bytes: 0 }
          const failures = (result.results ?? []).filter((entry) => entry.ok !== true)
          const lines = failures.slice(0, 4).map((entry) => {
            const row = rows.find((candidate) => candidate.id === entry.id)
            const name = row?.title || entry.id
            return name + ' — ' + (entry.message || blockReason(entry.code))
          })
          const base = kind === 'restore'
            ? tr('resultRestored', { n: summary.succeeded })
            : tr('resultDeleted', { n: summary.succeeded, size: formatBytes(summary.bytes) })
          setNotice({
            tone: summary.failed > 0 ? 'error' : 'success',
            text: summary.failed > 0 ? base + ' · ' + tr('resultPartial', { ok: summary.succeeded, failed: summary.failed }) : base,
            lines,
          })
          setSelected(new Set())
          setConfirmIds(null)
          if (result.payload !== undefined) setState({ phase: 'ready', payload: result.payload, error: null })
          else load()
        },
        [rows, load],
      )

      /** Restore one or many ids. */
      const restore = useCallback(
        async (ids) => {
          if (ids.length === 0) return
          setBusy({ kind: 'restore' })
          try {
            const result = await postJson(ROUTE_RESTORE, { ids })
            if (result.ok !== true) throw new Error(result.message ?? tr('loadFailed'))
            applyMutation('restore', result)
          } catch (error) {
            setNotice({ tone: 'error', text: error?.message ?? String(error), lines: [] })
          } finally {
            setBusy(null)
          }
        },
        [applyMutation],
      )

      /** Delete the ids the dialog confirmed. */
      const removeConfirmed = useCallback(async () => {
        const ids = confirmIds === null ? [] : [...confirmIds]
        if (ids.length === 0) return
        setBusy({ kind: 'delete' })
        try {
          const result = await postJson(ROUTE_DELETE, { ids, confirm: true })
          if (result.ok !== true) throw new Error(result.message ?? tr('loadFailed'))
          applyMutation('delete', result)
        } catch (error) {
          setNotice({ tone: 'error', text: error?.message ?? String(error), lines: [] })
          setConfirmIds(null)
        } finally {
          setBusy(null)
        }
      }, [confirmIds, applyMutation])

      /** Ask before removing one or many ids. */
      const askRemove = useCallback((ids) => {
        if (ids.length === 0) return
        setConfirmIds(new Set(ids))
      }, [])

      /** Toggle one row, honouring shift for a range. */
      const toggleRow = useCallback(
        (row, event) => {
          setSelected((previous) => {
            if (event?.shiftKey === true && anchor !== null) return selectRange(visible, previous, anchor, row.id)
            const next = new Set(previous)
            if (next.has(row.id)) next.delete(row.id)
            else next.add(row.id)
            return next
          })
          setAnchor(row.id)
        },
        [anchor, visible],
      )

      /** Toggle every visible row. */
      const toggleAll = useCallback(() => {
        setSelected((previous) => {
          const next = new Set(previous)
          if (allSelected) {
            for (const row of pageRows) next.delete(row.id)
          } else {
            for (const row of pageRows) next.add(row.id)
          }
          return next
        })
      }, [allSelected, pageRows])

      /** Scan session logs for the current query, in paged requests. */
      const runDeep = useCallback(async (text) => {
        const trimmed = typeof text === 'string' ? text.trim() : ''
        if (trimmed.length === 0) return
        deepToken.current += 1
        const token = deepToken.current
        const hits = []
        let scanned = 0
        let total = 0
        let done = false
        let truncated = false
        let error = null
        setDeep({ query: trimmed, hits: [], scanned: 0, total: 0, done: false, running: true, truncated: false, error: null })
        while (!done) {
          if (deepToken.current !== token) return
          let result
          try {
            result = await getJson(ROUTE_SEARCH + '?q=' + encodeURIComponent(trimmed) + '&cursor=' + String(scanned))
          } catch (failure) {
            error = failure?.message ?? String(failure)
            break
          }
          if (result.ok !== true) {
            error = result.message ?? tr('contentUnavailable')
            break
          }
          total = result.total ?? total
          scanned = result.nextCursor ?? scanned
          truncated = result.truncated === true
          for (const hit of result.hits ?? []) hits.push(hit)
          done = result.done === true
          if (deepToken.current !== token) return
          setDeep({ query: trimmed, hits: [...hits], scanned, total, done, running: !done, truncated, error: null })
        }
        if (deepToken.current !== token) return
        setDeep({ query: trimmed, hits, scanned, total, done: true, running: false, truncated, error })
      }, [])

      /** Stop a running content scan. */
      const stopDeep = useCallback(() => {
        deepToken.current += 1
        setDeep((previous) => ({ ...previous, running: false, done: true }))
      }, [])

      /** Clear the search box and any content scan. */
      const clearSearch = useCallback(() => {
        setRawQuery('')
        setQuery('')
        setContentMode(false)
        deepToken.current += 1
        setDeep({ query: '', hits: [], scanned: 0, total: 0, done: true, running: false, truncated: false, error: null })
      }, [])

      const onSearchKeyDown = useCallback(
        (event) => {
          if (event.key === 'Enter' && contentMode) {
            event.preventDefault()
            runDeep(rawQuery)
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            clearSearch()
          }
        },
        [contentMode, rawQuery, runDeep, clearSearch],
      )

      const busyNow = busy !== null
      const totals = payload?.totals ?? { archived: 0, onDisk: 0, live: 0, bytes: 0, deletable: 0 }
      const scanning = deep.running
      const deepActive = deep.query.length > 0

      /** The list area: skeleton, error, empty, or rows. */
      let body
      if (state.phase === 'loading') {
        body = h(SkeletonList, null)
      } else if (state.phase === 'error') {
        body = h(
          'div',
          { className: 'dsam-error' },
          h(Icon, { name: 'alert', size: 18 }),
          h('span', { style: { flex: '1', minWidth: '0' } }, tr('loadFailed') + '：' + String(state.error ?? '')),
          h('button', { type: 'button', className: 'dsam-btn', onClick: () => load({ refresh: true }) }, tr('retry')),
        )
      } else if (rows.length === 0) {
        body = h(
          'div',
          { className: 'dsam-empty' },
          h('span', { className: 'dsam-emptyIcon' }, h(Icon, { name: 'archive', size: 28 })),
          h('p', { className: 'dsam-emptyTitle' }, tr('heading')),
          h('p', { className: 'dsam-emptyBody' }, tr('empty')),
        )
      } else if (visible.length === 0) {
        const reason = deepActive ? tr('contentNoHit') : query.length > 0 ? tr('emptySearch') : tr('emptyFilter')
        body = h(
          'div',
          { className: 'dsam-empty' },
          h('span', { className: 'dsam-emptyIcon' }, h(Icon, { name: 'search', size: 28 })),
          h('p', { className: 'dsam-emptyTitle' }, reason),
          h(
            'button',
            {
              type: 'button',
              className: 'dsam-btn',
              'data-variant': 'ghost',
              onClick: () => {
                clearSearch()
                setFilter('all')
              },
            },
            tr('clearFilters'),
          ),
        )
      } else {
        body = h(
          'ul',
          { className: 'dsam-list' },
          pageRows.map((row) =>
            h(Row, {
              key: row.id,
              row,
              selected: selected.has(row.id),
              busy: busyNow,
              snippet: snippets.get(row.id),
              onToggle: toggleRow,
              onRestore: (target) => restore([target.id]),
              onRemove: (target) => askRemove([target.id]),
            }),
          ),
        )
      }

      return h(
        'div',
        { className: 'dsam-section' },
        h('h2', { className: 'dsam-title' }, tr('heading')),
        h('p', { className: 'dsam-intro' }, tr('intro')),
        h(
          'div',
          { className: 'dsam-toolbar' },
            h(
              'div',
              { className: 'dsam-search' },
              h('span', { className: 'dsam-searchIcon' }, h(Icon, { name: 'search', size: 15 })),
              h('input', {
                className: 'dsam-input',
                type: 'search',
                value: rawQuery,
                placeholder: contentMode ? tr('searchContentPlaceholder') : tr('searchPlaceholder'),
                'aria-label': contentMode ? tr('searchContentPlaceholder') : tr('searchPlaceholder'),
                onChange: (event) => setRawQuery(event.target.value),
                onKeyDown: onSearchKeyDown,
              }),
              rawQuery.length > 0
                ? h(
                    'button',
                    { type: 'button', className: 'dsam-clear', 'aria-label': tr('dismiss'), title: tr('dismiss'), onClick: clearSearch },
                    h(Icon, { name: 'close', size: 13 }),
                  )
                : null,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsam-chip',
                'data-active': contentMode ? 'true' : undefined,
                title: tr('contentMode'),
                'aria-pressed': contentMode,
                onClick: () => {
                  const next = !contentMode
                  setContentMode(next)
                  if (!next) {
                    deepToken.current += 1
                    setDeep({ query: '', hits: [], scanned: 0, total: 0, done: true, running: false, truncated: false, error: null })
                  }
                },
              },
              contentMode ? tr('contentModeOn') : tr('contentModeOff'),
            ),
            contentMode && rawQuery.trim().length > 0 && !scanning
              ? h('button', { type: 'button', className: 'dsam-btn', 'data-variant': 'primary', onClick: () => runDeep(rawQuery) }, tr('contentStart'))
              : null,
            scanning ? h('button', { type: 'button', className: 'dsam-btn', onClick: stopDeep }, tr('contentStop')) : null,
            h(IconButton, {
              name: 'refresh',
              label: refreshing ? tr('refreshing') : tr('refresh'),
              disabled: refreshing,
              onClick: () => load({ refresh: true }),
            }),
        ),
        h(
          'div',
          { className: 'dsam-chips', role: 'group', 'aria-label': tr('heading') },
          FILTERS.map((entry) =>
            h(
              'button',
              {
                key: entry.id,
                type: 'button',
                className: 'dsam-chip',
                'data-active': filter === entry.id ? 'true' : undefined,
                'aria-pressed': filter === entry.id,
                onClick: () => setFilter(entry.id),
              },
              tr(entry.label),
              h('span', { className: 'dsam-chipCount' }, String(counts[entry.id] ?? counts.all)),
            ),
          ),
          h(
            'select',
            {
              className: 'dsam-select',
              value: sort,
              'aria-label': tr('sortUpdated'),
              onChange: (event) => setSort(event.target.value),
            },
            SORTS.map((entry) => h('option', { key: entry.id, value: entry.id }, tr(entry.label))),
          ),
        ),
        h(
          'div',
          { className: 'dsam-summary' },
          h('span', null, tr('summary', { n: totals.archived, size: formatBytes(totals.bytes) })),
          h('span', { className: 'dsam-dot' }),
          h('span', null, tr('summaryDeletable', { n: totals.deletable })),
          totals.live > 0 ? h('span', { className: 'dsam-dot' }) : null,
          totals.live > 0 ? h('span', null, tr('summaryLive', { n: totals.live })) : null,
          totals.archived - totals.onDisk > 0 ? h('span', { className: 'dsam-dot' }) : null,
          totals.archived - totals.onDisk > 0 ? h('span', null, tr('summaryMissing', { n: totals.archived - totals.onDisk })) : null,
          titleLoading ? h('span', { className: 'dsam-dot' }) : null,
          titleLoading ? h('span', null, tr('titleLoading')) : null,
        ),
        contentMode && (scanning || deepActive)
          ? h(
              'div',
              { className: 'dsam-progress' },
              h('span', null, scanning ? tr('contentScanning', { done: deep.scanned, total: deep.total || totals.archived }) : tr('contentDone', { total: deep.total || totals.archived, hits: deep.hits.length })),
              h('span', { className: 'dsam-bar' }, h('span', { className: 'dsam-barFill', style: { width: String(deep.total === 0 ? 0 : Math.round((deep.scanned / deep.total) * 100)) + '%' } })),
              deep.truncated && !scanning ? h('button', { type: 'button', className: 'dsam-btn', 'data-variant': 'ghost', onClick: () => runDeep(deep.query) }, tr('contentContinue')) : null,
            )
          : null,
        deep.error !== null ? h('div', { className: 'dsam-error' }, h(Icon, { name: 'alert', size: 18 }), h('span', null, deep.error)) : null,
        rows.length > 0
          ? h(
              'div',
              { className: 'dsam-listHead' },
              h(
                'label',
                { className: 'dsam-check', title: tr('selectAll') },
                h('input', { type: 'checkbox', checked: allSelected, onChange: toggleAll, 'aria-label': tr('selectAll') }),
              ),
              h(
                'span',
                { className: 'dsam-listHeadText' },
                visible.length === rows.length
                  ? tr('sessionCount', { n: rows.length })
                  : tr('sessionCountFiltered', { shown: visible.length, n: rows.length }),
              ),
              h('span', null, tr('sizeHint')),
            )
          : null,
        body,
        visible.length > limit
          ? h(
              'div',
              { style: { display: 'flex', justifyContent: 'center', paddingTop: '8px' } },
              h(
                'button',
                { type: 'button', className: 'dsam-btn', 'data-variant': 'ghost', onClick: () => setLimit(limit + PAGE_SIZE) },
                tr('showMore', { n: visible.length - limit }),
              ),
            )
          : null,
        selected.size > 0
          ? h(
              'div',
              { className: 'dsam-selection', role: 'region', 'aria-label': tr('selected', { n: selected.size }) },
              h(
                'span',
                { className: 'dsam-selectionText' },
                tr('selected', { n: selected.size }),
                h('span', { className: 'dsam-selectionMeta' }, tr('selectedBytes', { size: formatBytes(selectionBytes) })),
              ),
              h(
                'button',
                { type: 'button', className: 'dsam-btn', disabled: busyNow, onClick: () => restore(selectedRows.map((row) => row.id)) },
                busy?.kind === 'restore' ? tr('restoring') : tr('restoreMany'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsam-btn',
                  'data-variant': 'danger',
                  disabled: busyNow || selectedRows.filter((row) => row.deletable === true).length === 0,
                  onClick: () => askRemove(selectedRows.filter((row) => row.deletable === true).map((row) => row.id)),
                },
                tr('removeMany'),
              ),
              h('button', { type: 'button', className: 'dsam-btn', 'data-variant': 'ghost', disabled: busyNow, onClick: () => setSelected(new Set()) }, tr('clearSelection')),
            )
          : null,
        h('p', { className: 'dsam-foot' }, tr('footNote')),
        h(ConfirmDialog, {
          open: confirmIds !== null,
          rows: confirmRows,
          busy: busy?.kind === 'delete',
          onCancel: () => setConfirmIds(null),
          onConfirm: removeConfirmed,
        }),
        h(Notice, { notice, onDismiss: () => setNotice(null) }),
      )
    }

    // -----------------------------------------------------------------------
    // Registration
    // -----------------------------------------------------------------------

    /** Services this client half needs; both are core to the web shell. */
    const inject = ['slots', 'locale']

    /**
     * Register the plugin's dictionary and its one settings section.
     *
     * @param ctx - the client plugin context.
     */
    function apply(ctx) {
      ensureStyle()
      const locale = ctx.get('locale')
      if (locale !== undefined) {
        ctx.effect(() => {
          const off = locale.register(LOCALE_NS, { zh: DICT.zh, en: DICT.en })
          try {
            boundTranslate = locale.bind(LOCALE_NS)
          } catch {
            boundTranslate = undefined
          }
          return () => {
            boundTranslate = undefined
            off()
          }
        }, 'dsh-archive-manager: locale dictionaries')
      }
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          // 100 sorts the row below every shipped page and every other installed
          // plugin (模型 10, 内置插件 15, Agent 预设 20, 用量/悬浮球 25, 插件市场 40),
          // which is where this plugin was asked to sit. The id is the one the
          // shell already maps to its archive glyph, so the nav row needs no icon
          // option (the slot has none).
          { name: 'settings.section', id: SECTION_ID, order: 100, label: () => tr('nav'), locale: LOCALE_NS },
          ArchiveSection,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    /** Pure helpers, exposed so the self-check can hold them to their contract. */
    exports.__test = {
      compileTerms,
      filterRows,
      sortRows,
      selectRange,
      applyTitles,
      selectedBytes,
      formatBytes,
      formatTime,
      rowMatchesQuery,
      rowMatchesFilter,
      blockReason,
      DICT,
    }
    return module.exports
  },
})
