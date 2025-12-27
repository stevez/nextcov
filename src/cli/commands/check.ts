/**
 * Check Command
 *
 * Scans codebase for V8 coverage blind spots and configuration issues
 */

import { scanFiles } from '@/linter/scanner.js'
import { scanConfig } from '@/linter/config-scanner.js'
import { printReport, printConfigReport, getCombinedExitCode } from '@/linter/reporter.js'

export interface CheckOptions {
  verbose?: boolean
  json?: boolean
  ignorePatterns?: boolean
  ignore?: string[]
  skipConfig?: boolean
}

export async function check(paths: string[], options: CheckOptions): Promise<number> {
  const { verbose = false, json = false, ignorePatterns = false, ignore = [], skipConfig = false } = options

  const cwd = process.cwd()
  const hasPaths = paths.length > 0

  try {
    let configResult = null
    let codeResult = null

    // Run config scan (unless --skip-config)
    if (!skipConfig) {
      configResult = scanConfig({ cwd })
      printConfigReport(configResult, { verbose, json })
    }

    // Run code scan only if paths are provided
    if (hasPaths) {
      codeResult = await scanFiles({
        paths,
        cwd,
        ignore,
      })
      printReport(codeResult, { verbose, json })
    }

    // If no paths and config skipped, nothing to do
    if (!hasPaths && skipConfig) {
      console.log('Nothing to check. Provide paths for source scanning or remove --skip-config.')
      return 0
    }

    // Return combined exit code
    return getCombinedExitCode(codeResult, configResult, ignorePatterns)
  } catch (error) {
    console.error('Error running check:', error)
    return 2
  }
}
