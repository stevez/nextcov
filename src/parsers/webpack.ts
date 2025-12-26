/**
 * Webpack URL and Source Map Parsing
 *
 * Handles webpack-specific URL patterns, source path normalization,
 * and module path extraction. Used for both dev mode (webpack-internal://)
 * and production builds (webpack://).
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
 * Regex pattern to extract module path from webpack-internal URLs.
 * Example: webpack-internal:///(rsc)/./src/app/layout.tsx → ./src/app/layout.tsx
 * Capture group 1 contains the module path.
 */
export const WEBPACK_INTERNAL_MODULE_PATTERN = /webpack-internal:\/\/\/\([^)]+\)\/(.+)/

/**
 * Normalize a webpack source path to a relative path.
 * Handles webpack:// prefixes, _N_E/ prefixes, query strings, and leading ./
 *
 * @example
 * normalizeWebpackSourcePath('webpack://_N_E/./src/app/page.tsx?xxxx')
 * // Returns: 'src/app/page.tsx'
 */
export function normalizeWebpackSourcePath(sourcePath: string): string {
  let path = sourcePath

  // Remove webpack:// prefix (e.g., webpack://_N_E/, webpack://app/)
  path = path.replace(WEBPACK_PREFIX_PATTERN, '')

  // Remove _N_E/ prefix (Next.js internal) if still present
  if (path.startsWith('_N_E/')) {
    path = path.slice('_N_E/'.length)
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
 * Extract module path from webpack-internal URL.
 * Returns null if not a webpack-internal URL.
 *
 * @example
 * extractWebpackModulePath('webpack-internal:///(rsc)/./src/app/layout.tsx')
 * // Returns: './src/app/layout.tsx'
 */
export function extractWebpackModulePath(url: string): string | null {
  const match = url.match(WEBPACK_INTERNAL_MODULE_PATTERN)
  return match ? match[1] : null
}

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
