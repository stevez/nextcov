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
 * Optimized to avoid performance.now() calls when timing is disabled.
 */
export function createTimer(label: string): () => void {
  // Early return no-op if timing is disabled to avoid performance.now() overhead
  if (!loggingEnabled && !timingEnabled) {
    return () => {}
  }
  const start = performance.now()
  return () => {
    const duration = performance.now() - start
    console.log(`  ⏱ ${label}: ${duration.toFixed(0)}ms`)
  }
}

/**
 * Format an error for logging.
 * Extracts message from Error objects, converts other types to string.
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * Safely parse JSON with error logging.
 * Returns null on parse failure instead of throwing.
 */
export function safeJsonParse<T>(json: string, context?: string): T | null {
  try {
    return JSON.parse(json) as T
  } catch (error) {
    const ctx = context ? ` (${context})` : ''
    log(`JSON parse failed${ctx}: ${formatError(error)}`)
    return null
  }
}

/**
 * Safely close a resource, ignoring any errors.
 * Use for cleanup in finally blocks where close errors shouldn't propagate.
 */
export async function safeClose(
  closeable: { close(): Promise<void> } | null | undefined
): Promise<void> {
  try {
    await closeable?.close()
  } catch {
    // Ignore close errors during cleanup
  }
}
