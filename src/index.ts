/** DSH provider registration for the models included in the Loomy desktop app. */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { LoomyCatalog } from './catalog.ts'
import { createLoomyAdapter, LOOMY_PROVIDER } from './adapter.ts'
import { readLoomyCredential } from './auth.ts'
import { createLoomyShim } from './shim.ts'
import { readLoomyPoints } from './points.ts'
import { registerLoomyStatusRoute } from './web-status.ts'

export const name = 'llm-loomy'
export const inject = ['llm']

/**
 * Runtime config schema. cordis resolves a loader entry's config through this
 * schema before calling `apply`. Without a schema it passes the raw value
 * straight through — `undefined` for an entry whose patch has no `config:`
 * block — and reading a field off that aborts the entire plugin tree at boot.
 */
export const Config = Schema.object({
  authFile: Schema.string().description("Loomy desktop auth file (defaults to the app's own location)"),
  configFile: Schema.string().description("Loomy model configuration file (defaults to the app's own location)"),
})

/** Config as seen inside {@link apply}. */
export interface ConfigShape {
  authFile?: string
  configFile?: string
}

/**
 * Settings namespace owning this provider's configuration section.
 *
 * The Plugin configuration tab dispatches its cards by namespace, so this
 * string is load-bearing twice: the host half registers the namespace here and
 * the browser half registers its card under the same key. A namespace no host
 * serves is never dispatched — the card would exist and simply never render.
 */
export const LOOMY_SETTINGS_NS = 'loomy'

export function apply(ctx: Context, config: ConfigShape = {}): void {
  // The authoritative section: the composition entry until the settings
  // provider attaches, then the resolved section (user layer over entry). The
  // shim and the status route both read through this thunk, so a path the card
  // writes takes effect on the next request instead of the next restart.
  let source: () => ConfigShape = () => config
  const authFile = (): string | undefined => source().authFile
  const configFile = (): string | undefined => source().configFile

  const catalog = new LoomyCatalog()
  const shim = createLoomyShim({ catalog, authFile, logger: ctx.logger })

  // The settings card lives in the browser, so it needs a host route to ask.
  // webServer is optional (a headless profile serves no browser).
  ctx.inject(['webServer'], webCtx => registerLoomyStatusRoute(webCtx, {
    credential: async () => {
      try { return await readLoomyCredential(authFile()) } catch { return undefined }
    },
    points: () => readLoomyPoints(),
    modelCount: () => catalog.current().length,
  }))

  // Set once the provider is live, so an early `onChange` (installSection calls
  // it synchronously at attach, before the adapter exists) is a harmless no-op.
  let reapply: (() => Promise<void>) | undefined

  // Registering the namespace is what makes the browser card reachable: the
  // Plugin configuration tab renders the intersection of the namespaces the
  // host serves and the cards claiming them. Without this the host provider
  // works but the plugin is invisible outside the read-only plugin inventory.
  ctx.inject(['settings'], settingsCtx => {
    settingsCtx.settings.installSection(ctx, LOOMY_SETTINGS_NS, Config, config, {
      setSource(next) { source = next },
      onChange() { void reapply?.() },
    })
  })

  let closed = false
  ctx.effect(() => () => { closed = true; void shim.close() })
  void shim.ready.then(async () => {
    if (closed) return
    const loomy = createLoomyAdapter(catalog, shim)
    const releaseAdapter = ctx.llm.registerAdapter([LOOMY_PROVIDER], loomy.adapter)
    const releaseDirectory = ctx.llm.registerConfigurableProviders([{ provider: LOOMY_PROVIDER, displayName: 'Loomy', settingsNs: LOOMY_SETTINGS_NS, settingsPath: [], declared: false }])
    ctx.effect(() => () => { releaseAdapter(); releaseDirectory() })
    reapply = async () => {
      if (closed) return
      try { await catalog.refresh(configFile()); loomy.invalidate() }
      catch (error) { ctx.logger.warn('dsh-loomy-connect: using fallback catalog; unable to read Loomy model configuration', error) }
    }
    await reapply()
  }).catch(error => ctx.logger.error('dsh-loomy-connect: failed to start loopback gateway', error))
}

export { createLoomyAdapter, LOOMY_PROVIDER, type LoomyAdapter } from './adapter.ts'
export { createLoomyShim, resolveAuthFile, type LoomyAuthFile, type LoomyShim, type LoomyShimOptions } from './shim.ts'
export { LoomyCatalog, parseLoomyModels, type LoomyModel } from './catalog.ts'
export { defaultLoomyAuthPath, defaultLoomyConfigPath, parseLoomyAuth, readLoomyCredential, type LoomyCredential } from './auth.ts'
export { LOOMY_API_BASE, LoomyUpstreamClient, prepareLoomyBody } from './upstream.ts'
export { loopbackHost, loopbackOrigin } from './loopback.ts'
export {
  LOOMY_POINTS_KEY,
  defaultLoomyLocalStorageDir,
  extractLoomyPoints,
  newestLoomyPoints,
  parseLoomyPointsRecord,
  readLoomyPoints,
  resetLoomyPointsCache,
  type LoomyPointsSummary,
} from './points.ts'
export { LOOMY_STATUS_PATH, type LoomyWebPoints, type LoomyWebStatus } from './status-paths.ts'
export { loomyStatusHandler, loomyWebStatus, registerLoomyStatusRoute, type LoomyStatusRouteOptions } from './web-status.ts'
