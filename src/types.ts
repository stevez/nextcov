/**
 * Type definitions for coverage processor
 */

import type { Profiler } from 'node:inspector'
import type { CoverageMap } from 'istanbul-lib-coverage'

/**
 * Raw V8 coverage format (from NODE_V8_COVERAGE or Playwright)
 */
export interface V8Coverage {
  result: V8ScriptCoverage[]
  timestamp?: number
  'source-map-cache'?: Record<string, SourceMapCacheEntry>
}

export interface V8ScriptCoverage {
  scriptId: string
  url: string
  functions: Profiler.FunctionCoverage[]
  // Optional source code (Playwright provides this)
  source?: string
}

/**
 * V8 script coverage with dev mode extensions
 * DevModeServerCollector attaches source map data and original path
 */
export interface DevModeV8ScriptCoverage extends V8ScriptCoverage {
  /** Pre-resolved source map data from dev mode collector */
  sourceMapData?: SourceMapData
  /** Original source file path (relative, e.g., "src/app/page.tsx") */
  originalPath?: string
}

export interface SourceMapCacheEntry {
  lineLengths: number[]
  data: SourceMapData
  url?: string
}

export interface SourceMapData {
  version: number
  sources: string[]
  sourcesContent?: (string | null)[]
  mappings: string
  names: string[]
  file?: string
  sourceRoot?: string
}

/**
 * Processed coverage ready for Istanbul
 */
export interface ProcessedCoverage {
  url: string
  code: string
  sourceMap?: SourceMapData
  functions: Profiler.FunctionCoverage[]
  startOffset?: number
}

/**
 * Coverage processor options
 */
export interface CoverageOptions {
  // Directory containing V8 coverage JSON files
  v8CoverageDir?: string

  // Next.js build directory
  nextBuildDir?: string

  // Output directory for reports
  outputDir: string

  // Source files root (for 'all' option)
  sourceRoot?: string

  // Include patterns for source files
  include?: string[]

  // Exclude patterns
  exclude?: string[]

  // Report formats to generate
  reporters?: ReporterType[]

  // Watermarks for coverage thresholds
  watermarks?: Watermarks
}

export type ReporterType = 'html' | 'lcov' | 'json' | 'text' | 'text-summary' | 'cobertura'

export interface Watermarks {
  statements?: [number, number]
  functions?: [number, number]
  branches?: [number, number]
  lines?: [number, number]
}

/**
 * Source file info for coverage mapping
 */
export interface SourceFile {
  path: string
  code: string
  sourceMap?: SourceMapData
}

/**
 * Coverage entry filter function
 */
export type EntryFilter = (entry: V8ScriptCoverage) => boolean

/**
 * Source path filter function
 */
export type SourceFilter = (sourcePath: string) => boolean

/**
 * Result from coverage processing
 */
export interface CoverageResult {
  coverageMap: CoverageMap
  summary: CoverageSummary
}

export interface CoverageSummary {
  statements: CoverageMetric
  branches: CoverageMetric
  functions: CoverageMetric
  lines: CoverageMetric
}

export interface CoverageMetric {
  total: number
  covered: number
  skipped: number
  pct: number
}

/**
 * Coverage merger configuration
 */
export interface MergerConfig {
  /** Merge strategy: 'max' uses maximum covered count, 'add' adds counts */
  strategy?: 'max' | 'add' | 'prefer-first' | 'prefer-last'
  /** When merging, prefer structure with more items */
  structurePreference?: 'first' | 'last' | 'more-items'
  /** Apply fixes like empty branch handling */
  applyFixes?: boolean
}

export interface MergeOptions extends MergerConfig {
  /** Path to the base coverage file (e.g., unit tests) */
  baseCoveragePath?: string
  // Note: Uses "more items wins" strategy - whichever source has more items for each metric type
}

export interface MergeResult {
  coverageMap: CoverageMap
  summary: CoverageSummary
  stats: {
    baseFiles: number
    additionalFiles: number
    mergedFiles: number
    newFiles: number
  }
}
