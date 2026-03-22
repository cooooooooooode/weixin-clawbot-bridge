import { describe, test, expect } from "bun:test"
import { echo } from "../echo.js"
import { resolveAdapter } from "../index.js"
import type { InboundMessage, MessageContext } from "../interface.js"

function mockMsg(content: InboundMessage["content"]): InboundMessage {
  return {
    id: "test-1",
    from: "user@im.wechat",
    content,
    timestamp: Date.now(),
    contextToken: "ctx-token",
  }
}

function mockCtx(): MessageContext & {
  replies: string[]
  mediaReplies: Array<{ path: string; type: string }>
  store: Map<string, unknown>
} {
  const replies: string[] = []
  const media: Array<{ path: string; type: string }> = []
  const store = new Map<string, unknown>()
  return {
    replies,
    mediaReplies: media,
    store,
    async reply(text: string) {
      replies.push(text)
    },
    async replyMedia(path: string, type: "image" | "video" | "file") {
      media.push({ path, type })
    },
    typing: { start() {}, stop() {} },
    replyStreaming() {
      let buf = ""
      let flushed = false
      return {
        async update(text: string) { buf = text; flushed = true },
        async finish(text?: string) { if (text !== undefined) buf = text; replies.push(buf) },
        get started() { return flushed },
        get text() { return buf },
      }
    },
    session: {
      get<T>(key: string) {
        return store.get(key) as T | undefined
      },
      set(key: string, value: unknown) {
        store.set(key, value)
      },
    },
  }
}

describe("echo adapter", () => {
  test("replies text with prefix", async () => {
    const ctx = mockCtx()
    await echo.onMessage(mockMsg({ type: "text", text: "hello" }), ctx)
    expect(ctx.replies).toEqual(["你说: hello"])
  })

  test("replies image type description", async () => {
    const ctx = mockCtx()
    await echo.onMessage(mockMsg({ type: "image", path: "/tmp/pic.jpg", mime: "image/jpeg" }), ctx)
    expect(ctx.replies).toEqual(["收到 image 消息"])
  })

  test("replies voice type description", async () => {
    const ctx = mockCtx()
    await echo.onMessage(
      mockMsg({ type: "voice", path: "/tmp/voice.wav", duration: 3000, mime: "audio/wav" }),
      ctx,
    )
    expect(ctx.replies).toEqual(["收到 voice 消息"])
  })
})

describe("session store", () => {
  test("set and get work correctly", () => {
    const ctx = mockCtx()
    ctx.session.set("key1", "value1")
    ctx.session.set("key2", 42)
    expect(ctx.session.get<string>("key1")).toBe("value1")
    expect(ctx.session.get<number>("key2")).toBe(42)
    expect(ctx.session.get("missing")).toBeUndefined()
  })
})

describe("resolveAdapter", () => {
  test("resolves echo adapter", async () => {
    const adapter = await resolveAdapter({ type: "echo" })
    expect(adapter.id).toBe("echo")
    expect(adapter.name).toBe("Echo Bot")
  })

  test("echo adapter onMessage does not throw", async () => {
    const adapter = await resolveAdapter({ type: "echo" })
    const ctx = mockCtx()
    await adapter.onMessage(mockMsg({ type: "text", text: "test" }), ctx)
    expect(ctx.replies.length).toBe(1)
  })

  test("custom adapter works", async () => {
    const custom = {
      id: "custom-test",
      name: "Custom",
      async onMessage(_msg: any, ctx: any) {
        await ctx.reply("custom reply")
      },
    }
    const adapter = await resolveAdapter({ type: "custom", instance: custom })
    expect(adapter.id).toBe("custom-test")
    const ctx = mockCtx()
    await adapter.onMessage(mockMsg({ type: "text", text: "hi" }), ctx)
    expect(ctx.replies).toEqual(["custom reply"])
  })

  test("throws on unknown type", async () => {
    expect(resolveAdapter({ type: "unknown" } as any)).rejects.toThrow()
  })
})
