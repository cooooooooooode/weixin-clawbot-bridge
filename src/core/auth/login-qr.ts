import { randomUUID } from "node:crypto"

import { logger } from "../util/logger.js"
import { redactToken } from "../util/redact.js"

type ActiveLogin = {
  sessionKey: string
  id: string
  qrcode: string
  qrcodeUrl: string
  startedAt: number
  botToken?: string
  status?: "wait" | "scaned" | "confirmed" | "expired"
  error?: string
}

const ACTIVE_LOGIN_TTL_MS = 5 * 60_000
/** Client-side timeout for the long-poll get_qrcode_status request. */
const QR_LONG_POLL_TIMEOUT_MS = 35_000

/** Default `bot_type` for ilink get_bot_qrcode / get_qrcode_status (this channel build). */
export const DEFAULT_ILINK_BOT_TYPE = "3"

const activeLogins = new Map<string, ActiveLogin>()

interface QRCodeResponse {
  qrcode: string
  qrcode_img_content: string
}

interface StatusResponse {
  status: "wait" | "scaned" | "confirmed" | "expired"
  bot_token?: string
  ilink_bot_id?: string
  baseurl?: string
  /** The user ID of the person who scanned the QR code. */
  ilink_user_id?: string
}

function isLoginFresh(login: ActiveLogin): boolean {
  return Date.now() - login.startedAt < ACTIVE_LOGIN_TTL_MS
}

/** Remove all expired entries from the activeLogins map to prevent memory leaks. */
function purgeExpiredLogins(): void {
  for (const [id, login] of activeLogins) {
    if (!isLoginFresh(login)) activeLogins.delete(id)
  }
}

export async function fetchQRCode(apiBaseUrl: string, botType: string): Promise<QRCodeResponse> {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`
  const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`, base)
  logger.info(`Fetching QR code from: ${url.toString()}`)

  const response = await fetch(url.toString())
  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)")
    logger.error(`QR code fetch failed: ${response.status} ${response.statusText} body=${body}`)
    throw new Error(`Failed to fetch QR code: ${response.status} ${response.statusText}`)
  }
  return await response.json()
}

