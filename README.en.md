# Archive Manager · dsh-archive-manager

[中文](README.md) | [English](README.en.md)

> A settings-panel plugin for the DeepSeek Harness (DSH) desktop app, version `2.0.0`: it gathers every
> **archived session** on this machine onto one page, lets you multi-select and **restore** sessions back into
> their workspaces, or **delete them permanently** together with their session logs and projection cache, and
> searches titles, projects and paths — optionally across session content. The first paint no longer folds a
> session log.

Archived sessions disappear from the project list, and DSH itself has no UI to manage them. This plugin adds that
page: one row per session with title, project, path, size and last-write time, plus its **Running** / **Archive entry
only** state; select a few rows and restore or delete them as a batch.

| Item | Value |
| --- | --- |
| Package | `@local/dsh-archive-manager` (private; not published to npm) |
| Version | `2.0.0` |
| Verified host | DSH `0.2.1-rc.3` desktop app (Windows, `app.asar`) |
| Location | Settings → **Archived sessions** (`settings.section`, `order: 100`, after every built-in page and other plugin) |
| Plugin row id | `archive-manager` (the `cordis.patch.yml` entry; disabling or reconfiguring targets it) |
| Settings section id | `archived-sessions` (the plugin card is titled "归档会话管理 / Archived sessions") |
| Runtime dependencies | None. The browser half only `require('react')` |
| Build step | None. `index.js`, `client.js` and `lib/*.js` are the artifacts |

## The page

The page is a **flowing block inside the Settings scroll container**: it claims no height and no scrollbar of its
own, its column is capped at 720px, and it scrolls with the panel. Top to bottom:

- **Heading and intro**: one sentence on what Restore and Delete permanently do.
- **Toolbar**: search box, content-search toggle, search / stop, refresh.
- **Status chips**: All / Deletable / Running / Entries only, each with a count; on the right, the sort order
  (Last updated / Created / Size / Title).
- **Summary line**: `N archived sessions · total size`, `N deletable`, `N running`, `N entries only`, plus
  "Reading titles…" while titles are being backfilled.
- **List head**: select-all-for-this-page checkbox, `N sessions` (`hits / total sessions` while filtering), and the
  hint that size and time come from the session log on disk.
- **Each row**:
  - checkbox;
  - title ("(untitled)" when there is none);
  - tags: **Running**, **Archive entry only** (no session directory on disk), **Pinned**;
  - project and path (the project path when the session has a `cwd`, otherwise the session directory shown as
    `$DSH_HOME/…`);
  - size and last-write time ("just now", a relative age within 7 days, a date beyond that);
  - two icon buttons: **Restore** and **Delete permanently** (disabled with an explanation when the row cannot be deleted).
- **Paging**: at most 60 rows per render, with "Show more (N left)" underneath.
- **Selection bar** (only while something is selected, pinned to the bottom): `N selected`, the selected total size,
  **Restore selected**, **Delete selected**, clear selection.
- **Empty and error states**: how to archive a session when there are none, a "Clear filters" action when nothing
  matches, and Retry when the read fails.

## Batch operations

- **Multi-select**: the checkbox toggles one row; <kbd>Shift</kbd>-click selects from the last clicked anchor row to
  the clicked row across the visible list; the list-head select-all applies to **the current page only** (those 60
  rows) and leaves other pages and filtered-out rows alone. The selected total size updates as you go.
- **Batch restore**: every selected id is dropped from the archive set; the notice reports how many succeeded and how
  many failed.
- **Batch delete**: only **deletable** rows go into the confirmation dialog (running sessions, archive-entry-only rows
  and layout mismatches never appear in the list to delete, so they cannot be deleted). The dialog lists the first 8
  sessions with their sizes and folds the rest into "N more not listed"; <kbd>Esc</kbd>, the overlay and Cancel all
  back out.
- **Per-item results**: both batch routes answer per id. The notice names the success count and the freed size, and on
  failure lists up to 4 lines of "title — reason" (for example "The session is running. Close it before deleting." or
  "Its directory is already gone; it can only be dropped from the archive list.").
- **Confirmation is part of the protocol**: `POST /api/archive/delete` requires `confirm: true` in the body and
  refuses the whole batch otherwise (`CONFIRM_REQUIRED`). The dialog is a courtesy; that field is what stops a stray
  POST from erasing sessions.

## Search

