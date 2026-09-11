window.__ModuleLoader__.load({
	id: "dsh-loomy-connect",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/status-paths.ts
		/** Node-free constants and types shared by the Host and browser halves. */
		/** Plugin-owned status endpoint consumed by its browser half. */
		const LOOMY_STATUS_PATH = "/plugins/dsh-loomy-connect/status";
		//#endregion
		//#region src/client/card-css.ts
		/**
		* Card chrome for the Plugin configuration contribution.
		*
		* DSH ships the official card shell (`PluginCard`) inside
		* `@deepseek-ai/dsh-client-ui-settings-plugins`, but that package exports only
		* `apply`/`inject` at runtime — the component itself is package-private. The
		* class names below are a deliberate, literal copy of that shell's CSS module
		* (`PluginCard.module.css`, MIT) so a third-party card is indistinguishable
		* from a first-party one: same 16px radius, same hairline border, same
		* hover/open background swap, same `.16s` chevron rotation.
		*
		* The owner of the stylesheet is this plugin, and its tag id is namespaced to
		* this plugin, so a DSH release that restyles the official shell cannot leave
		* this card half-styled: the two simply drift.
		*/
		/** Stable tag id; mirrors how the official bundles tag their own stylesheets. */
		const STYLE_TAG_ID = "dsh-loomy-connect/LoomyCard.module.css";
		/** Prefix keeping every rule out of the official (hashed) class namespace. */
		const CSS = {
			card: "dlc_card",
			cardOpen: "dlc_cardOpen",
			header: "dlc_header",
			headText: "dlc_headText",
			name: "dlc_name",
			description: "dlc_description",
			chevron: "dlc_chevron",
			chevronOpen: "dlc_chevronOpen",
			body: "dlc_body",
			section: "dlc_section",
			heading: "dlc_heading",
			row: "dlc_row",
			status: "dlc_status",
			tiles: "dlc_tiles",
			tile: "dlc_tile",
			tileLabel: "dlc_tileLabel",
			tileValue: "dlc_tileValue",
			tileHint: "dlc_tileHint",
			text: "dlc_text",
			hint: "dlc_hint",
			error: "dlc_error",
			list: "dlc_list",
			listItem: "dlc_listItem",
			listMain: "dlc_listMain",
			listName: "dlc_listName",
			listNote: "dlc_listNote",
			listMeta: "dlc_listMeta",
			pill: "dlc_pill",
			refreshInner: "dlc_refreshInner",
			refreshSpin: "dlc_refreshSpin",
			tabs: "dlc_tabs",
			tab: "dlc_tab",
			tabActive: "dlc_tabActive",
			typeChip: "dlc_typeChip",
			ctx: "dlc_ctx"
		};
		const STYLESHEET = `
.dlc_card{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}
.dlc_card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dlc_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dlc_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.dlc_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dlc_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.dlc_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.dlc_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.dlc_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}
.dlc_chevronOpen{transform:rotate(180deg)}
.dlc_body{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.dlc_section{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.dlc_section+.dlc_section{border-top:.5px solid var(--dsw-alias-border-l2)}
.dlc_heading{color:var(--dsw-alias-label-primary);margin:0;font-size:13px;font-weight:500;line-height:1.5}
.dlc_row{align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between;display:flex}
.dlc_status{align-items:center;gap:8px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5;display:flex}
.dlc_tiles{flex-wrap:wrap;gap:12px;display:flex}
.dlc_tile{box-sizing:border-box;flex:1 1 180px;min-width:0;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-3)}
.dlc_tileLabel{align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5;display:flex}
.dlc_tileValue{margin-top:6px;color:var(--dsw-alias-label-primary);font-size:24px;font-weight:600;line-height:1.25}
.dlc_tileHint{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.dlc_text{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;line-height:1.5}
.dlc_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
/* The official shell's equivalent rule names --dsw-alias-label-error, which no
   shipped theme defines (the text silently inherits). Use a token that exists. */
.dlc_error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:1.5}
.dlc_list{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.dlc_listItem{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.dlc_listMain{display:flex;align-items:baseline;gap:6px;min-width:0}
.dlc_listName{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dlc_listNote{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;flex:none}
.dlc_listMeta{display:inline-flex;align-items:center;gap:6px;flex:none}
/* Rate and promotion read as the same kind of thing — what a call costs — so
   they share one chip. Tabular figures stop the digits from drifting. */
.dlc_pill{padding:1px 8px;border-radius:999px;font-size:11px;line-height:18px;white-space:nowrap;font-variant-numeric:tabular-nums;background:var(--dsw-alias-state-success-subtle,rgba(34,160,107,.12));color:var(--dsw-alias-state-success-primary,#22a06b)}
.dlc_refreshInner{display:inline-flex;align-items:center;gap:6px}
.dlc_refreshSpin{animation:dlc_spin .7s linear infinite}
@keyframes dlc_spin{to{transform:rotate(360deg)}}
/* Two-tab switch (账户 / 模型). Plain buttons styled to the shell tokens — the
   official settings shell ships no public tab primitive, and the card already
   copies the shell chrome rather than importing it, so this stays consistent. */
.dlc_tabs{display:flex;gap:4px;padding:10px 0 2px;border-top:.5px solid var(--dsw-alias-border-l2);margin-top:2px}
.dlc_tab{appearance:none;font:inherit;cursor:pointer;background:0 0;border:0;color:var(--dsw-alias-label-tertiary);font-size:13px;font-weight:500;line-height:1.5;padding:6px 12px;border-radius:8px}
.dlc_tab:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}
.dlc_tabActive{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.dlc_typeChip{padding:1px 8px;border-radius:999px;font-size:11px;line-height:18px;white-space:nowrap;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary)}
.dlc_ctx{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;white-space:nowrap;font-variant-numeric:tabular-nums}
`;
		/**
		* Install the card stylesheet once per document.
		*
		* Called at module scope, so it runs while the module loader materializes this
		* bundle — the same moment the official bundles inject theirs, which is what
		* lets the loader inventory and dispose the tag with the module.
		*/
		function ensureLoomyCardStyles() {
			if (typeof document === "undefined") return;
			if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`) !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-loomy-connect";
			tag.dataset.pluginCss = STYLE_TAG_ID;
			tag.textContent = STYLESHEET;
			document.head.appendChild(tag);
		}
		ensureLoomyCardStyles();
		//#endregion
		//#region src/client/LoomyPluginCard.tsx
		/**
		* Loomy account + points card contributed to Harness Plugin configuration.
		*
		* The chrome mirrors the official card shell byte for byte — see
		* `./card-css.ts` for why it is copied rather than imported — and every
		* interactive part is an official primitive: `IconChevronDownOutline14` for the
		* header chevron, `StateDot` for sign-in state, `Button` for the refresh
		* action, `Tag` for the model count. Those come from
		* `@deepseek-ai/dsh-client-ui-primitives`, which the web shell publishes in its
		* static module table, so they cost this bundle nothing.
		*/
		const POLL_INTERVAL_MS = 6e4;
		/** Shortest time the refresh button stays visibly busy. */
		const MIN_BUSY_MS = 600;
		/** Join the base class with its modifier, the way the official shell does. */
		function withModifier(base, modifier, on) {
			return on ? `${base} ${modifier}` : base;
		}
		/** Map our transport outcome onto the primitive's state vocabulary. */
		function dotState(status) {
			switch (status) {
				case "signed-in": return "done";
				case "error": return "error";
				default: return "idle";
			}
		}
		function formatNumber(value) {
			return new Intl.NumberFormat(void 0).format(value);
		}
		function formatTime(ms) {
			return new Intl.DateTimeFormat(void 0, {
				dateStyle: "medium",
				timeStyle: "short"
			}).format(new Date(ms));
		}
		/**
		* The rate or promo Loomy appends to a model name — `…（x3.0）`, `…（限时免费）`.
		*
		* Mirrors the tags `catalog.ts` parses, anchored to the end so a name that
		* legitimately contains parentheses keeps them.
		*/
		const NAME_TAG = /[（(]\s*(?:x\s*[0-9]+(?:\.[0-9]+)?|[^（）()]*免费[^（）()]*)\s*[）)]\s*$/u;
		/** The model name without the rate tag, which the card shows in its own column. */
		function modelName(name) {
			return name.replace(NAME_TAG, "").trim();
		}
		/** Loomy's own spelling, one decimal: 3 → `x3.0`, 3.3 → `x3.3`. */
		function formatRate(rate) {
			return `x${Number.isInteger(rate) ? rate.toFixed(1) : rate}`;
		}
		/** Compact token count: 262144 → `262K`, 1_048_576 → `1M`. */
		function formatContext(value) {
			if (value >= 1e6) {
				const millions = value / 1e6;
				return `${Math.round(millions * 10) / 10}M`;
			}
			if (value >= 1e3) return `${Math.round(value / 1e3)}K`;
			return String(value);
		}
		/**
		* Localize the promotional label Loomy prints, falling back to its own wording
		* for anything this card has no translation for yet.
		*/
		function promoLabel(promo, t) {
			return /免费/u.test(promo) ? t("badgeLimitedFree") : promo;
		}
		/** One labelled number: the permanent or the daily-gift balance. */
		function PointsTile({ label, value, hint }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: CSS.tile,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: CSS.tileLabel,
						children: label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: CSS.tileValue,
						children: formatNumber(value)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: CSS.tileHint,
						children: hint
					})
				]
			});
		}
		/** Render Loomy sign-in state and points as one expandable card. */
		function LoomyPluginCard({ t }) {
			if (t === void 0) throw new Error("Loomy plugin card requires its translation function");
			const [open, setOpen] = (0, react.useState)(false);
			const [status, setStatus] = (0, react.useState)({ status: "signed-out" });
			const [busy, setBusy] = (0, react.useState)(false);
			/** Which of the three tabs (账户 / 模型 / 生图) is showing. */
			const [tab, setTab] = (0, react.useState)("account");
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			const refresh = (0, react.useCallback)(async (signal, force = false) => {
				try {
					const response = await fetch(force ? `${LOOMY_STATUS_PATH}?refresh=1` : LOOMY_STATUS_PATH, {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					if (mounted.current && signal?.aborted !== true && value !== void 0) setStatus(value);
				} catch (error) {
					if (mounted.current && signal?.aborted !== true) setStatus({
						status: "error",
						message: error instanceof Error ? error.message : t("requestFailed")
					});
				}
			}, [t]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const controller = new AbortController();
				refresh(controller.signal);
				return () => {
					controller.abort();
				};
			}, [open, refresh]);
			(0, react.useEffect)(() => {
				if (!open || status.status !== "signed-in") return;
				const controller = new AbortController();
				const timer = window.setInterval(() => {
					refresh(controller.signal);
				}, POLL_INTERVAL_MS);
				return () => {
					window.clearInterval(timer);
					controller.abort();
				};
			}, [
				open,
				refresh,
				status.status
			]);
			const manualRefresh = async () => {
				setBusy(true);
				const started = Date.now();
				try {
					await refresh(void 0, true);
				} finally {
					const elapsed = Date.now() - started;
					if (elapsed < MIN_BUSY_MS) await new Promise((resolve) => window.setTimeout(resolve, MIN_BUSY_MS - elapsed));
					if (mounted.current) setBusy(false);
				}
			};
			const title = t("title");
			const label = status.status === "signed-in" ? status.account === void 0 ? t("signedIn") : t("signedInAs", { account: status.account }) : status.status === "error" ? t("requestFailed") : t("signedOut");
			const rawUpdatedAt = status.status === "signed-in" ? status.points?.updatedAt : void 0;
			const updatedMs = rawUpdatedAt === void 0 ? void 0 : Date.parse(rawUpdatedAt);
			const models = status.status === "signed-in" ? status.models : void 0;
			const imageCount = models === void 0 ? 0 : models.filter((model) => model.image === true).length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: withModifier(CSS.card, CSS.cardOpen, open),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: CSS.header,
					"aria-expanded": open,
					"aria-label": `${t(open ? "collapse" : "expand")}: ${title}`,
					onClick: () => {
						setOpen(!open);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: CSS.headText,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: CSS.name,
							children: title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: CSS.description,
							children: t("intro")
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, { className: withModifier(CSS.chevron, CSS.chevronOpen, open) })]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: CSS.body,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: CSS.section,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: CSS.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: CSS.status,
									role: "status",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: dotState(status.status) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label })]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									size: "sm",
									disabled: busy,
									onClick: () => void manualRefresh(),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: CSS.refreshInner,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline14, { className: busy ? CSS.refreshSpin : void 0 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: busy ? t("refreshing") : t("refresh") })]
									})
								})]
							})
						}),
						status.status === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: CSS.tabs,
							role: "tablist",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "tab",
									"aria-selected": tab === "account",
									className: withModifier(CSS.tab, CSS.tabActive, tab === "account"),
									onClick: () => setTab("account"),
									children: t("tabAccount")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "tab",
									"aria-selected": tab === "models",
									className: withModifier(CSS.tab, CSS.tabActive, tab === "models"),
									onClick: () => setTab("models"),
									children: t("tabModels")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "tab",
									"aria-selected": tab === "imagegen",
									className: withModifier(CSS.tab, CSS.tabActive, tab === "imagegen"),
									onClick: () => setTab("imagegen"),
									children: t("tabImagegen")
								})
							]
						}), tab === "account" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: CSS.section,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: CSS.heading,
								children: t("accountHeading")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: CSS.text,
								children: status.account === void 0 ? t("signedIn") : t("signedInAs", { account: status.account })
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: CSS.section,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: CSS.heading,
									children: t("pointsHeading")
								}),
								status.points === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: CSS.text,
									children: t("pointsUnavailable")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: CSS.tiles,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PointsTile, {
											label: t("permanentPoints"),
											value: status.points.permanent,
											hint: t("permanentPointsHint")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PointsTile, {
											label: t("dailyPoints"),
											value: status.points.daily,
											hint: t("dailyPointsHint")
										})]
									}),
									updatedMs === void 0 || Number.isNaN(updatedMs) ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: CSS.hint,
										children: t("updatedAt", { time: formatTime(updatedMs) })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: CSS.hint,
										children: t("pointsSourceHint")
									})
								] }),
								status.pointsError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: CSS.error,
									children: t("pointsError", { message: status.pointsError })
								})
							]
						})] }) : tab === "models" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: CSS.section,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: CSS.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: CSS.heading,
									children: t("modelsHeading")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
									tone: "neutral",
									children: t("modelsTag", { count: status.modelCount })
								})]
							}), models === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: CSS.list,
								children: models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
									className: CSS.listItem,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: CSS.listMain,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: CSS.listName,
											children: modelName(model.name)
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: CSS.typeChip,
											children: model.image === true ? t("modelsImage") : t("typeChat")
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: CSS.listMeta,
										children: [
											model.contextWindow === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: CSS.ctx,
												children: t("modelsContextUnknown")
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: CSS.ctx,
												children: t("modelsContext", { size: formatContext(model.contextWindow) })
											}),
											model.rate === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: CSS.pill,
												children: formatRate(model.rate)
											}),
											model.promo === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: CSS.pill,
												children: promoLabel(model.promo, t)
											})
										]
									})]
								}, model.id))
							}), imageCount === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: CSS.hint,
								children: t("modelsImageHint", { count: imageCount })
							})] })]
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: CSS.section,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: CSS.row,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										className: CSS.heading,
										children: t("imagegenHeading")
									}), imageCount === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
										tone: "neutral",
										children: t("imagegenTag", { count: imageCount })
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: CSS.text,
									children: t("imagegenComingSoon")
								}),
								models === void 0 ? null : imageCount === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: CSS.hint,
									children: t("imagegenNone")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
									className: CSS.list,
									children: models.filter((model) => model.image === true).map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
										className: CSS.listItem,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: CSS.listMain,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: CSS.listName,
												children: modelName(model.name)
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: CSS.pill,
												children: t("imagegenPill")
											})]
										})
									}, model.id))
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: CSS.hint,
									children: t("imagegenHint", { count: imageCount })
								})] })
							]
						})] }) : null,
						status.status === "signed-out" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: CSS.text,
							children: t("signedOutHint")
						}) : null,
						status.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: CSS.error,
							children: status.message
						}) : null
					]
				}) : null]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** Plugin-card copy registered under the settings.loomy locale namespace. */
		const en = {
			title: "DSH Loomy Connect",
			intro: "Use the models included in the Loomy desktop app directly in DSH — zero configuration, ready out of the box.",
			expand: "Expand",
			collapse: "Collapse",
			loading: "Loading account…",
			signedOut: "Not signed in",
			signedOutHint: "Sign in once in the Loomy desktop app; this plugin follows that sign-in automatically.",
			signedInAs: "Signed in as {account}",
			signedIn: "Signed in",
			accountHeading: "Account",
			pointsHeading: "Points",
			permanentPoints: "Permanent points",
			permanentPointsHint: "Long-lived balance",
			dailyPoints: "Daily gift points",
			dailyPointsHint: "Refilled to 5000 on each daily sign-in",
			updatedAt: "Updated {time}",
			pointsSourceHint: "Read from Loomy’s own cache; the numbers move when Loomy refreshes it.",
			pointsUnavailable: "No points snapshot yet — open Loomy once and it will appear here.",
			pointsError: "Points unavailable: {message}",
			tabAccount: "Account",
			tabModels: "Models",
			tabImagegen: "Image gen",
			typeChat: "Chat",
			modelsHeading: "Models",
			modelsTag: "{count} chat models",
			modelsImage: "image",
			modelsImageHint: "Plus {count} image generator(s), invoked by Loomy’s skills (avatar / cover / PPT) through a dedicated image API; calling them from DSH is under test — see the Image gen tab.",
			modelsContext: "Context {size}",
			modelsContextUnknown: "Context not provided",
			imagegenHeading: "Image generation",
			imagegenTag: "{count} image model(s)",
			imagegenComingSoon: "Under test — coming soon.",
			imagegenPill: "coming soon",
			imagegenHint: "Detected {count} image generator(s) on this account; invoking them from DSH is on the way.",
			imagegenNone: "No image generator detected on this account yet.",
			badgeLimitedFree: "Limited-time free",
			refresh: "Refresh",
			refreshing: "Refreshing…",
			requestFailed: "Request failed"
		};
		const zh = {
			title: "DSH Loomy Connect",
			intro: "在 DSH 中直接使用 Loomy 桌面 App 包含的模型，开箱即用，无需额外配置。",
			expand: "展开",
			collapse: "收起",
			loading: "正在读取账号…",
			signedOut: "未登录",
			signedOutHint: "在 Loomy 桌面 App 里登录一次即可，插件会自动跟随当前登录的账号。",
			signedInAs: "已登录：{account}",
			signedIn: "已登录",
			accountHeading: "账号",
			pointsHeading: "积分余额",
			permanentPoints: "永久积分",
			permanentPointsHint: "长期有效的积分",
			dailyPoints: "每日赠送积分",
			dailyPointsHint: "每日登录后刷新为 5000",
			updatedAt: "更新于 {time}",
			pointsSourceHint: "积分读自 Loomy 本地缓存，Loomy 刷新后这里才会变化。",
			pointsUnavailable: "还没有积分快照 —— 打开一次 Loomy 后这里就会显示。",
			pointsError: "积分查询失败：{message}",
			tabAccount: "账户",
			tabModels: "模型",
			tabImagegen: "生图",
			typeChat: "对话",
			modelsHeading: "模型",
			modelsTag: "{count} 个可对话",
			modelsImage: "图像",
			modelsImageHint: "另有 {count} 个图像生成模型，由 Loomy 的技能（头像 / 封面 / PPT）经独立生图接口调用；在 DSH 中调用它们的能力测试中，见「生图」标签页。",
			modelsContext: "上下文 {size}",
			modelsContextUnknown: "上下文未提供",
			imagegenHeading: "生图",
			imagegenTag: "{count} 个图像模型",
			imagegenComingSoon: "测试中，敬请期待。",
			imagegenPill: "敬请期待",
			imagegenHint: "已检测到 {count} 个图像生成模型，在 DSH 中调用的能力即将开放。",
			imagegenNone: "当前账号暂未检测到图像生成模型。",
			badgeLimitedFree: "限时免费",
			refresh: "刷新",
			refreshing: "正在刷新…",
			requestFailed: "请求失败"
		};
		//#endregion
		//#region src/client/index.tsx
		/** Stable browser-plugin name. */
		const name = "dsh-loomy-connect-client";
		/**
		* Client services required by the Plugin configuration contribution. The
		* `slots` registry lives in `@deepseek-ai/dsh-client-ui-renderer`, `locale` in
		* `@deepseek-ai/dsh-client-locale`, and the `settings.plugin.item` slot is
		* declared by `@deepseek-ai/dsh-client-ui-settings-plugins`. All three are
		* named in the package's `dsh.client.inject` list, so cordis has activated
		* them before this plugin's fiber starts.
		*/
		const inject = ["slots", "locale"];
		/**
		* Register card copy and the Loomy card under Plugin configuration.
		*
		* The body is wrapped so a DSH slot-API breaking change degrades to a
		* `console.error` instead of throwing into the DSH loader and raising the red
		* "Failed to load plugins" banner. The host provider keeps working regardless:
		* the `loomy` model channel is unaffected by a card that cannot mount.
		*/
		function apply(ctx) {
			try {
				const namespace = "settings.loomy";
				ctx.effect(() => ctx.locale.register(namespace, {
					zh,
					en
				}), "dsh-loomy-connect: settings copy");
				const t = ctx.locale.bind(namespace);
				ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
					name: "settings.plugin.item",
					key: "loomy",
					priority: 30,
					inject: () => ({ t })
				}, LoomyPluginCard));
			} catch (error) {
				console.error("[dsh-loomy-connect] client card failed to load (host provider unaffected):", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
