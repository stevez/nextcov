/**
 * URL and Path Utilities
 *
 * Shared helper functions for converting between file paths and URLs,
 * and common path checks used across the codebase.
 */

import { join } from 'node:path'

/**
 * Convert a file path to a proper file:// URL
 *
 * @example
 * toFileUrl('C:\\Users\\dev\\project\\src\\app.ts')
 * // Returns: 'file:///C:/Users/dev/project/src/app.ts'
 *
 * toFileUrl('/home/user/project/src/app.ts')
 * // Returns: 'file:///home/user/project/src/app.ts'
 */
export function toFileUrl(filePath: string, projectRoot?: string): string {
  // Already a file:// URL
  if (filePath.startsWith('file://')) {
    return filePath
  }

  // Windows absolute path (e.g., C:\Users\...)
  if (/^[a-zA-Z]:/.test(filePath)) {
    // Convert to file:///C:/Users/... format
    return `file:///${filePath.replace(/\\/g, '/')}`
  }

  // Unix absolute path
  if (filePath.startsWith('/')) {
    return `file://${filePath}`
  }

  // Relative path - make it absolute first if projectRoot provided
  if (projectRoot) {
    const absolutePath = join(projectRoot, filePath)
    // Normalize backslashes to forward slashes for consistent file:// URLs
    const normalizedPath = absolutePath.replace(/\\/g, '/')

    // Windows absolute path (e.g., C:/Users/...)
    if (/^[a-zA-Z]:/.test(normalizedPath)) {
      return `file:///${normalizedPath}`
    }
    // Unix absolute path (e.g., /home/user/...) - already starts with /
    return `file://${normalizedPath}`
  }

  // If no projectRoot, just prefix with file://
  return `file://${filePath}`
}

/**
 * Check if a path contains node_modules.
 * More flexible than isNodeModulesUrl as it works with any path string.
 *
 * @example
 * isNodeModulesPath('/home/user/project/node_modules/lodash/index.js')
 * // Returns: true
 *
 * isNodeModulesPath('src/app/page.tsx')
 * // Returns: false
 */
export function isNodeModulesPath(path: string): boolean {
  return path.includes('node_modules/') || path.includes('node_modules\\')
}
