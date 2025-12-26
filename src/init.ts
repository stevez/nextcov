/**
 * nextcov init command
 *
 * Scaffolds the initial setup for nextcov in a Next.js + Playwright project.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { input, select, confirm } from '@inquirer/prompts'
import { execSync } from 'child_process'

export const INIT_HELP = `
Usage: npx nextcov init [options]

Initialize nextcov in your Next.js + Playwright project.

This command will:
  - Create e2e/global-setup.ts (start server coverage collection) [Full mode only]
  - Create e2e/global-teardown.ts (finalize coverage and generate reports)
  - Create e2e/fixtures/test-fixtures.ts (coverage collection fixture)
  - Add nextcov config to playwright.config.ts (or .js)
  - Add npm scripts for running e2e tests with coverage

Options:
  -y, --yes             Skip prompts and use defaults
  --e2e-dir <dir>       E2E test directory (default: e2e)
  --js                  Use JavaScript instead of TypeScript
  --client-only         Client-only mode (no server coverage, simpler setup)
  --force               Overwrite existing files
  --help                Show this help message

Examples:
  npx nextcov init                 # Interactive mode
  npx nextcov init -y              # Use defaults, no prompts
  npx nextcov init --client-only   # Client-only mode (no --inspect needed)
  npx nextcov init --js
  npx nextcov init --e2e-dir tests
  npx nextcov init --force
`

export interface InitOptions {
  e2eDir: string
  force: boolean
  typescript: boolean
  interactive: boolean
  mergeCoverage: boolean
  /** When true, only client-side coverage is collected (no server coverage) */
  collectServer: boolean
}

export interface InitParseResult {
  options?: InitOptions
  error?: string
  showHelp?: boolean
}

export function parseInitArgs(args: string[]): InitParseResult {
  if (args.includes('--help') || args.includes('-h')) {
    return { showHelp: true }
  }

  let e2eDir = 'e2e'
  let force = false
  let typescript = true // default to TypeScript
  let interactive = true // default to interactive
  let mergeCoverage = true // default to including merge script
  let collectServer = true // default to full mode (client + server)

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === '--e2e-dir') {
      if (args[i + 1]) {
        e2eDir = args[i + 1]
        i += 2
      } else {
        return { error: `Missing value for ${arg}` }
      }
    } else if (arg === '--force') {
      force = true
      i++
    } else if (arg === '--js') {
      typescript = false
      i++
    } else if (arg === '-y' || arg === '--yes') {
      interactive = false
      i++
    } else if (arg === '--no-merge') {
      mergeCoverage = false
      i++
    } else if (arg === '--client-only') {
      collectServer = false
      i++
    } else if (arg.startsWith('-')) {
      return { error: `Unknown option: ${arg}`, showHelp: true }
    } else {
      return { error: `Unexpected argument: ${arg}`, showHelp: true }
    }
  }

  return { options: { e2eDir, force, typescript, interactive, mergeCoverage, collectServer } }
}

/**
 * Run interactive prompts to get init options
 */
export async function promptForOptions(
  defaults: InitOptions,
  detectedExt: 'ts' | 'js' | null
): Promise<InitOptions> {
  console.log('\n📊 nextcov init\n')

  // E2E directory
  const e2eDir = await input({
    message: 'E2E test directory',
    default: defaults.e2eDir,
  })

  // Language (only ask if not auto-detected)
  let typescript = defaults.typescript
  if (detectedExt) {
    console.log(`Language: ${detectedExt === 'ts' ? 'TypeScript' : 'JavaScript'} (detected from playwright.config.${detectedExt})`)
    typescript = detectedExt === 'ts'
  } else {
    const lang = await select({
      message: 'Language',
      choices: [
        { name: 'TypeScript', value: 'ts' },
        { name: 'JavaScript', value: 'js' },
      ],
      default: typescript ? 'ts' : 'js',
    })
    typescript = lang === 'ts'
  }

  // Coverage mode
  const coverageMode = await select({
    message: 'Coverage mode',
    choices: [
      { name: 'Full (client + server)', value: 'full' },
      { name: 'Client-only (simpler setup, no --inspect required)', value: 'client-only' },
    ],
    default: defaults.collectServer ? 'full' : 'client-only',
  })
  const collectServer = coverageMode === 'full'

  // Coverage merge script
  const mergeCoverage = await confirm({
    message: 'Add coverage:merge script? (merges unit + component + e2e coverage)',
    default: defaults.mergeCoverage,
  })

  // Force overwrite
  const force = await confirm({
    message: 'Overwrite existing files?',
    default: defaults.force,
  })

  return { e2eDir, force, typescript, interactive: true, mergeCoverage, collectServer }
}

