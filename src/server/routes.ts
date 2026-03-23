import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import { subscribe, emit } from "./sse.js"
import { startWeixinLoginWithQr, pollQRStatus } from "../core/auth/login-qr.js"
import { getSendContext, listSendContextUsers } from "../channel.js"
import { sendMessageWeixin, markdownToPlainText } from "../core/messaging/send.js"
import { sendWeixinMediaFile } from "../core/messaging/send-media.js"
import type { WeixinQrStartResult } from "../core/auth/login-qr.js"
import { listIndexedWeixinAccountIds, loadWeixinAccount, saveWeixinAccount, registerWeixinAccountId, DEFAULT_BASE_URL } from "../core/auth/accounts.js"
import { logger } from "../core/util/logger.js"

// --- Internal state ---

let phase: "idle" | "qr" | "scanned" | "confirmed" | "expired" = "idle"
let adapter = "unknown"
const codes = new Map<string, string>()

export function setAdapterName(name: string) {
  adapter = name
}

// --- Background login polling ---

async function poll(key: string) {
  phase = "qr"
  const qrcode = codes.get(key)
  if (!qrcode) return

  const deadline = Date.now() + 480_000

  while (Date.now() < deadline) {
    const status = await pollQRStatus(DEFAULT_BASE_URL, qrcode)

    if (status.status === "scaned") {
      phase = "scanned"
      emit("weixin.scanned", {})
    }

    if (status.status === "confirmed") {
      phase = "confirmed"
      emit("weixin.confirmed", {
        accountId: status.ilink_bot_id,
        userId: status.ilink_user_id,
      })

      if (status.ilink_bot_id && status.bot_token) {
        const id = status.ilink_bot_id.trim().replace(/[@.]/g, "-")
        saveWeixinAccount(id, {
          token: status.bot_token,
          baseUrl: status.baseurl,
          userId: status.ilink_user_id,
        })
        registerWeixinAccountId(id)
      }
      return
    }

    if (status.status === "expired") {
      phase = "expired"
      emit("weixin.expired", {})
      return
    }

    // status === "wait", continue
    await Bun.sleep(1000)
  }

  phase = "expired"
  emit("weixin.expired", { message: "timeout" })
}

// --- Router ---

export function createRouter() {
  const app = new Hono()

  app.use("*", cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }))

  // --- Login ---

  app.post("/api/login/qr", async (c) => {
    const result: WeixinQrStartResult = await startWeixinLoginWithQr({
      apiBaseUrl: DEFAULT_BASE_URL,
      botType: "3",
    })

    if (result.qrcodeUrl) {
      emit("weixin.qr", { url: result.qrcodeUrl, sessionKey: result.sessionKey })
    }

    if (result.qrcode) {
      codes.set(result.sessionKey, result.qrcode)
    }

    poll(result.sessionKey).catch((err) => {
      logger.error(`login poll error: ${String(err)}`)
    })

    return c.json({
      url: result.qrcodeUrl ?? null,
      img: result.qrcodeUrl ?? null,
      message: result.message,
      sessionKey: result.sessionKey,
    })
  })

  app.get("/api/login/status", (c) => {
    return c.json({ phase })
  })

  // --- Account ---

  app.get("/api/account", (c) => {
    const ids = listIndexedWeixinAccountIds()
    const list = ids.map((id) => {
      const data = loadWeixinAccount(id)
      return {
        id,
        status: data?.token ? "connected" : "disconnected",
        userId: data?.userId ?? null,
      }
    })
    return c.json(list)
  })

  // --- Status ---

  app.get("/api/status", (c) => {
    const ids = listIndexedWeixinAccountIds()
    const connected = ids.some((id) => {
      const data = loadWeixinAccount(id)
      return Boolean(data?.token)
    })
    return c.json({
      ok: true,
      connected,
      accounts: ids.length,
      adapter,
    })
  })

  // --- SSE ---

  app.get("/events", (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: "weixin.connected", data: JSON.stringify({ ok: true }) })

      const unsub = subscribe(async (event, data) => {
        await stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {})
      })

      const timer = setInterval(async () => {
        await stream.writeSSE({ event: "weixin.heartbeat", data: JSON.stringify({ ts: Date.now() }) }).catch(() => {})
      }, 30_000)

      stream.onAbort(() => {
        unsub()
        clearInterval(timer)
      })

      await new Promise<void>((resolve) => {
        stream.onAbort(resolve)
      })
    })
  })

  // --- Send text message ---

  app.post("/api/send", async (c) => {
    const body = await c.req.json<{ to?: string; text?: string }>()
    const to = body.to
    if (!to) return c.json({ error: "missing 'to' field" }, 400)
    if (!body.text) return c.json({ error: "missing 'text' field" }, 400)

    const ctx = getSendContext(to)
    if (!ctx) {
      const users = listSendContextUsers()
      return c.json({
        error: `no context for user '${to}'. Available users: ${users.join(", ") || "(none yet — wait for first inbound message)"}`,
      }, 404)
    }

    try {
      const plain = markdownToPlainText(body.text)
      const chunks = []
      for (let i = 0; i < plain.length; i += 4000) {
        chunks.push(plain.slice(i, i + 4000))
      }
      if (chunks.length === 0) chunks.push(plain)

      for (const chunk of chunks) {
        await sendMessageWeixin({
          to,
          text: chunk,
          opts: { baseUrl: ctx.baseUrl, token: ctx.token, contextToken: ctx.contextToken },
        })
      }
      logger.info(`[api/send] sent to=${to} len=${plain.length}`)
      emit("weixin.message", { direction: "outbound", to, type: "text" })
      return c.json({ ok: true, to, length: plain.length })
    } catch (err) {
      logger.error(`[api/send] error: ${err}`)
      return c.json({ error: String(err) }, 500)
    }
  })

  // --- Send media (image/video/file) ---

  app.post("/api/sendMedia", async (c) => {
    const body = await c.req.json<{ to?: string; file?: string; text?: string }>()
    const to = body.to
    if (!to) return c.json({ error: "missing 'to' field" }, 400)
    if (!body.file) return c.json({ error: "missing 'file' field (absolute path to local file)" }, 400)

    const ctx = getSendContext(to)
    if (!ctx) {
      const users = listSendContextUsers()
      return c.json({
        error: `no context for user '${to}'. Available users: ${users.join(", ") || "(none yet — wait for first inbound message)"}`,
      }, 404)
    }

    try {
      await sendWeixinMediaFile({
        filePath: body.file,
        to,
        text: body.text ?? "",
        opts: { baseUrl: ctx.baseUrl, token: ctx.token, contextToken: ctx.contextToken },
        cdnBaseUrl: ctx.cdnBaseUrl,
      })
      logger.info(`[api/sendMedia] sent to=${to} file=${body.file}`)
      return c.json({ ok: true, to, file: body.file })
    } catch (err) {
      logger.error(`[api/sendMedia] error: ${err}`)
      return c.json({ error: String(err) }, 500)
    }
  })

  // --- 404 ---

  app.notFound((c) => {
    return c.json({ error: "not found" }, 404)
  })

  return app
}
