/**
 * V8 to Istanbul Coverage Converter
 *
 * Converts V8 coverage data to Istanbul format using ast-v8-to-istanbul.
 * This is the core of the coverage processing, mirroring Vitest's approach.
 */

import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { parse as babelParse } from '@babel/parser'
import { parseAstAsync } from 'vite'
import astV8ToIstanbul from 'ast-v8-to-istanbul'
import libCoverage from 'istanbul-lib-coverage'
import libSourceMaps from 'istanbul-lib-source-maps'
import { decode, encode, type SourceMapMappings } from '@jridgewell/sourcemap-codec'
import type { CoverageMap, CoverageMapData } from 'istanbul-lib-coverage'
import type { V8Coverage, V8ScriptCoverage, DevModeV8ScriptCoverage, SourceMapData, SourceFilter } from './types.js'
import { SourceMapLoader } from './sourcemap-loader.js'
import { log, warn, createTimer, formatError } from './logger.js'
import { normalizePath } from './config.js'
import { getWorkerPool } from './worker-pool.js'
import { FILE_PROTOCOL, LARGE_BUNDLE_THRESHOLD, HEAVY_ENTRY_THRESHOLD, ENTRY_BATCH_SIZE, FILE_READ_BATCH_SIZE, SOURCE_MAP_RANGE_THRESHOLD, SOURCE_MAP_PADDING_BEFORE, SOURCE_MAP_PADDING_AFTER } from './constants.js'

/**
 * Normalize URL for merging by stripping query parameters.
 *
 * In dev mode, Next.js appends version timestamps like `?v=1765765839055`
 * to chunk URLs. These are the same file content, just different cache busters.
 * We strip these to merge coverage from the same underlying file.
 */
function normalizeUrlForMerge(url: string): string {
  // Strip query parameters (e.g., ?v=1765765839055)
  const queryIndex = url.indexOf('?')
  return queryIndex === -1 ? url : url.substring(0, queryIndex)
}

/**
 * Merge V8 coverage entries by URL using SUM strategy.
 *
 * When the same chunk is visited by multiple tests, we SUM execution counts
 * to get total coverage across all tests. This matches how Vitest merges
 * coverage (though Vitest uses @bcoe/v8-coverage which we can't use due to
 * its normalization changing function structures).
 *
 * For coverage reporting (covered vs uncovered), SUM and MAX produce identical
 * results since both preserve non-zero counts. SUM gives more accurate execution
 * counts if you need them for profiling.
 *
 * URLs are normalized by stripping query parameters (e.g., ?v=xxxxx) so that
 * dev mode cache-busted URLs are merged correctly.
 *
 * This significantly reduces processing time by converting 400 entries → ~30 unique entries.
 */
export function mergeV8CoverageByUrl(entries: V8ScriptCoverage[]): V8ScriptCoverage[] {
  const endTimer = createTimer(`mergeV8CoverageByUrl (${entries.length} entries)`)
  const merged = new Map<string, V8ScriptCoverage>()

  for (const entry of entries) {
    const normalizedUrl = normalizeUrlForMerge(entry.url)
    const existing = merged.get(normalizedUrl)

    if (!existing) {
      // First time seeing this URL - deep clone it
      // Use normalized URL as both the key and the stored URL
      merged.set(normalizedUrl, {
        scriptId: entry.scriptId,
        url: normalizedUrl,
        source: entry.source,
        functions: entry.functions.map(fn => ({
          functionName: fn.functionName,
          isBlockCoverage: fn.isBlockCoverage,
          ranges: fn.ranges.map(r => ({ ...r })),
        })),
      })
      continue
    }

    // Same URL - merge coverage counts using SUM
    // The source and function structure are identical (same webpack bundle)
    for (let i = 0; i < entry.functions.length && i < existing.functions.length; i++) {
      const existingFn = existing.functions[i]
      const newFn = entry.functions[i]

      // Sum counts for each range
      for (let j = 0; j < newFn.ranges.length && j < existingFn.ranges.length; j++) {
        existingFn.ranges[j].count += newFn.ranges[j].count
      }
    }
  }

  const result = Array.from(merged.values())
  log(`  ✓ Merged ${entries.length} entries → ${result.length} unique URLs`)
  endTimer()
  return result
}

export class CoverageConverter {
  private sourceMapLoader: SourceMapLoader
  private sourceFilter?: SourceFilter
  private projectRoot: string
  private fileExistsCache: Map<string, boolean> = new Map()
  private excludePatterns: string[]

  constructor(projectRoot: string, sourceMapLoader: SourceMapLoader, sourceFilter?: SourceFilter, excludePatterns: string[] = []) {
    this.projectRoot = projectRoot
    this.sourceMapLoader = sourceMapLoader
    this.sourceFilter = sourceFilter
    this.excludePatterns = excludePatterns
  }

