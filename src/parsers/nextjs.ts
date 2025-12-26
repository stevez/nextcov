/**
 * Next.js URL and Path Parsing
 *
 * Handles Next.js-specific URL patterns, chunk paths, and server directory
 * structures. Supports both App Router and Pages Router conventions.
 */

/**
 * Next.js internal prefix in source paths.
 * Next.js uses _N_E as an internal identifier in webpack URLs.
 */
export const NEXTJS_INTERNAL_PREFIX = '_N_E/'

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
 * Check if a URL contains Next.js static chunks path
 */
export function isNextChunksUrl(url: string): boolean {
  return url.includes(NEXT_STATIC_CHUNKS_PATH)
}

/**
 * Extract the path after /_next/ from a URL.
 * Returns null if /_next/ is not found.
 *
 * @example
 * extractNextPath('http://localhost:3000/_next/static/chunks/app/page.js')
 * // Returns: 'static/chunks/app/page.js'
 */
export function extractNextPath(url: string): string | null {
  const parts = url.split(NEXT_STATIC_PATH)
  return parts.length > 1 ? parts[1] : null
}

/**
 * Get server coverage patterns for a given build directory.
 * Returns paths like `.next/server/app`, `.next/server/pages`, etc.
 */
export function getServerPatterns(buildDir: string): string[] {
  return SERVER_SUBDIRS.map(dir => `${buildDir}/server/${dir}`)
}

/**
 * Check if a path is a Next.js internal path (starts with _N_E/).
 */
export function isNextjsInternalPath(path: string): boolean {
  return path.startsWith(NEXTJS_INTERNAL_PREFIX)
}

/**
 * Remove Next.js internal prefix from a path.
 *
 * @example
 * stripNextjsPrefix('_N_E/src/app/page.tsx')
 * // Returns: 'src/app/page.tsx'
 */
export function stripNextjsPrefix(path: string): string {
  if (path.startsWith(NEXTJS_INTERNAL_PREFIX)) {
    return path.slice(NEXTJS_INTERNAL_PREFIX.length)
  }
  return path
}
