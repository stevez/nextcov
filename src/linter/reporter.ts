/**
 * Console Reporter
 *
 * Formats and prints scan results to the console
 */

import chalk from 'chalk'
import type { JsxIssue } from './detectors/jsx-patterns.js'
import type { ScanResult } from './scanner.js'
import type { ConfigScanResult, ConfigIssue } from './config-scanner.js'

export interface ReporterOptions {
  verbose?: boolean
  json?: boolean
}

const ISSUE_DESCRIPTIONS: Record<JsxIssue['type'], string> = {
  'jsx-ternary': 'JSX ternary operator (V8 cannot track branch coverage)',
  'jsx-logical-and': 'JSX logical AND (V8 cannot track branch coverage)',
}

/**
 * Group issues by file
 */
function groupIssuesByFile(issues: JsxIssue[]): Map<string, JsxIssue[]> {
  const grouped = new Map<string, JsxIssue[]>()

  for (const issue of issues) {
    const fileIssues = grouped.get(issue.file) || []
    fileIssues.push(issue)
    grouped.set(issue.file, fileIssues)
  }

  return grouped
}

/**
 * Print scan results in JSON format
 */
function printJsonReport(result: ScanResult): void {
  console.log(JSON.stringify(result, null, 2))
}

/**
 * Print scan results in human-readable format
 */
function printConsoleReport(result: ScanResult, options: ReporterOptions): void {
  const { verbose = false } = options
  const { issues, filesScanned, filesWithIssues } = result

  console.log('')
  console.log(chalk.bold('V8 Coverage Readiness Check'))
  console.log(chalk.gray('═'.repeat(60)))
  console.log('')

  if (issues.length === 0) {
    console.log(chalk.green('✓ No V8 coverage blind spots found!'))
    console.log('')
    console.log(chalk.dim(`Scanned ${filesScanned} files`))
    return
  }

  console.log(chalk.yellow.bold('V8 Coverage Blind Spots Found:'))
  console.log(chalk.gray('─'.repeat(60)))
  console.log('')

  const groupedIssues = groupIssuesByFile(issues)

  for (const [file, fileIssues] of groupedIssues) {
    for (const issue of fileIssues) {
      // File path with line:column (like ESLint)
      console.log(chalk.underline(`${file}:${issue.line}:${issue.column}`))
      // Warning message in yellow
      console.log(chalk.yellow(`  ⚠ ${ISSUE_DESCRIPTIONS[issue.type]}`))

      if (verbose && issue.code) {
        // Code snippet in bold
        console.log(chalk.bold(`    ${issue.code}`))
      }

      console.log('')
    }
  }

  console.log(chalk.gray('─'.repeat(60)))
  console.log(chalk.yellow(`Found ${issues.length} issue${issues.length === 1 ? '' : 's'} in ${filesWithIssues} file${filesWithIssues === 1 ? '' : 's'}`))
  console.log(chalk.dim(`Scanned ${filesScanned} files`))
  console.log('')
  console.log(chalk.dim('These patterns cannot be tracked by V8 coverage.'))
  console.log(chalk.dim('Consider extracting to separate components with if/else.'))
  console.log('')
  console.log(chalk.cyan('Learn more: https://github.com/stevez/nextcov#v8-coverage-limitations'))
  console.log('')
}

/**
 * Print scan results
 */
export function printReport(result: ScanResult, options: ReporterOptions = {}): void {
  if (options.json) {
    printJsonReport(result)
  } else {
    printConsoleReport(result, options)
  }
}

/**
 * Get exit code based on results
 */
export function getExitCode(result: ScanResult, ignorePatterns: boolean): number {
  if (ignorePatterns) {
    return 0
  }
  return result.issues.length > 0 ? 1 : 0
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
 * Get combined exit code based on both scan results
 */
export function getCombinedExitCode(
  codeResult: ScanResult | null,
  configResult: ConfigScanResult | null,
  ignorePatterns: boolean
): number {
  if (ignorePatterns) {
    return 0
  }
  const hasCodeIssues = codeResult && codeResult.issues.length > 0
  const hasConfigErrors = configResult && configResult.errors > 0
  return hasCodeIssues || hasConfigErrors ? 1 : 0
}
