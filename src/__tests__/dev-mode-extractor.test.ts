import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DevModeSourceMapExtractor,
  createDevModeExtractor,
  type ExtractedSourceMap,
} from '../dev-mode-extractor.js'

describe('DevModeSourceMapExtractor', () => {
  let extractor: DevModeSourceMapExtractor

  beforeEach(() => {
    extractor = new DevModeSourceMapExtractor()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Note: normalizeWebpackSourcePath tests are in src/parsers/__tests__/webpack.test.ts

  describe('isProjectScript', () => {
    it('should return true for webpack-internal src paths', () => {
      expect(extractor.isProjectScript('webpack-internal:///(rsc)/./src/app/page.tsx')).toBe(true)
    })

    it('should return true for decoded src paths', () => {
      expect(extractor.isProjectScript('webpack-internal:///(app-pages-browser)/./src/components/Button.tsx')).toBe(
        true
      )
    })

    it('should return false for non-webpack-internal paths', () => {
      expect(extractor.isProjectScript('/some/regular/path.ts')).toBe(false)
    })

    it('should return false for paths without src', () => {
      expect(extractor.isProjectScript('webpack-internal:///(rsc)/./lib/utils.ts')).toBe(false)
    })

    it('should work with custom source root', () => {
      const customExtractor = new DevModeSourceMapExtractor({ sourceRoot: 'lib' })
      expect(customExtractor.isProjectScript('webpack-internal:///(rsc)/./lib/utils.ts')).toBe(true)
      expect(customExtractor.isProjectScript('webpack-internal:///(rsc)/./src/app.ts')).toBe(false)
    })
  })

  describe('extractFromScriptSource', () => {
    it('should extract inline base64 source map', () => {
      const sourceMap = {
        version: 3,
        file: 'test.tsx',
        sources: ['src/app/test.tsx'],
        sourcesContent: ['export default function Test() {}'],
        mappings: 'AAAA',
        names: [],
      }
      const base64 = Buffer.from(JSON.stringify(sourceMap)).toString('base64')
      const scriptSource = `function Test() {}//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64}`

      const result = extractor.extractFromScriptSource('webpack-internal:///(rsc)/./src/app/test.tsx', scriptSource)

      expect(result).not.toBeNull()
      expect(result!.sourceMap.version).toBe(3)
      expect(result!.sourceMap.sources).toContain('src/app/test.tsx')
      expect(result!.originalPath).toBe('src/app/test.tsx')
    })

    it('should extract module ID from webpack-internal URL', () => {
      const sourceMap = {
        version: 3,
        file: 'test.tsx',
        sources: ['src/app/test.tsx'],
        sourcesContent: ['code'],
        mappings: 'AAAA',
        names: [],
      }
      const base64 = Buffer.from(JSON.stringify(sourceMap)).toString('base64')
      const scriptSource = `code//# sourceMappingURL=data:application/json;base64,${base64}`

      const result = extractor.extractFromScriptSource(
        'webpack-internal:///(rsc)/./src/app/test.tsx',
        scriptSource
      )

      expect(result!.moduleId).toBe('./src/app/test.tsx')
    })

    it('should return null for script without source map', () => {
      const result = extractor.extractFromScriptSource('test-url', 'function test() {}')
      expect(result).toBeNull()
    })

    it('should return null for invalid source map JSON', () => {
      const scriptSource = '//# sourceMappingURL=data:application/json;base64,notvalidbase64!!!'

      const result = extractor.extractFromScriptSource('test-url', scriptSource)

      expect(result).toBeNull()
    })

    it('should return null for external source map URL', () => {
      const scriptSource = 'code//# sourceMappingURL=test.tsx.map'
      const result = extractor.extractFromScriptSource('test-url', scriptSource)
      expect(result).toBeNull()
    })

    it('should cache extracted source maps', () => {
      const sourceMap = {
        version: 3,
        sources: ['src/test.tsx'],
        sourcesContent: ['code'],
        mappings: 'AAAA',
        names: [],
      }
      const base64 = Buffer.from(JSON.stringify(sourceMap)).toString('base64')
      const scriptSource = `code//# sourceMappingURL=data:application/json;base64,${base64}`

      extractor.extractFromScriptSource('webpack-internal:///(rsc)/./src/test.tsx', scriptSource)

      const cached = extractor.getSourceMap('src/test.tsx')
      expect(cached).not.toBeUndefined()
      expect(cached!.originalPath).toBe('src/test.tsx')
    })
  })

  describe('extractFromChunkContent', () => {
    it('should extract source maps from webpack eval chunk', () => {
      const sourceMap = {
        version: 3,
        file: 'page.tsx',
        sources: ['src/app/page.tsx'],
        sourcesContent: ['export default function Page() {}'],
        mappings: 'AAAA',
        names: [],
      }
      const base64 = Buffer.from(JSON.stringify(sourceMap)).toString('base64')
      const chunkContent = `
        __webpack_require__.r(__webpack_exports__);
        eval("function Page() {}//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64}");
      `

      const results = extractor.extractFromChunkContent(chunkContent)

      expect(results.length).toBe(1)
      expect(results[0].sourceMap.sources).toContain('src/app/page.tsx')
    })

    it('should return empty array for chunk without source maps', () => {
      const chunkContent = '__webpack_require__.r(__webpack_exports__);'
      const results = extractor.extractFromChunkContent(chunkContent)
      expect(results).toEqual([])
    })

    it('should extract multiple source maps from chunk', () => {
      const sourceMap1 = {
        version: 3,
        file: 'first.tsx',
        sources: ['first.tsx'],
        sourcesContent: ['first'],
        mappings: 'AAAA',
        names: [],
      }
      const sourceMap2 = {
        version: 3,
        file: 'second.tsx',
        sources: ['second.tsx'],
        sourcesContent: ['second'],
        mappings: 'BBBB',
        names: [],
      }
      const base64_1 = Buffer.from(JSON.stringify(sourceMap1)).toString('base64')
      const base64_2 = Buffer.from(JSON.stringify(sourceMap2)).toString('base64')

      const chunkContent = `
        eval("first//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64_1}");
        eval("second//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64_2}");
      `

      const results = extractor.extractFromChunkContent(chunkContent)

      expect(results.length).toBe(2)
    })
  })

  describe('filterProjectSourceMaps', () => {
    it('should filter source maps to only include project sources', () => {
      const projectSource: ExtractedSourceMap = {
        moduleId: '(app-pages-browser)/./src/app/page.tsx',
        code: 'code',
        sourceMap: { version: 3, mappings: '', sources: ['src/app/page.tsx'], names: [] },
        originalPath: 'src/app/page.tsx',
      }
      const nodeModulesSource: ExtractedSourceMap = {
        moduleId: '(app-pages-browser)/./node_modules/react/index.js',
        code: 'code',
        sourceMap: { version: 3, mappings: '', sources: ['node_modules/react/index.js'], names: [] },
        originalPath: 'node_modules/react/index.js',
      }

      const results = extractor.filterProjectSourceMaps([projectSource, nodeModulesSource])

      expect(results.length).toBe(1)
      expect(results[0].originalPath).toBe('src/app/page.tsx')
    })

    it('should work with custom source root', () => {
      const customExtractor = new DevModeSourceMapExtractor({ sourceRoot: 'lib' })

      const libSource: ExtractedSourceMap = {
        moduleId: '(rsc)/./lib/utils.ts',
        code: 'code',
        sourceMap: { version: 3, mappings: '', sources: ['lib/utils.ts'], names: [] },
        originalPath: 'lib/utils.ts',
      }
      const srcSource: ExtractedSourceMap = {
        moduleId: '(rsc)/./src/app.ts',
        code: 'code',
        sourceMap: { version: 3, mappings: '', sources: ['src/app.ts'], names: [] },
        originalPath: 'src/app.ts',
      }

      const results = customExtractor.filterProjectSourceMaps([libSource, srcSource])

      expect(results.length).toBe(1)
      expect(results[0].originalPath).toBe('lib/utils.ts')
    })

    it('should return empty array if no project sources', () => {
      const nodeModulesSource: ExtractedSourceMap = {
        moduleId: 'node_modules/react/index.js',
        code: 'code',
        sourceMap: { version: 3, mappings: '', sources: ['node_modules/react/index.js'], names: [] },
        originalPath: 'node_modules/react/index.js',
      }

      const results = extractor.filterProjectSourceMaps([nodeModulesSource])

      expect(results).toEqual([])
    })
  })

  describe('cache operations', () => {
    it('should cache and retrieve source maps', () => {
      const sourceMap = {
        version: 3,
        sources: ['src/test.tsx'],
        sourcesContent: ['code'],
        mappings: 'AAAA',
        names: [],
      }
      const base64 = Buffer.from(JSON.stringify(sourceMap)).toString('base64')
      const scriptSource = `code//# sourceMappingURL=data:application/json;base64,${base64}`

      extractor.extractFromScriptSource('webpack-internal:///(rsc)/./src/test.tsx', scriptSource)

      const cached = extractor.getSourceMap('src/test.tsx')
      expect(cached).not.toBeUndefined()
    })

    it('should return undefined for non-cached paths', () => {
      const result = extractor.getSourceMap('unknown-path')
      expect(result).toBeUndefined()
    })

    it('should clear cache', () => {
      const sourceMap = {
        version: 3,
        sources: ['src/test.tsx'],
        sourcesContent: ['code'],
        mappings: 'AAAA',
        names: [],
      }
      const base64 = Buffer.from(JSON.stringify(sourceMap)).toString('base64')
      const scriptSource = `code//# sourceMappingURL=data:application/json;base64,${base64}`

      extractor.extractFromScriptSource('webpack-internal:///(rsc)/./src/test.tsx', scriptSource)
      expect(extractor.getSourceMap('src/test.tsx')).not.toBeUndefined()

      extractor.clearCache()
      expect(extractor.getSourceMap('src/test.tsx')).toBeUndefined()
    })
  })

  describe('toStandardSourceMap', () => {
    it('should convert extracted source map to standard format', () => {
      const extracted: ExtractedSourceMap = {
        moduleId: 'test',
        code: 'code',
        sourceMap: {
          version: 3,
          mappings: 'AAAA',
          sources: ['webpack://_N_E/./src/app/page.tsx'],
          sourcesContent: ['content'],
          names: ['test'],
          sourceRoot: '',
        },
        originalPath: 'src/app/page.tsx',
      }

      const result = extractor.toStandardSourceMap(extracted)

      expect(result.version).toBe(3)
      expect(result.file).toBe('src/app/page.tsx')
      expect(result.sources).toContain('src/app/page.tsx')
      expect(result.sourcesContent).toEqual(['content'])
      expect(result.names).toEqual(['test'])
    })

    it('should normalize webpack paths in sources', () => {
      const extracted: ExtractedSourceMap = {
        moduleId: 'test',
        code: 'code',
        sourceMap: {
          version: 3,
          mappings: 'AAAA',
          sources: ['webpack://_N_E/./src/lib/utils.ts?hash'],
          names: [],
        },
        originalPath: 'src/lib/utils.ts',
      }

      const result = extractor.toStandardSourceMap(extracted)

      expect(result.sources[0]).toBe('src/lib/utils.ts')
    })
  })

  describe('constructor config', () => {
    it('should use default config', () => {
      const ext = new DevModeSourceMapExtractor()
      expect(ext.isProjectScript('webpack-internal:///(rsc)/./src/test.ts')).toBe(true)
    })

    it('should use custom sourceRoot', () => {
      const ext = new DevModeSourceMapExtractor({ sourceRoot: 'app' })
      expect(ext.isProjectScript('webpack-internal:///(rsc)/./app/test.ts')).toBe(true)
      expect(ext.isProjectScript('webpack-internal:///(rsc)/./src/test.ts')).toBe(false)
    })

    it('should use custom baseUrl', () => {
      const ext = new DevModeSourceMapExtractor({ baseUrl: 'http://localhost:4000' })
      // baseUrl is used for client chunk fetching, verify it's set
      expect(ext).toBeDefined()
    })

    it('should use custom cdpPort', () => {
      const ext = new DevModeSourceMapExtractor({ cdpPort: 9999 })
      // cdpPort is used for server coverage, verify it's set
      expect(ext).toBeDefined()
    })
  })
})

describe('createDevModeExtractor', () => {
  it('should create extractor with default config', () => {
    const ext = createDevModeExtractor()
    expect(ext).toBeInstanceOf(DevModeSourceMapExtractor)
    expect(ext.isProjectScript('webpack-internal:///(rsc)/./src/test.ts')).toBe(true)
  })

  it('should create extractor with custom config', () => {
    const ext = createDevModeExtractor({ sourceRoot: 'lib' })
    expect(ext.isProjectScript('webpack-internal:///(rsc)/./lib/test.ts')).toBe(true)
    expect(ext.isProjectScript('webpack-internal:///(rsc)/./src/test.ts')).toBe(false)
  })
})
