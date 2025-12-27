/**
 * Project Configuration Detector
 *
 * Detects project configuration issues that affect V8 coverage:
 * - Missing or outdated browserslist
 * - Babel detected (transpiles modern syntax)
 * - Jest detected (use Vitest instead)
 * - Playwright not found (required for nextcov)
 * - Source maps not enabled in next.config
 * - Vitest not found (recommended)
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type ConfigIssueType =
  | 'missing-browserslist'
  | 'browserslist-outdated'
  | 'babel-detected'
  | 'jest-detected'
  | 'vitest-not-found'
  | 'playwright-not-found'
  | 'sourcemaps-not-enabled'

export type ConfigIssueSeverity = 'error' | 'warning' | 'info'

export interface ConfigIssue {
  type: ConfigIssueType
  severity: ConfigIssueSeverity
  message: string
  files?: string[]
}

// Minimum browser versions (Next.js recommended, supports ?. and ??)
const MIN_BROWSER_VERSIONS: Record<string, number> = {
  chrome: 111,
  edge: 111,
  firefox: 111,
  safari: 16.4,
  ios_saf: 16.4,
  and_chr: 111,
  and_ff: 111,
}

/**
 * Parse package.json from a directory
 */
function readPackageJson(cwd: string): Record<string, unknown> | null {
  const packagePath = join(cwd, 'package.json')
  if (!existsSync(packagePath)) {
    return null
  }
  try {
    return JSON.parse(readFileSync(packagePath, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Check if browserslist is configured
 */
function checkBrowserslist(cwd: string, pkg: Record<string, unknown> | null): ConfigIssue | null {
  // Check package.json for browserslist field
  if (pkg?.browserslist) {
    return null
  }

  // Check for .browserslistrc file
  if (existsSync(join(cwd, '.browserslistrc'))) {
    return null
  }

  // Check for browserslist config file
  if (existsSync(join(cwd, 'browserslist'))) {
    return null
  }

  return {
    type: 'missing-browserslist',
    severity: 'warning',
    message: 'Missing browserslist - ?? and ?. operators may be transpiled, causing phantom branches',
  }
}

/**
 * Parse browser name and version from browserslist query result
 */
function parseBrowserVersion(browser: string): { name: string; version: number } | null {
  // Format is like "chrome 111", "safari 16.4", "ios_saf 16.4"
  const match = browser.match(/^([a-z_]+)\s+([\d.]+)$/i)
  if (!match) {
    return null
  }
  return {
    name: match[1].toLowerCase(),
    version: parseFloat(match[2]),
  }
}

/**
 * Check if browserslist targets modern enough browsers
 */
function checkBrowserslistVersions(cwd: string): ConfigIssue | null {
  try {
    // Dynamic import browserslist - it's a peer dependency
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const browserslist = require('browserslist')
    const browsers: string[] = browserslist(undefined, { path: cwd })

    const outdatedBrowsers: string[] = []

    for (const browser of browsers) {
      const parsed = parseBrowserVersion(browser)
      if (!parsed) continue

      const minVersion = MIN_BROWSER_VERSIONS[parsed.name]
      if (minVersion && parsed.version < minVersion) {
        outdatedBrowsers.push(`${parsed.name} ${parsed.version}`)
      }
    }

    if (outdatedBrowsers.length > 0) {
      return {
        type: 'browserslist-outdated',
        severity: 'error',
        message: `Browserslist targets outdated browsers that don't support ?? and ?.: ${outdatedBrowsers.join(', ')}`,
        files: [`Minimum required: chrome 111, edge 111, firefox 111, safari 16.4`],
      }
    }

    return null
  } catch {
    // browserslist not installed or error parsing - skip version check
    return null
  }
}

/**
 * Check for Babel configuration
 */
function checkBabel(cwd: string, pkg: Record<string, unknown> | null): ConfigIssue | null {
  const babelConfigFiles = [
    'babel.config.js',
    'babel.config.cjs',
    'babel.config.mjs',
    'babel.config.json',
    '.babelrc',
    '.babelrc.js',
    '.babelrc.cjs',
    '.babelrc.mjs',
    '.babelrc.json',
  ]

  const foundFiles: string[] = []

  for (const file of babelConfigFiles) {
    if (existsSync(join(cwd, file))) {
      foundFiles.push(file)
    }
  }

  // Check package.json for babel field
  if (pkg?.babel) {
    foundFiles.push('package.json (babel field)')
  }

  if (foundFiles.length > 0) {
    return {
      type: 'babel-detected',
      severity: 'error',
      message: 'Babel detected - may transpile modern syntax and break V8 coverage',
      files: foundFiles,
    }
  }

  return null
}

/**
 * Check for Jest configuration
 */
function checkJest(cwd: string, pkg: Record<string, unknown> | null): ConfigIssue | null {
  const jestConfigFiles = [
    'jest.config.js',
    'jest.config.cjs',
    'jest.config.mjs',
    'jest.config.ts',
    'jest.config.json',
  ]

  const foundFiles: string[] = []

  for (const file of jestConfigFiles) {
    if (existsSync(join(cwd, file))) {
      foundFiles.push(file)
    }
  }

  // Check package.json for jest field
  if (pkg?.jest) {
    foundFiles.push('package.json (jest field)')
  }

  if (foundFiles.length > 0) {
    return {
      type: 'jest-detected',
      severity: 'warning',
      message: 'Jest detected - consider using Vitest for better V8 coverage integration',
      files: foundFiles,
    }
  }

  return null
}

/**
 * Check if Playwright is installed
 */
function checkPlaywright(pkg: Record<string, unknown> | null): ConfigIssue | null {
  if (!pkg) {
    return {
      type: 'playwright-not-found',
      severity: 'error',
      message: 'Playwright not found - required for nextcov e2e coverage',
    }
  }

  const devDeps = (pkg.devDependencies || {}) as Record<string, string>
  const deps = (pkg.dependencies || {}) as Record<string, string>

  if (devDeps['@playwright/test'] || deps['@playwright/test'] || devDeps['playwright'] || deps['playwright']) {
    return null
  }

  return {
    type: 'playwright-not-found',
    severity: 'error',
    message: 'Playwright not found - required for nextcov e2e coverage',
  }
}

/**
 * Check if Vitest is installed
 */
function checkVitest(pkg: Record<string, unknown> | null): ConfigIssue | null {
  if (!pkg) {
    return {
      type: 'vitest-not-found',
      severity: 'info',
      message: 'Vitest not found in devDependencies - recommended for unit test coverage',
    }
  }

  const devDeps = (pkg.devDependencies || {}) as Record<string, string>

  if (devDeps['vitest']) {
    return null
  }

  return {
    type: 'vitest-not-found',
    severity: 'info',
    message: 'Vitest not found in devDependencies - recommended for unit test coverage',
  }
}

/**
 * Check if source maps are enabled in next.config
 */
function checkSourceMaps(cwd: string): ConfigIssue | null {
  const nextConfigFiles = ['next.config.ts', 'next.config.mjs', 'next.config.js']

  for (const file of nextConfigFiles) {
    const configPath = join(cwd, file)
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8')
        // Check if productionBrowserSourceMaps is set to true
        if (content.includes('productionBrowserSourceMaps') && content.includes('true')) {
          return null
        }
        return {
          type: 'sourcemaps-not-enabled',
          severity: 'warning',
          message: 'Source maps not enabled in next.config - add productionBrowserSourceMaps: true',
          files: [file],
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  // No next.config found - not a Next.js project or using defaults
  return null
}

/**
 * Detect all project configuration issues
 */
export function detectConfigIssues(cwd: string): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const pkg = readPackageJson(cwd)

  // Check browserslist (missing)
  const browserslistIssue = checkBrowserslist(cwd, pkg)
  if (browserslistIssue) {
    issues.push(browserslistIssue)
  } else {
    // Only check versions if browserslist exists
    const versionsIssue = checkBrowserslistVersions(cwd)
    if (versionsIssue) {
      issues.push(versionsIssue)
    }
  }

  // Check Babel
  const babelIssue = checkBabel(cwd, pkg)
  if (babelIssue) {
    issues.push(babelIssue)
  }

  // Check Playwright
  const playwrightIssue = checkPlaywright(pkg)
  if (playwrightIssue) {
    issues.push(playwrightIssue)
  }

  // Check Jest
  const jestIssue = checkJest(cwd, pkg)
  if (jestIssue) {
    issues.push(jestIssue)
  }

  // Check source maps
  const sourceMapsIssue = checkSourceMaps(cwd)
  if (sourceMapsIssue) {
    issues.push(sourceMapsIssue)
  }

  // Check Vitest
  const vitestIssue = checkVitest(pkg)
  if (vitestIssue) {
    issues.push(vitestIssue)
  }

  return issues
}
