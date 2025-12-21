/**
 * Source Map Loader
 *
 * Loads source code and source maps from Next.js build output.
 * Handles the mapping between bundled code URLs and original source files.
 * Supports both production builds (external .map files) and dev mode (inline sourcemaps).
 */

import { promises as fs } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import convertSourceMap from 'convert-source-map'
import type { SourceMapData, SourceFile, V8Coverage } from './types.js'
import { DEFAULT_NEXTCOV_CONFIG, isPathWithinBase } from './config.js'
import { FILE_PROTOCOL, extractNextPath, SOURCE_MAPPING_URL_PATTERN, INLINE_SOURCE_MAP_BASE64_PATTERN, DATA_URL_BASE64_PATTERN, normalizeWebpackSourcePath, SOURCE_CACHE_MAX_SIZE } from './constants.js'
import { log, formatError } from './logger.js'

export class SourceMapLoader {
  private projectRoot: string
  private nextBuildDir: string
  private sourceCache: Map<string, SourceFile> = new Map()

  constructor(projectRoot: string, nextBuildDir?: string) {
    this.projectRoot = projectRoot
    this.nextBuildDir = nextBuildDir || join(projectRoot, DEFAULT_NEXTCOV_CONFIG.buildDir)
  }

  /**
   * Load source code and source map for a given URL
   */
  async loadSource(url: string): Promise<SourceFile | null> {
    // Check cache first
    if (this.sourceCache.has(url)) {
      return this.sourceCache.get(url)!
    }

    try {
      const filePath = this.urlToFilePath(url)
      if (!filePath) return null

      const code = await fs.readFile(filePath, 'utf-8')
      const sourceMap = await this.loadSourceMap(filePath, code)

      const sourceFile: SourceFile = {
        path: filePath,
        code,
        sourceMap: sourceMap || undefined,
      }

      // Limit cache size to prevent unbounded memory growth
      if (this.sourceCache.size >= SOURCE_CACHE_MAX_SIZE) {
        // Clear oldest entries (first 20%)
        const keysToDelete = Array.from(this.sourceCache.keys()).slice(0, Math.floor(SOURCE_CACHE_MAX_SIZE * 0.2))
        keysToDelete.forEach(key => this.sourceCache.delete(key))
      }
      this.sourceCache.set(url, sourceFile)
      return sourceFile
    } catch (error) {
      log(`  Skipping source ${url}: ${formatError(error)}`)
      return null
    }
  }

  /**
   * Convert Next.js path segment to file path
   * Handles URL-encoded characters like %5Bid%5D -> [id]
   */
  private nextPathToFilePath(nextPath: string): string {
    const decodedPath = decodeURIComponent(nextPath)
    return join(this.nextBuildDir, decodedPath)
  }

  /**
   * Convert URL to file path
   * Includes path traversal protection to prevent escaping project boundaries.
   */
  urlToFilePath(url: string): string | null {
    let filePath: string | null = null

    // Handle file:// URLs
    if (url.startsWith(FILE_PROTOCOL)) {
      filePath = fileURLToPath(url)
    }
    // Handle Next.js URLs (works for both /_next/... and http://.../_next/...)
    else {
      const nextPath = extractNextPath(url)
      if (nextPath) {
        filePath = this.nextPathToFilePath(nextPath)
      }
      // Handle relative paths
      else if (url.startsWith('/')) {
        filePath = join(this.projectRoot, decodeURIComponent(url))
      }
      // Handle http(s) URLs without /_next/ - extract pathname
      else {
        try {
          const parsed = new URL(url)
          filePath = join(this.projectRoot, decodeURIComponent(parsed.pathname))
        } catch (error) {
          log(`  Invalid URL ${url}: ${formatError(error)}`)
          return null
        }
      }
    }

    // Path traversal protection: ensure resolved path is within project root
    // This prevents malicious URLs like "/../../../etc/passwd" from escaping
    if (filePath && !isPathWithinBase(filePath, this.projectRoot)) {
      log(`  Path traversal blocked: ${url} resolves outside project root`)
      return null
    }

    return filePath
  }

  /**
   * Load source map for a JavaScript file
   */
  async loadSourceMap(jsFilePath: string, code?: string): Promise<SourceMapData | null> {
    // Try external .map file
    const mapFilePath = jsFilePath + '.map'
    try {
      const mapContent = await fs.readFile(mapFilePath, 'utf-8')
      return JSON.parse(mapContent) as SourceMapData
    } catch (error) {
      log(`  External map file not found at ${mapFilePath}.map: ${formatError(error)}`)
    }

    // Try inline source map
    if (code) {
      const inlineMap = this.extractInlineSourceMap(code)
      if (inlineMap) return inlineMap
    }

    // Try sourceMappingURL comment
    if (code) {
      const urlMatch = code.match(SOURCE_MAPPING_URL_PATTERN)
      if (urlMatch) {
        const mapUrl = urlMatch[1].trim()

        // Handle data URL
        if (mapUrl.startsWith('data:')) {
          return this.parseDataUrl(mapUrl)
        }

        // Handle relative URL
        const mapPath = resolve(dirname(jsFilePath), mapUrl)
        try {
          const mapContent = await fs.readFile(mapPath, 'utf-8')
          return JSON.parse(mapContent) as SourceMapData
        } catch (error) {
          log(`  Source map file not found at ${mapPath}: ${formatError(error)}`)
        }
      }
    }

    return null
  }

