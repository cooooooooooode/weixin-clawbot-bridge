import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import { load, save, configPath } from "../config.js"
import type { Config } from "../config.js"
import { html } from "./init-page.js"
import { spawn as spawnDaemon, logPath } from "./daemon.js"
import { startWeixinLoginWithQr, pollQRStatus } from "../core/auth/login-qr.js"
import { listIndexedWeixinAccountIds, loadWeixinAccount, saveWeixinAccount, registerWeixinAccountId, DEFAULT_BASE_URL } from "../core/auth/accounts.js"
import { subscribe, emit } from "../server/sse.js"

// --- Login state ---
let phase: "idle" | "qr" | "scanned" | "confirmed" | "expired" = "idle"
const codes = new Map<string, string>()

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
    await Bun.sleep(1000)
  }
  phase = "expired"
  emit("weixin.expired", { message: "timeout" })
}

// --- Init entry ---

export async function init(vals: Record<string, string | undefined>): Promise<void> {
  const has = vals.adapter || vals.port || vals.url || vals.endpoint || vals.directory
  if (has) return headless(vals)
  return interactive()
}

// --- Headless mode ---

async function headless(vals: Record<string, string | undefined>) {
  const cfg: Config = {}

  if (vals.adapter) cfg.adapter = vals.adapter as Config["adapter"]
  if (vals.port) cfg.port = parseInt(vals.port, 10)
  if (vals.adapter === "opencode" || vals.url || vals.directory) {
    cfg.opencode = {}
    if (vals.url) cfg.opencode.url = vals.url
    if (vals.directory) cfg.opencode.directory = vals.directory
  }
  if (vals.adapter === "webhook" || vals.endpoint) {
    cfg.webhook = {}
    if (vals.endpoint) cfg.webhook.endpoint = vals.endpoint
  }

  await save(cfg)
  console.log(`[weixin-clawbot-bridge] 配置已保存: ${configPath()}`)
  console.log(JSON.stringify(cfg, null, 2))

  // Spawn daemon
  const pid = await spawnDaemon()
  const port = cfg.port ?? 3200
  console.log()
  console.log(`[weixin-clawbot-bridge] 通过 HTTP API 完成扫码登录:`)
  console.log(`  POST http://localhost:${port}/api/login/qr`)
  console.log(`  GET  http://localhost:${port}/events (SSE)`)
  console.log(`  GET  http://localhost:${port}/api/status`)
}

// --- Interactive mode ---

async function interactive() {
  const cfg = await load()

  const app = new Hono()
  app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type"] }))

  // Serve init page
  app.get("/", (c) => c.html(html(cfg)))

  // Config API
  app.get("/api/config", async (c) => {
    const current = await load()
    return c.json(current)
  })

  app.post("/api/config", async (c) => {
    const body = await c.req.json<Config>()
    await save(body)
    return c.json({ ok: true, path: configPath() })
  })

  // Login API (same pattern as routes.ts)
  app.post("/api/login/qr", async (c) => {
    const result = await startWeixinLoginWithQr({ apiBaseUrl: DEFAULT_BASE_URL, botType: "3" })
    if (result.qrcodeUrl) emit("weixin.qr", { url: result.qrcodeUrl, sessionKey: result.sessionKey })
    if (result.qrcode) codes.set(result.sessionKey, result.qrcode)
    poll(result.sessionKey).catch(() => {})
    return c.json({
      url: result.qrcodeUrl ?? null,
      img: result.qrcodeUrl ?? null,
      message: result.message,
      sessionKey: result.sessionKey,
    })
  })

  app.get("/api/login/status", (c) => c.json({ phase }))

  // Account list
  app.get("/api/account", (c) => {
    const ids = listIndexedWeixinAccountIds()
    const list = ids.map((id) => {
      const data = loadWeixinAccount(id)
      return { id, status: data?.token ? "connected" : "disconnected", userId: data?.userId ?? null }
    })
    return c.json(list)
  })

  // SSE events
  app.get("/events", (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: "weixin.connected", data: JSON.stringify({ ok: true }) })
      const unsub = subscribe(async (event, data) => {
        await stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {})
      })
      const timer = setInterval(async () => {
        await stream.writeSSE({ event: "weixin.heartbeat", data: JSON.stringify({ ts: Date.now() }) }).catch(() => {})
      }, 30_000)
      stream.onAbort(() => { unsub(); clearInterval(timer) })
      await new Promise<void>((resolve) => { stream.onAbort(resolve) })
    })
  })

  // Start daemon from UI
  app.post("/api/start", async (c) => {
    const pid = await spawnDaemon()
    return c.json({ ok: true, pid, log: logPath() })
  })

  app.notFound((c) => c.json({ error: "not found" }, 404))

  // Use a different port from the main service
  const port = (cfg.port ?? 3200) + 1
  const server = Bun.serve({ port, fetch: app.fetch, idleTimeout: 255 })
  const url = `http://localhost:${server.port}`

  console.log(`[weixin-clawbot-bridge] 配置页面: ${url}`)
  console.log(`[weixin-clawbot-bridge] 在浏览器中完成配置和登录后，点击"启动服务"`)

  // Open browser
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
  Bun.spawn([cmd, url], { stdio: ["ignore", "ignore", "ignore"] })

  // Keep alive until Ctrl+C
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => { server.stop(); resolve() })
    process.on("SIGTERM", () => { server.stop(); resolve() })
  })
}
