# 归档会话管理 · dsh-archive-manager

[中文](README.md) | [English](README.en.md)

> DeepSeek Harness（DSH）桌面端的设置面板插件，版本 `2.0.0`：把本机所有**已归档会话**集中到一页，
> 多选后批量**复原**回工作区，或连同会话日志与投影缓存**永久删除**；按标题、项目、路径搜索，
> 需要时再按需搜索会话内容。首屏不再为每一行折叠会话日志。

已归档的会话会从项目列表里消失，而 DSH 本身没有管理它们的界面。本插件补上这一页：一行一个会话，
给出标题、所属项目、路径、体积、最近写入时间，以及「运行中 / 仅归档记录」状态；选中若干行即可批量复原或批量删除。

| 项目 | 值 |
| --- | --- |
| 包名 | `@local/dsh-archive-manager`（私有包，未发布到 npm） |
| 版本 | `2.0.0` |
| 实测宿主 | DSH `0.2.1-rc.3` 桌面版（Windows，`app.asar`） |
| 位置 | 设置 → **归档会话**（`settings.section`，`order: 100`，排在所有内置页面与其它插件之后） |
| 插件行 id | `archive-manager`（`cordis.patch.yml` 里的条目，停用或改配置都按它定位） |
| 设置页 section id | `archived-sessions`（插件卡片标题是「归档会话管理」） |
| 运行时依赖 | 无。浏览器半部只 `require('react')` |
| 构建步骤 | 无。`index.js` / `client.js` / `lib/*.js` 就是全部产物 |

## 页面

页面是设置面板滚动容器里的一个**流式区块**：不自带高度、不抢滚动条，列宽上限 720px，随设置面板一起滚动。
从上到下：

- **标题与说明**：一句话讲清「复原」与「永久删除」的区别。
- **工具条**：搜索框、内容搜索开关、开始/停止、刷新按钮。
- **状态筛选**：全部 / 可删除 / 运行中 / 仅记录，各带计数；右侧是排序（最近更新 / 创建时间 / 体积 / 标题）。
- **统计行**：`N 个归档会话 · 总体积`、`可删除 N`、`运行中 N`、`仅记录 N`；还有标题在补时显示「正在读取标题…」。
- **列表头**：全选当前页的复选框、`N 个会话`（筛选时是 `命中数 / 总数 个会话`）、以及「大小与时间来自磁盘上的会话日志」的提示。
- **每行**：
  - 复选框；
  - 标题（没有标题时显示「（无标题）」）；
  - 标签：**运行中**、**仅归档记录**（磁盘上找不到会话目录）、**已置顶**；
  - 项目名与路径（有 `cwd` 时显示项目路径，否则显示会话目录的 `$DSH_HOME/…` 形式）；
  - 体积、最近写入时间（1 分钟内「刚刚」，7 天内相对时间，再早显示日期）；
  - 两个图标按钮：**复原** 与 **永久删除**（不可删除的行禁用并给出原因）。
- **分页**：一次最多渲染 60 行，底部「显示更多（还有 N 个）」。
- **选中操作条**（选中后才出现，吸底）：`已选 N 项`、合计体积、**批量复原**、**批量删除**、取消选择。
- **空态 / 错误态**：没有归档会话时说明从哪里归档；筛选无结果时给「清除筛选」；读取失败时给「重试」。

## 批量操作

- **多选**：勾选框逐行切换；按住 <kbd>Shift</kbd> 点选，以最近一次点击为锚点，选中可见列表中两者之间的全部行；
  列表头的全选只作用于**当前页**（这 60 行），不影响其它页与已筛掉的行。选择的合计体积实时显示。
- **批量复原**：对选中的行逐个把会话移出归档集合；成功几行、失败几行分别报出。
- **批量删除**：只把**可删除**的行送进确认对话框（运行中、仅记录、布局不符的行不会出现在待删列表里，也就不会被删）。
  确认对话框列出前 8 个会话及其体积，其余折叠成「还有 N 个未列出」；<kbd>Esc</kbd>、点遮罩或「取消」都能退出。
