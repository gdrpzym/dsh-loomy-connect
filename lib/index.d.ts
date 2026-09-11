import Schema from "@deepseek-ai/schemastery";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { IncomingMessage, ServerResponse } from "node:http";
import { Context } from "@deepseek-ai/cordis";
//#region src/catalog.d.ts
interface LoomyModel {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  supportsImages: boolean;
  reasoning: boolean;
}
declare function parseLoomyModels(text: string): readonly LoomyModel[];
declare class LoomyCatalog {
  private models;
  current(): readonly LoomyModel[];
  refresh(configFile?: string): Promise<void>;
}
//#endregion
//#region src/shim.d.ts
interface LoomyShim {
  ready: Promise<void>;
  baseUrl(): string;
  token(): string;
  close(): Promise<void>;
}
/**
 * Where the desktop app's auth file lives. A thunk is accepted so the value the
 * Plugin configuration card writes takes effect on the next request instead of
 * only after a Harness restart — the shim is built before settings attach.
 */
type LoomyAuthFile = string | (() => string | undefined);
interface LoomyShimOptions {
  catalog: LoomyCatalog;
  authFile?: LoomyAuthFile;
  logger?: {
    warn(...args: unknown[]): void;
  };
}
/** Resolve a possibly-dynamic auth-file location at call time. */
declare function resolveAuthFile(value: LoomyAuthFile | undefined): string | undefined;
declare function createLoomyShim(options: LoomyShimOptions): LoomyShim;
//#endregion
//#region src/adapter.d.ts
declare const LOOMY_PROVIDER = "loomy";
/** What {@link createLoomyAdapter} hands back. */
interface LoomyAdapter {
  adapter: PiAiAdapter;
  /** Rebuild the adapter's provider snapshot; call after a catalog update. */
  invalidate(): void;
}
declare function createLoomyAdapter(catalog: LoomyCatalog, shim: LoomyShim): LoomyAdapter;
//#endregion
//#region src/auth.d.ts
interface LoomyCredential {
  session: string;
  userId: string;
  /** Already-masked phone number Loomy stores alongside the session, for display only. */
  maskedPhone?: string;
}
declare function defaultLoomyAuthPath(): string;
declare function defaultLoomyConfigPath(): string;
declare function parseLoomyAuth(text: string): LoomyCredential | undefined;
declare function readLoomyCredential(authFile?: string): Promise<LoomyCredential>;
//#endregion
//#region src/upstream.d.ts
declare const LOOMY_API_BASE = "https://loomyad.xunfei.cn/api/v1";
declare class LoomyUpstreamClient {
  chatStream(credential: LoomyCredential, body: string, signal?: AbortSignal): Promise<Response>;
}
/** Preserve tool calls; add the options Loomy sends for agent conversations. */
declare function prepareLoomyBody(source: string): string;
//#endregion
//#region src/loopback.d.ts
/**
 * Shared loopback gates for the plugin's local HTTP surfaces: the credential
 * shim and the same-origin web-status route. Both are only ever meant to be
 * addressed through the machine's loopback interface.
 *
 * @module dsh-loomy-connect/loopback
 */
/**
 * A `Host` header value names loopback. A DNS-rebinding page (an attacker
 * domain re-resolved to 127.0.0.1) still sends its own domain in `Host`, so
 * this check drops those before any routing happens.
 */
declare function loopbackHost(value: string | undefined): boolean;
/**
 * A browser-sent `Origin` must be loopback. Non-browser clients (the OpenAI
 * client pi-ai drives) send no `Origin` at all and pass.
 */
declare function loopbackOrigin(value: string | undefined): boolean;
//#endregion
//#region src/points.d.ts
/**
 * Read Loomy's own points summary straight off disk.
 *
 * Loomy is an Electron app whose renderer keeps the account's points summary in
 * `localStorage` under the key `loomy-points-summary`, shaped
 * `{ balance, dailyBalance, updatedAt, … }`. Loomy's own sidebar reads that
 * cache to render 永久积分 / 每日赠送积分, so the numbers the card shows are
 * the same numbers the user sees in the app.
 *
 * There is no documented HTTP endpoint for this: the model gateway at
 * `loomyad.xunfei.cn` answers 404 for `/v1/credits`, and the points calls the
 * renderer makes go through `window.electronAPI.points.*` IPC, which only the
 * running app can serve. Reading the cache is therefore the only external way
 * to get these numbers, and it is read-only.
 *
 * Chromium's `localStorage` lives in a LevelDB log, which is append-only: a
 * key's old values stay in the file behind newer ones. We parse every candidate
 * record and keep the newest by `updatedAt` rather than trusting file order.
 *
 * @module dsh-loomy-connect/points
 */
