import type { ChannelAdapter, InboundMessage, MessageContext } from "./interface.js"

export function createWebhookAdapter(): ChannelAdapter {
  let endpoint = ""

  return {
    id: "webhook",
    name: "Webhook",

    async init(config) {
      endpoint = config.endpoint as string
      if (!endpoint) throw new Error("webhook adapter requires 'endpoint' config")
    },

    async onMessage(msg: InboundMessage, ctx: MessageContext) {
      ctx.typing.start()

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: msg.from,
          content: msg.content,
          timestamp: msg.timestamp,
        }),
      })

      const data = (await res.json()) as {
        text?: string
        file?: string
        fileType?: "image" | "video" | "file"
      }
      if (data.text) await ctx.reply(data.text)
      if (data.file) await ctx.replyMedia(data.file, data.fileType || "file")

      ctx.typing.stop()
    },
  }
}
