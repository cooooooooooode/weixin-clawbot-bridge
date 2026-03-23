export type Logger = {
  info(message: string): void
  debug(message: string): void
  warn(message: string): void
  error(message: string): void
  /** Returns a child logger whose messages are prefixed with `[accountId]`. */
  withAccount(accountId: string): Logger
  /** Returns the current main log file path. */
  getLogFilePath(): string
  close(): void
}

function createLogger(prefix?: string): Logger {
  const tag = prefix ? `[weixin-clawbot-bridge][${prefix}]` : "[weixin-clawbot-bridge]"
  return {
    info(msg: string) { console.log(`${tag} ${msg}`) },
    debug(msg: string) { if (process.env.WEIXIN_CLAWBOT_BRIDGE_DEBUG) console.debug(`${tag} ${msg}`) },
    warn(msg: string) { console.warn(`${tag} ${msg}`) },
    error(msg: string) { console.error(`${tag} ${msg}`) },
    withAccount(id: string) { return createLogger(id) },
    getLogFilePath() { return "" },
    close() {},
  }
}

export const logger: Logger = createLogger()