  /**
   * Extract inline source map from code using convert-source-map
   * Handles multiple formats: base64, URI-encoded, and sectioned maps
   */
  extractInlineSourceMap(code: string): SourceMapData | null {
    try {
      // Use convert-source-map which handles multiple inline formats
      const converter = convertSourceMap.fromSource(code)
      if (converter) {
        const sourceMap = converter.toObject() as SourceMapData
        // Handle sectioned sourcemaps (webpack eval-source-map)
        return this.flattenSourceMap(sourceMap)
      }
    } catch (error) {
      log(`  Failed to parse inline source map: ${formatError(error)}`)
    }

    // Fallback to manual extraction for edge cases
    const match = code.match(INLINE_SOURCE_MAP_BASE64_PATTERN)

    if (match) {
      try {
        const decoded = Buffer.from(match[1], 'base64').toString('utf-8')
        const sourceMap = JSON.parse(decoded) as SourceMapData
        return this.flattenSourceMap(sourceMap)
      } catch (error) {
        log(`  Failed to decode inline source map: ${formatError(error)}`)
        return null
      }
    }

    return null
  }

  /**
   * Flatten sectioned sourcemaps into a single sourcemap
   * Webpack eval-source-map produces sourcemaps with sections array
   */
  private flattenSourceMap(sourceMap: SourceMapData): SourceMapData {
    // Check if this is a sectioned sourcemap
    const sections = (sourceMap as SourceMapData & { sections?: Array<{ offset: { line: number; column: number }; map: SourceMapData }> }).sections
    if (!sections || !Array.isArray(sections)) {
      return sourceMap // Already flat
    }

    // Merge all sections into a single sourcemap
    const mergedSources: string[] = []
    const mergedSourcesContent: (string | null)[] = []
    const mergedNames: string[] = []
    const mergedMappings: string[] = []

    for (const section of sections) {
      const { map } = section
      if (!map) continue

      // Collect sources and sourcesContent
      if (map.sources) {
        for (let i = 0; i < map.sources.length; i++) {
          const source = map.sources[i]
          if (!mergedSources.includes(source)) {
            mergedSources.push(source)
            mergedSourcesContent.push(map.sourcesContent?.[i] ?? null)
          }
        }
      }

      // Collect names
      if (map.names) {
        for (const name of map.names) {
          if (!mergedNames.includes(name)) {
            mergedNames.push(name)
          }
        }
      }

      // Note: Properly merging mappings with offsets is complex
      // For now, we take the first section's mappings as a simple approach
      if (map.mappings && mergedMappings.length === 0) {
        mergedMappings.push(map.mappings)
      }
    }

    return {
      version: 3,
      sources: mergedSources,
      sourcesContent: mergedSourcesContent,
      names: mergedNames,
      mappings: mergedMappings.join(';'),
      sourceRoot: sourceMap.sourceRoot,
    }
  }

  /**
   * Parse data URL source map
   */
  parseDataUrl(dataUrl: string): SourceMapData | null {
    const match = dataUrl.match(DATA_URL_BASE64_PATTERN)
    if (match) {
      try {
        const decoded = Buffer.from(match[1], 'base64').toString('utf-8')
        return JSON.parse(decoded) as SourceMapData
      } catch (error) {
        log(`  Failed to parse data URL source map: ${formatError(error)}`)
        return null
      }
    }
    return null
  }

  /**
   * Load source maps from V8 coverage's source-map-cache
   */
  loadFromV8Cache(coverage: V8Coverage): void {
    const cache = coverage['source-map-cache']
    if (!cache) return

    for (const [url, entry] of Object.entries(cache)) {
      if (entry.data) {
        const existing = this.sourceCache.get(url)
        if (existing) {
          existing.sourceMap = entry.data
        } else {
          this.sourceCache.set(url, {
            path: this.urlToFilePath(url) || url,
            code: '', // Code will be loaded separately
            sourceMap: entry.data,
          })
        }
      }
    }
  }

  /**
   * Resolve original source path from source map
   */
  resolveOriginalPath(sourceMap: SourceMapData, index: number): string | null {
    if (!sourceMap.sources || index >= sourceMap.sources.length) {
      return null
    }

    let sourcePath = sourceMap.sources[index]

    // Handle source root
    if (sourceMap.sourceRoot) {
      sourcePath = join(sourceMap.sourceRoot, sourcePath)
    }

    // Normalize webpack/Next.js paths
    sourcePath = this.normalizeSourcePath(sourcePath)

    return sourcePath
  }

  /**
   * Normalize source paths from source maps
   * Handles webpack:// prefixes, _N_E prefixes, etc.
   */
  normalizeSourcePath(sourcePath: string): string {
    // Use shared normalization for webpack paths
    const normalized = normalizeWebpackSourcePath(sourcePath)

    // Handle Windows absolute paths in source maps
    const srcMatch = normalized.match(/[/\\]src[/\\](.+)$/)
    if (srcMatch) {
      return 'src/' + srcMatch[1].replace(/\\/g, '/')
    }

    return normalized
  }

  /**
   * Get original source content from source map
   */
  getOriginalSource(sourceMap: SourceMapData, index: number): string | null {
    if (!sourceMap.sourcesContent || index >= sourceMap.sourcesContent.length) {
      return null
    }
    return sourceMap.sourcesContent[index]
  }

  /**
   * Clear the source cache
   */
  clearCache(): void {
    this.sourceCache.clear()
  }
}
