/**
 * Console Reporter
 *
 * Formats and prints config scan results to the console
 */

import chalk from 'chalk'
import type { ConfigScanResult, ConfigIssue } from './config-scanner.js'

export interface ReporterOptions {
  verbose?: boolean
  json?: boolean
}

/**
 * Severity icons for config issues
 */
const SEVERITY_ICONS: Record<ConfigIssue['severity'], string> = {
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
}

/**
 * Print config scan results in JSON format
 */
function printConfigJsonReport(result: ConfigScanResult): void {
  console.log(JSON.stringify(result, null, 2))
}

/**
 * Print config scan results in human-readable format
 */
function printConfigConsoleReport(result: ConfigScanResult): void {
  console.log('')
  console.log(chalk.bold('Project Configuration:'))
  console.log(chalk.gray('─'.repeat(60)))

  if (result.issues.length === 0) {
    console.log(chalk.green('✓ No configuration issues found!'))
    console.log('')
    return
  }

  console.log('')

  for (const issue of result.issues) {
    const icon = SEVERITY_ICONS[issue.severity]
    const color =
      issue.severity === 'error' ? chalk.red : issue.severity === 'warning' ? chalk.yellow : chalk.blue
    console.log(color(`  ${icon} ${issue.message}`))
    if (issue.files?.length) {
      console.log(chalk.dim(`    ${issue.files.join(', ')}`))
    }
  }

  console.log('')
}

/**
 * Print config scan results
 */
export function printConfigReport(result: ConfigScanResult, options: ReporterOptions = {}): void {
  if (options.json) {
    printConfigJsonReport(result)
  } else {
    printConfigConsoleReport(result)
  }
}

/**
 * Get exit code based on config results
 */
export function getExitCode(configResult: ConfigScanResult | null): number {
  const hasConfigErrors = configResult && configResult.errors > 0
  return hasConfigErrors ? 1 : 0
}