- **逐项结果**：两个批量接口都按 id 返回逐项结果。页面右下角的结果提示写明成功条数与释放体积；
  有失败时再列最多 4 条「标题 — 原因」（例如「会话正在运行，请先关闭再删除。」「会话目录已不在磁盘上，只能从归档列表移除。」）。
- **协议层面必须确认**：`POST /api/archive/delete` 要求请求体带 `confirm: true`，否则整批拒绝（`CONFIRM_REQUIRED`）。
  页面里的确认对话框只是礼貌，真正拦住误删的是这个字段。

## 搜索

**即时筛选（默认，不发请求）**：搜索框输入后 140ms 防抖，在已经载入的快照上过滤，词不区分大小写、按空格切分，
**每个关键词都要命中**（AND），每个词可以落在不同字段上。参与匹配的字段：标题、项目名、路径（`cwd` 或会话目录）、会话 id。
上限 500 字符（与 Harness 自身的会话搜索一致）。

**内容搜索（可选，较慢）**：打开「内容搜索」开关后按回车或点「开始搜索」，Host 会**分页扫描**归档会话的日志：

- 每页默认扫 8 个会话（上限 24），单次时间预算默认 2500ms（上限 8000ms），扫完一页返回一次；
- 匹配用宿主的 `sessionQuery.filterEvents`：只取 `user/message` 与 `assistant/message`、`surface: current` 的记录，再按字面文本匹配；
- 命中的会话给出命中条数、第一条命中的 `seq`/时间，以及命中的片段（页面高亮关键词），其余行按命中集合收窄；
- 进度条显示「正在扫描 已扫 / 总数」，随时可以「停止」；时间预算用尽时给「继续搜索」；
- 某一行读不出来时只跳过它（`skipped`），不中断整次扫描；部署没有挂载 `sessionQuery` 时提示「当前部署不支持内容搜索。」；
- 关掉开关或清空搜索框即丢弃命中并恢复完整列表。

内容搜索是这一页**唯一**会打开会话日志的路径，因此它必须由用户显式开启、分页、可中断。

## 性能：两级读取与缓存

2.0.0 之前，这一页为了显示标题会逐行折叠会话日志；一台有 162 条归档会话的机器上，这等于首屏先打开 162 个日志。
现在分成两层：

1. **快照层（首屏只读这一层）**：一次 header 列表（`sessionQuery.listSessions`，把运行中的会话合并到持久化列表之上）、
   一次会话根目录的两级扫描（拿到「编码后的 id → 目录」，比按推导路径逐条 `stat` 更便宜，也能发现目录放错位置的会话）、
   每行一次 `readdir` + 每个日志文件一次 `stat`（体积与 mtime）。标题先读宿主**已经加载在内存里**的投影缓存
   （`sessionProjectionCache.cachedSnapshot` / `cachedPredecessorTitle`），零 I/O。**这一层不打开任何会话日志。**
2. **标题补齐层**：投影缓存明确没有答案的行，页面再分批请求 `GET /api/archive/titles`（每批 24 个，整轮最多 24 批），
   折出来的标题直接补进已经渲染的行；缓存明确回答「这个会话没有标题」的行不会再触发折叠，直接显示「（无标题）」。

缓存与失效：

- header 列表与根目录扫描 15s，整份快照 4s，单个目录的文件事实 3s，折叠出来的标题 10 分钟；
- 每次批量操作让缓存的**代际**加一，下一次读一定重新读，不会把操作前的快照又画一遍；
- 目录检查默认 12 路并发：一次读几百个目录时延叠起来就是几秒，并发受限的重叠把等待压下去，同时不让句柄数失控。

### 可配置项

以下默认值来自 `lib/snapshot.js` 的 `DEFAULTS`：

