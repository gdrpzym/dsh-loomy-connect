/** Node-free constants and types shared by the Host and browser halves. */

/** Plugin-owned status endpoint consumed by its browser half. */
export const LOOMY_STATUS_PATH = '/plugins/dsh-loomy-connect/status'

/** The account's points split the way Loomy's own UI presents it. */
export interface LoomyWebPoints {
  /** Long-lived points — Loomy labels these 永久积分. */
  permanent: number
  /** Points refilled each sign-in day; 每日赠送积分. Resets to 5000 daily. */
  daily: number
  /** ISO timestamp of Loomy's last refresh, so the card can show staleness. */
  updatedAt?: string
}

/** The JSON document the plugin card renders. */
export type LoomyWebStatus =
  | { status: 'signed-out' }
  | {
    status: 'signed-in'
    /** Masked sign-in identity (Loomy stores a masked phone number). */
    account?: string
    /** How many models the plugin is currently serving. */
    modelCount: number
    points?: LoomyWebPoints
    pointsError?: string
  }
  | { status: 'error'; message: string }
