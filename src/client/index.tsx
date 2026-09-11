/** Browser half: Loomy account status inside Plugin configuration. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LoomyPluginCard } from './LoomyPluginCard.tsx'
import type { LoomyPluginCardInjected } from './LoomyPluginCard.tsx'
import { en, zh } from './locales.ts'
import type { LoomySettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Loomy plugin card copy. */
    'settings.loomy': LoomySettingsKey
  }
}

/** Stable browser-plugin name. */
export const name = 'dsh-loomy-connect-client'

/**
 * Client services required by the Plugin configuration contribution. The
 * `slots` registry lives in `@deepseek-ai/dsh-client-ui-renderer`, `locale` in
 * `@deepseek-ai/dsh-client-locale`, and the `settings.plugin.item` slot is
 * declared by `@deepseek-ai/dsh-client-ui-settings-plugins`. All three are
 * named in the package's `dsh.client.inject` list, so cordis has activated
 * them before this plugin's fiber starts.
 */
export const inject = ['slots', 'locale']

/**
 * Register card copy and the Loomy card under Plugin configuration.
 *
 * The body is wrapped so a DSH slot-API breaking change degrades to a
 * `console.error` instead of throwing into the DSH loader and raising the red
 * "Failed to load plugins" banner. The host provider keeps working regardless:
 * the `loomy` model channel is unaffected by a card that cannot mount.
 */
export function apply(ctx: ClientContext): void {
  try {
    const namespace = 'settings.loomy'
    ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'dsh-loomy-connect: settings copy')
    const t = ctx.locale.bind(namespace) as LoomyPluginCardInjected['t']
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
      name: 'settings.plugin.item',
      key: 'loomy',
      priority: 30,
      inject: (): LoomyPluginCardInjected => ({ t }),
    }, LoomyPluginCard))
  } catch (error: unknown) {
    // Degrade silently on the page: the host provider still serves models.
    console.error('[dsh-loomy-connect] client card failed to load (host provider unaffected):', error)
  }
}
