/**
 * nextcov CLI
 *
 * Commands:
 *   init  - Initialize nextcov in your project
 *   merge - Merge multiple coverage reports into one
 */

import { resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'

export const HELP = `
nextcov - Coverage collection for Next.js + Playwright

Usage:
  npx nextcov <command> [options]

Commands:
  init        Initialize nextcov in your project
  merge       Merge multiple coverage reports into one

Options:
  --help      Show this help message

Examples:
  npx nextcov init
  npx nextcov merge coverage/unit coverage/integration
  npx nextcov merge coverage/unit coverage/e2e coverage/browser -o coverage/all
`

export const MERGE_HELP = `
Usage: npx nextcov merge <dirs...> [options]

Merge multiple coverage directories into a single report.

By default, coverage directives (import statements, 'use client', 'use server')
are stripped from the coverage data before merging. This ensures accurate merged
coverage when combining unit/component tests with E2E tests.

Arguments:
  dirs                  Coverage directories to merge (must contain coverage-final.json)

Options:
  -o, --output <dir>    Output directory for merged report (default: ./coverage/merged)
  --reporters <list>    Comma-separated reporters: html,lcov,json,text-summary (default: html,lcov,json,text-summary)
  --no-strip            Disable stripping of import statements and directives
  --help                Show this help message

Examples:
  npx nextcov merge coverage/unit coverage/integration
  npx nextcov merge coverage/unit coverage/e2e coverage/browser -o coverage/merged
  npx nextcov merge coverage/unit coverage/integration --reporters html,lcov
`

async function main(): Promise<number> {
  const args = process.argv.slice(2)

  if (args.length === 0 || (args[0] === '--help' || args[0] === '-h')) {
    console.log(HELP)
    return 0
  }

  const command = args[0]

  if (command === 'init') {
    return await runInit(args.slice(1))
  } else if (command === 'merge') {
    return await runMerge(args.slice(1))
  } else {
    console.error(`Unknown command: ${command}`)
    console.log(HELP)
    return 1
  }
}

export interface MergeOptions {
  inputs: string[]
  output: string
  reporters: string[]
  strip: boolean
}

export interface ParseResult {
  options?: MergeOptions
  error?: string
  showHelp?: boolean
}

export function parseMergeArgs(args: string[]): ParseResult {
  if (args.includes('--help') || args.includes('-h')) {
    return { showHelp: true }
  }

  const inputs: string[] = []
  let output = './coverage/merged'
  let reporters = ['html', 'lcov', 'json', 'text-summary']
  let strip = true // Default: strip is enabled

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === '-o' || arg === '--output') {
      if (args[i + 1]) {
        output = args[i + 1]
        i += 2
      } else {
        return { error: `Missing value for ${arg}` }
      }
    } else if (arg === '--reporters') {
      if (args[i + 1]) {
        reporters = args[i + 1].split(',').map(r => r.trim())
        i += 2
      } else {
        return { error: `Missing value for ${arg}` }
      }
    } else if (arg === '--no-strip') {
      strip = false
      i++
    } else if (!arg.startsWith('-')) {
      // Positional argument - treat as input directory
      inputs.push(arg)
      i++
    } else {
      return { error: `Unknown option: ${arg}`, showHelp: true }
    }
  }

  if (inputs.length === 0) {
    return { error: 'No coverage directories specified', showHelp: true }
  }

  return { options: { inputs, output, reporters, strip } }
}

export interface MergeResult {
  success: boolean
  error?: string
  showHelp?: boolean
  outputDir?: string
}

export interface StripResult {
  importsRemoved: number
  directivesRemoved: number
}

/**
 * Strip import statements and Next.js directives from Istanbul coverage data.
 *
 * This normalizes coverage data before merging Unit/Component with E2E coverage,
 * since E2E (Next.js bundled) doesn't include import statements or directives.
 *
 * Strips:
 * - import statements (import ... from '...')
 * - 'use server' directives
 * - 'use client' directives
 */
