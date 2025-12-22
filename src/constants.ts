/**
 * Internal constants for nextcov.
 *
 * These are implementation details tied to Next.js internals.
 * For user-configurable options, see config.ts.
 */

/**
 * URL patterns that indicate webpack dev mode scripts.
 * Dev mode uses eval-source-map which creates scripts with these URL patterns.
 */
export const WEBPACK_URL_PATTERNS = [
  'webpack-internal://',
  'webpack://',
  '(app-pages-browser)',
]

/**
 * Check if a URL matches any webpack dev mode pattern
 */
export function isWebpackUrl(url: string): boolean {
  return WEBPACK_URL_PATTERNS.some(pattern => url.includes(pattern))
}

/**
 * Regex to remove webpack:// prefix with app name
 * Matches: webpack://app-name/ or webpack://_N_E/ or webpack:/// (empty app name)
 */
export const WEBPACK_PREFIX_PATTERN = /^webpack:\/\/[^/]*\//

/**
 * Next.js internal prefix in source paths
 */
export const NEXTJS_INTERNAL_PREFIX = '_N_E/'

/**
 * Normalize a webpack source path to a relative path.
 * Handles webpack:// prefixes, _N_E/ prefixes, query strings, and leading ./
 */
export function normalizeWebpackSourcePath(sourcePath: string): string {
  let path = sourcePath

  // Remove webpack:// prefix (e.g., webpack://_N_E/, webpack://app/)
  path = path.replace(WEBPACK_PREFIX_PATTERN, '')

  // Remove _N_E/ prefix (Next.js internal) if still present
  if (path.startsWith(NEXTJS_INTERNAL_PREFIX)) {
    path = path.slice(NEXTJS_INTERNAL_PREFIX.length)
  }

  // Remove query string (e.g., ?xxxx)
  path = path.replace(/\?[^?]*$/, '')

  // Remove leading ./
  if (path.startsWith('./')) {
    path = path.slice(2)
  }

  // Handle URL-encoded paths
  path = decodeURIComponent(path)

  return path
}

/**
 * Subdirectories under .next/server/ that contain coverage-relevant files.
 * Used for filtering server-side coverage entries.
 */
export const SERVER_SUBDIRS = [
  'app',     // App Router (server components, API routes)
  'pages',   // Pages Router
  'chunks',  // Shared server code
  'src',     // Middleware
]

/**
 * Get server coverage patterns for a given build directory.
 * Returns paths like `.next/server/app`, `.next/server/pages`, etc.
 */
export function getServerPatterns(buildDir: string): string[] {
  return SERVER_SUBDIRS.map(dir => `${buildDir}/server/${dir}`)
}

/**
 * Check if a URL is a local file (not a Node builtin or remote URL)
 */
export function isLocalFileUrl(url: string): boolean {
  return url.startsWith('file:')
}

/**
 * Check if a URL is from node_modules
 */
export function isNodeModulesUrl(url: string): boolean {
  return url.includes('node_modules')
}

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

// Build data URL pattern parts separately to avoid Vite's source map scanner
// detecting our regex patterns as actual source maps (Windows Vite bug)
const DATA_PREFIX = 'data:'
const APP_JSON = 'application/json'
const CHARSET_OPT = '(?:charset=utf-8;)?'
const BASE64_SUFFIX = 'base64,'

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
 * Matches: //# sourceMappingURL=data:application/json;charset=utf-8;base64,<base64data>
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
 * Regex pattern to find Next.js chunk script URLs in HTML.
 * Matches paths like: _next/static/chunks/app/page.js
 */
export const NEXTJS_CHUNK_PATTERN = /_next\/static\/chunks\/[^"']+\.js/g

/**
 * Common Next.js dev mode chunk paths to always try fetching.
 * These are standard chunks that typically contain application code.
 */
export const COMMON_DEV_CHUNKS = [
  '_next/static/chunks/app/page.js',
  '_next/static/chunks/app/layout.js',
  '_next/static/chunks/main-app.js',
  '_next/static/chunks/webpack.js',
]

/**
 * Regex pattern to extract module path from webpack-internal URLs.
 * Example: webpack-internal:///(rsc)/./src/app/layout.tsx → ./src/app/layout.tsx
 * Capture group 1 contains the module path.
 */
export const WEBPACK_INTERNAL_MODULE_PATTERN = /webpack-internal:\/\/\/\([^)]+\)\/(.+)/

/**
 * Check if a path contains the source root directory.
 * Matches patterns like /src/ or /./src/ in webpack URLs.
 */
export function containsSourceRoot(path: string, sourceRoot: string): boolean {
  return (
    path.includes(`/${sourceRoot}/`) ||
    path.includes(`/./${sourceRoot}/`)
  )
}

/**
 * File URL protocol prefix.
 * Used when constructing or checking file:// URLs for local files.
 */
export const FILE_PROTOCOL = 'file://'

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
 * Next.js static assets path segment.
 * Used to identify and parse Next.js bundle URLs.
 */
export const NEXT_STATIC_PATH = '/_next/'

/**
 * Next.js static chunks path.
 * Client-side JavaScript bundles are served from this path.
 */
export const NEXT_STATIC_CHUNKS_PATH = '/_next/static/chunks/'

/**
 * Check if a URL contains Next.js static chunks path
 */
export function isNextChunksUrl(url: string): boolean {
  return url.includes(NEXT_STATIC_CHUNKS_PATH)
}

/**
 * Extract the path after /_next/ from a URL
 * Returns null if /_next/ is not found
 */
export function extractNextPath(url: string): string | null {
  const parts = url.split(NEXT_STATIC_PATH)
  return parts.length > 1 ? parts[1] : null
}

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
