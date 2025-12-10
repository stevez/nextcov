/**
 * Coverage Collectors
 *
 * Provides utilities for collecting V8 coverage from Playwright tests:
 * - Client-side coverage from browser
 * - Server-side coverage via CDP
 * - Dev mode support with inline source map extraction
 */

export {
  // Client collector
  ClientCoverageCollector,
  createClientCollector,
  setDefaultCollectorConfig,
  initCoverageDir,
  saveClientCoverage,
  readAllClientCoverage,
  cleanCoverageDir,
  filterAppCoverage,
  type PlaywrightCoverageEntry,
  type ClientCollectorConfig,
} from './client.js'

export {
  // Server collector (production mode)
  ServerCoverageCollector,
  createServerCollector,
  connectToCDP,
  collectServerCoverage,
  saveServerCoverage,
  type V8CoverageEntry,
  type ServerCollectorConfig,
} from './server.js'

export {
  // Dev mode server collector
  DevModeServerCollector,
  createDevModeServerCollector,
  type DevServerCollectorConfig,
  type DevServerCoverageEntry,
  type ScriptInfo,
} from './dev-server.js'

export {
  // Auto-detect collector (tries both dev and production modes)
  autoDetectServerCollector,
  collectServerCoverageAutoDetect,
  startServerCoverageAutoDetect,
  stopServerCoverageAutoDetect,
  type AutoDetectConfig,
  type DetectionResult,
} from './auto-detect.js'
