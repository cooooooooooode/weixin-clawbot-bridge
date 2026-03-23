# weixin-clawbot-bridge

[English](./README.md)

微信消息渠道桥接器 —— 通过 iLink 协议将微信用户连接到 AI 后端（OpenCode、Webhook 等）。

基于 Bun 运行时的 CLI 工具，支持守护进程模式后台运行。

## 功能特性

- **扫码登录**：终端显示二维码，手机扫码即可完成微信登录
- **守护进程**：支持后台运行，持久化服务
- **多适配器**：可插拔的 AI 后端适配器（OpenCode、Webhook、Echo 测试）
- **媒体支持**：支持发送图片、视频、文件等媒体内容
- **流式回复**：支持 AI 流式输出，实时显示"正在输入"状态
- **多账号**：支持同时登录多个微信账号

## 快速开始

### 前置条件

- 安装 [Bun](https://bun.sh/) 运行时

### 安装

```bash
git clone <repo-url>
cd weixin-claw-channel
bun install
```

### 一键初始化（推荐）

```bash
bun run src/cli/index.ts init
```

此命令会自动打开浏览器，进入可视化配置页面：

1. 选择 AI 后端适配器（OpenCode / Webhook）
2. 配置相关参数
3. 扫码登录微信账号
4. 点击"启动服务"

配置和登录信息会自动保存，服务以后台守护进程方式运行。

### 命令行初始化（Headless）

适用于自动化脚本或无图形界面环境：

```bash
# OpenCode 适配器
bun run src/cli/index.ts init --adapter opencode --url http://localhost:3000

# Webhook 适配器
bun run src/cli/index.ts init --adapter webhook --endpoint http://your-server.com/chat
```

Headless 模式需要通过 HTTP API 完成扫码登录：

```bash
# 获取登录二维码
curl -X POST http://localhost:3200/api/login/qr

# 监听登录状态（SSE）
curl http://localhost:3200/events
```

### 前台启动（开发调试）

```bash
# 使用 OpenCode 适配器
bun run src/cli/index.ts start --adapter opencode --port 3200

# 使用 Webhook 适配器
bun run src/cli/index.ts start --adapter webhook --endpoint http://localhost:8080/chat
```

## CLI 命令

```bash
# 初始化配置（推荐：无参数打开浏览器可视化配置）
bun run src/cli/index.ts init

# Headless 初始化（带参数则不打开浏览器）
bun run src/cli/index.ts init --adapter <name> --url <url> --port <port>

# 前台启动服务（开发调试用，Ctrl+C 停止）
bun run src/cli/index.ts start [--adapter <name>] [--port <port>]

# 停止后台服务
bun run src/cli/index.ts stop

# 查看服务和账号状态
bun run src/cli/index.ts status

# CLI 扫码登录新账号
bun run src/cli/index.ts login

# 发送媒体文件
bun run src/cli/index.ts sendMedia --to <userId> --file <path>
```

## 适配器配置

### OpenCode 适配器

连接到 OpenCode AI 后端：

```bash
bun run src/cli/index.ts start --adapter opencode --url http://localhost:3000
```

### Webhook 适配器

将消息转发到自定义 HTTP 端点：

```bash
bun run src/cli/index.ts start --adapter webhook --endpoint http://your-server.com/chat
```

Webhook 请求格式：

```json
{
  "message": "用户消息内容",
  "userId": "发送者微信ID",
  "sessionId": "会话ID",
  "contextToken": "上下文令牌"
}
```

期望响应格式：

```json
{
  "reply": "AI 回复内容"
}
```

### Echo 适配器

测试用适配器，原样返回用户消息：

```bash
bun run src/cli/index.ts start --adapter echo
```

## 配置文件

配置保存在 `~/.weixin-clawbot-bridge/config.json`，支持三层优先级：

**CLI 参数 > 配置文件 > 代码默认值**

示例配置：

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

服务启动后提供以下 HTTP 端点：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/login/qr` | POST | 获取登录二维码 |
| `/api/sendMedia` | POST | 发送媒体文件 |
| `/events` | GET | SSE 事件流（状态更新） |

## 状态目录

所有持久化数据存储在 `~/.weixin-clawbot-bridge/` 目录：

```
~/.weixin-clawbot-bridge/
├── config.json              # 配置文件
├── accounts.json            # 账号索引
├── accounts/                # 账号凭证目录
├── weixin-clawbot-bridge.pid   # 守护进程 PID
├── weixin-clawbot-bridge.log   # 运行日志
└── media/                   # 下载的媒体文件
```

可通过环境变量 `WEIXIN_CLAWBOT_BRIDGE_STATE_DIR` 自定义路径。

## 开发

### 运行测试

```bash
bun test
```

### 类型检查

```bash
bun typecheck
```

### 项目架构

```
src/
├── index.ts          # 包入口
├── channel.ts        # createChannel() 编排器
├── config.ts         # 配置管理
├── types.ts          # 类型导出
├── adapter/          # AI 后端适配器
│   ├── interface.ts  # ChannelAdapter 接口
│   ├── echo.ts       # Echo 测试适配器
│   ├── opencode.ts   # OpenCode SDK v2 适配器
│   ├── webhook.ts    # 通用 Webhook 适配器
│   └── index.ts      # 适配器工厂
├── cli/              # CLI 命令
│   ├── index.ts      # 命令路由
│   ├── daemon.ts     # 守护进程管理
│   └── init.ts       # 初始化命令
├── server/           # HTTP 服务
│   ├── index.ts      # Bun.serve() 启动
│   ├── routes.ts     # Hono 路由
│   └── sse.ts        # SSE 事件总线
└── core/             # iLink 协议核心
    ├── api/          # HTTP API 封装
    ├── auth/         # 登录认证
    ├── cdn/          # CDN 上传下载
    ├── media/        # 媒体处理
    ├── messaging/    # 消息发送
    ├── monitor/      # 消息轮询
    └── storage/      # 状态存储
```

### 添加新适配器

1. 在 `src/adapter/` 创建新文件，实现 `ChannelAdapter` 接口
2. 导出工厂函数 `createXxxAdapter()`
3. 在 `src/adapter/index.ts` 的 `resolveAdapter()` 中注册

## 协议说明

本项目使用 iLink 协议与微信服务通信：

- **长轮询**：通过 `getUpdates` 持续获取新消息
- **消息状态**：`NEW=0`（新建）、`GENERATING=1`（生成中）、`FINISH=2`（完成）
- **媒体加密**：CDN 上传下载使用 AES-128-ECB 加密
- **去重机制**：`client_id` 用于消息去重，相同 ID 会被静默丢弃

## License

MIT
