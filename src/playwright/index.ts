/**
 * Playwright Coverage Integration
 *
 * High-level functions for collecting and processing coverage in Playwright E2E tests.
 * Supports both production mode (external .map files) and dev mode (inline source maps).
 */

export {
  finalizeCoverage,
  collectClientCoverage,
  type PlaywrightCoverageOptions,
} from './fixture.js'
