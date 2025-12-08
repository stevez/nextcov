/**
 * Coverage Collectors
 *
 * Provides utilities for collecting V8 coverage from Playwright tests:
 * - Client-side coverage from browser
 * - Server-side coverage via CDP
 */

export {
  // Client collector
  ClientCoverageCollector,
  createClientCollector,
  initCoverageDir,
  saveClientCoverage,
  readAllClientCoverage,
  cleanCoverageDir,
  filterAppCoverage,
  type PlaywrightCoverageEntry,
  type ClientCollectorConfig,
} from './client.js'

export {
  // Server collector
  ServerCoverageCollector,
  createServerCollector,
  connectToCDP,
  collectServerCoverage,
  saveServerCoverage,
  type V8CoverageEntry,
  type ServerCollectorConfig,
} from './server.js'
