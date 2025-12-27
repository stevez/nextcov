/**
 * Playwright Coverage Fixture
 *
 * High-level functions for collecting and processing coverage in Playwright E2E tests.
 * Supports both production mode (external .map files) and dev mode (inline source maps).
 */

import * as path from 'path'
import type { Page, TestInfo } from '@playwright/test'
import { CoverageProcessor } from '@/core/processor.js'
import { terminateWorkerPool } from '@/worker/pool.js'
import type { CoverageOptions, CoverageResult, ReporterType } from '@/types.js'
import {
  DEFAULT_NEXTCOV_CONFIG,
  DEFAULT_INCLUDE_PATTERNS,
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_REPORTERS,
  resolveNextcovConfig,
  type NextcovConfig,
  type ResolvedNextcovConfig,
  type ResolvedDevModeOptions,
} from '@/utils/config.js'
import {
  saveClientCoverage,
  filterAppCoverage,
  ClientCoverageCollector,
  V8ServerCoverageCollector,
  DevModeServerCollector,
  type PlaywrightCoverageEntry,
  type DevServerCoverageEntry,
  type V8ServerCoverageEntry,
} from '@/collector/index.js'
import { log, setLogging, setTiming } from '@/utils/logger.js'

/**
 * Module-level state for persisting between globalSetup and globalTeardown.
 *
 * This is intentional: Playwright runs globalSetup and globalTeardown in the same
 * process, so module-level state is the correct mechanism for passing the collector
 * from startServerCoverage() to finalizeCoverage().
 *
 * The state is cleared at the end of finalizeCoverage() to reset between test runs.
 */
let devModeCollector: DevModeServerCollector | null = null

/**
 * Reset module-level state. Primarily for testing purposes.
 * In normal usage, finalizeCoverage() clears this state automatically.
 */
export function resetCoverageState(): void {
  devModeCollector = null
}

/**
 * Initialize coverage collection.
 *
 * This is the recommended function to call in globalSetup for all modes.
 * It handles both client-only and full (client + server) coverage modes:
 *
 * - **Client-only mode** (`collectServer: false`): Just initializes logging/timing settings.
 *   No server connection is made. Coverage is collected per-test via the Playwright fixture.
 *
 * - **Full mode** (`collectServer: true`): Connects to the Next.js server via CDP
 *   to collect server-side coverage in addition to client coverage.
 *
 * @example
 * ```typescript
 * // In global-setup.ts
 * import { initCoverage, loadNextcovConfig } from 'nextcov/playwright'
 *
 * export default async function globalSetup() {
 *   const config = await loadNextcovConfig()
 *   await initCoverage(config)
 * }
 * ```
 */
export async function initCoverage(
  config?: NextcovConfig | ResolvedNextcovConfig
): Promise<void> {
  const resolved = config && 'cacheDir' in config
    ? config as ResolvedNextcovConfig
    : resolveNextcovConfig(config)

  // Initialize logging and timing from config
  setLogging(resolved.log)
  setTiming(resolved.timing)

  // For client-only mode, just log and return
  if (!resolved.collectServer) {
    console.log('📊 Coverage initialized (client-only mode)')
    devModeCollector = null
    return
  }

  // For full mode, delegate to startServerCoverage
  await startServerCoverage(resolved)
}

