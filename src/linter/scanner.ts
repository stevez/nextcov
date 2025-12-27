/**
 * File Scanner
 *
 * Scans directories for JavaScript/TypeScript files and analyzes them
 */

import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { glob } from 'glob'
import { detectJsxPatterns, type JsxIssue } from './detectors/jsx-patterns.js'

export interface ScanOptions {
  paths: string[]
  cwd?: string
  ignore?: string[]
}

export interface ScanResult {
  issues: JsxIssue[]
  filesScanned: number
  filesWithIssues: number
}

const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.next/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/coverage/**',
  '**/__tests__/**',
  '**/*.test.{js,jsx,ts,tsx}',
  '**/*.spec.{js,jsx,ts,tsx}',
]

/**
 * Scan files for V8 coverage issues
 */
export async function scanFiles(options: ScanOptions): Promise<ScanResult> {
  const { paths, cwd = process.cwd(), ignore = [] } = options
  const allIssues: JsxIssue[] = []
  const filesWithIssuesSet = new Set<string>()

  // Build glob patterns from paths
  const patterns = paths.map(p => {
    // If it's a specific file, use it as-is
    if (p.match(/\.(js|jsx|ts|tsx)$/)) {
      return p
    }
    // Otherwise treat as directory and scan for JS/TS files
    return `${p}/**/*.{js,jsx,ts,tsx}`.replace(/^\.\//, '')
  })

  // Find all JS/TS files
  const files = await glob(patterns, {
    cwd,
    ignore: [...DEFAULT_IGNORE_PATTERNS, ...ignore],
    absolute: false,
    nodir: true,
  })

  for (const file of files) {
    const filePath = join(cwd, file)
    // Normalize to forward slashes for consistent output across platforms
    const relativeFile = relative(cwd, filePath).replace(/\\/g, '/')

    try {
      const code = readFileSync(filePath, 'utf-8')
      const issues = detectJsxPatterns({ file: relativeFile, code })

      if (issues.length > 0) {
        allIssues.push(...issues)
        filesWithIssuesSet.add(relativeFile)
      }
    } catch (error) {
      // Skip files that can't be read
      continue
    }
  }

  return {
    issues: allIssues,
    filesScanned: files.length,
    filesWithIssues: filesWithIssuesSet.size,
  }
}
