/**
 * Check Command
 *
 * Scans codebase for V8 coverage blind spots
 */

import { scanFiles } from '@/linter/scanner.js'
import { printReport, getExitCode } from '@/linter/reporter.js'

export interface CheckOptions {
  verbose?: boolean
  json?: boolean
  ignorePatterns?: boolean
  ignore?: string[]
}

export async function check(paths: string[], options: CheckOptions): Promise<number> {
  const { verbose = false, json = false, ignorePatterns = false, ignore = [] } = options

  // Default to current directory if no paths provided
  const scanPaths = paths.length > 0 ? paths : ['.']

  try {
    // Scan files
    const result = await scanFiles({
      paths: scanPaths,
      cwd: process.cwd(),
      ignore,
    })

    // Print report
    printReport(result, { verbose, json })

    // Return exit code
    return getExitCode(result, ignorePatterns)
  } catch (error) {
    console.error('Error running check:', error)
    return 2
  }
}
