/**
 * CDP Collection Utilities
 *
 * Shared utilities for CDP-based coverage collectors.
 * Used by both server.ts (production) and dev-server.ts (dev mode).
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CDPClient } from 'monocart-coverage-reports'
import { log, safeClose } from '@/utils/logger.js'

/** Default timeout for CDP port availability check (ms) */
const CDP_CHECK_TIMEOUT = 2000

/** Monocart CDPClient type */
export type MonocartCDPClient = Awaited<ReturnType<typeof CDPClient>>

/** Base coverage entry from CDP */
export interface BaseCoverageEntry {
  url: string
  source?: string
  functions: Array<{
    functionName: string
    ranges: Array<{ startOffset: number; endOffset: number; count: number }>
    isBlockCoverage: boolean
  }>
}

/**
 * Check if CDP client is connected
 * @returns true if connected, false otherwise (logs warning)
 */
export function isClientConnected(client: unknown, mode?: string): client is NonNullable<MonocartCDPClient> {
  if (!client) {
    const suffix = mode ? ` (${mode})` : ''
    log(`  ⚠️ CDP not connected${suffix}`)
    return false
  }
  return true
}

/**
 * Check if coverage entries are empty
 * @returns true if empty (logs warning), false if has entries
 */
export function isCoverageEmpty(entries: unknown[] | null | undefined, mode?: string): boolean {
  if (!entries || entries.length === 0) {
    const suffix = mode ? ` (${mode})` : ''
    log(`  ⚠️ No coverage entries returned${suffix}`)
    return true
  }
  return false
}

/**
 * Log successful coverage collection
 */
export function logCollectionSuccess(count: number, mode?: string): void {
  const suffix = mode ? ` (${mode})` : ''
  log(`  ✓ Collected ${count} server coverage entries${suffix}`)
}

/**
 * Log collection error
 */
export function logCollectionError(error: unknown, mode?: string): void {
  const suffix = mode ? ` (${mode})` : ''
  log(`  ⚠️ Failed to collect server coverage${suffix}: ${error}`)
}

/**
 * Stop coverage collection, filter/transform entries, and cleanup
 *
 * Generic helper that handles the common try/catch/finally pattern
 * for CDP coverage collection.
 */
export async function collectCoverage<TRaw, TResult>(
  client: NonNullable<MonocartCDPClient>,
  options: {
    mode?: string
    filter: (entries: TRaw[]) => TRaw[]
    transform: (entries: TRaw[]) => TResult[]
    cleanup: () => void
  }
): Promise<TResult[]> {
  const { mode, filter, transform, cleanup } = options

  try {
    const rawEntries = await client.stopJSCoverage() as TRaw[]

    if (isCoverageEmpty(rawEntries, mode)) {
      return []
    }

    const filtered = filter(rawEntries)
    const results = transform(filtered)

    logCollectionSuccess(results.length, mode)
    return results
  } catch (error) {
    logCollectionError(error, mode)
    return []
  } finally {
    await safeClose(client)
    cleanup()
  }
}

/**
 * Try to read source content from a file URL
 * @returns source content or undefined if file doesn't exist or can't be read
 */
export function tryReadSource(url: string): string | undefined {
  try {
    const filePath = fileURLToPath(url)
    return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : undefined
  } catch (error) {
    log(`  Skipping file ${url}: ${error instanceof Error ? error.message : 'unknown error'}`)
    return undefined
  }
}

/**
 * Attach source content to coverage entries
 */
export function attachSourceContent<T extends BaseCoverageEntry>(entries: T[]): void {
  for (const entry of entries) {
    entry.source = tryReadSource(entry.url)
  }
}

/**
 * Check if a CDP port is available by making a quick HTTP request to /json/list.
 * This avoids triggering monocart's error logging when the port is unavailable.
 *
 * @param port - CDP port to check
 * @param timeout - Timeout in milliseconds (default: 2000)
 * @returns true if CDP is available, false otherwise
 */
export async function isCdpPortAvailable(
  port: number,
  timeout: number = CDP_CHECK_TIMEOUT
): Promise<boolean> {
  const url = `http://127.0.0.1:${port}/json/list`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(url, {
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    return response.ok
  } catch {
    // Connection refused, timeout, or other error - port not available
    return false
  }
}

/** Default CDP connection timeout (30 seconds) */
const DEFAULT_CDP_TIMEOUT = 30000

/**
 * Connect to CDP only (without starting coverage)
 * Use this when NODE_V8_COVERAGE handles coverage collection
 *
 * @param port - CDP port to connect to
 * @param mode - Optional mode string for logging (e.g., "dev", "prod")
 * @param skipAvailabilityCheck - Skip the pre-check (default: false)
 * @param timeout - Connection timeout in milliseconds (default: 30000)
 */
export async function connectToCdp(
  port: number,
  mode?: string,
  skipAvailabilityCheck: boolean = false,
  timeout: number = DEFAULT_CDP_TIMEOUT
): Promise<MonocartCDPClient | null> {
  const suffix = mode ? ` (${mode})` : ''

  // Pre-check: verify CDP port is available before calling CDPClient
  // This avoids monocart's noisy [MCR] Error logging when port is unavailable
  if (!skipAvailabilityCheck) {
    const available = await isCdpPortAvailable(port)
    if (!available) {
      log(`  CDP port ${port} not available${suffix}`)
      return null
    }
  }

  try {
    log(`  Connecting to CDP${suffix} at port ${port} (timeout: ${timeout}ms)...`)

    // Create a timeout promise that rejects after the specified time
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`CDP connection timed out after ${timeout}ms`)), timeout)
    })

    // Race between the connection and timeout
    const client = await Promise.race([
      CDPClient({ port }),
      timeoutPromise
    ])

    if (!client) {
      log(`  ⚠️ Failed to create CDP client${suffix}`)
      return null
    }

    log(`  ✓ Connected to CDP${suffix}`)
    return client
  } catch (error) {
    log(`  ⚠️ Failed to connect to CDP${suffix}: ${error}`)
    return null
  }
}

/**
 * Connect to CDP and start JS coverage collection
 *
 * @param port - CDP port to connect to
 * @param mode - Optional mode string for logging (e.g., "dev", "prod")
 * @param skipAvailabilityCheck - Skip the pre-check (default: false)
 * @param timeout - Connection timeout in milliseconds (default: 30000)
 */
export async function connectAndStartCoverage(
  port: number,
  mode?: string,
  skipAvailabilityCheck: boolean = false,
  timeout: number = DEFAULT_CDP_TIMEOUT
): Promise<MonocartCDPClient | null> {
  const client = await connectToCdp(port, mode, skipAvailabilityCheck, timeout)
  if (!client) {
    return null
  }

  const suffix = mode ? ` (${mode})` : ''
  try {
    await client.startJSCoverage()
    log(`  ✓ Started JS coverage collection${suffix}`)
    return client
  } catch (error) {
    log(`  ⚠️ Failed to start JS coverage${suffix}: ${error}`)
    await safeClose(client)
    return null
  }
}
