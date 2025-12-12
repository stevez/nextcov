/**
 * Coverage Merger
 *
 * Merges coverage from multiple sources (unit tests, E2E tests)
 * while preserving coverage structures and handling different
 * instrumentation approaches.
 */

import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { relative } from 'node:path'
import libCoverage from 'istanbul-lib-coverage'
import type { CoverageMap, CoverageMapData, FileCoverageData } from 'istanbul-lib-coverage'
import type { MergerConfig, MergeOptions, MergeResult, CoverageSummary, CoverageMetric, ReporterType } from './types.js'
import { DEFAULT_REPORTERS, DEFAULT_WATERMARKS } from './config.js'
import { log } from './logger.js'

// Default configuration
const DEFAULT_MERGER_CONFIG: MergerConfig = {
  strategy: 'max',
  structurePreference: 'more-items',
  applyFixes: true,
}

/**
 * Coverage Merger Class
 */
export class CoverageMerger {
  private config: MergerConfig

  constructor(config?: Partial<MergerConfig>) {
    this.config = { ...DEFAULT_MERGER_CONFIG, ...config }
  }

  /**
   * Merge multiple coverage maps
   */
  async merge(...maps: CoverageMap[]): Promise<CoverageMap> {
    if (maps.length === 0) {
      return libCoverage.createCoverageMap({})
    }

    if (maps.length === 1) {
      const result = libCoverage.createCoverageMap({})
      result.merge(maps[0])
      if (this.config.applyFixes) {
        this.applyFixes(result)
      }
      return result
    }

    let merged: CoverageMap

    switch (this.config.strategy) {
      case 'add':
        merged = this.mergeAdd(maps)
        break
      case 'prefer-first':
        merged = this.mergePreferFirst(maps)
        break
      case 'prefer-last':
        merged = this.mergePreferLast(maps)
        break
      case 'max':
      default:
        merged = this.mergeMax(maps)
        break
    }

    if (this.config.applyFixes) {
      this.applyFixes(merged)
    }

    return merged
  }

  /**
   * Merge with a base coverage file (smart merge)
   */
  async mergeWithBase(
    additionalMap: CoverageMap,
    options: MergeOptions
  ): Promise<MergeResult> {
    const { baseCoveragePath } = options

    // Load base coverage
    const baseMap = baseCoveragePath
      ? await this.loadCoverageJson(baseCoveragePath)
      : null

    if (!baseMap) {
      log('No base coverage found, using additional coverage only')
      return {
        coverageMap: additionalMap,
        summary: this.getSummary(additionalMap),
        stats: {
          baseFiles: 0,
          additionalFiles: additionalMap.files().length,
          mergedFiles: additionalMap.files().length,
          newFiles: additionalMap.files().length,
        },
      }
    }

    const baseFiles = new Set(baseMap.files())
    const additionalFiles = additionalMap.files()

    // Build merged data
    const mergedData: CoverageMapData = {}

    // First, add all base coverage
    for (const file of baseFiles) {
      const baseData = baseMap.fileCoverageFor(file).toJSON()
      mergedData[file] = baseData as CoverageMapData[string]
    }

    // Then, process additional coverage
    let newFilesCount = 0
    for (const file of additionalFiles) {
      const additionalData = additionalMap.fileCoverageFor(file).toJSON()

      if (baseFiles.has(file)) {
        // File exists in both - merge execution counts
        // Use "more items wins" strategy: whichever source has more items for each metric
        mergedData[file] = this.mergeExecutionCounts(
          mergedData[file] as FileCoverageData,
          additionalData as FileCoverageData,
          false // preferBase = false to use "more items wins" strategy
        )
      } else if (!baseFiles.has(file)) {
        // File only in additional - add as-is
        mergedData[file] = additionalData as CoverageMapData[string]
        newFilesCount++
      }
    }

    // Create the coverage map
    const coverageMap = libCoverage.createCoverageMap(mergedData)

    // Apply fixes
    if (this.config.applyFixes) {
      this.applyFixes(coverageMap)
    }

    return {
      coverageMap,
      summary: this.getSummary(coverageMap),
      stats: {
        baseFiles: baseFiles.size,
        additionalFiles: additionalFiles.length,
        mergedFiles: coverageMap.files().length,
        newFiles: newFilesCount,
      },
    }
  }

