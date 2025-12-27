/**
 * nextcov - V8 to Istanbul Coverage Converter
 *
 * Public API for nextcov. Most users should import from 'nextcov/playwright' instead.
 * This module exports configuration utilities and advanced merging functions.
 *
 * For Playwright integration, use:
 *   import { initCoverage, finalizeCoverage } from 'nextcov/playwright'
 *
 * For merging coverage, use the CLI:
 *   npx nextcov merge coverage/unit coverage/e2e -o coverage/merged
 */

// ============================================================================
// Configuration
// ============================================================================
// These are primarily used for type definitions in playwright.config.ts
export {
  // Types
  type NextcovConfig,
  type ResolvedNextcovConfig,
  // Configuration utilities
  resolveNextcovConfig,
  loadNextcovConfig,
} from './utils/config.js'

// ============================================================================
// Advanced Coverage Merging API
// ============================================================================
// For users who need programmatic control over merging (most should use CLI)
export {
  mergeCoverage,
  printCoverageSummary,
  printCoverageComparison,
  type MergeCoverageOptions,
  type MergeCoverageResult,
} from './merger/index.js'

// ============================================================================
// Common Types
// ============================================================================
export type {
  V8Coverage,
  V8ScriptCoverage,
  SourceMapData,
  CoverageOptions,
  CoverageResult,
  CoverageSummary,
  CoverageMetric,
  ReporterType,
  Watermarks,
} from './types.js'
