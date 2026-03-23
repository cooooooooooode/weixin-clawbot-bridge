import { sendMessage as sendMessageApi } from "../api/api.js"
import type { WeixinApiOptions } from "../api/api.js"
import { logger } from "../util/logger.js"
import { generateId } from "../util/random.js"
import type { MessageItem, SendMessageReq } from "../api/types.js"
import { MessageItemType, MessageState, MessageType } from "../api/types.js"
import type { UploadedFileInfo } from "../cdn/upload.js"

function generateClientId(): string {
  return generateId("wx-clawbot")
}

function stripMarkdown(text: string): string {
  let result = text
  result = result.replace(/\*\*(.+?)\*\*/g, "$1")
  result = result.replace(/\*(.+?)\*/g, "$1")
  result = result.replace(/__(.+?)__/g, "$1")
  result = result.replace(/_(.+?)_/g, "$1")
  result = result.replace(/~~(.+?)~~/g, "$1")
  result = result.replace(/`(.+?)`/g, "$1")
  result = result.replace(/^#{1,6}\s+/gm, "")
  result = result.replace(/^[*-]\s+/gm, "")
  result = result.replace(/^>\s+/gm, "")
  result = result.replace(/^(\d+)\.\s+/gm, "$1. ")
  return result
}

/**
 * Convert markdown-formatted model reply to plain text for Weixin delivery.
 * Preserves newlines; strips markdown syntax.
 */
export function markdownToPlainText(text: string): string {
  let result = text
  // Code blocks: strip fences, keep code content
  result = result.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code: string) => code.trim())
  // Images: remove entirely
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
  // Links: keep display text only
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  // Tables: remove separator rows, then strip leading/trailing pipes and convert inner pipes to spaces
  result = result.replace(/^\|[\s:|-]+\|$/gm, "")
  result = result.replace(/^\|(.+)\|$/gm, (_, inner: string) =>
    inner.split("|").map((cell) => cell.trim()).join("  "),
  )
  result = stripMarkdown(result)
  return result
}


/** Build a SendMessageReq containing a single text message. */
function buildTextMessageReq(params: {
  to: string
  text: string
  contextToken?: string
  clientId: string
}): SendMessageReq {
  const items: MessageItem[] = params.text
    ? [{ type: MessageItemType.TEXT, text_item: { text: params.text } }]
    : []
  return {
    msg: {
      from_user_id: "",
      to_user_id: params.to,
      client_id: params.clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: items.length ? items : undefined,
      context_token: params.contextToken ?? undefined,
    },
  }
}

/** Build a SendMessageReq from a text payload. */
function buildSendMessageReq(params: {
  to: string
  contextToken?: string
  payload: { text?: string }
  clientId: string
}): SendMessageReq {
  return buildTextMessageReq({
    to: params.to,
    text: params.payload.text ?? "",
    contextToken: params.contextToken,
    clientId: params.clientId,
  })
}

/**
 * Send a plain text message downstream.
 * contextToken is required for all reply sends; missing it breaks conversation association.
 */
export async function sendMessageWeixin(params: {
  to: string
  text: string
  opts: WeixinApiOptions & { contextToken?: string }
}): Promise<{ messageId: string }> {
  if (!params.opts.contextToken) {
    logger.error(`sendMessageWeixin: contextToken missing, refusing to send to=${params.to}`)
    throw new Error("sendMessageWeixin: contextToken is required")
  }
  const clientId = generateClientId()
  const req = buildSendMessageReq({
    to: params.to,
    contextToken: params.opts.contextToken,
    payload: { text: params.text },
    clientId,
  })
  try {
    await sendMessageApi({
      baseUrl: params.opts.baseUrl,
      token: params.opts.token,
      timeoutMs: params.opts.timeoutMs,
      body: req,
    })
  } catch (err) {
    logger.error(`sendMessageWeixin: failed to=${params.to} clientId=${clientId} err=${String(err)}`)
    throw err
  }
  return { messageId: clientId }
}

/**
 * Streaming writer: sends partial text with GENERATING state, then FINISH on close.
 * Uses a fixed client_id so WeChat renders updates to the same bubble.
 */
export function createStreamingWriter(params: {
  to: string
  opts: WeixinApiOptions & { contextToken?: string }
}) {
  if (!params.opts.contextToken) {
    throw new Error("createStreamingWriter: contextToken is required")
  }
  let buf = ""
  let flushed = false
  let seq = 0

  const flush = async (state: number) => {
    seq++
    const cid = generateClientId()
    const plain = markdownToPlainText(buf)
    const items: MessageItem[] = plain
      ? [{ type: MessageItemType.TEXT, text_item: { text: plain } }]
      : []
    const req: SendMessageReq = {
      msg: {
        from_user_id: "",
        to_user_id: params.to,
        client_id: cid,
        message_type: MessageType.BOT,
        message_state: state,
        item_list: items.length ? items : undefined,
        context_token: params.opts.contextToken ?? undefined,
      },
    }
    const label = state === MessageState.GENERATING ? "GENERATING" : "FINISH"
    logger.info(`[stream] ${label} #${seq} cid=${cid} len=${plain.length} preview=${JSON.stringify(plain.slice(0, 80))}`)
    try {
      const resp = await sendMessageApi({
        baseUrl: params.opts.baseUrl,
        token: params.opts.token,
        timeoutMs: params.opts.timeoutMs,
        body: req,
      })
      logger.info(`[stream] ${label} #${seq} resp=${resp}`)
    } catch (err) {
      logger.error(`[stream] ${label} #${seq} failed: ${err}`)
      throw err
    }
  }

  return {
    /** Append text and send a GENERATING frame. */
    async update(text: string) {
      buf = text
      flushed = true
      await flush(MessageState.GENERATING)
    },

    /** Send the final FINISH frame. Falls back to simple reply if never updated. */
    async finish(text?: string) {
      if (text !== undefined) buf = text
      await flush(MessageState.FINISH)
    },

    /** Whether at least one GENERATING frame was sent. */
    get started() { return flushed },

    /** Current accumulated text. */
    get text() { return buf },
  }
}

