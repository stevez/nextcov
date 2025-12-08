/**
 * V8 Coverage Reader
 *
 * Reads V8 coverage data from:
 * 1. NODE_V8_COVERAGE directory (server-side coverage)
 * 2. Playwright coverage API (client-side coverage)
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { mergeProcessCovs } from '@bcoe/v8-coverage'
import type { V8Coverage, V8ScriptCoverage, EntryFilter } from './types.js'
import { normalizePath } from './config.js'

const DEFAULT_EXCLUDE_PATTERNS = [
  '/node_modules/',
  'node:',
  '__vitest__',
  '__playwright__',
]

export class V8CoverageReader {
  private excludePatterns: (string | RegExp)[]

  constructor(excludePatterns: (string | RegExp)[] = DEFAULT_EXCLUDE_PATTERNS) {
    this.excludePatterns = excludePatterns
  }

  /**
   * Read all V8 coverage files from a directory
   */
  async readFromDirectory(dir: string): Promise<V8Coverage> {
    const files = await fs.readdir(dir)
    const coverageFiles = files.filter((f) => f.startsWith('coverage-') && f.endsWith('.json'))

    if (coverageFiles.length === 0) {
      console.warn(`No coverage files found in ${dir}`)
      return { result: [] }
    }

    let merged: V8Coverage = { result: [] }

    for (const file of coverageFiles) {
      const filePath = join(dir, file)
      const content = await fs.readFile(filePath, 'utf-8')
      const coverage: V8Coverage = JSON.parse(content)

      // Merge coverage data
      merged = mergeProcessCovs([merged, coverage]) as V8Coverage

      // Preserve source-map-cache from the first file that has it
      if (coverage['source-map-cache'] && !merged['source-map-cache']) {
        merged['source-map-cache'] = coverage['source-map-cache']
      }
    }

    return merged
  }

  /**
   * Read coverage from Playwright format
   * Playwright returns an array of { url, source?, functions } objects
   */
  readFromPlaywright(coverage: Array<{ url: string; source?: string; functions: unknown[] }>): V8Coverage {
    const result: V8ScriptCoverage[] = coverage.map((entry, index) => ({
      scriptId: String(index),
      url: entry.url,
      functions: entry.functions as V8ScriptCoverage['functions'],
      source: entry.source,
    }))

    return { result }
  }

  /**
   * Filter coverage entries based on URL patterns
   */
  filterEntries(coverage: V8Coverage, customFilter?: EntryFilter): V8Coverage {
    const filtered = coverage.result.filter((entry) => {
      // Apply default exclusions
      for (const pattern of this.excludePatterns) {
        if (typeof pattern === 'string') {
          if (entry.url.includes(pattern)) return false
        } else if (pattern.test(entry.url)) {
          return false
        }
      }

      // Apply custom filter if provided
      if (customFilter && !customFilter(entry)) {
        return false
      }

      return true
    })

    return {
      ...coverage,
      result: filtered,
    }
  }

  /**
   * Filter to only include Next.js app code
   */
  filterNextJsAppCode(coverage: V8Coverage): V8Coverage {
    return this.filterEntries(coverage, (entry) => {
      // Normalize for cross-platform matching
      const url = normalizePath(entry.url)

      // Include Next.js server chunks
      if (url.includes('.next/server/')) return true

      // Include Next.js static chunks (client-side)
      if (url.includes('_next/static/chunks/')) return true

      // Include source files directly
      if (url.includes('/src/')) return true

      return false
    })
  }

  /**
   * Merge multiple V8 coverage objects
   */
  merge(...coverages: V8Coverage[]): V8Coverage {
    if (coverages.length === 0) return { result: [] }
    if (coverages.length === 1) return coverages[0]

    let merged = coverages[0]
    for (let i = 1; i < coverages.length; i++) {
      merged = mergeProcessCovs([merged, coverages[i]]) as V8Coverage
    }

    return merged
  }

  /**
   * Get unique source URLs from coverage
   */
  getSourceUrls(coverage: V8Coverage): string[] {
    return Array.from(new Set(coverage.result.map((entry) => entry.url)))
  }

  /**
   * Get coverage statistics
   */
  getStats(coverage: V8Coverage): { total: number; filtered: number; urls: string[] } {
    return {
      total: coverage.result.length,
      filtered: coverage.result.length,
      urls: this.getSourceUrls(coverage),
    }
  }
}
