import type { AdapterConfig } from "./adapter/index.js"
import { resolveAdapter } from "./adapter/index.js"
import type { ChannelAdapter, InboundMessage, MessageContext } from "./adapter/interface.js"
import { startServer, setAdapterName } from "./server/index.js"
import { emit, subscribe } from "./server/sse.js"
import { monitorWeixinProvider } from "./core/monitor/monitor.js"
import { listIndexedWeixinAccountIds, loadWeixinAccount, resolveWeixinAccount } from "./core/auth/accounts.js"
import { sendMessageWeixin, markdownToPlainText, createStreamingWriter } from "./core/messaging/send.js"
import { sendWeixinMediaFile } from "./core/messaging/send-media.js"
import { downloadMediaFromItem } from "./core/media/media-download.js"
import { sendTyping } from "./core/api/api.js"
import { WeixinConfigManager } from "./core/api/config-cache.js"
import { MessageItemType, TypingStatus } from "./core/api/types.js"
import type { WeixinMessage } from "./core/api/types.js"
import { logger } from "./core/util/logger.js"
import { generateId } from "./core/util/random.js"

export type ChannelConfig = {
  adapter: AdapterConfig
  server?: { port?: number }
}

export type Channel = {
  start(): Promise<void>
  stop(): Promise<void>
  adapter: ChannelAdapter
}

// Per-user session store
const sessions = new Map<string, Map<string, unknown>>()

// Per-user send context: cached so /api/send can use it
export type SendContext = {
  from: string
  contextToken: string
  baseUrl: string
  token: string
  cdnBaseUrl: string
}
const sendContexts = new Map<string, SendContext>()

export function getSendContext(userId: string): SendContext | undefined {
  return sendContexts.get(userId)
}

export function listSendContextUsers(): string[] {
  return [...sendContexts.keys()]
}

function session(userId: string) {
  let store = sessions.get(userId)
  if (!store) {
    store = new Map()
    sessions.set(userId, store)
  }
  return {
    get<T>(key: string) { return store!.get(key) as T | undefined },
    set(key: string, value: unknown) { store!.set(key, value) },
  }
}

// Build InboundMessage from WeixinMessage + downloaded media
function toInbound(msg: WeixinMessage, media?: { path?: string; mime?: string; type?: string; duration?: number; filename?: string }): InboundMessage {
  const from = msg.from_user_id ?? ""
  const ts = msg.create_time_ms ?? Date.now()
  const id = `${msg.message_id ?? generateId("msg")}`

  // Extract text from item_list
  let text = ""
  let reply: { text: string } | undefined
  for (const item of msg.item_list ?? []) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      text = item.text_item.text
      if (item.ref_msg?.title) reply = { text: item.ref_msg.title }
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      text = item.voice_item.text
    }
  }

  // Determine content type
  let content: InboundMessage["content"]
  if (media?.path && media.type === "image") {
    content = { type: "image", path: media.path, mime: media.mime ?? "image/jpeg" }
  } else if (media?.path && media.type === "video") {
    content = { type: "video", path: media.path, duration: media.duration ?? 0, mime: media.mime ?? "video/mp4" }
  } else if (media?.path && media.type === "voice") {
    content = { type: "voice", path: media.path, duration: media.duration ?? 0, mime: media.mime ?? "audio/wav" }
  } else if (media?.path && media.type === "file") {
    content = { type: "file", path: media.path, filename: media.filename ?? "file", mime: media.mime ?? "application/octet-stream" }
  } else {
    content = { type: "text", text }
  }

  return {
    id,
    from,
    content,
    timestamp: ts,
    contextToken: msg.context_token ?? "",
    replyTo: reply,
  }
}