export interface InitResult {
  success: boolean
  error?: string
  created: string[]
  modified: string[]
  skipped: string[]
}

/**
 * Get global-setup template
 * Playwright supports ESM imports in both .ts and .js files
 */
function getGlobalSetupTemplate(ext: string): string {
  return `/**
 * Global Setup for E2E Tests
 *
 * Initializes coverage collection before tests run.
 * Works for both client-only and full (client + server) coverage modes.
 */

import * as path from 'path'
import { initCoverage, loadNextcovConfig } from 'nextcov/playwright'

export default async function globalSetup() {
  const config = await loadNextcovConfig(path.join(process.cwd(), 'playwright.config.${ext}'))
  await initCoverage(config)
}
`
}

/**
 * Get global-teardown template
 */
function getGlobalTeardownTemplate(ext: string, collectServer: boolean): string {
  const description = collectServer
    ? 'Collects and processes both client-side and server-side coverage.'
    : 'Collects and processes client-side coverage only.'

  return `/**
 * Global Teardown for E2E Tests
 *
 * ${description}
 */

import * as path from 'path'
import { finalizeCoverage, loadNextcovConfig } from 'nextcov/playwright'

export default async function globalTeardown() {
  const config = await loadNextcovConfig(path.join(process.cwd(), 'playwright.config.${ext}'))
  await finalizeCoverage(config)
}
`
}

/**
 * Get test-fixtures template
 */
function getTestFixturesTemplate(typescript: boolean): string {
  if (typescript) {
    return `import { test as base, expect } from '@playwright/test'
import { collectClientCoverage } from 'nextcov/playwright'

export interface TestFixtures {
  coverage: void
}

export const test = base.extend<TestFixtures>({
  // Auto-collect v8 coverage for each test
  coverage: [
    async ({ page }, use, testInfo) => {
      await collectClientCoverage(page, testInfo, use)
    },
    { scope: 'test', auto: true },
  ],
})

export { expect }
`
  }
  return `import { test as base, expect } from '@playwright/test'
import { collectClientCoverage } from 'nextcov/playwright'

export const test = base.extend({
  // Auto-collect v8 coverage for each test
  coverage: [
    async ({ page }, use, testInfo) => {
      await collectClientCoverage(page, testInfo, use)
    },
    { scope: 'test', auto: true },
  ],
})

export { expect }
`
}

/**
 * Detect custom distDir from next.config file
 * Returns the distDir value if found, otherwise null
 */
function detectDistDir(nextConfigPath: string | null): string | null {
  if (!nextConfigPath) return null

  try {
    const content = readFileSync(nextConfigPath, 'utf-8')
    // Look for distDir: 'value' or distDir: "value"
    const match = content.match(/distDir:\s*['"]([^'"]+)['"]/)
    if (match) {
      return match[1]
    }
  } catch {
    // Ignore read errors
  }
  return null
}

/**
 * Get nextcov config to add to playwright.config.ts
 */
function getNextcovConfig(collectServer: boolean, buildDir: string | null): string {
  const buildDirLine = buildDir ? `\n  buildDir: '${buildDir}',` : ''

  if (collectServer) {
    // Full mode: include cdpPort for server coverage via Chrome DevTools Protocol
    return `
// Nextcov configuration
export const nextcov: NextcovConfig = {
  cdpPort: 9230,${buildDirLine}
  outputDir: 'coverage/e2e',
  sourceRoot: './src',
  include: ['src/**/*.{ts,tsx,js,jsx}'],
  exclude: [
    'src/**/__tests__/**',
    'src/**/*.test.{ts,tsx}',
    'src/**/*.spec.{ts,tsx}',
  ],
  reporters: ['html', 'lcov', 'json', 'text-summary'],
}
`
  } else {
    // Client-only mode: no cdpPort needed
    return `
// Nextcov configuration
export const nextcov: NextcovConfig = {${buildDirLine}
  outputDir: 'coverage/e2e',
  sourceRoot: './src',
  collectServer: false,  // Client-only mode
  include: ['src/**/*.{ts,tsx,js,jsx}'],
  exclude: [
    'src/**/__tests__/**',
    'src/**/*.test.{ts,tsx}',
    'src/**/*.spec.{ts,tsx}',
  ],
  reporters: ['html', 'lcov', 'json', 'text-summary'],
}
`
  }
}

/**
 * Check if a file can be created (doesn't exist or force is enabled)
 */
function canCreate(filePath: string, force: boolean): boolean {
  return force || !existsSync(filePath)
}

/**
 * Safely write a file, creating directories as needed
 */
