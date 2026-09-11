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

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The localStorage key Loomy's renderer writes the points summary to. */
export const LOOMY_POINTS_KEY = 'loomy-points-summary'

/** One account's points split the way Loomy's own UI presents it. */
export interface LoomyPointsSummary {
  /** Long-lived points — Loomy labels these 永久积分. */
  permanent: number
  /** Points refilled each sign-in day — Loomy labels these 每日赠送积分. */
  daily: number
  /** ISO timestamp of the last time Loomy refreshed the summary. */
  updatedAt?: string
}

/** Default location of Loomy's Electron localStorage LevelDB. */
export function defaultLoomyLocalStorageDir(): string {
  return join(homedir(), 'Library', 'Application Support', 'loomy', 'Local Storage', 'leveldb')
}

/**
 * Slice one balanced JSON object starting at `start`.
 *
 * Braces inside strings are skipped, and the scan stops at an unbalanced
 * closing brace so a truncated tail never swallows the record after it.
 */
function readJsonObject(text: string, start: number): string | undefined {
  if (text[start] !== '{') return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (char === undefined) break
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
      if (depth < 0) return undefined
    }
  }
  return undefined
}

/** Parse one cached record, keeping only the fields the card renders. */
export function parseLoomyPointsRecord(raw: string): LoomyPointsSummary | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    const permanent = Number(record.balance)
    const daily = Number(record.dailyBalance)
    if (!Number.isFinite(permanent) && !Number.isFinite(daily)) return undefined
    const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : undefined
    return {
      permanent: Number.isFinite(permanent) ? permanent : 0,
      daily: Number.isFinite(daily) ? daily : 0,
      ...updatedAt === undefined ? {} : { updatedAt },
    }
  } catch { return undefined }
}

/** Every cached summary in one LevelDB log, oldest first. */
export function extractLoomyPoints(text: string): LoomyPointsSummary[] {
  const found: LoomyPointsSummary[] = []
  let index = text.indexOf(LOOMY_POINTS_KEY)
  while (index !== -1) {
    const brace = text.indexOf('{', index + LOOMY_POINTS_KEY.length)
    if (brace !== -1) {
      const raw = readJsonObject(text, brace)
      if (raw !== undefined) {
        const parsed = parseLoomyPointsRecord(raw)
        if (parsed !== undefined) found.push(parsed)
      }
    }
    index = text.indexOf(LOOMY_POINTS_KEY, index + LOOMY_POINTS_KEY.length)
  }
  return found
}

/** Newest record wins; `updatedAt` decides, file order breaks ties. */
export function newestLoomyPoints(records: readonly LoomyPointsSummary[]): LoomyPointsSummary | undefined {
  let best: LoomyPointsSummary | undefined
  for (const record of records) {
    if (best === undefined) { best = record; continue }
    const bestTime = best.updatedAt === undefined ? -Infinity : Date.parse(best.updatedAt)
    const time = record.updatedAt === undefined ? -Infinity : Date.parse(record.updatedAt)
    if (time >= bestTime) best = record
  }
  return best
}

interface CacheEntry { key: string; value: LoomyPointsSummary | undefined }

/**
 * Memoize on the directory's mtime/size so a polling card does not re-read a
 * multi-megabyte log on every tick.
 */
let cache: CacheEntry | undefined

/**
 * Read the account's points summary from Loomy's localStorage.
 *
 * Returns `undefined` when Loomy has never cached a summary (or is not
 * installed) so the card can degrade instead of showing a bogus zero.
 */
export async function readLoomyPoints(dir?: string): Promise<LoomyPointsSummary | undefined> {
  const path = dir ?? process.env.LOOMY_LOCAL_STORAGE_DIR ?? defaultLoomyLocalStorageDir()
  let fingerprint = path
  try {
    const info = await stat(path)
    fingerprint = `${path}:${info.mtimeMs}:${info.size}`
    // LevelDB keeps the live records in `*.log`; a missing dir means no cache.
    const files = (await readdir(path)).filter(name => name.endsWith('.log') || name.endsWith('.ldb'))
    for (const name of files) {
      const file = await stat(join(path, name))
      fingerprint += `|${name}:${file.mtimeMs}:${file.size}`
    }
  } catch {
    cache = { key: fingerprint, value: undefined }
    return undefined
  }
  if (cache !== undefined && cache.key === fingerprint) return cache.value
  const records: LoomyPointsSummary[] = []
  try {
    const files = (await readdir(path)).filter(name => name.endsWith('.log') || name.endsWith('.ldb'))
    for (const name of files) {
      // The log is binary; `latin1` keeps every byte so offsets stay honest,
      // and the JSON we want is pure ASCII either way.
      const text = await readFile(join(path, name), 'latin1')
      records.push(...extractLoomyPoints(text))
    }
  } catch {
    cache = { key: fingerprint, value: undefined }
    return undefined
  }
  const value = newestLoomyPoints(records)
  cache = { key: fingerprint, value }
  return value
}

/** Drop the memoized read; tests and the status route use this. */
export function resetLoomyPointsCache(): void {
  cache = undefined
}
