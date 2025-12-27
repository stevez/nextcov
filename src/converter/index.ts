/**
 * V8 to Istanbul Coverage Converter
 *
 * Converts V8 coverage data to Istanbul format using ast-v8-to-istanbul.
 * This is the core of the coverage processing, mirroring Vitest's approach.
 */

import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { parse as babelParse } from '@babel/parser'
import { parseAstAsync } from 'vite'
import _astV8ToIstanbul from 'ast-v8-to-istanbul'
import libCoverage from 'istanbul-lib-coverage'
import libSourceMaps from 'istanbul-lib-source-maps'
import type { CoverageMap, CoverageMapData } from 'istanbul-lib-coverage'
import type { V8Coverage, V8ScriptCoverage, DevModeV8ScriptCoverage, SourceMapData, SourceFilter } from '@/types.js'
import { SourceMapLoader } from '@/core/sourcemap-loader.js'
import { log, warn, createTimer, formatError } from '@/utils/logger.js'
import { normalizePath } from '@/utils/config.js'
import { getWorkerPool } from '@/worker/pool.js'
import { FILE_PROTOCOL, toFileUrl } from '@/parsers/index.js'
import { LARGE_BUNDLE_THRESHOLD, HEAVY_ENTRY_THRESHOLD, ENTRY_BATCH_SIZE, SOURCE_MAP_RANGE_THRESHOLD, FILE_EXISTS_CACHE_MAX_SIZE } from '@/utils/constants.js'

// Import new modular functions
import { mergeV8CoverageByUrl } from './merge.js'
import {
  sanitizeSourceMap,
  getSourceRejectionReason,
  computeSrcCodeRanges,
  isSourceExcluded,
} from './sanitizer.js'
import {
  fixEmptyStatementMaps,
  filterJsxArrayMethodCallbacks,
  fixSpuriousBranches,
  removePhantomBranches,
  fixFunctionDeclarationStatements,
  removeDuplicateFunctionEntries,
} from './coverage-fixes.js'

// Handle ESM/CJS interop for default exports
// When tsup bundles for CJS, ESM default exports get wrapped as { default: fn }
// This helper unwraps it if needed, returning the function directly
function unwrapDefault<T>(mod: T): T {
  const maybeWrapped = mod as { default?: T }
  if (maybeWrapped.default && typeof maybeWrapped.default === 'function') {
    return maybeWrapped.default
  }
  return mod
}

const astV8ToIstanbul = unwrapDefault(_astV8ToIstanbul)

/**
 * AST node with position information (common to babel and vite parsers)
 * Uses Record for flexible property access since different node types have different shapes
 */
interface AstNodeWithPosition {
  type?: string
  start?: number
  end?: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
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
   * Check if a file exists, with caching for performance
   */
  private fileExists(filePath: string): boolean {
    const cached = this.fileExistsCache.get(filePath)
    if (cached !== undefined) {
      return cached
    }
    const exists = existsSync(filePath)
    // Limit cache size to prevent unbounded memory growth
    if (this.fileExistsCache.size >= FILE_EXISTS_CACHE_MAX_SIZE) {
      // Clear oldest entries (first 20%)
      const keysToDelete = Array.from(this.fileExistsCache.keys()).slice(0, Math.floor(FILE_EXISTS_CACHE_MAX_SIZE * 0.2))
      keysToDelete.forEach(key => this.fileExistsCache.delete(key))
    }
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
        const reason = getSourceRejectionReason(
          source,
          content,
          this.projectRoot,
          (path) => this.sourceMapLoader.normalizeSourcePath(path)
        )
        if (!reason) {
          const normalized = this.sourceMapLoader.normalizeSourcePath(source)
          if (normalized && !isSourceExcluded(normalized, this.excludePatterns)) {
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
    await fixEmptyStatementMaps(normalizedMap, {
      createEmptyCoverage: (filePath, sourceCode) => this.createEmptyCoverage(filePath, sourceCode)
    })

    // Filter JSX array method callbacks to match Vitest's behavior
    // Vitest's ast-v8-to-istanbul filters these, but browser coverage doesn't
    await filterJsxArrayMethodCallbacks(normalizedMap)

    // Fix spurious branches that don't exist in the original source
    // This handles source map artifacts where arithmetic expressions get mapped as branches
    await fixSpuriousBranches(normalizedMap)

    // Remove phantom branches created by webpack module wrappers
    // These are "if" branches at line 1, column 0 with zero length that don't exist in source
    removePhantomBranches(normalizedMap)


    // Fix function declaration statements that have 0 hits but function has calls
    // This handles Next.js 15's TURBOPACK_DISABLE_EXPORT_MERGING comment insertion
    // which causes V8 to not properly track function declaration coverage
    fixFunctionDeclarationStatements(normalizedMap)

    // Remove duplicate function entries created by V8 CDP for arrow function exports
    // This fixes incorrect function coverage percentages (e.g., 4/6 = 66% instead of 3/3 = 100%)
    removeDuplicateFunctionEntries(normalizedMap)

    endConvert()
    return normalizedMap
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
    const coverageUrl = filePath ? toFileUrl(filePath, this.projectRoot) : url

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
    const sanitizedSourceMap = sourceMap ? sanitizeSourceMap(sourceMap, {
      projectRoot: this.projectRoot,
      sourceMapLoader: this.sourceMapLoader,
      excludePatterns: this.excludePatterns,
    }) : undefined
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

          if (primarySource && isSourceExcluded(primarySource, this.excludePatterns)) {
            log(`  ⏭️ Skipping large bundle: primary source "${primarySource}" is excluded`)
            return null
          }
        }
      }
    }