function safeWriteFile(filePath: string, content: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(filePath, content, 'utf-8')
}

/**
 * Add nextcov import and config to playwright.config
 */
function modifyPlaywrightConfig(
  configPath: string,
  ext: 'ts' | 'js',
  e2eDir: string,
  collectServer: boolean,
  buildDir: string | null
): { modified: boolean; error?: string } {
  if (!existsSync(configPath)) {
    return { modified: false, error: `playwright.config.${ext} not found. Run \`npx playwright init\` first.` }
  }

  let content = readFileSync(configPath, 'utf-8')

  // Check if already configured
  if (content.includes('nextcov')) {
    return { modified: false }
  }

  // Add NextcovConfig import (only for TypeScript, JS doesn't need type import)
  if (ext === 'ts') {
    if (content.includes("from '@playwright/test'")) {
      content = content.replace(
        /from ['"]@playwright\/test['"]/,
        `from '@playwright/test'\nimport type { NextcovConfig } from 'nextcov'`
      )
    } else {
      content = `import type { NextcovConfig } from 'nextcov'\n` + content
    }
  }

  // Find the defineConfig call and add nextcov config before it
  const nextcovConfigBlock = getNextcovConfig(collectServer, buildDir)
  const defineConfigMatch = content.match(/export default defineConfig\s*\(/)
  if (defineConfigMatch && defineConfigMatch.index !== undefined) {
    content = content.slice(0, defineConfigMatch.index) +
      nextcovConfigBlock + '\n' +
      content.slice(defineConfigMatch.index)
  } else {
    // If no defineConfig found, just add at the end
    content += nextcovConfigBlock
  }

  // Try to add globalSetup/globalTeardown to the config object
  // Look for the config object inside defineConfig
  const configObjectMatch = content.match(/defineConfig\s*\(\s*\{/)
  if (configObjectMatch && configObjectMatch.index !== undefined) {
    const insertPos = configObjectMatch.index + configObjectMatch[0].length
    // Both modes need globalSetup (initializes coverage) and globalTeardown (finalizes)
    const setupConfig = `
  globalSetup: './${e2eDir}/global-setup.${ext}',
  globalTeardown: './${e2eDir}/global-teardown.${ext}',
`
    // Only add if not already present
    if (!content.includes('globalSetup') && !content.includes('globalTeardown')) {
      content = content.slice(0, insertPos) + setupConfig + content.slice(insertPos)
    }
  }

  // Add nextcov to the config object
  // Find the closing of defineConfig
  if (!content.includes('nextcov,') && !content.includes('nextcov:')) {
    // Try to add before the closing of defineConfig
    const lastBraceMatch = content.match(/\}\s*\)\s*;?\s*$/)
    if (lastBraceMatch && lastBraceMatch.index !== undefined) {
      content = content.slice(0, lastBraceMatch.index) +
        '\n  nextcov,\n' +
        content.slice(lastBraceMatch.index)
    }
  }

  writeFileSync(configPath, content, 'utf-8')
  return { modified: true }
}

/**
 * Check if project uses Jest (not supported - use Vitest instead)
 */
function checkForJest(cwd: string): { hasJest: boolean; files: string[] } {
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

  // Also check package.json for jest config
  const packageJsonPath = join(cwd, 'package.json')
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      if (pkg.jest) {
        foundFiles.push('package.json (jest field)')
      }
    } catch {
      // Ignore parse errors
    }
  }

  return { hasJest: foundFiles.length > 0, files: foundFiles }
}

/**
 * Check if project uses Babel (not supported for coverage collection)
 * Babel transpiles code differently than SWC, causing source map issues
 */
function checkForBabel(cwd: string): { hasBabel: boolean; files: string[] } {
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

  // Also check package.json for babel config
  const packageJsonPath = join(cwd, 'package.json')
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      if (pkg.babel) {
        foundFiles.push('package.json (babel field)')
      }
    } catch {
      // Ignore parse errors
    }
  }

  return { hasBabel: foundFiles.length > 0, files: foundFiles }
}

/**
 * Get the next.config E2E mode code snippet
 */
function getNextConfigE2ESnippet(): string {
  return `
  // E2E mode enables source maps for coverage collection
  const isE2EMode = process.env.E2E_MODE === 'true'
`
}

/**
 * Get the webpack config for E2E mode (full webpack property)
 *
 * Note: In dev mode, Next.js uses inline source maps which nextcov handles automatically.
 * These settings only affect production builds (build:e2e / start:e2e).
 */
