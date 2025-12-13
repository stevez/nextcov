#!/usr/bin/env node
/**
 * nextcov CLI
 *
 * Commands:
 *   merge - Merge multiple coverage reports into one
 */

import { resolve } from 'path'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'

export const HELP = `
nextcov - Coverage collection for Next.js + Playwright

Usage:
  npx nextcov <command> [options]

Commands:
  merge       Merge multiple coverage reports into one

Options:
  --help      Show this help message

Examples:
  npx nextcov merge coverage/unit coverage/integration
  npx nextcov merge coverage/unit coverage/e2e coverage/browser -o coverage/all
`

export const MERGE_HELP = `
Usage: npx nextcov merge <dirs...> [options]

Merge multiple coverage directories into a single report.

Arguments:
  dirs                  Coverage directories to merge (must contain coverage-final.json)

Options:
  -o, --output <dir>    Output directory for merged report (default: ./coverage/merged)
  --reporters <list>    Comma-separated reporters: html,lcov,json,text-summary (default: html,lcov,json,text-summary)
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

  if (command === 'merge') {
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

  return { options: { inputs, output, reporters } }
}

export interface MergeResult {
  success: boolean
  error?: string
  showHelp?: boolean
  outputDir?: string
}

/**
 * Validate input directories and return coverage file paths
 */
export function validateInputDirectories(inputs: string[]): { coverageFiles: string[], error?: string } {
  const coverageFiles: string[] = []
  for (const dir of inputs) {
    const absoluteDir = resolve(process.cwd(), dir)
    const coverageFile = resolve(absoluteDir, 'coverage-final.json')

    if (!existsSync(coverageFile)) {
      return { coverageFiles: [], error: `Coverage file not found: ${coverageFile}` }
    }
    coverageFiles.push(coverageFile)
  }
  return { coverageFiles }
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

  console.log(`📊 nextcov merge`)
  console.log(`   Inputs: ${options.inputs.join(', ')}`)
  console.log(`   Output: ${options.output}`)
  console.log(`   Reporters: ${options.reporters.join(', ')}`)

  try {
    // Dynamic import to avoid loading heavy dependencies until needed
    const { IstanbulReporter } = await import('./reporter.js')
    const { createMerger } = await import('./merger.js')

    // Use nextcov's smart merger which handles mismatched statement maps
    const merger = createMerger({ applyFixes: true })

    // Load all coverage files
    const coverageMaps = []
    for (const file of coverageFiles) {
      console.log(`   Loading: ${file}`)
      const map = await merger.loadCoverageJson(file)
      if (!map) {
        return { success: false, error: `Failed to load coverage from ${file}` }
      }
      coverageMaps.push(map)
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