    // Compute multiple src code ranges for precise optimization
    // This identifies separate "islands" of user code in webpack bundles
    let srcCodeRanges: Array<{ minOffset: number; maxOffset: number }> = []
    if (sanitizedSourceMap && code.length > SOURCE_MAP_RANGE_THRESHOLD) {
      srcCodeRanges = computeSrcCodeRanges(sanitizedSourceMap, code)
      if (srcCodeRanges.length > 0) {
        const totalSize = srcCodeRanges.reduce((sum, r) => sum + (r.maxOffset - r.minOffset), 0)
        log(`  🎯 Src code ranges: ${srcCodeRanges.length} ranges (${(totalSize / 1024).toFixed(0)}KB of ${(code.length / 1024).toFixed(0)}KB)`)
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
          // For large bundles, skip nodes outside all src code ranges
          // This dramatically reduces processing time by avoiding source map lookups
          // for code that will never map to our src files
          const astNode = node as AstNodeWithPosition
          const nodeStart = astNode.start
          const nodeEnd = astNode.end
          if (
            srcCodeRanges.length > 0 &&
            typeof nodeStart === 'number' &&
            typeof nodeEnd === 'number'
          ) {
            // Check if node overlaps with ANY of the code ranges
            const overlapsWithUserCode = srcCodeRanges.some(range =>
              !(nodeEnd < range.minOffset || nodeStart > range.maxOffset)
            )
            if (!overlapsWithUserCode) {
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

    const coverageUrl = filePath ? toFileUrl(filePath, this.projectRoot) : url

    // Sanitize source map
    const sanitizedSourceMap = sourceMap ? sanitizeSourceMap(sourceMap, {
      projectRoot: this.projectRoot,
      sourceMapLoader: this.sourceMapLoader,
      excludePatterns: this.excludePatterns,
    }) : undefined

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

          if (primarySource && isSourceExcluded(primarySource, this.excludePatterns)) {
            log(`  ⏭️ Skipping large bundle: primary source "${primarySource}" is excluded`)
            return null
          }
        }
      }
    }

    // Compute multiple src code ranges for precise optimization
    // This identifies separate "islands" of user code in the webpack bundle
    let srcCodeRanges: Array<{ minOffset: number; maxOffset: number }> = []
    if (sanitizedSourceMap && code.length > SOURCE_MAP_RANGE_THRESHOLD) {
      srcCodeRanges = computeSrcCodeRanges(sanitizedSourceMap, code)
      if (srcCodeRanges.length > 0) {
        const totalSize = srcCodeRanges.reduce((sum, r) => sum + (r.maxOffset - r.minOffset), 0)
        log(`  🎯 Src code ranges: ${srcCodeRanges.length} ranges (${(totalSize / 1024).toFixed(0)}KB of ${(code.length / 1024).toFixed(0)}KB)`)
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
        srcCodeRange: null, // Deprecated, use srcCodeRanges
        srcCodeRanges: srcCodeRanges.length > 0 ? srcCodeRanges : undefined,
      })

      const totalTime = performance.now() - startTotal

      if (result.success && result.coverage) {
        if (totalTime > 100) {
          log(`  ⏱ Slow entry [worker] (${totalTime.toFixed(0)}ms): ${debugUrl}`)
          if (result.timings) {
            let details = `parse=${result.timings.parse.toFixed(0)}ms convert=${result.timings.convert.toFixed(0)}ms`
            if (result.filterStats) {
              details += ` ast-filter=${result.filterStats.original}→${result.filterStats.filtered}`
            }
            log(`    ${details}`)
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
   * Determine if a node should be ignored in coverage
   * Mirrors Vitest's ignoreNode logic for SSR/bundler artifacts
   */
  private shouldIgnoreNode(node: AstNodeWithPosition, type: string): boolean | 'ignore-this-and-nested-nodes' {
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
            const fileUrl = toFileUrl(filePath, this.projectRoot)
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
      const fileUrl = toFileUrl(filePath, this.projectRoot)

      // Use ast-v8-to-istanbul with the Babel AST
      // Pass empty functions array to mark everything as uncovered
      // Note: Babel AST is structurally compatible with astV8ToIstanbul's expected AST
      const emptyCoverage = await astV8ToIstanbul({
        code,
        ast: ast as unknown as Parameters<typeof astV8ToIstanbul>[0]['ast'],
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
        // FileCoverageData has a path property that we need to update
        const fileCoverage = data as CoverageMapData[string] & { path: string }
        fileCoverage.path = filePath
        result[filePath] = data
      }

      return result
    } catch (error) {
      warn(`  ⚠️ Error creating coverage for ${filePath}:`, error)
      return null
    }
  }
}
