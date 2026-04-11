/**
 * Playwright Coverage Integration
 *
 * High-level functions for collecting and processing coverage in Playwright E2E tests.
 * Supports both production mode (external .map files) and dev mode (inline source maps).
 */

export {
  finalizeCoverage,
  initCoverage,
  startServerCoverage,
  collectClientCoverage,
  resetCoverageState,
  type PlaywrightCoverageOptions,
} from './fixture.js'

// Re-export client coverage utilities for custom collection workflows
export { saveClientCoverage, filterAppCoverage } from '@/collector/client.js'

// Re-export in-process V8 collector for same-process coverage
export { InProcessV8Collector, createInProcessCollector, type InProcessCoverageEntry, type InProcessCollectorConfig } from '@/collector/in-process.js'

// Re-export loadNextcovConfig for convenience
export { loadNextcovConfig, resolveNextcovConfig } from '@/utils/config.js'
