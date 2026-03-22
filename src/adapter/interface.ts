export interface ChannelAdapter {
  readonly id: string
  readonly name: string
  init?(config: Record<string, unknown>): Promise<void>
  onMessage(msg: InboundMessage, ctx: MessageContext): Promise<void>
  dispose?(): Promise<void>
}

export interface InboundMessage {
  id: string
  from: string
  content: MessageContent
  timestamp: number
  contextToken: string
  replyTo?: { text: string }
}

export type MessageContent =
  | { type: "text"; text: string }
  | { type: "image"; path: string; mime: string }
  | { type: "voice"; path: string; duration: number; mime: string }
  | { type: "file"; path: string; filename: string; mime: string }
  | { type: "video"; path: string; duration: number; mime: string }

export interface StreamWriter {
  /** Send a GENERATING frame with accumulated text. */
  update(text: string): Promise<void>
  /** Send the final FINISH frame. */
  finish(text?: string): Promise<void>
  /** Whether at least one GENERATING frame was sent. */
  readonly started: boolean
  /** Current accumulated text. */
  readonly text: string
}

export interface MessageContext {
  reply(text: string): Promise<void>
  replyMedia(path: string, type: "image" | "video" | "file"): Promise<void>
  /** Create a streaming writer for progressive rendering on WeChat. */
  replyStreaming(): StreamWriter
  typing: { start(): void; stop(): void }
  session: {
    get<T>(key: string): T | undefined
    set(key: string, value: unknown): void
  }
}