export interface PlaywrightCoverageOptions {
  /** Project root directory (default: process.cwd()) */
  projectRoot?: string
  /** Output directory for coverage reports (default: './coverage/e2e') */
  outputDir?: string
  /** Next.js build directory (default: '.next') */
  buildDir?: string
  /** Source root relative to project root (default: './src') */
  sourceRoot?: string
  /**
   * V8 coverage directory where NODE_V8_COVERAGE writes coverage files.
   * This should match the value of NODE_V8_COVERAGE env var.
   * (default: from NODE_V8_COVERAGE env or '.v8-coverage')
   */
  v8CoverageDir?: string
  /** Glob patterns to include */
  include?: string[]
  /** Glob patterns to exclude */
  exclude?: string[]
  /** Reporter types to generate */
  reporters?: ReporterType[]
  /** Whether to clean up cache after processing (default: true) */
  cleanup?: boolean
  /** Dev mode options (auto-detected by default) */
  devMode?: ResolvedDevModeOptions
  /** CDP port for triggering v8.takeCoverage() (default: 9230) */
  cdpPort?: number
  /**
   * Collect server-side coverage (default: true).
   * When false, startServerCoverage() becomes a no-op and finalizeCoverage()
   * skips server coverage collection.
   */
  collectServer?: boolean
  /**
   * Collect client-side coverage (default: true).
   * When false, client coverage from Playwright is not collected.
   */
  collectClient?: boolean
}

const DEFAULT_OPTIONS: Required<PlaywrightCoverageOptions> = {
  projectRoot: process.cwd(),
  outputDir: DEFAULT_NEXTCOV_CONFIG.outputDir,
  buildDir: DEFAULT_NEXTCOV_CONFIG.buildDir,
  sourceRoot: DEFAULT_NEXTCOV_CONFIG.sourceRoot,
  v8CoverageDir: DEFAULT_NEXTCOV_CONFIG.v8CoverageDir,
  include: DEFAULT_INCLUDE_PATTERNS,
  exclude: DEFAULT_EXCLUDE_PATTERNS,
  reporters: DEFAULT_REPORTERS,
  cleanup: true,
  devMode: DEFAULT_NEXTCOV_CONFIG.devMode,
  cdpPort: DEFAULT_NEXTCOV_CONFIG.cdpPort,
  collectServer: DEFAULT_NEXTCOV_CONFIG.collectServer,
  collectClient: DEFAULT_NEXTCOV_CONFIG.collectClient,
}

/**
 * Start server-side coverage collection in dev mode.
 *
 * Call this function in globalSetup BEFORE any tests run.
 * This ensures the V8 Profiler is started before any server code executes
 * during page requests.
 *
 * **Note:** This function is only required for dev mode (`next dev`).
 * For production mode (`next start`), coverage is collected automatically
 * via `NODE_V8_COVERAGE` environment variable - no early setup needed.
 * This function will auto-detect the mode and return `false` for production.
 *
 * @returns `true` if dev mode was detected and profiler started, `false` for production mode
 *
 * @example
 * ```typescript
 * // In global-setup.ts
 * import { startServerCoverage, loadNextcovConfig } from 'nextcov/playwright'
 *
 * export default async function globalSetup() {
 *   const config = await loadNextcovConfig()
 *   await startServerCoverage(config)
 * }
 * ```
 */
