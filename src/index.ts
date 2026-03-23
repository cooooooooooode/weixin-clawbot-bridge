// weixin-clawbot-bridge entry point
// Full createChannel implementation will be added in subsequent tasks

export { getUpdates, sendMessage, getUploadUrl, getConfig, sendTyping } from "./core/api/api.js"
export type { WeixinApiOptions } from "./core/api/api.js"
export type * from "./core/api/types.js"
export { startWeixinLoginWithQr, waitForWeixinLogin } from "./core/auth/login-qr.js"
export type { WeixinQrStartResult, WeixinQrWaitResult } from "./core/auth/login-qr.js"
export {
  loadWeixinAccount,
  saveWeixinAccount,
  registerWeixinAccountId,
  listIndexedWeixinAccountIds,
  resolveWeixinAccount,
  DEFAULT_BASE_URL,
  CDN_BASE_URL,
} from "./core/auth/accounts.js"
export { monitorWeixinProvider } from "./core/monitor/monitor.js"
export type { MonitorWeixinOpts } from "./core/monitor/monitor.js"
export { sendMessageWeixin, markdownToPlainText, createStreamingWriter } from "./core/messaging/send.js"
export type { StreamingWriter } from "./core/messaging/send.js"
export { sendWeixinMediaFile } from "./core/messaging/send-media.js"
export { downloadMediaFromItem } from "./core/media/media-download.js"
export { encryptAesEcb, decryptAesEcb } from "./core/cdn/aes-ecb.js"
export { downloadAndDecryptBuffer } from "./core/cdn/pic-decrypt.js"
export { uploadFileToWeixin, uploadVideoToWeixin, uploadFileAttachmentToWeixin } from "./core/cdn/upload.js"
export { resolveStateDir } from "./core/storage/state-dir.js"
export { logger } from "./core/util/logger.js"

// Adapter system
export type { ChannelAdapter, InboundMessage, MessageContext, MessageContent, StreamWriter } from "./adapter/interface.js"
export type { AdapterConfig } from "./adapter/index.js"
export { resolveAdapter } from "./adapter/index.js"
export { echo } from "./adapter/echo.js"
export { createOpenCodeAdapter } from "./adapter/opencode.js"
export { createWebhookAdapter } from "./adapter/webhook.js"

// Server
export { createRouter, setAdapterName, startServer } from "./server/index.js"
export { emit, subscribe } from "./server/sse.js"

// Channel
export { createChannel } from "./channel.js"
export type { ChannelConfig, Channel } from "./channel.js"