/** The localStorage key Loomy's renderer writes the points summary to. */
declare const LOOMY_POINTS_KEY = "loomy-points-summary";
/** One account's points split the way Loomy's own UI presents it. */
interface LoomyPointsSummary {
  /** Long-lived points — Loomy labels these 永久积分. */
  permanent: number;
  /** Points refilled each sign-in day — Loomy labels these 每日赠送积分. */
  daily: number;
  /** ISO timestamp of the last time Loomy refreshed the summary. */
  updatedAt?: string;
}
/** Default location of Loomy's Electron localStorage LevelDB. */
declare function defaultLoomyLocalStorageDir(): string;
/** Parse one cached record, keeping only the fields the card renders. */
declare function parseLoomyPointsRecord(raw: string): LoomyPointsSummary | undefined;
/** Every cached summary in one LevelDB log, oldest first. */
declare function extractLoomyPoints(text: string): LoomyPointsSummary[];
/** Newest record wins; `updatedAt` decides, file order breaks ties. */
declare function newestLoomyPoints(records: readonly LoomyPointsSummary[]): LoomyPointsSummary | undefined;
/**
 * Read the account's points summary from Loomy's localStorage.
 *
 * Returns `undefined` when Loomy has never cached a summary (or is not
 * installed) so the card can degrade instead of showing a bogus zero.
 */
declare function readLoomyPoints(dir?: string): Promise<LoomyPointsSummary | undefined>;
/** Drop the memoized read; tests and the status route use this. */
declare function resetLoomyPointsCache(): void;
//#endregion
//#region src/status-paths.d.ts
/** Node-free constants and types shared by the Host and browser halves. */
/** Plugin-owned status endpoint consumed by its browser half. */
declare const LOOMY_STATUS_PATH = "/plugins/dsh-loomy-connect/status";
/** The account's points split the way Loomy's own UI presents it. */
interface LoomyWebPoints {
  /** Long-lived points — Loomy labels these 永久积分. */
  permanent: number;
  /** Points refilled each sign-in day; 每日赠送积分. Resets to 5000 daily. */
  daily: number;
  /** ISO timestamp of Loomy's last refresh, so the card can show staleness. */
  updatedAt?: string;
}
/** The JSON document the plugin card renders. */
type LoomyWebStatus = {
  status: 'signed-out';
} | {
  status: 'signed-in';
  /** Masked sign-in identity (Loomy stores a masked phone number). */
  account?: string;
  /** How many models the plugin is currently serving. */
  modelCount: number;
  points?: LoomyWebPoints;
  pointsError?: string;
} | {
  status: 'error';
  message: string;
};
//#endregion
//#region src/web-status.d.ts
/** Constructor dependencies. */
interface LoomyStatusRouteOptions {
  /** Current sign-in state; `undefined` means signed out. */
  credential: () => Promise<LoomyCredential | undefined>;
  /** Points summary, or `undefined` when Loomy has not cached one. */
  points: () => Promise<LoomyPointsSummary | undefined>;
  /** How many models the plugin currently serves. */
  modelCount: () => number;
}
/**
 * Assemble the card's status document. Points come from Loomy's own cache, so
 * a missing or unreadable cache degrades to `pointsError` rather than failing
 * the whole document.
 */
declare function loomyWebStatus(deps: LoomyStatusRouteOptions): Promise<LoomyWebStatus>;
/** The status route's request handler, extracted so tests can mount it on a bare server. */
declare function loomyStatusHandler(deps: LoomyStatusRouteOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
/** Mount the GET status route on an optional webServer context. */
declare function registerLoomyStatusRoute(ctx: Context, deps: LoomyStatusRouteOptions): void;
//#endregion
//#region src/index.d.ts
declare const name = "llm-loomy";
declare const inject: string[];
/**
 * Runtime config schema. cordis resolves a loader entry's config through this
 * schema before calling `apply`. Without a schema it passes the raw value
 * straight through — `undefined` for an entry whose patch has no `config:`
 * block — and reading a field off that aborts the entire plugin tree at boot.
 */
declare const Config: Schema<Schemastery.ObjectS<{
  authFile: Schema<string, string>;
  configFile: Schema<string, string>;
}>, Schemastery.ObjectT<{
  authFile: Schema<string, string>;
  configFile: Schema<string, string>;
}>>;
/** Config as seen inside {@link apply}. */
interface ConfigShape {
  authFile?: string;
  configFile?: string;
}
/**
 * Settings namespace owning this provider's configuration section.
 *
 * The Plugin configuration tab dispatches its cards by namespace, so this
 * string is load-bearing twice: the host half registers the namespace here and
 * the browser half registers its card under the same key. A namespace no host
 * serves is never dispatched — the card would exist and simply never render.
 */
declare const LOOMY_SETTINGS_NS = "loomy";
declare function apply(ctx: Context, config?: ConfigShape): void;
//#endregion
export { Config, ConfigShape, LOOMY_API_BASE, LOOMY_POINTS_KEY, LOOMY_PROVIDER, LOOMY_SETTINGS_NS, LOOMY_STATUS_PATH, type LoomyAdapter, type LoomyAuthFile, LoomyCatalog, type LoomyCredential, type LoomyModel, type LoomyPointsSummary, type LoomyShim, type LoomyShimOptions, type LoomyStatusRouteOptions, LoomyUpstreamClient, type LoomyWebPoints, type LoomyWebStatus, apply, createLoomyAdapter, createLoomyShim, defaultLoomyAuthPath, defaultLoomyConfigPath, defaultLoomyLocalStorageDir, extractLoomyPoints, inject, loomyStatusHandler, loomyWebStatus, loopbackHost, loopbackOrigin, name, newestLoomyPoints, parseLoomyAuth, parseLoomyModels, parseLoomyPointsRecord, prepareLoomyBody, readLoomyCredential, readLoomyPoints, registerLoomyStatusRoute, resetLoomyPointsCache, resolveAuthFile };