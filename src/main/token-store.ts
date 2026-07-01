/**
 * ClickUp token at rest (Cadence Stage 5b — the build's secret-at-rest boundary).
 *
 * The shipped app has no `.env.local`; the user pastes their personal `pk_` token
 * into the in-app "Connect ClickUp" field, and it must persist across launches
 * WITHOUT the raw secret ever touching disk in the clear. This module wraps
 * Electron's {@link safeStorage} (DPAPI-backed on Windows) so what lands on disk is
 * an OS-encrypted blob (`clickup-token.enc` in userData) that only this OS user
 * account can decrypt.
 *
 * Load-bearing invariants (the repo is PUBLIC — see CLAUDE.md):
 *  - the RAW token is NEVER written to disk (only the encrypted blob) and NEVER
 *    logged (this module logs nothing containing it);
 *  - decryption is best-effort: any failure (encryption unavailable, blob written
 *    by a different OS user / corrupt) returns `null`, so a bad blob degrades to the
 *    connect prompt rather than crashing launch;
 *  - this is the ONLY module that imports `safeStorage`, keeping the pure ClickUp
 *    client (`clickup.ts`) and the engine free of Electron so they stay testable.
 *
 * The `.env.local` dev path stays in `clickup.ts`'s `resolveToken`; the caller
 * (`index.ts`) prefers that, then falls back to {@link readStoredToken} here — so
 * dev keeps using `.env.local` and the shipped app uses this encrypted store.
 */

import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The encrypted-blob filename in userData. Holds only ciphertext — never the
 *  raw token — so it is safe alongside the (unencrypted) cache + worklog. */
export const TOKEN_FILE = 'clickup-token.enc'

function tokenPath(): string {
  return join(app.getPath('userData'), TOKEN_FILE)
}

/** Whether OS encryption is available (DPAPI on Windows). The connect UI warns
 *  when it is not, since we refuse to persist a token in the clear. */
export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/** Whether an encrypted token blob exists on disk (does NOT prove it decrypts). */
export function hasStoredToken(): boolean {
  return existsSync(tokenPath())
}

/**
 * Read + decrypt the stored token, or `null` if there is none / it can't be
 * decrypted (encryption unavailable, blob from another OS user, corrupt file).
 * Never throws — a failure degrades to "no token" so launch continues.
 */
export function readStoredToken(): string | null {
  try {
    if (!existsSync(tokenPath())) return null
    if (!isEncryptionAvailable()) return null
    const raw = safeStorage.decryptString(readFileSync(tokenPath()))
    const token = raw.trim()
    return token.length > 0 ? token : null
  } catch {
    return null
  }
}

/**
 * Encrypt + persist a token. Returns `false` (and writes nothing) when the token
 * is blank or OS encryption is unavailable — we never fall back to plaintext. The
 * write is atomic (temp file + rename) so a crash can't leave a truncated blob.
 */
export function writeStoredToken(rawToken: string): boolean {
  const token = typeof rawToken === 'string' ? rawToken.trim() : ''
  if (token.length === 0) return false
  if (!isEncryptionAvailable()) return false
  try {
    const encrypted = safeStorage.encryptString(token)
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    const path = tokenPath()
    const tmp = path + '.tmp'
    writeFileSync(tmp, encrypted)
    renameSync(tmp, path) // atomic replace on Windows + POSIX via libuv
    return true
  } catch {
    return false
  }
}

/** Remove the stored token blob (disconnect). No-op if absent; never throws. */
export function clearStoredToken(): void {
  try {
    if (existsSync(tokenPath())) rmSync(tokenPath(), { force: true })
  } catch {
    /* best-effort */
  }
}