function getWebpackConfigSnippet(): string {
  return `  webpack: (config, { isServer }) => {
    if (isE2EMode) {
      // Enable source maps for production build coverage
      config.devtool = 'source-map'

      // Disable minification so coverage maps correctly to source
      config.optimization = {
        ...config.optimization,
        minimize: false,
      }

      // Fix server-side source map paths
      if (isServer) {
        config.output = {
          ...config.output,
          devtoolModuleFilenameTemplate: '[absolute-resource-path]',
        }
      }
    }
    return config
  },
`
}

/**
 * Get the webpack body snippet for injecting into existing webpack config
 * This is a simplified version that works for most cases
 */
function getWebpackBodySnippet(): string {
  return `if (isE2EMode) {
      // Force source-map generation for accurate coverage
      config.devtool = 'source-map'

      // Disable minification so coverage maps correctly to source
      config.optimization = {
        ...config.optimization,
        minimize: false,
      }
    }
    `
}

/**
 * Get the full webpack replacement for simple passthrough configs
 * Replaces: webpack: (config) => { return config; }
 *
 * Note: In dev mode, Next.js uses inline source maps which nextcov handles automatically.
 * These settings only affect production builds (build:e2e / start:e2e).
 */
function getFullWebpackReplacement(): string {
  return `webpack: (config, { isServer }) => {
      if (isE2EMode) {
        // Enable source maps for production build coverage
        config.devtool = 'source-map'

        // Disable minification so coverage maps correctly to source
        config.optimization = {
          ...config.optimization,
          minimize: false,
        }

        // Fix server-side source map paths
        if (isServer) {
          config.output = {
            ...config.output,
            devtoolModuleFilenameTemplate: '[absolute-resource-path]',
          }
        }
      }
      return config
    }`
}

/**
 * Find next.config file (ts, mjs, or js)
 */
function findNextConfig(cwd: string): string | null {
  const tsPath = join(cwd, 'next.config.ts')
  const mjsPath = join(cwd, 'next.config.mjs')
  const jsPath = join(cwd, 'next.config.js')

  if (existsSync(tsPath)) return tsPath
  if (existsSync(mjsPath)) return mjsPath
  if (existsSync(jsPath)) return jsPath
  return null
}

/**
 * Modify next.config.ts or next.config.js to add E2E mode settings
 */
