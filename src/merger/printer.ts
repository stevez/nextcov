/**
 * Coverage Printer Functions
 *
 * Console output formatting for coverage summaries
 */

import type { CoverageSummary, CoverageMetric } from '@/types.js'
import { DEFAULT_WATERMARKS } from '@/utils/config.js'
import { log } from '@/utils/logger.js'

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
