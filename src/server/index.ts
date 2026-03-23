import { createRouter, setAdapterName } from "./routes.js"

export { createRouter, setAdapterName }
export { emit, subscribe } from "./sse.js"

export async function startServer(port: number) {
  const app = createRouter()
  const server = Bun.serve({
    port,
    fetch: app.fetch,
    idleTimeout: 255,
  })
  console.log(`[weixin-clawbot-bridge] HTTP server listening on port ${port}`)
  return server
}
