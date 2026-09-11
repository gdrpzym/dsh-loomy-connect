# DSH Loomy Connect

**English** — Use the text models bundled with the Loomy desktop app inside DeepSeek Harness, without pasting an API key. The plugin reads Loomy's on-disk login session and model list *read-only* — it never copies, uploads, or rewrites them — and serves them to DSH through a short-lived gateway bound to `127.0.0.1`.

```sh
dsh plugin --profile web add github:gdrpzym/dsh-loomy-connect
dsh web
```

Then pick **Loomy** in DSH's model selector. Requires a signed-in Loomy desktop app and DSH `0.1.5-rc.1` or newer.

Aside from the model provider, it also contributes a card to **Settings → Plugin configuration** showing the signed-in account and Loomy's credit balance (permanent + daily gift).

---

将已登录 Loomy 桌面 App 中提供的文字模型自动接入 DeepSeek Harness。插件只读取 Loomy 本地的登录态与模型配置，不会复制、上传或改写它们。

## 安装

前提：已安装并登录 Loomy 桌面 App，且 DeepSeek Harness 为 `0.1.5-rc.1` 或更新版本。

从 GitHub 安装：

```sh
dsh plugin --profile web add github:gdrpzym/dsh-loomy-connect
dsh web
```

或从本地目录安装（开发时更常用）：

```sh
dsh plugin --profile web add /绝对路径/dsh-loomy-connect
dsh web
```

仓库已提交 `lib/` 构建产物，因此从 GitHub 安装时无需本地打包；同时 `prepare` 脚本会在安装时自动重新构建一次，保证产物与源码一致。

在 DSH 对话窗口的模型选择器中选择 **Loomy** 即可。每次 DSH 启动时会读取 Loomy 当前的 `imodel` 模型清单，因此 Loomy 升级或服务端调整模型后无需在 DSH 填写 API Key。

默认 macOS 文件位置为：

- 登录态：`~/Library/Application Support/loomy/auth-session.json`
- 模型清单：`~/.config/loomy-opencode/opencode.json`

可选地使用插件配置中的 `authFile` 和 `configFile` 覆盖位置；也可使用 `LOOMY_AUTH_FILE` 与 `LOOMY_CONFIG_FILE` 环境变量。该能力主要用于 Windows/Linux 或非标准安装目录。

## 设置界面里的插件卡片

安装后，DSH 的 **设置 → 插件配置** 会出现一张 **DSH Loomy Connect** 卡片，展开后显示：登录账号（掩码手机号）、**永久积分**与**每日赠送积分**、积分更新时间、以及当前接入的模型数量。每分钟自动刷新，也可手动点「刷新」。

### 积分数据从哪来

Loomy 没有对外暴露积分的 HTTP 接口：模型网关 `loomyad.xunfei.cn` 对 `/v1/credits` 一律 404（`scripts/probe-credits.mjs` 可复现），而渲染进程取积分走的是 `window.electronAPI.points.*` 这条 IPC，只有运行中的 App 能应答。

可行且唯一的外部读法，是读 Loomy 自己的 localStorage 缓存：Electron 把 `loomy-points-summary` 这个键写在
`~/Library/Application Support/loomy/Local Storage/leveldb/` 里，值为
`{ balance, dailyBalance, updatedAt }` —— `balance` 即 **永久积分**，`dailyBalance` 即 **每日赠送积分**（每日登录后刷新为 5000）。Loomy 自己的侧边栏也是读这份缓存来显示的，所以卡片上的数字与 App 里一致。

LevelDB 是追加写日志，同一个键的历史值会留在文件里，因此 `src/points.ts` 解析出全部候选记录后按 `updatedAt` 取最新一条，而不是信任文件顺序；并按目录 mtime 做记忆化，避免轮询时反复读日志。缓存不存在时卡片显示「还没有积分快照」，不会显示假的 0。

### 浏览器端是怎么挂上去的

DSH 的插件可以是「双面的」。插件只注册 provider 时在界面上完全不可见，想贡献一张卡片必须**四条同时满足**，缺任何一条都是静默失败：

