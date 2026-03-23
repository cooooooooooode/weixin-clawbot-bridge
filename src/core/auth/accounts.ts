import fs from "node:fs"
import path from "node:path"

import { resolveStateDir } from "../storage/state-dir.js"
import { logger } from "../util/logger.js"

export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com"
export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c"

function normalizeAccountId(raw: string): string {
  return raw.trim().replace(/[@.]/g, "-")
}

// ---------------------------------------------------------------------------
// Account ID compatibility (legacy raw ID -> normalized ID)
// ---------------------------------------------------------------------------

/**
 * Pattern-based reverse of normalizeAccountId for known weixin ID suffixes.
 * Used only as a compatibility fallback when loading accounts / sync bufs stored
 * under the old raw ID.
 */
export function deriveRawAccountId(id: string): string | undefined {
  if (id.endsWith("-im-bot")) return `${id.slice(0, -7)}@im.bot`
  if (id.endsWith("-im-wechat")) return `${id.slice(0, -10)}@im.wechat`
  return undefined
}

// ---------------------------------------------------------------------------
// Account index (persistent list of registered account IDs)
// ---------------------------------------------------------------------------

function resolveWeixinStateDir(): string {
  return resolveStateDir()
}

function resolveAccountIndexPath(): string {
  return path.join(resolveWeixinStateDir(), "accounts.json")
}

/** Returns all accountIds registered via QR login. */
export function listIndexedWeixinAccountIds(): string[] {
  const fp = resolveAccountIndexPath()
  try {
    if (!fs.existsSync(fp)) return []
    const raw = fs.readFileSync(fp, "utf-8")
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === "string" && id.trim() !== "")
  } catch {
    return []
  }
}

/** Add accountId to the persistent index (no-op if already present). */
export function registerWeixinAccountId(accountId: string): void {
  const dir = resolveWeixinStateDir()
  fs.mkdirSync(dir, { recursive: true })
  const existing = listIndexedWeixinAccountIds()
  if (existing.includes(accountId)) return
  const updated = [...existing, accountId]
  fs.writeFileSync(resolveAccountIndexPath(), JSON.stringify(updated, null, 2), "utf-8")
}

// ---------------------------------------------------------------------------
// Account store (per-account credential files)
// ---------------------------------------------------------------------------

/** Unified per-account data: token + baseUrl in one file. */
export type WeixinAccountData = {
  token?: string
  savedAt?: string
  baseUrl?: string
  /** Last linked Weixin user id from QR login (optional). */
  userId?: string
}

function resolveAccountsDir(): string {
  return path.join(resolveWeixinStateDir(), "accounts")
}

function resolveAccountPath(accountId: string): string {
  return path.join(resolveAccountsDir(), `${accountId}.json`)
}

function readAccountFile(fp: string): WeixinAccountData | null {
  try {
    if (fs.existsSync(fp)) {
      return JSON.parse(fs.readFileSync(fp, "utf-8")) as WeixinAccountData
    }
  } catch {
    // ignore
  }
  return null
}

/** Load account data by ID, with compatibility fallbacks. */
export function loadWeixinAccount(accountId: string): WeixinAccountData | null {
  const primary = readAccountFile(resolveAccountPath(accountId))
  if (primary) return primary

  const rawId = deriveRawAccountId(accountId)
  if (rawId) {
    const compat = readAccountFile(resolveAccountPath(rawId))
    if (compat) return compat
  }

  return null
}

/**
 * Persist account data after QR login (merges into existing file).
 */
export function saveWeixinAccount(
  accountId: string,
  update: { token?: string; baseUrl?: string; userId?: string },
): void {
  const dir = resolveAccountsDir()
  fs.mkdirSync(dir, { recursive: true })

  const existing = loadWeixinAccount(accountId) ?? {}

  const token = update.token?.trim() || existing.token
  const base = update.baseUrl?.trim() || existing.baseUrl
  const uid =
    update.userId !== undefined
      ? update.userId.trim() || undefined
      : existing.userId?.trim() || undefined

  const data: WeixinAccountData = {
    ...(token ? { token, savedAt: new Date().toISOString() } : {}),
    ...(base ? { baseUrl: base } : {}),
    ...(uid ? { userId: uid } : {}),
  }

  const fp = resolveAccountPath(accountId)
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8")
  try {
    fs.chmodSync(fp, 0o600)
  } catch {
    // best-effort
  }
}

/** Remove account data file. */
export function clearWeixinAccount(accountId: string): void {
  try {
    fs.unlinkSync(resolveAccountPath(accountId))
  } catch {
    // ignore if not found
  }
}

// ---------------------------------------------------------------------------
// Account resolution (merge stored credentials)
// ---------------------------------------------------------------------------

export type ResolvedWeixinAccount = {
  accountId: string
  baseUrl: string
  cdnBaseUrl: string
  token?: string
  enabled: boolean
  /** true when a token has been obtained via QR login. */
  configured: boolean
}

/** List accountIds from the index file (written at QR login). */
export function listWeixinAccountIds(): string[] {
  return listIndexedWeixinAccountIds()
}

/** Resolve a weixin account by ID, merging stored credentials. */
export function resolveWeixinAccount(accountId?: string | null): ResolvedWeixinAccount {
  const raw = accountId?.trim()
  if (!raw) throw new Error("weixin: accountId is required")
  const id = normalizeAccountId(raw)
  const data = loadWeixinAccount(id)
  const token = data?.token?.trim() || undefined
  const base = data?.baseUrl?.trim() || ""
  return {
    accountId: id,
    baseUrl: base || DEFAULT_BASE_URL,
    cdnBaseUrl: CDN_BASE_URL,
    token,
    enabled: true,
    configured: Boolean(token),
  }
}
