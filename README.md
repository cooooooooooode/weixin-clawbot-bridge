# weixin-clawbot-bridge

[简体中文](./README.zh_CN.md)

WeChat messaging channel bridge — connects WeChat users to AI backends (OpenCode, Webhook, etc.) via the iLink protocol.

A Bun-based CLI tool with daemon mode for background operation.

## Features

- **QR Login**: Scan QR code in terminal or browser to login
- **Daemon Mode**: Background process with persistent service
- **Pluggable Adapters**: OpenCode, Webhook, Echo test adapters
- **Media Support**: Send images, videos, files via WeChat CDN
- **Streaming Reply**: Real-time "typing" status during AI response
- **Multi-Account**: Multiple WeChat accounts simultaneously

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) runtime installed

### Installation

```bash
git clone <repo-url>
cd weixin-claw-channel
bun install
```

### One-Click Init (Recommended)

```bash
bun run src/cli/index.ts init
```

This command opens a browser to the visual configuration page:

1. Select AI backend adapter (OpenCode / Webhook)
2. Configure parameters
3. Scan QR code to login WeChat account
4. Click "Start Service"

Configuration and login credentials are saved automatically. The service runs as a background daemon.

### Headless Init

For automation scripts or headless environments:

```bash
# OpenCode adapter
bun run src/cli/index.ts init --adapter opencode --url http://localhost:3000

# Webhook adapter
bun run src/cli/index.ts init --adapter webhook --endpoint http://your-server.com/chat
```

Headless mode requires HTTP API for QR login:

```bash
# Get login QR code
curl -X POST http://localhost:3200/api/login/qr

# Monitor login status (SSE)
curl http://localhost:3200/events
```

### Foreground Start (Dev/Debug)

```bash
# OpenCode adapter
bun run src/cli/index.ts start --adapter opencode --port 3200

# Webhook adapter
bun run src/cli/index.ts start --adapter webhook --endpoint http://localhost:8080/chat
```

## CLI Commands

```bash
# Initialize (recommended: no args opens browser UI)
bun run src/cli/index.ts init

# Headless init (with args skips browser)
bun run src/cli/index.ts init --adapter <name> --url <url> --port <port>

# Foreground start (dev/debug, Ctrl+C to stop)
bun run src/cli/index.ts start [--adapter <name>] [--port <port>]

# Stop background service
bun run src/cli/index.ts stop

# Show service and account status
bun run src/cli/index.ts status

# CLI QR login for new account
bun run src/cli/index.ts login

# Send media file
bun run src/cli/index.ts sendMedia --to <userId> --file <path>
```

## Adapter Configuration

### OpenCode Adapter

Connect to OpenCode AI backend:

```bash
bun run src/cli/index.ts start --adapter opencode --url http://localhost:3000
```

### Webhook Adapter

Forward messages to custom HTTP endpoint:

```bash
bun run src/cli/index.ts start --adapter webhook --endpoint http://your-server.com/chat
```

Webhook request format:

```json
{
  "message": "user message content",
  "userId": "sender WeChat ID",
  "sessionId": "session ID",
  "contextToken": "context token"
}
```

Expected response format:

```json
{
  "reply": "AI response content"
}
```

### Echo Adapter

Test adapter that echoes user messages:

```bash
bun run src/cli/index.ts start --adapter echo
```

## Configuration File

Config saved at `~/.weixin-clawbot-bridge/config.json` with three-layer priority:

**CLI args > config file > code defaults**

Example:

```json
{
  "adapter": "opencode",
  "port": 3200,
  "opencode": {
    "url": "http://localhost:3000"
  }
}
```

## HTTP API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/login/qr` | POST | Get login QR code |
| `/api/sendMedia` | POST | Send media file |
| `/events` | GET | SSE event stream (status updates) |

## State Directory

All persistent data stored in `~/.weixin-clawbot-bridge/`:

```
~/.weixin-clawbot-bridge/
├── config.json                 # Configuration
├── accounts.json               # Account index
├── accounts/                   # Account credentials
├── weixin-clawbot-bridge.pid   # Daemon PID
├── weixin-clawbot-bridge.log   # Runtime log
└── media/                      # Downloaded media
```

Override via `WEIXIN_CLAWBOT_BRIDGE_STATE_DIR` environment variable.

## Development

### Run Tests

```bash
bun test
```

### Type Check

```bash
bun typecheck
```

### Architecture

```
src/
├── index.ts          # Package entry
├── channel.ts        # createChannel() orchestrator
├── config.ts         # Config management
├── types.ts          # Type exports
├── adapter/          # AI backend adapters
│   ├── interface.ts  # ChannelAdapter interface
│   ├── echo.ts       # Echo test adapter
│   ├── opencode.ts   # OpenCode SDK v2 adapter
│   ├── webhook.ts    # Generic webhook adapter
│   └── index.ts      # Adapter factory
├── cli/              # CLI commands
│   ├── index.ts      # Command router
│   ├── daemon.ts     # Daemon management
│   └── init.ts       # Init command
├── server/           # HTTP server
│   ├── index.ts      # Bun.serve() bootstrap
│   ├── routes.ts     # Hono routes
│   └── sse.ts        # SSE event bus
└── core/             # iLink protocol core
    ├── api/          # HTTP API wrappers
    ├── auth/         # Login auth
    ├── cdn/          # CDN upload/download
    ├── media/        # Media processing
    ├── messaging/    # Message sending
    ├── monitor/      # Message polling
    └── storage/      # State storage
```

### Adding New Adapter

1. Create file in `src/adapter/` implementing `ChannelAdapter` interface
2. Export factory function `createXxxAdapter()`
3. Register in `resolveAdapter()` at `src/adapter/index.ts`

## Protocol Notes

This project uses iLink protocol for WeChat communication:

- **Long-polling**: Continuously fetch new messages via `getUpdates`
- **Message states**: `NEW=0`, `GENERATING=1`, `FINISH=2`
- **Media encryption**: AES-128-ECB for CDN upload/download
- **Deduplication**: `client_id` for message dedup; same ID silently dropped

## License

MIT
