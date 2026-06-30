/**
 * Coverage Processor
 *
 * Main orchestrator that combines all components to process V8 coverage
 * and generate Istanbul-compatible reports.
 */

import { join, resolve } from 'node:path'
import { glob } from 'glob'
import libCoverage from 'istanbul-lib-coverage'
import { V8CoverageReader } from './v8-reader.js'
import { SourceMapLoader } from './sourcemap-loader.js'
import { CoverageConverter } from '@/converter/index.js'
import { IstanbulReporter } from './reporter.js'
import { rebaseOntoMap } from '@/merger/rebase.js'
import {
  DEFAULT_NEXTCOV_CONFIG,
  DEFAULT_REPORTERS,
  DEFAULT_INCLUDE_PATTERNS,
  COVERAGE_FINAL_JSON,
  isPathWithinBase,
} from '@/utils/config.js'
import type {
  CoverageOptions,
  CoverageResult,
  CoverageSummary,
} from '@/types.js'
import type { CoverageMap } from 'istanbul-lib-coverage'
import { log } from '@/utils/logger.js'

export class CoverageProcessor {
  private projectRoot: string
  private options: CoverageOptions
  private reader: V8CoverageReader
  private sourceMapLoader: SourceMapLoader
  private converter: CoverageConverter
  private reporter: IstanbulReporter

  constructor(projectRoot: string, options?: Partial<CoverageOptions>) {
    this.projectRoot = projectRoot
    this.options = {
      outputDir: DEFAULT_NEXTCOV_CONFIG.outputDir,
      reporters: DEFAULT_REPORTERS,
      ...options,
    }

    // Initialize components
    this.reader = new V8CoverageReader()
    this.sourceMapLoader = new SourceMapLoader(
      projectRoot,
      this.options.nextBuildDir ? join(projectRoot, this.options.nextBuildDir) : undefined
    )
    this.converter = new CoverageConverter(
      projectRoot,
      this.sourceMapLoader,
      undefined, // sourceFilter
      this.options.exclude || [] // excludePatterns for smart bundle skipping
    )
    this.reporter = new IstanbulReporter({
      outputDir: resolve(projectRoot, this.options.outputDir),
      projectRoot,
      reporters: this.options.reporters,
      watermarks: this.options.watermarks,
    })
  }

  /**
   * Process Playwright client coverage entries
   * This is the main method used in E2E tests
   */
  async processPlaywrightCoverage(
    coverage: Array<{ url: string; source?: string; functions: unknown[] }>
  ): Promise<CoverageMap> {
    log(`Processing ${coverage.length} Playwright coverage entries...`)

    const v8Coverage = this.reader.readFromPlaywright(coverage)
    const filtered = this.reader.filterEntries(v8Coverage)

    return this.converter.convert(filtered)
  }

  /**
   * Process all coverage (client + server) and generate reports
   *
   * @param coverage - Array of coverage entries from Playwright/CDP
   */
  async processAllCoverage(
    coverage?: Array<{ url: string; source?: string; functions: unknown[] }>
  ): Promise<CoverageResult> {
    let mergedMap = await this.reporter.mergeCoverageMaps()

    // Process coverage entries if provided
    if (coverage && coverage.length > 0) {
      log(`Processing ${coverage.length} Playwright coverage entries...`)
      const coverageMap = await this.processPlaywrightCoverage(coverage)
      mergedMap = await this.reporter.mergeCoverageMaps(mergedMap, coverageMap)
    }

    // Rebase E2E coverage onto the full source AST structure and fill in
    // uncovered files. Requires sourceRoot to be configured.
    //
    // Turbopack collapses AST nodes during compilation, so V8 coverage sees
    // fewer statements than the original source (e.g. 1315 vs 1771). Without
    // rebasing, E2E-only reports show inflated percentages because the
    // denominator is too small. We fix this here so the output is already
    // correct whether or not the user runs `nextcov merge` afterwards.
    if (this.options.sourceRoot) {
      mergedMap = await this.rebaseOntoSourceStructure(mergedMap)
    }

    // Generate reports
    const summary = await this.reporter.generateReports(mergedMap)

    return {
      coverageMap: mergedMap,
      summary,
    }
  }

  /**
   * Rebase E2E coverage onto the full source AST structure, then fill in
   * uncovered files with zero hit counts.
   *
   * For every source file, Babel parses the TypeScript/TSX (static analysis
   * only — no instrumentation) and ast-v8-to-istanbul derives the complete
   * statement/function/branch map with zero counts. This "zero map" has the
   * same rich granularity as Vitest/esbuild coverage.
   *
   * rebaseOntoMap then remaps E2E hit counts from the coarser Turbopack
   * structure onto the richer zero-map skeleton by matching line:col positions.
   *
   * Finally, the zero map is used as the base so that files the browser never
   * loaded appear in the report with zero counts (correct denominator).
   *
   * Babel parse cost is proportional to total source files, but runs once at
   * the end of the test suite and is I/O-bound, not CPU-bound.
   */
  private async rebaseOntoSourceStructure(coverageMap: CoverageMap): Promise<CoverageMap> {
    const includePatterns = this.options.include || DEFAULT_INCLUDE_PATTERNS
    const excludePatterns = this.options.exclude || []

    // Collect all source files
    const allSourceFiles: string[] = []
    for (const pattern of includePatterns) {
      const fullPattern = join(this.projectRoot, pattern).replace(/\\/g, '/')
      const ignorePatterns = excludePatterns.map((p) =>
        join(this.projectRoot, p).replace(/\\/g, '/')
      )
      const files = await glob(fullPattern, { ignore: ignorePatterns, absolute: true })
      allSourceFiles.push(...files)
    }
    // Path traversal protection
    const safeFiles = allSourceFiles.filter((f) => isPathWithinBase(f, this.projectRoot))

    // Build zero-count Istanbul map for all source files by parsing each file
    // with Babel. Babel is used here only as a TypeScript/JSX-capable parser —
    // it does not instrument or modify any code. The resulting zero map has the
    // full source-accurate statement granularity that Turbopack loses at compile time.
    const zeroMap = libCoverage.createCoverageMap({})
    await this.converter.addUncoveredFiles(zeroMap, safeFiles)

    log(`Built source structure for ${safeFiles.length} files`)

    // Treat E2E rebase as: merge zero-coverage base with E2E coverage.
    // This is the same pipeline as `nextcov merge` so statements, functions,
    // AND branches are all handled consistently.
    //
    // Use rebaseOntoMap: the zero map is ALWAYS the authoritative structure skeleton.
    // This avoids the isBabelQuality heuristic which breaks when esbuild produces
    // Infinity end.column values that JSON.stringify serializes to null, causing
    // rebaseCoarserMaps to incorrectly treat the zero map as non-babel-quality
    // and pick the Turbopack structure instead.
    // rebaseOntoMap already includes uncovered files (zero counts from structure),
    // so no further merge with zeroMap is needed.
    const merged = rebaseOntoMap(zeroMap, coverageMap)

    const uncoveredCount = safeFiles.length - coverageMap.files().length
    if (uncoveredCount > 0) {
      log(`   Added ${uncoveredCount} uncovered source files with zero counts`)
    }

    return merged
  }

  /**
   * Get coverage summary without generating reports
   */
  async getSummary(): Promise<CoverageSummary | null> {
    const jsonPath = join(this.projectRoot, this.options.outputDir, COVERAGE_FINAL_JSON)
    const coverageMap = await this.reporter.readCoverageJson(jsonPath)

    if (!coverageMap) return null

    return this.reporter.getSummary(coverageMap)
  }
}
