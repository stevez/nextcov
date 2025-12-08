/**
 * V8 to Istanbul Coverage Converter
 *
 * Converts V8 coverage data to Istanbul format using ast-v8-to-istanbul.
 * This is the core of the coverage processing, mirroring Vitest's approach.
 */

import { join, resolve, sep } from 'node:path'
import { parse } from 'acorn'
import { parse as babelParse } from '@babel/parser'
import astV8ToIstanbul from 'ast-v8-to-istanbul'
import libCoverage from 'istanbul-lib-coverage'
import libSourceMaps from 'istanbul-lib-source-maps'
import { decode, encode, type SourceMapMappings } from '@jridgewell/sourcemap-codec'
import type { CoverageMap, CoverageMapData } from 'istanbul-lib-coverage'
import type { V8Coverage, V8ScriptCoverage, SourceMapData, SourceFilter } from './types.js'
import { SourceMapLoader } from './sourcemap-loader.js'

export class CoverageConverter {
  private sourceMapLoader: SourceMapLoader
  private sourceFilter?: SourceFilter
  private projectRoot: string

  constructor(projectRoot: string, sourceMapLoader: SourceMapLoader, sourceFilter?: SourceFilter) {
    this.projectRoot = projectRoot
    this.sourceMapLoader = sourceMapLoader
    this.sourceFilter = sourceFilter
  }

  /**
   * Convert V8 coverage to Istanbul coverage map
   */
  async convert(coverage: V8Coverage): Promise<CoverageMap> {
    const coverageMap = libCoverage.createCoverageMap({})

    // Load source maps from V8 cache if available
    this.sourceMapLoader.loadFromV8Cache(coverage)

    // Process each script coverage entry
    for (const entry of coverage.result) {
      try {
        const istanbulCoverage = await this.convertEntry(entry)
        if (istanbulCoverage && Object.keys(istanbulCoverage).length > 0) {
          coverageMap.merge(istanbulCoverage)
        }
      } catch (error) {
        console.warn(`Failed to convert coverage for ${entry.url}:`, error)
      }
    }

    // Normalize file paths to Windows format for merging with Vitest coverage
    // Note: We skip transformWithSourceMaps because ast-v8-to-istanbul already
    // applies source maps during conversion. We just need to fix the paths.
    const normalizedMap = this.normalizeFilePaths(coverageMap)

    // Note: We don't apply the sourceFilter here because extractSourcePath
    // already filters to only keep files with src/ in their path.

    // Fix files with empty statement maps by re-parsing original source
    // This handles simple JSX components where source map loses statement info
    await this.fixEmptyStatementMaps(normalizedMap)

    // Fix spurious branches that don't exist in the original source
    // This handles source map artifacts where arithmetic expressions get mapped as branches
    await this.fixSpuriousBranches(normalizedMap)

    return normalizedMap
  }

