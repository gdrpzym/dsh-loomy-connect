import Schema from "@deepseek-ai/schemastery";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";
function defaultLoomyAuthPath() {
	return join(homedir(), "Library", "Application Support", "loomy", "auth-session.json");
}
function defaultLoomyConfigPath() {
	return join(homedir(), ".config", "loomy-opencode", "opencode.json");
}
function parseLoomyAuth(text) {
	try {
		const value = JSON.parse(text);
		if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
		const record = value;
		const session = typeof record.session === "string" ? record.session.trim() : "";
		const userId = typeof record.userid === "string" ? record.userid.trim() : "";
		if (session === "" || userId === "") return void 0;
		const phone = typeof record.phone === "string" ? record.phone.trim() : "";
		return {
			session,
			userId,
			...phone === "" ? {} : { maskedPhone: phone }
		};
	} catch {
		return;
	}
}
async function readLoomyCredential(authFile) {
	const path = authFile ?? process.env["LOOMY_AUTH_FILE"] ?? defaultLoomyAuthPath();
	const credential = parseLoomyAuth(await readFile(path, "utf8"));
	if (credential === void 0) throw new Error("Loomy is not signed in. Sign in through the Loomy desktop app first.");
	return credential;
}
//#endregion
//#region src/catalog.ts
/** Discover the current text models from Loomy's generated OpenCode config. */
const FALLBACK = [
	{
		id: "deepseek-v4-flash",
		name: "DeepSeek V4 Flash",
		contextWindow: 98e4,
		maxTokens: 384e3,
		supportsImages: false,
		reasoning: true
	},
	{
		id: "deepseek-v4-pro",
		name: "DeepSeek V4 Pro",
		contextWindow: 98e4,
		maxTokens: 393216,
		supportsImages: false,
		reasoning: true
	},
	{
		id: "qwen3.5-plus",
		name: "Qwen 3.5 Plus",
		contextWindow: 1e6,
		maxTokens: 65536,
		supportsImages: true,
		reasoning: true
	},
	{
		id: "doubao-seed-2.0-pro",
		name: "Doubao Seed 2.0 Pro",
		contextWindow: 262144,
		maxTokens: 131072,
		supportsImages: true,
		reasoning: true
	},
	{
		id: "MiniMax-M3",
		name: "MiniMax M3",
		contextWindow: 1048576,
		maxTokens: 512e3,
		supportsImages: true,
		reasoning: true
	}
];
function positive(value, fallback) {
	return typeof value === "number" && value > 0 ? value : fallback;
}
function parseLoomyModels(text) {
	try {
		const document = JSON.parse(text);
		if (typeof document !== "object" || document === null || Array.isArray(document)) return FALLBACK;
		const provider = document.provider;
		if (typeof provider !== "object" || provider === null || Array.isArray(provider)) return FALLBACK;
		const imodel = provider.imodel;
		if (typeof imodel !== "object" || imodel === null || Array.isArray(imodel)) return FALLBACK;
		const models = imodel.models;
		if (typeof models !== "object" || models === null || Array.isArray(models)) return FALLBACK;
		const result = [];
		for (const [id, value] of Object.entries(models)) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
			const model = value;
			const modalities = model.modalities;
			const input = Array.isArray(modalities?.input) ? modalities.input : [];
			if (!(Array.isArray(modalities?.output) ? modalities.output : ["text"]).includes("text")) continue;
			const limit = model.limit;
			result.push({
				id,
				name: typeof model.name === "string" && model.name.trim() !== "" ? model.name : id,
				contextWindow: positive(limit?.context, 128e3),
				maxTokens: positive(limit?.output, 16384),
				supportsImages: input.includes("image"),
				reasoning: model.reasoning === true || typeof model.variants === "object"
			});
		}
		return result.length === 0 ? FALLBACK : result;
	} catch {
		return FALLBACK;
	}
}
var LoomyCatalog = class {
	models = FALLBACK;
	current() {
		return this.models;
	}
	async refresh(configFile) {
		const path = configFile ?? process.env["LOOMY_CONFIG_FILE"] ?? defaultLoomyConfigPath();
		this.models = parseLoomyModels(await readFile(path, "utf8"));
	}
};
//#endregion
//#region src/adapter.ts
const LOOMY_PROVIDER = "loomy";
const inertAuth = {
	credentials: {
		async read() {},
		async list() {
			return [];
		},
		async modify() {
			throw new Error("Loomy credentials are managed by the Loomy desktop app");
		},
		async delete() {}
	},
	authContext: {
		async env() {},
		async fileExists() {
			return false;
		}
	}
};
const noCost = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0
};
function modelFields(model, baseUrl) {
	return {
		id: model.id,
		name: model.name,
		provider: LOOMY_PROVIDER,
		api: "openai-completions",
		baseUrl,
		input: model.supportsImages ? ["text", "image"] : ["text"],
		reasoning: model.reasoning,
		...model.reasoning ? { thinkingLevelMap: {
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: null,
			max: null
		} } : {},
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		cost: noCost
	};
}
function createLoomyAdapter(catalog, shim) {
	const models = () => catalog.current().map((model) => modelFields(model, `${shim.baseUrl()}/v1`));
	const provider = {
		...createProvider({
			id: LOOMY_PROVIDER,
			name: "Loomy",
			models: models(),
			api: openAICompletionsApi(),
			auth: { apiKey: {
				name: "Loomy desktop session (loopback gateway)",
				/**
				* pi-ai hands the request-level override the adapter supplies through
				* `resolveApiKey` back here as `credential.key`, and treats an
				* `undefined` return as "this provider is not configured" — the stream
				* then ends in a PI_AI_ERROR without ever reaching the gateway.
				*
				* The value consumed here is the gateway's per-process secret, never
				* the Loomy session token: the gateway resolves that from disk itself,
				* once per request.
				*/
				resolve({ credential }) {
					const apiKey = credential?.key ?? shim.token();
					return Promise.resolve({
						auth: { apiKey },
						source: "Loomy desktop session"
					});
				}
			} }
		}),
		getModels: models
	};
	const profile = {
		provider: LOOMY_PROVIDER,
		displayName: "Loomy",
		streamIdleTimeoutMs: 12e5,
		retryPolicy: resolveRetryPolicy(void 0, "dsh-loomy-connect retryPolicy"),
		configuredMaxTokens: /* @__PURE__ */ new Map(),
		modelErrors: /* @__PURE__ */ new Map(),
		maxRequestImageBytes: 20971520,
		requestImagePixelBudget: 4194304,
		requestImageMaxBytes: 1048576,
		piProvider: provider
	};
	let profiles = /* @__PURE__ */ new Map([[LOOMY_PROVIDER, profile]]);
	return {
		adapter: new PiAiAdapter({
			profiles: () => profiles,
			auth: inertAuth,
			resolveApiKey: async () => shim.token()
		}),
		invalidate() {
			profiles = /* @__PURE__ */ new Map([[LOOMY_PROVIDER, profile]]);
		}
	};
}
//#endregion
//#region src/loopback.ts
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
function loopbackHost(value) {
	if (value === void 0) return false;
	const bare = value.trim().toLowerCase().replace(/^\[|\]$/gu, "").replace(/:\d+$/u, "");
	return bare === "127.0.0.1" || bare === "localhost" || bare === "::1";
}
/**
* A browser-sent `Origin` must be loopback. Non-browser clients (the OpenAI
* client pi-ai drives) send no `Origin` at all and pass.
*/
function loopbackOrigin(value) {
	if (value === void 0 || value.trim() === "") return true;
	try {
		const url = new URL(value);
		return loopbackHost(url.host) && (url.protocol === "http:" || url.protocol === "https:");
	} catch {
		return false;
	}
}
//#endregion
//#region src/upstream.ts
const LOOMY_API_BASE = "https://loomyad.xunfei.cn/api/v1";
var LoomyUpstreamClient = class {
	async chatStream(credential, body, signal) {
		const response = await fetch(`${LOOMY_API_BASE}/chat/completions`, {
			method: "POST",
			headers: {
				Accept: "text/event-stream",
				"Content-Type": "application/json",
				Authorization: `Bearer ${credential.session}`,
				token: credential.session,
				"X-User-Id": credential.userId
			},
			body,
			...signal === void 0 ? {} : { signal }
		});
		if (!response.ok) throw new Error(`Loomy request failed (HTTP ${response.status}): ${(await response.text()).slice(0, 400)}`);
		return response;
	}
};
/** Preserve tool calls; add the options Loomy sends for agent conversations. */
function prepareLoomyBody(source) {
	try {
		const value = JSON.parse(source);
		if (typeof value !== "object" || value === null || Array.isArray(value)) return source;
		const body = value;
		body.stream = true;
		if (typeof body.reasoning_effort === "string") body.reasoningEffort = body.reasoning_effort;
		if (Array.isArray(body.messages)) {
			for (const item of body.messages) if (typeof item === "object" && item !== null && item.role === "developer") item.role = "system";
		}
		return JSON.stringify(body);
	} catch {
		return source;
	}
}
//#endregion
//#region src/shim.ts
/** A credential-protected loopback gateway; DSH never receives Loomy's session token. */
/** Resolve a possibly-dynamic auth-file location at call time. */
function resolveAuthFile(value) {
	return typeof value === "function" ? value() : value;
}
const REQUEST_BODY_LIMIT = 67108864;
const REQUEST_TIMEOUT_MS = 12e5;
function json$1(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(body)
	});
	res.end(body);
}
function authorized(req, secret) {
	const bearer = /^Bearer\s+(.+)$/iu.exec(req.headers.authorization ?? "")?.[1];
	if (bearer === void 0) return false;
	const a = Buffer.from(bearer);
	const b = Buffer.from(secret);
	return a.length === b.length && timingSafeEqual(a, b);
}
function isJson(req) {
	const type = req.headers["content-type"];
	return typeof type === "string" && type.trim().toLowerCase().startsWith("application/json");
}
async function readBody(req) {
	const chunks = [];
	let length = 0;
	for await (const chunk of req) {
		const buffer = Buffer.from(chunk);
		length += buffer.length;
		if (length > REQUEST_BODY_LIMIT) throw new Error("request body too large");
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}
function createLoomyShim(options) {
	const secret = randomBytes(32).toString("base64url");
	const client = new LoomyUpstreamClient();
	const server = createServer((req, res) => {
		handle(req, res);
	});
	const ready = new Promise((resolve, reject) => {
		server.once("listening", resolve);
		server.once("error", reject);
	});
	server.listen(0, "127.0.0.1");
	const baseUrl = () => {
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error("Loomy gateway is not listening");
		return `http://127.0.0.1:${address.port}`;
	};
	async function handle(req, res) {
		if (!loopbackHost(req.headers.host)) return json$1(res, 403, { error: { message: "loopback host required" } });
		if (!loopbackOrigin(req.headers.origin)) return json$1(res, 403, { error: { message: "loopback origin required" } });
		if (!authorized(req, secret)) return json$1(res, 401, { error: { message: "invalid gateway credential" } });
		const url = req.url ?? "/";
		if (req.method === "GET" && url.startsWith("/healthz")) return json$1(res, 200, { ok: true });
		if (req.method === "GET" && url.startsWith("/v1/models")) return json$1(res, 200, {
			object: "list",
			data: options.catalog.current().map((model) => ({
				id: model.id,
				object: "model",
				created: 0,
				owned_by: "loomy"
			}))
		});
		if (req.method !== "POST" || !url.startsWith("/v1/chat/completions")) return json$1(res, 404, { error: { message: "not found" } });
		if (!isJson(req)) return json$1(res, 415, { error: { message: "Content-Type must be application/json" } });
		const controller = new AbortController();
		res.on("close", () => {
			if (!res.writableEnded) controller.abort();
		});
		const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
		try {
			const credential = await readLoomyCredential(resolveAuthFile(options.authFile));
			const response = await client.chatStream(credential, prepareLoomyBody(await readBody(req)), signal);
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no"
			});
			if (response.body === null) {
				res.end("data: [DONE]\n\n");
				return;
			}
			const stream = Readable.fromWeb(response.body);
			let sawDone = false;
			stream.on("data", (chunk) => {
				if (chunk.includes("[DONE]")) sawDone = true;
			});
			stream.on("error", (error) => {
				options.logger?.warn("dsh-loomy-connect: upstream stream failed mid-flight", error);
				if (!sawDone && res.writable) res.end("data: [DONE]\n\n");
			});
			stream.pipe(res);
		} catch (error) {
			if (!res.headersSent) json$1(res, 502, { error: { message: String(error) } });
			else res.end();
		}
	}
	return {
		ready,
		baseUrl,
		token: () => secret,
		close: () => new Promise((resolve, reject) => {
			server.close((error) => error === void 0 ? resolve() : reject(error));
			server.closeAllConnections();
		})
	};
}
//#endregion
//#region src/points.ts
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
const LOOMY_POINTS_KEY = "loomy-points-summary";
/** Default location of Loomy's Electron localStorage LevelDB. */
function defaultLoomyLocalStorageDir() {
	return join(homedir(), "Library", "Application Support", "loomy", "Local Storage", "leveldb");
}
/**
* Slice one balanced JSON object starting at `start`.
*
* Braces inside strings are skipped, and the scan stops at an unbalanced
* closing brace so a truncated tail never swallows the record after it.
*/
function readJsonObject(text, start) {
	if (text[start] !== "{") return void 0;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i += 1) {
		const char = text[i];
		if (char === void 0) break;
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === "\"") inString = false;
			continue;
		}
		if (char === "\"") inString = true;
		else if (char === "{") depth += 1;
		else if (char === "}") {
			depth -= 1;
			if (depth === 0) return text.slice(start, i + 1);
			if (depth < 0) return void 0;
		}
	}
}
/** Parse one cached record, keeping only the fields the card renders. */
function parseLoomyPointsRecord(raw) {
	try {
		const value = JSON.parse(raw);
		if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
		const record = value;
		const permanent = Number(record.balance);
		const daily = Number(record.dailyBalance);
		if (!Number.isFinite(permanent) && !Number.isFinite(daily)) return void 0;
		const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : void 0;
		return {
			permanent: Number.isFinite(permanent) ? permanent : 0,
			daily: Number.isFinite(daily) ? daily : 0,
			...updatedAt === void 0 ? {} : { updatedAt }
		};
	} catch {
		return;
	}
}
/** Every cached summary in one LevelDB log, oldest first. */
function extractLoomyPoints(text) {
	const found = [];
	let index = text.indexOf(LOOMY_POINTS_KEY);
	while (index !== -1) {
		const brace = text.indexOf("{", index + 20);
		if (brace !== -1) {
			const raw = readJsonObject(text, brace);
			if (raw !== void 0) {
				const parsed = parseLoomyPointsRecord(raw);
				if (parsed !== void 0) found.push(parsed);
			}
		}
		index = text.indexOf(LOOMY_POINTS_KEY, index + 20);
	}
	return found;
}
/** Newest record wins; `updatedAt` decides, file order breaks ties. */
function newestLoomyPoints(records) {
	let best;
	for (const record of records) {
		if (best === void 0) {
			best = record;
			continue;
		}
		const bestTime = best.updatedAt === void 0 ? -Infinity : Date.parse(best.updatedAt);
		if ((record.updatedAt === void 0 ? -Infinity : Date.parse(record.updatedAt)) >= bestTime) best = record;
	}
	return best;
}
/**
* Memoize on the directory's mtime/size so a polling card does not re-read a
* multi-megabyte log on every tick.
*/
let cache;
/**
* Read the account's points summary from Loomy's localStorage.
*
* Returns `undefined` when Loomy has never cached a summary (or is not
* installed) so the card can degrade instead of showing a bogus zero.
*/
async function readLoomyPoints(dir) {
	const path = dir ?? process.env.LOOMY_LOCAL_STORAGE_DIR ?? defaultLoomyLocalStorageDir();
	let fingerprint = path;
	try {
		const info = await stat(path);
		fingerprint = `${path}:${info.mtimeMs}:${info.size}`;
		const files = (await readdir(path)).filter((name) => name.endsWith(".log") || name.endsWith(".ldb"));
		for (const name of files) {
			const file = await stat(join(path, name));
			fingerprint += `|${name}:${file.mtimeMs}:${file.size}`;
		}
	} catch {
		cache = {
			key: fingerprint,
			value: void 0
		};
		return;
	}
	if (cache !== void 0 && cache.key === fingerprint) return cache.value;
	const records = [];
	try {
		const files = (await readdir(path)).filter((name) => name.endsWith(".log") || name.endsWith(".ldb"));
		for (const name of files) {
			const text = await readFile(join(path, name), "latin1");
			records.push(...extractLoomyPoints(text));
		}
	} catch {
		cache = {
			key: fingerprint,
			value: void 0
		};
		return;
	}
	const value = newestLoomyPoints(records);
	cache = {
		key: fingerprint,
		value
	};
	return value;
}
/** Drop the memoized read; tests and the status route use this. */
function resetLoomyPointsCache() {
	cache = void 0;
}
//#endregion
//#region src/status-paths.ts
/** Node-free constants and types shared by the Host and browser halves. */
/** Plugin-owned status endpoint consumed by its browser half. */
const LOOMY_STATUS_PATH = "/plugins/dsh-loomy-connect/status";
//#endregion
//#region src/web-status.ts
function json(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
/** Strip anything session-shaped before a message crosses to the browser. */
function safeMessage(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/[A-Za-z0-9_-]{24,}/gu, "[redacted]").slice(0, 500);
}
/**
* The request must be addressed to the loopback interface, and a
* browser-attached Origin must be loopback too. The Host check drops
* DNS-rebinding pages (their Host is the attacker's domain, not loopback);
* the card's same-origin fetches carry no Origin and pass on Host alone.
*/
function loopbackRequest(req) {
	return loopbackHost(req.headers.host) && loopbackOrigin(req.headers.origin);
}
/**
* Assemble the card's status document. Points come from Loomy's own cache, so
* a missing or unreadable cache degrades to `pointsError` rather than failing
* the whole document.
*/
async function loomyWebStatus(deps) {
	let credential;
	try {
		credential = await deps.credential();
	} catch {
		return { status: "signed-out" };
	}
	if (credential === void 0) return { status: "signed-out" };
	const status = {
		status: "signed-in",
		modelCount: deps.modelCount(),
		...credential.maskedPhone === void 0 ? {} : { account: credential.maskedPhone }
	};
	try {
		const points = await deps.points();
		if (points === void 0) return status;
		return {
			...status,
			points: {
				permanent: points.permanent,
				daily: points.daily,
				...points.updatedAt === void 0 ? {} : { updatedAt: points.updatedAt }
			}
		};
	} catch (error) {
		return {
			...status,
			pointsError: safeMessage(error)
		};
	}
}
/** The status route's request handler, extracted so tests can mount it on a bare server. */
function loomyStatusHandler(deps) {
	return async (req, res) => {
		if (req.method !== "GET") {
			json(res, 405, { error: "method not allowed" });
			return;
		}
		if (!loopbackRequest(req)) {
			json(res, 403, { error: "request-not-trusted" });
			return;
		}
		try {
			json(res, 200, await loomyWebStatus(deps));
		} catch (error) {
			json(res, 500, { error: safeMessage(error) });
		}
	};
}
/** Mount the GET status route on an optional webServer context. */
function registerLoomyStatusRoute(ctx, deps) {
	ctx.effect(() => {
		const dispose = ctx.webServer.register({
			kind: "exact",
			path: LOOMY_STATUS_PATH,
			handler: loomyStatusHandler(deps)
		});
		return () => {
			dispose();
		};
	}, "dsh-loomy-connect: Web status route");
}
//#endregion
//#region src/index.ts
const name = "llm-loomy";
const inject = ["llm"];
/**
* Runtime config schema. cordis resolves a loader entry's config through this
* schema before calling `apply`. Without a schema it passes the raw value
* straight through — `undefined` for an entry whose patch has no `config:`
* block — and reading a field off that aborts the entire plugin tree at boot.
*/
const Config = Schema.object({
	authFile: Schema.string().description("Loomy desktop auth file (defaults to the app's own location)"),
	configFile: Schema.string().description("Loomy model configuration file (defaults to the app's own location)")
});
/**
* Settings namespace owning this provider's configuration section.
*
* The Plugin configuration tab dispatches its cards by namespace, so this
* string is load-bearing twice: the host half registers the namespace here and
* the browser half registers its card under the same key. A namespace no host
* serves is never dispatched — the card would exist and simply never render.
*/
const LOOMY_SETTINGS_NS = "loomy";
function apply(ctx, config = {}) {
	let source = () => config;
	const authFile = () => source().authFile;
	const configFile = () => source().configFile;
	const catalog = new LoomyCatalog();
	const shim = createLoomyShim({
		catalog,
		authFile,
		logger: ctx.logger
	});
	ctx.inject(["webServer"], (webCtx) => registerLoomyStatusRoute(webCtx, {
		credential: async () => {
			try {
				return await readLoomyCredential(authFile());
			} catch {
				return;
			}
		},
		points: () => readLoomyPoints(),
		modelCount: () => catalog.current().length
	}));
	let reapply;
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.installSection(ctx, LOOMY_SETTINGS_NS, Config, config, {
			setSource(next) {
				source = next;
			},
			onChange() {
				reapply?.();
			}
		});
	});
	let closed = false;
	ctx.effect(() => () => {
		closed = true;
		shim.close();
	});
	shim.ready.then(async () => {
		if (closed) return;
		const loomy = createLoomyAdapter(catalog, shim);
		const releaseAdapter = ctx.llm.registerAdapter([LOOMY_PROVIDER], loomy.adapter);
		const releaseDirectory = ctx.llm.registerConfigurableProviders([{
			provider: LOOMY_PROVIDER,
			displayName: "Loomy",
			settingsNs: LOOMY_SETTINGS_NS,
			settingsPath: [],
			declared: false
		}]);
		ctx.effect(() => () => {
			releaseAdapter();
			releaseDirectory();
		});
		reapply = async () => {
			if (closed) return;
			try {
				await catalog.refresh(configFile());
				loomy.invalidate();
			} catch (error) {
				ctx.logger.warn("dsh-loomy-connect: using fallback catalog; unable to read Loomy model configuration", error);
			}
		};
		await reapply();
	}).catch((error) => ctx.logger.error("dsh-loomy-connect: failed to start loopback gateway", error));
}
//#endregion
export { Config, LOOMY_API_BASE, LOOMY_POINTS_KEY, LOOMY_PROVIDER, LOOMY_SETTINGS_NS, LOOMY_STATUS_PATH, LoomyCatalog, LoomyUpstreamClient, apply, createLoomyAdapter, createLoomyShim, defaultLoomyAuthPath, defaultLoomyConfigPath, defaultLoomyLocalStorageDir, extractLoomyPoints, inject, loomyStatusHandler, loomyWebStatus, loopbackHost, loopbackOrigin, name, newestLoomyPoints, parseLoomyAuth, parseLoomyModels, parseLoomyPointsRecord, prepareLoomyBody, readLoomyCredential, readLoomyPoints, registerLoomyStatusRoute, resetLoomyPointsCache, resolveAuthFile };