**客户端那半（三条）**

1. `package.json` 里声明 `dsh.client`（`platform` 必须是字符串，`inject` 列出要激活的客户端包）
2. `exports["./client"]` 指向浏览器端产物 —— DSH 的 `clientExportOf()` 只认字符串或带字符串 `default` 的对象
3. 构建产物必须是 `window.__ModuleLoader__.load({ id, factory })` 包装的 CJS，React 与所有 DSH 客户端包保持 external

**宿主端那半（一条，也是最容易漏的一条）**

4. 宿主端必须调用 `settings.installSection(ctx, '<ns>', Config, config, hooks)` 把这个 settings 命名空间**提供**出来。

「设置 → 插件配置」这个 tab 渲染的是**两张账本的交集**：宿主端提供的命名空间 × 客户端注册的卡片。DSH 源码注释写得很直白：*a card whose namespace the Host does not serve is never dispatched*。所以只做客户端那半时，卡片的注册代码确实执行了、slot 也注册上了，但因为宿主端从没提供过这个命名空间，dispatch 永远不会发生 —— 卡片存在，却永不渲染。而「插件列表」是另一套数据（已安装插件清单），所以那种情况下它仍然可见，很容易让人误判为「装好了」。

注意 `ctx.llm.registerConfigurableProviders({ settingsNs })` 跟这个 tab **毫无关系**，它只喂模型选择器，别指望它能让你出现在插件配置里。

另外 `installSection` 在 attach 时会**同步**调用一次 `onChange`，那时 adapter 可能还没建好，需要用可选调用（`reapply?.()`）兜住；命名空间名要是小写连字符标识符。

浏览器半边通过 `ctx.slots.inject('settings.plugin.item', …)` 注册卡片（注意 slot 字段名是 `key`/`priority`，早期版本写作 `id`/`order`），并从插件自己的同源端点 `GET /plugins/dsh-loomy-connect/status` 取数据。整个注册过程包在 try/catch 里：万一 DSH 的 slot API 变了，只会往控制台打一条 error，模型通道照常工作。

卡片的视觉要跟官方卡片一致，得注意官方那层外壳（header 的 `<button>`、chevron、颜色变量）是 `dsh-client-ui-settings-plugins` **包内私有**的，运行时只导出 `apply`/`inject`，第三方 import 不到。本项目在 `src/client/card-css.ts` 里按计算样式逐项复刻，图标与按钮则直接复用官方原语 —— 见下条。

#### 白拿官方 UI 原语：平台种子模块表

DSH 组装浏览器端模块系统时，会传入一张固定的**种子模块表**：

```
react, react/jsx-runtime, react-dom, react-dom/client,
@deepseek-ai/cordis, @deepseek-ai/dsh-client-store,
@deepseek-ai/dsh-client-ui-slots,
@deepseek-ai/dsh-client-ui-primitives,
@deepseek-ai/dsh-client-ui-dockkit
```

`require` 的解析顺序是「种子表 → 已物化 → 已注册 → 抛错」，所以这些名字**不需要出现在首页引导图里也能 require 到**。声明方式是在 `dsh.client.external` 里列出包名（文档说法：*a static-table name that adds no graph edge*），构建时保持 external 即可。

本项目的 chevron 图标、`StateDot`、`Button`、`Tag` 都直接来自 `@deepseek-ai/dsh-client-ui-primitives`，client 产物因此只有 ~18 kB；若把整包打进去要多 ~430 kB。

要确认浏览器半边真的被加载，**不能只看 `dsh web` 能不能起来** —— DSH 不在启动时校验 `exports["./client"]`（把它指向不存在的文件照样正常启动）。唯一可靠的办法是取首页引导图，看自己的包名是否在客户端模块清单里。

该端点只接受 GET，且要求 loopback Host 与 loopback Origin（非 200 即 403/405），返回体里不含任何 token。

## 安全边界