| 配置键 | 默认值 | 含义 |
| --- | --- | --- |
| `headersTtlMs` | `15000` | header 列表与根目录扫描的复用时长（毫秒） |
| `snapshotTtlMs` | `4000` | 整份快照的复用时长 |
| `diskTtlMs` | `3000` | 单个会话目录文件事实（体积 / mtime）的复用时长 |
| `titleTtlMs` | `600000` | 折叠出来的标题的复用时长（10 分钟） |
| `titleBatchSize` | `24` | 一次标题深读最多折叠几个 |
| `titleBudgetMs` | `6000` | 一次标题深读的墙钟预算 |
| `concurrency` | `12` | 同时检查多少个会话目录 |
| `maxBatchSize` | `500` | 一次批量操作最多接受多少个 id |

在 profile 自己的 `cordis.patch.yml`（默认 `~/.dsh/profiles/<profile 名>/cordis.patch.yml`）里按行 id 覆盖：

```yaml
- id: archive-manager
  config:
    snapshotTtlMs: 8000
    concurrency: 6
```

两点要注意：**这个 `config` 是整体替换而不是逐键合并**，没有写出来的键会回落到上表的默认值；
配置改动由 loader 的配置重载生效，如果页面数据没变，重启桌面端。

## 安全边界

「永久删除」不是 DSH 已有的 API：会话持久化接缝明确说明「没有任何东西会删除会话文件……这个接缝没有删除 API」，
`ctx.workspaceRegistry` 也只负责记账、不动文件。所以删除是本插件**自己推导路径后执行的文件系统操作**，
边界必须自己立起来。

- **唯一输入是会话 id**，不是路径、不是 `cwd`。浏览器无法指定要删哪个文件。
  载荷里虽然带绝对路径字段（`directoryPath` / `homePath` / `sessionsRootPath`），但页面只显示 `$DSH_HOME/…` 形式，
  这些字段**不参与**删除判定。
- **必须在归档集合里**：id 不在 `workspaceRegistry.archivedSessionIds` 中即拒绝（`NOT_ARCHIVED`）。
- **不能是运行中的会话**：本进程里打开的会话一律拒绝（`SESSION_LIVE`），页面也会禁用它的删除按钮。
- **目录必须通过三类校验**（`lib/layout.js` 的 `assertDeletableDirectory`，任何一项不成立就拒绝，绝不做「尽力而为」的删除）：
  1. **根包含**：路径严格位于 `$DSH_HOME/sessions` 之下，且不是根目录本身（`OUTSIDE_ROOT`）；并且恰好是「项目层/会话层」两级（`MISPLACED`）。
  2. **编码名相等**：项目目录名必须等于由 `cwd` 推导出的 `projectKey(cwd)`（`PROJECT_MISMATCH`），
     会话目录名必须等于 `encodeSegment(id)`（`ID_MISMATCH`）。这两条推导规则是从 DSH 自带 JSONL 后端移植的，
     编码是单射的，所以「这个目录是不是这条会话的」是**可判定的相等**，不是猜。
  3. **存在会话日志**：目录里必须真的有一个会话日志文件（`NOT_A_SESSION_DIRECTORY`），否则按「看不懂的目录」处理。
- **先删文件，再摘归档记录**：会话目录（连同日志）、投影缓存文件、最后才是归档条目。
  中途失败时该会话仍然是「已归档」，人还能在列表里看到它；只有「文件已删、记录没摘掉」这一种会明说
  （`UNARCHIVE_FAILED`：「文件已删除，但归档记录未能移除」），不会假装整批都失败。
- **删除成功后**广播 `api-session/removed`，让侧栏立刻收起这一行。
- **复原只动归档列表**：`workspaceRegistry.unarchiveSession(id)` 把 id 从归档集合移除，日志与投影缓存一个字节都不碰；
  会话原本就在工作区里占着记账槽位，所以它会回到原来的项目与位置。

## HTTP 接口

五条路由都注册在 connection 服务的共享 `/api` 通道上（`ctx.connection.fetch.register`，`requestBody: 'buffered'`）。
通道自己负责会话鉴权与 Host/Origin 校验，所以本插件**一律回 HTTP 200**，用一个 `ok` 判别式区分结果——
这样「业务拒绝」永远不会被误认成「通道鉴权失败」。所有响应都是 `cache-control: no-store`。

