/**
 * Istanbul Coverage Fixes
 *
 * Post-processing functions for fixing Istanbul coverage data.
 * These handle edge cases in source mapping, bundler artifacts,
 * and differences between browser and Node.js V8 coverage.
 */

import { parse as babelParse } from '@babel/parser'
import type { CoverageMap, CoverageMapData } from 'istanbul-lib-coverage'
import { log, createTimer } from '@/utils/logger.js'
import { FILE_READ_BATCH_SIZE } from '@/utils/constants.js'

/**
 * Options for coverage fix functions
 */
export interface CoverageFixOptions {
  createEmptyCoverage: (filePath: string, sourceCode: string) => Promise<CoverageMapData | null>
}

/**
 * Fix files that have function coverage but empty statement maps
 * This happens with simple JSX components where source map transformation
 * loses statement boundaries. We re-parse the original source to get proper statements.
 */
export async function fixEmptyStatementMaps(
  coverageMap: CoverageMap,
  options: CoverageFixOptions
): Promise<void> {
  const endTimer = createTimer('fixEmptyStatementMaps')
  const { promises: fs } = await import('node:fs')

  const files = coverageMap.files()

  // Pre-analyze which files need source code
  const filesToRead: string[] = []
  const fileAnalysis = new Map<string, {
    data: {
      path: string
      statementMap: Record<string, unknown>
      branchMap: Record<string, unknown>
      fnMap: Record<string, unknown>
      s: Record<string, number>
      b: Record<string, number[]>
      f: Record<string, number>
    }
    hasStatements: boolean
    hasBranches: boolean
    hasFunctions: boolean
    anyFunctionExecuted: boolean
    needsSourceRead: boolean
  }>()

  for (const filePath of files) {
    const fileCoverage = coverageMap.fileCoverageFor(filePath)
    const data = fileCoverage.toJSON() as {
      path: string
      statementMap: Record<string, unknown>
      branchMap: Record<string, unknown>
      fnMap: Record<string, unknown>
      s: Record<string, number>
      b: Record<string, number[]>
      f: Record<string, number>
    }

    const hasStatements = Object.keys(data.statementMap).length > 0
    const hasBranches = Object.keys(data.branchMap).length > 0
    const hasFunctions = Object.keys(data.fnMap).length > 0
    const anyFunctionExecuted = Object.values(data.f).some((count) => count > 0)

    // Determine if we need to read this file's source
    const needsSourceRead =
      (hasFunctions && (!hasStatements || !hasBranches)) ||
      (!hasFunctions && !hasBranches && !hasStatements)

    if (needsSourceRead) {
      filesToRead.push(filePath)
    }

    fileAnalysis.set(filePath, {
      data,
      hasStatements,
      hasBranches,
      hasFunctions,
      anyFunctionExecuted,
      needsSourceRead,
    })
  }

  // Batch read all source files in parallel
  const sourceCache = new Map<string, string>()
  if (filesToRead.length > 0) {
    for (let i = 0; i < filesToRead.length; i += FILE_READ_BATCH_SIZE) {
      const batch = filesToRead.slice(i, i + FILE_READ_BATCH_SIZE)
      const results = await Promise.all(
        batch.map(async (filePath) => {
          try {
            const content = await fs.readFile(filePath, 'utf-8')
            return { filePath, content }
          } catch {
            // File read failed - expected for missing or inaccessible files
            return { filePath, content: null }
          }
        })
      )
      for (const { filePath, content } of results) {
        if (content !== null) {
          sourceCache.set(filePath, content)
        }
      }
    }
  }

  // Now process each file using cached sources
  for (const filePath of files) {
    const analysis = fileAnalysis.get(filePath)!
    const { data, hasStatements, hasBranches, hasFunctions, anyFunctionExecuted } = analysis

    // If function was executed but statements or branches are missing, re-parse original source
    if (hasFunctions && (!hasStatements || !hasBranches)) {
      const sourceCode = sourceCache.get(filePath)
      if (!sourceCode) continue

      try {

        // Re-generate coverage with proper statement/branch maps using Babel
        const fixedCoverage = await options.createEmptyCoverage(filePath, sourceCode)

        if (fixedCoverage && fixedCoverage[filePath]) {
          const fixed = fixedCoverage[filePath] as {
            statementMap: Record<string, unknown>
            branchMap: Record<string, unknown>
            s: Record<string, number>
            b: Record<string, number[]>
            f: Record<string, number>
          }

          // Copy missing statement map
          if (!hasStatements) {
            data.statementMap = fixed.statementMap
            for (const stmtId of Object.keys(fixed.s)) {
              data.s[stmtId] = anyFunctionExecuted ? 1 : 0
            }
          }

          // Copy missing branch map and add implicit branch for all files with functions
          if (!hasBranches) {
            if (Object.keys(fixed.branchMap).length > 0) {
              // File has real branches - copy them
              data.branchMap = fixed.branchMap
              for (const branchId of Object.keys(fixed.b)) {
                data.b[branchId] = anyFunctionExecuted
                  ? fixed.b[branchId].map((_, i) => (i === 0 ? 1 : 0))
                  : new Array(fixed.b[branchId].length).fill(0)
              }
            } else {
              // File has no real branches - add implicit "file loaded" branch
              // This prevents misleading "100% Branches 0/0" display
              data.branchMap = {
                '0': {
                  type: 'if',
                  loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
                  locations: [
                    { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
                  ],
                },
              }
              data.b['0'] = anyFunctionExecuted ? [1] : [0] // 1 if loaded, 0 if not
            }
          }
        }
      } catch (error) {
        log(`  Skipping file ${filePath}: ${error instanceof Error ? error.message : 'unknown error'}`)
      }
    }

    // If the module was loaded (functions executed), mark module-level statements as covered
    // This handles cases like: export const dynamic = 'force-dynamic'
    if (hasFunctions && anyFunctionExecuted) {
      const allStatementsUncovered = Object.values(data.s).every((count) => count === 0)
      if (allStatementsUncovered && Object.keys(data.s).length > 0) {
        for (const stmtId of Object.keys(data.s)) {
          data.s[stmtId] = 1
        }
      }
    }

    // Handle files with no functions (e.g., barrel export files like index.ts)
    // These still need an implicit branch to avoid "100% 0/0"
    if (!hasFunctions && !hasBranches) {
      // Check if any statement was covered (indicates module was loaded)
      const anyStatementCovered = hasStatements && Object.values(data.s).some((count) => count > 0)

      // For completely empty files (no statements either), try to re-parse
      if (!hasStatements) {
        const sourceCode = sourceCache.get(filePath)
        if (sourceCode) {
          try {
            const fixedCoverage = await options.createEmptyCoverage(filePath, sourceCode)
            if (fixedCoverage && fixedCoverage[filePath]) {
              const fixed = fixedCoverage[filePath] as {
                statementMap: Record<string, unknown>
                s: Record<string, number>
              }
              data.statementMap = fixed.statementMap
              for (const stmtId of Object.keys(fixed.s)) {
                data.s[stmtId] = 0 // Mark as uncovered
              }
            }
          } catch (error) {
            log(`  Skipping file ${filePath}: ${error instanceof Error ? error.message : 'unknown error'}`)
          }
        }
      }

      // Add implicit branch
      data.branchMap = {
        '0': {
          type: 'if',
          loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
          locations: [{ start: { line: 1, column: 0 }, end: { line: 1, column: 0 } }],
        },
      }
      data.b['0'] = anyStatementCovered ? [1] : [0]
    }
  }
  endTimer()
}

/**
 * Filter JSX array method callbacks to match Vitest's behavior.
 *
 * Vitest's ast-v8-to-istanbul filters arrow functions whose bodies don't have source mappings.
 * In browser/E2E tests, these same functions are NOT filtered by ast-v8-to-istanbul.
 *
 * These are typically `.map()`, `.filter()`, `.reduce()`, etc. callbacks with JSX bodies like:
 *   items.map((item) => <div>{item}</div>)
 *
 * We identify them by checking if the function is on a line containing these array method calls.
 */
export async function filterJsxArrayMethodCallbacks(coverageMap: CoverageMap): Promise<void> {
  const endTimer = createTimer('filterJsxArrayMethodCallbacks')
  const { promises: fs } = await import('node:fs')

  const files = coverageMap.files()

  // Only process JSX/TSX files
  const jsxFiles = files.filter(f => f.endsWith('.tsx') || f.endsWith('.jsx'))

  for (const filePath of jsxFiles) {
    const fileCoverage = coverageMap.fileCoverageFor(filePath)
    const data = fileCoverage.toJSON() as {
      fnMap: Record<string, {
        name: string
        loc: { start: { line: number; column?: number | null }; end: { line: number; column?: number | null } }
      }>
      f: Record<string, number>
      statementMap: Record<string, {
        start: { line: number; column?: number | null }
        end: { line: number; column?: number | null }
      }>
      s: Record<string, number>
    }

    const { fnMap, f, statementMap, s } = data

    // Read source file to check which lines contain array method calls
    let sourceCode: string
    try {
      sourceCode = await fs.readFile(filePath, 'utf-8')
    } catch {
      continue // Skip if can't read source
    }

    const sourceLines = sourceCode.split('\n')
    const functionsToRemove: Array<{
      id: string
      loc: { start: { line: number; column?: number | null }; end: { line: number; column?: number | null } }
    }> = []

    // Check each anonymous function
    for (const [id, fn] of Object.entries(fnMap)) {
      // Only check anonymous arrow functions
      if (!fn.name.startsWith('(anonymous_')) continue

      const line = fn.loc?.start?.line
      if (!line || line < 1 || line > sourceLines.length) continue

      // Get the source line (1-indexed to 0-indexed)
      const sourceLine = sourceLines[line - 1]

      // Also check the previous line since the function might start on the next line
      // Example: .map((item) => (
      //            <div>...</div>  <- function body starts here
      const prevLine = line > 1 ? sourceLines[line - 2] : ''

      // Check if this line or the previous line contains array method calls
      // Match: .map(, .filter(, .reduce(, .forEach(, .find(, .some(, .every(
      const arrayMethodPattern = /\.(map|filter|reduce|forEach|find|some|every)\s*\(/
      const hasArrayMethod = arrayMethodPattern.test(sourceLine) || arrayMethodPattern.test(prevLine)

      if (!hasArrayMethod) continue

      // Check if the arrow function body contains JSX
      // Look for: => <something or => ( with < on next line
      // This filters out non-JSX callbacks like .filter((c) => c !== cuisine)
      const jsxPattern = /=>\s*[(<]/
      const nextLine = line < sourceLines.length ? sourceLines[line] : ''
      const hasJsx = jsxPattern.test(sourceLine) ||
                     jsxPattern.test(prevLine) ||
                     (sourceLine.includes('=>') && nextLine.trim().startsWith('<'))

      if (hasJsx) {
        functionsToRemove.push({ id, loc: fn.loc })
      }
    }

    // Remove the identified functions and their statements
    for (const { id, loc } of functionsToRemove) {
      delete fnMap[id]
      delete f[id]

      // Also remove statements that fall within this function's range
      // This matches Vitest's behavior of filtering both functions and their statements
      if (loc?.start?.line && loc?.end?.line) {
        const startLine = loc.start.line
        const endLine = loc.end.line

        for (const [stmtId, stmtLoc] of Object.entries(statementMap)) {
          const stmtStartLine = stmtLoc?.start?.line
          if (stmtStartLine && stmtStartLine >= startLine && stmtStartLine <= endLine) {
            delete statementMap[stmtId]
            delete s[stmtId]
          }
        }
      }
    }
  }

  endTimer()
}

/**
 * Fix spurious branches that don't exist in the original source code.
 *
 * This handles cases where source map mappings incorrectly map transpiled
 * LogicalExpressions to lines in the original source that only contain
 * arithmetic expressions (BinaryExpression with *, /, +, -).
 *
 * We parse the original source and check each branch location - if the
 * original source at that location doesn't contain a LogicalExpression,
 * we remove the branch.
 */
export async function fixSpuriousBranches(coverageMap: CoverageMap): Promise<void> {
  const endTimer = createTimer('fixSpuriousBranches')
  const { promises: fs } = await import('node:fs')

  const files = coverageMap.files()

  // Pre-analyze which files need source code (have binary-expr branches)
  type BranchData = {
    path: string
    branchMap: Record<
      string,
      {
        type: string
        loc: { start: { line: number; column: number }; end: { line: number; column: number | null } }
        locations: Array<{
          start: { line: number; column: number }
          end: { line: number; column: number | null }
        }>
        line?: number
      }
    >
    b: Record<string, number[]>
  }
  const filesToRead: string[] = []
  const fileDataMap = new Map<string, BranchData>()

  for (const filePath of files) {
    const fileCoverage = coverageMap.fileCoverageFor(filePath)
    const data = fileCoverage.toJSON() as BranchData

    const branchCount = Object.keys(data.branchMap).length
    if (branchCount === 0) continue

    // Check if file has any binary-expr branches
    const hasBinaryExprBranch = Object.values(data.branchMap).some(b => b.type === 'binary-expr')
    if (hasBinaryExprBranch) {
      filesToRead.push(filePath)
      fileDataMap.set(filePath, data)
    }
  }

  // Batch read all needed source files in parallel
  const sourceCache = new Map<string, string>()
  if (filesToRead.length > 0) {
    for (let i = 0; i < filesToRead.length; i += FILE_READ_BATCH_SIZE) {
      const batch = filesToRead.slice(i, i + FILE_READ_BATCH_SIZE)
      const results = await Promise.all(
        batch.map(async (filePath) => {
          try {
            const content = await fs.readFile(filePath, 'utf-8')
            return { filePath, content }
          } catch {
            // File read failed - expected for missing or inaccessible files
            return { filePath, content: null }
          }
        })
      )
      for (const { filePath, content } of results) {
        if (content !== null) {
          sourceCache.set(filePath, content)
        }
      }
    }
  }

  // Process each file using cached sources
  for (const filePath of filesToRead) {
    const data = fileDataMap.get(filePath)!
    const sourceCode = sourceCache.get(filePath)
    if (!sourceCode) continue

    // Parse the original source to find real logical expressions
    const realLogicalExprLines = findLogicalExpressionLines(sourceCode, filePath)

    // Check each branch and remove spurious ones
    const branchesToRemove: string[] = []

    for (const [branchId, branch] of Object.entries(data.branchMap)) {
      // Only check binary-expr branches (these are LogicalExpression branches)
      if (branch.type !== 'binary-expr') continue

      const branchLine = branch.line || branch.loc?.start?.line
      if (!branchLine) continue

      // Check if this line has a real logical expression in the original source
      if (!realLogicalExprLines.has(branchLine)) {
        // This branch doesn't exist in the original source - it's spurious
        branchesToRemove.push(branchId)
      }
    }

    // Remove spurious branches
    if (branchesToRemove.length > 0) {
      for (const branchId of branchesToRemove) {
        delete data.branchMap[branchId]
        delete data.b[branchId]
      }

      // Re-index branches to be sequential (0, 1, 2, ...)
      const oldBranchMap = data.branchMap
      const oldB = data.b
      data.branchMap = {}
      data.b = {}

      let newIndex = 0
      for (const [, branch] of Object.entries(oldBranchMap)) {
        const oldId = Object.keys(oldBranchMap).find((k) => oldBranchMap[k] === branch)!
        data.branchMap[String(newIndex)] = branch
        data.b[String(newIndex)] = oldB[oldId]
        newIndex++
      }

      // Update the coverage map
      coverageMap.addFileCoverage(data as CoverageMapData[string])
    }
  }
  endTimer()
}

/**
 * Parse source code and find all lines that contain LogicalExpression (||, &&, ??)
 */
export function findLogicalExpressionLines(sourceCode: string, filePath: string): Set<number> {
  const lines = new Set<number>()

  try {
    const isTypeScript = filePath.endsWith('.ts') || filePath.endsWith('.tsx')
    const isJSX = filePath.endsWith('.tsx') || filePath.endsWith('.jsx')

    // Parse with Babel to support TypeScript/JSX
    const ast = babelParse(sourceCode, {
      sourceType: 'module',
      plugins: [
        ...(isTypeScript ? (['typescript'] as const) : []),
        ...(isJSX ? (['jsx'] as const) : []),
        'decorators-legacy' as const,
      ],
      errorRecovery: true,
    })

    // Walk the AST to find LogicalExpression nodes
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return

      const n = node as { type?: string; loc?: { start?: { line?: number } }; [key: string]: unknown }

      if (n.type === 'LogicalExpression') {
        // This is a real logical expression (||, &&, ??)
        if (n.loc?.start?.line) {
          lines.add(n.loc.start.line)
        }
      }

      // Recurse into child nodes
      for (const key of Object.keys(n)) {
        if (key === 'loc' || key === 'start' || key === 'end') continue
        const child = n[key]
        if (Array.isArray(child)) {
          for (const item of child) {
            walk(item)
          }
        } else if (child && typeof child === 'object') {
          walk(child)
        }
      }
    }

    walk(ast)
  } catch (error) {
    // If parsing fails, return empty set (don't remove any branches)
    log(`  Failed to parse ${filePath} for branch analysis: ${error instanceof Error ? error.message : 'unknown error'}`)
  }

  return lines
}

/**
 * Remove phantom branches created by webpack module wrappers.
 *
 * When webpack bundles async modules, it wraps them in try/catch blocks:
 *   __webpack_require__.a(module, async (deps, result) => { try { ... } });
 *
 * V8 sees the "try" as a branch point and records it. When source-mapped back,
 * these get attributed to line 1, column 0 of the original source file with
 * zero length (since there's no corresponding source code).
 *
 * These phantom branches:
 * - Have type "if" (from the try block's conditional behavior)
 * - Are located at exactly line 1, column 0
 * - Have zero-length location (start === end === 1:0)
 * - Don't represent any real branching logic in the source
 *
 * We filter these out to get accurate branch counts that match unit tests.
 */
export function removePhantomBranches(coverageMap: CoverageMap): void {
  const endTimer = createTimer('removePhantomBranches')
  let totalRemoved = 0

  for (const filePath of coverageMap.files()) {
    const fileCoverage = coverageMap.fileCoverageFor(filePath)
    const data = (fileCoverage as unknown as { data: CoverageMapData[string] }).data
    const branchMap = data.branchMap as Record<
      string,
      {
        type: string
        loc: { start: { line: number; column: number }; end: { line: number; column: number } }
      }
    >
    const b = data.b as Record<string, number[]>

    const branchesToRemove: string[] = []

    for (const [branchId, branch] of Object.entries(branchMap)) {
      // Check for phantom branch signature:
      // - type is "if"
      // - location is exactly line 1, column 0
      // - zero length (end equals start)
      if (
        branch.type === 'if' &&
        branch.loc.start.line === 1 &&
        branch.loc.start.column === 0 &&
        branch.loc.end.line === 1 &&
        branch.loc.end.column === 0
      ) {
        branchesToRemove.push(branchId)
      }
    }

    for (const branchId of branchesToRemove) {
      delete branchMap[branchId]
      delete b[branchId]
      totalRemoved++
    }
  }

  if (totalRemoved > 0) {
    log(`  Removed ${totalRemoved} phantom branches from webpack module wrappers`)
  }
  endTimer()
}

/**
 * Fix function declaration statements that have 0 hits but the function has calls.
 *
 * Next.js 15 inserts TURBOPACK_DISABLE_EXPORT_MERGING comments in server actions:
 * - `async function /*#__TURBOPACK...*\/ getAllTodos() {`
 * - `const /*#__TURBOPACK...*\/ getHeaders = async () => {`
 *
 * This causes V8 to not properly track the function declaration statement coverage.
 * We fix this by copying the function call count to matching statement entries.
 */
export function fixFunctionDeclarationStatements(coverageMap: CoverageMap): void {
  for (const filePath of coverageMap.files()) {
    const fileCoverage = coverageMap.fileCoverageFor(filePath)
    // Access the internal data directly to modify in place
    // (toJSON returns a copy, which would cause double-counting when merged back)
    const data = (fileCoverage as unknown as { data: CoverageMapData[string] }).data
    const statementMap = data.statementMap as Record<
      string,
      {
        start: { line: number; column: number }
        end: { line: number; column: number | null }
      }
    >
    const fnMap = data.fnMap as Record<
      string,
      {
        name: string
        decl: {
          start: { line: number; column: number }
          end: { line: number; column: number | null }
        }
        loc: {
          start: { line: number; column: number }
          end: { line: number; column: number | null }
        }
        line: number
      }
    >
    const s = data.s as Record<string, number>
    const f = data.f as Record<string, number>

    // For each function with calls, find statements on the same line that have 0 hits
    for (const [fnId, fn] of Object.entries(fnMap)) {
      const fnCalls = f[fnId] || 0
      if (fnCalls === 0) continue // No need to fix if function wasn't called

      const fnLine = fn.decl?.start?.line
      if (fnLine === undefined) continue

      // Find statements on the same line with 0 hits
      for (const [stmtId, stmt] of Object.entries(statementMap)) {
        const stmtLine = stmt.start?.line
        if (stmtLine !== fnLine) continue

        const currentHits = s[stmtId] || 0
        if (currentHits === 0) {
          // Statement has 0 hits but function on same line was called - fix it
          s[stmtId] = fnCalls
        }
      }
    }
  }
}

/**
 * Remove duplicate function entries created by V8 CDP for arrow function exports.
 *
 * V8's Chrome DevTools Protocol creates duplicate function entries for arrow function exports:
 * - One for the arrow function body (e.g., line 28-42)
 * - One for the export binding/assignment (e.g., line 27-42)
 *
 * The export binding often has 0 execution count even though the function was called,
 * causing incorrect function coverage percentages (e.g., 4/6 = 66% instead of 3/3 = 100%).
 *
 * This fix detects duplicates by matching declaration positions and removes the ones
 * with lower execution counts, preferring function bodies over export bindings.
 */
export function removeDuplicateFunctionEntries(coverageMap: CoverageMap): void {
  for (const filePath of coverageMap.files()) {
    const fileCoverage = coverageMap.fileCoverageFor(filePath)
    const data = (fileCoverage as unknown as { data: CoverageMapData[string] }).data
    const fnMap = data.fnMap as Record<
      string,
      {
        name: string
        decl: {
          start: { line: number; column: number }
          end: { line: number; column: number | null }
        }
        loc: {
          start: { line: number; column: number }
          end: { line: number; column: number | null }
        }
        line: number
      }
    >
    const f = data.f as Record<string, number>

    // Group functions by declaration position (line:column)
    const byPosition = new Map<
      string,
      Array<{
        id: string
        fn: (typeof fnMap)[string]
        count: number
        bodyStartLine: number | undefined
      }>
    >()

    for (const [id, fn] of Object.entries(fnMap)) {
      const declStart = fn.decl?.start
      if (!declStart) continue

      const key = `${declStart.line}:${declStart.column}`
      if (!byPosition.has(key)) {
        byPosition.set(key, [])
      }

      byPosition.get(key)!.push({
        id,
        fn,
        count: f[id] || 0,
        bodyStartLine: fn.loc?.start?.line,
      })
    }

    // For each position with multiple functions, keep only the best one
    for (const [, functions] of byPosition) {
      if (functions.length <= 1) continue

      // Sort to find the best function to keep:
      // 1. Prefer higher execution count
      // 2. If tied, prefer function body starting on different line (actual function)
      //    vs. body starting on same line (export binding)
      functions.sort((a, b) => {
        // Primary: highest execution count wins
        if (a.count !== b.count) return b.count - a.count

        // Secondary: prefer function body on different line than declaration
        // (export bindings have body starting on same line as declaration)
        const aDeclLine = a.fn.decl.start.line
        const bDeclLine = b.fn.decl.start.line
        const aBodyOnSameLine = a.bodyStartLine === aDeclLine
        const bBodyOnSameLine = b.bodyStartLine === bDeclLine

        if (aBodyOnSameLine !== bBodyOnSameLine) {
          return aBodyOnSameLine ? 1 : -1 // Prefer body on different line
        }

        return 0
      })

      // Keep the first (best) function, remove all others
      for (let i = 1; i < functions.length; i++) {
        delete fnMap[functions[i].id]
        delete f[functions[i].id]
      }
    }
  }
}
