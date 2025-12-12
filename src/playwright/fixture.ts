/**
 * Playwright Coverage Fixture
 *
 * High-level functions for collecting and processing coverage in Playwright E2E tests.
 * Supports both production mode (external .map files) and dev mode (inline source maps).
 */

import * as path from 'path'
import type { Page, TestInfo } from '@playwright/test'
import { CoverageProcessor } from '../processor.js'
import type { CoverageOptions, CoverageResult, ReporterType } from '../types.js'
import {
  DEFAULT_NEXTCOV_CONFIG,
  DEFAULT_INCLUDE_PATTERNS,
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_REPORTERS,
  resolveNextcovConfig,
  type NextcovConfig,
  type ResolvedNextcovConfig,
  type ResolvedDevModeOptions,
} from '../config.js'
import {
  saveClientCoverage,
  filterAppCoverage,
  ClientCoverageCollector,
  V8ServerCoverageCollector,
  DevModeServerCollector,
  type V8CoverageEntry,
  type PlaywrightCoverageEntry,
  type DevServerCoverageEntry,
  type V8ServerCoverageEntry,
} from '../collector/index.js'
import { log, setLogging } from '../logger.js'

// Module-level collector for persisting between globalSetup and globalTeardown
let devModeCollector: DevModeServerCollector | null = null
// Track if dev mode was detected (to force .next as buildDir)
let isDevMode = false

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
  /** Whether to collect server coverage (default: true) */
  collectServer?: boolean
  /** Whether to collect client coverage (default: true) */
  collectClient?: boolean
  /** Dev mode options (auto-detected by default) */
  devMode?: ResolvedDevModeOptions
  /** CDP port for triggering v8.takeCoverage() (default: 9230) */
  cdpPort?: number
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
  collectServer: DEFAULT_NEXTCOV_CONFIG.collectServer,
  collectClient: DEFAULT_NEXTCOV_CONFIG.collectClient,
  devMode: DEFAULT_NEXTCOV_CONFIG.devMode,
  cdpPort: DEFAULT_NEXTCOV_CONFIG.cdpPort,
}