export type StreamingWriter = ReturnType<typeof createStreamingWriter>

/**
 * Send one or more MessageItems (optionally preceded by a text caption) downstream.
 * Each item is sent as its own request so that item_list always has exactly one entry.
 */
async function sendMediaItems(params: {
  to: string
  text: string
  mediaItem: MessageItem
  opts: WeixinApiOptions & { contextToken?: string }
  label: string
}): Promise<{ messageId: string }> {
  const items: MessageItem[] = []
  if (params.text) {
    items.push({ type: MessageItemType.TEXT, text_item: { text: params.text } })
  }
  items.push(params.mediaItem)

  let lastClientId = ""
  for (const item of items) {
    lastClientId = generateClientId()
    const req: SendMessageReq = {
      msg: {
        from_user_id: "",
        to_user_id: params.to,
        client_id: lastClientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [item],
        context_token: params.opts.contextToken ?? undefined,
      },
    }
    try {
      await sendMessageApi({
        baseUrl: params.opts.baseUrl,
        token: params.opts.token,
        timeoutMs: params.opts.timeoutMs,
        body: req,
      })
    } catch (err) {
      logger.error(
        `${params.label}: failed to=${params.to} clientId=${lastClientId} err=${String(err)}`,
      )
      throw err
    }
  }

  logger.debug(`${params.label}: success to=${params.to} clientId=${lastClientId}`)
  return { messageId: lastClientId }
}

/**
 * Send an image message downstream using a previously uploaded file.
 */
export async function sendImageMessageWeixin(params: {
  to: string
  text: string
  uploaded: UploadedFileInfo
  opts: WeixinApiOptions & { contextToken?: string }
}): Promise<{ messageId: string }> {
  if (!params.opts.contextToken) {
    logger.error(`sendImageMessageWeixin: contextToken missing, refusing to send to=${params.to}`)
    throw new Error("sendImageMessageWeixin: contextToken is required")
  }
  logger.debug(
    `sendImageMessageWeixin: to=${params.to} filekey=${params.uploaded.filekey} fileSize=${params.uploaded.fileSize} aeskey=present`,
  )

  const imageItem: MessageItem = {
    type: MessageItemType.IMAGE,
    image_item: {
      media: {
        encrypt_query_param: params.uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(params.uploaded.aeskey).toString("base64"),
        encrypt_type: 1,
      },
      mid_size: params.uploaded.fileSizeCiphertext,
    },
  }

  return sendMediaItems({ to: params.to, text: params.text, mediaItem: imageItem, opts: params.opts, label: "sendImageMessageWeixin" })
}

/**
 * Send a video message downstream using a previously uploaded file.
 */
export async function sendVideoMessageWeixin(params: {
  to: string
  text: string
  uploaded: UploadedFileInfo
  opts: WeixinApiOptions & { contextToken?: string }
}): Promise<{ messageId: string }> {
  if (!params.opts.contextToken) {
    logger.error(`sendVideoMessageWeixin: contextToken missing, refusing to send to=${params.to}`)
    throw new Error("sendVideoMessageWeixin: contextToken is required")
  }

  const videoItem: MessageItem = {
    type: MessageItemType.VIDEO,
    video_item: {
      media: {
        encrypt_query_param: params.uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(params.uploaded.aeskey).toString("base64"),
        encrypt_type: 1,
      },
      video_size: params.uploaded.fileSizeCiphertext,
    },
  }

  return sendMediaItems({ to: params.to, text: params.text, mediaItem: videoItem, opts: params.opts, label: "sendVideoMessageWeixin" })
}

/**
 * Send a file attachment downstream using a previously uploaded file.
 */
export async function sendFileMessageWeixin(params: {
  to: string
  text: string
  fileName: string
  uploaded: UploadedFileInfo
  opts: WeixinApiOptions & { contextToken?: string }
}): Promise<{ messageId: string }> {
  if (!params.opts.contextToken) {
    logger.error(`sendFileMessageWeixin: contextToken missing, refusing to send to=${params.to}`)
    throw new Error("sendFileMessageWeixin: contextToken is required")
  }
  const fileItem: MessageItem = {
    type: MessageItemType.FILE,
    file_item: {
      media: {
        encrypt_query_param: params.uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(params.uploaded.aeskey).toString("base64"),
        encrypt_type: 1,
      },
      file_name: params.fileName,
      len: String(params.uploaded.fileSize),
    },
  }

  return sendMediaItems({ to: params.to, text: params.text, mediaItem: fileItem, opts: params.opts, label: "sendFileMessageWeixin" })
}