export function stripCoverageDirectives(coverageJson: Record<string, FileCoverageData>): StripResult {
  let importsRemoved = 0
  let directivesRemoved = 0

  for (const [file, data] of Object.entries(coverageJson)) {
    // Read source file to check line content
    let lines: string[] = []
    try {
      lines = readFileSync(file, 'utf-8').split('\n')
    } catch {
      // File not found, skip
      continue
    }

    // Find statement keys to remove
    const keysToRemove: Array<{ key: string; type: 'import' | 'directive' }> = []
    for (const [key, stmt] of Object.entries(data.statementMap || {})) {
      const lineNum = stmt.start.line
      const lineContent = lines[lineNum - 1]?.trim() || ''

      // Check if line is an import statement
      if (lineContent.startsWith('import ') || lineContent.startsWith('import{')) {
        keysToRemove.push({ key, type: 'import' })
      }
      // Check if line is a 'use server' or 'use client' directive
      else if (
        lineContent === "'use server'" || lineContent === '"use server"' ||
        lineContent === "'use server';" || lineContent === '"use server";' ||
        lineContent === "'use client'" || lineContent === '"use client"' ||
        lineContent === "'use client';" || lineContent === '"use client";'
      ) {
        keysToRemove.push({ key, type: 'directive' })
      }
    }

    // Remove statements
    for (const { key, type } of keysToRemove) {
      delete data.statementMap[key]
      delete data.s[key]
      if (type === 'import') {
        importsRemoved++
      } else {
        directivesRemoved++
      }
    }
  }

  return { importsRemoved, directivesRemoved }
}

interface FileCoverageData {
  statementMap: Record<string, { start: { line: number } }>
  s: Record<string, number>
  [key: string]: unknown
}

/**
 * Validate input directories and return coverage file paths.
 * Missing directories are skipped with a warning instead of failing.
 */
export function validateInputDirectories(inputs: string[]): { coverageFiles: string[], skipped: string[], error?: string } {
  const coverageFiles: string[] = []
  const skipped: string[] = []

  for (const dir of inputs) {
    const absoluteDir = resolve(process.cwd(), dir)
    const coverageFile = resolve(absoluteDir, 'coverage-final.json')

    if (!existsSync(coverageFile)) {
      skipped.push(dir)
    } else {
      coverageFiles.push(coverageFile)
    }
  }

  if (coverageFiles.length === 0) {
    return { coverageFiles: [], skipped, error: 'No coverage files found in any of the specified directories' }
  }

  if (coverageFiles.length === 1) {
    return { coverageFiles: [], skipped, error: 'Need at least 2 coverage directories to merge' }
  }

  return { coverageFiles, skipped }
}

/**
 * Execute the merge command - exported for testing
 */
