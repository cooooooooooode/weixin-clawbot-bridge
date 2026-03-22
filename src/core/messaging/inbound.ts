import { logger } from "../util/logger.js"
import { generateId } from "../util/random.js"
import type { WeixinMessage, MessageItem } from "../api/types.js"
import { MessageItemType } from "../api/types.js"

// ---------------------------------------------------------------------------
// Context token store (in-process cache: accountId+userId -> contextToken)
// ---------------------------------------------------------------------------

/**
 * contextToken is issued per-message by the Weixin getupdates API and must
 * be echoed verbatim in every outbound send. It is not persisted: the monitor
 * loop populates this map on each inbound message, and the outbound adapter
 * reads it back when the agent sends a reply.
 */
const contextTokenStore = new Map<string, string>()

function contextTokenKey(accountId: string, userId: string): string {
  return `${accountId}:${userId}`
}

/** Store a context token for a given account+user pair. */
export function setContextToken(accountId: string, userId: string, token: string): void {
  const k = contextTokenKey(accountId, userId)
  logger.debug(`setContextToken: key=${k}`)
  contextTokenStore.set(k, token)
}

/** Retrieve the cached context token for a given account+user pair. */
export function getContextToken(accountId: string, userId: string): string | undefined {
  const k = contextTokenKey(accountId, userId)
  const val = contextTokenStore.get(k)
  logger.debug(
    `getContextToken: key=${k} found=${val !== undefined} storeSize=${contextTokenStore.size}`,
  )
  return val
}

// ---------------------------------------------------------------------------
// Message ID generation
// ---------------------------------------------------------------------------

function generateMessageSid(): string {
  return generateId("weixin-claw")
}

/** Inbound context passed to the message pipeline (matches MsgContext shape). */
export type WeixinMsgContext = {
  Body: string
  From: string
  To: string
  AccountId: string
  OriginatingChannel: "weixin-claw"
  OriginatingTo: string
  MessageSid: string
  Timestamp?: number
  Provider: "weixin-claw"
  ChatType: "direct"
  /** Set by monitor after resolveAgentRoute so dispatchReplyFromConfig uses the correct session. */
  SessionKey?: string
  context_token?: string
  MediaUrl?: string
  MediaPath?: string
  MediaType?: string
  /** Raw message body for command authorization. */
  CommandBody?: string
  /** Whether the sender is authorized to execute slash commands. */
  CommandAuthorized?: boolean
}

/** Returns true if the message item is a media type (image, video, file, or voice). */
export function isMediaItem(item: MessageItem): boolean {
  return (
    item.type === MessageItemType.IMAGE ||
    item.type === MessageItemType.VIDEO ||
    item.type === MessageItemType.FILE ||
    item.type === MessageItemType.VOICE
  )
}

function bodyFromItemList(items?: MessageItem[]): string {
  if (!items?.length) return ""
  for (const item of items) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      const text = String(item.text_item.text)
      const ref = item.ref_msg
      if (!ref) return text
      // Quoted media is passed as MediaPath; only include the current text as body.
      if (ref.message_item && isMediaItem(ref.message_item)) return text
      // Build quoted context from both title and message_item content.
      const parts: string[] = []
      if (ref.title) parts.push(ref.title)
      if (ref.message_item) {
        const body = bodyFromItemList([ref.message_item])
        if (body) parts.push(body)
      }
      if (!parts.length) return text
      return `[\u5f15\u7528: ${parts.join(" | ")}]\n${text}`
    }
    // Voice-to-text: if a voice message has text, use the text content
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text
    }
  }
  return ""
}

export type WeixinInboundMediaOpts = {
  /** Local path to decrypted image file. */
  decryptedPicPath?: string
  /** Local path to transcoded/raw voice file (.wav or .silk). */
  decryptedVoicePath?: string
  /** MIME type for the voice file (e.g. "audio/wav" or "audio/silk"). */
  voiceMediaType?: string
  /** Local path to decrypted file attachment. */
  decryptedFilePath?: string
  /** MIME type for the file attachment (guessed from file_name). */
  fileMediaType?: string
  /** Local path to decrypted video file. */
  decryptedVideoPath?: string
}

/**
 * Convert a WeixinMessage from getUpdates to the inbound MsgContext.
 * Media: only pass MediaPath (local file, after CDN download + decrypt).
 * Priority when multiple media types present: image > video > file > voice.
 */
export function weixinMessageToMsgContext(
  msg: WeixinMessage,
  accountId: string,
  opts?: WeixinInboundMediaOpts,
): WeixinMsgContext {
  const from = msg.from_user_id ?? ""
  const ctx: WeixinMsgContext = {
    Body: bodyFromItemList(msg.item_list),
    From: from,
    To: from,
    AccountId: accountId,
    OriginatingChannel: "weixin-claw",
    OriginatingTo: from,
    MessageSid: generateMessageSid(),
    Timestamp: msg.create_time_ms,
    Provider: "weixin-claw",
    ChatType: "direct",
  }
  if (msg.context_token) {
    ctx.context_token = msg.context_token
  }

  if (opts?.decryptedPicPath) {
    ctx.MediaPath = opts.decryptedPicPath
    ctx.MediaType = "image/*"
  } else if (opts?.decryptedVideoPath) {
    ctx.MediaPath = opts.decryptedVideoPath
    ctx.MediaType = "video/mp4"
  } else if (opts?.decryptedFilePath) {
    ctx.MediaPath = opts.decryptedFilePath
    ctx.MediaType = opts.fileMediaType ?? "application/octet-stream"
  } else if (opts?.decryptedVoicePath) {
    ctx.MediaPath = opts.decryptedVoicePath
    ctx.MediaType = opts.voiceMediaType ?? "audio/wav"
  }

  return ctx
}

/** Extract the context_token from an inbound WeixinMsgContext. */
export function getContextTokenFromMsgContext(ctx: WeixinMsgContext): string | undefined {
  return ctx.context_token
}