  /**
   * Merge using max strategy (use max covered count for each metric)
   */
  private mergeMax(maps: CoverageMap[]): CoverageMap {
    const allFiles = new Set<string>()
    for (const map of maps) {
      for (const file of map.files()) {
        allFiles.add(file)
      }
    }

    const mergedData: CoverageMapData = {}

    for (const file of allFiles) {
      const fileCoverages = maps
        .filter((m) => m.files().includes(file))
        .map((m) => m.fileCoverageFor(file).toJSON() as FileCoverageData)

      if (fileCoverages.length === 1) {
        mergedData[file] = fileCoverages[0] as CoverageMapData[string]
      } else {
        // Find the coverage with most items for structure preference
        let bestStructure = fileCoverages[0]
        if (this.config.structurePreference === 'more-items') {
          bestStructure = fileCoverages.reduce((best, current) => {
            const bestItems =
              Object.keys(best.statementMap || {}).length +
              Object.keys(best.fnMap || {}).length +
              Object.keys(best.branchMap || {}).length
            const currentItems =
              Object.keys(current.statementMap || {}).length +
              Object.keys(current.fnMap || {}).length +
              Object.keys(current.branchMap || {}).length
            return currentItems > bestItems ? current : best
          })
        }

        // Merge all coverages into best structure
        let merged = JSON.parse(JSON.stringify(bestStructure)) as FileCoverageData
        for (const coverage of fileCoverages) {
          if (coverage !== bestStructure) {
            merged = this.mergeExecutionCounts(merged, coverage)
          }
        }
        mergedData[file] = merged as CoverageMapData[string]
      }
    }

    return libCoverage.createCoverageMap(mergedData)
  }

  /**
   * Merge using add strategy (add covered counts together)
   */
  private mergeAdd(maps: CoverageMap[]): CoverageMap {
    const merged = libCoverage.createCoverageMap({})
    for (const map of maps) {
      merged.merge(map)
    }
    return merged
  }

  /**
   * Merge preferring first map's structure
   */
  private mergePreferFirst(maps: CoverageMap[]): CoverageMap {
    const [first, ...rest] = maps
    const merged = libCoverage.createCoverageMap({})
    merged.merge(first)

    for (const map of rest) {
      for (const file of map.files()) {
        if (merged.files().includes(file)) {
          const baseData = merged.fileCoverageFor(file).toJSON() as FileCoverageData
          const additionalData = map.fileCoverageFor(file).toJSON() as FileCoverageData
          const mergedData = this.mergeExecutionCounts(baseData, additionalData)
          merged.addFileCoverage(mergedData as CoverageMapData[string])
        } else {
          merged.addFileCoverage(
            map.fileCoverageFor(file).toJSON() as CoverageMapData[string]
          )
        }
      }
    }

    return merged
  }

  /**
   * Merge preferring last map's structure
   */
  private mergePreferLast(maps: CoverageMap[]): CoverageMap {
    return this.mergePreferFirst([...maps].reverse())
  }

