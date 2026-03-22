#!/usr/bin/env bun

import { parseArgs } from "util"
import type { AdapterConfig } from "../adapter/index.js"
import { createChannel } from "../channel.js"
import { load, merge } from "../config.js"
import type { Config } from "../config.js"

const args = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    adapter: { type: "string" },
    port: { type: "string" },
    endpoint: { type: "string" },
    directory: { type: "string" },
    url: { type: "string" },
    to: { type: "string" },
    file: { type: "string" },
  },
})

const command = args.positionals[0] ?? "start"

if (command === "init") {
  const { init } = await import("./init.js")
  await init(args.values as Record<string, string | undefined>)

} else if (command === "start") {
  // Merge: config.json <- CLI args
  const file = await load()
  const cli: Partial<Config> = {}
  if (args.values.adapter) cli.adapter = args.values.adapter as Config["adapter"]
  if (args.values.port) cli.port = parseInt(args.values.port, 10)
  if (args.values.url || args.values.directory) {
    cli.opencode = {}
    if (args.values.url) cli.opencode.url = args.values.url
    if (args.values.directory) cli.opencode.directory = args.values.directory
  }
  if (args.values.endpoint) cli.webhook = { endpoint: args.values.endpoint }

  const cfg = merge(file, cli)
  const port = cfg.port!
  const type = cfg.adapter!

  let config: AdapterConfig
  if (type === "opencode") {
    config = {
      type: "opencode",
      config: {
        url: cfg.opencode?.url,
        directory: cfg.opencode?.directory ?? process.cwd(),
        port,
      },
    }
  } else if (type === "webhook") {
    if (!cfg.webhook?.endpoint) {
      console.error("--endpoint is required for webhook adapter")
      process.exit(1)
    }
    config = { type: "webhook", config: { endpoint: cfg.webhook.endpoint } }
  } else if (type === "echo") {
    config = { type: "echo" }
  } else {
    console.error(`Unknown adapter: ${type}`)
    process.exit(1)
  }

  const channel = await createChannel({ adapter: config, server: { port } })
  await channel.start()

  process.on("SIGINT", async () => {
    await channel.stop()
    process.exit(0)
  })
  process.on("SIGTERM", async () => {
    await channel.stop()
    process.exit(0)
  })

} else if (command === "stop") {
  const { stop } = await import("./daemon.js")
  await stop()

} else if (command === "login") {
  const { startWeixinLoginWithQr, waitForWeixinLogin } = await import("../core/auth/login-qr.js")
  const { DEFAULT_BASE_URL } = await import("../core/auth/accounts.js")

  console.log("正在获取二维码...")
  const result = await startWeixinLoginWithQr({ apiBaseUrl: DEFAULT_BASE_URL, botType: "3" })
  if (!result.qrcodeUrl) {
    console.error(result.message)
    process.exit(1)
  }
  console.log(`二维码链接: ${result.qrcodeUrl}`)
  console.log("请使用微信扫描...")

  const login = await waitForWeixinLogin({
    sessionKey: result.sessionKey,
    apiBaseUrl: DEFAULT_BASE_URL,
    timeoutMs: 480_000,
  })

  if (login.connected) {
    console.log(`登录成功! accountId=${login.accountId}`)
  } else {
    console.error(login.message)
    process.exit(1)
  }

} else if (command === "status") {
  const { running, logPath } = await import("./daemon.js")
  const { listIndexedWeixinAccountIds, loadWeixinAccount } = await import("../core/auth/accounts.js")

  // Daemon status
  const state = running()
  if (state?.alive) {
    console.log(`[服务] 运行中 (PID ${state.pid})`)
    console.log(`[日志] ${logPath()}`)
  } else if (state) {
    console.log(`[服务] 已停止 (PID ${state.pid} 不存在)`)
  } else {
    console.log("[服务] 未启动")
  }

  // Account status
  const ids = listIndexedWeixinAccountIds()
  if (ids.length === 0) {
    console.log("[账号] 没有已登录的账号")
  } else {
    console.log(`[账号] ${ids.length} 个:`)
    for (const id of ids) {
      const data = loadWeixinAccount(id)
      console.log(`  ${id}: ${data?.token ? "已连接" : "未连接"}${data?.userId ? ` (userId: ${data.userId})` : ""}`)
    }
  }

} else if (command === "sendMedia") {
  const to = args.values.to
  const file = args.values.file
  if (!to || !file) {
    console.error("Usage: weixin-claw sendMedia --to <userId> --file <absolutePath>")
    process.exit(1)
  }
  const cfg = await load()
  const port = args.values.port ?? String(cfg.port ?? 3200)
  const url = `http://localhost:${port}/api/sendMedia`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, file }),
  }).catch((err: Error) => {
    console.error(`Failed to connect to server at ${url}: ${err.message}`)
    process.exit(1)
  })
  const body = await res.json()
  if (res.ok) {
    console.log(`OK: sent ${file} to ${to}`)
  } else {
    console.error(`Error: ${(body as Record<string, string>).error ?? res.statusText}`)
    process.exit(1)
  }

} else {
  console.error(`Unknown command: ${command}`)
  console.log("Usage: weixin-claw <command> [options]")
  console.log()
  console.log("Commands:")
  console.log("  init       初始化配置 (无参数打开浏览器, 带参数 headless)")
  console.log("  start      前台启动服务 (开发/调试用)")
  console.log("  stop       停止后台服务")
  console.log("  status     查看服务和账号状态")
  console.log("  login      CLI 扫码登录")
  console.log("  sendMedia  发送媒体文件")
  console.log()
  console.log("Init options:")
  console.log("  --adapter <echo|opencode|webhook>")
  console.log("  --port <number>")
  console.log("  --url <opencode-api-url>")
  console.log("  --directory <opencode-work-dir>")
  console.log("  --endpoint <webhook-url>")
  console.log()
  console.log("SendMedia options:")
  console.log("  --to <userId> --file <absolutePath> [--port <number>]")
  process.exit(1)
}