function modifyNextConfig(configPath: string): { modified: boolean; path: string; error?: string } {

  let content = readFileSync(configPath, 'utf-8')

  // Check if already configured
  if (content.includes('E2E_MODE') || content.includes('isE2EMode')) {
    return { modified: false, path: configPath }
  }

  const originalContent = content

  // Detect if this is a functional config (export default (phase) => { ... })
  // Need to handle typed parameters like: (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => {
  const isFunctionalConfig = /export\s+default\s+function/.test(content) ||
    /module\.exports\s*=\s*function/.test(content) ||
    // Arrow function: look for export default followed by ( and eventually ) => {
    /export\s+default\s*\([\s\S]*?\)\s*=>\s*\{/.test(content) ||
    /module\.exports\s*=\s*\([\s\S]*?\)\s*=>\s*\{/.test(content)

  const e2eSnippet = getNextConfigE2ESnippet()

  if (isFunctionalConfig) {
    // For functional configs, add isE2EMode inside the function body
    // Find the arrow function pattern with => { and insert after the opening brace
    // This handles typed parameters like (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => {
    const arrowFuncPattern = /(export\s+default\s*\([\s\S]*?\)\s*=>\s*\{)/
    const regularFuncPattern = /(export\s+default\s+function\s*\w*\s*\([^)]*\)\s*\{)/
    const moduleExportsArrowPattern = /(module\.exports\s*=\s*\([\s\S]*?\)\s*=>\s*\{)/
    const moduleExportsFuncPattern = /(module\.exports\s*=\s*function\s*\w*\s*\([^)]*\)\s*\{)/

    const match = content.match(arrowFuncPattern) ||
                  content.match(regularFuncPattern) ||
                  content.match(moduleExportsArrowPattern) ||
                  content.match(moduleExportsFuncPattern)

    if (match && match.index !== undefined) {
      const insertPos = match.index + match[0].length
      content = content.slice(0, insertPos) + e2eSnippet + content.slice(insertPos)
    }
  } else {
    // For object configs, add at the top after imports
    const importMatch = content.match(/^(import\s+.+\n)+/m)
    if (importMatch && importMatch.index !== undefined) {
      const insertPos = importMatch.index + importMatch[0].length
      content = content.slice(0, insertPos) + e2eSnippet + content.slice(insertPos)
    } else {
      // No imports, add at the very beginning
      content = e2eSnippet + content
    }
  }

  // Add productionBrowserSourceMaps if not present
  if (!content.includes('productionBrowserSourceMaps')) {
    // Look for the config object
    const configPatterns = [
      // const nextConfig: NextConfig = {
      /const\s+\w+\s*(?::\s*\w+)?\s*=\s*\{/,
      // module.exports = {
      /module\.exports\s*=\s*\{/,
      // export default {
      /export\s+default\s+\{/,
    ]

    let inserted = false
    for (const pattern of configPatterns) {
      const match = content.match(pattern)
      if (match && match.index !== undefined) {
        const insertPos = match.index + match[0].length
        content = content.slice(0, insertPos) +
          '\n    productionBrowserSourceMaps: isE2EMode,' +
          content.slice(insertPos)
        inserted = true
        break
      }
    }

    if (!inserted) {
      // Couldn't find config object pattern
      return { modified: false, path: configPath, error: 'Could not find config object in next.config' }
    }
  }

  // Handle webpack config
  const hasWebpackConfig = content.includes('webpack:') || content.includes('webpack :')
  // Check if the webpack function itself already contains isE2EMode checks
  // We look for isE2EMode within the webpack function body, not just anywhere in the file
  const webpackMatch = content.match(/webpack:\s*\([^)]+\)\s*=>\s*\{[\s\S]*?\n\s*\}/)
  const hasE2EModeInWebpack = webpackMatch ? webpackMatch[0].includes('isE2EMode') : false

  if (!hasWebpackConfig) {
    // No webpack config - add one
    const configPatterns = [
      /const\s+\w+\s*(?::\s*\w+)?\s*=\s*\{/,
      /module\.exports\s*=\s*\{/,
      /export\s+default\s+\{/,
    ]

    let inserted = false
    for (const pattern of configPatterns) {
      const match = content.match(pattern)
      if (match && match.index !== undefined) {
        // Find the opening brace and insert after productionBrowserSourceMaps line
        const afterMatch = content.slice(match.index + match[0].length)
        const firstPropertyEnd = afterMatch.indexOf(',')
        if (firstPropertyEnd !== -1) {
          const insertPos = match.index + match[0].length + firstPropertyEnd + 1
          content = content.slice(0, insertPos) +
            '\n' + getWebpackConfigSnippet() +
            content.slice(insertPos)
          inserted = true
          break
        }
      }
    }

    if (!inserted) {
      // Fallback: just add the webpack config info in a comment
      content = content.replace(
        'productionBrowserSourceMaps: isE2EMode,',
        'productionBrowserSourceMaps: isE2EMode,\n  // TODO: Add webpack config for E2E mode source maps'
      )
    }
  } else if (!hasE2EModeInWebpack) {
    // Webpack config exists but doesn't have E2E mode checks
    // Try to inject E2E mode checks into existing webpack config

    let injected = false

    // First, try to match simple passthrough webpack configs and replace entirely
    // These patterns match various formats of: webpack: (config) => { return config; }
    // Including multi-line versions with various indentation
    const simpleWebpackPatterns = [
      // Single line: webpack: (config) => { return config; }
      /webpack:\s*\(\s*config\s*\)\s*=>\s*\{\s*return\s+config;?\s*\}/,
      // Multi-line: webpack: (config) => {\n      return config;\n    }
      // Using [\s\S]*? to match any whitespace including newlines
      /webpack:\s*\(\s*config\s*\)\s*=>\s*\{[\s\S]*?return\s+config;?[\s\S]*?\}/,
    ]

    for (const pattern of simpleWebpackPatterns) {
      if (pattern.test(content)) {
        content = content.replace(pattern, getFullWebpackReplacement())
        injected = true
        break
      }
    }

    // If not a simple passthrough, try to inject into existing webpack config
    if (!injected) {
      const webpackBodySnippet = getWebpackBodySnippet()

      // Look for patterns with return config and inject before it
      // Match webpack configs with various parameter styles
      const returnConfigPattern = /(webpack:\s*\([^)]+\)\s*=>\s*\{[\s\S]*?)(return\s+config)/

      const match = content.match(returnConfigPattern)
      if (match && match.index !== undefined) {
        content = content.replace(
          returnConfigPattern,
          `$1${webpackBodySnippet}$2`
        )
        injected = true
      }
    }

    if (!injected) {
      // Couldn't inject, add a comment
      content = content.replace(
        'productionBrowserSourceMaps: isE2EMode,',
        'productionBrowserSourceMaps: isE2EMode,\n  // Note: Add E2E mode checks to your webpack config for server-side source maps'
      )
    }
  }

  // Only write if we actually changed something
  if (content !== originalContent) {
    writeFileSync(configPath, content, 'utf-8')
    return { modified: true, path: configPath }
  }

  return { modified: false, path: configPath }
}

/**
 * Add npm scripts, devDependencies, and browserslist to package.json
 */
function modifyPackageJson(
  packagePath: string,
  mergeCoverage: boolean,
  collectServer: boolean,
  isNextJs: boolean
): { modified: boolean; needsInstall: boolean; error?: string } {
  if (!existsSync(packagePath)) {
    return { modified: false, needsInstall: false, error: 'package.json not found' }
  }

  const content = readFileSync(packagePath, 'utf-8')
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(content)
  } catch {
    return { modified: false, needsInstall: false, error: 'Failed to parse package.json' }
  }

  const scripts = (pkg.scripts || {}) as Record<string, string>
  const devDeps = (pkg.devDependencies || {}) as Record<string, string>
  let modified = false
  let needsInstall = false

  // Add e2e scripts - only for Next.js projects
  if (isNextJs) {
    // Add cross-env as devDependency if not present (needed for all e2e scripts)
    if (!devDeps['cross-env']) {
      devDeps['cross-env'] = '^7.0.3'
      needsInstall = true
    }

    // Add start-server-and-test as devDependency if not present (needed for test:e2e script)
    if (!devDeps['start-server-and-test']) {
      devDeps['start-server-and-test'] = '^2.0.8'
      needsInstall = true
    }

    // Add concurrently as devDependency if not present (needed for start:e2e script)
    if (!devDeps['concurrently']) {
      devDeps['concurrently'] = '^9.1.0'
      needsInstall = true
    }

    // Add dev:e2e script
    if (!scripts['dev:e2e'] && !scripts['dev']?.includes('--inspect')) {
      if (collectServer) {
        // Full mode: with --inspect flag for server coverage
        scripts['dev:e2e'] = 'cross-env NODE_OPTIONS=--inspect=9230 next dev'
      } else {
        // Client-only mode: no --inspect needed, just set E2E_MODE for source maps
        scripts['dev:e2e'] = 'cross-env E2E_MODE=true next dev'
      }
      modified = true
    }

    // Add build:e2e script (production build with source maps)
    if (!scripts['build:e2e']) {
      scripts['build:e2e'] = 'cross-env E2E_MODE=true next build'
      modified = true
    }

    // Add start:local script (production start with inspector for server coverage)
    if (!scripts['start:local']) {
      if (collectServer) {
        // Full mode: with --inspect flag and NODE_V8_COVERAGE for server coverage
        scripts['start:local'] = 'cross-env NODE_OPTIONS=--inspect=9230 NODE_V8_COVERAGE=coverage/e2e/tmp next start'
      } else {
        // Client-only mode: no --inspect needed
        scripts['start:local'] = 'next start'
      }
      modified = true
    }

    // Add start:e2e script (starts both app server and mock server concurrently)
    if (!scripts['start:e2e']) {
      scripts['start:e2e'] = 'concurrently "npm run start:local" "npm run mock"'
      modified = true
    }

    // Add test:e2e script (starts servers, waits for ready, runs tests)
    if (!scripts['test:e2e']) {
      scripts['test:e2e'] = 'start-server-and-test start:e2e http://localhost:3000 playwright-test'
      modified = true
    }
  }

  // Add coverage:merge script for merging unit + component + e2e coverage (only if enabled)
  if (mergeCoverage && !scripts['coverage:merge']) {
    scripts['coverage:merge'] = 'nextcov merge coverage/unit coverage/component coverage/e2e -o coverage/merged'
    modified = true
  }

  // Add browserslist for modern browsers (improves V8 coverage accuracy)
  // Without this, optional chaining and nullish coalescing may be transpiled
  if (!pkg.browserslist) {
    pkg.browserslist = [
      'chrome 111',
      'edge 111',
      'firefox 111',
      'safari 16.4',
    ]
    modified = true
  }

  if (modified || needsInstall) {
    pkg.scripts = scripts
    pkg.devDependencies = devDeps
    writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
  }

  return { modified: modified || needsInstall, needsInstall }
}

/**
 * Detect if project uses TypeScript or JavaScript for Playwright config
 */
export function detectPlaywrightConfigType(cwd: string): { ext: 'ts' | 'js'; path: string } | null {
  const tsPath = join(cwd, 'playwright.config.ts')
  const jsPath = join(cwd, 'playwright.config.js')

  if (existsSync(tsPath)) {
    return { ext: 'ts', path: tsPath }
  }
  if (existsSync(jsPath)) {
    return { ext: 'js', path: jsPath }
  }
  return null
}

/**
 * Execute the init command
 */
export async function executeInit(options: InitOptions): Promise<InitResult> {
  const cwd = process.cwd()
  const result: InitResult = {
    success: true,
    created: [],
    modified: [],
    skipped: [],
  }

  // === Pre-flight checks (before interactive prompts) ===
  // 1. Require Playwright to be set up first
  const detected = detectPlaywrightConfigType(cwd)
  if (!detected) {
    console.error('❌ Playwright is not set up\n')
    console.error('   Could not find playwright.config.ts or playwright.config.js')
    console.error('\n   Please set up Playwright first:')
    console.error('     npm init playwright@latest')
    console.error('\n   Then run nextcov init again.')
    return {
      success: false,
      error: 'Playwright is not set up',
      created: [],
      modified: [],
      skipped: [],
    }
  }

  // 2. Check for Babel - not supported (applies to all modes)
  const babelCheck = checkForBabel(cwd)
  if (babelCheck.hasBabel) {
    console.error('❌ Babel is not supported by nextcov\n')
    console.error('   Found Babel configuration:')
    for (const file of babelCheck.files) {
      console.error(`     - ${file}`)
    }
    console.error('\n   nextcov requires SWC (Next.js default compiler) for accurate')
    console.error('   source maps and coverage collection.')
    console.error('\n   To use nextcov, remove Babel configuration and use SWC instead.')
    console.error('   See: https://nextjs.org/docs/architecture/nextjs-compiler')
    return {
      success: false,
      error: 'Babel is not supported',
      created: [],
      modified: [],
      skipped: [],
    }
  }

  // Run interactive prompts if enabled (BEFORE Next.js check, so user can choose client-only mode)
  let finalOptions = options
  if (options.interactive) {
    finalOptions = await promptForOptions(options, detected.ext)
  } else {
    console.log('📊 nextcov init\n')
  }

  // === Post-prompt checks (depend on user's mode selection) ===
  // 3. Check for Next.js config - only required for full mode (server coverage)
  const nextConfigPath = findNextConfig(cwd)
  if (finalOptions.collectServer && !nextConfigPath) {
    console.error('❌ Next.js config not found\n')
    console.error('   Could not find next.config.ts, next.config.js, or next.config.mjs')
    console.error('\n   Full mode (server coverage) requires a Next.js project.')
    console.error('   Options:')
    console.error('   1. Make sure you are in the root of a Next.js project')
    console.error('   2. Use client-only mode: npx nextcov init --client-only')
    return {
      success: false,
      error: 'Next.js config not found',
      created: [],
      modified: [],
      skipped: [],
    }
  }

  // 4. Check for Jest - only if mergeCoverage is enabled
  // Jest coverage format is not compatible with nextcov merge
  if (finalOptions.mergeCoverage) {
    const jestCheck = checkForJest(cwd)
    if (jestCheck.hasJest) {
      console.error('❌ Jest is not supported for coverage merging\n')
      console.error('   Found Jest configuration:')
      for (const file of jestCheck.files) {
        console.error(`     - ${file}`)
      }
      console.error('\n   nextcov coverage merging requires Vitest for unit tests.')
      console.error('   Jest uses a different coverage format that is not compatible.')
      console.error('\n   Options:')
      console.error('   1. Migrate from Jest to Vitest (recommended)')
      console.error('   2. Run: npx nextcov init --no-merge (E2E coverage only)')
      console.error('\n   See: https://vitest.dev/guide/migration.html')
      return {
        success: false,
        error: 'Jest is not supported',
        created: [],
        modified: [],
        skipped: [],
      }
    }
  }

  // Use detected ext (guaranteed to exist after check above)
  const ext = detected.ext
  const playwrightConfigPath = detected.path

  // Create e2e/global-setup (needed for both modes to initialize coverage)
  const globalSetupPath = join(cwd, finalOptions.e2eDir, `global-setup.${ext}`)
  if (canCreate(globalSetupPath, finalOptions.force)) {
    safeWriteFile(globalSetupPath, getGlobalSetupTemplate(ext))
    result.created.push(globalSetupPath)
    console.log(`   ✓ Created ${finalOptions.e2eDir}/global-setup.${ext}`)
  } else {
    result.skipped.push(globalSetupPath)
    console.log(`   ⊘ Skipped ${finalOptions.e2eDir}/global-setup.${ext} (already exists)`)
  }

  // Create e2e/global-teardown
  const globalTeardownPath = join(cwd, finalOptions.e2eDir, `global-teardown.${ext}`)
  if (canCreate(globalTeardownPath, finalOptions.force)) {
    safeWriteFile(globalTeardownPath, getGlobalTeardownTemplate(ext, finalOptions.collectServer))
    result.created.push(globalTeardownPath)
    console.log(`   ✓ Created ${finalOptions.e2eDir}/global-teardown.${ext}`)
  } else {
    result.skipped.push(globalTeardownPath)
    console.log(`   ⊘ Skipped ${finalOptions.e2eDir}/global-teardown.${ext} (already exists)`)
  }

  // Create e2e/fixtures/test-fixtures
  const testFixturesPath = join(cwd, finalOptions.e2eDir, 'fixtures', `test-fixtures.${ext}`)
  if (canCreate(testFixturesPath, finalOptions.force)) {
    safeWriteFile(testFixturesPath, getTestFixturesTemplate(finalOptions.typescript))
    result.created.push(testFixturesPath)
    console.log(`   ✓ Created ${finalOptions.e2eDir}/fixtures/test-fixtures.${ext}`)
  } else {
    result.skipped.push(testFixturesPath)
    console.log(`   ⊘ Skipped ${finalOptions.e2eDir}/fixtures/test-fixtures.${ext} (already exists)`)
  }

  // Detect custom distDir from next.config (for buildDir in playwright config)
  const distDir = detectDistDir(nextConfigPath)

  // Modify playwright.config
  const configResult = modifyPlaywrightConfig(playwrightConfigPath, ext, finalOptions.e2eDir, finalOptions.collectServer, distDir)
  if (configResult.error) {
    console.log(`   ⚠ ${configResult.error}`)
  } else if (configResult.modified) {
    result.modified.push(playwrightConfigPath)
    console.log(`   ✓ Modified playwright.config.${ext}`)
  } else {
    console.log(`   ⊘ Skipped playwright.config.${ext} (already configured)`)
  }

  // Modify package.json
  const packageJsonPath = join(cwd, 'package.json')
  const isNextJs = nextConfigPath !== null
  const pkgResult = modifyPackageJson(packageJsonPath, finalOptions.mergeCoverage, finalOptions.collectServer, isNextJs)
  if (pkgResult.error) {
    console.log(`   ⚠ ${pkgResult.error}`)
  } else if (pkgResult.modified) {
    result.modified.push(packageJsonPath)
    console.log(`   ✓ Modified package.json (added scripts and dependencies)`)

    // Run npm install if new dependencies were added
    if (pkgResult.needsInstall) {
      console.log(`   ⏳ Installing dependencies...`)
      try {
        execSync('npm install', { cwd, stdio: 'inherit' })
        console.log(`   ✓ Dependencies installed`)
      } catch {
        console.log(`   ⚠ Failed to install dependencies. Run 'npm install' manually.`)
      }
    }
  } else {
    console.log(`   ⊘ Skipped package.json (scripts already exist)`)
  }

  // Modify next.config (only for full mode with server coverage, or if next.config exists)
  if (nextConfigPath) {
    const nextConfigResult = modifyNextConfig(nextConfigPath)
    if (nextConfigResult.error) {
      console.log(`   ⚠ ${nextConfigResult.error}`)
    } else if (nextConfigResult.modified) {
      result.modified.push(nextConfigResult.path)
      const configName = nextConfigResult.path.split(/[/\\]/).pop()
      console.log(`   ✓ Modified ${configName} (added E2E mode settings)`)
    } else {
      const configName = nextConfigResult.path.split(/[/\\]/).pop()
      console.log(`   ⊘ Skipped ${configName} (already configured)`)
    }
  }

  // Summary
  console.log('\n📋 Summary:')
  if (result.created.length > 0) {
    console.log(`   Created: ${result.created.length} file(s)`)
  }
  if (result.modified.length > 0) {
    console.log(`   Modified: ${result.modified.length} file(s)`)
  }
  if (result.skipped.length > 0) {
    console.log(`   Skipped: ${result.skipped.length} file(s) (use --force to overwrite)`)
  }

  // Next steps - different guidance for client-only vs full mode
  console.log('\n📝 Next steps:')
  console.log('   1. Import test fixtures in your tests:')
  console.log(`      import { test, expect } from './fixtures/test-fixtures'`)

  if (finalOptions.collectServer) {
    // Full mode: server + client coverage
    console.log('   2. Start Next.js with inspector:')
    console.log('      npm run dev:e2e')
  } else {
    // Client-only mode: simpler setup
    console.log('   2. Start your application (or use baseURL for deployed app):')
    console.log('      npm run dev:e2e  # for local development')
    console.log('      # Or configure baseURL in playwright.config for deployed environments')
  }

  console.log('   3. Run your e2e tests:')
  console.log('      npx playwright test')
  console.log('   4. View coverage report:')
  console.log('      open coverage/e2e/index.html')

  return result
}
