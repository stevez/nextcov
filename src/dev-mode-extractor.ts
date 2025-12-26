/**
 * Dev Mode Source Map Extractor
 *
 * Extracts inline source maps from webpack's eval-source-map format
 * used in Next.js dev mode. Works for both client-side (HTTP) and
 * server-side (CDP) code.
 *
 * In dev mode, webpack embeds source maps as base64 DataURLs inside eval() calls:
 * eval("...code...//# sourceMappingURL=data:application/json;charset=utf-8;base64,<base64>")
 */

import type { SourceMapData } from './types.js'
import {
  WEBPACK_INTERNAL_MODULE_PATTERN,
  isWebpackUrl,
  containsSourceRoot,
  normalizeWebpackSourcePath,
} from './parsers/webpack.js'
import { NEXTJS_CHUNK_PATTERN, COMMON_DEV_CHUNKS } from './parsers/nextjs.js'
import {
  SOURCE_MAP_LOOKBACK_LIMIT,
  INLINE_SOURCE_MAP_PATTERN,
  INLINE_SOURCE_MAP_PATTERN_GLOBAL,
} from './parsers/sourcemap.js'
import { SOURCE_MAP_CACHE_MAX_SIZE } from './constants.js'
import { DEFAULT_DEV_MODE_OPTIONS, DEFAULT_NEXTCOV_CONFIG } from './config.js'
import { log, formatError } from './logger.js'

export interface ExtractedSourceMap {
  /** Webpack module ID (e.g., "(app-pages-browser)/./src/components/Button.tsx") */
  moduleId: string
  /** Transpiled code from the module */
  code: string
  /** Decoded source map with original source */
  sourceMap: SourceMapData
  /** Original file path extracted from source map */
  originalPath: string
}

export interface DevModeConfig {
  /** Base URL of the dev server (default: http://localhost:3000) */
  baseUrl?: string
  /** CDP port for server coverage (default: 9231 for worker process) */
  cdpPort?: number
  /** Project source root for filtering (default: src) */
  sourceRoot?: string
}

