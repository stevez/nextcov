/**
 * Bundler-Specific Parsers
 *
 * This module consolidates all bundler-specific URL patterns, path normalization,
 * and source map detection logic. Each bundler (webpack, Vite, Next.js) has its
 * own conventions for:
 *
 * - How paths appear in V8 coverage URLs
 * - Source map `sources` array format
 * - Handling of node_modules and internal files
 * - Dev mode vs production build differences
 *
 * By centralizing this logic, we make it easier to:
 * - Add support for new bundlers (Turbopack, esbuild, etc.)
 * - Debug bundler-specific issues
 * - Keep the core converter logic clean
 */

// Webpack parsing
export {
  WEBPACK_URL_PATTERNS,
  WEBPACK_PREFIX_PATTERN,
  WEBPACK_INTERNAL_MODULE_PATTERN,
  isWebpackUrl,
  normalizeWebpackSourcePath,
  extractWebpackModulePath,
  containsSourceRoot,
} from './webpack.js'

// Next.js parsing
export {
  NEXTJS_INTERNAL_PREFIX,
  NEXT_STATIC_PATH,
  NEXT_STATIC_CHUNKS_PATH,
  NEXTJS_CHUNK_PATTERN,
  COMMON_DEV_CHUNKS,
  SERVER_SUBDIRS,
  isNextChunksUrl,
  extractNextPath,
  getServerPatterns,
  isNextjsInternalPath,
  stripNextjsPrefix,
} from './nextjs.js'

// Vite parsing
export {
  VITE_FS_PREFIX,
  VITE_INTERNAL_PREFIX,
  VITE_REACT_REFRESH_PREFIX,
  isViteSourceUrl,
  isViteInternalUrl,
  extractViteFsPath,
  normalizeViteSourcePath,
} from './vite.js'

// Source map patterns
export {
  SOURCE_MAP_LOOKBACK_LIMIT,
  SOURCE_MAPPING_URL_PATTERN,
  INLINE_SOURCE_MAP_BASE64_PATTERN,
  DATA_URL_BASE64_PATTERN,
  INLINE_SOURCE_MAP_PATTERN,
  INLINE_SOURCE_MAP_PATTERN_GLOBAL,
  hasInlineSourceMap,
  hasSourceMappingUrl,
  extractSourceMappingUrl,
  isDataUrl,
} from './sourcemap.js'

// URL utilities
export {
  toFileUrl,
  isNodeModulesPath,
} from './url-utils.js'

// Re-export the combined check
import { isNextChunksUrl } from './nextjs.js'
import { isViteSourceUrl } from './vite.js'

/**
 * Check if a URL is an app source file (Next.js or Vite).
 * Used to filter coverage entries to only include application code.
 */
export function isAppSourceUrl(url: string): boolean {
  return isNextChunksUrl(url) || isViteSourceUrl(url)
}

/**
 * Check if a URL is a local file (not a Node builtin or remote URL).
 */
export function isLocalFileUrl(url: string): boolean {
  return url.startsWith('file:')
}

/**
 * Check if a URL is from node_modules.
 */
export function isNodeModulesUrl(url: string): boolean {
  return url.includes('node_modules')
}

/**
 * File URL protocol prefix.
 */
export const FILE_PROTOCOL = 'file://'