export async function createChannel(config: ChannelConfig): Promise<Channel> {
  const adapter = await resolveAdapter(config.adapter)
  const port = config.server?.port ?? 3200
  const abort = new AbortController()
  let server: ReturnType<typeof Bun.serve> | undefined
  const monitors: Promise<void>[] = []
  const active = new Set<string>()
  let unsub: (() => void) | undefined

  setAdapterName(adapter.name)

  function startMonitor(id: string) {
    if (active.has(id)) return
    const data = loadWeixinAccount(id)
    if (!data?.token) {
      logger.error(`startMonitor: no token for account ${id}`)
      return
    }

    active.add(id)
    const account = resolveWeixinAccount(id)
    const cfg = new WeixinConfigManager({ baseUrl: account.baseUrl, token: account.token }, (msg) => logger.info(msg))

    const monitor = monitorWeixinProvider({
      baseUrl: account.baseUrl,
      cdnBaseUrl: account.cdnBaseUrl,
      token: account.token,
      accountId: id,
      abortSignal: abort.signal,

      async onMessage(full: WeixinMessage) {
        const from = full.from_user_id ?? ""
        logger.info(`[channel] inbound message from=${from} items=${full.item_list?.length ?? 0}`)
        const cached = await cfg.getForUser(from, full.context_token)

        // Cache send context for this user (used by /api/send)
        sendContexts.set(from, {
          from,
          contextToken: full.context_token ?? "",
          baseUrl: account.baseUrl,
          token: account.token ?? "",
          cdnBaseUrl: account.cdnBaseUrl,
        })

        // Download media if present
        const found = full.item_list?.find(i =>
          i.type === MessageItemType.IMAGE && i.image_item?.media?.encrypt_query_param
        ) ?? full.item_list?.find(i =>
          i.type === MessageItemType.VIDEO && i.video_item?.media?.encrypt_query_param
        ) ?? full.item_list?.find(i =>
          i.type === MessageItemType.FILE && i.file_item?.media?.encrypt_query_param
        ) ?? full.item_list?.find(i =>
          i.type === MessageItemType.VOICE && i.voice_item?.media?.encrypt_query_param && !i.voice_item.text
        )

        let media: { path?: string; mime?: string; type?: string; duration?: number; filename?: string } | undefined
        if (found) {
          const downloaded = await downloadMediaFromItem(found, {
            cdnBaseUrl: account.cdnBaseUrl,
            log: (msg) => logger.info(msg),
            errLog: (msg) => logger.error(msg),
            label: "inbound",
          })
          if (downloaded.decryptedPicPath) media = { path: downloaded.decryptedPicPath, mime: "image/jpeg", type: "image" }
          else if (downloaded.decryptedVideoPath) media = { path: downloaded.decryptedVideoPath, mime: "video/mp4", type: "video" }
          else if (downloaded.decryptedFilePath) media = { path: downloaded.decryptedFilePath, mime: downloaded.fileMediaType, type: "file", filename: found.file_item?.file_name }
          else if (downloaded.decryptedVoicePath) media = { path: downloaded.decryptedVoicePath, mime: downloaded.voiceMediaType, type: "voice", duration: found.voice_item?.playtime }
        }

        const inbound = toInbound(full, media)
        emit("weixin.message", { direction: "inbound", from, content: inbound.content.type })

        const ctx: MessageContext = {
          async reply(text: string) {
            const plain = markdownToPlainText(text)
            const chunks = []
            for (let i = 0; i < plain.length; i += 4000) {
              chunks.push(plain.slice(i, i + 4000))
            }
            if (chunks.length === 0) chunks.push(plain)

            for (const chunk of chunks) {
              await sendMessageWeixin({
                to: from,
                text: chunk,
                opts: { baseUrl: account.baseUrl, token: account.token, contextToken: full.context_token },
              })
            }
            logger.info(`[channel] reply sent to=${from} len=${plain.length}`)
            emit("weixin.message", { direction: "outbound", to: from, type: "text" })
          },

          async replyMedia(path: string, type: "image" | "video" | "file") {
            await sendWeixinMediaFile({
              filePath: path,
              to: from,
              text: "",
              opts: { baseUrl: account.baseUrl, token: account.token, contextToken: full.context_token },
              cdnBaseUrl: account.cdnBaseUrl,
            })
            emit("weixin.message", { direction: "outbound", to: from, type })
          },

          typing: {
            start() {
              if (cached.typingTicket) {
                sendTyping({
                  baseUrl: account.baseUrl,
                  token: account.token,
                  body: { ilink_user_id: from, typing_ticket: cached.typingTicket, status: TypingStatus.TYPING },
                }).catch(() => {})
              }
            },
            stop() {
              if (cached.typingTicket) {
                sendTyping({
                  baseUrl: account.baseUrl,
                  token: account.token,
                  body: { ilink_user_id: from, typing_ticket: cached.typingTicket, status: TypingStatus.CANCEL },
                }).catch(() => {})
              }
            },
          },

          replyStreaming() {
            return createStreamingWriter({
              to: from,
              opts: { baseUrl: account.baseUrl, token: account.token, contextToken: full.context_token },
            })
          },

          session: session(from),
        }

        try {
          await adapter.onMessage(inbound, ctx)
        } catch (err) {
          logger.error(`adapter.onMessage error: ${String(err)}`)
        }
      },
    })

    monitors.push(monitor)
    logger.info(`monitor started for account ${id}`)
  }

  return {
    adapter,

    async start() {
      server = await startServer(port)

      // Start monitors for already-registered accounts
      for (const id of listIndexedWeixinAccountIds()) {
        startMonitor(id)
      }

      // Listen for new accounts from QR login
      unsub = subscribe((event, data) => {
        if (event !== "weixin.confirmed") return
        const d = data as { accountId?: string }
        if (!d.accountId) return
        const id = d.accountId.trim().replace(/[@.]/g, "-")
        logger.info(`new account confirmed: ${id}, starting monitor...`)
        setTimeout(() => startMonitor(id), 500)
      })
    },

    async stop() {
      unsub?.()
      abort.abort()
      await adapter.dispose?.()
      server?.stop()
      await Promise.allSettled(monitors)
      logger.info("channel stopped")
    },
  }
}