const DEFAULT_CONFIG: Required<DevModeConfig> = {
  baseUrl: DEFAULT_DEV_MODE_OPTIONS.baseUrl,
  cdpPort: DEFAULT_DEV_MODE_OPTIONS.devCdpPort,
  sourceRoot: DEFAULT_NEXTCOV_CONFIG.sourceRoot.replace(/^\.\//, ''),
}

/**
 * Dev Mode Source Map Extractor
 *
 * Handles extraction of inline source maps from webpack's eval-source-map
 * format used in Next.js dev mode.
 */
export class DevModeSourceMapExtractor {
  private config: Required<DevModeConfig>
  private sourceMapCache: Map<string, ExtractedSourceMap> = new Map()

  constructor(config?: DevModeConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Extract inline source maps from a chunk's JavaScript content
   *
   * This parses webpack eval-source-map format where source maps are embedded
   * as base64 DataURLs in the sourceMappingURL comment.
   */
  extractFromChunkContent(chunkContent: string): ExtractedSourceMap[] {
    const results: ExtractedSourceMap[] = []

    // Create a new regex instance for each call (global regex is stateful)
    const sourceMapPattern = new RegExp(INLINE_SOURCE_MAP_PATTERN_GLOBAL.source, 'g')

    let match
    while ((match = sourceMapPattern.exec(chunkContent)) !== null) {
      const base64Data = match[1]

      try {
        const jsonStr = Buffer.from(base64Data, 'base64').toString('utf-8')
        const sourceMap = JSON.parse(jsonStr) as SourceMapData

        // Get module ID from the source map file field
        const moduleId = sourceMap.file || 'unknown'

        // Extract the code portion (content before sourceMappingURL)
        const code = this.extractCodeBeforeSourceMap(chunkContent, match.index)

        // Get original file path from source map
        const originalPath = this.extractOriginalPath(sourceMap)

        if (originalPath) {
          const extracted: ExtractedSourceMap = {
            moduleId,
            code,
            sourceMap,
            originalPath,
          }

          results.push(extracted)
          // Limit cache size to prevent unbounded memory growth
          if (this.sourceMapCache.size >= SOURCE_MAP_CACHE_MAX_SIZE) {
            const keysToDelete = Array.from(this.sourceMapCache.keys()).slice(0, Math.floor(SOURCE_MAP_CACHE_MAX_SIZE * 0.2))
            keysToDelete.forEach(key => this.sourceMapCache.delete(key))
          }
          this.sourceMapCache.set(originalPath, extracted)
        }
      } catch (error) {
        log(`  Skipping invalid source map: ${formatError(error)}`)
      }
    }

    return results
  }

  /**
   * Extract code content before the sourceMappingURL comment
   */
  private extractCodeBeforeSourceMap(content: string, sourceMapIndex: number): string {
    // Look back from the sourceMapIndex to find the eval content start
    const lookbackLength = Math.min(sourceMapIndex, SOURCE_MAP_LOOKBACK_LIMIT)
    const section = content.substring(sourceMapIndex - lookbackLength, sourceMapIndex)

    // Find the start of the eval content
    const evalMatch = section.match(/eval\(__webpack_require__\.ts\("([^]*?)$/s)
    if (evalMatch) {
      return evalMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\t/g, '\t')
    }

    return ''
  }

  /**
   * Extract original file path from source map
   */
  private extractOriginalPath(sourceMap: SourceMapData): string | null {
    if (!sourceMap.sources || sourceMap.sources.length === 0) {
      return null
    }

    // Get the first source (usually the original file)
    const source = sourceMap.sources[0]

    // Normalize webpack:// URLs to relative paths
    return normalizeWebpackSourcePath(source)
  }

  /**
   * Filter to only include project source files (not node_modules)
   */
  filterProjectSourceMaps(sourceMaps: ExtractedSourceMap[]): ExtractedSourceMap[] {
    const sourceRoot = this.config.sourceRoot
    return sourceMaps.filter((sm) => {
      const { moduleId, originalPath } = sm

      // Exclude node_modules first
      if (moduleId.includes('node_modules') || originalPath.includes('node_modules')) {
        return false
      }

      // Check for project src directory
      return (
        containsSourceRoot(moduleId, sourceRoot) ||
        originalPath.startsWith(`${sourceRoot}/`)
      )
    })
  }

  /**
   * Fetch and extract source maps from a client-side chunk URL
   */
  async extractFromClientChunk(chunkUrl: string): Promise<ExtractedSourceMap[]> {
    try {
      const response = await fetch(chunkUrl)
      if (!response.ok) {
        return []
      }

      const content = await response.text()
      return this.extractFromChunkContent(content)
    } catch (error) {
      log(`  Chunk fetch failed for ${chunkUrl}: ${formatError(error)}`)
      return []
    }
  }

  /**
   * Discover and extract source maps from all client chunks
   */
  async extractAllClientSourceMaps(): Promise<ExtractedSourceMap[]> {
    const allSourceMaps: ExtractedSourceMap[] = []

    try {
      // In dev mode, try to fetch the main page and extract chunk URLs
      const pageResponse = await fetch(this.config.baseUrl)
      const pageHtml = await pageResponse.text()

      // Find all chunk script URLs
      const chunkPattern = new RegExp(NEXTJS_CHUNK_PATTERN.source, 'g')
      const chunks = new Set<string>()

      let match
      while ((match = chunkPattern.exec(pageHtml)) !== null) {
        chunks.add(match[0])
      }

      // Also try common dev mode chunk paths
      for (const chunk of COMMON_DEV_CHUNKS) {
        chunks.add(chunk)
      }

      // Fetch each chunk and extract source maps
      for (const chunk of chunks) {
        const chunkUrl = `${this.config.baseUrl}/${chunk}`
        const sourceMaps = await this.extractFromClientChunk(chunkUrl)
        allSourceMaps.push(...sourceMaps)
      }
    } catch (error) {
      log(`  Dev server not available: ${formatError(error)}`)
    }

    return this.filterProjectSourceMaps(allSourceMaps)
  }

  /**
   * Extract source map from a CDP script source
   *
   * This is used for server-side code where we get the script source
   * via Debugger.getScriptSource()
   */
  extractFromScriptSource(
    scriptUrl: string,
    scriptSource: string
  ): ExtractedSourceMap | null {
    // Check if the script has an inline source map
    const match = scriptSource.match(INLINE_SOURCE_MAP_PATTERN)

    if (!match) {
      return null
    }

    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf-8')
      const sourceMap = JSON.parse(decoded) as SourceMapData

      const originalPath = this.extractOriginalPath(sourceMap)
      if (!originalPath) {
        return null
      }

      // Extract module ID from webpack-internal URL
      // e.g., webpack-internal:///(rsc)/./src/app/layout.tsx
      let moduleId = scriptUrl
      const webpackMatch = scriptUrl.match(WEBPACK_INTERNAL_MODULE_PATTERN)
      if (webpackMatch) {
        moduleId = webpackMatch[1]
      }

      // Get code without the source map comment
      const code = scriptSource.substring(0, match.index || 0)

      const extracted: ExtractedSourceMap = {
        moduleId,
        code,
        sourceMap,
        originalPath,
      }

      // Limit cache size to prevent unbounded memory growth
      if (this.sourceMapCache.size >= SOURCE_MAP_CACHE_MAX_SIZE) {
        const keysToDelete = Array.from(this.sourceMapCache.keys()).slice(0, Math.floor(SOURCE_MAP_CACHE_MAX_SIZE * 0.2))
        keysToDelete.forEach(key => this.sourceMapCache.delete(key))
      }
      this.sourceMapCache.set(originalPath, extracted)
      return extracted
    } catch (error) {
      log(`  Failed to extract source map from script: ${formatError(error)}`)
      return null
    }
  }

  /**
   * Check if a script URL is a project source file
   */
  isProjectScript(scriptUrl: string): boolean {
    // Webpack internal scripts with src/ path
    if (isWebpackUrl(scriptUrl)) {
      const normalizedUrl = decodeURIComponent(scriptUrl)
      return containsSourceRoot(normalizedUrl, this.config.sourceRoot)
    }
    return false
  }

  /**
   * Get cached source map for a path
   */
  getSourceMap(originalPath: string): ExtractedSourceMap | undefined {
    return this.sourceMapCache.get(originalPath)
  }

  /**
   * Clear the source map cache
   */
  clearCache(): void {
    this.sourceMapCache.clear()
  }

  /**
   * Convert extracted source map to standard SourceMapData format
   * for use with coverage processing
   */
  toStandardSourceMap(extracted: ExtractedSourceMap): SourceMapData {
    return {
      version: extracted.sourceMap.version,
      file: extracted.originalPath,
      mappings: extracted.sourceMap.mappings,
      sources: extracted.sourceMap.sources.map((s) => normalizeWebpackSourcePath(s)),
      sourcesContent: extracted.sourceMap.sourcesContent || [],
      names: extracted.sourceMap.names || [],
      sourceRoot: extracted.sourceMap.sourceRoot,
    }
  }
}

/**
 * Create a dev mode extractor with config
 */
export function createDevModeExtractor(config?: DevModeConfig): DevModeSourceMapExtractor {
  return new DevModeSourceMapExtractor(config)
}