  /**
   * Merge execution counts from two file coverages
   * @param preferBase - If true, always use base structure; if false, use "more items wins" logic
   */
  private mergeExecutionCounts(
    base: FileCoverageData,
    additional: FileCoverageData,
    preferBase: boolean = false
  ): FileCoverageData {
    type Location = { start: { line: number; column: number | null } }
    type FnEntry = { loc: Location }
    type BranchEntry = { loc: Location }

    const locationKey = (loc: Location): string => `${loc.start.line}:${loc.start.column}`
    const lineKey = (loc: Location): number => loc.start.line

    // Build lookup maps
    const buildLookups = (data: FileCoverageData) => {
      const stmts = new Map<string, number>()
      const stmtsByLine = new Map<number, number>()
      for (const [key, loc] of Object.entries(data.statementMap || {}) as [string, Location][]) {
        const count = data.s[key] || 0
        if (count > 0) {
          stmts.set(locationKey(loc), count)
          const line = lineKey(loc)
          stmtsByLine.set(line, Math.max(stmtsByLine.get(line) || 0, count))
        }
      }

      const fns = new Map<string, number>()
      const fnsByLine = new Map<number, number>()
      for (const [key, fn] of Object.entries(data.fnMap || {}) as [string, FnEntry][]) {
        const count = data.f[key] || 0
        if (count > 0) {
          fns.set(locationKey(fn.loc), count)
          const line = lineKey(fn.loc)
          fnsByLine.set(line, Math.max(fnsByLine.get(line) || 0, count))
        }
      }

      const branches = new Map<string, number[]>()
      const branchesByLine = new Map<number, number[]>()
      for (const [key, branch] of Object.entries(data.branchMap || {}) as [string, BranchEntry][]) {
        const counts = data.b[key] || []
        if (counts.some((c: number) => c > 0)) {
          branches.set(locationKey(branch.loc), counts)
          const line = lineKey(branch.loc)
          if (!branchesByLine.has(line)) {
            branchesByLine.set(line, counts)
          }
        }
      }

      return { stmts, stmtsByLine, fns, fnsByLine, branches, branchesByLine }
    }

    const baseLookups = buildLookups(base)
    const additionalLookups = buildLookups(additional)

    // Clone base as result
    const merged: FileCoverageData = JSON.parse(JSON.stringify(base))

    // Determine which source structure to use
    // If preferBase is true, always use base structure
    // Otherwise, use "more items wins" logic
    const useAdditionalStatements = !preferBase &&
      Object.keys(additional.statementMap || {}).length >
      Object.keys(base.statementMap || {}).length
    const useAdditionalFunctions = !preferBase &&
      Object.keys(additional.fnMap || {}).length >
      Object.keys(base.fnMap || {}).length
    const useAdditionalBranches = !preferBase &&
      Object.keys(additional.branchMap || {}).length >
      Object.keys(base.branchMap || {}).length

    // Merge statements
    if (useAdditionalStatements) {
      merged.statementMap = JSON.parse(JSON.stringify(additional.statementMap))
      merged.s = JSON.parse(JSON.stringify(additional.s))
      for (const [key, loc] of Object.entries(merged.statementMap) as [string, Location][]) {
        const locKey = locationKey(loc)
        const line = lineKey(loc)
        const baseCount =
          baseLookups.stmts.get(locKey) ?? baseLookups.stmtsByLine.get(line)
        if (baseCount !== undefined && baseCount > 0) {
          merged.s[key] = Math.max(merged.s[key] || 0, baseCount)
        }
      }
    } else {
      for (const [key, loc] of Object.entries(merged.statementMap) as [string, Location][]) {
        const locKey = locationKey(loc)
        const line = lineKey(loc)
        const addCount =
          additionalLookups.stmts.get(locKey) ??
          additionalLookups.stmtsByLine.get(line)
        if (addCount !== undefined && addCount > 0) {
          merged.s[key] = Math.max(merged.s[key] || 0, addCount)
        }
      }
    }

    // Merge functions
    if (useAdditionalFunctions) {
      merged.fnMap = JSON.parse(JSON.stringify(additional.fnMap))
      merged.f = JSON.parse(JSON.stringify(additional.f))
      for (const [key, fn] of Object.entries(merged.fnMap) as [string, FnEntry][]) {
        const locKey = locationKey(fn.loc)
        const line = lineKey(fn.loc)
        const baseCount =
          baseLookups.fns.get(locKey) ?? baseLookups.fnsByLine.get(line)
        if (baseCount !== undefined && baseCount > 0) {
          merged.f[key] = Math.max(merged.f[key] || 0, baseCount)
        }
      }
    } else {
      for (const [key, fn] of Object.entries(merged.fnMap) as [string, FnEntry][]) {
        const locKey = locationKey(fn.loc)
        const line = lineKey(fn.loc)
        const addCount =
          additionalLookups.fns.get(locKey) ??
          additionalLookups.fnsByLine.get(line)
        if (addCount !== undefined && addCount > 0) {
          merged.f[key] = Math.max(merged.f[key] || 0, addCount)
        }
      }
    }

    // Merge branches
    if (useAdditionalBranches) {
      merged.branchMap = JSON.parse(JSON.stringify(additional.branchMap))
      merged.b = JSON.parse(JSON.stringify(additional.b))
      for (const [key, branch] of Object.entries(merged.branchMap) as [string, BranchEntry][]) {
        const locKey = locationKey(branch.loc)
        const line = lineKey(branch.loc)
        const baseCounts =
          baseLookups.branches.get(locKey) ??
          baseLookups.branchesByLine.get(line)
        if (baseCounts !== undefined) {
          merged.b[key] = merged.b[key].map((c: number, i: number) =>
            Math.max(c, baseCounts[i] || 0)
          )
        }
      }
    } else {
      for (const [key, branch] of Object.entries(merged.branchMap) as [string, BranchEntry][]) {
        const locKey = locationKey(branch.loc)
        const line = lineKey(branch.loc)
        const addCounts =
          additionalLookups.branches.get(locKey) ??
          additionalLookups.branchesByLine.get(line)
        if (addCounts !== undefined) {
          const baseCounts = merged.b[key] || []
          merged.b[key] = baseCounts.map((c: number, i: number) =>
            Math.max(c, addCounts[i] || 0)
          )
        }
      }
    }

    return merged
  }

