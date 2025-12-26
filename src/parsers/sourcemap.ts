/**
 * Source Map Pattern Matching
 *
 * Regular expressions and utilities for detecting and extracting
 * source maps from JavaScript bundles. Supports both inline (base64)
 * and external (.map file) source maps.
 */

// Build data URL pattern parts separately to avoid Vite's source map scanner
// detecting our regex patterns as actual source maps (Windows Vite bug)
const DATA_PREFIX = 'data:'
const APP_JSON = 'application/json'
const CHARSET_OPT = '(?:charset=utf-8;)?'
const BASE64_SUFFIX = 'base64,'

/**
 * Maximum characters to look back when extracting code before a source map comment.
 * This limits memory usage when parsing large webpack bundles.
 */
export const SOURCE_MAP_LOOKBACK_LIMIT = 10000

/**
 * Regex pattern to extract sourceMappingURL from code comments.
 * Matches both //# and //@ formats (older spec used @).
 * Captures the URL/path after the equals sign.
 */
export const SOURCE_MAPPING_URL_PATTERN = /\/\/[#@]\s*sourceMappingURL=(.+)$/m

/**
 * Regex pattern to extract inline base64 source map from code comments.
 * Matches data URLs with optional charset specification.
 * Captures the base64-encoded content.
 */
export const INLINE_SOURCE_MAP_BASE64_PATTERN = new RegExp(
  `\\/\\/[#@]\\s*sourceMappingURL=${DATA_PREFIX}${APP_JSON};${CHARSET_OPT}${BASE64_SUFFIX}(.+)$`,
  'm'
)

/**
 * Regex pattern to parse a base64 data URL directly.
 * Used when the data URL has already been extracted from a sourceMappingURL comment.
 * Captures the base64-encoded content.
 */
export const DATA_URL_BASE64_PATTERN = new RegExp(
  `^${DATA_PREFIX}${APP_JSON};${CHARSET_OPT}${BASE64_SUFFIX}(.+)$`
)

/**
 * Regex pattern to find inline base64 source map DataURLs.
 * Matches inline source maps with base64-encoded JSON content.
 */
export const INLINE_SOURCE_MAP_PATTERN = new RegExp(
  `sourceMappingURL=${DATA_PREFIX}${APP_JSON}[^,]*,([A-Za-z0-9+/=]+)`
)

/**
 * Global regex pattern for finding all inline source maps in a chunk.
 */
export const INLINE_SOURCE_MAP_PATTERN_GLOBAL = new RegExp(
  `sourceMappingURL=${DATA_PREFIX}${APP_JSON};charset=utf-8;${BASE64_SUFFIX}([A-Za-z0-9+/=]+)`,
  'g'
)

/**
 * Check if a string contains an inline source map.
 */
export function hasInlineSourceMap(code: string): boolean {
  return INLINE_SOURCE_MAP_BASE64_PATTERN.test(code)
}

/**
 * Check if a string contains a sourceMappingURL comment (inline or external).
 */
export function hasSourceMappingUrl(code: string): boolean {
  return SOURCE_MAPPING_URL_PATTERN.test(code)
}

/**
 * Extract the sourceMappingURL value from code.
 * Returns null if not found.
 */
export function extractSourceMappingUrl(code: string): string | null {
  const match = code.match(SOURCE_MAPPING_URL_PATTERN)
  return match ? match[1].trim() : null
}

/**
 * Check if a sourceMappingURL is a data URL (inline).
 */
export function isDataUrl(url: string): boolean {
  return url.startsWith(DATA_PREFIX)
}
