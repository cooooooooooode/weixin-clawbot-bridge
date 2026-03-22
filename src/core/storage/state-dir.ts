import os from "node:os"
import path from "node:path"

/** Resolve the state directory for weixin-claw. */
export function resolveStateDir(): string {
  return (
    process.env.WEIXIN_CLAW_STATE_DIR?.trim() ||
    process.env.OPENCLAW_STATE_DIR?.trim() ||
    path.join(os.homedir(), ".weixin-claw")
  )
}
