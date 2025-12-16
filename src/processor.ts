/**
 * Coverage Processor
 *
 * Main orchestrator that combines all components to process V8 coverage
 * and generate Istanbul-compatible reports.
 */

import { join, resolve } from 'node:path'
import { glob } from 'glob'
import { V8CoverageReader } from './v8-reader.js'
import { SourceMapLoader } from './sourcemap-loader.js'
import { CoverageConverter } from './converter.js'
import { IstanbulReporter } from './reporter.js'
import {
  DEFAULT_NEXTCOV_CONFIG,
  DEFAULT_REPORTERS,
  DEFAULT_INCLUDE_PATTERNS,
  COVERAGE_FINAL_JSON,
  normalizePath,
} from './config.js'
import type {
  CoverageOptions,
  CoverageResult,
  CoverageSummary,
} from './types.js'
import type { CoverageMap } from 'istanbul-lib-coverage'
import { log } from './logger.js'

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

    // Add uncovered source files if configured
    if (this.options.sourceRoot) {
      await this.addUncoveredFiles(mergedMap)
    }

    // Generate reports
    const summary = await this.reporter.generateReports(mergedMap)
    this.reporter.printSummary(summary)

    return {
      coverageMap: mergedMap,
      summary,
    }
  }

  /**
   * Add uncovered source files to coverage map
   */
  private async addUncoveredFiles(coverageMap: CoverageMap): Promise<void> {
    const includePatterns = this.options.include || DEFAULT_INCLUDE_PATTERNS
    const excludePatterns = this.options.exclude || []

    // Find all source files
    const sourceFiles: string[] = []
    for (const pattern of includePatterns) {
      const fullPattern = join(this.projectRoot, pattern).replace(/\\/g, '/')
      const ignorePatterns = excludePatterns.map((p) =>
        join(this.projectRoot, p).replace(/\\/g, '/')
      )
      const files = await glob(fullPattern, {
        ignore: ignorePatterns,
        absolute: true,
      })
      sourceFiles.push(...files)
    }

    // Filter out files already in coverage
    // Normalize paths to forward slashes for cross-platform comparison
    const coveredFiles = new Set(coverageMap.files().map(normalizePath))
    const uncoveredFiles = sourceFiles.filter((f) => !coveredFiles.has(normalizePath(f)))

    log(`Adding ${uncoveredFiles.length} source files for complete coverage...`)

    await this.converter.addUncoveredFiles(coverageMap, uncoveredFiles)
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