  /**
   * Apply fixes to coverage map
   */
  private applyFixes(coverageMap: CoverageMap): void {
    this.fixEmptyBranches(coverageMap)
    this.fixEmptyFunctions(coverageMap)
  }

  /**
   * Fix files with 0/0 branches by adding implicit branch
   */
  private fixEmptyBranches(coverageMap: CoverageMap): void {
    for (const filePath of coverageMap.files()) {
      const fileCoverage = coverageMap.fileCoverageFor(filePath)
      const data = fileCoverage.toJSON() as {
        branchMap: Record<string, unknown>
        b: Record<string, number[]>
        s: Record<string, number>
        f: Record<string, number>
      }

      const hasBranches = Object.keys(data.branchMap).length > 0

      if (!hasBranches) {
        const anyStatementCovered = Object.values(data.s).some((c) => c > 0)
        const anyFunctionCovered = Object.values(data.f).some((c) => c > 0)
        const wasLoaded = anyStatementCovered || anyFunctionCovered

        data.branchMap = {
          '0': {
            type: 'if',
            loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
            locations: [
              { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
            ],
          },
        }
        data.b = { '0': wasLoaded ? [1] : [0] }

        // Update the coverage map with the fixed data
        coverageMap.addFileCoverage(data as CoverageMapData[string])
      }
    }
  }

  /**
   * Fix files with 0/0 functions by adding implicit function
   * This prevents misleading "100% Functions 0/0" display in coverage reports
   */
  private fixEmptyFunctions(coverageMap: CoverageMap): void {
    for (const filePath of coverageMap.files()) {
      const fileCoverage = coverageMap.fileCoverageFor(filePath)
      const data = fileCoverage.toJSON() as {
        fnMap: Record<string, unknown>
        f: Record<string, number>
        s: Record<string, number>
        b: Record<string, number[]>
      }

      const hasFunctions = Object.keys(data.fnMap).length > 0

      if (!hasFunctions) {
        // Check if any statement or branch was covered (indicates module was loaded)
        const anyStatementCovered = Object.values(data.s).some((c) => c > 0)
        const anyBranchCovered = Object.values(data.b).some((counts) =>
          counts.some((c) => c > 0)
        )
        const wasLoaded = anyStatementCovered || anyBranchCovered

        // Add implicit "module initialization" function
        data.fnMap = {
          '0': {
            name: '(module)',
            decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
            loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
            line: 1,
          },
        }
        data.f = { '0': wasLoaded ? 1 : 0 }

        // Update the coverage map with the fixed data
        coverageMap.addFileCoverage(data as CoverageMapData[string])
      }
    }
  }

  /**
   * Load coverage from JSON file
   */
  async loadCoverageJson(filePath: string): Promise<CoverageMap | null> {
    if (!existsSync(filePath)) {
      return null
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const data = JSON.parse(content)
      return libCoverage.createCoverageMap(data)
    } catch {
      return null
    }
  }

  /**
   * Get coverage summary
   */
  getSummary(coverageMap: CoverageMap): CoverageSummary {
    const summary = coverageMap.getCoverageSummary()

    const toMetric = (data: {
      total: number
      covered: number
      skipped: number
      pct: number
    }): CoverageMetric => ({
      total: data.total,
      covered: data.covered,
      skipped: data.skipped,
      pct: typeof data.pct === 'number' ? data.pct : 0,
    })

    return {
      statements: toMetric(summary.statements),
      branches: toMetric(summary.branches),
      functions: toMetric(summary.functions),
      lines: toMetric(summary.lines),
    }
  }
}

/**
 * Create a coverage merger
 */
export function createMerger(config?: Partial<MergerConfig>): CoverageMerger {
  return new CoverageMerger(config)
}

/**
 * Simple merge of multiple coverage maps
 */
export async function mergeCoverageMaps(
  ...maps: CoverageMap[]
): Promise<CoverageMap> {
  const merger = createMerger()
  return merger.merge(...maps)
}

/**
 * Merge coverage with a base file
 */
export async function mergeWithBaseCoverage(
  additionalMap: CoverageMap,
  baseCoveragePath: string,
  options?: Partial<MergeOptions>
): Promise<MergeResult> {
  const merger = createMerger(options)
  return merger.mergeWithBase(additionalMap, {
    baseCoveragePath,
    ...options,
  })
}

/**
 * Options for the high-level mergeCoverage function
 */
export interface MergeCoverageOptions {
  /** Path to unit test coverage-final.json */
  unitCoveragePath: string
  /** Path to E2E coverage-final.json */
  e2eCoveragePath: string
  /** Output directory for merged reports */
  outputDir: string
  /** Reporters to generate (default: DEFAULT_REPORTERS) */
  reporters?: ReporterType[]
  /** Project root for relative path display */
  projectRoot?: string
  /** Print detailed output */
  verbose?: boolean
}

/**
 * Result from mergeCoverage function
 */
export interface MergeCoverageResult {
  /** The merged coverage map */
  coverageMap: CoverageMap
  /** Summary of merged coverage */
  summary: CoverageSummary
  /** Merge statistics */
  stats: {
    baseFiles: number
    additionalFiles: number
    mergedFiles: number
    newFiles: number
  }
  /** Unit test summary (if available) */
  unitSummary?: CoverageSummary
  /** E2E test summary */
  e2eSummary: CoverageSummary
  /** Files only covered by E2E tests */
  e2eOnlyFiles: string[]
}

/**
 * High-level function to merge unit and E2E coverage
 *
 * This function provides a complete workflow for:
 * - Loading unit and E2E coverage files
 * - Merging them using the "more items wins" strategy
 * - Generating coverage reports (html, lcov, json, text-summary)
 * - Returning detailed statistics and summaries
 *
 * @example
 * ```typescript
 * import { mergeCoverage } from 'nextcov'
 *
 * const result = await mergeCoverage({
 *   unitCoveragePath: 'coverage/unit/coverage-final.json',
 *   e2eCoveragePath: 'coverage/e2e/coverage-final.json',
 *   outputDir: 'coverage/merged',
 *   verbose: true,
 * })
 *
 * if (result) {
 *   log(`Merged ${result.stats.mergedFiles} files`)
 *   log(`Lines: ${result.summary.lines.pct}%`)
 * }
 * ```
 */
export async function mergeCoverage(options: MergeCoverageOptions): Promise<MergeCoverageResult | null> {
  const {
    unitCoveragePath,
    e2eCoveragePath,
    outputDir,
    reporters = DEFAULT_REPORTERS,
    projectRoot = process.cwd(),
    verbose = false,
  } = options

  // Import report libraries dynamically to avoid bundling issues
  const libReport = await import('istanbul-lib-report')
  const reports = await import('istanbul-reports')

  const verboseLog = (msg: string) => {
    if (verbose) log(msg)
  }

  verboseLog('Merging coverage reports...\n')

  // Create merger instance
  const merger = createMerger({ applyFixes: true })

  // Load E2E coverage
  const e2eCoverageMap = await merger.loadCoverageJson(e2eCoveragePath)
  if (!e2eCoverageMap) {
    console.error(`E2E coverage not found at: ${e2eCoveragePath}`)
    return null
  }

  verboseLog(`  Loaded e2e coverage: ${e2eCoverageMap.files().length} files`)

  const e2eSummary = merger.getSummary(e2eCoverageMap)

  // Check for unit coverage
  if (!existsSync(unitCoveragePath)) {
    verboseLog('  No unit test coverage found, using e2e only')

    // Generate reports for E2E only
    await generateReports(e2eCoverageMap, outputDir, reporters, libReport.default, reports.default)

    return {
      coverageMap: e2eCoverageMap,
      summary: e2eSummary,
      stats: {
        baseFiles: 0,
        additionalFiles: e2eCoverageMap.files().length,
        mergedFiles: e2eCoverageMap.files().length,
        newFiles: e2eCoverageMap.files().length,
      },
      e2eSummary,
      e2eOnlyFiles: e2eCoverageMap.files().map((f: string) => relativePath(projectRoot, f)),
    }
  }

  // Smart merge using "more items wins" strategy
  verboseLog('  Found unit test coverage, performing smart merge...')

  const mergeResult = await merger.mergeWithBase(e2eCoverageMap, {
    baseCoveragePath: unitCoveragePath,
  })

  verboseLog(`  Merged coverage: ${mergeResult.coverageMap.files().length} files`)
  verboseLog(`    - Base (unit) files: ${mergeResult.stats.baseFiles}`)
  verboseLog(`    - Additional (e2e) files: ${mergeResult.stats.additionalFiles}`)
  verboseLog(`    - New files from e2e: ${mergeResult.stats.newFiles}`)

  // Generate reports
  await generateReports(mergeResult.coverageMap, outputDir, reporters, libReport.default, reports.default)
  verboseLog(`\nCoverage reports generated at: ${outputDir}`)

  // Load unit coverage for comparison
  const unitCoverageMap = await merger.loadCoverageJson(unitCoveragePath)
  const unitSummary = unitCoverageMap ? merger.getSummary(unitCoverageMap) : undefined

  // Find E2E-only files
  const unitFiles = unitCoverageMap ? new Set(unitCoverageMap.files()) : new Set<string>()
  const e2eOnlyFiles = e2eCoverageMap.files()
    .filter((f: string) => !unitFiles.has(f))
    .map((f: string) => relativePath(projectRoot, f))

  return {
    coverageMap: mergeResult.coverageMap,
    summary: mergeResult.summary,
    stats: mergeResult.stats,
    unitSummary,
    e2eSummary,
    e2eOnlyFiles,
  }
}

/**
 * Generate Istanbul reports
 */
async function generateReports(
  coverageMap: CoverageMap,
  outputDir: string,
  reporters: ReporterType[],
  libReport: typeof import('istanbul-lib-report'),
  reports: typeof import('istanbul-reports')
): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true })

  const context = libReport.createContext({
    dir: outputDir,
    coverageMap,
    watermarks: DEFAULT_WATERMARKS,
  })

  for (const reporter of reporters) {
    try {
      const reportCreator = reports.create(reporter)
      reportCreator.execute(context)
    } catch (error) {
      console.warn(`Failed to generate ${reporter} report:`, error)
    }
  }
}

