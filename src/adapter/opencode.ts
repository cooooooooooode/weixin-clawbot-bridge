import type { ChannelAdapter, InboundMessage, MessageContext } from "./interface.js"
import { logger } from "../core/util/logger.js"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

export function createOpenCodeAdapter(): ChannelAdapter {
  let client: ReturnType<typeof createOpencodeClient>
  let port = 3200

  return {
    id: "opencode",
    name: "OpenCode",

    async init(config) {
      const url = (config.url as string) || "http://localhost:4096"
      port = (config.port as number) || 3200
      client = createOpencodeClient({ baseUrl: url })
      const res = await client.session.list().catch(() => null)
      if (res?.data) {
        logger.info(`[opencode] connected to ${url} (${res.data.length} sessions)`)
      } else {
        logger.error(`[opencode] cannot reach ${url}`)
      }
    },

    async onMessage(msg: InboundMessage, ctx: MessageContext) {
      ctx.typing.start()
      const t0 = Date.now()
      logger.info(`[opencode] ← from=${msg.from} type=${msg.content.type} id=${msg.id}`)

      try {
        let sid = ctx.session.get<string>("sid")
        if (!sid) {
          const res = await client.session.create()
          sid = res.data?.id
          if (sid) ctx.session.set("sid", sid)
          logger.info(`[opencode] session created: ${sid}`)
        } else {
          logger.info(`[opencode] reusing session=${sid}`)
        }

        if (!sid) {
          await ctx.reply("无法创建 OpenCode 会话")
          ctx.typing.stop()
          return
        }

        // Build parts
        const parts: Array<{ type: "text"; text: string } | { type: "file"; url: string; mime: string }> = []

        // Inject media-send instructions on first message of a new session
        const injected = ctx.session.get<boolean>("injected")
        if (!injected) {
          ctx.session.set("injected", true)
          parts.push({ type: "text", text: [
            `[System] You are chatting with WeChat user ${msg.from}.`,
            "To send an image, video, or file to this user, use this command:",
            `  curl -s -X POST http://localhost:${port}/api/sendMedia -H 'Content-Type: application/json' -d '{"to":"${msg.from}","file":"/absolute/path/to/file"}'`,
            "Rules:",
            "- The file must exist locally. Always use absolute paths (e.g. /tmp/photo.png).",
            "- To find and send an image: download it to /tmp/ first, then call the API above.",
            "- Plain text replies are sent normally (no API call needed).",
          ].join("\n") })
        }
        if (msg.content.type === "text") {
          parts.push({ type: "text", text: msg.content.text })
        } else if (msg.content.type === "image") {
          parts.push({ type: "text", text: "[图片]" })
          parts.push({ type: "file", url: `file://${msg.content.path}`, mime: msg.content.mime })
        } else if (msg.content.type === "voice") {
          parts.push({ type: "text", text: msg.content.path ? `[语音: ${msg.content.path}]` : "[语音]" })
        } else if (msg.content.type === "file") {
          parts.push({ type: "text", text: `[文件: ${msg.content.filename}]` })
          parts.push({ type: "file", url: `file://${msg.content.path}`, mime: msg.content.mime })
        } else {
          parts.push({ type: "text", text: `[${msg.content.type}]` })
        }

        // Subscribe to event stream BEFORE sending prompt (for fast idle detection)
        const events = await client.event.subscribe()

        // Accumulated text from delta events
        const deltas = new Map<string, string>()

        // Fire prompt (non-blocking)
        logger.info(`[opencode] → promptAsync session=${sid}`)
        await client.session.promptAsync({ sessionID: sid, parts })

        // Wait for completion via SSE (much faster than polling)
        const deadline = Date.now() + 300_000
        for await (const event of events.stream) {
          if (Date.now() > deadline) {
            logger.error(`[opencode] deadline exceeded`)
            break
          }

          const payload = event as Record<string, unknown>
          const type = payload.type as string | undefined

          // Accumulate text from deltas (avoids extra API call at the end)
          if (type === "message.part.updated") {
            const part = (payload as { properties: { part: Record<string, unknown> } }).properties.part
            if (part.sessionID !== sid) continue
            if (part.type === "text") deltas.set(part.id as string, part.text as string)
            continue
          }

          if (type === "message.part.delta") {
            const props = (payload as { properties: Record<string, unknown> }).properties
            if (props.sessionID !== sid) continue
            if (props.field !== "text") continue
            const pid = props.partID as string
            deltas.set(pid, (deltas.get(pid) ?? "") + (props.delta as string))
            continue
          }

          // Done
          if (type === "session.idle") {
            const props = (payload as { properties: { sessionID: string } }).properties
            if (props.sessionID !== sid) continue
            logger.info(`[opencode] session.idle (${Date.now() - t0}ms)`)
            break
          }

          if (type === "session.status") {
            const props = (payload as { properties: { sessionID: string; status: { type: string } } }).properties
            if (props.sessionID !== sid) continue
            if (props.status.type === "idle") {
              logger.info(`[opencode] status=idle (${Date.now() - t0}ms)`)
              break
            }
          }
        }

        // Build final text from accumulated deltas (no extra API round-trip)
        let text = [...deltas.values()].join("\n").trim()

        // Fallback: fetch messages if no deltas received
        if (!text) {
          logger.info(`[opencode] no deltas, fetching messages`)
          const msgs = await client.session.messages({ sessionID: sid })
          const all = msgs.data ?? []
          const last = [...all].reverse().find((m: Record<string, unknown>) => (m.info as Record<string, unknown>)?.role === "assistant")
          if (last) {
            text = ((last as Record<string, unknown>).parts as Array<Record<string, unknown>> ?? [])
              .filter((p) => p.type === "text")
              .map((p) => (p.text as string) ?? "")
              .join("\n")
              .trim()
          }
        }

        logger.info(`[opencode] reply len=${text.length} preview=${JSON.stringify(text.slice(0, 200))}`)
        await ctx.reply(text || "处理完成")
      } catch (err) {
        logger.error(`[opencode] error: ${err instanceof Error ? err.stack : err}`)
        await ctx.reply("OpenCode 处理出错，请稍后重试")
      }

      ctx.typing.stop()
      logger.info(`[opencode] total=${Date.now() - t0}ms`)
    },

    async dispose() {
      logger.info("[opencode] disposed")
    },
  }
}
