# Archived sessions · dsh-archive-manager

[中文](README.md) | [English](README.en.md)

> A settings-panel plugin for the DeepSeek Harness (DSH) desktop app: it gathers every **archived session**
> on this machine onto one page, and lets you **restore it into its workspace** or **delete it permanently**
> together with its session log and projection cache.

Archived sessions disappear from the project list, and DSH has no UI at all to manage them. This plugin adds
that page: every session gets a title, the project it belongs to, the space it takes, when it was created and
last written, where it lives on disk, and two actions — restore into its workspace, or delete permanently from disk.

- Location: **设置** (Settings) → **归档会话管理** (Archived sessions) — after every built-in page and other plugin, `settings.section` with `order: 100`
- Row id: `archive-manager`
- Dependencies: none (zero runtime dependencies; the browser half only `require('react')`)

## What it shows

- Top statistics: Archived / Deletable / Running / On disk / Data as of.
- Each session: title, project, size, created time, last write time, disk directory (in `~/.dsh/...` form).
- Buttons on each row: **Restore to workspace** and **Delete permanently** (inline second confirmation, not a modal).
- Result bar: lists the paths this run actually removed, instead of only saying "deleted".

## Exactly what the two actions do

| Action | What it does | Can it be undone? |
| --- | --- | --- |
| Restore into its workspace | Calls `ctx.workspaceRegistry.unarchiveSession(id)`: removes that id from the archived set. The session kept its accounting slot in the workspace all along, so it returns to its original project and position. | It can be archived again |
| Delete permanently | ① Deletes the session log directory `~/.dsh/sessions/<project key>/<session id>/`; ② deletes the projection cache `~/.dsh/storages/session_projcache/sessions/<session id>.json`; ③ calls `unarchiveSession(id)` to settle the accounting, and broadcasts `api-session/removed` so the sidebar drops that row immediately. | **No.** The Harness has no recovery entry point |

## Why the deletion has to be done by this plugin itself

DSH's session-storage seam is **deliberately non-addressable**: a snapshot from `ctx.sessionPersistence` gives only the header and an opaque revision, never a file path, and it has no delete method at all; the `ctx.workspaceRegistry` documentation states outright that "Removal never deletes data". So "delete permanently" is not an API that already exists — it is a filesystem operation this plugin performs on **paths it derives itself**.

Which means the safety boundary has to be built here as well. How this plugin does it:

- The only input is a **session id**, not a path and not a cwd. The browser cannot name the file to delete.
- Paths are derived by [lib/layout.js](lib/layout.js) with **the same rules** as DSH's own JSONL backend: `projectKey(cwd)` and `encodeSegment(id)` — checked against the real project directory names on this machine (see [test/selfcheck.mjs](test/selfcheck.mjs)).
- Before deleting, every condition below is proved one by one; if any one of them fails the request is **refused** (a business error code comes back, nothing is deleted):
  1. the id must be in the archived set (`NOT_ARCHIVED`);
  2. the session must not still be open or running in this process (`SESSION_LIVE`);
  3. the path must sit strictly inside `$DSH_HOME/sessions` (`OUTSIDE_ROOT`);
  4. the path must be exactly two levels, "project level / session level" (`MISPLACED`);
  5. both directory names must equal the names derived from that session's header (`PROJECT_MISMATCH` / `ID_MISMATCH`);
  6. the directory must really contain a session log file (`NOT_A_SESSION_DIRECTORY`) — otherwise it is treated as "a directory it does not understand".
- The archived set is updated only in the last step: if the operation fails midway, the session is still "archived" and does not vanish from the UI out of nowhere.

## Where the data comes from

| Purpose | Source |
| --- | --- |
| Which sessions are archived | `ctx.workspaceRegistry.archivedSessionIds` (`~/.dsh/storages/workspace.json`) |
| Session header (`cwd` / `createdAt`) | `ctx.sessionPersistence.list()` + `ctx.get('sessions').list()` |
| Title | `ctx.sessionQuery.readTitleSnapshots(ids)`: each entry's `value.title` is a folded snapshot `{ title, messageSeqs, source, eventSeq, updatedAt }`, and this plugin reads its `title` field (failures are isolated per session; after the 12s timeout the page still returns, just without titles) |
| Project | the entity from `ctx.workspaceRegistry.list()`; when it is missing, falls back to the last segment of the header's `cwd` |
| Size / last write / present on disk | the plugin stats `session*.jsonl(.zstd)` inside the session directory itself |

