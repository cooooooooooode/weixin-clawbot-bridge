import { getUpdates } from "../api/api.js"
import { SESSION_EXPIRED_ERRCODE, pauseSession, getRemainingPauseMs } from "../api/session-guard.js"
import { getSyncBufFilePath, loadGetUpdatesBuf, saveGetUpdatesBuf } from "../storage/sync-buf.js"
import { logger } from "../util/logger.js"
import type { Logger } from "../util/logger.js"
import type { WeixinMessage } from "../api/types.js"

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000
const MAX_CONSECUTIVE_FAILURES = 3
const BACKOFF_DELAY_MS = 30_000
const RETRY_DELAY_MS = 2_000

export type MonitorWeixinOpts = {
  baseUrl: string
  cdnBaseUrl: string
  token?: string
  accountId: string
  onMessage: (msg: WeixinMessage, deps: { baseUrl: string; cdnBaseUrl: string; token?: string; accountId: string }) => Promise<void>
  abortSignal?: AbortSignal
  longPollTimeoutMs?: number
}

/**
 * Long-poll loop: getUpdates -> onMessage callback.
 * Runs until abort.
 */
export async function monitorWeixinProvider(opts: MonitorWeixinOpts): Promise<void> {
  const aLog: Logger = logger.withAccount(opts.accountId)

  aLog.info(`Monitor started: baseUrl=${opts.baseUrl} timeoutMs=${opts.longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS}`)

  const syncFilePath = getSyncBufFilePath(opts.accountId)
  aLog.debug(`syncFilePath: ${syncFilePath}`)

  const previous = loadGetUpdatesBuf(syncFilePath)
  let buf = previous ?? ""

  if (previous) {
    aLog.debug(`Using previous get_updates_buf (${buf.length} bytes)`)
  } else {
    aLog.info(`No previous get_updates_buf found, starting fresh`)
  }

  let nextTimeout = opts.longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS
  let failures = 0

  while (!opts.abortSignal?.aborted) {
    try {
      aLog.debug(
        `getUpdates: get_updates_buf=${buf.substring(0, 50)}..., timeoutMs=${nextTimeout}`,
      )
      const resp = await getUpdates({
        baseUrl: opts.baseUrl,
        token: opts.token,
        get_updates_buf: buf,
        timeoutMs: nextTimeout,
      })
      aLog.debug(
        `getUpdates response: ret=${resp.ret}, msgs=${resp.msgs?.length ?? 0}, get_updates_buf_length=${resp.get_updates_buf?.length ?? 0}`,
      )

      if (resp.longpolling_timeout_ms != null && resp.longpolling_timeout_ms > 0) {
        nextTimeout = resp.longpolling_timeout_ms
        aLog.debug(`Updated next poll timeout: ${nextTimeout}ms`)
      }
      const isApiError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0)
      if (isApiError) {
        const expired =
          resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE

        if (expired) {
          pauseSession(opts.accountId)
          const pauseMs = getRemainingPauseMs(opts.accountId)
          aLog.error(
            `getUpdates: session expired (errcode=${resp.errcode} ret=${resp.ret}), pausing all requests for ${Math.ceil(pauseMs / 60_000)} min`,
          )
          failures = 0
          await sleep(pauseMs, opts.abortSignal)
          continue
        }

        failures += 1
        aLog.error(
          `getUpdates failed: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg} (${failures}/${MAX_CONSECUTIVE_FAILURES})`,
        )
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          aLog.error(
            `getUpdates: ${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off 30s`,
          )
          failures = 0
          await sleep(BACKOFF_DELAY_MS, opts.abortSignal)
        } else {
          await sleep(RETRY_DELAY_MS, opts.abortSignal)
        }
        continue
      }
      failures = 0
      if (resp.get_updates_buf != null && resp.get_updates_buf !== "") {
        saveGetUpdatesBuf(syncFilePath, resp.get_updates_buf)
        buf = resp.get_updates_buf
        aLog.debug(`Saved new get_updates_buf (${buf.length} bytes)`)
      }
      const list = resp.msgs ?? []
      for (const full of list) {
        aLog.info(
          `inbound message: from=${full.from_user_id} types=${full.item_list?.map((i) => i.type).join(",") ?? "none"}`,
        )

        await opts.onMessage(full, {
          baseUrl: opts.baseUrl,
          cdnBaseUrl: opts.cdnBaseUrl,
          token: opts.token,
          accountId: opts.accountId,
        })
      }
    } catch (err) {
      if (opts.abortSignal?.aborted) {
        aLog.info(`Monitor stopped (aborted)`)
        return
      }
      failures += 1
      aLog.error(`getUpdates error: ${String(err)}, stack=${(err as Error).stack}`)
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        aLog.error(
          `getUpdates: ${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off 30s`,
        )
        failures = 0
        await sleep(30_000, opts.abortSignal)
      } else {
        await sleep(2000, opts.abortSignal)
      }
    }
  }
  aLog.info(`Monitor ended`)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t)
        reject(new Error("aborted"))
      },
      { once: true },
    )
  })
}
