/**
 * nextcov - V8 to Istanbul Coverage Converter
 *
 * A library for converting V8 coverage data to Istanbul format.
 * Supports Next.js, Playwright, and CDP-based coverage collection.
 */

// Configuration
export {
  // Types
  type NextcovConfig,
  type ResolvedNextcovConfig,
  type DevModeOptions,
  type ResolvedDevModeOptions,
  // Functions
  resolveNextcovConfig,
  loadNextcovConfig,
  clearConfigCache,
  normalizePath,
  // Defaults
  DEFAULT_NEXTCOV_CONFIG,
  DEFAULT_DEV_MODE_OPTIONS,
  DEFAULT_INCLUDE_PATTERNS,
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_REPORTERS,
  DEFAULT_WATERMARKS,
  COVERAGE_FINAL_JSON,
} from './config.js'

// Main processor
export { CoverageProcessor } from './processor.js'

// Supporting classes
export { V8CoverageReader } from './v8-reader.js'
export { SourceMapLoader } from './sourcemap-loader.js'
export { CoverageConverter } from './converter.js'
export { IstanbulReporter } from './reporter.js'

// Merger
export {
  CoverageMerger,
  createMerger,
  mergeCoverageMaps,
  mergeWithBaseCoverage,
  mergeCoverage,
  printCoverageSummary,
  printCoverageComparison,
  type MergeCoverageOptions,
  type MergeCoverageResult,
} from './merger.js'

// Collectors
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
  // Server collector (production mode)
  ServerCoverageCollector,
  createServerCollector,
  connectToCDP,
  collectServerCoverage,
  saveServerCoverage,
  type V8CoverageEntry,
  type ServerCollectorConfig,
  // Dev mode server collector
  DevModeServerCollector,
  createDevModeServerCollector,
  type DevServerCollectorConfig,
  type DevServerCoverageEntry,
  type ScriptInfo,
  // Auto-detect collector (tries both dev and production modes)
  startServerCoverageAutoDetect,
  stopServerCoverageAutoDetect,
  collectServerCoverageAutoDetect,
  type AutoDetectConfig,
} from './collector/index.js'

// Dev mode utilities
export {
  DevModeSourceMapExtractor,
  createDevModeExtractor,
  isDevMode,
  type ExtractedSourceMap,
  type DevModeConfig,
} from './dev-mode-extractor.js'

// Types
export type {
  V8Coverage,
  V8ScriptCoverage,
  SourceMapData,
  SourceFile,
  CoverageOptions,
  CoverageResult,
  CoverageSummary,
  CoverageMetric,
  ReporterType,
  Watermarks,
  EntryFilter,
  SourceFilter,
  MergerConfig,
  MergeOptions,
  MergeResult,
} from './types.js'
