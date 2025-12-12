/**
 * Simple logger for nextcov
 *
 * Logs are disabled by default (log: false in config).
 * Set log: true in nextcov config to enable detailed logging.
 */

let loggingEnabled = false

/**
 * Set whether logging is enabled
 */
export function setLogging(enabled: boolean): void {
  loggingEnabled = enabled
}

/**
 * Check if logging is enabled
 */
export function isLoggingEnabled(): boolean {
  return loggingEnabled
}

/**
 * Log a message (only if logging is enabled)
 */
export function log(...args: unknown[]): void {
  if (loggingEnabled) {
    console.log(...args)
  }
}

/**
 * Log a warning (always shown)
 */
export function warn(...args: unknown[]): void {
  console.log(...args)
}

/**
 * Log an error (always shown)
 */
export function error(...args: unknown[]): void {
  console.error(...args)
}
