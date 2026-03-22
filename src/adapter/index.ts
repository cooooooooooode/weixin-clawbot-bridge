export type { ChannelAdapter, InboundMessage, MessageContext, MessageContent } from "./interface.js"
export { echo } from "./echo.js"
export { createOpenCodeAdapter } from "./opencode.js"
export { createWebhookAdapter } from "./webhook.js"

import type { ChannelAdapter } from "./interface.js"
import { echo } from "./echo.js"
import { createOpenCodeAdapter } from "./opencode.js"
import { createWebhookAdapter } from "./webhook.js"

export type AdapterConfig =
  | { type: "echo" }
  | { type: "opencode"; config?: Record<string, unknown> }
  | { type: "webhook"; config?: Record<string, unknown> }
  | { type: "custom"; instance: ChannelAdapter; config?: Record<string, unknown> }

export async function resolveAdapter(opts: AdapterConfig): Promise<ChannelAdapter> {
  if (opts.type === "echo") return echo
  if (opts.type === "opencode") {
    const adapter = createOpenCodeAdapter()
    if (opts.config) await adapter.init?.(opts.config)
    return adapter
  }
  if (opts.type === "webhook") {
    const adapter = createWebhookAdapter()
    if (opts.config) await adapter.init?.(opts.config)
    return adapter
  }
  if (opts.type === "custom") {
    if (opts.config) await opts.instance.init?.(opts.config)
    return opts.instance
  }
  throw new Error(`Unknown adapter type: ${(opts as any).type}`)
}
