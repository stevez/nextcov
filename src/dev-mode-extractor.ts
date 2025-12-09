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
  baseUrl: 'http://localhost:3000',
  cdpPort: 9231, // Worker process port (9230 + 1)
  sourceRoot: 'src',
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

    // Pattern to find all inline source map DataURLs
    const sourceMapPattern =
      /sourceMappingURL=data:application\/json;charset=utf-8;base64,([A-Za-z0-9+/=]+)/g

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
          this.sourceMapCache.set(originalPath, extracted)
        }
      } catch {
        // Skip invalid source maps
      }
    }

    return results
  }

  /**
   * Extract code content before the sourceMappingURL comment
   */
  private extractCodeBeforeSourceMap(content: string, sourceMapIndex: number): string {
    // Look back from the sourceMapIndex to find the eval content start
    const lookbackLength = Math.min(sourceMapIndex, 10000)
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
    let source = sourceMap.sources[0]

    // Normalize webpack:// URLs to relative paths
    source = this.normalizeWebpackPath(source)

    return source
  }

  /**
   * Normalize webpack source URL to relative path
   */
  normalizeWebpackPath(source: string): string {
    // Remove webpack://_N_E/ prefix
    let path = source.replace(/^webpack:\/\/[^/]+\//, '')

    // Remove query string (e.g., ?xxxx)
    path = path.replace(/\?[^?]*$/, '')

    // Remove leading ./
    path = path.replace(/^\.\//, '')

    // Handle Windows URL-encoded paths
    path = decodeURIComponent(path)

    return path
  }

  /**
   * Filter to only include project source files (not node_modules)
   */
  filterProjectSourceMaps(sourceMaps: ExtractedSourceMap[]): ExtractedSourceMap[] {
    return sourceMaps.filter((sm) => {
      const moduleId = sm.moduleId
      const originalPath = sm.originalPath

      // Check for project src directory
      if (
        moduleId.includes(`/${this.config.sourceRoot}/`) ||
        moduleId.includes(`/./${this.config.sourceRoot}/`) ||
        originalPath.startsWith(this.config.sourceRoot + '/')
      ) {
        // Exclude node_modules
        if (moduleId.includes('node_modules') || originalPath.includes('node_modules')) {
          return false
        }
        return true
      }

      return false
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
    } catch {
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
      const chunkPattern = /_next\/static\/chunks\/[^"']+\.js/g
      const chunks = new Set<string>()

      let match
      while ((match = chunkPattern.exec(pageHtml)) !== null) {
        chunks.add(match[0])
      }

      // Also try common dev mode chunk paths
      const commonChunks = [
        '_next/static/chunks/app/page.js',
        '_next/static/chunks/app/layout.js',
        '_next/static/chunks/main-app.js',
        '_next/static/chunks/webpack.js',
      ]

      for (const chunk of commonChunks) {
        chunks.add(chunk)
      }

      // Fetch each chunk and extract source maps
      for (const chunk of chunks) {
        const chunkUrl = `${this.config.baseUrl}/${chunk}`
        const sourceMaps = await this.extractFromClientChunk(chunkUrl)
        allSourceMaps.push(...sourceMaps)
      }
    } catch {
      // Dev server might not be running
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
    const match = scriptSource.match(
      /sourceMappingURL=data:application\/json[^,]*,([A-Za-z0-9+/=]+)/
    )

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
      const webpackMatch = scriptUrl.match(/webpack-internal:\/\/\/\([^)]+\)\/(.+)/)
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

      this.sourceMapCache.set(originalPath, extracted)
      return extracted
    } catch {
      return null
    }
  }

  /**
   * Check if a script URL is a project source file
   */
  isProjectScript(scriptUrl: string): boolean {
    // Webpack internal scripts with src/ path
    if (scriptUrl.includes('webpack-internal')) {
      const normalizedUrl = decodeURIComponent(scriptUrl)
      return (
        normalizedUrl.includes(`/${this.config.sourceRoot}/`) ||
        normalizedUrl.includes(`/./${this.config.sourceRoot}/`)
      )
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
      sources: extracted.sourceMap.sources.map((s) => this.normalizeWebpackPath(s)),
      sourcesContent: extracted.sourceMap.sourcesContent || [],
      names: extracted.sourceMap.names || [],
      sourceRoot: extracted.sourceMap.sourceRoot,
    }
  }
}

/**
 * Check if running in dev mode
 * Detects based on environment and build artifacts
 */
export function isDevMode(): boolean {
  // Check NODE_ENV
  if (process.env.NODE_ENV === 'development') {
    return true
  }

  // Check for dev-specific indicators
  // In dev mode, Next.js runs with hot reload and doesn't produce .map files
  return false
}

/**
 * Create a dev mode extractor with config
 */
export function createDevModeExtractor(config?: DevModeConfig): DevModeSourceMapExtractor {
  return new DevModeSourceMapExtractor(config)
}