/**
 * Get relative path from project root
 */
function relativePath(projectRoot: string, filePath: string): string {
  return relative(projectRoot, filePath)
}

/**
 * Print coverage summary table to console
 */
export function printCoverageSummary(summary: CoverageSummary, title: string = 'Coverage Summary'): void {
  log('\n' + '='.repeat(70))
  log(title)
  log('='.repeat(70))

  const [lowThreshold, highThreshold] = DEFAULT_WATERMARKS.lines ?? [50, 80]
  const formatLine = (label: string, data: CoverageMetric) => {
    const pct = data.pct.toFixed(2)
    const covered = `${data.covered}/${data.total}`
    const status = data.pct >= highThreshold ? '✓ high' : data.pct >= lowThreshold ? '◐ medium' : '✗ low'
    return `${label.padEnd(15)} | ${pct.padStart(7)}% | ${covered.padStart(12)} | ${status}`
  }

  log(formatLine('Statements', summary.statements))
  log(formatLine('Branches', summary.branches))
  log(formatLine('Functions', summary.functions))
  log(formatLine('Lines', summary.lines))
  log('='.repeat(70) + '\n')
}

/**
 * Print comparison table of unit, E2E, and merged coverage
 */
export function printCoverageComparison(
  unit: CoverageSummary | undefined,
  e2e: CoverageSummary,
  merged: CoverageSummary
): void {
  log('\nVerification (Unit vs E2E vs Merged):')
  log('')
  log('                    Unit Tests          E2E Tests           Merged')
  log('  ─────────────────────────────────────────────────────────────────────')

  const formatMetric = (
    name: string,
    unitMetric: CoverageMetric | undefined,
    e2eMetric: CoverageMetric,
    mergedMetric: CoverageMetric
  ) => {
    const unitStr = unitMetric
      ? `${unitMetric.covered}/${unitMetric.total} (${unitMetric.pct.toFixed(1)}%)`
      : 'N/A'
    const e2eStr = `${e2eMetric.covered}/${e2eMetric.total} (${e2eMetric.pct.toFixed(1)}%)`
    const mergedStr = `${mergedMetric.covered}/${mergedMetric.total} (${mergedMetric.pct.toFixed(1)}%)`
    return `  ${name.padEnd(12)} ${unitStr.padStart(18)}  ${e2eStr.padStart(18)}  ${mergedStr.padStart(18)}`
  }

  log(formatMetric('Statements', unit?.statements, e2e.statements, merged.statements))
  log(formatMetric('Branches', unit?.branches, e2e.branches, merged.branches))
  log(formatMetric('Functions', unit?.functions, e2e.functions, merged.functions))
  log(formatMetric('Lines', unit?.lines, e2e.lines, merged.lines))
}