**Instant filtering (default, no request)**: typing settles for 140ms and filters the already-loaded snapshot in
memory. Terms are case-insensitive and split on whitespace; **every term must match** (AND), and each term may match a
different field. The fields are title, project, path (the `cwd` or the session directory) and session id. Queries are
capped at 500 characters (the same limit DSH's own session search uses).

**Content search (optional, slower)**: turn on the content-search toggle and press Enter or click Search; the Host then
**scans archived session logs page by page**:

- 8 sessions per page by default (at most 24), with a 2500ms time budget per request (at most 8000ms);
- matching goes through the host's `sessionQuery.filterEvents`, restricted to `user/message` and
  `assistant/message` records on `surface: current`, then matched as literal text;
- a matching session reports its hit count, the `seq` and time of the first hit, and a snippet (highlighted in the
  page); non-matching rows are filtered out while the query is active;
- the progress bar shows "Scanning scanned / total", and Stop cancels immediately; when the budget runs out the page
  offers "Continue searching";
- a session that cannot be read is skipped (`skipped`) instead of aborting the scan; a deployment without
  `sessionQuery` reports "This deployment cannot search session content.";
- turning the toggle off or clearing the box drops the hits and restores the full list.

Content search is the **only** path on this page that opens a session log, so it is explicit, paged and interruptible.

## Performance: two-tier reads and caches

Before 2.0.0 the page folded every session's title out of its log, so on a machine with 162 archived sessions the
first paint opened 162 logs. It now reads in two tiers:

1. **Snapshot tier (all the first paint needs)**: one header listing (`sessionQuery.listSessions`, which merges the
   live store over persistence), one two-level walk of the session root (giving "encoded id → directory", cheaper than
   one derived-path `stat` per row and able to find a session whose directory is not where its header says), and one
   `readdir` plus one `stat` per log file per row (size and mtime). Titles come first from the host's **already
   loaded** projection cache (`sessionProjectionCache.cachedSnapshot` / `cachedPredecessorTitle`) at zero I/O.
   **This tier opens no session log.**
2. **Title tier**: rows the projection cache cannot answer are folded in bounded batches through
   `GET /api/archive/titles` (24 per batch, at most 24 batches per load) and patched into the rows already on screen.
   A cache answer that explicitly says "this session has no title" never triggers a fold; the row shows "(untitled)".

Caches and invalidation:

- header listing and root walk for 15s, the built snapshot for 4s, one directory's file facts for 3s, a folded title
  for 10 minutes;
- every completed batch operation bumps the cache **generation**, so the next read always re-reads instead of painting
  the snapshot from before the operation;
- directory inspection runs 12-wide by default: with hundreds of directories the waits — not the work — are what cost
  seconds, so bounded overlap removes them without letting the handle count run away.

### Configurable settings

Defaults come from `DEFAULTS` in `lib/snapshot.js`:

| Key | Default | Meaning |
| --- | --- | --- |
| `headersTtlMs` | `15000` | How long the header listing and the root walk are reused (ms) |
| `snapshotTtlMs` | `4000` | How long the built snapshot is reused |
| `diskTtlMs` | `3000` | How long one session directory's file facts (size / mtime) are reused |
| `titleTtlMs` | `600000` | How long a folded title is reused (10 minutes) |
| `titleBatchSize` | `24` | How many titles one deep read may fold |
| `titleBudgetMs` | `6000` | Wall-clock budget for one deep title read |
| `concurrency` | `12` | How many session directories are inspected at once |
| `maxBatchSize` | `500` | Hard cap on one batch operation's id count |

Override them by row id in the profile's own `cordis.patch.yml` (normally
`~/.dsh/profiles/<profile name>/cordis.patch.yml`):

```yaml
- id: archive-manager
  config:
    snapshotTtlMs: 8000
    concurrency: 6
```

Two things to know: **this `config` replaces the row's whole config rather than merging key by key**, so keys you do
not write fall back to the defaults above; and the change applies through the loader's config reload — if the page
still shows old data, restart the desktop app.

## Safety boundary

"Delete permanently" is not an API DSH has: the session persistence seam states that nothing deletes session files and
that the seam has no deletion API, and `ctx.workspaceRegistry` only keeps the books. So deletion is a filesystem
operation this plugin performs on **paths it derives itself**, which means the boundary has to be built here.

- **The only input is a session id**, not a path and not a `cwd`; the browser cannot name the file to delete. The
  payload does carry absolute-path fields (`directoryPath`, `homePath`, `sessionsRootPath`), but the page only
  displays the `$DSH_HOME/…` form and those fields **never** take part in the deletion decision.
- **It must be in the archive set**: an id that is not in `workspaceRegistry.archivedSessionIds` is refused
  (`NOT_ARCHIVED`).
