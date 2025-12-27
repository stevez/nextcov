/**
 * nextcov CLI
 *
 * Commands:
 *   init  - Initialize nextcov in your project
 *   merge - Merge multiple coverage reports into one
 */

import { fileURLToPath } from 'url'

const HELP = `
nextcov - Coverage collection for Next.js + Playwright

Usage:
  npx nextcov <command> [options]

Commands:
  init        Initialize nextcov in your project
  merge       Merge multiple coverage reports into one
  check       Check codebase for V8 coverage blind spots

Options:
  --help      Show this help message

Examples:
  npx nextcov init
  npx nextcov merge coverage/unit coverage/integration
  npx nextcov merge coverage/unit coverage/e2e coverage/browser -o coverage/all
  npx nextcov check src/
`

export async function main(): Promise<number> {
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
  } else if (command === 'check') {
    return await runCheck(args.slice(1))
  } else {
    console.error(`Unknown command: ${command}`)
    console.log(HELP)
    return 1
  }
}

async function runInit(args: string[]): Promise<number> {
  // Dynamic import to avoid loading init dependencies until needed
  const { parseInitArgs, executeInit, INIT_HELP } = await import('./commands/init.js')

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

  const initResult = await executeInit(result.options!)
  return initResult.success ? 0 : 1
}

async function runMerge(args: string[]): Promise<number> {
  // Dynamic import to avoid loading merge dependencies until needed
  const { runMerge: executeRunMerge } = await import('./commands/merge.js')
  return await executeRunMerge(args)
}

async function runCheck(args: string[]): Promise<number> {
  // Dynamic import to avoid loading check dependencies until needed
  const { check } = await import('./commands/check.js')
  type CheckOptions = import('./commands/check.js').CheckOptions

  // Parse basic flags manually (for now, simple implementation)
  const options: CheckOptions = {
    verbose: args.includes('--verbose'),
    json: args.includes('--json'),
    ignorePatterns: args.includes('--ignore-patterns'),
  }

  // Get paths (anything that's not a flag)
  const paths = args.filter(arg => !arg.startsWith('--'))

  return await check(paths, options)
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
  || normalizedExecuted?.endsWith('/cli/index.js')  // NEW: cli/index.js
  || normalizedExecuted?.endsWith('/cli/index.ts')  // NEW: cli/index.ts

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