请求经绑定到 `127.0.0.1` 的短生命周期网关转发；DSH 进程只持有网关随机密钥，Loomy 的 session token 仅由网关在每次请求时从本地文件读取。网关另外校验 loopback Host、loopback Origin 与 `application/json` 请求体，以挡住 DNS 重绑定与跨站简单请求。

## 开发

```sh
pnpm install          # 若 registry 不稳定，可加 --registry https://registry.npmmirror.com
pnpm run check        # tsc --noEmit + tsdown 打包，产物在 lib/

node scripts/live-e2e.mjs [model-id]         # 全链路：adapter → pi-ai → 网关 → Loomy 真实上游
node scripts/probe-upstream.mjs [model-id]   # 只探 Loomy 上游原始 SSE
node scripts/probe-shim.mjs [model-id]       # 只探本机网关
node scripts/probe-adapter.mjs [model-id]    # 只探 pi-ai 适配层，打印每个 chunk

# 先另开一个终端 `dsh web`，再运行：验证插件在真实 DSH 进程内已加载、网关已监听且鉴权生效
node scripts/probe-dsh-runtime.mjs
```

`dsh --profile web --dump-config` 可确认插件已被组合进 profile 配置树（应出现 `id: llm-loomy`）。

**但 `--dump-config` 只组合配置树、不会实例化插件**，所以 `apply()` 内部的错误它查不出来。要确认插件真的能随 DSH 起来，必须用 `probe-dsh-runtime.mjs`，或直接跑一次 `dsh web`。

### 一个必须知道的坑：`Config` schema

cordis 的 `resolveConfig` 逻辑是：

```js
if (!runtime.Config) return config        // 没导出 Config → 原始值原样透传
return runtime.Config['~standard'].validate(config).value   // 有导出 → 校验并补默认值
```

插件**必须导出一个运行时的 `Config` schema**（本项目用 `@deepseek-ai/schemastery`）。只写 TypeScript 的 `interface Config` 是不行的——interface 在编译后会被擦除，cordis 于是把 loader 条目的原始配置透传进来；补丁里没写 `config:` 块时那就是 `undefined`，读它的字段会让**整棵插件树加载失败，DSH 直接退出**（报错形如 `Cannot read properties of undefined (reading 'authFile')`，堆栈指向 `apply`）。此外 `apply` 的参数也加了 `= {}` 兜底。

## 结构

| 文件 | 作用 |
|---|---|
| `cordis.patch.yml` | DSH 层补丁：插入 `llm-loomy` 条目注册 provider |
| `src/auth.ts` | 只读 Loomy 登录态 |
| `src/catalog.ts` | 从 Loomy 生成的 OpenCode 配置发现文字模型 |
| `src/upstream.ts` | Loomy 的 OpenAI 兼容上游调用与请求体改写 |
| `src/shim.ts` | 带凭据保护的 loopback 网关 |
| `src/adapter.ts` | 注册进 DSH LLM seam 的 pi-ai provider |
| `src/index.ts` | 插件入口（`name` / `inject` / `Config` schema / `apply`） |
| `src/loopback.ts` | 网关与状态路由共用的 loopback Host/Origin 校验 |
| `src/points.ts` | 从 Loomy 的 localStorage 缓存读取积分（永久 + 每日赠送） |
| `src/status-paths.ts` | 宿主与浏览器共享的端点常量与类型 |
| `src/web-status.ts` | `/plugins/dsh-loomy-connect/status` 端点与状态文档组装 |
| `src/client/index.tsx` | 浏览器端入口：注册设置页卡片槽位与中英文案 |
| `src/client/LoomyPluginCard.tsx` | 设置页卡片组件（账号 + 永久/每日赠送积分 + 模型数） |
| `src/client/card-css.ts` | 逐项复刻官方卡片外壳的样式（官方那份是包内私有的，import 不到） |
| `src/client/locales.ts` | 中英文案 |
| `scripts/*.mjs` | 只读诊断脚本（探上游 / 探网关 / 探适配层 / 全链路 e2e） |

## 致谢

本项目参考了 [dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect) 的 DSH provider 架构（MIT）。
