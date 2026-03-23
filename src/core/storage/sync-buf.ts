import fs from "node:fs"
import path from "node:path"

import { deriveRawAccountId } from "../auth/accounts.js"
import { resolveStateDir } from "./state-dir.js"

function resolveAccountsDir(): string {
  return path.join(resolveStateDir(), "accounts")
}

/**
 * Path to the persistent get_updates_buf file for an account.
 * Stored alongside account data: ~/.weixin-clawbot-bridge/accounts/{accountId}.sync.json
 */
export function getSyncBufFilePath(accountId: string): string {
  return path.join(resolveAccountsDir(), `${accountId}.sync.json`)
}

export type SyncBufData = {
  get_updates_buf: string
}

function readSyncBufFile(fp: string): string | undefined {
  try {
    const raw = fs.readFileSync(fp, "utf-8")
    const data = JSON.parse(raw) as { get_updates_buf?: string }
    if (typeof data.get_updates_buf === "string") return data.get_updates_buf
  } catch {
    // file not found or invalid
  }
  return undefined
}

/**
 * Load persisted get_updates_buf.
 * Falls back: primary path (normalized accountId) -> compat path (raw accountId derived from pattern).
 */
export function loadGetUpdatesBuf(fp: string): string | undefined {
  const value = readSyncBufFile(fp)
  if (value !== undefined) return value

  // Compat: if given path uses a normalized accountId, also try the old raw-ID filename.
  const accountId = path.basename(fp, ".sync.json")
  const rawId = deriveRawAccountId(accountId)
  if (rawId) {
    const compat = path.join(resolveAccountsDir(), `${rawId}.sync.json`)
    const val = readSyncBufFile(compat)
    if (val !== undefined) return val
  }

  return undefined
}

/**
 * Persist get_updates_buf. Creates parent dir if needed.
 */
export function saveGetUpdatesBuf(fp: string, buf: string): void {
  const dir = path.dirname(fp)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(fp, JSON.stringify({ get_updates_buf: buf }, null, 0), "utf-8")
}
