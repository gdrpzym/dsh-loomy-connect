# DSH Loomy Connect

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[简体中文](README.md) | English

Exposes the text models bundled with the **Loomy** desktop app to [DeepSeek Harness](https://github.com/deepseek-ai) (DSH), without an API key.

The plugin reads Loomy's on-disk sign-in session and model manifest **read-only** and serves them to DSH through a per-process HTTP gateway bound to `127.0.0.1`, speaking the OpenAI wire format. Nothing is copied, uploaded, or rewritten.

One package, two contributions:

| Contribution | Surface | Description |
|---|---|---|
| Model provider | Host (`llm` seam) | Registers a `loomy` provider; the model list is discovered from Loomy at startup |
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
- [Acknowledgments](#acknowledgments)

---

## Requirements

| | |
|---|---|
| **Loomy desktop app** | Installed and signed in at least once |
| **DeepSeek Harness** | `>= 0.1.5-rc.1` |
| **Node.js** | `>= 22` |

Loomy is an Electron application. The plugin depends only on files Loomy itself writes; no Loomy-side plugin or credential is involved.

## Installation

From GitHub:

```sh
dsh plugin --profile web add github:gdrpzym/dsh-loomy-connect
dsh web
```

From a local checkout — preferred while developing, since it needs no publish step:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-loomy-connect
dsh web
```

`lib/` is committed, so a GitHub install needs no local toolchain. The package's `prepare` script rebuilds on install to keep artifacts in sync with sources.

### Verifying

```sh
dsh --profile web --dump-config     # expect an `llm-loomy` entry
```

`--dump-config` only composes the config tree; it does not instantiate the plugin. To confirm the plugin actually boots, run `dsh web` and check for **Loomy** in the model selector, or run the runtime probe:

```sh
node scripts/probe-dsh-runtime.mjs
```

## Configuration

Paths are auto-detected per platform, so configuration is normally unnecessary. The overrides below target non-standard installs.

### Config schema

Declared as a runtime [schemastery](https://github.com/shigma/schemastery) `Config` export. See [cordis `Config` schema](#cordis-config-schema) for why a runtime value is mandatory.

| Field | Type | Description |
|---|---|---|
| `authFile` | `string` | Path to Loomy's `auth-session.json`. Defaults to the detected platform location. |
| `configFile` | `string` | Path to Loomy's generated `opencode.json`. Defaults to the detected platform location. |

### Environment variables

| Variable | Overrides |
|---|---|
| `LOOMY_AUTH_FILE` | `authFile` |
| `LOOMY_CONFIG_FILE` | `configFile` |
| `LOOMY_LOCAL_STORAGE_DIR` | Detected Loomy `Local Storage/leveldb` directory |

Resolution order per lookup: **plugin config → environment variable → detected default**.

### Default paths

Candidates are probed in the order listed and the first existing path wins, so one build works across macOS, Windows, and Linux.

| Platform | Sign-in session | Model manifest | Credits cache |
|---|---|---|---|
| macOS | `~/Library/Application Support/loomy/auth-session.json` | `~/.config/loomy-opencode/opencode.json` | `~/Library/Application Support/loomy/Local Storage/leveldb` |
| Windows | `%APPDATA%/loomy/auth-session.json` | `%APPDATA%/loomy-opencode/opencode.json` | `%APPDATA%/loomy/Local Storage/leveldb` |
| Linux | `~/.config/loomy/auth-session.json` | `~/.config/loomy-opencode/opencode.json` | `~/.config/loomy/Local Storage/leveldb` |

`XDG_CONFIG_HOME` is honoured wherever Loomy uses an XDG-style layout. When no candidate exists yet, the first (macOS) candidate is returned as the nominal default.

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

### Host half

| Module | Role |
|---|---|
| `src/auth.ts` | Resolves and parses Loomy's sign-in session (`session`, `userid`, masked `phone`) |
| `src/catalog.ts` | Parses `provider.imodel.models` from Loomy's manifest; keeps models whose output includes text; falls back to a pinned list |
| `src/upstream.ts` | Calls Loomy's OpenAI-compatible endpoint and normalises the request body |
| `src/shim.ts` | Loopback gateway: injects credentials, streams SSE, enforces host/origin/auth checks |
| `src/adapter.ts` | Builds the pi-ai provider and registers it with DSH's `llm` seam |
| `src/points.ts` | Reads Loomy's `localStorage` credits cache from LevelDB |
| `src/web-status.ts` | Assembles and serves the browser card's status document |

The gateway listens on an ephemeral port on `127.0.0.1` with a per-process random secret. DSH holds only that secret; the Loomy session token is resolved from disk inside the gateway on each request and never leaves it.

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

| Symptom | Cause |
|---|---|
| Card never appears under Plugin configuration | Host half is not calling `installSection`; check condition 4 in [Browser half](#browser-half) |
| Plugin listed under Plugins but no card | Same as above — the Plugins tab reflects installed entries, not served namespaces |
| `Cannot read properties of undefined (reading 'authFile')` at boot | Missing runtime `Config` export; see [cordis `Config` schema](#cordis-config-schema) |
| Card shows "not signed in" though Loomy is signed in | Session path not detected; set `authFile` or `LOOMY_AUTH_FILE` |
| `502` on every chat request | Gateway could not read a valid session — on Windows/Linux usually an undetected auth path |
| Model list is stale | The catalog is read at startup; restart DSH or trigger a settings change |
| Credits empty | Loomy has not cached a summary yet, or `LOOMY_LOCAL_STORAGE_DIR` is wrong |

## License

[MIT](LICENSE)

## Disclaimer

- This project is for **personal learning and research only**. It drives your own Loomy account on your own machine. Do not use it commercially or beyond reasonable personal use.
- You must comply with the Loomy terms of service. Any consequence of using this project — including account restrictions, depleted credits, or service interruption — is yours to bear.
- The author is not liable for any direct or indirect loss arising from the use or misuse of this project.
- This project is not affiliated with, endorsed by, or sponsored by Loomy, iFlytek, or DeepSeek. Product names are used to describe compatibility only; trademarks belong to their respective owners.

## Acknowledgments

The DSH provider architecture follows [dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect) (MIT).
