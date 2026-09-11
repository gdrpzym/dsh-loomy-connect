# DSH Loomy Connect

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

简体中文 | [English](README.en.md)

将 **Loomy** 桌面应用内置的文本模型接入 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH），无需 API Key。

插件以只读方式读取 Loomy 落盘的登录态与模型清单，通过一个绑定 `127.0.0.1` 的进程内 HTTP 网关向 DSH 暴露 OpenAI 兼容接口。不复制、不上传、不改写 Loomy 的任何文件。

单个包提供两项能力：

| 能力 | 运行位置 | 说明 |
|---|---|---|
| 模型 Provider | 宿主端（`llm` seam） | 注册 `loomy` provider，模型列表在启动时从 Loomy 清单发现 |
| 设置卡片 | 浏览器端（`settings.plugin.item` slot） | 在 **设置 → 插件配置** 展示登录账号、积分余额与已接入模型数 |

---

## 目录

- [环境要求](#环境要求)
- [安装](#安装)
- [配置](#配置)
- [架构](#架构)
- [状态端点](#状态端点)
- [积分数据来源](#积分数据来源)
- [安全边界](#安全边界)
- [开发](#开发)
- [对外 API](#对外-api)
- [项目结构](#项目结构)
- [故障排查](#故障排查)
- [许可](#许可)
- [免责声明](#免责声明)
- [致谢](#致谢)

---

## 环境要求

| | |
|---|---|
| **Loomy 桌面应用** | 已安装，且至少登录过一次 |
| **DeepSeek Harness** | `>= 0.1.5-rc.1` |
| **Node.js** | `>= 22` |

Loomy 为 Electron 应用。插件只依赖 Loomy 自身写出的文件，无需在 Loomy 侧安装任何插件或申请凭证。

## 安装

从 GitHub 安装：

```sh
dsh plugin --profile web add github:gdrpzym/dsh-loomy-connect
dsh web
```

从本地目录安装（开发时推荐，无需发布步骤）：

```sh
dsh plugin --profile web add /绝对路径/dsh-loomy-connect
dsh web
```

`lib/` 随仓库提交，从 GitHub 安装不需要本地工具链。包内 `prepare` 脚本会在安装时重新构建，以保证产物与源码一致。

### 验证

```sh
dsh --profile web --dump-config     # 应出现 llm-loomy 条目
```

`--dump-config` 只组合配置树，不实例化插件。确认插件能否真正启动，需运行 `dsh web` 后检查模型选择器中是否出现 **Loomy**，或执行运行时探针：

```sh
node scripts/probe-dsh-runtime.mjs
```

## 配置

路径按平台自动探测，一般无需配置。以下覆盖项面向非标准安装。

### 配置项

以运行时 [schemastery](https://github.com/shigma/schemastery) `Config` 导出声明。为何必须是运行时值，见 [cordis `Config` schema](#cordis-config-schema)。

| 字段 | 类型 | 说明 |
|---|---|---|
| `authFile` | `string` | Loomy `auth-session.json` 路径，缺省取探测到的平台默认位置 |
| `configFile` | `string` | Loomy 生成的 `opencode.json` 路径，缺省取探测到的平台默认位置 |

### 环境变量

| 变量 | 覆盖对象 |
|---|---|
| `LOOMY_AUTH_FILE` | `authFile` |
| `LOOMY_CONFIG_FILE` | `configFile` |
| `LOOMY_LOCAL_STORAGE_DIR` | 探测到的 Loomy `Local Storage/leveldb` 目录 |

每项查找的优先级：**插件配置 → 环境变量 → 探测到的默认值**。

### 默认路径

候选按所列顺序探测，取第一个存在的路径，因此同一构建在 macOS / Windows / Linux 上通用。

| 平台 | 登录态 | 模型清单 | 积分缓存 |
|---|---|---|---|
| macOS | `~/Library/Application Support/loomy/auth-session.json` | `~/.config/loomy-opencode/opencode.json` | `~/Library/Application Support/loomy/Local Storage/leveldb` |
| Windows | `%APPDATA%/loomy/auth-session.json` | `%APPDATA%/loomy-opencode/opencode.json` | `%APPDATA%/loomy/Local Storage/leveldb` |
| Linux | `~/.config/loomy/auth-session.json` | `~/.config/loomy-opencode/opencode.json` | `~/.config/loomy/Local Storage/leveldb` |

Loomy 采用 XDG 布局的位置会遵循 `XDG_CONFIG_HOME`。若所有候选均不存在，返回首个（macOS）候选作为名义默认值。

## 架构

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

### 宿主端

| 模块 | 职责 |
|---|---|
| `src/auth.ts` | 定位并解析 Loomy 登录态（`session`、`userid`、已脱敏 `phone`） |
| `src/catalog.ts` | 从 Loomy 清单解析 `provider.imodel.models`，保留输出含文本的模型，失败时回落内置固定列表 |
| `src/upstream.ts` | 调用 Loomy 的 OpenAI 兼容端点，归一化请求体 |
| `src/shim.ts` | 回环网关：注入凭据、透传 SSE、执行 host/origin/鉴权校验 |
| `src/adapter.ts` | 构造 pi-ai provider 并注册进 DSH 的 `llm` seam |
| `src/points.ts` | 从 LevelDB 读取 Loomy `localStorage` 中的积分缓存 |
| `src/web-status.ts` | 组装并响应浏览器卡片的状态文档 |

网关监听 `127.0.0.1` 的随机空闲端口，使用进程内随机密钥。DSH 只持有该密钥；Loomy session token 在每次请求时于网关内部从磁盘解析，不外泄。

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/healthz` | 存活探测 |
| `GET` | `/v1/models` | 当前发现的模型 ID 列表 |
| `POST` | `/v1/chat/completions` | 流式对话，代理至 Loomy 上游 |

限制：请求体上限 64 MiB，单次请求上限 20 分钟，客户端断开时中断上游。

### 浏览器端

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

## 安全边界

| 边界 | 机制 |
|---|---|
| 网络暴露面 | 网关仅绑定 `127.0.0.1` |
| 客户端鉴权 | 进程内随机密钥，`timingSafeEqual` 比较 |
| DNS 重绑定 | `Host` 必须为 loopback——重绑定页面发来的是其自身域名 |
| 跨站简单请求 | 携带 `Origin` 时须为 loopback；请求体须为 `application/json` |
| Token 保管 | Loomy session token 仅在网关内按需从磁盘读取，DSH 不持有 |
| 浏览器侧暴露 | 状态路由对 token 形字符串脱敏，不返回凭据 |

威胁模型：防御本机其他进程与浏览器中运行的网页；**不**防御以同一用户身份运行的代码——其可读取插件所读的同样文件。

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

### 注意事项

#### cordis `Config` schema

cordis 解析 loader 条目配置的方式：

```js
if (!runtime.Config) return config                                  // 无 schema → 透传原值
return runtime.Config['~standard'].validate(config).value            // 有 schema → 校验并填默认值
```

插件**必须导出运行时 `Config` schema**。仅声明 TypeScript `interface Config` 会在编译期被擦除，cordis 透传 loader 原始值（patch 无 `config:` 块时为 `undefined`），读取其字段会直接中断整棵插件树的加载（`Cannot read properties of undefined (reading 'authFile')`）。本项目导出 schemastery schema，并额外将 `apply` 入参默认置为 `{}`。

#### 浏览器产物加载不在启动时校验

DSH 启动时不检查 `exports["./client"]`，指向不存在的文件仍能正常启动。确认浏览器半边已加载，需拉取首页引导清单，检查插件包名是否出现在客户端模块列表中。

## 对外 API

以下从包根导出，供复用与测试：

| 导出 | 类别 |
|---|---|
| `name`, `inject`, `Config`, `apply` | 插件入口 |
| `createLoomyAdapter`, `LOOMY_PROVIDER`, `LoomyAdapter` | Provider 适配层 |
| `createLoomyShim`, `resolveAuthFile`, `LoomyShim`, `LoomyShimOptions` | 网关 |
| `LoomyCatalog`, `parseLoomyModels`, `LoomyModel` | 模型发现 |
| `defaultLoomyAuthPath`, `defaultLoomyConfigPath`, `parseLoomyAuth`, `readLoomyCredential`, `LoomyCredential` | 登录态 |
| `LOOMY_API_BASE`, `LoomyUpstreamClient`, `prepareLoomyBody` | 上游客户端 |
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
| `src/catalog.ts` | 从 Loomy 清单发现文本模型 |
| `src/upstream.ts` | 调用 Loomy 上游、归一化请求体 |
| `src/shim.ts` | 带凭据保护的回环网关 |
| `src/adapter.ts` | 注册进 DSH `llm` seam 的 pi-ai provider |
| `src/loopback.ts` | 共用的 loopback Host/Origin 校验 |
| `src/points.ts` | 从 Loomy LevelDB `localStorage` 读积分 |
| `src/status-paths.ts` | 两端共用、不依赖 Node 的常量与类型 |
| `src/web-status.ts` | 状态路由与文档组装 |
| `src/client/index.tsx` | 浏览器入口：slot 注册、locale 命名空间 |
| `src/client/LoomyPluginCard.tsx` | 设置卡片组件 |
| `src/client/card-css.ts` | 带命名空间的 DSH 插件卡片外壳复刻 |
| `src/client/locales.ts` | 卡片文案（zh / en） |
| `scripts/*.mjs` | 只读诊断与探针脚本 |

## 故障排查

| 现象 | 原因 |
|---|---|
| 「插件配置」下始终无卡片 | 宿主端未调用 `installSection`，检查[浏览器端](#浏览器端)第 4 项 |
| 插件列表有条目但无卡片 | 同上——「插件」tab 反映已安装条目，非已提供命名空间 |
| 启动时 `Cannot read properties of undefined (reading 'authFile')` | 缺少运行时 `Config` 导出，见 [cordis `Config` schema](#cordis-config-schema) |
| Loomy 已登录，卡片显示未登录 | 登录态路径未探测到，设置 `authFile` 或 `LOOMY_AUTH_FILE` |
| 每次对话请求均 `502` | 网关读不到有效 session，Windows/Linux 上多为登录态路径未探测到 |
| 模型列表陈旧 | 模型清单在启动时读取，重启 DSH 或触发一次配置变更 |
| 积分为空 | Loomy 尚未缓存积分摘要，或 `LOOMY_LOCAL_STORAGE_DIR` 配置有误 |

## 许可

[MIT](LICENSE)

## 免责声明

- 本项目**仅供个人学习和研究使用**，仅驱动使用者本人的 Loomy 账号在本机调用，请勿用于商业用途或超出个人合理使用的场景。
- 使用者须遵守 Loomy 服务条款；因使用本项目产生的一切后果（包括但不限于账号被限制、额度被清空、服务中断）由使用者自行承担。
- 作者不对因使用或滥用本项目导致的任何直接或间接损失负责。
- 本项目与 Loomy、讯飞（iFlytek）、DeepSeek 均无关联，未获其授权或认可；文中名称仅用于描述兼容关系，商标权利归各自所有者。

## 致谢

DSH provider 架构参考 [dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect)（MIT）。