| 方法 | 路径 | 请求要点 | 响应要点 |
| --- | --- | --- | --- |
| GET | `/api/archive/sessions` | `refresh=1` 跳过缓存重建快照；`q` 可选（多关键词 AND，服务端同款匹配规则） | `ok`、`generatedAt`、`totals{archived,onDisk,live,bytes,deletable}`、`capabilities{batchLimit,titles,contentSearch}`、`items[]`；带 `q` 时 `items` 只留命中行并附 `matched` 字段 |
| GET | `/api/archive/titles` | `ids` 逗号分隔（上限 200 个）；`budgetMs`（默认 6000，上限 30000）；`batch`（默认 24） | `ok`、`titles{ id: 标题或 null }`、`pending[]`（本轮没折叠到的）、`failed[]`（折叠被拒的）；`ids` 为空时 `{ok:false, code:'EMPTY_SELECTION'}` |
| GET | `/api/archive/search` | `q` 必填；`cursor`（从 0 开始的扫描位置）；`batch`（默认 8，上限 24）；`budgetMs`（默认 2500，上限 8000） | `hits[{id,count,seq,time,snippet}]`、`skipped[]`、`scanned`、`cursor`、`nextCursor`、`total`、`done`、`truncated`；`q` 为空 `EMPTY_QUERY`，没挂载 `sessionQuery` 时 `UNAVAILABLE` |
| POST | `/api/archive/restore` | `{ "ids": [...] }`（兼容旧式 `{ "id": "..." }`） | `ok`、`results[]`（逐项 `ok`/失败码）、`summary{requested,succeeded,failed,bytes}`、`payload`（刷新后的快照） |
| POST | `/api/archive/delete` | `{ "ids": [...], "confirm": true }`；`dryRun: true` 时免确认、只判定不删除 | `ok`、`dryRun`、`results[]`、`summary`、`payload`；缺 `confirm` 整批 `CONFIRM_REQUIRED` |

失败时是 `{ ok: false, code, message }` 仍是 200。请求级错误码：`INVALID_BODY`、`INVALID_IDS`、`EMPTY_SELECTION`、
`TOO_MANY_IDS`、`CONFIRM_REQUIRED`、`UNAVAILABLE`、`INTERNAL`。逐项错误码：`NOT_ARCHIVED`、`LIVE_SESSION`、`NO_HEADER`、
`NOT_ON_DISK`、`OUTSIDE_ROOT`、`MISPLACED`、`PROJECT_MISMATCH`、`ID_MISMATCH`、`NOT_A_SESSION_DIRECTORY`、
`REMOVE_FAILED`、`UNARCHIVE_FAILED`、`RESTORE_FAILED`。

## 兼容性

- **实测环境**：DSH `0.2.1-rc.3` 桌面版（`app.asar`）。插件是按这一版的内部接缝写的，不是公开 API。
- **用到的宿主接口**：

  | 接口 | 用途 |
  | --- | --- |
  | `ctx.connection.fetch.register` | 注册五条 `/api/archive/*` 路由（`buffered` 请求体，返回 `Response`） |
  | `ctx.workspaceRegistry` | `archivedSessionIds` / `pinnedSessionIds` / `list()`（项目与 `sessionIds`）/ `unarchiveSession(id)` |
  | `ctx.sessionQuery` | `listSessions()`（合并运行中会话的 header 列表）、`readTitleSnapshots(ids, signal)`（折叠标题）、`filterEvents(id, filters)`（内容搜索） |
  | `ctx.sessionProjectionCache` | `cachedSnapshot(header)` / `cachedPredecessorTitle(header)`：首屏零 I/O 的标题来源 |
  | `ctx.get('sessions').list()` | 最近一次「哪些会话在本进程里运行」的权威答案（即使 header 列表命中缓存也要重新问） |

  另有 `ctx.sessionPersistence.list()` 作为 `listSessions` 缺席时的退路，`ctx.emit('api-session/removed', id)` 用于驱动侧栏刷新。
- **依赖**：没有第三方运行时依赖，`package.json` 里只有 `@deepseek-ai/cordis` 的 peer（`^4.0.1`）和 `engines.node >= 20`；
  没有构建步骤，没有 bundler，没有需要 `require` 的官方客户端包（页面样式只用 `--dsw-*` 主题令牌）。
