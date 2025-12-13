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
import { DEFAULT_NEXTCOV_CONFIG } from './config.js'
import { FILE_PROTOCOL, extractNextPath, SOURCE_MAPPING_URL_PATTERN, INLINE_SOURCE_MAP_BASE64_PATTERN, DATA_URL_BASE64_PATTERN, normalizeWebpackSourcePath } from './constants.js'

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

      this.sourceCache.set(url, sourceFile)
      return sourceFile
    } catch {
      // File doesn't exist or can't be read - silently skip
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
   */
  urlToFilePath(url: string): string | null {
    // Handle file:// URLs
    if (url.startsWith(FILE_PROTOCOL)) {
      return fileURLToPath(url)
    }

    // Handle Next.js URLs (works for both /_next/... and http://.../_next/...)
    const nextPath = extractNextPath(url)
    if (nextPath) {
      return this.nextPathToFilePath(nextPath)
    }

    // Handle relative paths
    if (url.startsWith('/')) {
      return join(this.projectRoot, decodeURIComponent(url))
    }

    // Handle http(s) URLs without /_next/ - extract pathname
    try {
      const parsed = new URL(url)
      return join(this.projectRoot, decodeURIComponent(parsed.pathname))
    } catch {
      return null
    }
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
    } catch {
      // External map file doesn't exist, try inline
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
        } catch {
          // Map file not found
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
    } catch {
      // Ignore errors - might be a false positive match in source code
    }

    // Fallback to manual extraction for edge cases
    const match = code.match(INLINE_SOURCE_MAP_BASE64_PATTERN)

    if (match) {
      try {
        const decoded = Buffer.from(match[1], 'base64').toString('utf-8')
        const sourceMap = JSON.parse(decoded) as SourceMapData
        return this.flattenSourceMap(sourceMap)
      } catch {
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
      } catch {
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
    let normalized = normalizeWebpackSourcePath(sourcePath)

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