- **It must not be live**: a session open in this process is refused (`SESSION_LIVE`), and the page disables its
  delete button.
- **The directory must pass three families of proofs** (`assertDeletableDirectory` in `lib/layout.js`; any failure is
  a refusal, never a best-effort delete):
  1. **Root containment**: the path sits strictly inside `$DSH_HOME/sessions` and is not the root itself
     (`OUTSIDE_ROOT`), and it is exactly the two levels "project / session" (`MISPLACED`).
  2. **Encoded-name equality**: the project directory must equal `projectKey(cwd)` (`PROJECT_MISMATCH`) and the
     session directory must equal `encodeSegment(id)` (`ID_MISMATCH`). Both rules are ported from DSH's own JSONL
     backend, and the encoding is injective, so "does this directory belong to this session?" is a **decidable
     equality**, not a guess.
  3. **A session log must be present**: the directory really has to hold a session log file
     (`NOT_A_SESSION_DIRECTORY`); anything else counts as a directory this plugin does not understand.
- **Files first, archive entry last**: the session directory (with its logs), then the projection-cache file, then the
  archive entry. A failure part-way leaves the session archived and visible to a human; the one case that is reported
  as itself is "files deleted, entry not removed" (`UNARCHIVE_FAILED`: "文件已删除，但归档记录未能移除"), instead of
  pretending the whole batch failed.
- **After a successful deletion** the plugin broadcasts `api-session/removed` so the sidebar drops that row at once.
- **Restore only touches the archive list**: `workspaceRegistry.unarchiveSession(id)` removes the id from the archive
  set and not a byte of logs or cache is touched; the session kept its accounting slot in the workspace all along, so
  it returns to its original project and position.

## HTTP routes

