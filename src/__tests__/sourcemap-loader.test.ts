import { describe, it, expect, beforeEach } from 'vitest'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { SourceMapLoader } from '../sourcemap-loader.js'

const isWindows = process.platform === 'win32'
const projectRoot = isWindows ? 'C:/project' : '/project'

// Helper to create platform-specific expected paths
const p = (...parts: string[]) => join(...parts)

describe('SourceMapLoader', () => {
  let loader: SourceMapLoader

  beforeEach(() => {
    loader = new SourceMapLoader(projectRoot)
  })

  describe('constructor', () => {
    it('should set projectRoot', () => {
      const customLoader = new SourceMapLoader('/custom/root')
      expect(customLoader['projectRoot']).toBe('/custom/root')
    })

    it('should use default nextBuildDir when not provided', () => {
      expect(loader['nextBuildDir']).toBe(p(projectRoot, '.next'))
    })

    it('should use custom nextBuildDir when provided', () => {
      const customLoader = new SourceMapLoader('/project', '/project/.custom-next')
      expect(customLoader['nextBuildDir']).toBe('/project/.custom-next')
    })
  })

  describe('urlToFilePath', () => {
    it('should handle file:// URLs', () => {
      const filePath = p(projectRoot, 'src', 'index.ts')
      const fileUrl = pathToFileURL(filePath).href
      const result = loader.urlToFilePath(fileUrl)
      expect(result).toBe(filePath)
    })

    it('should handle Next.js static URLs', () => {
      const result = loader.urlToFilePath('/_next/static/chunks/main.js')
      expect(result).toBe(p(projectRoot, '.next', 'static', 'chunks', 'main.js'))
    })

    it('should decode URL-encoded characters in Next.js URLs', () => {
      const result = loader.urlToFilePath('/_next/static/chunks/pages/%5Bid%5D.js')
      expect(result).toBe(p(projectRoot, '.next', 'static', 'chunks', 'pages', '[id].js'))
    })

    it('should handle http URLs with /_next/ path', () => {
      const result = loader.urlToFilePath('http://localhost:3000/_next/static/chunks/main.js')
      expect(result).toBe(p(projectRoot, '.next', 'static', 'chunks', 'main.js'))
    })

    it('should handle relative paths starting with /', () => {
      const result = loader.urlToFilePath('/src/components/Button.tsx')
      expect(result).toBe(p(projectRoot, 'src', 'components', 'Button.tsx'))
    })

    it('should handle http URLs without /_next/', () => {
      const result = loader.urlToFilePath('http://localhost:3000/api/health')
      expect(result).toBe(p(projectRoot, 'api', 'health'))
    })

    it('should return null for invalid URLs', () => {
      const result = loader.urlToFilePath('not-a-valid-url')
      expect(result).toBeNull()
    })

    it('should decode URL-encoded characters in relative paths', () => {
      const result = loader.urlToFilePath('/src/components/%5Bid%5D/page.tsx')
      expect(result).toBe(p(projectRoot, 'src', 'components', '[id]', 'page.tsx'))
    })
  })

  describe('normalizeSourcePath', () => {
    it('should remove webpack:// prefix', () => {
      const result = loader.normalizeSourcePath('webpack://my-app/src/index.ts')
      expect(result).toBe('src/index.ts')
    })

    it('should remove _N_E/ prefix', () => {
      const result = loader.normalizeSourcePath('_N_E/src/components/Button.tsx')
      expect(result).toBe('src/components/Button.tsx')
    })

    it('should remove leading ./', () => {
      const result = loader.normalizeSourcePath('./src/utils/helper.ts')
      expect(result).toBe('src/utils/helper.ts')
    })

    it('should extract src path from Windows absolute paths', () => {
      const result = loader.normalizeSourcePath('C:\\Users\\dev\\project\\src\\index.ts')
      expect(result).toBe('src/index.ts')
    })

    it('should extract src path from Unix absolute paths', () => {
      const result = loader.normalizeSourcePath('/home/dev/project/src/index.ts')
      expect(result).toBe('src/index.ts')
    })

    it('should return path unchanged if no normalization needed', () => {
      const result = loader.normalizeSourcePath('src/components/Button.tsx')
      expect(result).toBe('src/components/Button.tsx')
    })
  })

  describe('extractInlineSourceMap', () => {
    it('should extract base64 inline source map', () => {
      const sourceMap = { version: 3, sources: ['test.ts'], mappings: 'AAAA' }
      const base64 = Buffer.from(JSON.stringify(sourceMap)).toString('base64')
      const code = `console.log("hello");\n//# sourceMappingURL=data:application/json;base64,${base64}`

      const result = loader.extractInlineSourceMap(code)

      expect(result).not.toBeNull()
      expect(result!.version).toBe(3)
      expect(result!.sources).toEqual(['test.ts'])
    })

    it('should extract base64 inline source map with charset', () => {
      const sourceMap = { version: 3, sources: ['test.ts'], mappings: 'BBBB' }
      const base64 = Buffer.from(JSON.stringify(sourceMap)).toString('base64')
      const code = `console.log("hello");\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64}`

      const result = loader.extractInlineSourceMap(code)

      expect(result).not.toBeNull()
      expect(result!.version).toBe(3)
    })

    it('should return null for code without source map', () => {
      const code = 'console.log("hello");'
      const result = loader.extractInlineSourceMap(code)
      expect(result).toBeNull()
    })

    it('should return null for invalid base64', () => {
      const code = '//# sourceMappingURL=data:application/json;base64,not-valid-base64!!!'
      const result = loader.extractInlineSourceMap(code)
      expect(result).toBeNull()
    })

    it('should handle sectioned sourcemaps', () => {
      const sectionedMap = {
        version: 3,
        sections: [
          {
            offset: { line: 0, column: 0 },
            map: {
              version: 3,
              sources: ['file1.ts'],
              sourcesContent: ['const a = 1'],
              names: ['a'],
              mappings: 'AAAA',
            },
          },
          {
            offset: { line: 10, column: 0 },
            map: {
              version: 3,
              sources: ['file2.ts'],
              sourcesContent: ['const b = 2'],
              names: ['b'],
              mappings: 'BBBB',
            },
          },
        ],
      }
      const base64 = Buffer.from(JSON.stringify(sectionedMap)).toString('base64')
      const code = `//# sourceMappingURL=data:application/json;base64,${base64}`

      const result = loader.extractInlineSourceMap(code)

      expect(result).not.toBeNull()
      expect(result!.version).toBe(3)
      expect(result!.sources).toContain('file1.ts')
      expect(result!.sources).toContain('file2.ts')
      expect(result!.sourcesContent).toContain('const a = 1')
      expect(result!.sourcesContent).toContain('const b = 2')
      expect(result!.names).toContain('a')
      expect(result!.names).toContain('b')
    })
  })

  describe('parseDataUrl', () => {
    it('should parse base64 data URL', () => {
      const sourceMap = { version: 3, sources: ['test.ts'], mappings: 'AAAA' }
      const base64 = Buffer.from(JSON.stringify(sourceMap)).toString('base64')
      const dataUrl = `data:application/json;base64,${base64}`

      const result = loader.parseDataUrl(dataUrl)

      expect(result).not.toBeNull()
      expect(result!.version).toBe(3)
      expect(result!.sources).toEqual(['test.ts'])
    })

    it('should parse base64 data URL with charset', () => {
      const sourceMap = { version: 3, sources: ['test.ts'], mappings: 'BBBB' }
      const base64 = Buffer.from(JSON.stringify(sourceMap)).toString('base64')
      const dataUrl = `data:application/json;charset=utf-8;base64,${base64}`

      const result = loader.parseDataUrl(dataUrl)

      expect(result).not.toBeNull()
      expect(result!.version).toBe(3)
    })

    it('should return null for non-data URLs', () => {
      const result = loader.parseDataUrl('https://example.com/map.json')
      expect(result).toBeNull()
    })

    it('should return null for invalid base64', () => {
      const result = loader.parseDataUrl('data:application/json;base64,invalid!!!')
      expect(result).toBeNull()
    })
  })

  describe('resolveOriginalPath', () => {
    it('should resolve path from source map sources array', () => {
      const sourceMap = {
        version: 3 as const,
        sources: ['src/index.ts', 'src/utils.ts'],
        mappings: '',
      }

      const result = loader.resolveOriginalPath(sourceMap, 0)
      expect(result).toBe('src/index.ts')
    })

    it('should apply sourceRoot if present', () => {
      const sourceMap = {
        version: 3 as const,
        sources: ['index.ts'],
        sourceRoot: 'src',
        mappings: '',
      }

      const result = loader.resolveOriginalPath(sourceMap, 0)
      expect(result).toBe(p('src', 'index.ts'))
    })

    it('should return null for out of bounds index', () => {
      const sourceMap = {
        version: 3 as const,
        sources: ['src/index.ts'],
        mappings: '',
      }

      const result = loader.resolveOriginalPath(sourceMap, 5)
      expect(result).toBeNull()
    })

    it('should return null if sources is undefined', () => {
      const sourceMap = {
        version: 3 as const,
        mappings: '',
      } as any

      const result = loader.resolveOriginalPath(sourceMap, 0)
      expect(result).toBeNull()
    })

    it('should normalize webpack paths', () => {
      const sourceMap = {
        version: 3 as const,
        sources: ['webpack://my-app/src/components/Button.tsx'],
        mappings: '',
      }

      const result = loader.resolveOriginalPath(sourceMap, 0)
      expect(result).toBe('src/components/Button.tsx')
    })
  })

  describe('getOriginalSource', () => {
    it('should get source content at index', () => {
      const sourceMap = {
        version: 3 as const,
        sources: ['src/index.ts'],
        sourcesContent: ['const x = 1;'],
        mappings: '',
      }

      const result = loader.getOriginalSource(sourceMap, 0)
      expect(result).toBe('const x = 1;')
    })

    it('should return null for out of bounds index', () => {
      const sourceMap = {
        version: 3 as const,
        sources: ['src/index.ts'],
        sourcesContent: ['const x = 1;'],
        mappings: '',
      }

      const result = loader.getOriginalSource(sourceMap, 5)
      expect(result).toBeNull()
    })

    it('should return null if sourcesContent is undefined', () => {
      const sourceMap = {
        version: 3 as const,
        sources: ['src/index.ts'],
        mappings: '',
      }

      const result = loader.getOriginalSource(sourceMap, 0)
      expect(result).toBeNull()
    })

    it('should return null entry from sourcesContent', () => {
      const sourceMap = {
        version: 3 as const,
        sources: ['src/index.ts', 'src/utils.ts'],
        sourcesContent: ['const x = 1;', null],
        mappings: '',
      }

      const result = loader.getOriginalSource(sourceMap, 1)
      expect(result).toBeNull()
    })
  })

  describe('clearCache', () => {
    it('should clear the source cache', () => {
      // Add something to cache by accessing the private map
      loader['sourceCache'].set('test', {
        path: '/test',
        code: 'test code',
      })

      expect(loader['sourceCache'].size).toBe(1)

      loader.clearCache()

      expect(loader['sourceCache'].size).toBe(0)
    })
  })

  describe('loadFromV8Cache', () => {
    it('should load source maps from V8 cache', () => {
      const filePath = p(projectRoot, 'src', 'index.js')
      const fileUrl = pathToFileURL(filePath).href
      const coverage = {
        result: [],
        'source-map-cache': {
          [fileUrl]: {
            data: {
              version: 3 as const,
              sources: ['index.ts'],
              mappings: 'AAAA',
            },
          },
        },
      }

      loader.loadFromV8Cache(coverage)

      const cached = loader['sourceCache'].get(fileUrl)
      expect(cached).not.toBeUndefined()
      expect(cached!.sourceMap).toBeDefined()
      expect(cached!.sourceMap!.sources).toEqual(['index.ts'])
    })

    it('should update existing cache entry with source map', () => {
      const filePath = p(projectRoot, 'src', 'index.js')
      const fileUrl = pathToFileURL(filePath).href
      // Pre-populate cache
      loader['sourceCache'].set(fileUrl, {
        path: filePath,
        code: 'console.log("hello")',
      })

      const coverage = {
        result: [],
        'source-map-cache': {
          [fileUrl]: {
            data: {
              version: 3 as const,
              sources: ['index.ts'],
              mappings: 'BBBB',
            },
          },
        },
      }

      loader.loadFromV8Cache(coverage)

      const cached = loader['sourceCache'].get(fileUrl)
      expect(cached!.code).toBe('console.log("hello")')
      expect(cached!.sourceMap).toBeDefined()
    })

    it('should handle empty source-map-cache', () => {
      const coverage = {
        result: [],
      }

      // Should not throw
      loader.loadFromV8Cache(coverage)
      expect(loader['sourceCache'].size).toBe(0)
    })

    it('should skip entries without data', () => {
      const coverage = {
        result: [],
        'source-map-cache': {
          'file:///project/src/index.js': {},
        },
      } as any

      loader.loadFromV8Cache(coverage)
      expect(loader['sourceCache'].size).toBe(0)
    })
  })
})
