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
  type NextcovConfig,
  type ResolvedNextcovConfig,
  type ResolvedDevModeOptions,
} from '../config.js'
import {
  saveClientCoverage,
  filterAppCoverage,
  stopServerCoverageAutoDetect,
  ClientCoverageCollector,
  ServerCoverageCollector,
  type V8CoverageEntry,
  type PlaywrightCoverageEntry,
  type DevServerCoverageEntry,
} from '../collector/index.js'

export interface PlaywrightCoverageOptions {
  /** Project root directory (default: process.cwd()) */
  projectRoot?: string
  /** Output directory for coverage reports (default: './coverage/e2e') */
  outputDir?: string
  /** Next.js build directory (default: '.next') */
  buildDir?: string
  /** Source root relative to project root (default: './src') */
  sourceRoot?: string
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
}

const DEFAULT_OPTIONS: Required<PlaywrightCoverageOptions> = {
  projectRoot: process.cwd(),
  outputDir: DEFAULT_NEXTCOV_CONFIG.outputDir,
  buildDir: DEFAULT_NEXTCOV_CONFIG.buildDir,
  sourceRoot: DEFAULT_NEXTCOV_CONFIG.sourceRoot,
  include: DEFAULT_INCLUDE_PATTERNS,
  exclude: DEFAULT_EXCLUDE_PATTERNS,
  reporters: DEFAULT_REPORTERS,
  cleanup: true,
  collectServer: DEFAULT_NEXTCOV_CONFIG.collectServer,
  collectClient: DEFAULT_NEXTCOV_CONFIG.collectClient,
  devMode: DEFAULT_NEXTCOV_CONFIG.devMode,
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

  // Derive cacheDir from outputDir
  const cacheDir = (options as ResolvedNextcovConfig)?.cacheDir || path.join(opts.outputDir, '.cache')

  console.log('\n✅ E2E tests complete')

  // Step 1: Collect server-side coverage via CDP (before server shuts down)
  // Auto-detect dev vs production mode by probing CDP ports
  let serverCoverage: Array<V8CoverageEntry | DevServerCoverageEntry> = []
  let detectedDevMode = false

  if (opts.collectServer) {
    // Stop server coverage collection (started in global-setup via startServerCoverageAutoDetect)
    console.log('📊 Collecting server-side coverage...')
    const result = await stopServerCoverageAutoDetect()

    serverCoverage = result.entries
    detectedDevMode = result.isDevMode

    if (serverCoverage.length > 0) {
      console.log(`  ✓ Collected ${serverCoverage.length} server coverage entries`)
      if (detectedDevMode) {
        console.log('  Using inline source maps (dev mode)')
      }
    }
  }

  // Resolve buildDir: use .next for dev mode, otherwise use configured value
  const resolvedBuildDir = detectedDevMode ? '.next' : opts.buildDir

  // Create collectors with explicit config to avoid singleton issues
  const clientCollector = new ClientCoverageCollector({ cacheDir })
  const serverCollector = new ServerCoverageCollector({ cacheDir, buildDir: resolvedBuildDir })

  // Save server coverage for production mode (dev mode has inline source maps)
  if (!detectedDevMode && serverCoverage.length > 0) {
    await serverCollector.save(serverCoverage as V8CoverageEntry[])
  }

  // Step 2: Read client-side coverage collected during tests
  let clientCoverage: PlaywrightCoverageEntry[] = []
  if (opts.collectClient) {
    console.log('📊 Reading client-side coverage...')
    clientCoverage = await clientCollector.readAllClientCoverage()
    console.log(`  ✓ Found ${clientCoverage.length} client-side coverage entries`)
  }

  // Combine: client first, then server (matching original order)
  const allCoverage: Array<V8CoverageEntry | PlaywrightCoverageEntry | DevServerCoverageEntry> = [
    ...clientCoverage,
    ...serverCoverage,
  ]

  // Check if we have any coverage
  if (allCoverage.length === 0) {
    console.log('  ⚠️ No coverage to process')
    if (opts.cleanup) {
      await clientCollector.cleanCoverageDir()
    }
    return null
  }

  // Step 3: Process combined coverage
  console.log('📊 Processing coverage with ast-v8-to-istanbul...')

  try {
    const processor = new CoverageProcessor(opts.projectRoot, {
      outputDir: opts.outputDir,
      nextBuildDir: resolvedBuildDir,
      sourceRoot: opts.sourceRoot,
      include: opts.include,
      exclude: opts.exclude,
      reporters: opts.reporters,
    } as CoverageOptions)

    const result = await processor.processAllCoverage(allCoverage)

    console.log(`\n✅ Coverage reports generated at: ${path.resolve(opts.projectRoot, opts.outputDir)}`)
    if (result?.summary) {
      const linesPct = result.summary.lines?.pct?.toFixed(1) || '0.0'
      console.log(`   Overall coverage: ${linesPct}% lines`)
    }

    // Step 4: Clean up temporary coverage files
    if (opts.cleanup) {
      await clientCollector.cleanCoverageDir()
    }

    return result
  } catch (error) {
    console.error('❌ Error processing coverage:', error)
    if (opts.cleanup) {
      await clientCollector.cleanCoverageDir()
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
