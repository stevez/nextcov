/**
 * Simple logger for nextcov
 *
 * Logs are disabled by default (log: false in config).
 * Set log: true in nextcov config to enable detailed logging.
 * Set timing: true to show only performance timing information.
 */

let loggingEnabled = false
let timingEnabled = false

/**
 * Set whether logging is enabled
 */
export function setLogging(enabled: boolean): void {
  loggingEnabled = enabled
}

/**
 * Set whether timing logs are enabled
 */
export function setTiming(enabled: boolean): void {
  timingEnabled = enabled
}

/**
 * Check if logging is enabled
 */
export function isLoggingEnabled(): boolean {
  return loggingEnabled
}

/**
 * Check if timing is enabled
 */
export function isTimingEnabled(): boolean {
  return timingEnabled
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

/**
 * Simple timer utility for performance measurement.
 * Outputs when either logging or timing is enabled.
 */
export function createTimer(label: string): () => void {
  const start = performance.now()
  return () => {
    if (loggingEnabled || timingEnabled) {
      const duration = performance.now() - start
      console.log(`  ⏱ ${label}: ${duration.toFixed(0)}ms`)
    }
  }
}
