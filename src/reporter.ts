/**
 * Istanbul Report Generator
 *
 * Generates coverage reports in various formats using Istanbul libraries.
 * Produces the same output format as Vitest's coverage reports.
 */

import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import libCoverage from 'istanbul-lib-coverage'
import libReport from 'istanbul-lib-report'
import reports from 'istanbul-reports'
import type { CoverageMap } from 'istanbul-lib-coverage'
import type { ReporterType, Watermarks, CoverageSummary, CoverageMetric } from './types.js'
import { DEFAULT_WATERMARKS, DEFAULT_REPORTERS, COVERAGE_FINAL_JSON } from './config.js'
import { log } from './logger.js'

export class IstanbulReporter {
  private outputDir: string
  private watermarks: Watermarks
  private reporters: ReporterType[]

  constructor(options: {
    outputDir: string
    projectRoot?: string
    watermarks?: Watermarks
    reporters?: ReporterType[]
  }) {
    this.outputDir = options.outputDir
    this.watermarks = options.watermarks || DEFAULT_WATERMARKS
    this.reporters = options.reporters || DEFAULT_REPORTERS
  }

  /**
   * Generate all configured reports
   */
  async generateReports(coverageMap: CoverageMap): Promise<CoverageSummary> {
    // Ensure output directory exists
    await fs.mkdir(this.outputDir, { recursive: true })

    // Create Istanbul report context
    const context = libReport.createContext({
      dir: this.outputDir,
      coverageMap,
      watermarks: this.watermarks,
    })

    // Generate each report type
    for (const reporter of this.reporters) {
      try {
        const reportCreator = reports.create(reporter)
        reportCreator.execute(context)
      } catch (error) {
        console.warn(`Failed to generate ${reporter} report:`, error)
      }
    }

    // Return summary
    return this.getSummary(coverageMap)
  }

  /**
   * Generate a single report type
   */
  async generateReport(coverageMap: CoverageMap, reporter: ReporterType): Promise<void> {
    await fs.mkdir(this.outputDir, { recursive: true })

    const context = libReport.createContext({
      dir: this.outputDir,
      coverageMap,
      watermarks: this.watermarks,
    })

    const reportCreator = reports.create(reporter)
    reportCreator.execute(context)
  }

  /**
   * Get coverage summary from coverage map
   */
  getSummary(coverageMap: CoverageMap): CoverageSummary {
    const summary = coverageMap.getCoverageSummary()

    return {
      statements: this.toMetric(summary.statements),
      branches: this.toMetric(summary.branches),
      functions: this.toMetric(summary.functions),
      lines: this.toMetric(summary.lines),
    }
  }

  /**
   * Convert Istanbul summary data to our metric format
   */
  private toMetric(data: { total: number; covered: number; skipped: number; pct: number }): CoverageMetric {
    return {
      total: data.total,
      covered: data.covered,
      skipped: data.skipped,
      pct: data.pct,
    }
  }

  /**
   * Print summary to console
   */
  printSummary(summary: CoverageSummary): void {
    log('\n' + '='.repeat(70))
    log('Coverage Summary')
    log('='.repeat(70))
    log(this.formatLine('Statements', summary.statements))
    log(this.formatLine('Branches', summary.branches))
    log(this.formatLine('Functions', summary.functions))
    log(this.formatLine('Lines', summary.lines))
    log('='.repeat(70) + '\n')
  }

  /**
   * Format a summary line with color based on watermarks
   */
  private formatLine(label: string, metric: CoverageMetric): string {
    // Handle case when pct is not a number (e.g., "Unknown" when total is 0)
    const pctValue = typeof metric.pct === 'number' ? metric.pct : 0
    const pct = pctValue.toFixed(2)
    const covered = `${metric.covered}/${metric.total}`
    const color = this.getColor(pctValue, label.toLowerCase() as keyof Watermarks)
    return `${label.padEnd(15)} | ${pct.padStart(7)}% | ${covered.padStart(12)} | ${color}`
  }

  /**
   * Get color indicator based on watermarks
   */
  private getColor(pct: number, type: keyof Watermarks): string {
    const [low, high] = this.watermarks[type] || [50, 80]

    if (pct >= high) return '✓ high'
    if (pct >= low) return '◐ medium'
    return '✗ low'
  }

  /**
   * Check if coverage meets thresholds
   */
  checkThresholds(
    summary: CoverageSummary,
    thresholds: Partial<Record<keyof CoverageSummary, number>>
  ): { passed: boolean; failures: string[] } {
    const failures: string[] = []

    for (const [key, threshold] of Object.entries(thresholds)) {
      const metric = summary[key as keyof CoverageSummary]
      if (metric && metric.pct < threshold) {
        failures.push(`${key}: ${metric.pct.toFixed(2)}% < ${threshold}%`)
      }
    }

    return {
      passed: failures.length === 0,
      failures,
    }
  }

  /**
   * Write coverage-final.json (Istanbul format)
   * This is the main file used for merging coverage
   */
  async writeCoverageJson(coverageMap: CoverageMap): Promise<string> {
    const filePath = join(this.outputDir, COVERAGE_FINAL_JSON)
    const data = coverageMap.toJSON()
    await fs.writeFile(filePath, JSON.stringify(data, null, 2))
    return filePath
  }

  /**
   * Read coverage-final.json and return coverage map
   */
  async readCoverageJson(filePath: string): Promise<CoverageMap | null> {
    if (!existsSync(filePath)) return null

    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const data = JSON.parse(content)
      const { createCoverageMap } = await import('istanbul-lib-coverage')
      return createCoverageMap(data)
    } catch {
      return null
    }
  }

  /**
   * Merge multiple coverage maps
   */
  async mergeCoverageMaps(...maps: CoverageMap[]): Promise<CoverageMap> {
    const merged = libCoverage.createCoverageMap({})

    for (const map of maps) {
      merged.merge(map)
    }

    return merged
  }
}
