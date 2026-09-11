/** Read Loomy's desktop sign-in state without ever modifying it. */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const LOOMY_AUTH_FILE_ENV = 'LOOMY_AUTH_FILE'
export const LOOMY_CONFIG_FILE_ENV = 'LOOMY_CONFIG_FILE'

export interface LoomyCredential {
  session: string
  userId: string
  /** Already-masked phone number Loomy stores alongside the session, for display only. */
  maskedPhone?: string
}

export function defaultLoomyAuthPath(): string {
  return join(homedir(), 'Library', 'Application Support', 'loomy', 'auth-session.json')
}

export function defaultLoomyConfigPath(): string {
  return join(homedir(), '.config', 'loomy-opencode', 'opencode.json')
}

export function parseLoomyAuth(text: string): LoomyCredential | undefined {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    const session = typeof record.session === 'string' ? record.session.trim() : ''
    const userId = typeof record.userid === 'string' ? record.userid.trim() : ''
    if (session === '' || userId === '') return undefined
    const phone = typeof record.phone === 'string' ? record.phone.trim() : ''
    return {
      session,
      userId,
      // Loomy already stores this masked (e.g. `136****1234`); keep it that way.
      ...phone === '' ? {} : { maskedPhone: phone },
    }
  } catch { return undefined }
}

export async function readLoomyCredential(authFile?: string): Promise<LoomyCredential> {
  const path = authFile ?? process.env[LOOMY_AUTH_FILE_ENV] ?? defaultLoomyAuthPath()
  const credential = parseLoomyAuth(await readFile(path, 'utf8'))
  if (credential === undefined) throw new Error('Loomy is not signed in. Sign in through the Loomy desktop app first.')
  return credential
}
