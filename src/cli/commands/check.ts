/**
 * Check Command
 *
 * Scans project configuration for coverage-related issues
 */

import { scanConfig } from '@/linter/config-scanner.js'
import { printConfigReport, getExitCode } from '@/linter/reporter.js'

export interface CheckOptions {
  verbose?: boolean
  json?: boolean
}

export async function check(options: CheckOptions): Promise<number> {
  const { verbose = false, json = false } = options

  const cwd = process.cwd()

  try {
    const configResult = scanConfig({ cwd })
    printConfigReport(configResult, { verbose, json })

    return getExitCode(configResult)
  } catch (error) {
    console.error('Error running check:', error)
    return 2
  }
}
