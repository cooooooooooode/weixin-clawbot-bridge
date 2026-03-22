import type { ChannelAdapter } from "./interface.js"

export const echo: ChannelAdapter = {
  id: "echo",
  name: "Echo Bot",
  async onMessage(msg, ctx) {
    if (msg.content.type === "text") {
      await ctx.reply(`你说: ${msg.content.text}`)
      return
    }
    await ctx.reply(`收到 ${msg.content.type} 消息`)
  },
}
