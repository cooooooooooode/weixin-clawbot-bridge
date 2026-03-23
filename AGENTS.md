# AGENTS.md

## Project Overview

weixin-clawbot-bridge is a WeChat messaging bridge. It connects WeChat users to AI backends (OpenCode, webhooks, etc.) via the iLink protocol. It runs as a Bun CLI tool with a persistent background daemon.

## Quick Reference

```bash
bun run src/cli/index.ts start --adapter opencode --port 3200
bun run src/cli/index.ts init --adapter opencode --port 3200
bun run src/cli/index.ts stop
bun run src/cli/index.ts status
bun run src/cli/index.ts login
bun test
bun typecheck
```

## Build & Test

- Runtime: **Bun** (not Node). Use `Bun.file()`, `Bun.serve()`, `Bun.write()`, `Bun.sleep()` etc.
- TypeScript check: `bun typecheck` (runs `tsc --noEmit`)
- Tests: `bun test` (uses `bun:test`, not jest/vitest)
- No build step needed; source `.ts` files run directly via Bun
- Always run `bun typecheck` after making changes

## Architecture

```
src/
  index.ts            # Package entry, re-exports everything
  channel.ts          # createChannel() orchestrator
  config.ts           # Config persistence (~/.weixin-claw/config.json)
  types.ts            # Shared type re-exports
  adapter/            # Pluggable AI backend adapters
    interface.ts      # ChannelAdapter / InboundMessage / MessageContext
    echo.ts           # Echo test adapter
    opencode.ts       # OpenCode SDK v2 adapter
    webhook.ts        # Generic webhook adapter
    index.ts          # resolveAdapter() factory
  cli/                # CLI commands
    index.ts          # Command router (start/init/stop/status/login/sendMedia)
    daemon.ts         # Daemon lifecycle (spawn/stop/running via PID file)
    init.ts           # Init command (headless + interactive browser mode)
    init-page.ts      # Inline HTML config wizard
  server/             # HTTP API layer
    index.ts          # Bun.serve() bootstrap
    routes.ts         # Hono routes (/api/login/qr, /api/sendMedia, /events, etc.)
    sse.ts            # Global SSE event bus (emit/subscribe)
  core/               # iLink protocol internals
    api/              # HTTP API wrappers + types
    auth/             # QR login + account persistence
    cdn/              # AES-128-ECB encrypted CDN upload/download
    media/            # Media download + SILK voice transcoding
    messaging/        # Send text/media to WeChat
    monitor/          # Long-polling getUpdates loop
    storage/          # State directory (~/.weixin-claw/)
    util/             # Logger, random ID, redact
```

## Key Concepts

### iLink Protocol

WeChat communication uses HTTP API with long-polling (`getUpdates`). Messages have `message_state`: `NEW=0`, `GENERATING=1`, `FINISH=2`. The `client_id` field is used for deduplication (same id = silently dropped), so true streaming updates are not possible via client_id rotation.

### Adapter Pattern

All AI backends implement `ChannelAdapter` interface from `src/adapter/interface.ts`:

```ts
interface ChannelAdapter {
  readonly id: string
  readonly name: string
  init?(config: Record<string, unknown>): Promise<void>
  onMessage(msg: InboundMessage, ctx: MessageContext): Promise<void>
  dispose?(): Promise<void>
}
```

`MessageContext` provides `reply()`, `replyMedia()`, `replyStreaming()`, `typing`, and `session` (per-user key-value store).

To add a new adapter: create `src/adapter/foo.ts`, register in `src/adapter/index.ts`.

### OpenCode SDK v2

The OpenCode adapter uses `@opencode-ai/sdk/v2/client`. **Critical**: v2 uses flat parameters:

```ts
await client.session.promptAsync({ sessionID: sid, parts })
```

NOT nested v1 style. Uses SSE events (`session.idle`, `message.part.delta`) for fast completion detection instead of polling.

### Config Priority

Three-layer fallback: **CLI args > ~/.weixin-claw/config.json > code defaults**. The `merge()` function in `src/config.ts` handles this. `parseArgs` in CLI has no `default` values to allow this layering.

### Daemon Process

Uses `node:child_process.spawn` with `detached: true` and file descriptor stdio (not pipes). **Do not use `Bun.spawn` for daemonization** -- it doesn't support true process detachment. PID file at `~/.weixin-claw/weixin-claw.pid`, logs at `~/.weixin-claw/weixin-claw.log`.

### Media Sending

Media files are uploaded to WeChat CDN via AES-128-ECB encryption. The `/api/sendMedia` endpoint and `sendMedia` CLI command handle this. AI backends learn about this capability via system prompt injection on first message (controlled by `injected` boolean in session store).

### State Directory

All persistent data lives in `~/.weixin-claw/` (override via `WEIXIN_CLAW_STATE_DIR` env). Contains: account credentials, config.json, PID file, logs, downloaded media.

## Style Guide

- Use Bun APIs (`Bun.file()`, `Bun.write()`, `Bun.sleep()`, `Bun.serve()`) over Node equivalents where possible
- Exception: daemon spawning must use `node:child_process` for detached support
- Prefer `const` over `let`, early returns over `else`
- Prefer single-word variable names (`cfg`, `pid`, `dir`, `msg`, `ctx`, `sid`)
- Inline values used only once; avoid unnecessary intermediate variables
- Avoid unnecessary destructuring; use dot notation
- No `try/catch` unless error handling is required at that level
- Use `.js` extensions in all import paths (TypeScript with bundler resolution)
- Avoid mocks in tests; test actual implementations
- Logger uses `console` via `src/core/util/logger.ts`

## Common Pitfalls

- **SDK version**: `@opencode-ai/sdk/v2/client` not v1. Parameters are flat, not nested
- **Daemon stdio**: Must use file descriptor (`openSync` + `O_WRONLY | O_CREAT | O_APPEND`), not pipes, for daemon to survive parent exit
- **Session prompt injection**: Use separate `injected` boolean flag, not `sid` check (sid is set before injection check)
- **iLink client_id**: Used for deduplication; sending same client_id twice = message silently dropped
- **Import extensions**: Always use `.js` suffix in imports (`./foo.js` not `./foo`)
- **SSE bus**: `emit()` and `subscribe()` in `src/server/sse.ts` are global; listeners must be cleaned up on stream abort

## Adding a New CLI Command

1. Add option parsing in `src/cli/index.ts` parseArgs if needed
2. Add `else if (command === "xxx")` branch in the command router
3. Use dynamic `import()` for command modules to keep startup fast

## Adding a New API Endpoint

1. Add route in `src/server/routes.ts` on the Hono `app` instance
2. For endpoints needing send context, use `getSendContext()` / `listSendContextUsers()` from `channel.ts`
3. Emit SSE events via `emit("event.name", data)` for real-time updates

## Adding a New Adapter

1. Create `src/adapter/<name>.ts` implementing `ChannelAdapter`
2. Export a factory function: `export function createFooAdapter(): ChannelAdapter`
3. Register in `src/adapter/index.ts` resolveAdapter switch
4. Add adapter config type to `AdapterConfig` union
5. Handle in `src/cli/index.ts` start command's config builder
6. Add to `Config` type in `src/config.ts` if adapter has custom settings
