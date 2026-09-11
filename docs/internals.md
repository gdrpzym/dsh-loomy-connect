# 实现细节

简体中文 | [English](internals.en.md)

面向维护者与 DSH 插件作者。使用层说明见 [README.md](../README.md)。

## 目录

- [整体架构](#整体架构)
- [宿主端](#宿主端)
- [浏览器端](#浏览器端)
- [cordis `Config` schema](#cordis-config-schema)
- [浏览器产物加载不在启动时校验](#浏览器产物加载不在启动时校验)
- [状态端点](#状态端点)
- [积分数据来源](#积分数据来源)
- [安全实现](#安全实现)
- [对外 API](#对外-api)
- [项目结构](#项目结构)
- [开发](#开发)

## 整体架构

双面（宿主 + 浏览器）cordis 插件。

```
┌─ 宿主端 (Node) ─────────────────────────────────────────┐
│                                                        │
│  catalog.ts ── 读取 Loomy 的模型清单                     │
│      │                                                 │
│      ▼                                                 │
│  shim.ts ── 127.0.0.1:<随机端口>，Bearer 鉴权            │
│      │        每次请求从磁盘解析 session                  │
│      ▼                                                 │
│  adapter.ts ── pi-ai provider ──► ctx.llm              │
│                                                        │
│  web-status.ts ── GET /plugins/dsh-loomy-connect/status │
└────────────────────────┬───────────────────────────────┘
                         │ 同源 JSON（不含任何 token）
┌────────────────────────▼─ 浏览器端 ─────────────────────┐
│  client/index.tsx ── slots.inject('settings.plugin.item')│
│  LoomyPluginCard.tsx ── 渲染状态                         │
└────────────────────────────────────────────────────────┘
```

## 宿主端

| 模块 | 职责 |
|---|---|
| `src/auth.ts` | 定位并解析 Loomy 登录态（`session`、`userid`、已脱敏 `phone`） |
| `src/catalog.ts` | 从 Loomy 清单解析 `provider.imodel.models`，保留输出含文本的模型，失败时回落内置固定列表 |
| `src/upstream.ts` | 调用 Loomy 的 OpenAI 兼容端点，归一化请求体 |
| `src/shim.ts` | 回环网关：注入凭据、透传 SSE、执行 host/origin/鉴权校验 |
| `src/adapter.ts` | 构造 pi-ai provider 并注册进 DSH 的 `llm` seam |
| `src/points.ts` | 从 LevelDB 读取 Loomy `localStorage` 中的积分缓存 |
| `src/web-status.ts` | 组装并响应浏览器卡片的状态文档 |
| `src/leveldb.ts` | 两端共用的 LevelDB `localStorage` 读取器 |

网关监听 `127.0.0.1` 的随机空闲端口，使用进程内随机密钥。DSH 只持有该密钥；Loomy session token 在每次请求时于网关内部从磁盘解析，不外泄。

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/healthz` | 存活探测 |
| `GET` | `/v1/models` | 当前发现的模型 ID 列表 |
| `POST` | `/v1/chat/completions` | 流式对话，代理至 Loomy 上游 |

限制：请求体上限 64 MiB，单次请求上限 20 分钟，客户端断开时中断上游。

### 模型清单与倍率来源

`GET {LOOMY_API_BASE}/models`（`https://loomyad.xunfei.cn/api/v1/models`，需带 session）返回账号可用的全部模型，是唯一同时给出**倍率**的数据源：

```jsonc
{ "id": "deepseek-v4-flash-0731", "name": "DeepSeek V4 Flash 0731（x3.0）",
  "type": "chat", "context_length": 1048576, "max_output_tokens": 384000,
  "capabilities": { "reasoning": true, "input_modalities": ["text"], "output_modalities": ["text"] } }
```

倍率与优惠不在独立字段里，而是写在 `name` 的括号后缀中（`（x3.0）`、`（限时免费）`）。`src/catalog.ts` 用两条正则把它们解析成结构化的 `rate` / `promo`，`name` 保持原样交给模型选择器——那里也正好需要显示倍率。

设置卡片反过来：它把后缀从显示名里剥掉（`modelName()`），倍率单独右对齐成列、优惠渲染成绿色胶囊，避免同一个数字出现两次。`NAME_TAG` 与 `catalog.ts` 的两条正则同构但锚定在末尾，名字中间的正常括号不会被误删。

清单里 `type: "image"`（或输出模态不含 text）的模型仍进卡片列表并标注「图像」，但不注册进 provider：DSH 是对话界面，只服务文本输出模型。实测 14 个模型中 12 个可对话。

读取顺序在 `apply()` 的 `reapply()` 里：**接口 → Loomy 生成的配置文件 → 内置快照**。接口失败（未登录、断网）时回落配置文件，配置文件也不存在（Windows 版 Loomy 根本不生成）时用内置快照，保证离线启动仍是一个可用的 provider。

### 登录态来源：macOS 与 Windows 不同

两个平台的落盘方式不一致，读取顺序为**先文件、后 localStorage**：

| 平台 | 位置 |
|---|---|
| macOS | `~/Library/Application Support/loomy/auth-session.json` |
| Windows | 无 sidecar 文件，session 存在渲染进程 localStorage 的 `loomy-auth-session` 键下（LevelDB） |

Windows 上 `auth-session.json` 根本不存在，因此仅按平台拼文件路径必然 ENOENT、所有请求 502。`readLoomyCredential()` 的做法是：先按 `authFile` / `LOOMY_AUTH_FILE` / 探测到的默认路径读文件；读不到或解析不出有效 session 时，回落到 `readLoomySessionFromStorage()`，扫描 `Local Storage/leveldb` 的 `*.log` / `*.ldb`，按键 `loomy-auth-session` 取出全部记录，以 `loggedInAt` 取最新一条。

LevelDB 追加写会产生同一键的多条记录，故不能取首个命中。

Windows 的记录里 `phone` 是完整手机号（另有 `maskedPhone` 字段），而 macOS 的 `phone` 本身就是脱敏值。`parseLoomyAuth()` 优先取 `maskedPhone`，并对不含 `*` 的 11 位号码自行脱敏，避免完整号码经状态端点进入浏览器。

## 浏览器端

卡片经 DSH slot 注册表注入：

```ts
ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
  name: 'settings.plugin.item',
  key: 'loomy',          // 必须与宿主端注册的命名空间一致
  priority: 30,
  inject: () => ({ t }),
}, LoomyPluginCard))
```

渲染需同时满足以下四项，缺一则卡片静默不渲染：

1. `package.json` 声明 `dsh.client`，`platform` 为字符串，`inject` 列出所需客户端包。
2. `exports["./client"]` 指向浏览器产物——`clientExportOf()` 只接受字符串，或带字符串 `default` 的对象。
3. 产物为 `window.__ModuleLoader__.load({ id, factory })` 包装的 CJS，React 与 DSH 客户端包保持 external。
4. **宿主端调用 `settings.installSection(ctx, ns, Config, config, hooks)` 注册命名空间。**

第 4 项最易遗漏。「插件配置」tab 渲染的是**宿主提供的命名空间 × 宣称该命名空间的卡片**的交集，命名空间无人提供则永不 dispatch。而「插件」tab 由 profile 的已安装条目驱动，缺第 4 项时插件仍会出现在列表中，该失败因此常被误判为安装成功。

关联两点：

- `ctx.llm.registerConfigurableProviders({ settingsNs })` 只作用于模型选择器，与该 tab 无关。
- `installSection` 在 attach 时**同步**调用一次 `onChange`，此时 adapter 可能尚未建立，回调需容忍该时序（`reapply?.()`）。

卡片的视觉外壳复刻自 DSH 自带插件卡片。该外壳在 `@deepseek-ai/dsh-client-ui-settings-plugins` 中为包内私有（运行时仅导出 `apply`/`inject`），故 `src/client/card-css.ts` 在 `dlc_` 私有类名前缀下复现其计算样式。图标与按钮复用 `@deepseek-ai/dsh-client-ui-primitives`（声明于 `dsh.client.external`，从 DSH 种子模块表解析），保持 external 使浏览器产物维持在 ~18 kB 而非 ~450 kB。

浏览器端注册整体包在 `try`/`catch` 内：DSH slot API 变更时降级为一条 `console.error`，模型通道不受影响。

## cordis `Config` schema

cordis 解析 loader 条目配置的方式：

```js
if (!runtime.Config) return config                                  // 无 schema → 透传原值
return runtime.Config['~standard'].validate(config).value            // 有 schema → 校验并填默认值
```

插件**必须导出运行时 `Config` schema**。仅声明 TypeScript `interface Config` 会在编译期被擦除，cordis 透传 loader 原始值（patch 无 `config:` 块时为 `undefined`），读取其字段会直接中断整棵插件树的加载（`Cannot read properties of undefined (reading 'authFile')`）。本项目导出 schemastery schema，并额外将 `apply` 入参默认置为 `{}`。

## 浏览器产物加载不在启动时校验

DSH 启动时不检查 `exports["./client"]`，指向不存在的文件仍能正常启动。确认浏览器半边已加载，需拉取首页引导清单，检查插件包名是否出现在客户端模块列表中。

## 状态端点

```
GET /plugins/dsh-loomy-connect/status
```

仅接受 `GET`（否则 `405`）；`Host` 必须为 loopback，浏览器携带的 `Origin` 亦须为 loopback（否则 `403`）。响应不含凭据材料，错误消息经脱敏过滤。

响应是以 `status` 为判别式的联合类型：

```ts
type LoomyWebStatus =
  | { status: 'signed-out' }
  | { status: 'signed-in'; account?: string; modelCount: number; points?: LoomyWebPoints; pointsError?: string }
  | { status: 'error'; message: string }
```

```ts
interface LoomyWebPoints {
  permanent: number   // 永久积分
  daily: number       // 每日赠送积分
  updatedAt?: string  // Loomy 上次刷新的 ISO 时间戳
}
```

`account` 为 Loomy 已脱敏的手机号；`points` 在 Loomy 从未缓存积分摘要时省略；读取失败降级为 `pointsError`，不影响整个文档。

## 积分数据来源

Loomy 未对外暴露积分的 HTTP 接口：模型网关对 `/v1/credits` 返回 `404`（`scripts/probe-credits.mjs` 可复现），渲染进程经 `window.electronAPI.points.*` IPC 获取，仅运行中的 App 能应答。

唯一可行的外部读法是读 Loomy 自身的 `localStorage` 缓存。渲染进程将键 `loomy-points-summary`（结构 `{ balance, dailyBalance, updatedAt }`）写入 `Local Storage/leveldb`，Loomy 侧边栏同样读该缓存，故卡片与 App 的数值一致。

LevelDB 为追加写日志，同一键的旧值残留于文件中。`src/points.ts` 的处理：

- 扫描全部 `*.log` / `*.ldb`，提取所有候选记录；
- 按 `updatedAt` 取最新一条，而非信任文件顺序；
- 按目录 mtime/size 记忆化，避免轮询重复读取数 MB 日志；
- 无缓存时返回 `undefined`，不伪造 `0`。

## 安全实现

| 边界 | 实现位置 |
|---|---|
| 仅绑定 `127.0.0.1` | `src/shim.ts` 建监听时指定 host |
| 随机密钥 + `timingSafeEqual` | `src/shim.ts`，进程启动时 `randomBytes(32)` |
| loopback `Host` 校验 | `src/loopback.ts` → `loopbackHost()` |
| loopback `Origin` + `application/json` | `src/loopback.ts` → `loopbackOrigin()` |
| session token 不出网关 | `src/auth.ts` 每请求从磁盘/localStorage 解析，仅网关持有 |
| 状态路由脱敏 | `src/web-status.ts` 过滤 token 形字符串 |

## 对外 API

以下从包根导出，供复用与测试：

| 导出 | 类别 |
|---|---|
| `name`, `inject`, `Config`, `apply` | 插件入口 |
| `createLoomyAdapter`, `LOOMY_PROVIDER`, `LoomyAdapter` | Provider 适配层 |
| `createLoomyShim`, `resolveAuthFile`, `LoomyShim`, `LoomyShimOptions` | 网关 |
| `LoomyCatalog`, `parseLoomyApiModels`, `parseLoomyModels`, `LoomyModel` | 模型发现 |
| `defaultLoomyAuthPath`, `defaultLoomyConfigPath`, `LOOMY_AUTH_SESSION_KEY`, `extractLoomyAuthSessions`, `parseLoomyAuth`, `readLoomyCredential`, `readLoomySessionFromStorage`, `LoomyCredential` | 登录态 |
| `LOOMY_API_BASE`, `LoomyUpstreamClient`, `prepareLoomyBody` | 上游客户端（对话与模型清单） |
| `loopbackHost`, `loopbackOrigin` | 请求校验 |
| `LOOMY_POINTS_KEY`, `defaultLoomyLocalStorageDir`, `extractLoomyPoints`, `newestLoomyPoints`, `parseLoomyPointsRecord`, `readLoomyPoints`, `resetLoomyPointsCache`, `LoomyPointsSummary` | 积分 |
| `LOOMY_STATUS_PATH`, `LoomyWebStatus`, `LoomyWebPoints` | 状态契约 |
| `loomyStatusHandler`, `loomyWebStatus`, `registerLoomyStatusRoute`, `LoomyStatusRouteOptions` | 状态路由 |

## 项目结构

| 路径 | 用途 |
|---|---|
| `cordis.patch.yml` | 插入 `llm-loomy` 条目的 DSH profile patch |
| `src/index.ts` | 插件入口：`name` / `inject` / `Config` / `apply` |
| `src/auth.ts` | 只读读取 Loomy 登录态、平台路径探测 |
| `src/catalog.ts` | 模型发现：接口优先，配置文件与内置快照兜底 |
| `src/upstream.ts` | 调用 Loomy 上游、归一化请求体 |
| `src/shim.ts` | 带凭据保护的回环网关 |
| `src/adapter.ts` | 注册进 DSH `llm` seam 的 pi-ai provider |
| `src/loopback.ts` | 共用的 loopback Host/Origin 校验 |
| `src/points.ts` | 从 Loomy LevelDB `localStorage` 读积分 |
| `src/leveldb.ts` | LevelDB `localStorage` 读取器（登录态与积分共用） |
| `src/status-paths.ts` | 两端共用、不依赖 Node 的常量与类型 |
| `src/web-status.ts` | 状态路由与文档组装 |
| `src/client/index.tsx` | 浏览器入口：slot 注册、locale 命名空间 |
| `src/client/LoomyPluginCard.tsx` | 设置卡片组件 |
| `src/client/card-css.ts` | 带命名空间的 DSH 插件卡片外壳复刻 |
| `src/client/locales.ts` | 卡片文案（zh / en） |
| `scripts/*.mjs` | 只读诊断与探针脚本 |

## 开发

```sh
pnpm install
pnpm run check        # tsc --noEmit（宿主 + 浏览器）后由 tsdown 打包至 lib/
```

只读诊断脚本：

```sh
node scripts/live-e2e.mjs [模型ID]         # adapter → pi-ai → 网关 → Loomy 上游全链路
node scripts/probe-upstream.mjs [模型ID]   # 上游原始 SSE
node scripts/probe-shim.mjs [模型ID]       # 仅本机网关
node scripts/probe-adapter.mjs [模型ID]    # pi-ai 适配层，逐 chunk 输出
node scripts/probe-credits.mjs             # 复现 /v1/credits 的 404
node scripts/probe-dsh-runtime.mjs         # 真实 dsh web 进程内加载插件并走鉴权
```
