# 归档会话管理 · dsh-archive-manager

[中文](README.md) | [English](README.en.md)

> DeepSeek Harness（DSH）桌面端的设置面板插件：把本机所有**已归档会话**集中到一页，
> 逐条**复原回工作区**，或连同会话日志与投影缓存**永久删除**。

已归档的会话从项目列表里消失，而 DSH 没有任何界面管理它们。这个插件补上那一页：
每条会话给出标题、所属项目、占用大小、创建与最后写入时间、它在磁盘上的位置，
以及两个动作 —— 复原回工作区，或从磁盘上永久删除。

- 位置：**设置 → 归档会话管理**（排在所有内置页面与其它插件之后，`settings.section` 的 `order: 100`）
- 行 id：`archive-manager`
- 依赖：无（零运行时依赖，浏览器半部只 `require('react')`）

## 页面内容

- 顶部统计：已归档 / 可删除 / 运行中 / 磁盘占用 / 数据时间。
- 每一条会话：会话标题、所属项目、占用大小、创建时间、最后写入时间、磁盘目录（`~/.dsh/...` 形式）。
- 每条的按钮：**复原回工作区** 与 **永久删除**（行内二次确认，不是弹窗）。
- 操作结果条：列出本次真正被移除的路径，而不是只说「已删除」。

## 两个操作的确切含义

| 操作 | 做了什么 | 能撤销吗 |
| --- | --- | --- |
| 复原回工作区 | 调用 `ctx.workspaceRegistry.unarchiveSession(id)`：把该 id 从归档集合移除。会话一直保留着它在工作区里的记账槽位，所以它会回到原来的项目与位置。 | 可以再归档回去 |
| 永久删除 | ① 删除会话日志目录 `~/.dsh/sessions/<项目键>/<会话 id>/`；② 删除投影缓存 `~/.dsh/storages/session_projcache/sessions/<会话 id>.json`；③ 调用 `unarchiveSession(id)` 归位记账，并广播 `api-session/removed` 让侧栏立刻收起该行。 | **不能**。Harness 没有任何恢复入口 |

## 为什么删除必须由本插件自己做

DSH 的会话存储接缝是**故意不可寻址**的：`ctx.sessionPersistence` 的快照只给 header 与不透明的 revision，不给文件路径，也没有任何删除方法；`ctx.workspaceRegistry` 的文档写明 "Removal never deletes data"。所以「永久删除」不是一个已存在的 API，而是本插件在**自己推导出的路径**上执行的文件系统操作。

这意味着安全边界必须自己建立。本插件的做法：

- 唯一输入是**会话 id**，不是路径、不是 cwd。浏览器无法指定要删的文件。
- 路径由 [lib/layout.js](lib/layout.js) 按 DSH 自带 JSONL 后端**同一套规则**推导：`projectKey(cwd)` 与 `encodeSegment(id)`，并用本机真实的项目目录名核对过（见 [test/selfcheck.mjs](test/selfcheck.mjs)）。
- 删除前逐条证明，任何一条不成立就**拒绝**（返回业务错误码，不删任何东西）：
  1. 该 id 必须在归档集合中（`NOT_ARCHIVED`）；
  2. 该会话不能仍在本进程打开或运行（`SESSION_LIVE`）；
  3. 路径必须严格位于 `$DSH_HOME/sessions` 之内（`OUTSIDE_ROOT`）；
  4. 路径必须恰好是「项目层/会话层」两级（`MISPLACED`）；
  5. 两级目录名必须等于由该会话 header 推导出的名字（`PROJECT_MISMATCH` / `ID_MISMATCH`）；
  6. 目录里必须真的有会话日志文件（`NOT_A_SESSION_DIRECTORY`）——否则按「看不懂的目录」处理。
- 归档集合的记账在最后一步才更新：中途失败时该会话仍然是「已归档」，不会从界面上凭空消失。

## 数据来源

| 用途 | 来源 |
| --- | --- |
| 有哪些已归档会话 | `ctx.workspaceRegistry.archivedSessionIds`（`~/.dsh/storages/workspace.json`） |
| 会话 header（`cwd` / `createdAt`） | `ctx.sessionPersistence.list()` + `ctx.get('sessions').list()` |
| 标题 | `ctx.sessionQuery.readTitleSnapshots(ids)`：每项 `value.title` 是折叠快照 `{ title, messageSeqs, source, eventSeq, updatedAt }`，本插件取它的 `title` 字段（逐会话失败隔离；12s 超时后本页仍返回，只是没有标题） |
| 所属项目 | `ctx.workspaceRegistry.list()` 的实体；缺失时退回 header 的 `cwd` 末段 |
| 大小 / 最后写入 / 是否在磁盘上 | 插件自己 stat 会话目录里的 `session*.jsonl(.zstd)` |

