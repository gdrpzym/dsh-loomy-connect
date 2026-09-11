# Internals

[简体中文](internals.md) | English

For maintainers and DSH plugin authors. Usage-level documentation lives in [README.en.md](../README.en.md).

## Contents

- [Architecture](#architecture)
- [Host half](#host-half)
- [Browser half](#browser-half)
- [cordis `Config` schema](#cordis-config-schema)
- [Browser bundle loading is not validated at startup](#browser-bundle-loading-is-not-validated-at-startup)
- [Status endpoint](#status-endpoint)
- [Credits: where the numbers come from](#credits-where-the-numbers-come-from)
- [Security implementation](#security-implementation)
- [Public API](#public-api)
- [Project layout](#project-layout)
- [Development](#development)

## Architecture

A dual-surface (host + browser) cordis plugin.

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

## Host half

| Module | Role |
|---|---|
| `src/auth.ts` | Resolves and parses Loomy's sign-in session (`session`, `userid`, masked `phone`) |
| `src/catalog.ts` | Parses `provider.imodel.models` from Loomy's manifest; keeps models whose output includes text; falls back to a pinned list |
| `src/upstream.ts` | Calls Loomy's OpenAI-compatible endpoint and normalises the request body |
| `src/shim.ts` | Loopback gateway: injects credentials, streams SSE, enforces host/origin/auth checks |
| `src/adapter.ts` | Builds the pi-ai provider and registers it with DSH's `llm` seam |
| `src/points.ts` | Reads Loomy's `localStorage` credits cache from LevelDB |
| `src/web-status.ts` | Assembles and serves the browser card's status document |
| `src/leveldb.ts` | LevelDB `localStorage` reader shared by both halves |

The gateway listens on an ephemeral port on `127.0.0.1` with a per-process random secret. DSH holds only that secret; the Loomy session token is resolved from disk inside the gateway on each request and never leaves it.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | Liveness |
| `GET` | `/v1/models` | Currently discovered model IDs |
| `POST` | `/v1/chat/completions` | Streaming chat; proxies to Loomy upstream |

Limits: 64 MiB request body, 20-minute request ceiling, upstream aborted when the client disconnects.

### Where the model list and rates come from

`GET {LOOMY_API_BASE}/models` (`https://loomyad.xunfei.cn/api/v1/models`, session required) returns every model the account can reach and is the only source that also carries the **rate**:

```jsonc
{ "id": "deepseek-v4-flash-0731", "name": "DeepSeek V4 Flash 0731（x3.0）",
  "type": "chat", "context_length": 1048576, "max_output_tokens": 384000,
  "capabilities": { "reasoning": true, "input_modalities": ["text"], "output_modalities": ["text"] } }
```

The rate and any promotion are not separate fields — Loomy writes them into the parenthesised suffix of `name` (`（x3.0）`, `（限时免费）`). `src/catalog.ts` parses both into structured `rate` / `promo` fields and leaves `name` untouched for the model selector, which wants the rate too.

The settings card does the opposite: it strips the suffix from the displayed name (`modelName()`), right-aligns the rate in its own column and renders a promotion as a green pill, so the same figure never appears twice. `NAME_TAG` mirrors the two catalog regexes but anchors to the end, so parentheses inside a name survive.

Models with `type: "image"` (or no text output modality) still appear in the card, marked as image, but are never registered with the provider: DSH is a chat surface. In practice 12 of the 14 models are servable.

`reapply()` resolves the catalog as **API → generated config file → built-in snapshot**. The API failing (signed out, offline) falls back to the config file, and when that is missing too — the Windows build never writes one — the built-in snapshot keeps an offline start usable.

### Sign-in source: macOS vs Windows

The two platforms persist the session differently, so reads go **file first, then localStorage**:

| Platform | Where |
|---|---|
| macOS | `~/Library/Application Support/loomy/auth-session.json` |
| Windows | No sidecar file — the session lives in the renderer's `localStorage` under `loomy-auth-session` (LevelDB) |

On Windows `auth-session.json` does not exist at all, so building a platform-specific file path alone yields ENOENT and a 502 on every request. `readLoomyCredential()` therefore reads `authFile` / `LOOMY_AUTH_FILE` / the detected default path first, and falls back to `readLoomySessionFromStorage()` when no usable session is there: it scans `*.log` / `*.ldb` under `Local Storage/leveldb`, collects every record under `loomy-auth-session`, and keeps the newest by `loggedInAt`.

LevelDB is append-only, so one key can appear several times; the first hit is not necessarily the current one.

The Windows record keeps the full phone number in `phone` (with a separate `maskedPhone` field), while macOS stores an already-masked value there. `parseLoomyAuth()` prefers `maskedPhone` and masks any 11-digit value without a `*`, so a full number never reaches the browser through the status route.

## Browser half

The card is contributed through DSH's slot registry:

```ts
ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
  name: 'settings.plugin.item',
  key: 'loomy',          // must match the host-registered namespace
  priority: 30,
  inject: () => ({ t }),
}, LoomyPluginCard))
```

All four conditions below must hold; otherwise the card silently never renders:

1. `package.json` declares `dsh.client`, with `platform` as a string and `inject` listing the required client packages.
2. `exports["./client"]` points at the browser bundle — `clientExportOf()` accepts only a string, or an object with a string `default`.
3. The browser bundle is CJS wrapped in `window.__ModuleLoader__.load({ id, factory })`, with React and all DSH client packages left external.
4. **The host half calls `settings.installSection(ctx, ns, Config, config, hooks)`**, registering the namespace.

Condition 4 is the one most often missed. The **Plugin configuration** tab renders the intersection of *namespaces the host serves* and *cards claiming those namespaces* — a card whose namespace no host serves is never dispatched. Because the **Plugins** tab is driven by the profile's installed-plugin entries instead, a plugin missing condition 4 still appears there, which makes the failure easy to misread as a working install.

Two related notes:

- `ctx.llm.registerConfigurableProviders({ settingsNs })` feeds the model selector only. It has no bearing on the Plugin configuration tab.
- `installSection` invokes `onChange` **synchronously** at attach time, before the adapter exists; the handler must tolerate that (`reapply?.()`).

The card's visual shell is a replica of DSH's own plugin cards. That shell is package-private in `@deepseek-ai/dsh-client-ui-settings-plugins` — the package exports only `apply`/`inject` at runtime — so `src/client/card-css.ts` reproduces the computed styles under a `dlc_` private class prefix. Icons and buttons come from `@deepseek-ai/dsh-client-ui-primitives`, which is listed in `dsh.client.external` and resolved from DSH's seed module table; keeping it external holds the browser bundle to ~18 kB instead of ~450 kB.

The browser registration is wrapped in `try`/`catch`. If DSH's slot API changes, the failure degrades to a `console.error` and the model provider keeps working.

## cordis `Config` schema

cordis resolves a loader entry's config as:

```js
if (!runtime.Config) return config                                  // no schema → raw passthrough
return runtime.Config['~standard'].validate(config).value           // schema → validate + defaults
```

A plugin **must export a runtime `Config` schema**. A TypeScript `interface Config` is erased at compile time, so cordis passes the raw loader value through — `undefined` when the patch has no `config:` block — and reading a field off it aborts the whole plugin tree at boot (`Cannot read properties of undefined (reading 'authFile')`). This project exports a schemastery schema and also defaults `apply`'s parameter to `{}`.

## Browser bundle loading is not validated at startup

DSH does not check `exports["./client"]` when starting; pointing it at a missing file still starts cleanly. To confirm the browser half is actually loaded, fetch the index bootstrap manifest and check that the plugin's package name appears in the client module list.

## Status endpoint

```
GET /plugins/dsh-loomy-connect/status
```

`GET` only (otherwise `405`); `Host` must be loopback and a browser-sent `Origin` must be loopback too (otherwise `403`). The response carries no credential material, and error messages are redaction-filtered.

Response — a discriminated union on `status`:

```ts
type LoomyWebStatus =
  | { status: 'signed-out' }
  | { status: 'signed-in'; account?: string; modelCount: number; points?: LoomyWebPoints; pointsError?: string }
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

The only viable external read is Loomy's own `localStorage` cache. The renderer stores the key `loomy-points-summary` — shaped `{ balance, dailyBalance, updatedAt }` — in `Local Storage/leveldb`, and Loomy's own sidebar renders from that same cache, so the card and the app agree by construction.

LevelDB is an append-only log, so superseded values for a key remain in the file. `src/points.ts` therefore:

- scans every `*.log`/`*.ldb` file and extracts all candidate records;
- selects the newest by `updatedAt` rather than trusting file order;
- memoizes on directory mtime/size so polling does not re-read multi-megabyte logs;
- returns `undefined` — never a synthetic `0` — when no cache exists.

## Security implementation

| Boundary | Where |
|---|---|
| Bind to `127.0.0.1` only | `src/shim.ts`, host passed when the listener is created |
| Random secret + `timingSafeEqual` | `src/shim.ts`, `randomBytes(32)` at process start |
| Loopback `Host` check | `src/loopback.ts` → `loopbackHost()` |
| Loopback `Origin` + `application/json` | `src/loopback.ts` → `loopbackOrigin()` |
| Session token never leaves the gateway | `src/shim.ts`, resolved from disk per request |
| Status route redaction | `src/web-status.ts`, filters token-shaped strings |

## Public API

Re-exported from the package root for reuse and testing:

| Export | Kind |
|---|---|
| `name`, `inject`, `Config`, `apply` | Plugin entry points |
| `createLoomyAdapter`, `LOOMY_PROVIDER`, `LoomyAdapter` | Provider adapter |
| `createLoomyShim`, `resolveAuthFile`, `LoomyShim`, `LoomyShimOptions` | Gateway |
| `LoomyCatalog`, `parseLoomyApiModels`, `parseLoomyModels`, `LoomyModel` | Model discovery |
| `defaultLoomyAuthPath`, `defaultLoomyConfigPath`, `LOOMY_AUTH_SESSION_KEY`, `extractLoomyAuthSessions`, `parseLoomyAuth`, `readLoomyCredential`, `readLoomySessionFromStorage`, `LoomyCredential` | Sign-in state |
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
| `src/catalog.ts` | Model discovery: API first, config file and snapshot as fallbacks |
| `src/upstream.ts` | Loomy upstream call and request-body normalisation |
| `src/shim.ts` | Credential-protected loopback gateway |
| `src/adapter.ts` | pi-ai provider registered into DSH's `llm` seam |
| `src/loopback.ts` | Shared loopback Host/Origin guards |
| `src/points.ts` | Credits read from Loomy's LevelDB `localStorage` cache |
| `src/leveldb.ts` | LevelDB `localStorage` reader shared by sign-in and credits |
| `src/status-paths.ts` | Node-free constants and types shared by both halves |
| `src/web-status.ts` | Status route and document assembly |
| `src/client/index.tsx` | Browser entry: slot registration, locale namespaces |
| `src/client/LoomyPluginCard.tsx` | Settings card component |
| `src/client/card-css.ts` | Namespaced replica of DSH's plugin card shell |
| `src/client/locales.ts` | Card copy (zh / en) |
| `scripts/*.mjs` | Read-only diagnostics and probes |

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
