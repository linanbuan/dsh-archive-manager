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
 * 账号与余额 / 通用设置 / 模型 / 内置插件 pages use, and reads its data from its own
 * three authenticated `/api/archive/*` routes. Every destructive decision — which
 * directory belongs to a session, whether it may be removed, whether the session
 * is still live — is made on the Host; this half only renders the answer and asks.
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
    const { useCallback, useEffect, useMemo, useState } = React
    const h = React.createElement

    /** Settings section id. */
    const SECTION_ID = 'archive-manager'

    /** Locale namespace this bundle registers its dictionary under. */
    const LOCALE_NS = 'archiveManager'

    /** The route that answers the archive list. */
    const ROUTE_LIST = '/api/archive/sessions'

    /** The route that drops one id from the archive set. */
    const ROUTE_RESTORE = '/api/archive/restore'

    /** The route that removes one session's artifacts and drops its id. */
    const ROUTE_DELETE = '/api/archive/delete'

    /**
     * How long one request may take. Listing folds titles across every archived
     * session on the Host, which is the only slow part of this page.
     */
    const REQUEST_TIMEOUT_MS = 45_000

    // -----------------------------------------------------------------------
    // Copy
    // -----------------------------------------------------------------------

    const DICT = {
      zh: {
        nav: '归档会话管理',
        heading: '归档会话管理',
        subtitle: '已归档的会话不会出现在项目列表里。这里可以把它们复原回工作区，或从磁盘上永久删除。',
        refresh: '刷新',
        refreshing: '刷新中',
        retry: '重试',
        loading: '正在读取归档会话…',
        loadFailed: '读取失败',
        unavailable: '本组合未挂载工作区注册表，无法管理归档会话。',
        empty: '还没有已归档的会话。在侧栏的会话菜单里选择“归档会话”，它就会出现在这里。',
        archived: '已归档',
        running: '运行中',
        onDisk: '磁盘上',
        missing: '仅归档记录',
        restore: '复原回工作区',
        restoring: '复原中…',
        remove: '永久删除',
        restoreTitle: '复原',
        deleteTitle: '永久删除',
        confirmDelete: '确认永久删除？',
        confirmDeleteHint: '日志文件与归档记录都会被移除，无法恢复。',
        cancel: '取消',
        confirm: '确认删除',
        deleting: '删除中…',
        restored: '已复原回工作区：',
        deleted: '已永久删除：',
        removedPaths: '已移除',
        notes: '说明',
        noTitle: '（无标题）',
        ungrouped: '未归属工作区',
        dismiss: '知道了',
        blockLive: '仍在本进程中打开或运行，关闭它之后才能永久删除。',
        blockNoArtifact: '磁盘上已没有它的日志目录，只能从归档列表里移除。',
        blockNotArchived: '它已不在归档列表中，请刷新后重试。',
        blockLayout: '磁盘上的目录结构与预期不符，为避免误删已拒绝操作。',
        badTarget: '这一行没有可用的会话 id，请刷新后重试。',
        created: '创建',
        lastWrite: '最后写入',
        size: '占用',
        summaryArchived: '已归档',
        summaryDeletable: '可删除',
        summaryLive: '运行中',
        summarySize: '磁盘占用',
        statsAt: '数据时间',
        rootLabel: '会话目录',
        sizeHint: '大小与最后写入时间来自磁盘上的会话日志。',
        footNote: '复原只把会话移出归档列表，回到它原来的工作区；永久删除会同时删掉会话日志与投影缓存，Harness 无法恢复。',
      },
      en: {
        nav: 'Archived sessions',
        heading: 'Archived sessions',
        subtitle: 'Archived sessions stay out of the project list. Restore one back into its workspace, or delete it from disk for good.',
        refresh: 'Refresh',
        refreshing: 'Refreshing',
        retry: 'Retry',
        loading: 'Reading archived sessions…',
        loadFailed: 'Read failed',
        unavailable: 'This composition mounts no workspace registry, so archived sessions cannot be managed.',
        empty: 'No archived sessions yet. Choose “Archive session” in the sidebar menu and it appears here.',
        archived: 'Archived',
        running: 'Running',
        onDisk: 'On disk',
        missing: 'Archive entry only',
        restore: 'Restore to workspace',
        restoring: 'Restoring…',
        remove: 'Delete permanently',
        restoreTitle: 'Restore',
        deleteTitle: 'Delete permanently',
        confirmDelete: 'Delete permanently?',
        confirmDeleteHint: 'The log files and the archive entry are removed. This cannot be undone.',
        cancel: 'Cancel',
        confirm: 'Delete',
        deleting: 'Deleting…',
        restored: 'Restored to its workspace: ',
        deleted: 'Deleted permanently: ',
        removedPaths: 'Removed',
        notes: 'Notes',
        noTitle: '(untitled)',
        ungrouped: 'No workspace',
        dismiss: 'Dismiss',
        blockLive: 'Open or running in this process. Close it before deleting.',
        blockNoArtifact: 'Its log directory is already gone; it can only be dropped from the archive list.',
        blockNotArchived: 'It is no longer in the archive list. Refresh and try again.',
        blockLayout: 'The on-disk layout does not match the expected shape, so nothing was removed.',
        badTarget: 'This row carries no usable session id. Refresh and try again.',
        created: 'Created',
        lastWrite: 'Last write',
        size: 'Size',
        summaryArchived: 'Archived',
        summaryDeletable: 'Deletable',
        summaryLive: 'Running',
        summarySize: 'On disk',
        statsAt: 'Data as of',
        rootLabel: 'Session store',
        sizeHint: 'Size and last-write time come from the session log on disk.',
        footNote: 'Restoring only drops the session from the archive list, returning it to its workspace. Permanent deletion removes the session log and its projection cache; the Harness cannot restore it.',
      },
    }

    /** Live binder for the locale service; replaced when the service appears. */
    let translate
    const localeRef = { current: undefined }

    /**
     * Translate one key, falling back to the Chinese dictionary and then to the
     * key itself so a missing dictionary can never blank a control.
     *
     * @param {string} key
     * @param {any} [params]
     * @returns {string}
     */
    function tr(key, params) {
      const bound = translate
      if (bound !== undefined) {
        try {
          const value = bound(key, params)
          if (typeof value === 'string' && value.length > 0) return value
        } catch {
          /* an unbound or removed namespace falls through to the source copy */
        }
      }
      const fallback = DICT.zh[key]
      if (typeof fallback === 'string') return fallback
      return key
    }

    // -----------------------------------------------------------------------
    // Formatting
    // -----------------------------------------------------------------------

    /**
     * Human byte size with the binary units this application's own surfaces use.
     *
     * @param {number} bytes
     * @returns {string}
     */
    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let value = bytes
      let unit = 0
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
      }
      const digits = unit === 0 ? 0 : value < 10 ? 1 : value < 100 ? 1 : 0
      return `${value.toFixed(digits)} ${units[unit]}`
    }

    /**
     * A local timestamp for one millisecond value.
     *
     * @param {number} value
     * @returns {string}
     */
    function formatTime(value) {
      if (typeof value !== 'number' || value <= 0) return '—'
      try {
        return new Intl.DateTimeFormat(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(value))
      } catch {
        return new Date(value).toLocaleString()
      }
    }

    /**
     * The heading a row is recognised by when it carries no folded title.
     *
     * @param {any} item
     * @returns {string}
     */
    function rowHeading(item) {
      if (typeof item.title === 'string' && item.title.trim().length > 0) return item.title
      return tr('noTitle')
    }

    /**
     * The project a row belongs to, from its workspace record or its own cwd.
     *
     * @param {any} item
     * @returns {string}
     */
    function projectLabel(item) {
      if (item.workspace !== null && item.workspace !== undefined) {
        const title = item.workspace.title
        if (typeof title === 'string' && title.length > 0) return title
        if (typeof item.workspace.path === 'string' && item.workspace.path.length > 0) return item.workspace.path
      }
      if (typeof item.cwd === 'string' && item.cwd.length > 0) {
        const parts = item.cwd.split(/[\\/]/).filter((part) => part.length > 0)
        return parts.length > 0 ? parts[parts.length - 1] : item.cwd
      }
      return tr('ungrouped')
    }

    /**
     * Localized copy for a Host refusal.
     *
     * The Host names the reason with a code and its own sentence; the page words
     * the codes it knows itself and falls back to the Host's sentence, so an
     * unfamiliar refusal is still shown verbatim rather than swallowed.
     *
     * @param {any} blocked
     * @returns {string}
     */
    function blockCopy(blocked) {
      if (blocked === null || blocked === undefined) return ''
      const key = blocked.code === 'SESSION_LIVE'
        ? 'blockLive'
        : blocked.code === 'NO_ARTIFACT'
          ? 'blockNoArtifact'
          : blocked.code === 'NOT_ARCHIVED'
            ? 'blockNotArchived'
            : 'blockLayout'
      return `${blocked.code} · ${tr(key)}`
    }

    // -----------------------------------------------------------------------
    // Host calls
    // -----------------------------------------------------------------------

    /**
     * Call one of the plugin's own routes.
     *
     * @param {string} path
     * @param {{ method?: string, body?: any }} [options]
     * @returns {Promise<any>}
     */
    async function call(path, options = {}) {
      const response = await fetch(path, {
        method: options.method ?? 'GET',
        credentials: 'include',
        headers: options.body === undefined ? {} : { 'content-type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) {
        const failure = new Error(`HTTP ${response.status}`)
        failure.status = response.status
        throw failure
      }
      return await response.json()
    }

    // -----------------------------------------------------------------------
    // Page
    // -----------------------------------------------------------------------

    /** The section component registered into `settings.section`. */
    function ArchiveSection() {
      const [phase, setPhase] = useState('loading')
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [busyId, setBusyId] = useState(null)
      const [confirmId, setConfirmId] = useState(null)
      const [notice, setNotice] = useState(null)

      const load = useCallback(async () => {
        setPhase('loading')
        setError(null)
        try {
          const payload = await call(ROUTE_LIST)
          if (payload.ok !== true) {
            setError(payload.message ?? payload.code ?? tr('loadFailed'))
            setData(payload.snapshot ?? null)
            setPhase('failed')
            return
          }
          setData(payload)
          setPhase('ready')
        } catch (failure) {
          setError(failure?.status === 401 ? 'HTTP 401' : String(failure?.message ?? failure))
          setPhase('failed')
        }
      }, [])

      useEffect(() => {
        void load()
      }, [load])

      useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => setNotice(null), 12_000)
        return () => clearTimeout(timer)
      }, [notice])

      const act = useCallback(async (kind, item) => {
        const id = typeof item === 'string' ? item : item?.id
        if (typeof id !== 'string' || id.length === 0) {
          setNotice({ tone: 'warn', text: tr('badTarget'), paths: [], notes: [] })
          return
        }
        const target = typeof item === 'string' ? { id, title: null } : item
        setBusyId(id)
        try {
          const path = kind === 'restore' ? ROUTE_RESTORE : ROUTE_DELETE
          const payload = await call(path, { method: 'POST', body: { id } })
          if (payload?.snapshot?.ok === true) {
            setData(payload.snapshot)
            setPhase('ready')
          }
          if (payload?.ok === true) {
            setConfirmId(null)
            setNotice({
              tone: 'ok',
              text: `${kind === 'restore' ? tr('restored') : tr('deleted')}${rowHeading(target)}`,
              paths: Array.isArray(payload.removed) ? payload.removed : [],
              notes: Array.isArray(payload.notes) ? payload.notes : [],
            })
          } else {
            setNotice({ tone: 'warn', text: payload?.message ?? payload?.code ?? tr('loadFailed'), paths: [], notes: [] })
          }
        } catch (failure) {
          setNotice({ tone: 'warn', text: String(failure?.message ?? failure), paths: [], notes: [] })
        } finally {
          setBusyId(null)
        }
      }, [])

      const totals = data?.totals
      const items = useMemo(() => (Array.isArray(data?.items) ? data.items : []), [data])

      return h(
        'div',
        { className: 'dsam-root' },
        h(
          'header',
          { className: 'dsam-head' },
          h(
            'div',
            { className: 'dsam-headText' },
            h('h2', { className: 'dsam-title' }, tr('heading')),
            h('p', { className: 'dsam-sub' }, tr('subtitle')),
          ),
          h(
            'button',
            {
              className: 'dsam-button',
              type: 'button',
              onClick: () => void load(),
              disabled: phase === 'loading',
            },
            phase === 'loading' ? tr('refreshing') : tr('refresh'),
          ),
        ),

        totals === undefined || totals === null
          ? null
          : h(
              'div',
              { className: 'dsam-summary' },
              stat(tr('summaryArchived'), String(totals.archived ?? items.length)),
              stat(tr('summaryDeletable'), String(totals.deletable ?? 0)),
              (totals.live ?? 0) > 0 ? stat(tr('summaryLive'), String(totals.live), 'warn') : null,
              stat(tr('summarySize'), formatBytes(totals.bytes ?? 0)),
              h('span', { className: 'dsam-summaryTime' }, `${tr('statsAt')} ${formatTime(data?.generatedAt)}`),
            ),

        notice === null ? null : noticeCard(notice, () => setNotice(null)),

        phase === 'loading' && data === null
          ? h(
              'div',
              { className: 'dsam-card' },
              h('div', { className: 'dsam-skel' }),
              h('div', { className: 'dsam-skel dsam-skelShort' }),
              h('p', { className: 'dsam-hint' }, tr('loading')),
            )
          : null,

        phase === 'failed'
          ? h(
              'div',
              { className: 'dsam-card dsam-cardWarn' },
              h('h3', { className: 'dsam-cardTitle' }, tr('loadFailed')),
              h('p', { className: 'dsam-hint' }, error ?? ''),
              h(
                'div',
                { className: 'dsam-rowActions' },
                h('button', { className: 'dsam-button', type: 'button', onClick: () => void load() }, tr('retry')),
              ),
            )
          : null,

        phase !== 'failed' && items.length === 0 && data !== null
          ? h('div', { className: 'dsam-card' }, h('p', { className: 'dsam-hint' }, tr('empty')))
          : null,

        items.length === 0
          ? null
          : h(
              'ul',
              { className: 'dsam-list' },
              items.map((item) =>
                row(item, {
                  busyId,
                  confirmId,
                  setConfirmId,
                  act,
                }),
              ),
            ),

        h(
          'p',
          { className: 'dsam-foot' },
          `${tr('footNote')}${data?.sessionsRoot === undefined ? '' : ` ${tr('rootLabel')}: ${data.sessionsRoot}`}`,
        ),
      )
    }

    /**
     * One summary statistic.
     *
     * @param {string} label
     * @param {string} value
     * @param {string} [tone]
     * @returns {any}
     */
    function stat(label, value, tone) {
      return h(
        'span',
        { className: tone === undefined ? 'dsam-stat' : `dsam-stat dsam-stat-${tone}` },
        h('span', { className: 'dsam-statLabel' }, label),
        h('span', { className: 'dsam-statValue' }, value),
      )
    }

    /**
     * The result banner for the last action, including every path the Host named.
     *
     * @param {any} notice
     * @param {() => void} dismiss
     * @returns {any}
     */
    function noticeCard(notice, dismiss) {
      const warn = notice.tone === 'warn'
      return h(
        'div',
        { className: warn ? 'dsam-card dsam-cardWarn' : 'dsam-card dsam-cardOk' },
        h('div', { className: 'dsam-noticeHead' }, h('strong', null, notice.text)),
        notice.paths.length === 0
          ? null
          : h(
              'div',
              null,
              h('div', { className: 'dsam-statLabel' }, tr('removedPaths')),
              h(
                'ul',
                { className: 'dsam-paths' },
                notice.paths.map((path, index) => h('li', { key: `path-${index}` }, h('code', null, path))),
              ),
            ),
        notice.notes.length === 0
          ? null
          : h(
              'div',
              null,
              h('div', { className: 'dsam-statLabel' }, tr('notes')),
              h(
                'ul',
                { className: 'dsam-paths' },
                notice.notes.map((note, index) => h('li', { key: `note-${index}` }, note)),
              ),
            ),
        h(
          'div',
          { className: 'dsam-rowActions' },
          h('button', { className: 'dsam-button', type: 'button', onClick: dismiss }, tr('dismiss')),
        ),
      )
    }

    /**
     * One archived session.
     *
     * @param {any} item
     * @param {any} wiring
     * @returns {any}
     */
    function row(item, wiring) {
      const { busyId, confirmId, setConfirmId, act } = wiring
      const busy = busyId === item.id
      const confirming = confirmId === item.id
      const blocked = item.deleteBlockedBy
      const canDelete = item.deletable === true && !busy

      return h(
        'li',
        { className: confirming ? 'dsam-row dsam-rowConfirming' : 'dsam-row', key: item.id },
        h(
          'div',
          { className: 'dsam-rowMain' },
          h(
            'div',
            { className: 'dsam-rowHead' },
            h('span', { className: 'dsam-rowTitle', title: item.title ?? item.id }, rowHeading(item)),
            h('span', { className: 'dsam-badge' }, tr('archived')),
            item.live === true ? h('span', { className: 'dsam-badge dsam-badgeWarn' }, tr('running')) : null,
            item.onDisk === true ? null : h('span', { className: 'dsam-badge dsam-badgeMuted' }, tr('missing')),
          ),
          h(
            'div',
            { className: 'dsam-rowMeta' },
            h('span', { className: 'dsam-project' }, projectLabel(item)),
            h('span', { className: 'dsam-dot' }),
            h('span', null, `${tr('size')} ${formatBytes(item.sizeBytes)}`),
            h('span', { className: 'dsam-dot' }),
            h('span', null, `${tr('created')} ${formatTime(item.createdAt)}`),
            h('span', { className: 'dsam-dot' }),
            h('span', null, `${tr('lastWrite')} ${formatTime(item.updatedAt)}`),
          ),
          h('div', { className: 'dsam-rowPath', title: item.directory ?? '' }, item.directory ?? item.id),
          blocked === null || blocked === undefined
            ? null
            : h('div', { className: 'dsam-blocked' }, blockCopy(blocked)),
        ),
        h(
          'div',
          { className: 'dsam-rowActions' },
          confirming
            ? [
                h('span', { className: 'dsam-confirmText', key: 'ask' }, h('strong', null, tr('confirmDelete')), h('span', null, tr('confirmDeleteHint'))),
                h(
                  'button',
                  { className: 'dsam-button', type: 'button', key: 'cancel', onClick: () => setConfirmId(null), disabled: busy },
                  tr('cancel'),
                ),
                h(
                  'button',
                  { className: 'dsam-button dsam-buttonDanger', type: 'button', key: 'go', onClick: () => void act('delete', item), disabled: busy },
                  busy ? tr('deleting') : tr('confirm'),
                ),
              ]
            : [
                h(
                  'button',
                  {
                    className: 'dsam-button',
                    type: 'button',
                    key: 'restore',
                    onClick: () => void act('restore', item),
                    disabled: busy,
                    title: tr('restoreTitle'),
                  },
                  busy ? tr('restoring') : tr('restore'),
                ),
                h(
                  'button',
                  {
                    className: 'dsam-button dsam-buttonDanger',
                    type: 'button',
                    key: 'delete',
                    onClick: () => setConfirmId(item.id),
                    disabled: !canDelete,
                    title: blocked === null || blocked === undefined ? tr('deleteTitle') : blockCopy(blocked),
                  },
                  tr('remove'),
                ),
              ],
        ),
      )
    }

    // -----------------------------------------------------------------------
    // Styles
    // -----------------------------------------------------------------------

    const CSS = `
.dsam-root{display:flex;flex-direction:column;gap:14px;padding:2px 0 18px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,currentColor)}
.dsam-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.dsam-headText{display:flex;flex-direction:column;gap:4px;min-width:0}
.dsam-title{margin:0;font-size:15px;font-weight:600;line-height:22px}
.dsam-sub{margin:0;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.9}
.dsam-summary{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 18px;font-size:11px;color:var(--dsw-alias-label-secondary,currentColor)}
.dsam-stat{display:inline-flex;align-items:baseline;gap:6px}
.dsam-statValue{font-size:13px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,currentColor)}
.dsam-stat-warn .dsam-statValue{color:var(--dsw-alias-state-warn-primary,currentColor)}
.dsam-summaryTime{margin-left:auto;opacity:.75}
.dsam-card{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));border-radius:12px;padding:13px 15px;background:var(--dsw-alias-bg-layer-2,transparent);display:flex;flex-direction:column;gap:8px;min-width:0}
.dsam-cardWarn{border-color:var(--dsw-alias-state-warn-primary,rgba(210,153,34,.5))}
.dsam-cardOk{border-color:var(--dsw-alias-state-success-primary,rgba(63,185,80,.45))}
.dsam-cardTitle{margin:0;font-size:13px;font-weight:600;line-height:20px}
.dsam-hint{margin:0;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.85}
.dsam-noticeHead{display:flex;align-items:baseline;gap:8px;font-size:12px}
.dsam-paths{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--dsw-alias-label-secondary,currentColor)}
.dsam-paths code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;word-break:break-all}
.dsam-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
.dsam-row{box-sizing:border-box;display:flex;align-items:flex-start;justify-content:space-between;gap:14px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));border-radius:12px;padding:11px 14px;background:var(--dsw-alias-bg-layer-2,transparent);min-width:0}
.dsam-rowConfirming{border-color:var(--dsw-alias-state-error-primary,rgba(229,83,75,.55));background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.06))}
.dsam-rowMain{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1 1 auto}
.dsam-rowHead{display:flex;flex-wrap:wrap;align-items:center;gap:7px;min-width:0}
.dsam-rowTitle{font-size:13px;font-weight:600;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46ch}
.dsam-badge{display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));font-size:10px;line-height:1;color:var(--dsw-alias-label-secondary,currentColor);opacity:.9}
.dsam-badgeWarn{border-color:var(--dsw-alias-state-warn-primary,rgba(210,153,34,.55));color:var(--dsw-alias-state-warn-primary,currentColor)}
.dsam-badgeMuted{opacity:.6}
.dsam-rowMeta{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.9}
.dsam-project{color:var(--dsw-alias-label-primary,currentColor);opacity:.95}
.dsam-dot{width:3px;height:3px;border-radius:999px;background:currentColor;opacity:.5;align-self:center}
.dsam-rowPath{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;line-height:15px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.7;word-break:break-all}
.dsam-blocked{font-size:10px;line-height:15px;color:var(--dsw-alias-state-warn-primary,currentColor);opacity:.9}
.dsam-rowActions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;flex:0 0 auto;max-width:46%}
.dsam-confirmText{display:flex;flex-direction:column;gap:2px;font-size:11px;line-height:16px;text-align:right;color:var(--dsw-alias-label-secondary,currentColor)}
.dsam-confirmText span{opacity:.85}
.dsam-button{box-sizing:border-box;height:28px;padding:0 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dsam-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.12))}
.dsam-button:disabled{opacity:.5;cursor:not-allowed}
.dsam-buttonDanger{border-color:var(--dsw-alias-state-error-primary,rgba(229,83,75,.55));color:var(--dsw-alias-state-error-primary,#e5534b)}
.dsam-buttonDanger:hover:not(:disabled){background:var(--dsw-alias-state-error-primary,rgba(229,83,75,.14))}
.dsam-skel{height:16px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.16))}
.dsam-skelShort{width:55%}
.dsam-foot{margin:0;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.75}
.dsam-navItem{display:inline-flex;align-items:center;gap:8px;min-width:0}
.dsam-navText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsam-navIcon{flex:none;width:16px;height:16px}
/* The nav row belongs to the shell, which draws its own fallback glyph from the
   section id; it steps aside while the label beside it carries ours. */
button:has(.dsam-navItem)>svg{display:none}
`

    /** Stylesheet identity used to install the plugin's CSS exactly once. */
    const STYLE_ID = '@local/dsh-archive-manager/client.css'

    /** Install the plugin stylesheet into the document head once. */
    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = '@local/dsh-archive-manager'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /**
     * The settings navigation label, with its own glyph.
     *
     * `settings.section` registrations carry no icon option, and the shell draws
     * a default gear for an id it does not know, so the icon travels inside the
     * label.
     *
     * @returns {any}
     */
    function navLabel() {
      return h(
        'span',
        { className: 'dsam-navItem' },
        h(
          'svg',
          {
            className: 'dsam-navIcon',
            viewBox: '0 0 16 16',
            width: 16,
            height: 16,
            'aria-hidden': 'true',
            focusable: 'false',
          },
          h('rect', { x: 1.5, y: 2.5, width: 13, height: 3, rx: 1, fill: 'currentColor', opacity: 0.9 }),
          h('rect', { x: 1.5, y: 6.6, width: 13, height: 6.9, rx: 1.4, fill: 'currentColor', opacity: 0.35 }),
          h('rect', { x: 5.6, y: 8.1, width: 4.8, height: 1.7, rx: 0.85, fill: 'currentColor' }),
        ),
        h('span', { className: 'dsam-navText' }, tr('nav')),
      )
    }

    /** Namespaces this client half needs; both are core to the web shell. */
    const inject = ['slots']

    /**
     * Register the plugin's dictionary and its one settings section.
     *
     * @param {any} ctx client plugin context.
     */
    function apply(ctx) {
      ensureStyle()
      const locale = ctx.get('locale')
      localeRef.current = locale
      if (locale !== undefined) {
        ctx.effect(() => {
          const offZh = locale.register(LOCALE_NS, 'zh', DICT.zh)
          const offEn = locale.register(LOCALE_NS, 'en', DICT.en)
          try {
            translate = locale.bind(LOCALE_NS)
          } catch {
            translate = undefined
          }
          return () => {
            translate = undefined
            offZh()
            offEn()
          }
        }, 'dsh-archive-manager: locale dictionaries')
      }
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          // 100 sorts the row below every shipped page and every other installed
          // plugin (模型 10, 内置插件 15, 外观 15, Agent 预设 20, 用量/悬浮球 25,
          // 插件市场 40), which is where this plugin was asked to sit.
          { name: 'settings.section', id: SECTION_ID, order: 100, label: navLabel },
          ArchiveSection,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
