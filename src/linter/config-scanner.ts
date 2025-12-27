/**
 * Config Scanner
 *
 * Scans project configuration for V8 coverage issues
 */

import { detectConfigIssues, type ConfigIssue } from './detectors/project-config.js'

export interface ConfigScanOptions {
  cwd?: string
}

export interface ConfigScanResult {
  issues: ConfigIssue[]
  errors: number
  warnings: number
  infos: number
}

/**
 * Scan project configuration for V8 coverage issues
 */
export function scanConfig(options: ConfigScanOptions = {}): ConfigScanResult {
  const { cwd = process.cwd() } = options
  const issues = detectConfigIssues(cwd)

  return {
    issues,
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    infos: issues.filter((i) => i.severity === 'info').length,
  }
}

export type { ConfigIssue }
