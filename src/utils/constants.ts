/**
 * Internal constants for nextcov.
 *
 * This module contains processing thresholds, batch sizes, and cache limits.
 * For bundler-specific patterns (webpack, vite, nextjs), see src/parsers/.
 * For user-configurable options, see config.ts.
 */

// =============================================================================
// Processing Thresholds
// =============================================================================

/**
 * Threshold in bytes for considering a bundle "large" for optimization purposes.
 * Large server bundles (>300KB) that have >80% redundant sources are skipped.
 */
export const LARGE_BUNDLE_THRESHOLD = 300_000 // 300KB

/**
 * Threshold in bytes for considering an entry "heavy" and processing in worker thread.
 * Entries larger than 100KB are processed in parallel worker threads for better performance.
 */
export const HEAVY_ENTRY_THRESHOLD = 100_000 // 100KB

/**
 * Batch size for processing coverage entries on the main thread.
 * Light entries (<100KB) are processed in batches for memory efficiency.
 */
export const ENTRY_BATCH_SIZE = 20

/**
 * Batch size for file reading operations.
 * Files are read in batches to avoid overwhelming the filesystem.
 */
export const FILE_READ_BATCH_SIZE = 50

/**
 * Threshold in bytes for enabling source map range optimization.
 * Files larger than this will compute the source code range to skip
 * processing AST nodes outside where source code actually maps to.
 */
export const SOURCE_MAP_RANGE_THRESHOLD = 100_000 // 100KB

/**
 * Padding in bytes before the first source mapping.
 * Used when computing source code ranges to include some context.
 */
export const SOURCE_MAP_PADDING_BEFORE = 1000

/**
 * Padding in bytes after the last source mapping.
 * Used when computing source code ranges to include some context.
 */
export const SOURCE_MAP_PADDING_AFTER = 5000

// =============================================================================
// Cache Limits
// =============================================================================

/**
 * Maximum number of entries in the file exists cache.
 * Prevents unbounded memory growth in long-running processes.
 */
export const FILE_EXISTS_CACHE_MAX_SIZE = 10_000

/**
 * Maximum number of entries in the source map cache.
 * Each entry can be several KB, so we limit to prevent memory issues.
 */
export const SOURCE_MAP_CACHE_MAX_SIZE = 1_000

/**
 * Maximum number of entries in the source file cache.
 * Each entry contains source code which can be large.
 */
export const SOURCE_CACHE_MAX_SIZE = 500

// =============================================================================
// Istanbul Coverage Defaults
// =============================================================================

/**
 * Default source location used for implicit coverage items (branches, functions).
 * Used when adding placeholder entries for files with 0/0 branches or functions.
 */
export const DEFAULT_IMPLICIT_LOCATION = { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } }

/**
 * Default branch type for implicit branch entries.
 * Istanbul uses 'if' as a generic branch type.
 */
export const IMPLICIT_BRANCH_TYPE = 'if'
