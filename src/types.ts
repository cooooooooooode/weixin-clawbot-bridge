export type {
  BaseInfo,
  WeixinMessage,
  MessageItem,
  TextItem,
  ImageItem,
  VoiceItem,
  FileItem,
  VideoItem,
  CDNMedia,
  RefMessage,
  GetUpdatesReq,
  GetUpdatesResp,
  SendMessageReq,
  SendTypingReq,
  GetConfigResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
} from "./core/api/types.js"

export { MessageType, MessageItemType, MessageState, TypingStatus, UploadMediaType } from "./core/api/types.js"

export type { WeixinQrStartResult, WeixinQrWaitResult } from "./core/auth/login-qr.js"
export type { WeixinAccountData, ResolvedWeixinAccount } from "./core/auth/accounts.js"
export type { MonitorWeixinOpts } from "./core/monitor/monitor.js"
export type { WeixinApiOptions } from "./core/api/api.js"