All five routes register on the connection service's shared `/api` channel (`ctx.connection.fetch.register`,
`requestBody: 'buffered'`). That channel owns browser-session authentication and the Host/Origin checks, so this
plugin **always answers HTTP 200** and uses an `ok` discriminator — a domain refusal can never be mistaken for the
channel's own authentication failure. Every response is `cache-control: no-store`.

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/archive/sessions` | `refresh=1` rebuilds instead of reusing the cache; optional `q` (terms ANDed, the same matching rules the page uses) | `ok`, `generatedAt`, `totals{archived,onDisk,live,bytes,deletable}`, `capabilities{batchLimit,titles,contentSearch}`, `items[]`; with `q` the items are filtered and each carries `matched` |
| GET | `/api/archive/titles` | `ids` comma-separated (at most 200); `budgetMs` (default 6000, max 30000); `batch` (default 24) | `ok`, `titles{ id: title or null }`, `pending[]` (not folded yet), `failed[]` (fold rejected); an empty `ids` answers `{ok:false, code:'EMPTY_SELECTION'}` |
| GET | `/api/archive/search` | `q` required; `cursor` (scan position, from 0); `batch` (default 8, max 24); `budgetMs` (default 2500, max 8000) | `hits[{id,count,seq,time,snippet}]`, `skipped[]`, `scanned`, `cursor`, `nextCursor`, `total`, `done`, `truncated`; an empty `q` is `EMPTY_QUERY`, a deployment without `sessionQuery` is `UNAVAILABLE` |
| POST | `/api/archive/restore` | `{ "ids": [...] }` (a legacy `{ "id": "..." }` is accepted too) | `ok`, `results[]` (per-item `ok` or a failure code), `summary{requested,succeeded,failed,bytes}`, `payload` (the refreshed snapshot) |
| POST | `/api/archive/delete` | `{ "ids": [...], "confirm": true }`; `dryRun: true` reports what would be removed without deleting | `ok`, `dryRun`, `results[]`, `summary`, `payload`; without `confirm` the whole batch is `CONFIRM_REQUIRED` |

Failures are `{ ok: false, code, message }`, still with status 200. Request-level codes: `INVALID_BODY`,
`INVALID_IDS`, `EMPTY_SELECTION`, `TOO_MANY_IDS`, `CONFIRM_REQUIRED`, `UNAVAILABLE`, `INTERNAL`. Per-item codes:
`NOT_ARCHIVED`, `LIVE_SESSION`, `NO_HEADER`, `NOT_ON_DISK`, `OUTSIDE_ROOT`, `MISPLACED`, `PROJECT_MISMATCH`,
`ID_MISMATCH`, `NOT_A_SESSION_DIRECTORY`, `REMOVE_FAILED`, `UNARCHIVE_FAILED`, `RESTORE_FAILED`.

## Compatibility

- **Verified on**: DSH `0.2.1-rc.3` desktop app (`app.asar`). The plugin is written against this version's internal
  seams, which are not a public API.
- **Host interfaces it uses**:

  | Interface | Used for |
  | --- | --- |
  | `ctx.connection.fetch.register` | The five `/api/archive/*` routes (`buffered` bodies, `Response` answers) |
  | `ctx.workspaceRegistry` | `archivedSessionIds`, `pinnedSessionIds`, `list()` (projects and their `sessionIds`), `unarchiveSession(id)` |
  | `ctx.sessionQuery` | `listSessions()` (headers with live sessions merged in), `readTitleSnapshots(ids, signal)` (title folding), `filterEvents(id, filters)` (content search) |
  | `ctx.sessionProjectionCache` | `cachedSnapshot(header)` / `cachedPredecessorTitle(header)`: the zero-I/O title source for the first paint |
  | `ctx.get('sessions').list()` | The authoritative answer for "which sessions run in this process", asked even when the header listing was cached |

  `ctx.sessionPersistence.list()` remains as a fallback when `listSessions` is unavailable, and
  `ctx.emit('api-session/removed', id)` drives the sidebar refresh.
- **Dependencies**: no third-party runtime dependencies. `package.json` declares only the `@deepseek-ai/cordis` peer
  (`^4.0.1`) and `engines.node >= 20`; there is no build step, no bundler, and no official client package is
  `require`d (the page styles itself with `--dsw-*` theme tokens only).
- **Version range**: `package.json` declares no `engines.dsh`, so the plugin page will not gate a version mismatch
  for you — confirm compatibility yourself after upgrading DSH.

## Install

Install the DSH desktop app first ([deepseek.com/download](https://www.deepseek.com/download/)). This plugin is a
standard DSH bundle: `package.json` declares `dsh.bundle.patch` and `dsh.client`, so installing it into any profile
takes the same path.

### 1. The official DSH desktop app (recommended)

1. Open the DSH desktop app → **插件 / Plugins** in the sidebar (Settings leads to the same page);
2. Click **「添加插件」 / Add plugin** in the top right; the Add plugin dialog opens right away. The chevron button
   beside it is **「选择添加插件方式」 / Choose how to add a plugin**, and its **「安装第三方插件」 / Install a third-party
   plugin** entry is the one that says "Supports npm packages, Git repositories, and local directories";
3. In **Package name or address**, enter this repository's address or a local directory path. The dialog's helper text
   reads "Enter the plugin's package name, GitHub repository address, or local directory path."; the **install source**
   selector next to it defaults to **中国大陆镜像源 / mainland China mirror**, and the install guide below expands for
   examples:
   - `https://github.com/linanbuan/dsh-archive-manager`
   - or the absolute path of a directory already cloned on this machine (see the offline case below);
4. Click **「安装」 / Install**: it shows "正在准备安装… / preparing the install…", then finishes on a dialog titled
   **「已安装」 / Installed** listing the package name, version `2.0.0` and the description, with an
   **「立即启用」 / Enable now** button. There is no second Install confirmation;
5. The plugin row then appears under **已安装插件 / Installed plugins** with its switch on, and Settings → **Archived
   sessions** is available in the same session. If the UI does ask you to restart (for example, 归档会话 / Archived
   sessions does not show up in the client right away), **restart the desktop app instead of refreshing the page**.

**Behind a restricted network**: if the page reports "Cannot access GitHub" or "GitHub connection timed out" (it offers
"Try another way" and "Use mainland China mirror", and the install-source selector can point at another registry), you
can also clone the repository locally and enter the **absolute directory path** in Package name or address:

```bash
git clone https://github.com/linanbuan/dsh-archive-manager.git
```

### 2. Command line (optional)

What the plugin page does is equivalent to one `dsh plugin` call, written `dsh plugin add <spec>`.
**Use your own version's dsh CLI help as the authority** (`dsh plugin --help`); this page does not list unverified
arguments. In `0.2.1-rc.3`, `dsh plugin` forwards its arguments to pnpm inside the profile directory, so the form that
names a profile is:

```bash
dsh plugin --profile <profile name> add <spec>
```

`<spec>` is whatever you would put in Package name or address. Note that the desktop profile is owned by Electron and
the npm CLI refuses plugin management for it — desktop users should use option 1.

### 3. Manual install (not recommended)

The manual path does exist: register this directory in the profile's `dsh.profile.bundles` and install the
dependencies. That is exactly what the official plugin manager does for you, and hand-editing profile files can break
the profile and stop the Harness from booting — use option 1 (the Plugins page) instead of editing configuration files.

## Updating and uninstalling

- **Update**: through the Plugins page — **uninstall**, then install the new version (the page says the same for other
  plugins: uninstall before reinstalling).
- **Uninstall**: Plugins page → this plugin → **Uninstall**; it removes the package from the profile's dependencies and
  from `dsh.profile.bundles`.
- **After a DSH upgrade, if the plugin misbehaves**: check version compatibility first. It rides on
  `0.2.1-rc.3` internals, and a host rename or reshape can break it; when that happens the page degrades to an error
  notice or an empty list and never stops the Harness itself from booting.

## Caveats

1. **Not an official plugin**: no affiliation with DeepSeek AI and no support commitment.
2. **There is no recycle bin**: that is what "permanent" means; neither the plugin nor the Harness has a recovery entry
   point. Make sure the sessions are no longer needed.
3. **A running session cannot be deleted**: it may still be writing. Close it (or restart the app) first; the page
   marks those rows "Running" and disables the delete button.
4. **Only this machine's `$DSH_HOME` is affected**: deletion is a local filesystem operation; nothing syncs to other
   devices and nothing in the cloud is touched.
5. **Archive entries and logs can drift**: if an entry has no log left (cleaned by another tool, or a different
   machine), the page still lists it as "Archive entry only" and lets you drop it from the archive list without
   deleting any file.
6. **A missing title is only a degradation**: a damaged log, a fold timeout or a projection-cache miss only makes that
   row show "(untitled)" for a while; restore and delete are unaffected.
7. **Permissions**: deletion uses the Harness process's own filesystem permissions. If `$DSH_HOME` needs elevation,
   deletion fails with `EACCES`/`EPERM` and the plugin reports it instead of pretending to succeed.
8. **Platform**: anything DSH runs on (Windows / macOS / Linux). The path derivation has cases for Windows `C:\…`
   cwds and for Chinese and space-containing directory names.
9. **Privacy**: the plugin has no network access and no telemetry and reports no session content; it only reads local
   files and Harness's own services on the host side. The repository contains no credentials, session content or
   personal absolute paths.

## Self-check

```bash
node test/selfcheck.mjs      # or pnpm test
```

The self-check needs no network, no Harness and no React: the host half runs real create/delete/restore flows inside a
temporary `$DSH_HOME`, with the five routes served by a fake harness (archive set, session headers, projection cache,
`filterEvents`); the browser half registers through a stub `window.__ModuleLoader__` and then asserts the `__test`
helpers the page exports (filtering, sorting, range selection, byte totals, dictionary key parity).

**Current state (measured 2026-10-24)**: `node test/selfcheck.mjs` → `50 checks, 0 failed`, exit code 0.

What it does *not* cover, stated plainly: **real rendering** (no React runtime, so hooks and the DOM are not driven —
click flows are asserted against the exported helpers), real Harness services, the `sessionPersistence` fallback when
`sessionQuery` is unmounted (only the search route's `UNAVAILABLE` is asserted), and TTL expiry (only reuse *inside*
the TTL is asserted).

## Repository layout

```
package.json          bundle manifest (dsh.bundle.patch + dsh.client), no runtime dependencies
cordis.patch.yml      one insert: mounts the host half (row id: archive-manager)
index.js              host half: the five /api/archive/* routes
lib/snapshot.js       two-tier snapshot, caches with generation invalidation, config defaults
lib/ops.js            batch restore / batch delete, per-item results and archive accounting
lib/search.js         matching rules (terms ANDed, case-insensitive, snippet extraction)
lib/concurrency.js    bounded concurrency (mapLimit / settleLimit)
lib/layout.js         ported session-storage layout: projectKey / encodeSegment / path proof
client.js             browser half: the settings.section page (hand-written lazy CJS, react only)
locale/{zh,en}.json   plugin card copy
docs/项目日志.md       engineering log (Chinese): problem, research, changes, trade-offs, verification
test/selfcheck.mjs    self-check
icon.svg              plugin icon
```

## Credits and third-party licences

- It uses only Harness's own seams (`connection`, `workspaceRegistry`, `sessionQuery`, `sessionProjectionCache`,
  `sessions`) and Node built-ins; no third-party plugin code was copied or adapted.
- The session-storage layout (project keys and the encoded id segment) was reimplemented from the behaviour of DSH's
  own JSONL backend as interface compatibility; it contains no copy of official code.
- The page styles itself with theme tokens and its own controls and does not `require` any official client package.

## License

[MIT](LICENSE) © 2026 linanbuan