- **版本范围**：`package.json` 没有声明 `engines.dsh`，所以插件页不会替你拦版本不匹配；升级 DSH 后请自己先确认这一版还能用。

## 安装

先装好 DSH 桌面端（[deepseek.com/download](https://www.deepseek.com/download/)）。本插件是标准 DSH 组合包：
`package.json` 里声明了 `dsh.bundle.patch` 与 `dsh.client`，装进任何 profile 都走同一条路。

### 1. DSH 官方桌面端（推荐）

1. 打开 DSH 桌面端 → 侧栏 **插件**（设置里也能进同一个插件页）；
2. 点右上角 **「添加插件」**，直接打开「添加插件」对话框（旁边带箭头的按钮是「选择添加插件方式」，
   其中「安装第三方插件」一项也写明「支持 npm 包、Git 仓库和本地目录」）；
3. 在 **「包名或地址」** 里填本仓库地址或本机目录路径。对话框的说明是「输入插件的包名、GitHub 仓库地址或本地目录路径。」，
   右侧的 **「安装源」** 默认是「中国大陆镜像源」，下方可展开「插件安装引导和示例」：
   - `https://github.com/linanbuan/dsh-archive-manager`
   - 或者已经克隆到本机的目录绝对路径（见下面的网络受限做法）；
4. 点 **「安装」**：先显示「正在准备安装…」，完成后弹出标题为 **「已安装」** 的对话框，列出包名、版本 `2.0.0` 与简介，
   点 **「立即启用」**。这一步没有第二次「安装」确认；
5. 插件行随后出现在「已安装插件」里、开关为开，设置 → **归档会话** 在同一会话内即可用。
   若界面提示需要重启（例如客户端没有立即出现「归档会话」），**重启桌面端而不是刷新页面**。

**网络受限时**：如果插件页报「无法访问 GitHub」或「连接 GitHub 超时」（它会给出「试试其他方式」「改用国内镜像」，
对话框里的「安装源」也可以换一个），也可以先在本机克隆，再把**目录绝对路径**填进「包名或地址」：

```bash
git clone https://github.com/linanbuan/dsh-archive-manager.git
```

### 2. 命令行（可选）

插件页做的事，等价于一次 `dsh plugin` 调用；具体写法是 `dsh plugin add <spec>`。
**以你所用版本的 dsh CLI 帮助为准**（`dsh plugin --help`），本页不列出未经验证的参数。
在 `0.2.1-rc.3` 这一版，`dsh plugin` 是把参数转交给 profile 目录里的 pnpm，因此带 profile 的完整形式是：

```bash
dsh plugin --profile <profile 名> add <spec>
```

`<spec>` 与插件页里的「包名或地址」相同。注意桌面端 profile 由 Electron 托管，npm 版 CLI 会拒绝管理它的插件——
桌面用户请走第 1 种方式。

### 3. 手动安装（不推荐）

手动路径确实存在：把本目录登记到 profile 的 `dsh.profile.bundles`，再安装依赖。
但这正是官方插件管理器替你做的事，手改配置文件既容易写坏 profile，也可能让 Harness 起不来 ——
请用第 1 种方式（插件页）完成安装，不要手改配置文件。

## 更新与卸载

- **更新**：走插件页——先**卸载**再安装新版（插件页文案也是这么建议的：其它插件请先卸载再安装新版）。
- **卸载**：插件页 → 这个插件 → **卸载**，它会把包从 profile 的依赖与 `dsh.profile.bundles` 里去掉。
- **升级 DSH 之后插件行为异常**：先确认版本兼容。本插件依赖的是 `0.2.1-rc.3` 的内部接缝，宿主改名或改形都会让它失效；
  失效时页面会退化成错误提示或空列表，不会影响 Harness 本身启动。

## 注意事项

1. **不是官方插件**：与 DeepSeek AI 无任何关联，不提供服务承诺。
2. **删除没有回收站**：这就是「永久」的含义，插件与 Harness 都没有恢复入口。删之前请确认这些会话不再需要。
3. **运行中的会话不能删**：它可能还有正在写入的内容。先关闭该会话（或重启应用）再删；界面会把这类行标「运行中」并禁用删除按钮。
4. **只影响本机这一份 `$DSH_HOME`**：删除是本机文件系统操作，不会同步到其它设备，也不会动云端任何东西。
5. **归档记录与日志可能不同步**：若某条归档记录已经没有对应日志（被别的工具清过、或换过机器），本页仍会列出它，
   标「仅归档记录」，并允许把它从归档列表移除（不删任何文件）。
6. **标题缺失只是降级**：日志损坏、折叠超时或投影缓存没命中，只会让那一行暂时显示「（无标题）」，不影响复原与删除。
7. **权限**：删除走的是 Harness 进程自己的文件系统权限。若 `$DSH_HOME` 在需要提权的目录下，删除会以 `EACCES`/`EPERM` 之类的错误如实报出，不会假装成功。
8. **平台**：只要 DSH 能跑（Windows / macOS / Linux）即可用。路径推导对 Windows 的 `C:\…` cwd、中文与空格目录名都有对应用例。
9. **隐私**：插件不联网、无遥测，不上报任何会话内容；它只在 Host 侧读本机文件与 Harness 自己的服务。
   仓库本身不含凭据、会话内容或个人绝对路径。

## 自检

```bash
node test/selfcheck.mjs      # 或 pnpm test
```

自检不需要网络、不需要 Harness、不需要 React：Host 半边在临时 `$DSH_HOME` 里跑真实的建目录 / 删除 / 复原流程，
五条路由由一个假 harness 供给（含归档集合、会话 header、投影缓存与 `filterEvents`）；
浏览器半边在 stub `window.__ModuleLoader__` 里完成注册，再直接调用页面导出的 `__test` 纯函数
（筛选、排序、区间选择、体积汇总、字典键集合）。

**当前状态（2026-10-24 实测）**：`node test/selfcheck.mjs` → `50 checks, 0 failed`，退出码 0。

没有覆盖的部分，如实说明：**真实渲染**（没有 React 运行时，因此不驱动 hook 与 DOM，点击流程是照着导出函数断言的）、
真实 Harness 服务、`sessionQuery` 未挂载时的 `sessionPersistence` 退路（只断言搜索路由的 `UNAVAILABLE`）、
以及三个 TTL 的过期行为（只在「TTL 内复用」这一侧断言）。

## 仓库结构

```
package.json          组合包清单（dsh.bundle.patch + dsh.client），无运行时依赖
cordis.patch.yml      一行 insert：装载 Host 半边（行 id：archive-manager）
index.js              Host 半边：五条 /api/archive/* 路由
lib/snapshot.js       两级快照、缓存与代际失效、配置默认值
lib/ops.js            批量复原 / 批量删除，逐项结果与归档记账
lib/search.js         匹配规则（多关键词 AND、大小写不敏感、片段截取）
lib/concurrency.js    受限并发（mapLimit / settleLimit）
lib/layout.js         会话存储布局移植：projectKey / encodeSegment / 路径推导与删除校验
client.js             浏览器半边：settings.section 页面（手写 lazy CJS，只用 react）
locale/{zh,en}.json   插件卡片文案
docs/项目日志.md       工程记录：问题、调研、改动、性能取舍、验证
test/selfcheck.mjs    自检
icon.svg              插件图标
```

## 致谢与第三方许可

- 只用 Harness 自己的接缝（`connection`、`workspaceRegistry`、`sessionQuery`、`sessionProjectionCache`、`sessions`）
  与 Node 内置模块，没有复制或改编任何第三方插件的代码。
- 会话存储布局（项目键与 id 分段的编码方式）是照着 DSH 自带 JSONL 后端的行为重新实现的，属于接口兼容，不含官方代码副本。
- 页面样式只用主题令牌与自绘控件，没有 `require` 官方客户端包。

## License

[MIT](LICENSE) © 2026 linanbuan
