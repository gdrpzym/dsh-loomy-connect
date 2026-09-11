/**
 * Same-origin status route for the Loomy plugin card: sign-in state, the
 * account's points split (permanent vs. daily gift), and the model count.
 *
 * The route answers loopback browser requests only and never carries token
 * material — the session token stays on the host side of the gateway.
 *
 * @module dsh-loomy-connect/web-status
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { LoomyCredential } from './auth.ts'
import { loopbackHost, loopbackOrigin } from './loopback.ts'
import type { LoomyPointsSummary } from './points.ts'
import { LOOMY_STATUS_PATH } from './status-paths.ts'
import type { LoomyWebStatus } from './status-paths.ts'

export { LOOMY_STATUS_PATH } from './status-paths.ts'
export type { LoomyWebStatus } from './status-paths.ts'

/** Constructor dependencies. */
export interface LoomyStatusRouteOptions {
  /** Current sign-in state; `undefined` means signed out. */
  credential: () => Promise<LoomyCredential | undefined>
  /** Points summary, or `undefined` when Loomy has not cached one. */
  points: () => Promise<LoomyPointsSummary | undefined>
  /** How many models the plugin currently serves. */
  modelCount: () => number
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

/** Strip anything session-shaped before a message crosses to the browser. */
function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[A-Za-z0-9_-]{24,}/gu, '[redacted]')
    .slice(0, 500)
}

/**
 * The request must be addressed to the loopback interface, and a
 * browser-attached Origin must be loopback too. The Host check drops
 * DNS-rebinding pages (their Host is the attacker's domain, not loopback);
 * the card's same-origin fetches carry no Origin and pass on Host alone.
 */
function loopbackRequest(req: IncomingMessage): boolean {
  return loopbackHost(req.headers.host) && loopbackOrigin(req.headers.origin)
}

/**
 * Assemble the card's status document. Points come from Loomy's own cache, so
 * a missing or unreadable cache degrades to `pointsError` rather than failing
 * the whole document.
 */
export async function loomyWebStatus(deps: LoomyStatusRouteOptions): Promise<LoomyWebStatus> {
  let credential: LoomyCredential | undefined
  try {
    credential = await deps.credential()
  } catch {
    return { status: 'signed-out' }
  }
  if (credential === undefined) return { status: 'signed-out' }
  const status: LoomyWebStatus = {
    status: 'signed-in',
    modelCount: deps.modelCount(),
    ...credential.maskedPhone === undefined ? {} : { account: credential.maskedPhone },
  }
  try {
    const points = await deps.points()
    if (points === undefined) return status
    return {
      ...status,
      points: {
        permanent: points.permanent,
        daily: points.daily,
        ...points.updatedAt === undefined ? {} : { updatedAt: points.updatedAt },
      },
    }
  } catch (error: unknown) {
    return { ...status, pointsError: safeMessage(error) }
  }
}

/** The status route's request handler, extracted so tests can mount it on a bare server. */
export function loomyStatusHandler(
  deps: LoomyStatusRouteOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!loopbackRequest(req)) {
      json(res, 403, { error: 'request-not-trusted' })
      return
    }
    try {
      json(res, 200, await loomyWebStatus(deps))
    } catch (error: unknown) {
      json(res, 500, { error: safeMessage(error) })
    }
  }
}

/** Mount the GET status route on an optional webServer context. */
export function registerLoomyStatusRoute(ctx: Context, deps: LoomyStatusRouteOptions): void {
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: LOOMY_STATUS_PATH,
      handler: loomyStatusHandler(deps),
    })
    return () => {
      dispose()
    }
  }, 'dsh-loomy-connect: Web status route')
}