  /**
   * Fix files that have function coverage but empty statement maps
   * This happens with simple JSX components where source map transformation
   * loses statement boundaries. We re-parse the original source to get proper statements.
   */
  private async fixEmptyStatementMaps(coverageMap: CoverageMap): Promise<void> {
    const { promises: fs } = await import('node:fs')

    for (const filePath of coverageMap.files()) {
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

      // Check if this file has functions but missing statements or branches
      const hasStatements = Object.keys(data.statementMap).length > 0
      const hasBranches = Object.keys(data.branchMap).length > 0
      const hasFunctions = Object.keys(data.fnMap).length > 0

      // Check if any function was executed (indicates module was loaded)
      const anyFunctionExecuted = Object.values(data.f).some((count) => count > 0)

      // If function was executed but statements or branches are missing, re-parse original source
      if (hasFunctions && (!hasStatements || !hasBranches)) {
        try {
          // Read the original source file
          const sourceCode = await fs.readFile(filePath, 'utf-8')

          // Re-generate coverage with proper statement/branch maps using Babel
          const fixedCoverage = await this.createEmptyCoverage(filePath, sourceCode)

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
        } catch {
          // File might not exist or be readable, skip
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
          try {
            const sourceCode = await fs.readFile(filePath, 'utf-8')
            const fixedCoverage = await this.createEmptyCoverage(filePath, sourceCode)
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
          } catch {
            // Skip if file can't be read
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
  private async fixSpuriousBranches(coverageMap: CoverageMap): Promise<void> {
    const { promises: fs } = await import('node:fs')

    for (const filePath of coverageMap.files()) {
      const fileCoverage = coverageMap.fileCoverageFor(filePath)
      const data = fileCoverage.toJSON() as {
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

      const branchCount = Object.keys(data.branchMap).length
      if (branchCount === 0) continue

      // Read the original source file
      let sourceCode: string
      try {
        sourceCode = await fs.readFile(filePath, 'utf-8')
      } catch {
        continue // Skip if file can't be read
      }

      // Parse the original source to find real logical expressions
      const realLogicalExprLines = this.findLogicalExpressionLines(sourceCode, filePath)

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
  }

  /**
   * Parse source code and find all lines that contain LogicalExpression (||, &&, ??)
   */
  private findLogicalExpressionLines(sourceCode: string, filePath: string): Set<number> {
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
    } catch {
      // If parsing fails, return empty set (don't remove any branches)
    }

    return lines
  }

  /**
   * Normalize file paths in coverage map to Windows absolute paths
   * This ensures compatibility with Vitest's output format for merging
   *
   * Handles paths like:
   * - C:\...\.next\static\chunks\app\(auth)\register\src\app\(auth)\register\page.tsx
   * Should become:
   * - C:\...\src\app\(auth)\register\page.tsx
   */
  private normalizeFilePaths(coverageMap: CoverageMap): CoverageMap {
    const normalizedMap = libCoverage.createCoverageMap({})

    for (const filePath of coverageMap.files()) {
      const fileCoverage = coverageMap.fileCoverageFor(filePath)
      const data = fileCoverage.toJSON() as CoverageMapData[string]

      // Extract the src/... portion from malformed paths
      const normalizedPath = this.extractSourcePath(filePath)

      if (!normalizedPath) {
        // Skip files that don't have a valid src path
        continue
      }

      // Update path in coverage data
      data.path = normalizedPath

      // Add to new map with normalized path
      normalizedMap.addFileCoverage(data)
    }

    return normalizedMap
  }

  /**
   * Extract the actual source path from a potentially malformed path
   * e.g. ".next\static\chunks\app\...\src\app\page.tsx" -> "C:\...\src\app\page.tsx"
   */
  private extractSourcePath(filePath: string): string | null {
    // Normalize to forward slashes for consistent matching
    const normalized = filePath.replace(/\\/g, '/')

    // Skip non-JS/TS files (like CSS)
    if (!/\.(ts|tsx|js|jsx)$/.test(normalized)) {
      return null
    }

    // Look for the LAST occurrence of /src/ in the path
    // to handle cases like ".../src/src/lib/..." which should become "src/lib/..."
    const lastSrcIndex = normalized.lastIndexOf('/src/')

    if (lastSrcIndex !== -1) {
      // Extract from src/ onwards (skip the leading /)
      const srcRelative = normalized.substring(lastSrcIndex + 1)
      let absolutePath = resolve(this.projectRoot, srcRelative)

      // Normalize path separators based on platform
      if (sep === '\\') {
        // Windows: ensure backslashes and uppercase drive letter
        absolutePath = absolutePath.replace(/\//g, '\\')
        if (/^[a-z]:/.test(absolutePath)) {
          absolutePath = absolutePath.charAt(0).toUpperCase() + absolutePath.slice(1)
        }
      }

      return absolutePath
    }

    // If no src/ found, skip this file (it's likely a Next.js internal file)
    return null
  }

  /**
   * Convert a single V8 script coverage entry to Istanbul format
   */
  async convertEntry(entry: V8ScriptCoverage): Promise<CoverageMapData | null> {
    const { url, functions, source } = entry

    // Load source code and source map
    let code = source
    let sourceMap: SourceMapData | undefined
    let filePath: string | null = null

    if (!code) {
      const sourceFile = await this.sourceMapLoader.loadSource(url)
      if (!sourceFile) {
        return null
      }
      code = sourceFile.code
      sourceMap = sourceFile.sourceMap
      filePath = sourceFile.path
    } else {
      // Try to load source map from disk first
      const sourceFile = await this.sourceMapLoader.loadSource(url)
      if (sourceFile?.sourceMap) {
        sourceMap = sourceFile.sourceMap
        filePath = sourceFile.path
      } else {
        // No disk file (dev mode) - try to extract inline sourcemap from the source
        sourceMap = this.sourceMapLoader.extractInlineSourceMap(code) || undefined
        filePath = this.sourceMapLoader.urlToFilePath(url)
      }
    }

    // If we couldn't resolve a file path, try to extract from URL
    if (!filePath) {
      filePath = this.sourceMapLoader.urlToFilePath(url)
    }

    // For ast-v8-to-istanbul, we need a file:// URL, not http://
    // Convert the URL to a proper file path for the coverage data
    const coverageUrl = filePath ? this.toFileUrl(filePath) : url

    // Parse AST
    let ast
    try {
      ast = parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowHashBang: true,
        allowAwaitOutsideFunction: true,
        allowImportExportEverywhere: true,
        allowReserved: true,
        locations: true,
      })
    } catch (parseError) {
      return null
    }

    // Sanitize source map to fix empty source entries
    const sanitizedSourceMap = sourceMap ? this.sanitizeSourceMap(sourceMap) : undefined

    // If source map was rejected as problematic, skip this file entirely
    // Next.js production builds have complex source maps with external references
    // that ast-v8-to-istanbul cannot process
    if (sourceMap && !sanitizedSourceMap) {
      return null
    }

    // Convert using ast-v8-to-istanbul
    try {
      const istanbulCoverage = await astV8ToIstanbul({
        code,
        ast,
        sourceMap: sanitizedSourceMap,
        coverage: {
          url: coverageUrl,
          functions,
        },
        wrapperLength: 0,
        ignoreClassMethods: [],
        ignoreNode: (node, type) => this.shouldIgnoreNode(node, type),
      })

      return istanbulCoverage as CoverageMapData
    } catch (convertError) {
      return null
    }
  }

  /**
   * Clean source map by filtering out problematic sources AND their mappings
   *
   * ast-v8-to-istanbul throws "Missing original filename" when ANY mapping
   * resolves to a null/empty source. We decode VLQ mappings, filter out
   * segments referencing invalid sources, then re-encode.
   */
  private sanitizeSourceMap(sourceMap: SourceMapData): SourceMapData | undefined {
    if (!sourceMap.sources || sourceMap.sources.length === 0) {
      return undefined
    }

    // Step 1: Identify valid source indices
    const validSourceIndices = new Set<number>()

    for (let i = 0; i < sourceMap.sources.length; i++) {
      const source = sourceMap.sources[i]
      const content = sourceMap.sourcesContent?.[i]
      if (this.isValidSource(source, content)) {
        validSourceIndices.add(i)
      }
    }

    // If no valid sources, skip this entry
    if (validSourceIndices.size === 0) {
      return undefined
    }

    // If all sources are valid, just normalize and return
    if (validSourceIndices.size === sourceMap.sources.length) {
      const normalizedSources = sourceMap.sources.map((source) => {
        return this.sourceMapLoader.normalizeSourcePath(source)
      })
      return {
        ...sourceMap,
        sources: normalizedSources,
      }
    }

    // Step 2: Decode mappings to filter out bad source references
    let decodedMappings: SourceMapMappings
    try {
      decodedMappings = decode(sourceMap.mappings)
    } catch {
      return undefined
    }

    // Step 3: Build old->new source index mapping
    const oldToNewIndex = new Map<number, number>()
    let newIndex = 0
    for (let i = 0; i < sourceMap.sources.length; i++) {
      if (validSourceIndices.has(i)) {
        oldToNewIndex.set(i, newIndex++)
      }
    }

    // Step 4: Filter and remap segments
    const filteredMappings: SourceMapMappings = []
    for (const line of decodedMappings) {
      const filteredLine: typeof line = []
      for (const segment of line) {
        if (segment.length === 1) {
          filteredLine.push(segment)
        } else if (segment.length >= 4) {
          const sourceIndex = segment[1]
          if (validSourceIndices.has(sourceIndex)) {
            const newSourceIndex = oldToNewIndex.get(sourceIndex)!
            if (segment.length === 4) {
              filteredLine.push([segment[0], newSourceIndex, segment[2], segment[3]])
            } else {
              filteredLine.push([segment[0], newSourceIndex, segment[2], segment[3], segment[4]])
            }
          }
        }
      }
      filteredMappings.push(filteredLine)
    }

    // Step 5: Re-encode mappings
    let encodedMappings: string
    try {
      encodedMappings = encode(filteredMappings)
    } catch {
      return undefined
    }

    // Step 6: Build new source map with only valid sources
    const newSources: string[] = []
    const newSourcesContent: (string | null)[] = []
    for (let i = 0; i < sourceMap.sources.length; i++) {
      if (validSourceIndices.has(i)) {
        newSources.push(this.sourceMapLoader.normalizeSourcePath(sourceMap.sources[i]))
        newSourcesContent.push(sourceMap.sourcesContent?.[i] ?? null)
      }
    }

    return {
      ...sourceMap,
      sources: newSources,
      sourcesContent: newSourcesContent,
      mappings: encodedMappings,
    }
  }

  /**
   * Check if a source is valid for coverage
   */
  private isValidSource(source: string | null, content?: string | null): boolean {
    // Empty or null source - causes "Missing original filename" error
    if (!source || source.trim() === '') {
      return false
    }

    // Webpack externals
    if (source.startsWith('external ') || source.includes('external%20commonjs')) {
      return false
    }

    // Webpack internal queries
    if (source.startsWith('webpack://') && source.includes('?')) {
      return false
    }

    // Absolute Windows paths not in our project
    if (/^[A-Z]:[/\\]/.test(source)) {
      if (!source.startsWith(this.projectRoot)) {
        return false
      }
    }

    const normalizedSource = this.sourceMapLoader.normalizeSourcePath(source)

    // Skip node_modules
    if (normalizedSource.includes('node_modules/') || normalizedSource.includes('node_modules\\')) {
      return false
    }

    // Must contain src/ - our code (check both original and normalized)
    if (!normalizedSource.includes('src/') && !source.includes('/src/') && !source.includes('\\src\\')) {
      return false
    }

    // Sources without content cannot be processed
    if (!content || typeof content !== 'string') {
      return false
    }

    return true
  }

  /**
   * Convert a file path to a proper file:// URL
   */
  private toFileUrl(filePath: string): string {
    // Already a file:// URL
    if (filePath.startsWith('file://')) {
      return filePath
    }

    // Windows absolute path (e.g., C:\Users\...)
    if (/^[a-zA-Z]:/.test(filePath)) {
      // Convert to file:///C:/Users/... format
      return `file:///${filePath.replace(/\\/g, '/')}`
    }

    // Unix absolute path
    if (filePath.startsWith('/')) {
      return `file://${filePath}`
    }

    // Relative path - make it absolute first
    const absolutePath = join(this.projectRoot, filePath)
    if (/^[a-zA-Z]:/.test(absolutePath)) {
      return `file:///${absolutePath.replace(/\\/g, '/')}`
    }
    return `file://${absolutePath}`
  }

  /**
   * Determine if a node should be ignored in coverage
   * Mirrors Vitest's ignoreNode logic for SSR/bundler artifacts
   */
  private shouldIgnoreNode(node: any, type: string): boolean | 'ignore-this-and-nested-nodes' {
    // Webpack require expressions
    if (
      type === 'statement' &&
      node.type === 'ExpressionStatement' &&
      node.expression?.type === 'CallExpression' &&
      node.expression.callee?.name === '__webpack_require__'
    ) {
      return true
    }

    // Next.js internal module registration
    if (
      type === 'statement' &&
      node.type === 'ExpressionStatement' &&
      node.expression?.type === 'CallExpression' &&
      node.expression.callee?.type === 'MemberExpression' &&
      node.expression.callee.object?.name === '__webpack_exports__'
    ) {
      return true
    }

    // CommonJS module.exports
    if (
      type === 'statement' &&
      node.type === 'ExpressionStatement' &&
      node.expression?.type === 'AssignmentExpression' &&
      node.expression.left?.type === 'MemberExpression' &&
      node.expression.left.object?.name === 'module' &&
      node.expression.left.property?.name === 'exports'
    ) {
      return true
    }

    // "use strict" directive
    if (
      type === 'statement' &&
      node.type === 'ExpressionStatement' &&
      node.expression?.type === 'Literal' &&
      node.expression.value === 'use strict'
    ) {
      return true
    }

    return false
  }

  /**
   * Transform coverage map using source maps to map back to original sources
   * Note: This method is no longer used since ast-v8-to-istanbul already applies
   * source maps during conversion. Kept for potential future use.
   */
  async transformWithSourceMaps(coverageMap: CoverageMap): Promise<CoverageMap> {
    const sourceMapStore = libSourceMaps.createSourceMapStore()
    const transformed = await sourceMapStore.transformCoverage(coverageMap)

    // Apply source filter if provided
    if (this.sourceFilter) {
      transformed.filter((filePath: string) => this.sourceFilter!(filePath))
    }

    return transformed
  }

  /**
   * Create coverage map for uncovered files
   * This ensures files with 0% coverage are still shown in reports
   */
  async addUncoveredFiles(
    coverageMap: CoverageMap,
    sourceFiles: string[]
  ): Promise<CoverageMap> {
    // Normalize paths to forward slashes for cross-platform comparison
    const normalizePath = (p: string) => p.replace(/\\/g, '/')
    const coveredFiles = new Set(coverageMap.files().map(normalizePath))

    for (const filePath of sourceFiles) {
      if (coveredFiles.has(normalizePath(filePath))) continue

      // Note: We don't apply the source filter here because:
      // 1. The sourceFiles list was already filtered by glob with include/exclude patterns
      // 2. The source filter was designed for relative paths from source maps
      // 3. Absolute paths would fail the pattern match (e.g., C:/Users/.../src/file.ts vs src/**/*.ts)

      try {
        // Convert to proper file:// URL for loading
        const fileUrl = this.toFileUrl(filePath)
        const sourceFile = await this.sourceMapLoader.loadSource(fileUrl)
        if (!sourceFile) {
          console.warn(`  ⚠️ Could not load source for uncovered file: ${filePath}`)
          continue
        }

        // Create empty coverage for the file
        const emptyCoverage = await this.createEmptyCoverage(filePath, sourceFile.code)
        if (emptyCoverage) {
          coverageMap.merge(emptyCoverage)
        }
      } catch (error) {
        console.warn(`Failed to add uncovered file ${filePath}:`, error)
      }
    }

    return coverageMap
  }

  /**
   * Create empty coverage entry for an uncovered file
   * Uses Babel parser to properly parse TypeScript/TSX and extract functions/branches.
   */
  private async createEmptyCoverage(
    filePath: string,
    code: string
  ): Promise<CoverageMapData | null> {
    try {
      // Determine if it's TypeScript/TSX
      const isTypeScript = filePath.endsWith('.ts') || filePath.endsWith('.tsx')
      const isJSX = filePath.endsWith('.tsx') || filePath.endsWith('.jsx')

      // Parse with Babel which supports TypeScript
      const ast = babelParse(code, {
        sourceType: 'module',
        plugins: [
          ...(isTypeScript ? ['typescript' as const] : []),
          ...(isJSX ? ['jsx' as const] : []),
          'decorators-legacy' as const,
        ],
        errorRecovery: true,
      })

      // Convert Windows path to file:// URL
      const fileUrl = this.toFileUrl(filePath)

      // Use ast-v8-to-istanbul with the Babel AST
      // Pass empty functions array to mark everything as uncovered
      const emptyCoverage = await astV8ToIstanbul({
        code,
        ast: ast as any, // Babel AST is compatible
        coverage: {
          url: fileUrl,
          functions: [], // No functions executed = 0% coverage
        },
        wrapperLength: 0,
        ignoreClassMethods: [],
      })

      // Fix the path in the coverage data
      const result: CoverageMapData = {}
      for (const [, data] of Object.entries(emptyCoverage as CoverageMapData)) {
        ;(data as any).path = filePath
        result[filePath] = data
      }

      return result
    } catch (error) {
      console.warn(`  ⚠️ Error creating coverage for ${filePath}:`, error)
      return null
    }
  }
}