export async function pollQRStatus(apiBaseUrl: string, qrcode: string): Promise<StatusResponse> {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`
  const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, base)
  logger.debug(`Long-poll QR status from: ${url.toString()}`)

  const headers: Record<string, string> = {
    "iLink-App-ClientVersion": "1",
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), QR_LONG_POLL_TIMEOUT_MS)
  try {
    const response = await fetch(url.toString(), { headers, signal: controller.signal })
    clearTimeout(timer)
    logger.debug(`pollQRStatus: HTTP ${response.status}, reading body...`)
    const raw = await response.text()
    logger.debug(`pollQRStatus: body=${raw.substring(0, 200)}`)
    if (!response.ok) {
      logger.error(`QR status poll failed: ${response.status} ${response.statusText} body=${raw}`)
      throw new Error(`Failed to poll QR status: ${response.status} ${response.statusText}`)
    }
    return JSON.parse(raw) as StatusResponse
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === "AbortError") {
      logger.debug(`pollQRStatus: client-side timeout after ${QR_LONG_POLL_TIMEOUT_MS}ms, returning wait`)
      return { status: "wait" }
    }
    throw err
  }
}

export type WeixinQrStartResult = {
  qrcodeUrl?: string
  qrcode?: string
  message: string
  sessionKey: string
}

export type WeixinQrWaitResult = {
  connected: boolean
  botToken?: string
  accountId?: string
  baseUrl?: string
  /** The user ID of the person who scanned the QR code; add to allowFrom. */
  userId?: string
  message: string
}

export async function startWeixinLoginWithQr(opts: {
  verbose?: boolean
  timeoutMs?: number
  force?: boolean
  accountId?: string
  apiBaseUrl: string
  botType?: string
}): Promise<WeixinQrStartResult> {
  const sessionKey = opts.accountId || randomUUID()

  purgeExpiredLogins()

  const existing = activeLogins.get(sessionKey)
  if (!opts.force && existing && isLoginFresh(existing) && existing.qrcodeUrl) {
    return {
      qrcodeUrl: existing.qrcodeUrl,
      message: "\u4e8c\u7ef4\u7801\u5df2\u5c31\u7eea\uff0c\u8bf7\u4f7f\u7528\u5fae\u4fe1\u626b\u63cf\u3002",
      sessionKey,
    }
  }

  try {
    const botType = opts.botType || DEFAULT_ILINK_BOT_TYPE
    logger.info(`Starting Weixin login with bot_type=${botType}`)

    if (!opts.apiBaseUrl) {
      return {
        message: "No baseUrl configured. Set apiBaseUrl before logging in.",
        sessionKey,
      }
    }

    const qr = await fetchQRCode(opts.apiBaseUrl, botType)
    logger.info(
      `QR code received, qrcode=${redactToken(qr.qrcode)} imgContentLen=${qr.qrcode_img_content?.length ?? 0}`,
    )
    logger.info(`\u4e8c\u7ef4\u7801\u94fe\u63a5: ${qr.qrcode_img_content}`)

    const login: ActiveLogin = {
      sessionKey,
      id: randomUUID(),
      qrcode: qr.qrcode,
      qrcodeUrl: qr.qrcode_img_content,
      startedAt: Date.now(),
    }

    activeLogins.set(sessionKey, login)

    return {
      qrcodeUrl: qr.qrcode_img_content,
      qrcode: qr.qrcode,
      message: "\u4f7f\u7528\u5fae\u4fe1\u626b\u63cf\u4ee5\u4e0b\u4e8c\u7ef4\u7801\uff0c\u4ee5\u5b8c\u6210\u8fde\u63a5\u3002",
      sessionKey,
    }
  } catch (err) {
    logger.error(`Failed to start Weixin login: ${String(err)}`)
    return {
      message: `Failed to start login: ${String(err)}`,
      sessionKey,
    }
  }
}

const MAX_QR_REFRESH_COUNT = 3

export async function waitForWeixinLogin(opts: {
  timeoutMs?: number
  verbose?: boolean
  sessionKey: string
  apiBaseUrl: string
  botType?: string
}): Promise<WeixinQrWaitResult> {
  let activeLogin = activeLogins.get(opts.sessionKey)

  if (!activeLogin) {
    logger.warn(`waitForWeixinLogin: no active login sessionKey=${opts.sessionKey}`)
    return {
      connected: false,
      message: "\u5f53\u524d\u6ca1\u6709\u8fdb\u884c\u4e2d\u7684\u767b\u5f55\uff0c\u8bf7\u5148\u53d1\u8d77\u767b\u5f55\u3002",
    }
  }

  if (!isLoginFresh(activeLogin)) {
    logger.warn(`waitForWeixinLogin: login QR expired sessionKey=${opts.sessionKey}`)
    activeLogins.delete(opts.sessionKey)
    return {
      connected: false,
      message: "\u4e8c\u7ef4\u7801\u5df2\u8fc7\u671f\uff0c\u8bf7\u91cd\u65b0\u751f\u6210\u3002",
    }
  }

  const timeoutMs = Math.max(opts.timeoutMs ?? 480_000, 1000)
  const deadline = Date.now() + timeoutMs
  let scanned = false
  let refreshCount = 1

  logger.info("Starting to poll QR code status...")

  while (Date.now() < deadline) {
    try {
      const status = await pollQRStatus(opts.apiBaseUrl, activeLogin.qrcode)
      logger.debug(`pollQRStatus: status=${status.status} hasBotToken=${Boolean(status.bot_token)} hasBotId=${Boolean(status.ilink_bot_id)}`)
      activeLogin.status = status.status

      switch (status.status) {
        case "wait":
          break
        case "scaned":
          if (!scanned) {
            logger.info("QR code scanned, waiting for confirmation...")
            scanned = true
          }
          break
        case "expired": {
          refreshCount++
          if (refreshCount > MAX_QR_REFRESH_COUNT) {
            logger.warn(
              `waitForWeixinLogin: QR expired ${MAX_QR_REFRESH_COUNT} times, giving up sessionKey=${opts.sessionKey}`,
            )
            activeLogins.delete(opts.sessionKey)
            return {
              connected: false,
              message: "\u767b\u5f55\u8d85\u65f6\uff1a\u4e8c\u7ef4\u7801\u591a\u6b21\u8fc7\u671f\uff0c\u8bf7\u91cd\u65b0\u5f00\u59cb\u767b\u5f55\u6d41\u7a0b\u3002",
            }
          }

          logger.info(
            `waitForWeixinLogin: QR expired, refreshing (${refreshCount}/${MAX_QR_REFRESH_COUNT})`,
          )

          try {
            const botType = opts.botType || DEFAULT_ILINK_BOT_TYPE
            const qr = await fetchQRCode(opts.apiBaseUrl, botType)
            activeLogin.qrcode = qr.qrcode
            activeLogin.qrcodeUrl = qr.qrcode_img_content
            activeLogin.startedAt = Date.now()
            scanned = false
            logger.info(`waitForWeixinLogin: new QR code obtained qrcode=${redactToken(qr.qrcode)}`)
          } catch (err) {
            logger.error(`waitForWeixinLogin: failed to refresh QR code: ${String(err)}`)
            activeLogins.delete(opts.sessionKey)
            return {
              connected: false,
              message: `\u5237\u65b0\u4e8c\u7ef4\u7801\u5931\u8d25: ${String(err)}`,
            }
          }
          break
        }
        case "confirmed": {
          if (!status.ilink_bot_id) {
            activeLogins.delete(opts.sessionKey)
            logger.error("Login confirmed but ilink_bot_id missing from response")
            return {
              connected: false,
              message: "\u767b\u5f55\u5931\u8d25\uff1a\u670d\u52a1\u5668\u672a\u8fd4\u56de ilink_bot_id\u3002",
            }
          }

          activeLogin.botToken = status.bot_token
          activeLogins.delete(opts.sessionKey)

          logger.info(
            `Login confirmed! ilink_bot_id=${status.ilink_bot_id} ilink_user_id=${redactToken(status.ilink_user_id)}`,
          )

          return {
            connected: true,
            botToken: status.bot_token,
            accountId: status.ilink_bot_id,
            baseUrl: status.baseurl,
            userId: status.ilink_user_id,
            message: "\u2705 \u4e0e\u5fae\u4fe1\u8fde\u63a5\u6210\u529f\uff01",
          }
        }
      }
    } catch (err) {
      logger.error(`Error polling QR status: ${String(err)}`)
      activeLogins.delete(opts.sessionKey)
      return {
        connected: false,
        message: `Login failed: ${String(err)}`,
      }
    }

    await new Promise((r) => setTimeout(r, 1000))
  }

  logger.warn(
    `waitForWeixinLogin: timed out waiting for QR scan sessionKey=${opts.sessionKey} timeoutMs=${timeoutMs}`,
  )
  activeLogins.delete(opts.sessionKey)
  return {
    connected: false,
    message: "\u767b\u5f55\u8d85\u65f6\uff0c\u8bf7\u91cd\u8bd5\u3002",
  }
}