export async function executeMerge(options: MergeOptions): Promise<MergeResult> {
  // Validate input directories exist and have coverage-final.json
  const validation = validateInputDirectories(options.inputs)
  if (validation.error) {
    return { success: false, error: validation.error }
  }
  const coverageFiles = validation.coverageFiles

  // Determine which inputs were actually found
  const foundInputs = options.inputs.filter(dir => !validation.skipped.includes(dir))

  console.log(`📊 nextcov merge`)
  console.log(`   Inputs: ${foundInputs.join(', ')}`)
  if (validation.skipped.length > 0) {
    console.log(`   Skipped (not found): ${validation.skipped.join(', ')}`)
  }
  console.log(`   Output: ${options.output}`)
  console.log(`   Reporters: ${options.reporters.join(', ')}`)
  console.log(`   Strip directives: ${options.strip ? 'yes' : 'no'}`)

  try {
    // Dynamic import to avoid loading heavy dependencies until needed
    const { IstanbulReporter } = await import('./reporter.js')
    const { createMerger } = await import('./merger.js')

    // Use nextcov's smart merger which handles mismatched statement maps
    const merger = createMerger({ applyFixes: true })

    // Load all coverage files, optionally stripping directives
    const coverageMaps = []
    let totalImportsRemoved = 0
    let totalDirectivesRemoved = 0

    for (const file of coverageFiles) {
      console.log(`   Loading: ${file}`)

      // Load raw JSON for stripping if enabled
      if (options.strip) {
        const rawJson = JSON.parse(readFileSync(file, 'utf-8'))
        const { importsRemoved, directivesRemoved } = stripCoverageDirectives(rawJson)
        totalImportsRemoved += importsRemoved
        totalDirectivesRemoved += directivesRemoved

        // Load the stripped data into a coverage map
        const map = await merger.loadCoverageData(rawJson)
        if (!map) {
          return { success: false, error: `Failed to load coverage from ${file}` }
        }
        coverageMaps.push(map)
      } else {
        const map = await merger.loadCoverageJson(file)
        if (!map) {
          return { success: false, error: `Failed to load coverage from ${file}` }
        }
        coverageMaps.push(map)
      }
    }

    if (options.strip && (totalImportsRemoved > 0 || totalDirectivesRemoved > 0)) {
      console.log(`   Stripped: ${totalImportsRemoved} imports, ${totalDirectivesRemoved} directives`)
    }

    // Merge all coverage maps using the merger's merge method
    // This uses the "max" strategy with "more items wins" for structure
    const mergedMap = await merger.merge(...coverageMaps)

    // Generate reports
    const absoluteOutput = resolve(process.cwd(), options.output)
    const reporter = new IstanbulReporter({
      outputDir: absoluteOutput,
      reporters: options.reporters as ('html' | 'lcov' | 'json' | 'text-summary')[],
    })

    await reporter.generateReports(mergedMap)

    console.log(`\n✅ Merged coverage report generated`)
    console.log(`   Output: ${absoluteOutput}`)

    return { success: true, outputDir: absoluteOutput }

  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function runInit(args: string[]): Promise<number> {
  // Dynamic import to avoid loading init dependencies until needed
  const { parseInitArgs, executeInit, INIT_HELP } = await import('./init.js')

  const result = parseInitArgs(args)

  if (result.showHelp) {
    console.log(INIT_HELP)
    if (result.error) {
      console.error(result.error)
      return 1
    }
    return 0
  }

  if (result.error) {
    console.error(result.error)
    return 1
  }

  await executeInit(result.options!)
  return 0
}

async function runMerge(args: string[]): Promise<number> {
  const result = parseMergeArgs(args)

  if (result.showHelp) {
    console.log(MERGE_HELP)
    if (result.error) {
      console.error(result.error)
      return 1
    }
    return 0
  }

  if (result.error) {
    console.error(result.error)
    return 1
  }

  const mergeResult = await executeMerge(result.options!)

  if (!mergeResult.success) {
    console.error(`❌ ${mergeResult.error}`)
    return 1
  }

  return 0
}

// Only run main() when executed directly, not when imported for testing
// Use fileURLToPath for cross-platform compatibility
const currentFile = fileURLToPath(import.meta.url)
const executedFile = process.argv[1]

// Normalize paths for comparison (handles Windows backslashes)
const normalizedCurrent = currentFile.replace(/\\/g, '/')
const normalizedExecuted = executedFile?.replace(/\\/g, '/')

const isMainModule = normalizedCurrent === normalizedExecuted
  || normalizedExecuted?.endsWith('/cli.js')
  || normalizedExecuted?.endsWith('/cli.ts')
  || normalizedExecuted?.endsWith('/nextcov')  // npm bin symlink name

// Use process.exitCode instead of process.exit() to allow Node to exit naturally
// after all I/O operations complete. This fixes stdout buffering issues in CI
// environments where npx pipes output through a child process.
if (isMainModule) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      console.error('Fatal error:', error)
      process.exitCode = 1
    })
}