  /**
   * Check if a source path matches any exclude pattern.
   * Used to skip processing bundles that only contain excluded files.
   */
  private isSourceExcluded(sourcePath: string): boolean {
    if (this.excludePatterns.length === 0) return false

    // Normalize to forward slashes for matching
    const normalized = sourcePath.replace(/\\/g, '/')

    return this.excludePatterns.some(pattern => {
      // Simple pattern matching - support basic glob patterns
      // Convert glob pattern to regex: ** -> .*, * -> [^/]*, ? -> .
      const regexPattern = pattern
        .replace(/\\/g, '/')
        .replace(/\*\*/g, '{{DOUBLESTAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.')
        .replace(/\{\{DOUBLESTAR\}\}/g, '.*')

      const regex = new RegExp(regexPattern)
      return regex.test(normalized)
    })
  }

  /**
   * Check if a file exists, with caching for performance
   */
  private fileExists(filePath: string): boolean {
    const cached = this.fileExistsCache.get(filePath)
    if (cached !== undefined) {
      return cached
    }
    const exists = existsSync(filePath)
    this.fileExistsCache.set(filePath, exists)
    return exists
  }

  /**
   * Convert V8 coverage to Istanbul coverage map
   */
  async convert(coverage: V8Coverage): Promise<CoverageMap> {
    const endConvert = createTimer('convert (total)')
    const coverageMap = libCoverage.createCoverageMap({})

    // Load source maps from V8 cache if available
    this.sourceMapLoader.loadFromV8Cache(coverage)

    // Track conversion results
    let successCount = 0
    let failCount = 0
    const failReasons: Record<string, number> = {}
    const skippedUrls = new Map<string, number>()

    // Merge V8 coverage entries by URL before conversion
    // This prevents coverage loss when the same URL appears multiple times
    // (from parallel test workers or multiple page visits)
    const mergedEntries = mergeV8CoverageByUrl(coverage.result)

    // Pre-scan phase: Identify which sources each bundle provides
    // This allows us to skip bundles that only contain sources already provided by other bundles
    const bundleSources = new Map<string, Set<string>>() // url -> set of valid source paths
    const allSourcesToBundles = new Map<string, string[]>() // source path -> urls providing it

    for (const entry of mergedEntries) {
      const sourceMap = await this.sourceMapLoader.loadSourceMap(entry.url)
      if (!sourceMap?.sources) continue

      const validSources = new Set<string>()
      for (let i = 0; i < sourceMap.sources.length; i++) {
        const source = sourceMap.sources[i]
        const content = sourceMap.sourcesContent?.[i]
        const reason = this.getSourceRejectionReason(source, content)
        if (!reason) {
          const normalized = this.sourceMapLoader.normalizeSourcePath(source)
          if (normalized && !this.isSourceExcluded(normalized)) {
            validSources.add(normalized)
            const bundles = allSourcesToBundles.get(normalized) || []
            bundles.push(entry.url)
            allSourcesToBundles.set(normalized, bundles)
          }
        }
      }
      bundleSources.set(entry.url, validSources)
    }

    // Determine which bundles to skip: those where ALL sources are provided by other bundles
    // Also skip very large server bundles if most sources are redundant (performance optimization)
    const bundlesToSkip = new Set<string>()

    // First pass: identify fully redundant bundles
    for (const [url, sources] of bundleSources) {
      if (sources.size === 0) continue // Already handled by sanitizeSourceMap

      const allSourcesRedundant = Array.from(sources).every(source => {
        const providingBundles = allSourcesToBundles.get(source) || []
        // Source is redundant if provided by another bundle that we won't skip
        return providingBundles.some(otherUrl => otherUrl !== url && !bundlesToSkip.has(otherUrl))
      })

      if (allSourcesRedundant) {
        bundlesToSkip.add(url)
        log(`  ⏭️ Skipping redundant bundle: ${url.split('/').pop()}`)
        log(`    All ${sources.size} sources provided by other bundles`)
      }
    }

    // Second pass: skip large server bundles where MOST sources are redundant
    // This is a performance optimization - we trade some coverage accuracy for speed
    // The client bundle usually provides the same page coverage
    for (const entry of mergedEntries) {
      if (bundlesToSkip.has(entry.url)) continue

      // Only consider server bundles (file:// URLs)
      if (!entry.url.startsWith(FILE_PROTOCOL)) continue

      // Check bundle size from source
      const sourceLen = entry.source?.length || 0
      if (sourceLen < LARGE_BUNDLE_THRESHOLD) continue

      const sources = bundleSources.get(entry.url)
      if (!sources || sources.size === 0) continue

      // Count redundant sources
      let redundantCount = 0
      for (const source of sources) {
        const providingBundles = allSourcesToBundles.get(source) || []
        const isRedundant = providingBundles.some(otherUrl =>
          otherUrl !== entry.url && !bundlesToSkip.has(otherUrl)
        )
        if (isRedundant) redundantCount++
      }

      // Skip if >80% of sources are redundant (covered elsewhere)
      const redundantRatio = redundantCount / sources.size
      if (redundantRatio >= 0.8) {
        bundlesToSkip.add(entry.url)
        const bundleName = entry.url.split('/').pop()
        log(`  ⏭️ Skipping large server bundle (${(sourceLen / 1024).toFixed(0)}KB): ${bundleName}`)
        log(`    ${redundantCount}/${sources.size} sources (${(redundantRatio * 100).toFixed(0)}%) covered by smaller bundles`)
      }
    }

    // Filter out bundles to skip
    const entriesToProcess = mergedEntries.filter(e => !bundlesToSkip.has(e.url))
    if (bundlesToSkip.size > 0) {
      log(`  Skipping ${bundlesToSkip.size} redundant bundles, processing ${entriesToProcess.length}/${mergedEntries.length}`)
    }

    // Process entries with parallel worker threads for heavy entries
    const endEntries = createTimer(`convertEntries (${entriesToProcess.length} entries)`)
    const entries = entriesToProcess

    // Debug: List all entry URLs (now de-duplicated)
    log(`  Debug: All ${mergedEntries.length} unique entry URLs:`)
    mergedEntries.forEach((entry, i) => log(`    [${i + 1}] ${entry.url}`))

    // Pre-process to identify heavy entries that should use worker threads
    // Heavy entries are those with large source files (>100KB)
    const heavyEntries: typeof entries = []
    const lightEntries: typeof entries = []

    for (const entry of entries) {
      // Check source size - if provided or estimate from URL
      const sourceSize = entry.source?.length || 0
      if (sourceSize > HEAVY_ENTRY_THRESHOLD) {
        heavyEntries.push(entry)
      } else {
        lightEntries.push(entry)
      }
    }

    // Process heavy entries in parallel using worker pool
    if (heavyEntries.length > 0) {
      log(`  🔧 Processing ${heavyEntries.length} heavy entries with worker threads`)
      // Prepare and run all heavy entries in parallel
      const heavyPromises = heavyEntries.map(async (entry) => {
        try {
          // Use worker-based conversion for heavy entries
          const istanbulCoverage = await this.convertEntryWithWorker(entry)
          return { success: true, coverage: istanbulCoverage, entry }
        } catch (error) {
          return { success: false, error, entry }
        }
      })

      const heavyResults = await Promise.all(heavyPromises)

      // Merge heavy results
      for (const result of heavyResults) {
        if (result.success && result.coverage && Object.keys(result.coverage).length > 0) {
          coverageMap.merge(result.coverage)
          successCount++
        } else {
          failCount++
          if (!result.success && result.error) {
            const reason = result.error instanceof Error ? result.error.message.substring(0, 50) : 'unknown'
            failReasons[reason] = (failReasons[reason] || 0) + 1
          } else {
            failReasons['skipped (no source map or not in src/)'] = (failReasons['skipped (no source map or not in src/)'] || 0) + 1
          }
          skippedUrls.set(result.entry.url, (skippedUrls.get(result.entry.url) || 0) + 1)
        }
      }
    }

    // Process light entries in batches on main thread
    for (let i = 0; i < lightEntries.length; i += ENTRY_BATCH_SIZE) {
      const batch = lightEntries.slice(i, i + ENTRY_BATCH_SIZE)
      const results = await Promise.all(
        batch.map(async (entry) => {
          try {
            const istanbulCoverage = await this.convertEntry(entry)
            return { success: true, coverage: istanbulCoverage, entry }
          } catch (error) {
            return { success: false, error, entry }
          }
        })
      )

      // Merge results sequentially (coverageMap.merge is not thread-safe)
      for (const result of results) {
        if (result.success && result.coverage && Object.keys(result.coverage).length > 0) {
          coverageMap.merge(result.coverage)

          successCount++
        } else {
          failCount++
          if (!result.success && result.error) {
            const reason = result.error instanceof Error ? result.error.message.substring(0, 50) : 'unknown'
            failReasons[reason] = (failReasons[reason] || 0) + 1
          } else {
            failReasons['skipped (no source map or not in src/)'] = (failReasons['skipped (no source map or not in src/)'] || 0) + 1
          }
          skippedUrls.set(result.entry.url, (skippedUrls.get(result.entry.url) || 0) + 1)
        }
      }
    }
    endEntries()

    log(`  Debug: Converted ${successCount} entries, failed ${failCount}`)
    if (failCount > 0 && Object.keys(failReasons).length > 0) {
      log(`  Debug: Fail reasons:`, Object.entries(failReasons).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(', '))
    }
    if (skippedUrls.size > 0) {
      log(`  Debug: Skipped URLs (${skippedUrls.size} unique):`)
      skippedUrls.forEach((count, url) => log(`    ${url} (×${count})`))
    }

    // Debug: Show files in coverage map before normalization
    const filesBeforeNorm = coverageMap.files()
    log(`  Debug: Files before normalization (${filesBeforeNorm.length}, showing first 10):`)
    filesBeforeNorm.slice(0, 10).forEach(f => log(`    ${f}`))

    // Normalize file paths to Windows format for merging with Vitest coverage
    // Note: We skip transformWithSourceMaps because ast-v8-to-istanbul already
    // applies source maps during conversion. We just need to fix the paths.
    const normalizedMap = this.normalizeFilePaths(coverageMap)

    // Debug: Show files after normalization
    const filesAfterNorm = normalizedMap.files()
    log(`  Debug: Files after normalization (${filesAfterNorm.length}, showing first 10):`)
    filesAfterNorm.slice(0, 10).forEach(f => log(`    ${f}`))

    // Note: We don't apply the sourceFilter here because extractSourcePath
    // already filters to only keep files with src/ in their path.

    // Fix files with empty statement maps by re-parsing original source
    // This handles simple JSX components where source map loses statement info
    await this.fixEmptyStatementMaps(normalizedMap)

    // Fix spurious branches that don't exist in the original source
    // This handles source map artifacts where arithmetic expressions get mapped as branches
    await this.fixSpuriousBranches(normalizedMap)

    // Fix function declaration statements that have 0 hits but function has calls
    // This handles Next.js 15's TURBOPACK_DISABLE_EXPORT_MERGING comment insertion
    // which causes V8 to not properly track function declaration coverage
    this.fixFunctionDeclarationStatements(normalizedMap)

    // Remove duplicate function entries created by V8 CDP for arrow function exports
    // This fixes incorrect function coverage percentages (e.g., 4/6 = 66% instead of 3/3 = 100%)
    this.removeDuplicateFunctionEntries(normalizedMap)

    endConvert()
    return normalizedMap
  }