/**
 * Start server-side coverage collection in dev mode.
 *
 * Call this function in globalSetup BEFORE any tests run.
 * This ensures the V8 Profiler is started before any server code executes
 * during page requests.
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

  // Initialize logging from config
  setLogging(resolved.log)

  // Auto-detect dev mode vs production mode:
  // - Dev mode: next dev --inspect=9230 spawns worker on port 9231 (inspect port + 1)
  // - Production mode: next start --inspect=9230 runs on port 9230 (no worker)
  //
  // The user configures cdpPort to the inspect port (e.g., 9230).
  // We try cdpPort + 1 first (dev worker). If successful, it's dev mode.
  // If the connection fails, production mode will use cdpPort directly.
  const devWorkerPort = resolved.cdpPort + 1 // e.g., 9231 (worker port for --inspect=9230)
  const productionPort = resolved.cdpPort // e.g., 9230 (main process port)

  log('📊 Auto-detecting server mode...')
  log(`  Trying dev mode (worker port ${devWorkerPort})...`)

  // Try dev mode (connect to worker port)
  devModeCollector = new DevModeServerCollector({
    cdpPort: devWorkerPort,
    sourceRoot: resolved.sourceRoot.replace(/^\.\//, ''),
  })

  const devConnected = await devModeCollector.connect()
  if (devConnected) {
    // On cold starts, webpack hasn't compiled anything yet.
    // Make a warmup request to trigger compilation, then wait for scriptParsed events.
    const startTime = Date.now()

    // Trigger webpack compilation with a warmup request
    // This must complete before we check for scripts, as it triggers the compilation
    log('  Triggering webpack compilation with warmup request...')
    try {
      await fetch('http://localhost:3000/')
      log('  ✓ Warmup request completed')
    } catch {
      log('  ⚠️ Warmup request failed (server may not be ready)')
    }

    // Now check if webpack scripts are available
    // After the warmup request, scripts should already be parsed
    const foundWebpack = await devModeCollector.waitForWebpackScripts(5000)

    if (foundWebpack) {
      isDevMode = true
      const waitedMs = Date.now() - startTime
      log(`  ✓ Dev mode detected (webpack scripts found after ${waitedMs}ms)`)
      log('  ✓ Server coverage collection started')
      return true
    }

    // Connected but no webpack scripts after timeout - this is production mode
    log(`  ℹ️ Connected to port ${devWorkerPort} but no webpack eval scripts found`)
    log(`  ℹ️ This appears to be production mode, not dev mode`)
    // Disconnect and fall through to production mode
    await devModeCollector.disconnect()
    devModeCollector = null
  }

  // Dev worker port not available or no webpack scripts - production mode will be used
  devModeCollector = null
  isDevMode = false
  log(`  ℹ️ Production mode will be used (NODE_V8_COVERAGE + port ${productionPort})`)
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
export async function finalizeCoverage(
  options?: PlaywrightCoverageOptions | ResolvedNextcovConfig
): Promise<CoverageResult | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // In dev mode, Next.js always uses .next as the build directory
  // regardless of what's configured (buildDir config is for production builds)
  if (isDevMode) {
    opts.buildDir = '.next'
  }

  // Derive cacheDir from outputDir
  const cacheDir = (options as ResolvedNextcovConfig)?.cacheDir || path.join(opts.outputDir, '.cache')

  log('\n✅ E2E tests complete')

  // Step 1: Collect server-side coverage via CDP (before server shuts down)
  let serverCoverage: Array<V8CoverageEntry | DevServerCoverageEntry | V8ServerCoverageEntry> = []

  let v8Collector: V8ServerCoverageCollector | null = null
  // Use module-level devModeCollector if started in globalSetup
  let localDevModeCollector: DevModeServerCollector | null = devModeCollector

  if (opts.collectServer) {
    // Auto-detect: If devModeCollector was started in globalSetup, use dev mode
    if (localDevModeCollector) {
      // Dev mode: collector was started in globalSetup
      log('📊 Collecting server-side coverage (dev mode)...')
      serverCoverage = await localDevModeCollector.collect()
      if (serverCoverage.length > 0) {
        log(`  ✓ Collected ${serverCoverage.length} server coverage entries (dev mode)`)
      }
      // Clear module-level references
      devModeCollector = null
      isDevMode = false
    } else {
      // Production mode: Use NODE_V8_COVERAGE + CDP trigger approach
      // Production mode uses cdpPort directly (e.g., 9230)
      // because next start runs on the main process at the inspect port
      const productionPort = opts.cdpPort
      log('📊 Collecting server-side coverage (production mode)...')
      v8Collector = new V8ServerCoverageCollector({
        cdpPort: productionPort,
        buildDir: opts.buildDir,
        sourceRoot: opts.sourceRoot,
        v8CoverageDir: opts.v8CoverageDir,
      })

      const connected = await v8Collector.connect()
      if (connected) {
        serverCoverage = await v8Collector.collect()
        if (serverCoverage.length > 0) {
          log(`  ✓ Collected ${serverCoverage.length} server coverage entries (production mode)`)
        }
      }
    }
  }

  // Create client collector for reading client-side coverage files
  const clientCollector = new ClientCoverageCollector({ cacheDir })

  // Step 2: Read client-side coverage collected during tests
  let clientCoverage: PlaywrightCoverageEntry[] = []
  if (opts.collectClient) {
    log('📊 Reading client-side coverage...')
    clientCoverage = await clientCollector.readAllClientCoverage()
    log(`  ✓ Found ${clientCoverage.length} client-side coverage entries`)
  }

  // Combine: client first, then server (matching original order)
  const allCoverage: Array<V8CoverageEntry | PlaywrightCoverageEntry | DevServerCoverageEntry> = [
    ...clientCoverage,
    ...serverCoverage,
  ]

  // Check if we have any coverage
  if (allCoverage.length === 0) {
    log('  ⚠️ No coverage to process')
    if (opts.cleanup) {
      await clientCollector.cleanCoverageDir()
      // Clean up V8 coverage directory
      if (v8Collector) {
        await v8Collector.cleanup()
      }
    }
    return null
  }

  // Step 3: Process combined coverage
  log('📊 Processing coverage with ast-v8-to-istanbul...')

  try {
    const processor = new CoverageProcessor(opts.projectRoot, {
      outputDir: opts.outputDir,
      nextBuildDir: opts.buildDir,
      sourceRoot: opts.sourceRoot,
      include: opts.include,
      exclude: opts.exclude,
      reporters: opts.reporters,
    } as CoverageOptions)

    const result = await processor.processAllCoverage(allCoverage)

    log(`\n✅ Coverage reports generated at: ${path.resolve(opts.projectRoot, opts.outputDir)}`)
    if (result?.summary) {
      const linesPct = result.summary.lines?.pct?.toFixed(1) || '0.0'
      log(`   Overall coverage: ${linesPct}% lines`)
    }

    // Step 4: Clean up temporary coverage files
    if (opts.cleanup) {
      await clientCollector.cleanCoverageDir()
      // Clean up V8 coverage directory
      if (v8Collector) {
        await v8Collector.cleanup()
      }
    }

    return result
  } catch (error) {
    console.error('❌ Error processing coverage:', error)
    if (opts.cleanup) {
      await clientCollector.cleanCoverageDir()
      // Clean up V8 coverage directory even on error
      if (v8Collector) {
        await v8Collector.cleanup()
      }
    }
    return null
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
    // Derive cacheDir from outputDir in config
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
