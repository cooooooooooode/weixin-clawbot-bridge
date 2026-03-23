import fs from "node:fs"
import path from "node:path"

import { resolveStateDir } from "../storage/state-dir.js"
import { logger } from "../util/logger.js"

/**
 * Resolve the credentials directory.
 * Path: $WEIXIN_CLAW_CREDENTIALS_DIR || $OPENCLAW_OAUTH_DIR || <stateDir>/credentials
 */
function resolveCredentialsDir(): string {
  const override =
    process.env.WEIXIN_CLAW_CREDENTIALS_DIR?.trim() ||
    process.env.OPENCLAW_OAUTH_DIR?.trim()
  if (override) return override
  return path.join(resolveStateDir(), "credentials")
}

/**
 * Sanitize a channel/account key for safe use in filenames.
 */
function safeKey(raw: string): string {
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) throw new Error("invalid key for allowFrom path")
  const safe = trimmed.replace(/[\\/:*?"<>|]/g, "_").replace(/\.\./g, "_")
  if (!safe || safe === "_") throw new Error("invalid key for allowFrom path")
  return safe
}

/**
 * Resolve the framework allowFrom file path for a given account.
 * Path: `<credDir>/wx-clawbot-<accountId>-allowFrom.json`
 */
export function resolveFrameworkAllowFromPath(accountId: string): string {
  const base = safeKey("wx-clawbot")
  const account = safeKey(accountId)
  return path.join(resolveCredentialsDir(), `${base}-${account}-allowFrom.json`)
}

type AllowFromFileContent = {
  version: number
  allowFrom: string[]
}

/**
 * Read the framework allowFrom list for an account (user IDs authorized via pairing).
 * Returns an empty array when the file is missing or unreadable.
 */
export function readFrameworkAllowFromList(accountId: string): string[] {
  const fp = resolveFrameworkAllowFromPath(accountId)
  try {
    if (!fs.existsSync(fp)) return []
    const raw = fs.readFileSync(fp, "utf-8")
    const parsed = JSON.parse(raw) as AllowFromFileContent
    if (Array.isArray(parsed.allowFrom)) {
      return parsed.allowFrom.filter((id): id is string => typeof id === "string" && id.trim() !== "")
    }
  } catch {
    // best-effort
  }
  return []
}

/**
 * Register a user ID in the framework's channel allowFrom store.
 * Writes directly to the same JSON file that `readFrameworkAllowFromList` reads.
 */
export async function registerUserInFrameworkStore(params: {
  accountId: string
  userId: string
}): Promise<{ changed: boolean }> {
  const trimmed = params.userId.trim()
  if (!trimmed) return { changed: false }

  const fp = resolveFrameworkAllowFromPath(params.accountId)
  const dir = path.dirname(fp)
  fs.mkdirSync(dir, { recursive: true })

  let content: AllowFromFileContent = { version: 1, allowFrom: [] }
  try {
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp, "utf-8")
      const parsed = JSON.parse(raw) as AllowFromFileContent
      if (Array.isArray(parsed.allowFrom)) content = parsed
    }
  } catch { /* ignore */ }

  if (content.allowFrom.includes(trimmed)) return { changed: false }

  content.allowFrom.push(trimmed)
  fs.writeFileSync(fp, JSON.stringify(content, null, 2), "utf-8")
  logger.info(`registerUserInFrameworkStore: added userId=${trimmed} accountId=${params.accountId}`)
  return { changed: true }
}