页面上显示的路径一律是 `~/.dsh/...` 或 `$DSH_HOME/...` 形式（与 `dsh-home-paths` 的展示约定一致），不把本机绝对路径送给浏览器。

## 安装

本插件是一个标准 DSH bundle：`package.json` 里声明了 `dsh.bundle.patch` 与 `dsh.client`，装进任何 profile 都走同一条路。先装好 DSH 桌面端（[deepseek.com/download](https://www.deepseek.com/download/)），然后下面任选一种。

### 方式一 · 在 DSH 桌面端里装（推荐）

1. 侧栏点 **插件** → **添加插件**（Add plugin）；
2. 在输入框里填下面任意一种 spec：
   - 本仓库地址：`https://github.com/linanbuan/dsh-archive-manager`
   - 本仓库的压缩包链接（GitHub 页面的 `Source code (zip)`）
   - 已经克隆到本机的**目录绝对路径**
   - 包名（若将来发布到 npm）
3. 点 **安装**：Harness 先读出这个 spec 指向什么（包名、简介、版本），确认后开始装；
4. 装完点 **立即启用**。

整个安装由 Harness 自己的插件管理器完成：把这个包写进当前 profile 的 `dsh.profile.bundles`，并挂上宿主半边。**桌面端装插件不需要命令行，也不需要手改 profile 文件。**

### 方式二 · 让 Agent 自己装

把仓库地址或本机目录直接交给任意会话里的 Agent，它会调用 `plugin_manager` 工具（`action: install_bundle`）走同一条路。这是官方给第三方插件推荐的安装方式。

### 方式三 · 命令行

装了 dsh CLI 的机器上：

```bash
dsh plugin --profile <profile 名> add <spec>
```

`<spec>` 与方式一相同（包名、Git 地址、压缩包链接或本地路径）；参数以 `dsh plugin --help` 的实际输出为准。

### 方式四 · 手工装进某个 profile（排障用，不推荐）

profile 目录默认在 `~/.dsh/profiles/<profile 名>`。把包放进去，并在 profile 自己的 `package.json` 里登记两处：

```json
"dependencies": { "@local/dsh-archive-manager": "link:<本目录绝对路径>" },
"dsh": { "profile": { "bundles": [ "…", "@local/dsh-archive-manager" ] } }
```

手改 profile 文件要过权限审批，写坏会让 Harness 起不来，所以正常安装请走前面三种。

## 装上之后

- **浏览器半边**：注册 `settings.section` 页面，随启动图加载；由 HMR 更新时不需要刷新页面。
- **宿主半边**：注册三条 `/api/archive/*` 路由。安装时若提示需要重启，**重启 DeepSeek Harness 应用**（不是刷新页面）—— 桌面 profile 的 base 组合包以 `root: []` 启用 HMR（只监听显式注册的配置），而 HMR 的忽略规则默认含 `**/node_modules`，装在 `node_modules` 下的插件代码不在监听范围内。
- **确认它在跑**：侧栏 **插件** → 找到这个包，看组件状态是否为「运行中」。

### 停用 / 卸载

临时关掉（在 profile 自己的 `cordis.patch.yml` 里，或直接用插件页那一行的开关）：

```yaml
- id: archive-manager
  disabled: true
```

彻底移除：插件页 → 这个包 → **卸载**，它会把包从 profile 的依赖与 `dsh.profile.bundles` 里去掉。

## 注意事项

1. **本插件不是官方插件**：与 DeepSeek AI 无任何关联，不提供服务承诺。它跟随 Harness 的插件接缝工作，Harness 升级后可能失效；失效时页面会以错误码或空列表的形式退化，不会影响 Harness 本身启动。实测环境是 DSH `0.1.7-rc.2` 桌面版（Windows）：它依赖的 `connection` / `workspaceRegistry` / `sessionPersistence` / `sessionQuery` / `sessions` 都是内部实现，不是稳定 API，换版本后可能改名或改形。
2. **运行中的会话不能永久删除**：它可能还有正在写入的内容。先关闭该会话（或重启应用）再删。界面会把这类行标出「运行中」并禁用删除按钮。
3. **删除没有回收站**：这就是「永久」的含义，插件与 Harness 都没有恢复入口。删之前请确认这些会话不再需要。
4. **只影响本机这一份 `$DSH_HOME`**：删除是本机文件系统操作，不会同步到其它设备，也不会动云端的任何东西。
5. **安装后不会自动更新**：官方插件管理器目前不支持自动更新，升级＝先卸载再装新版。手动替换已安装的包之后，宿主半边要**重启应用**才会加载新代码（Node 的 ESM 缓存按文件 URL 命中，停用再启用只会重跑旧模块的 `apply()`）。
6. **归档记录与日志可能不同步**：若某条归档记录已经没有对应日志（被其它工具清过、或换过机器），本页仍会列出它，标「仅归档记录」，并允许把它从归档列表里移除（不删任何文件）。
7. **标题依赖会话日志折叠**：日志损坏或超时只会让该行退化成「（无标题）」，不影响复原与删除。
8. **权限**：删除走的是 Harness 进程自己的文件系统权限。若 `$DSH_HOME` 放在需要提权的目录下（例如以管理员身份运行的应用、被安全软件锁定的目录），删除可能以 `EACCES`/`EPERM` 失败 —— 此时插件如实报错，不会假装成功。
9. **平台**：只要 DSH 能跑（Windows / macOS / Linux）即可用。路径推导对 Windows 的 `C:\…` cwd、中文与空格目录名都有对应用例。
10. **隐私**：插件不联网、无遥测，不上报任何会话内容；它只在 Host 侧读本机文件与 Harness 自己的服务，浏览器半边拿到的只是这一页要显示的数据。本仓库自身也不含凭据、会话内容或个人绝对路径 —— 示例路径都已泛化。

## 自检

```bash
node test/selfcheck.mjs      # 或 pnpm test
```

自检不需要网络、不需要 Harness、不需要 React：Host 半边在临时 `$DSH_HOME` 里跑真实的建目录 / 删目录流程，浏览器半边在一个 stub `window.__ModuleLoader__` 里完成注册，最后一节用一个最小 hook 运行时**真的驱动页面**（渲染 → 跑 effect → 点按钮 → 再渲染）。它覆盖 19 项，全部通过时打印 `19/19 checks passed` 并以 0 退出，任何一项失败就以非 0 退出（可直接接 CI）。覆盖内容包括：

- `projectKey` / `encodeSegment` 对真实目录名的还原（含中文与空格转义）；
- 六条删除前置条件都会拒绝：`OUTSIDE_ROOT` / `MISPLACED` / `PROJECT_MISMATCH` / `ID_MISMATCH` 在路由上按构造不可达，由路由直接调用同一个判定函数来验证；「拒绝时目录原封不动」的断言落在路由层那三条（`NOT_ARCHIVED` / `SESSION_LIVE` / `NOT_A_SESSION_DIRECTORY`）上；
- 正常删除确实同时移除了日志目录、投影缓存与归档条目；
- 复原不动日志、只动归档集合；
- 畸形请求体、缺少注册表的组合等边界；
- 客户端只 `require('react')`、样式只装一次、`settings.section` 注册为 `order: 100`、zh/en 字典键一致；
- 按下某一行的「复原回工作区」后，POST body 里是该行的 id（而不是 `{}`），随后列表按新快照少一行、结果条写着标题；
- 一行拿不到 id 时只在页面内提示，绝不向 Host 发空 body；
- 按 `dsh-client-connection` 的 bridge 形态发 POST（`Buffer` 请求体 + `application/json; charset=utf-8`）时 id 不丢；
- `{ id: undefined }`（客户端旧缺陷的产物）会得到字面量 `缺少会话 id。`。

它**不能**证明的部分：自检跑在桩上下文上，不是真的 Harness —— `/api` 通道的会话鉴权与 Host/Origin 检查、真实 `sessionQuery` 的折叠口径、真实 `settings.section` 的渲染与样式回落，都不在覆盖范围内；删除只在临时 `$DSH_HOME` 里发生，没有在真实 profile 上跑过。

## 结构

```
package.json         bundle 清单（dsh.bundle.patch + dsh.client）
cordis.patch.yml     一行 insert：装载 Host 半边
index.js             Host 半边：三条 /api/archive/* 路由与全部安全判定
client.js            浏览器半边：settings.section 页面（手写 lazy CJS，只用 react）
lib/layout.js        DSH 会话存储布局的移植（projectKey / encodeSegment / 路径推导）
locale/{zh,en}.json  插件卡片文案
icon.svg             插件图标
test/selfcheck.mjs   自检
```

## 致谢与第三方许可

- 本插件只使用 Harness 自己的公开接缝（`connection`、`workspaceRegistry`、`sessionPersistence`、`sessionQuery`、`sessions`）与 Node 内置模块，**没有复制或改编任何第三方插件的代码**。
- 会话存储布局的规则（项目键与 id 分段的编码方式）是照着 DSH 自带 JSONL 后端的行为重新实现的，属于与官方实现的接口兼容，不包含官方代码副本；官方包许可为 MIT。
- 页面样式只用主题令牌（`--dsw-*`）与自绘控件，没有 `require` 官方客户端包，也不需要它们的代码。

## License

[MIT](LICENSE) © 2026 linanbuan