  /**
   * Fix files that have function coverage but empty statement maps
   * This happens with simple JSX components where source map transformation
   * loses statement boundaries. We re-parse the original source to get proper statements.
   */
  private async fixEmptyStatementMaps(coverageMap: CoverageMap): Promise<void> {
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
    endTimer()
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
    } catch (error) {
      // If parsing fails, return empty set (don't remove any branches)
      log(`  Failed to parse ${filePath} for branch analysis: ${error instanceof Error ? error.message : 'unknown error'}`)
    }

    return lines
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
  private fixFunctionDeclarationStatements(coverageMap: CoverageMap): void {
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
  private removeDuplicateFunctionEntries(coverageMap: CoverageMap): void {
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
        // Debug: Log why files are being skipped
        log(`  Debug: Skipping file (no src/ path): ${filePath}`)
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

      // Check if the file actually exists on disk
      // This filters out phantom files from Next.js internal source maps
      // (e.g., paths like ../../src/client/... that resolve but don't exist)
      if (!this.fileExists(absolutePath)) {
        return null
      }

      return absolutePath
    }

    // If no src/ found, skip this file (it's likely a Next.js internal file)
    return null
  }

  /**
   * Convert a single V8 script coverage entry to Istanbul format
   *
   * In dev mode, entries may have sourceMapData and originalPath pre-attached
   * from the DevModeServerCollector. We use those when available.
   */
  async convertEntry(entry: V8ScriptCoverage | DevModeV8ScriptCoverage): Promise<CoverageMapData | null> {
    const { url, functions, source } = entry

    // Validate required fields
    if (!url || typeof url !== 'string') {
      log(`  Skipping entry with invalid URL: ${url}`)
      return null
    }

    // Check for dev mode pre-attached source map data
    const devModeEntry = entry as DevModeV8ScriptCoverage
    const devModeSourceMap = devModeEntry.sourceMapData
    const devModeOriginalPath = devModeEntry.originalPath

    // Load source code and source map
    let code = source
    let sourceMap: SourceMapData | undefined = devModeSourceMap
    // Resolve dev mode original path to absolute path (it's relative like "src/app/page.tsx")
    let filePath: string | null = devModeOriginalPath
      ? resolve(this.projectRoot, devModeOriginalPath)
      : null

    // Debug: Track why entries fail - show more of the URL for identification
    const debugUrl = url.length > 120 ? url.substring(0, 120) + '...' : url

    // Timing for detailed performance analysis
    const timings: Record<string, number> = {}
    const startTotal = performance.now()

    const startLoad = performance.now()
    if (!code) {
      const sourceFile = await this.sourceMapLoader.loadSource(url)
      if (!sourceFile) {
        // Debug: No code and couldn't load source
        if (process.env.DEBUG_COVERAGE) {
          log(`  [DEBUG] No source for: ${debugUrl}`)
        }
        return null
      }
      code = sourceFile.code
      // Only use disk source map if we don't have dev mode source map
      if (!sourceMap) {
        sourceMap = sourceFile.sourceMap
      }
      if (!filePath) {
        filePath = sourceFile.path
      }
    } else if (!sourceMap) {
      // Try to load source map from disk first (only if not already provided)
      const sourceFile = await this.sourceMapLoader.loadSource(url)
      if (sourceFile?.sourceMap) {
        sourceMap = sourceFile.sourceMap
        if (!filePath) {
          filePath = sourceFile.path
        }
      } else {
        // No disk file (dev mode) - try to extract inline sourcemap from the source
        sourceMap = this.sourceMapLoader.extractInlineSourceMap(code) || undefined
        if (!filePath) {
          filePath = this.sourceMapLoader.urlToFilePath(url)
        }
      }
    }
    timings.load = performance.now() - startLoad

    // If we couldn't resolve a file path, try to extract from URL
    if (!filePath) {
      filePath = this.sourceMapLoader.urlToFilePath(url)
    }

    // For ast-v8-to-istanbul, we need a file:// URL, not http://
    // Convert the URL to a proper file path for the coverage data
    const coverageUrl = filePath ? this.toFileUrl(filePath) : url

    // Parse AST using Vite's fast Rollup-based parser
    // This works because the code here is already bundled JavaScript (not TypeScript)
    const startParse = performance.now()
    let ast
    try {
      ast = await parseAstAsync(code)
    } catch (error) {
      log(`  AST parse failed for ${debugUrl}: ${formatError(error)}`)
      return null
    }
    timings.parse = performance.now() - startParse

    // Sanitize source map to fix empty source entries
    const startSanitize = performance.now()
    const sanitizedSourceMap = sourceMap ? this.sanitizeSourceMap(sourceMap) : undefined
    timings.sanitize = performance.now() - startSanitize

    // If source map was rejected as problematic, skip this file entirely
    // Next.js production builds have complex source maps with external references
    // that ast-v8-to-istanbul cannot process
    if (sourceMap && !sanitizedSourceMap) {
      // Debug: Source map was sanitized away
      if (process.env.DEBUG_COVERAGE) {
        log(`  [DEBUG] Sourcemap rejected for: ${debugUrl}`)
        log(`    sources: ${sourceMap.sources?.slice(0, 3).join(', ')}${sourceMap.sources && sourceMap.sources.length > 3 ? '...' : ''}`)
        log(`    sourcesContent: ${sourceMap.sourcesContent ? `${sourceMap.sourcesContent.length} entries, first has content: ${!!sourceMap.sourcesContent[0]}` : 'none'}`)
      }
      return null
    }

    // Log source map complexity for debugging performance issues
    if (sanitizedSourceMap) {
      const totalSources = sourceMap?.sources?.length || 0
      const afterSanitize = sanitizedSourceMap.sources.length
      const mappingsLen = sanitizedSourceMap.mappings?.length || 0
      const codeLen = code.length
      log(`  📊 Sourcemap: ${totalSources} → ${afterSanitize} sources, mappings=${mappingsLen} chars, code=${codeLen} chars: ${debugUrl}`)

      // Performance optimization: Skip very large bundled files if the primary source is excluded
      // The primary source is the one that matches the bundle filename (e.g., middleware.ts for middleware.js)
      if (codeLen > SOURCE_MAP_RANGE_THRESHOLD) {
        log(`  ⚠️ Large bundle (${(codeLen / 1024).toFixed(0)}KB code, ${afterSanitize} src files): ${debugUrl}`)
        log(`    Sources: ${sanitizedSourceMap.sources.map(s => s.split('/').pop()).join(', ')}`)

        // Check if the PRIMARY source (matching bundle name) is excluded
        // For middleware.js bundle, primary source is middleware.ts
        // Other bundled deps (constants.ts, auth.ts) are covered by their own bundles
        if (this.excludePatterns.length > 0) {
          // Extract bundle name from URL (e.g., "middleware" from "_next/static/chunks/middleware.js")
          const urlParts = debugUrl.split('/')
          const bundleFile = urlParts[urlParts.length - 1] // e.g., "middleware.js"
          const bundleName = bundleFile.replace(/\.js$/, '') // e.g., "middleware"

          // Find the primary source - the one whose filename matches the bundle name
          const primarySource = sanitizedSourceMap.sources.find(source => {
            const sourceFile = source.split('/').pop() || ''
            const sourceName = sourceFile.replace(/\.(ts|tsx|js|jsx)$/, '')
            return sourceName === bundleName
          })

          if (primarySource && this.isSourceExcluded(primarySource)) {
            log(`  ⏭️ Skipping large bundle: primary source "${primarySource}" is excluded`)
            return null
          }
        }
      }
    }

    // For large bundles, compute the byte range where src code exists
    // This allows us to skip processing AST nodes outside this range
    let srcCodeRange: { minOffset: number; maxOffset: number } | null = null
    if (sanitizedSourceMap && code.length > SOURCE_MAP_RANGE_THRESHOLD) {
      srcCodeRange = this.computeSrcCodeRange(sanitizedSourceMap, code)
      if (srcCodeRange) {
        const rangeSize = srcCodeRange.maxOffset - srcCodeRange.minOffset
        log(`  🎯 Src code range: ${srcCodeRange.minOffset}-${srcCodeRange.maxOffset} (${(rangeSize / 1024).toFixed(0)}KB of ${(code.length / 1024).toFixed(0)}KB)`)
      }
    }

    // Convert using ast-v8-to-istanbul
    const startConvert = performance.now()
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
        ignoreNode: (node, type) => {
          // For large bundles, skip nodes outside the src code range
          // This dramatically reduces processing time by avoiding source map lookups
          // for code that will never map to our src files
          const nodeAny = node as any
          if (srcCodeRange && typeof nodeAny.start === 'number' && typeof nodeAny.end === 'number') {
            if (nodeAny.end < srcCodeRange.minOffset || nodeAny.start > srcCodeRange.maxOffset) {
              return 'ignore-this-and-nested-nodes'
            }
          }
          return this.shouldIgnoreNode(node, type)
        },
      })
      timings.astV8ToIstanbul = performance.now() - startConvert
      timings.total = performance.now() - startTotal

      // Log timing for slow entries (>100ms)
      if (timings.total > 100) {
        log(`  ⏱ Slow entry (${timings.total.toFixed(0)}ms): ${debugUrl}`)
        log(`    load=${timings.load.toFixed(0)}ms parse=${timings.parse.toFixed(0)}ms sanitize=${timings.sanitize.toFixed(0)}ms astV8ToIstanbul=${timings.astV8ToIstanbul.toFixed(0)}ms`)
      }

      return istanbulCoverage as CoverageMapData
    } catch (error) {
      log(`  Debug: astV8ToIstanbul error: ${error instanceof Error ? error.message : error}`)
      return null
    }
  }

  /**
   * Convert a single V8 script coverage entry using a worker thread
   *
   * This method offloads the CPU-intensive AST parsing and astV8ToIstanbul
   * processing to a worker thread, allowing parallel processing of multiple
   * large bundles on multi-core machines.
   */
  async convertEntryWithWorker(entry: V8ScriptCoverage | DevModeV8ScriptCoverage): Promise<CoverageMapData | null> {
    const { url, functions, source } = entry
    const startTotal = performance.now()

    // Validate required fields
    if (!url || typeof url !== 'string') {
      log(`  Skipping entry with invalid URL: ${url}`)
      return null
    }

    // Check for dev mode pre-attached source map data
    const devModeEntry = entry as DevModeV8ScriptCoverage
    const devModeSourceMap = devModeEntry.sourceMapData
    const devModeOriginalPath = devModeEntry.originalPath

    // Load source code and source map
    let code = source
    let sourceMap: SourceMapData | undefined = devModeSourceMap
    let filePath: string | null = devModeOriginalPath
      ? resolve(this.projectRoot, devModeOriginalPath)
      : null

    const debugUrl = url.length > 120 ? url.substring(0, 120) + '...' : url

    if (!code) {
      const sourceFile = await this.sourceMapLoader.loadSource(url)
      if (!sourceFile) {
        return null
      }
      code = sourceFile.code
      if (!sourceMap) {
        sourceMap = sourceFile.sourceMap
      }
      if (!filePath) {
        filePath = sourceFile.path
      }
    } else if (!sourceMap) {
      const sourceFile = await this.sourceMapLoader.loadSource(url)
      if (sourceFile?.sourceMap) {
        sourceMap = sourceFile.sourceMap
        if (!filePath) {
          filePath = sourceFile.path
        }
      } else {
        sourceMap = this.sourceMapLoader.extractInlineSourceMap(code) || undefined
        if (!filePath) {
          filePath = this.sourceMapLoader.urlToFilePath(url)
        }
      }
    }

    if (!filePath) {
      filePath = this.sourceMapLoader.urlToFilePath(url)
    }

    const coverageUrl = filePath ? this.toFileUrl(filePath) : url

    // Sanitize source map
    const sanitizedSourceMap = sourceMap ? this.sanitizeSourceMap(sourceMap) : undefined

    if (sourceMap && !sanitizedSourceMap) {
      return null
    }

    // Log source map complexity
    if (sanitizedSourceMap) {
      const totalSources = sourceMap?.sources?.length || 0
      const afterSanitize = sanitizedSourceMap.sources.length
      const mappingsLen = sanitizedSourceMap.mappings?.length || 0
      const codeLen = code.length
      log(`  📊 Sourcemap: ${totalSources} → ${afterSanitize} sources, mappings=${mappingsLen} chars, code=${codeLen} chars: ${debugUrl}`)

      // Skip large bundles if primary source is excluded
      if (codeLen > SOURCE_MAP_RANGE_THRESHOLD) {
        log(`  ⚠️ Large bundle (${(codeLen / 1024).toFixed(0)}KB code, ${afterSanitize} src files): ${debugUrl}`)
        log(`    Sources: ${sanitizedSourceMap.sources.map(s => s.split('/').pop()).join(', ')}`)

        if (this.excludePatterns.length > 0) {
          const urlParts = debugUrl.split('/')
          const bundleFile = urlParts[urlParts.length - 1]
          const bundleName = bundleFile.replace(/\.js$/, '')

          const primarySource = sanitizedSourceMap.sources.find(source => {
            const sourceFile = source.split('/').pop() || ''
            const sourceName = sourceFile.replace(/\.(ts|tsx|js|jsx)$/, '')
            return sourceName === bundleName
          })

          if (primarySource && this.isSourceExcluded(primarySource)) {
            log(`  ⏭️ Skipping large bundle: primary source "${primarySource}" is excluded`)
            return null
          }
        }
      }
    }

    // Compute src code range for optimization
    let srcCodeRange: { minOffset: number; maxOffset: number } | null = null
    if (sanitizedSourceMap && code.length > SOURCE_MAP_RANGE_THRESHOLD) {
      srcCodeRange = this.computeSrcCodeRange(sanitizedSourceMap, code)
      if (srcCodeRange) {
        const rangeSize = srcCodeRange.maxOffset - srcCodeRange.minOffset
        log(`  🎯 Src code range: ${srcCodeRange.minOffset}-${srcCodeRange.maxOffset} (${(rangeSize / 1024).toFixed(0)}KB of ${(code.length / 1024).toFixed(0)}KB)`)
      }
    }

    // Send to worker for processing
    const pool = getWorkerPool()
    try {
      const result = await pool.runTask({
        code,
        sourceMap: sanitizedSourceMap ? {
          sources: sanitizedSourceMap.sources,
          sourcesContent: sanitizedSourceMap.sourcesContent || [],
          mappings: sanitizedSourceMap.mappings,
          names: sanitizedSourceMap.names,
          version: sanitizedSourceMap.version,
          file: sanitizedSourceMap.file,
          sourceRoot: sanitizedSourceMap.sourceRoot,
        } : null,
        coverageUrl,
        functions,
        srcCodeRange,
      })

      const totalTime = performance.now() - startTotal

      if (result.success && result.coverage) {
        if (totalTime > 100) {
          log(`  ⏱ Slow entry [worker] (${totalTime.toFixed(0)}ms): ${debugUrl}`)
          if (result.timings) {
            log(`    parse=${result.timings.parse.toFixed(0)}ms convert=${result.timings.convert.toFixed(0)}ms`)
          }
        }
        return result.coverage as CoverageMapData
      } else {
        log(`  Debug: Worker astV8ToIstanbul error: ${result.error}`)
        return null
      }
    } catch (error) {
      log(`  Debug: Worker error: ${error instanceof Error ? error.message : error}`)
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
    const rejectionReasons: string[] = []
    const acceptedSources: string[] = []

    for (let i = 0; i < sourceMap.sources.length; i++) {
      const source = sourceMap.sources[i]
      const content = sourceMap.sourcesContent?.[i]
      const reason = this.getSourceRejectionReason(source, content)
      if (!reason) {
        validSourceIndices.add(i)
        if (acceptedSources.length < 10) {
          // Show full source path for better debugging
          acceptedSources.push(`[${i}] ${source}`)
        }
      } else if (rejectionReasons.length < 5) {
        // Log first 5 rejection reasons for debugging
        rejectionReasons.push(`[${i}] ${source?.substring(0, 60)}: ${reason}`)
      }
    }

    // If no valid sources, skip this entry
    if (validSourceIndices.size === 0) {
      log(`  Debug: sanitizeSourceMap rejected all ${sourceMap.sources.length} sources`)
      if (rejectionReasons.length > 0) {
        rejectionReasons.forEach(r => log(`    ${r}`))
      }
      return undefined
    }

    // Log accepted sources for debugging
    if (acceptedSources.length > 0) {
      log(`  Debug: sanitizeSourceMap accepted ${validSourceIndices.size}/${sourceMap.sources.length} sources`)
      acceptedSources.forEach(s => log(`    ✓ ${s}`))
    }

    // Performance optimization: Skip bundles where ALL valid sources are excluded
    // This avoids expensive VLQ decode/encode for bundles like middleware.js
    // where all sources (e.g., middleware.ts) are in the exclude list.
    if (this.excludePatterns.length > 0) {
      const validSources = Array.from(validSourceIndices).map(i => sourceMap.sources[i])
      const allExcluded = validSources.every(source => {
        const normalized = this.sourceMapLoader.normalizeSourcePath(source)
        return this.isSourceExcluded(normalized)
      })
      if (allExcluded) {
        log(`  ⏭️ Skipping bundle: all ${validSources.length} sources match exclude patterns`)
        validSources.slice(0, 5).forEach(s => log(`    - ${s.split('/').pop()}`))
        return undefined
      }
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
    } catch (error) {
      log(`  Failed to decode source map mappings: ${formatError(error)}`)
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
    } catch (error) {
      log(`  Failed to encode source map mappings: ${formatError(error)}`)
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
   * Get rejection reason for a source (returns null if valid)
   * Used for debugging why sources are being filtered out
   */
  private getSourceRejectionReason(source: string | null, content?: string | null): string | null {
    if (!source || source.trim() === '') {
      return 'empty/null source'
    }

    if (source.startsWith('external ') || source.includes('external%20commonjs')) {
      return 'webpack external'
    }

    // Normalize the source path first to check if it resolves to something useful
    const normalizedSource = this.sourceMapLoader.normalizeSourcePath(source)

    // Reject sources that normalize to empty or just whitespace (e.g., webpack://_N_E/?xxxx)
    if (!normalizedSource || normalizedSource.trim() === '') {
      return 'normalized to empty path'
    }

    if (/^[A-Za-z]:[/\\]/.test(source)) {
      if (!source.toLowerCase().startsWith(this.projectRoot.toLowerCase())) {
        return `Windows path not in project (source starts with ${source.substring(0, 20)}, projectRoot=${this.projectRoot.substring(0, 20)})`
      }
    }

    if (normalizedSource.includes('node_modules/') || normalizedSource.includes('node_modules\\')) {
      return 'node_modules'
    }

    // Check if source has src/ in its path
    // For webpack URLs with proper paths like webpack://_N_E/./src/app/page.tsx, the normalized version should have src/
    if (!normalizedSource.includes('src/') && !source.includes('/src/') && !source.includes('\\src\\')) {
      return `no src/ in path (normalized=${normalizedSource.substring(0, 40)})`
    }

    if (!content || typeof content !== 'string') {
      return 'no sourcesContent'
    }

    return null // Valid
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
   * Compute the byte range in the generated code where src file mappings exist.
   * For large bundles with many external dependencies, src code is often clustered
   * at the end of the file. By computing this range, we can skip processing
   * AST nodes outside this range, significantly improving performance.
   *
   * Returns { minOffset, maxOffset } or null if no src mappings found.
   */
  private computeSrcCodeRange(
    sourceMap: SourceMapData,
    code: string
  ): { minOffset: number; maxOffset: number } | null {
    if (!sourceMap.mappings || !sourceMap.sources) {
      return null
    }

    // Decode the mappings
    let decodedMappings: SourceMapMappings
    try {
      decodedMappings = decode(sourceMap.mappings)
    } catch {
      // Invalid mappings - expected for malformed source maps
      return null
    }

    // Find line offsets in the generated code
    const lines = code.split('\n')
    const lineOffsets: number[] = [0]
    let offset = 0
    for (const line of lines) {
      offset += line.length + 1 // +1 for newline
      lineOffsets.push(offset)
    }

    // Find min and max offsets for segments mapping to our src files
    // Note: At this point, sourceMap.sources only contains our src files
    // (it's already been sanitized)
    let minOffset = Infinity
    let maxOffset = -1

    for (let lineIndex = 0; lineIndex < decodedMappings.length; lineIndex++) {
      const lineSegments = decodedMappings[lineIndex]
      const lineStart = lineOffsets[lineIndex] || 0

      for (const segment of lineSegments) {
        if (segment.length >= 4) {
          // This segment maps to a source file
          const columnOffset = segment[0]
          const byteOffset = lineStart + columnOffset

          if (byteOffset < minOffset) minOffset = byteOffset
          if (byteOffset > maxOffset) maxOffset = byteOffset
        }
      }
    }

    if (minOffset === Infinity || maxOffset === -1) {
      return null
    }

    // Add some padding to ensure we don't miss boundary nodes
    // Subtract chars before and add chars after (functions can be long)
    const paddedMin = Math.max(0, minOffset - SOURCE_MAP_PADDING_BEFORE)
    const paddedMax = Math.min(code.length, maxOffset + SOURCE_MAP_PADDING_AFTER)

    return { minOffset: paddedMin, maxOffset: paddedMax }
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
    const endTimer = createTimer(`addUncoveredFiles (${sourceFiles.length} files)`)
    // Normalize paths to forward slashes for cross-platform comparison
    const coveredFiles = new Set(coverageMap.files().map(normalizePath))

    // Filter to only uncovered files
    const uncoveredFiles = sourceFiles.filter(
      (filePath) => !coveredFiles.has(normalizePath(filePath))
    )

    if (uncoveredFiles.length === 0) {
      endTimer()
      return coverageMap
    }

    // Note: We don't apply the source filter here because:
    // 1. The sourceFiles list was already filtered by glob with include/exclude patterns
    // 2. The source filter was designed for relative paths from source maps
    // 3. Absolute paths would fail the pattern match (e.g., C:/Users/.../src/file.ts vs src/**/*.ts)

    // Process uncovered files in parallel batches
    for (let i = 0; i < uncoveredFiles.length; i += ENTRY_BATCH_SIZE) {
      const batch = uncoveredFiles.slice(i, i + ENTRY_BATCH_SIZE)
      const results = await Promise.all(
        batch.map(async (filePath) => {
          try {
            // Convert to proper file:// URL for loading
            const fileUrl = this.toFileUrl(filePath)
            const sourceFile = await this.sourceMapLoader.loadSource(fileUrl)
            if (!sourceFile) {
              return null
            }

            // Create empty coverage for the file
            return await this.createEmptyCoverage(filePath, sourceFile.code)
          } catch {
            // File loading failed - expected for missing or inaccessible files
            return null
          }
        })
      )

      // Merge results sequentially
      for (const emptyCoverage of results) {
        if (emptyCoverage) {
          coverageMap.merge(emptyCoverage)
        }
      }
    }

    endTimer()
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
      warn(`  ⚠️ Error creating coverage for ${filePath}:`, error)
      return null
    }
  }
}
