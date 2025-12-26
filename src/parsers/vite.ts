/**
 * Vite URL and Path Parsing
 *
 * Handles Vite-specific URL patterns and source file detection.
 * Vite serves source files directly and transforms them on-the-fly,
 * using different URL conventions than webpack-based bundlers.
 */

/**
 * Vite's file system access prefix.
 * Used for accessing files outside the project root.
 */
export const VITE_FS_PREFIX = '/@fs/'

/**
 * Vite's internal module prefix.
 * Used for Vite's own runtime code.
 */
export const VITE_INTERNAL_PREFIX = '/@vite/'

/**
 * Vite's React Refresh prefix.
 * Used for HMR in React applications.
 */
export const VITE_REACT_REFRESH_PREFIX = '/@react-refresh'

/**
 * Check if a URL is a Vite app source file.
 * Vite serves source files directly from paths like /src/ or /@fs/
 * and transforms them on-the-fly.
 *
 * @example
 * isViteSourceUrl('/src/App.tsx')        // true
 * isViteSourceUrl('/@fs/home/user/lib')  // true
 * isViteSourceUrl('/@vite/client')       // false (internal)
 */
export function isViteSourceUrl(url: string): boolean {
  // Vite serves source files from /src/ path
  if (url.includes('/src/')) return true
  // Vite's file system access for dependencies
  if (url.includes(VITE_FS_PREFIX)) return true
  // Vite's internal modules (we typically exclude these)
  if (url.includes(VITE_INTERNAL_PREFIX)) return false
  // Vite's HMR client (exclude)
  if (url.includes(VITE_REACT_REFRESH_PREFIX)) return false
  return false
}

/**
 * Check if a URL is a Vite internal module (should be excluded from coverage).
 */
export function isViteInternalUrl(url: string): boolean {
  return (
    url.includes(VITE_INTERNAL_PREFIX) ||
    url.includes(VITE_REACT_REFRESH_PREFIX)
  )
}

/**
 * Extract the file path from a Vite /@fs/ URL.
 * Returns null if not a /@fs/ URL.
 *
 * @example
 * extractViteFsPath('/@fs/home/user/project/src/App.tsx')
 * // Returns: '/home/user/project/src/App.tsx'
 */
export function extractViteFsPath(url: string): string | null {
  const fsIndex = url.indexOf(VITE_FS_PREFIX)
  if (fsIndex === -1) return null
  return url.slice(fsIndex + VITE_FS_PREFIX.length - 1) // Keep leading /
}

/**
 * Normalize a Vite source path.
 * Handles /@fs/ prefixes and query strings.
 */
export function normalizeViteSourcePath(sourcePath: string): string {
  let path = sourcePath

  // Remove /@fs/ prefix if present
  if (path.includes(VITE_FS_PREFIX)) {
    const fsPath = extractViteFsPath(path)
    if (fsPath) path = fsPath
  }

  // Remove query string (Vite adds ?v=xxx for cache busting)
  const queryIndex = path.indexOf('?')
  if (queryIndex !== -1) {
    path = path.slice(0, queryIndex)
  }

  return path
}
