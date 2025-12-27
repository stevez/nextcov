/**
 * Utility modules
 *
 * Common utilities used throughout the codebase
 */

// Configuration
export {
  type NextcovConfig,
  type ResolvedNextcovConfig,
  type DevModeOptions,
  type ResolvedDevModeOptions,
  resolveNextcovConfig,
  loadNextcovConfig,
  clearConfigCache,
  normalizePath,
  DEFAULT_NEXTCOV_CONFIG,
  DEFAULT_DEV_MODE_OPTIONS,
  DEFAULT_INCLUDE_PATTERNS,
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_REPORTERS,
  DEFAULT_WATERMARKS,
  COVERAGE_FINAL_JSON,
} from './config.js'

// Logging
export {
  log,
  warn,
  error,
  createTimer,
  formatError,
} from './logger.js'

// Constants
export {
  LARGE_BUNDLE_THRESHOLD,
  HEAVY_ENTRY_THRESHOLD,
  ENTRY_BATCH_SIZE,
  SOURCE_MAP_RANGE_THRESHOLD,
  SOURCE_MAP_PADDING_BEFORE,
  SOURCE_MAP_PADDING_AFTER,
  FILE_EXISTS_CACHE_MAX_SIZE,
} from './constants.js'

// Dev mode extractor
export {
  DevModeSourceMapExtractor,
  createDevModeExtractor,
  type ExtractedSourceMap,
  type DevModeConfig,
} from './dev-mode-extractor.js'