export async function startServerCoverage(
  config?: NextcovConfig | ResolvedNextcovConfig
): Promise<boolean> {
  const resolved = config && 'cacheDir' in config
    ? config as ResolvedNextcovConfig
    : resolveNextcovConfig(config)

  // Initialize logging and timing from config
  setLogging(resolved.log)
  setTiming(resolved.timing)

  // Skip server coverage if collectServer is false
  if (!resolved.collectServer) {
    console.log('📊 Server coverage disabled: skipping server coverage setup')
    devModeCollector = null
    return false
  }

  // Auto-detect dev mode vs production mode:
  // - Dev mode: next dev --inspect=9230 spawns worker on port 9231 (inspect port + 1)
  // - Production mode: next start --inspect=9230 runs on port 9230 (no worker)
  //
  // The user configures cdpPort to the inspect port (e.g., 9230).
  // We try cdpPort + 1 first (dev worker). If successful, it's dev mode.
  // If the connection fails, production mode will use cdpPort directly.
  const devWorkerPort = resolved.cdpPort + 1 // e.g., 9231 (worker port for --inspect=9230)
  const productionPort = resolved.cdpPort // e.g., 9230 (main process port)

  console.log('📊 Auto-detecting server mode...')
  log(`  Base URL: ${resolved.devMode.baseUrl}`)
  log(`  Trying dev mode (worker port ${devWorkerPort})...`)

  // Try dev mode (connect to worker port)
  devModeCollector = new DevModeServerCollector({
    cdpPort: devWorkerPort,
    sourceRoot: resolved.sourceRoot.replace(/^\.\//, ''),
  })

  const devConnected = await devModeCollector.connect()
  if (devConnected) {
    // Port 9231 (dev worker) is open = Dev mode confirmed
    // devModeCollector being non-null indicates dev mode in finalizeCoverage()
    const startTime = Date.now()

    // On cold starts, webpack hasn't compiled anything yet.
    // Make a warmup request to trigger compilation, then wait for webpack to be ready.
    const baseUrl = resolved.devMode.baseUrl
    log(`  Triggering webpack compilation with warmup request to ${baseUrl}...`)
    try {
      await fetch(baseUrl)
    } catch (error) {
      log(`  ⚠️ Warmup request failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    }

    // Wait for webpack scripts to be ready (cold start warmup)
    const webpackReady = await devModeCollector.waitForWebpackScripts(15000)
    const waitedMs = Date.now() - startTime

    if (webpackReady) {
      console.log(`  ✓ Dev mode detected (worker port ${devWorkerPort})`)
      log(`    webpack ready after ${waitedMs}ms`)
    } else {
      console.log(`  ✓ Dev mode detected (worker port ${devWorkerPort})`)
      log(`  ⚠️ webpack not ready after ${waitedMs}ms (may affect coverage)`)
    }

    log('  ✓ Server coverage collection started')
    return true
  }

  // Dev worker port not available - production mode will be used
  devModeCollector = null
  console.log(`  ✓ Production mode detected (port ${productionPort})`)
  return false
}

/**
 * Finalize coverage collection and generate reports.
 *
 * This function should be called in globalTeardown to:
 * 1. Collect server-side coverage via CDP (before server shuts down)
 * 2. Read client-side coverage from cache
 * 3. Process combined coverage with CoverageProcessor
 * 4. Generate coverage reports (html, lcov, json, etc.)
 * 5. Clean up temporary files
 *
 * In dev mode, this uses the DevModeServerCollector which extracts inline
 * source maps from webpack's eval-source-map format.
 *
 * @example
 * ```typescript
 * // In global-teardown.ts
 * import { finalizeCoverage } from 'nextcov/playwright'
 *
 * export default async function globalTeardown() {
 *   await finalizeCoverage({
 *     outputDir: './coverage/e2e',
 *     reporters: ['html', 'lcov', 'json'],
 *   })
 * }
 * ```
 */
/**
 * Collect server coverage in dev mode.
 * Uses the DevModeServerCollector that was started in globalSetup.
 */
async function collectDevModeServerCoverage(): Promise<DevServerCoverageEntry[]> {
  if (!devModeCollector) {
    return []
  }

  log('📊 Collecting server-side coverage (dev mode)...')
  const coverage = await devModeCollector.collect()
  if (coverage.length > 0) {
    log(`  ✓ Collected ${coverage.length} server coverage entries (dev mode)`)
  }

  // Clear module-level reference
  devModeCollector = null

  return coverage
}

/**
 * Collect server coverage in production mode.
 * Uses NODE_V8_COVERAGE + CDP trigger approach.
 *
 * @returns Object with coverage entries and collector (for cleanup)
 */
async function collectProductionServerCoverage(opts: {
  cdpPort: number
  buildDir: string
  sourceRoot: string
  v8CoverageDir: string
}): Promise<{ coverage: V8ServerCoverageEntry[]; collector: V8ServerCoverageCollector }> {
  log('📊 Collecting server-side coverage (production mode)...')

  const collector = new V8ServerCoverageCollector({
    cdpPort: opts.cdpPort,
    buildDir: opts.buildDir,
    sourceRoot: opts.sourceRoot,
    v8CoverageDir: opts.v8CoverageDir,
  })

  const connected = await collector.connect()
  if (!connected) {
    return { coverage: [], collector }
  }

  const coverage = await collector.collect()
  if (coverage.length > 0) {
    log(`  ✓ Collected ${coverage.length} server coverage entries (production mode)`)
  }

  return { coverage, collector }
}

/**
 * Read client-side coverage from cache directory.
 */
async function readClientCoverageFromCache(opts: Required<PlaywrightCoverageOptions>): Promise<PlaywrightCoverageEntry[]> {
  log('📊 Reading client-side coverage...')
  const cacheDir = path.join(opts.outputDir, '.cache')
  const clientCollector = new ClientCoverageCollector({ cacheDir })
  const coverage = await clientCollector.readAllClientCoverage()
  log(`  ✓ Found ${coverage.length} client-side coverage entries`)
  return coverage
}

/**
 * Clean up temporary coverage files.
 */
async function cleanupCoverageFiles(
  opts: Required<PlaywrightCoverageOptions>,
  v8Collector: V8ServerCoverageCollector | null
): Promise<void> {
  const cacheDir = path.join(opts.outputDir, '.cache')
  const clientCollector = new ClientCoverageCollector({ cacheDir })
  await clientCollector.cleanCoverageDir()
  if (v8Collector) {
    await v8Collector.cleanup()
  }
}

/**
 * Process combined coverage and generate reports.
 */
async function processCoverageAndGenerateReports(
  allCoverage: Array<V8ServerCoverageEntry | PlaywrightCoverageEntry | DevServerCoverageEntry>,
  opts: Required<PlaywrightCoverageOptions>
): Promise<CoverageResult | null> {
  log('📊 Processing coverage with ast-v8-to-istanbul...')

  const processor = new CoverageProcessor(opts.projectRoot, {
    outputDir: opts.outputDir,
    nextBuildDir: opts.buildDir,
    sourceRoot: opts.sourceRoot,
    include: opts.include,
    exclude: opts.exclude,
    reporters: opts.reporters,
  } as CoverageOptions)

  const result = await processor.processAllCoverage(allCoverage)

  // Terminate worker pool to free memory
  await terminateWorkerPool()

  log(`\n✅ Coverage reports generated at: ${path.resolve(opts.projectRoot, opts.outputDir)}`)
  if (result?.summary) {
    const linesPct = result.summary.lines?.pct?.toFixed(1) || '0.0'
    log(`   Overall coverage: ${linesPct}% lines`)
  }

  return result
}

/**
 * Finalize coverage in dev mode.
 * Uses DevModeServerCollector started in globalSetup.
 */
async function finalizeDevModeCoverage(
  opts: Required<PlaywrightCoverageOptions>
): Promise<CoverageResult | null> {
  // Step 1: Collect server coverage from dev mode collector (if enabled)
  const serverCoverage = opts.collectServer ? await collectDevModeServerCoverage() : []

  // Step 2: Read client coverage from cache (if enabled)
  const clientCoverage = opts.collectClient ? await readClientCoverageFromCache(opts) : []

  // Combine coverage (client first, then server)
  const allCoverage: Array<PlaywrightCoverageEntry | DevServerCoverageEntry> = [
    ...clientCoverage,
    ...serverCoverage,
  ]

  if (allCoverage.length === 0) {
    log('  ⚠️ No coverage to process')
    if (opts.cleanup) {
      await cleanupCoverageFiles(opts, null)
    }
    return null
  }

  // Step 3: Process and generate reports
  // Dev mode uses inline source maps extracted via CDP, so buildDir is not used
  try {
    const result = await processCoverageAndGenerateReports(allCoverage, opts)
    if (opts.cleanup) {
      await cleanupCoverageFiles(opts, null)
    }
    return result
  } catch (error) {
    console.error('❌ Error processing coverage:', error)
    if (opts.cleanup) {
      await cleanupCoverageFiles(opts, null)
    }
    return null
  }
}

/**
 * Finalize coverage in production mode.
 * Uses NODE_V8_COVERAGE + CDP trigger approach.
 */
async function finalizeProductionCoverage(
  opts: Required<PlaywrightCoverageOptions>
): Promise<CoverageResult | null> {
  // Step 1: Collect server coverage via CDP trigger (if enabled)
  let serverCoverage: V8ServerCoverageEntry[] = []
  let v8Collector: V8ServerCoverageCollector | null = null
  if (opts.collectServer) {
    const result = await collectProductionServerCoverage({
      cdpPort: opts.cdpPort,
      buildDir: opts.buildDir,
      sourceRoot: opts.sourceRoot,
      v8CoverageDir: opts.v8CoverageDir,
    })
    serverCoverage = result.coverage
    v8Collector = result.collector
  }

  // Step 2: Read client coverage from cache (if enabled)
  const clientCoverage = opts.collectClient ? await readClientCoverageFromCache(opts) : []

  // Combine coverage (client first, then server)
  const allCoverage: Array<PlaywrightCoverageEntry | V8ServerCoverageEntry> = [
    ...clientCoverage,
    ...serverCoverage,
  ]

  if (allCoverage.length === 0) {
    log('  ⚠️ No coverage to process')
    if (opts.cleanup) {
      await cleanupCoverageFiles(opts, v8Collector)
    }
    return null
  }

  // Step 3: Process and generate reports
  try {
    const result = await processCoverageAndGenerateReports(allCoverage, opts)
    if (opts.cleanup) {
      await cleanupCoverageFiles(opts, v8Collector)
    }
    return result
  } catch (error) {
    console.error('❌ Error processing coverage:', error)
    if (opts.cleanup) {
      await cleanupCoverageFiles(opts, v8Collector)
    }
    return null
  }
}

export async function finalizeCoverage(
  options?: PlaywrightCoverageOptions | ResolvedNextcovConfig
): Promise<CoverageResult | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  log('\n✅ E2E tests complete')

  // Dispatch to dev or production mode based on whether devModeCollector was started
  if (devModeCollector !== null) {
    return finalizeDevModeCoverage(opts)
  } else {
    return finalizeProductionCoverage(opts)
  }
}

/**
 * Collect client-side coverage for a single test.
 *
 * This is a convenience wrapper for use in Playwright test fixtures.
 * It handles starting coverage, yielding control, then stopping and saving.
 * Only works with Chromium-based browsers.
 *
 * @example
 * ```typescript
 * // In test-fixtures.ts
 * import { test as base } from '@playwright/test'
 * import { collectClientCoverage } from 'nextcov/playwright'
 *
 * export const test = base.extend({
 *   coverage: [
 *     async ({ page }, use, testInfo) => {
 *       await collectClientCoverage(page, testInfo, use)
 *     },
 *     { scope: 'test', auto: true },
 *   ],
 * })
 * ```
 */
export async function collectClientCoverage(
  page: Page,
  testInfo: TestInfo,
  use: () => Promise<void>,
  config?: NextcovConfig
): Promise<void> {
  await page.coverage.startJSCoverage({ resetOnNavigation: false })

  await use()

  const jsCoverage = await page.coverage.stopJSCoverage()
  const appCoverage = filterAppCoverage(jsCoverage)

  if (appCoverage.length > 0) {
    const testId = `${testInfo.workerIndex}-${testInfo.testId.replace(/[^a-zA-Z0-9]/g, '-')}`
    // Derive cacheDir from outputDir if provided
    const cacheDir = config?.outputDir ? path.join(config.outputDir, '.cache') : undefined
    if (cacheDir) {
      // Create collector with explicit cacheDir to avoid singleton issues across worker processes
      const collector = new ClientCoverageCollector({ cacheDir })
      await collector.saveClientCoverage(testId, appCoverage)
    } else {
      await saveClientCoverage(testId, appCoverage)
    }
  }
}