Every path shown on the page is in `~/.dsh/...` or `$DSH_HOME/...` form (matching the display convention of `dsh-home-paths`); no absolute path from this machine is handed to the browser.

## Install

This plugin is a standard DSH bundle: `package.json` declares `dsh.bundle.patch` and `dsh.client`, and installing it into any profile takes the same path. Install the DSH desktop app first ([deepseek.com/download](https://www.deepseek.com/download/)), then pick any one of the options below.

### Option 1 · Install inside the DSH desktop app (recommended)

1. In the sidebar click **插件** (Plugins) → **添加插件** (Add plugin);
2. In the input box, enter any one of these specs:
   - this repository's URL: `https://github.com/linanbuan/dsh-archive-manager`
   - the archive link of this repository (the `Source code (zip)` entry on the GitHub page)
   - the **absolute path of the directory**, if it is already cloned on this machine
   - the package name (if it is ever published to npm)
3. Click **安装** (Install): the Harness first reads out what the spec points at (package name, description, version), and installs once you confirm;
4. When it is done, click **立即启用** (Enable now).

The whole install is done by the Harness's own plugin manager: it writes this package into the current profile's `dsh.profile.bundles` and mounts the host half. **Installing a plugin from the desktop app needs no command line, and no hand-editing of profile files.**

### Option 2 · Let the Agent install it

Hand the repository URL or the local directory to the Agent in any session; it calls the `plugin_manager` tool (`action: install_bundle`) and takes the same path. This is the installation method the official docs recommend for third-party plugins.

### Option 3 · Command line

On a machine with the dsh CLI installed:

```bash
dsh plugin --profile <profile name> add <spec>
```

`<spec>` is the same as in option 1 (package name, Git URL, archive link, or local path); for the flags, the actual output of `dsh plugin --help` is what counts.

### Option 4 · Install into a profile by hand (for troubleshooting, not recommended)

The profile directory defaults to `~/.dsh/profiles/<profile name>`. Put the package there and register it in the profile's own `package.json` in two places:

```json
"dependencies": { "@local/dsh-archive-manager": "link:<absolute path of this directory>" },
"dsh": { "profile": { "bundles": [ "…", "@local/dsh-archive-manager" ] } }
```

Hand-editing profile files goes through a permission approval, and a bad edit keeps the Harness from starting, so for normal installs use one of the first three options.

## After it is installed

- **Browser half**: registers the `settings.section` page, loaded with the boot graph; an HMR update needs no page refresh.
- **Host half**: registers the three `/api/archive/*` routes. If the install says a restart is needed, **restart the DeepSeek Harness app** (not the page) — the desktop profile's base bundle enables HMR with `root: []` (it watches only explicitly registered config), and the HMR ignore rules include `**/node_modules` by default, so plugin code installed under `node_modules` is outside what is watched.
- **Confirm it is running**: sidebar **插件** (Plugins) → find this package and check whether the component status is 运行中 (Running).

### Disable / uninstall

To switch it off temporarily (in the profile's own `cordis.patch.yml`, or with the toggle on that row of the plugin page):

```yaml
- id: archive-manager
  disabled: true
```

To remove it for good: plugin page → this package → **卸载** (Uninstall); that drops the package from the profile's dependencies and from `dsh.profile.bundles`.

## Caveats

1. **This plugin is not an official plugin**: it has no affiliation with DeepSeek AI and comes with no service commitment. It works against the Harness's plugin seams and may stop working after a Harness upgrade; when it does, the page degrades into error codes or an empty list, and the Harness itself still starts. It was tested against DSH `0.1.7-rc.2` desktop on Windows: the `connection` / `workspaceRegistry` / `sessionPersistence` / `sessionQuery` / `sessions` seams it uses are internal implementation, not a stable API, and can be renamed or reshaped by another version.
2. **A running session cannot be deleted permanently**: it may still have content being written. Close that session first (or restart the app), then delete. The UI marks such rows "Running" and disables the delete button.
3. **Deleting has no recycle bin**: that is what "permanent" means — neither the plugin nor the Harness has a recovery entry point. Before deleting, make sure those sessions are no longer needed.
4. **It only affects this machine's copy of `$DSH_HOME`**: the deletion is a local filesystem operation; it does not sync to other devices and does not touch anything in the cloud.
5. **No automatic updates after install**: the official plugin manager does not support automatic updates yet, so upgrading means uninstalling first and installing the new version. After replacing an installed package by hand, the host half needs an **app restart** to load the new code (Node's ESM cache is keyed by file URL, so disabling and re-enabling only re-runs the old module's `apply()`).
6. **An archive record and its log can drift apart**: if an archived record no longer has a matching log (wiped by another tool, or the machine changed), this page still lists it, marks it "Archive entry only", and lets you remove it from the archive list (deleting no files).
7. **Titles depend on folding the session log**: a corrupt log or a timeout only degrades that row to "(untitled)" and does not affect restore or delete.
8. **Permissions**: the deletion runs under the Harness process's own filesystem permissions. If `$DSH_HOME` sits in a directory that needs elevation (for example, an app running as administrator, or a directory locked by security software), the delete can fail with `EACCES`/`EPERM` — in that case the plugin reports the error as it is and does not pretend the delete succeeded.
9. **Platforms**: it works wherever the Harness runs (Windows / macOS / Linux). Path derivation has cases for Windows `C:\…` cwds, Chinese directory names, and directory names with spaces.
10. **Privacy**: the plugin does not go online and has no telemetry, and it reports no session content anywhere; it reads local files and the Harness's own services on the Host side only, and the browser half receives nothing but the data this page has to show. The repository itself carries no credentials, no session content, and no personal absolute path — every example path in it is genericised.

## Self-check

```bash
node test/selfcheck.mjs      # or pnpm test
```

The self-check needs no network, no Harness, and no React: the Host half runs a real create-directory / delete-directory flow in a temporary `$DSH_HOME`, the browser half registers itself inside a stub `window.__ModuleLoader__`, and the last section **really drives the page** with a minimal hook runtime (render → run effects → click a button → render again). It covers 19 checks: when all of them pass it prints `19/19 checks passed` and exits 0, and any single failure exits non-zero (so it can be wired straight into CI). What it covers:

- `projectKey` / `encodeSegment` round-tripping real directory names (including Chinese and space escapes);
- all six delete preconditions refusing: `OUTSIDE_ROOT` / `MISPLACED` / `PROJECT_MISMATCH` / `ID_MISMATCH` cannot be reached through the route by construction, so the route's own guard is called directly to verify them, and the assertion that "a refusal leaves the directory untouched" lands on the three route-level refusals (`NOT_ARCHIVED` / `SESSION_LIVE` / `NOT_A_SESSION_DIRECTORY`);
- a normal delete really removing the log directory, the projection cache, and the archive entry together;
- restore leaving the log untouched and touching only the archived set;
- boundaries such as malformed request bodies and compositions with no registry;
- the client only ever `require('react')`, styles being installed once, `settings.section` registered with `order: 100`, and identical zh/en dictionary keys;
- after clicking "Restore to workspace" on one row, the POST body carrying that row's id (not `{}`), and the list then being one row shorter from the new snapshot with the result bar naming the title;
- a row that cannot get an id being reported inside the page only, and never sending an empty body to the Host;
- the id surviving a POST sent in the `dsh-client-connection` bridge shape (`Buffer` body + `application/json; charset=utf-8`);
- `{ id: undefined }` (a leftover of an old client defect) getting back the literal `缺少会话 id。`.

What it does **not** prove: the self-check runs against stub contexts, not a real Harness — the `/api` channel's session authentication and Host/Origin checks, the real `sessionQuery` folding rules, and the real `settings.section` rendering and style fallback are all outside its coverage; and the deletion only ever happens in a temporary `$DSH_HOME`, never against a real profile.

## Layout

```
package.json         bundle manifest (dsh.bundle.patch + dsh.client)
cordis.patch.yml     one insert row: mounts the Host half
index.js             Host half: the three /api/archive/* routes and every safety decision
client.js            browser half: the settings.section page (hand-written lazy CJS, react only)
lib/layout.js        a port of the DSH session storage layout (projectKey / encodeSegment / path derivation)
locale/{zh,en}.json  plugin card text
icon.svg             plugin icon
test/selfcheck.mjs   self-check
```

## Credits and third-party licenses

- This plugin uses only the Harness's own public seams (`connection`, `workspaceRegistry`, `sessionPersistence`, `sessionQuery`, `sessions`) and Node built-in modules, and **copies or adapts no third-party plugin code**.
- The session storage layout rules (how project keys and id segments are encoded) are re-implemented against the behaviour of DSH's own JSONL backend; that is interface compatibility with the official implementation and contains no copy of official code. The official package is licensed MIT.
- The page's styling uses only theme tokens (`--dsw-*`) and hand-drawn controls; it does not `require` the official client packages and does not need their code.

## License

[MIT](LICENSE) © 2026 linanbuan
