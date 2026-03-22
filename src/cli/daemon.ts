import { resolveStateDir } from "../core/storage/state-dir.js"
import { mkdirSync, existsSync, unlinkSync, readFileSync, openSync, constants as fsConst } from "node:fs"
import { spawn as nodeSpawn } from "node:child_process"
import path from "node:path"

function pidPath(): string {
  return path.join(resolveStateDir(), "weixin-claw.pid")
}

export function logPath(): string {
  return path.join(resolveStateDir(), "weixin-claw.log")
}

export function running(): { pid: number; alive: boolean } | null {
  const p = pidPath()
  if (!existsSync(p)) return null
  const raw = readFileSync(p, "utf-8").trim()
  const pid = parseInt(raw, 10)
  if (isNaN(pid)) return null
  try {
    process.kill(pid, 0)
    return { pid, alive: true }
  } catch {
    return { pid, alive: false }
  }
}

export async function spawn(): Promise<number> {
  const existing = running()
  if (existing?.alive) {
    console.log(`[weixin-claw] 服务已在运行 (PID ${existing.pid})`)
    return existing.pid
  }

  const dir = resolveStateDir()
  mkdirSync(dir, { recursive: true })

  const log = logPath()
  const fd = openSync(log, fsConst.O_WRONLY | fsConst.O_CREAT | fsConst.O_APPEND)

  // Find the CLI entry point
  const entry = path.resolve(import.meta.dir, "index.ts")

  // Use node child_process with detached + fd for true daemonization
  const child = nodeSpawn("bun", ["run", entry, "start"], {
    cwd: process.cwd(),
    stdio: ["ignore", fd, fd],
    detached: true,
    env: { ...process.env },
  })

  const pid = child.pid!
  child.unref()

  await Bun.write(pidPath(), String(pid))
  console.log(`[weixin-claw] 服务已启动 PID=${pid}`)
  console.log(`[weixin-claw] 日志: ${log}`)

  return pid
}

export async function stop(): Promise<boolean> {
  const state = running()
  if (!state) {
    console.log("[weixin-claw] 没有运行中的服务")
    return false
  }
  if (!state.alive) {
    console.log(`[weixin-claw] PID ${state.pid} 已不存在，清理 PID 文件`)
    unlinkSync(pidPath())
    return false
  }

  try {
    process.kill(state.pid, "SIGTERM")
    console.log(`[weixin-claw] 已发送 SIGTERM 到 PID ${state.pid}`)
  } catch (err) {
    console.error(`[weixin-claw] kill 失败: ${err}`)
    return false
  }

  // Wait for process to exit (up to 5s)
  for (let i = 0; i < 50; i++) {
    await Bun.sleep(100)
    try {
      process.kill(state.pid, 0)
    } catch {
      break
    }
  }

  if (existsSync(pidPath())) unlinkSync(pidPath())
  console.log("[weixin-claw] 服务已停止")
  return true
}
