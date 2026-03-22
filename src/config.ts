import { resolveStateDir } from "./core/storage/state-dir.js"
import { mkdirSync } from "node:fs"
import path from "node:path"

export type Config = {
  adapter?: "echo" | "opencode" | "webhook"
  port?: number
  opencode?: { url?: string; directory?: string }
  webhook?: { endpoint?: string }
}

export function configPath(): string {
  return path.join(resolveStateDir(), "config.json")
}

export async function load(): Promise<Config> {
  return Bun.file(configPath()).json().catch(() => ({}) as Config)
}

export async function save(cfg: Config): Promise<void> {
  const p = configPath()
  mkdirSync(path.dirname(p), { recursive: true })
  await Bun.write(p, JSON.stringify(cfg, null, 2) + "\n")
}

export function merge(file: Config, cli: Partial<Config>): Config {
  return {
    adapter: cli.adapter ?? file.adapter ?? "echo",
    port: cli.port ?? file.port ?? 3200,
    opencode: {
      url: cli.opencode?.url ?? file.opencode?.url ?? "http://localhost:4096",
      directory: cli.opencode?.directory ?? file.opencode?.directory,
    },
    webhook: {
      endpoint: cli.webhook?.endpoint ?? file.webhook?.endpoint,
    },
  }
}
