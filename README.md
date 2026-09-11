# DSH Loomy Connect

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) plugin that exposes the text models bundled with the **Loomy** desktop app to DSH, without an API key.

The plugin reads Loomy's on-disk sign-in session and model manifest **read-only** — it never copies, uploads, or rewrites them — and serves them to DSH through a per-process HTTP gateway bound to `127.0.0.1`.

Two contributions ship in one package:

| Contribution | Surface | What it does |
|---|---|---|
| Model provider | Host (`llm` seam) | Registers a `loomy` provider whose model list is discovered from Loomy at startup |
| Settings card | Browser (`settings.plugin.item` slot) | Shows the signed-in account, credit balance, and served model count under **Settings → Plugin configuration** |

---

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Status endpoint](#status-endpoint)
- [Credits: where the numbers come from](#credits-where-the-numbers-come-from)
- [Security model](#security-model)
- [Development](#development)
- [Public API](#public-api)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)
- [License](#license)
- [Disclaimer](#disclaimer)

---

## Requirements

| | |
|---|---|
| **Loomy desktop app** | Installed and signed in at least once |
| **DeepSeek Harness** | `>= 0.1.5-rc.1` |
| **Node.js** | `>= 22` |

Loomy is an Electron application. The plugin depends only on files Loomy itself writes, so no Loomy-side configuration, plugin, or API key is involved.

## Installation

### From GitHub

```sh
dsh plugin --profile web add github:gdrpzym/dsh-loomy-connect
dsh web
```

### From a local checkout

Preferred while developing, since it needs no publish step:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-loomy-connect
dsh web
```

`lib/` is committed, so a GitHub install does not require a local toolchain. The package's `prepare` script rebuilds on install to guarantee the artifacts match the sources.

### Verifying

```sh
# Confirms the plugin is composed into the profile's config tree.
dsh --profile web --dump-config     # expect an `llm-loomy` entry
```

`--dump-config` only composes the config tree; it does not instantiate the plugin. To verify the plugin actually boots, run `dsh web` and check that **Loomy** appears in the model selector, or use the runtime probe:

```sh
dsh web                              # in another terminal
node scripts/probe-dsh-runtime.mjs
```

## Configuration

Defaults are auto-detected per platform; most installs need no configuration at all. Overrides exist for non-standard Loomy installs.

### Plugin config schema

Declared as a runtime [schemastery](https://github.com/shigma/schemastery) `Config` export (see [Caveats](#cordis-config-schema) for why this must be a runtime value).

| Field | Type | Description |
|---|---|---|
| `authFile` | `string` | Path to Loomy's `auth-session.json`. Defaults to the detected platform location. |
| `configFile` | `string` | Path to Loomy's generated `opencode.json`. Defaults to the detected platform location. |

### Environment variables

| Variable | Replaces |
|---|---|
| `LOOMY_AUTH_FILE` | `authFile` |
| `LOOMY_CONFIG_FILE` | `configFile` |
| `LOOMY_LOCAL_STORAGE_DIR` | Detected Loomy `Local Storage/leveldb` directory |

Resolution order per lookup: **plugin config → environment variable → detected default**.

### Default file locations

Candidates are probed in the order listed and the first existing path wins, so the same build works on macOS, Windows, and Linux.

| Platform | Sign-in session | Model manifest | Credits cache |
|---|---|---|---|
| macOS | `~/Library/Application Support/loomy/auth-session.json` | `~/.config/loomy-opencode/opencode.json` | `~/Library/Application Support/loomy/Local Storage/leveldb` |
| Windows | `%APPDATA%/loomy/auth-session.json` | `%APPDATA%/loomy-opencode/opencode.json` | `%APPDATA%/loomy/Local Storage/leveldb` |
| Linux | `~/.config/loomy/auth-session.json` | `~/.config/loomy-opencode/opencode.json` | `~/.config/loomy/Local Storage/leveldb` |

`XDG_CONFIG_HOME` is honoured where Loomy's XDG-style layout applies. When no candidate exists yet, the first (macOS) candidate is returned as the nominal default.

## Architecture

The plugin is a dual-surface (host + browser) cordis plugin.

```
┌─ Host (Node) ──────────────────────────────────────────┐
│                                                        │
│  catalog.ts ── reads Loomy's model manifest            │
│      │                                                 │
│      ▼                                                 │
│  shim.ts ── 127.0.0.1:<ephemeral>, Bearer-protected    │
│      │        reads session from disk per request      │
│      ▼                                                 │
│  adapter.ts ── pi-ai provider ──► ctx.llm             │
│                                                        │
│  web-status.ts ── GET /plugins/dsh-loomy-connect/status│
└────────────────────────┬───────────────────────────────┘
                         │ same-origin JSON (no tokens)
┌────────────────────────▼─ Browser ─────────────────────┐
│  client/index.tsx ── slots.inject('settings.plugin.item')│
│  LoomyPluginCard.tsx ── renders status                 │
└────────────────────────────────────────────────────────┘
```

### Host half

| Module | Role |
|---|---|
| `src/auth.ts` | Resolves and parses Loomy's sign-in session (`session`, `userid`, masked `phone`) |
| `src/catalog.ts` | Parses `provider.imodel.models` from Loomy's manifest; filters to text-output models; falls back to a pinned list |
| `src/upstream.ts` | Calls Loomy's OpenAI-compatible endpoint and normalises the request body |
| `src/shim.ts` | Loopback gateway: injects credentials, streams SSE, enforces host/origin/auth checks |
| `src/adapter.ts` | Builds the pi-ai provider and registers it with DSH's `llm` seam |
| `src/points.ts` | Reads Loomy's `localStorage` credits cache from LevelDB |
| `src/web-status.ts` | Serves the browser card's status document |

The gateway listens on an ephemeral port on `127.0.0.1` with a per-process random secret. DSH holds only that secret; the Loomy session token is resolved from disk inside the gateway on each request and never leaves it.

Gateway routes:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | Liveness |
| `GET` | `/v1/models` | Currently discovered model IDs |
| `POST` | `/v1/chat/completions` | Streaming chat; proxies to Loomy upstream |

Limits: 64 MiB request body, 20-minute request ceiling, upstream aborted when the client disconnects.

### Browser half

The card is contributed through DSH's slot registry:

```ts
ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
  name: 'settings.plugin.item',
  key: 'loomy',          // must match the host-registered namespace
  priority: 30,
  inject: () => ({ t }),
}, LoomyPluginCard))
```

**All four conditions below must hold**, or the card silently never renders:

1. `package.json` declares `dsh.client`, with `platform` as a string and `inject` listing the required client packages.
2. `exports["./client"]` points at the browser bundle — DSH's `clientExportOf()` accepts only a string, or an object with a string `default`.
3. The browser bundle is CJS wrapped in `window.__ModuleLoader__.load({ id, factory })`, with React and all DSH client packages left external.
4. **The host half calls `settings.installSection(ctx, ns, Config, config, hooks)`**, registering the namespace.

Condition 4 is the one most often missed. The **Plugin configuration** tab renders the intersection of *namespaces the host serves* and *cards claiming those namespaces* — a card whose namespace no host serves is never dispatched. Because the **Plugins** tab is driven by the profile's installed-plugin entries instead, a plugin missing condition 4 still appears there, which makes the failure easy to misread as a working install.

Two related notes:

- `ctx.llm.registerConfigurableProviders({ settingsNs })` feeds the model selector only. It has no bearing on the Plugin configuration tab.
- `installSection` invokes `onChange` **synchronously** at attach time, before the adapter exists; the handler must tolerate that (`reapply?.()`).

The card's visual shell is a deliberate replica of DSH's own plugin cards. That shell is package-private in `@deepseek-ai/dsh-client-ui-settings-plugins` — the package exports only `apply`/`inject` at runtime — so `src/client/card-css.ts` reproduces the computed styles under a `dlc_` private class prefix. Icons and buttons come from `@deepseek-ai/dsh-client-ui-primitives`, which is listed in `dsh.client.external` and resolved from DSH's seed module table; keeping it external holds the browser bundle to ~18 kB instead of ~450 kB.

The browser registration is wrapped in `try`/`catch`. If DSH's slot API changes, the failure degrades to a `console.error` and the model provider keeps working.

## Status endpoint

The card polls a same-origin route owned by the plugin.

```
GET /plugins/dsh-loomy-connect/status
```

Rules: `GET` only (otherwise `405`); `Host` must be loopback and a browser-sent `Origin` must be loopback too (otherwise `403`). The response carries no token material, and error messages are redaction-filtered.

Response — a discriminated union on `status`:

```ts
type LoomyWebStatus =
  | { status: 'signed-out' }
  | { status: 'signed-in'; account?: string; modelCount: number; points?: {...}; pointsError?: string }
  | { status: 'error'; message: string }
```

```ts
interface LoomyWebPoints {
  permanent: number   // long-lived credits
  daily: number       // refilled each sign-in day
  updatedAt?: string  // ISO timestamp of Loomy's last refresh
}
```

`account` is Loomy's already-masked phone number. `points` is omitted when Loomy has never cached a summary; a read failure surfaces as `pointsError` rather than failing the document.

## Credits: where the numbers come from

Loomy exposes no HTTP endpoint for credits: the model gateway returns `404` for `/v1/credits` (reproducible with `scripts/probe-credits.mjs`), and the renderer fetches credits over `window.electronAPI.points.*` IPC, which only the running app can answer.

The only viable external read is Loomy's own `localStorage` cache. Loomy's renderer stores the key `loomy-points-summary` — shaped `{ balance, dailyBalance, updatedAt }` — in `Local Storage/leveldb`, and Loomy's own sidebar renders from that same cache, so the card and the app agree by construction.

LevelDB is an append-only log, so superseded values for a key remain in the file. `src/points.ts` therefore:

- scans every `*.log`/`*.ldb` file and extracts all candidate records;
- selects the newest by `updatedAt` rather than trusting file order;
- memoizes on directory mtime/size so polling does not re-read multi-megabyte logs;
- returns `undefined` (never a synthetic `0`) when no cache exists.

## Security model

| Boundary | Mechanism |
|---|---|
| Network exposure | Gateway binds `127.0.0.1` only |
| Client authentication | Per-process random secret, compared with `timingSafeEqual` |
| DNS rebinding | `Host` must be loopback — a rebound page sends its own domain |
| Cross-site simple requests | `Origin`, when sent, must be loopback; request body must be `application/json` |
| Token custody | The Loomy session token is read from disk inside the gateway per request; DSH never holds it |
| Browser exposure | The status route redacts token-shaped strings and returns no credentials |

Threat model: protects against other local processes and against web pages running in the user's browser. It does **not** protect against code running as the same user, which can read the same files the plugin reads.

## Development

```sh
pnpm install
pnpm run check        # tsc --noEmit (host + client) then tsdown bundle into lib/
```

Diagnostic scripts, all read-only:

```sh
node scripts/live-e2e.mjs [model-id]         # adapter → pi-ai → gateway → Loomy upstream
node scripts/probe-upstream.mjs [model-id]   # raw upstream SSE
node scripts/probe-shim.mjs [model-id]       # local gateway only
node scripts/probe-adapter.mjs [model-id]    # pi-ai adapter, per chunk
node scripts/probe-credits.mjs               # reproduces the 404 on /v1/credits
node scripts/probe-dsh-runtime.mjs           # plugin loaded in a live `dsh web`, gateway authed
```

### Caveats

#### cordis `Config` schema

cordis resolves a loader entry's config as:

```js
if (!runtime.Config) return config                                  // no schema → raw passthrough
return runtime.Config['~standard'].validate(config).value           // schema → validate + defaults
```

A plugin **must export a runtime `Config` schema**. A TypeScript `interface Config` is erased at compile time, so cordis passes the raw loader value through — `undefined` when the patch has no `config:` block — and reading a field off it aborts the whole plugin tree at boot (`Cannot read properties of undefined (reading 'authFile')`). This project exports a schemastery schema and also defaults `apply`'s parameter to `{}`.

#### Browser bundle loading is not validated at startup

DSH does not check `exports["./client"]` when starting; pointing it at a missing file still starts cleanly. To confirm the browser half is actually loaded, fetch the index bootstrap manifest and check that the plugin's package name appears in the client module list.

## Public API

Re-exported from the package root for reuse and testing:

| Export | Kind |
|---|---|
| `name`, `inject`, `Config`, `apply` | Plugin entry points |
| `createLoomyAdapter`, `LOOMY_PROVIDER`, `LoomyAdapter` | Provider adapter |
| `createLoomyShim`, `resolveAuthFile`, `LoomyShim`, `LoomyShimOptions` | Gateway |
| `LoomyCatalog`, `parseLoomyModels`, `LoomyModel` | Model discovery |
| `defaultLoomyAuthPath`, `defaultLoomyConfigPath`, `parseLoomyAuth`, `readLoomyCredential`, `LoomyCredential` | Sign-in state |
| `LOOMY_API_BASE`, `LoomyUpstreamClient`, `prepareLoomyBody` | Upstream client |
| `loopbackHost`, `loopbackOrigin` | Request guards |
| `LOOMY_POINTS_KEY`, `defaultLoomyLocalStorageDir`, `extractLoomyPoints`, `newestLoomyPoints`, `parseLoomyPointsRecord`, `readLoomyPoints`, `resetLoomyPointsCache`, `LoomyPointsSummary` | Credits |
| `LOOMY_STATUS_PATH`, `LoomyWebStatus`, `LoomyWebPoints` | Status contract |
| `loomyStatusHandler`, `loomyWebStatus`, `registerLoomyStatusRoute`, `LoomyStatusRouteOptions` | Status route |

## Project layout

| Path | Purpose |
|---|---|
| `cordis.patch.yml` | DSH profile patch inserting the `llm-loomy` entry |
| `src/index.ts` | Plugin entry: `name` / `inject` / `Config` / `apply` |
| `src/auth.ts` | Read-only Loomy sign-in state, platform path detection |
| `src/catalog.ts` | Text-model discovery from Loomy's manifest |
| `src/upstream.ts` | Loomy upstream call and request-body normalisation |
| `src/shim.ts` | Credential-protected loopback gateway |
| `src/adapter.ts` | pi-ai provider registered into DSH's `llm` seam |
| `src/loopback.ts` | Shared loopback Host/Origin guards |
| `src/points.ts` | Credits read from Loomy's LevelDB `localStorage` cache |
| `src/status-paths.ts` | Node-free constants and types shared by both halves |
| `src/web-status.ts` | Status route and document assembly |
| `src/client/index.tsx` | Browser entry: slot registration, locale namespaces |
| `src/client/LoomyPluginCard.tsx` | Settings card component |
| `src/client/card-css.ts` | Namespaced replica of DSH's plugin card shell |
| `src/client/locales.ts` | Card copy (zh / en) |
| `scripts/*.mjs` | Read-only diagnostics and probes |

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Card never appears under Plugin configuration | Host half is not calling `installSection`; check condition 4 in [Browser half](#browser-half) |
| Plugin listed under Plugins but no card | Same as above — the Plugins tab reflects installed entries, not served namespaces |
| `Cannot read properties of undefined (reading 'authFile')` at boot | Missing runtime `Config` export; see [Caveats](#cordis-config-schema) |
| Card shows "not signed in" though Loomy is signed in | Session path not detected; set `authFile` or `LOOMY_AUTH_FILE` |
| `502` on every chat request | Gateway could not read a valid session — on Windows/Linux this is usually an undetected auth path |
| Model list is stale | The catalog is read at startup; restart DSH or trigger a settings change |
| Credits empty | Loomy has not cached a summary yet, or `LOOMY_LOCAL_STORAGE_DIR` is wrong |

## License

[MIT](LICENSE)

## Disclaimer

- This project is for **personal learning and research only**. It drives your own Loomy account on your own machine. Do not use it commercially or beyond reasonable personal use.
- You must comply with the Loomy terms of service. Any consequence of using this project — including account restrictions, depleted credits, or service interruption — is yours to bear.
- The author is not liable for any direct or indirect loss arising from the use or misuse of this project.
- This project is not affiliated with, endorsed by, or sponsored by Loomy, iFlytek, or DeepSeek. Product names are used to describe compatibility only; trademarks belong to their respective owners.

---

# 中文

将 **Loomy** 桌面 App 内置的文字模型接入 DeepSeek Harness（DSH），无需 API Key。

插件以**只读**方式读取 Loomy 本地的登录态与模型清单，不复制、不上传、不改写；并通过一个绑定到 `127.0.0.1` 的进程内网关向 DSH 提供服务。

包含两部分贡献：

| 贡献 | 运行位置 | 作用 |
|---|---|---|
| 模型 provider | 宿主端（`llm` seam） | 注册 `loomy` provider，启动时从 Loomy 发现模型清单 |
| 设置卡片 | 浏览器端（`settings.plugin.item` slot） | 在**设置 → 插件配置**中显示登录账号、积分余额与模型数量 |

## 环境要求

| | |
|---|---|
| **Loomy 桌面 App** | 已安装，且至少登录过一次 |
| **DeepSeek Harness** | `>= 0.1.5-rc.1` |
| **Node.js** | `>= 22` |

Loomy 是 Electron 应用，插件只依赖 Loomy 自己写出的文件，无需在 Loomy 侧做任何配置。

## 安装

```sh
# 从 GitHub
dsh plugin --profile web add github:gdrpzym/dsh-loomy-connect
dsh web
```

```sh
# 从本地目录（开发时推荐）
dsh plugin --profile web add /绝对路径/dsh-loomy-connect
dsh web
```

`lib/` 已提交，从 GitHub 安装无需本地构建；`prepare` 脚本会在安装时重新构建，确保产物与源码一致。

验证：`dsh --profile web --dump-config` 应出现 `llm-loomy` 条目。但该命令只组合配置树、不实例化插件，要确认插件真能启动请运行 `dsh web` 后执行 `node scripts/probe-dsh-runtime.mjs`。

## 配置

默认位置按平台自动探测，绝大多数安装无需配置。

**配置项**

| 字段 | 类型 | 说明 |
|---|---|---|
| `authFile` | `string` | Loomy `auth-session.json` 路径，缺省为探测到的平台默认位置 |
| `configFile` | `string` | Loomy 生成的 `opencode.json` 路径，缺省为探测到的平台默认位置 |

**环境变量**：`LOOMY_AUTH_FILE`、`LOOMY_CONFIG_FILE`、`LOOMY_LOCAL_STORAGE_DIR`。

**优先级**：插件配置 → 环境变量 → 探测到的默认值。

**默认位置**（按所列顺序探测，取第一个存在的路径）：

| 平台 | 登录态 | 模型清单 | 积分缓存 |
|---|---|---|---|
| macOS | `~/Library/Application Support/loomy/auth-session.json` | `~/.config/loomy-opencode/opencode.json` | `~/Library/Application Support/loomy/Local Storage/leveldb` |
| Windows | `%APPDATA%/loomy/auth-session.json` | `%APPDATA%/loomy-opencode/opencode.json` | `%APPDATA%/loomy/Local Storage/leveldb` |
| Linux | `~/.config/loomy/auth-session.json` | `~/.config/loomy-opencode/opencode.json` | `~/.config/loomy/Local Storage/leveldb` |

## 架构

插件为双面（宿主 + 浏览器）cordis 插件。宿主端负责模型通道：读取模型清单、在 `127.0.0.1` 随机端口上起一个带 Bearer 鉴权的网关（每次请求从磁盘解析 session）、通过 pi-ai 接入 DSH 的 `llm` seam。浏览器端通过 `slots.inject('settings.plugin.item', …)` 注册卡片，并从同源的 `/plugins/dsh-loomy-connect/status` 取数据。

浏览器卡片要渲染，**四条必须同时满足**：

1. `package.json` 声明 `dsh.client`（`platform` 为字符串，`inject` 列出所需客户端包）
2. `exports["./client"]` 指向浏览器产物
3. 产物为 `window.__ModuleLoader__.load({ id, factory })` 包装的 CJS，React 与 DSH 客户端包保持 external
4. **宿主端调用 `settings.installSection(ctx, ns, Config, config, hooks)` 注册命名空间**

第 4 条最易遗漏。「设置 → 插件配置」渲染的是**宿主提供的命名空间 × 浏览器注册的卡片**的交集；命名空间无人提供则永不 dispatch。而「插件」tab 由 profile 的已安装条目驱动，因此缺第 4 条时插件仍出现在插件列表里，容易误判为已正常工作。

另外两点：`ctx.llm.registerConfigurableProviders({ settingsNs })` 只喂模型选择器，与该 tab 无关；`installSection` 会在 attach 时**同步**调用一次 `onChange`，此时 adapter 可能尚未建立，需用可选调用兜底。

卡片的视觉外壳复刻自 DSH 自身的插件卡片。该外壳在 `@deepseek-ai/dsh-client-ui-settings-plugins` 中是包内私有的，因此 `src/client/card-css.ts` 在 `dlc_` 私有类名前缀下复现其计算样式；图标与按钮复用 `@deepseek-ai/dsh-client-ui-primitives`（声明在 `dsh.client.external`，从 DSH 种子模块表解析），使浏览器产物维持在 ~18 kB 而非 ~450 kB。

浏览器端注册整体包在 `try`/`catch` 中：若 DSH 的 slot API 变更，只降级为一条 `console.error`，模型通道不受影响。

## 状态端点

```
GET /plugins/dsh-loomy-connect/status
```

仅接受 GET（否则 `405`）；`Host` 必须为 loopback，浏览器携带的 `Origin` 也必须为 loopback（否则 `403`）。响应不含任何凭据，错误消息经脱敏过滤。

返回以 `status` 为判别式的联合类型：`signed-out` / `signed-in`（含 `account`、`modelCount`、`points?`、`pointsError?`）/ `error`。其中 `points` 为 `{ permanent, daily, updatedAt? }`，分别对应永久积分与每日赠送积分。缓存不存在时省略 `points`，读取失败降级为 `pointsError`，不会显示假的 0。

## 积分数据来源

Loomy 未对外暴露积分的 HTTP 接口：模型网关对 `/v1/credits` 返回 `404`（`scripts/probe-credits.mjs` 可复现），渲染进程走的是 `window.electronAPI.points.*` IPC，只有运行中的 App 能应答。

唯一可行的外部读法是读 Loomy 自己的 `localStorage` 缓存：`loomy-points-summary`（`{ balance, dailyBalance, updatedAt }`）位于 `Local Storage/leveldb`，Loomy 侧边栏同样读它，因此卡片与 App 的数字天然一致。

LevelDB 是追加写日志，旧值会残留。`src/points.ts` 会扫描全部 `*.log`/`*.ldb`、按 `updatedAt` 取最新一条（而非信任文件顺序）、按目录 mtime/size 做记忆化，并在无缓存时返回 `undefined`。

## 安全边界

网关仅绑定 `127.0.0.1`；使用进程内随机密钥并以 `timingSafeEqual` 比较；校验 loopback `Host` 以阻断 DNS 重绑定，校验 `Origin` 与 `application/json` 以阻断跨站简单请求；Loomy session token 仅在网关内按需从磁盘读取，DSH 不持有；状态端点对 token 形字符串脱敏。

威胁模型：防御本机其他进程与浏览器中的网页；**不**防御以同一用户身份运行的代码——它能读取插件所读的同样文件。

## 开发

```sh
pnpm install
pnpm run check        # tsc --noEmit（宿主 + 浏览器）后 tsdown 打包到 lib/
```

只读诊断脚本：`live-e2e.mjs`（全链路）、`probe-upstream.mjs`（上游原始 SSE）、`probe-shim.mjs`（本机网关）、`probe-adapter.mjs`（pi-ai 适配层）、`probe-credits.mjs`（复现 404）、`probe-dsh-runtime.mjs`（真实 DSH 进程内加载与鉴权）。

**注意**：插件必须导出**运行时** `Config` schema（本项目用 schemastery）。仅有 TypeScript `interface Config` 会被编译擦除，cordis 将透传 loader 原始值（`undefined`），读取其字段会导致整棵插件树加载失败、DSH 直接退出。DSH 也不在启动时校验 `exports["./client"]`，确认浏览器半边已加载需查看首页引导图中的客户端模块清单。

## 许可

[MIT](LICENSE)

## 免责声明

- 本项目**仅供个人学习和研究使用**，仅驱动使用者自己的 Loomy 账号在本机调用，请勿用于商业用途或超出个人合理使用的场景。
- 使用者需遵守 Loomy 的服务条款；因使用本项目产生的任何后果（包括但不限于账号被限制、额度被清空、服务中断），由使用者自行承担。
- 本项目作者不对任何因使用或滥用本项目产生的直接或间接损失负责。
- 本项目与 Loomy、讯飞（iFlytek）、DeepSeek 均无关联，未获其授权或认可；文中出现的名称仅用于描述兼容关系，其商标权利归各自所有。

## 致谢

本项目参考了 [dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect) 的 DSH provider 架构（MIT）。
