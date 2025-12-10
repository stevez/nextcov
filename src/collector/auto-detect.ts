/**
 * Auto-Detect Server Coverage Collector
 *
 * Automatically detects whether to use dev mode (inline source maps) or
 * production mode (external .map files) by probing CDP ports.
 *
 * Detection strategy:
 * 1. Try port + 1 first (9231 for worker process in dev mode)
 * 2. If connectable, use DevModeServerCollector (it handles dev mode scripts)
 * 3. Otherwise -> use ServerCoverageCollector on base port
 *
 * Usage:
 * - global-setup: Call startServerCoverageAutoDetect() to detect mode and start collection
 * - global-teardown: Call stopServerCoverageAutoDetect() to get coverage data
 */

import { ServerCoverageCollector, type V8CoverageEntry } from './server.js'
import { DevModeServerCollector, type DevServerCoverageEntry } from './dev-server.js'
import { DEFAULT_NEXTCOV_CONFIG } from '../config.js'

export interface AutoDetectConfig {
  /** Base CDP port (default: 9230). Will also try port + 1 for dev mode. */
  cdpPort: number
  /** Source root for filtering project files */
  sourceRoot?: string
  /** Cache directory for coverage data */
  cacheDir?: string
  /** Build directory (.next) */
  buildDir?: string
}

export interface DetectionResult {
  /** The port that was successfully connected */
  port: number
  /** Whether dev mode (inline source maps) was detected */
  isDevMode: boolean
  /** The collector to use */
  collector: ServerCoverageCollector | DevModeServerCollector
}

// Global state to maintain collector between setup and teardown
let activeCollector: ServerCoverageCollector | DevModeServerCollector | null = null
let activeIsDevMode = false

/**
 * Quick check if a port is connectable (doesn't enable anything)
 */
async function canConnect(port: number): Promise<boolean> {
  try {
    const CDP = (await import('chrome-remote-interface')).default
    const client = await CDP({ port })
    await client.close()
    return true
  } catch {
    return false
  }
}

/**
 * Start server coverage collection with auto-detection.
 * Call this in global-setup to begin coverage collection before tests run.
 *
 * @returns Object with isDevMode flag and the detected port
 */
export async function startServerCoverageAutoDetect(
  config?: Partial<AutoDetectConfig>
): Promise<{ isDevMode: boolean; port: number } | null> {
  const basePort = config?.cdpPort ?? 9230
  const devPort = basePort + 1
  const cacheDir = config?.cacheDir ?? DEFAULT_NEXTCOV_CONFIG.cacheDir

  console.log(`📊 Auto-detecting server coverage mode...`)

  // First, try dev port (port + 1) for dev mode worker process
  const devPortConnectable = await canConnect(devPort)

  if (devPortConnectable) {
    console.log(`  ✓ Dev mode detected on port ${devPort}`)

    const collector = new DevModeServerCollector({
      cdpPort: devPort,
      sourceRoot: config?.sourceRoot ?? 'src',
    })

    const connected = await collector.connect()
    if (connected) {
      activeCollector = collector
      activeIsDevMode = true
      console.log(`  ✓ Coverage collection started (dev mode)`)
      return { isDevMode: true, port: devPort }
    }
  }

  // Try base port for production mode
  const basePortConnectable = await canConnect(basePort)

  if (basePortConnectable) {
    console.log(`  ✓ Production mode on port ${basePort}`)

    const collector = new ServerCoverageCollector({
      cdpPort: basePort,
      cacheDir,
      buildDir: config?.buildDir ?? '.next',
    })

    const connected = await collector.connect()
    if (connected) {
      activeCollector = collector
      activeIsDevMode = false
      console.log(`  ✓ Coverage collection started (production mode)`)
      return { isDevMode: false, port: basePort }
    }
  }

  console.log(`  ⚠️ Could not connect to CDP on port ${basePort} or ${devPort}`)
  return null
}

/**
 * Stop server coverage collection and get the results.
 * Call this in global-teardown to collect coverage after tests run.
 */
export async function stopServerCoverageAutoDetect(): Promise<{
  entries: Array<V8CoverageEntry | DevServerCoverageEntry>
  isDevMode: boolean
}> {
  if (!activeCollector) {
    console.log(`  ⚠️ No active coverage collection to stop`)
    return { entries: [], isDevMode: false }
  }

  const entries = await activeCollector.collect()
  const isDevMode = activeIsDevMode

  // Clear state
  activeCollector = null
  activeIsDevMode = false

  return { entries, isDevMode }
}

/**
 * Collect server coverage with auto-detection
 *
 * This is the main entry point for server coverage collection.
 * It automatically detects dev vs production mode by trying:
 * - port + 1 for dev mode (worker process with inline source maps)
 * - base port for production mode (external source maps)
 */
export async function collectServerCoverageAutoDetect(
  config?: Partial<AutoDetectConfig>
): Promise<{ entries: Array<V8CoverageEntry | DevServerCoverageEntry>; isDevMode: boolean }> {
  const basePort = config?.cdpPort ?? 9230
  const devPort = basePort + 1

  console.log(`📊 Auto-detecting server coverage mode...`)

  // First, try dev port (port + 1) for dev mode worker process
  const devPortConnectable = await canConnect(devPort)

  if (devPortConnectable) {
    console.log(`  ✓ Dev mode detected on port ${devPort}`)

    const collector = new DevModeServerCollector({
      cdpPort: devPort,
      sourceRoot: config?.sourceRoot ?? 'src',
    })

    const connected = await collector.connect()
    if (connected) {
      const entries = await collector.collect()
      if (entries.length > 0) {
        return { entries, isDevMode: true }
      }
    }
    // If dev mode didn't work, fall through to try production mode
    console.log(`  ⚠️ Dev mode had no coverage, trying production mode...`)
  }

  // Try base port for production mode
  const basePortConnectable = await canConnect(basePort)

  if (basePortConnectable) {
    console.log(`  ✓ Production mode on port ${basePort}`)

    const collector = new ServerCoverageCollector({
      cdpPort: basePort,
      cacheDir: config?.cacheDir ?? DEFAULT_NEXTCOV_CONFIG.cacheDir,
      buildDir: config?.buildDir ?? '.next',
    })

    const connected = await collector.connect()
    if (connected) {
      const entries = await collector.collect()
      return { entries, isDevMode: false }
    }
  }

  console.log(`  ⚠️ Could not connect to CDP on port ${basePort} or ${devPort}`)
  return { entries: [], isDevMode: false }
}

/**
 * Auto-detect and create the appropriate server coverage collector
 * @deprecated Use collectServerCoverageAutoDetect instead
 */
export async function autoDetectServerCollector(
  config?: Partial<AutoDetectConfig>
): Promise<DetectionResult | null> {
  const basePort = config?.cdpPort ?? 9230
  const devPort = basePort + 1

  // Try dev port first
  const devPortConnectable = await canConnect(devPort)

  if (devPortConnectable) {
    const collector = new DevModeServerCollector({
      cdpPort: devPort,
      sourceRoot: config?.sourceRoot ?? 'src',
    })
    return { port: devPort, isDevMode: true, collector }
  }

  // Try base port
  const basePortConnectable = await canConnect(basePort)

  if (basePortConnectable) {
    const collector = new ServerCoverageCollector({
      cdpPort: basePort,
      cacheDir: config?.cacheDir ?? DEFAULT_NEXTCOV_CONFIG.cacheDir,
      buildDir: config?.buildDir ?? '.next',
    })
    return { port: basePort, isDevMode: false, collector }
  }

  return null
}
