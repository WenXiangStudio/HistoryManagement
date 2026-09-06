import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'

/**
 * Electron safeStorage is backed by Windows DPAPI. The encrypted blob is useless
 * outside the current Windows account and is never written to SQLite or logs.
 */
export class CredentialStore {
  constructor(private readonly path: string) {}

  setApiKey(value: string): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable')
    mkdirSync(dirname(this.path), { recursive: true })
    const encrypted = safeStorage.encryptString(value)
    writeFileSync(this.path, encrypted, { mode: 0o600 })
  }

  getApiKey(): string | null {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null
      return safeStorage.decryptString(readFileSync(this.path))
    } catch {
      return null
    }
  }

  hasApiKey(): boolean {
    return Boolean(this.getApiKey())
  }
}
