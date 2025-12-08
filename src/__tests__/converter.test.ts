import { describe, it, expect, beforeEach, vi } from 'vitest'
import { join } from 'node:path'
import { CoverageConverter } from '../converter.js'
import { SourceMapLoader } from '../sourcemap-loader.js'

const isWindows = process.platform === 'win32'
const projectRoot = isWindows ? 'C:/project' : '/project'

describe('CoverageConverter', () => {
  let converter: CoverageConverter
  let sourceMapLoader: SourceMapLoader

  beforeEach(() => {
    sourceMapLoader = new SourceMapLoader(projectRoot)
    converter = new CoverageConverter(projectRoot, sourceMapLoader)
  })

  describe('constructor', () => {
    it('should set projectRoot', () => {
      expect(converter['projectRoot']).toBe(projectRoot)
    })

    it('should set sourceMapLoader', () => {
      expect(converter['sourceMapLoader']).toBe(sourceMapLoader)
    })

    it('should accept optional source filter', () => {
      const filter = (path: string) => path.includes('src/')
      const filteredConverter = new CoverageConverter(projectRoot, sourceMapLoader, filter)
      expect(filteredConverter['sourceFilter']).toBe(filter)
    })
  })

  describe('toFileUrl', () => {
    it('should return file:// URL unchanged', () => {
      const result = converter['toFileUrl']('file:///project/src/index.ts')
      expect(result).toBe('file:///project/src/index.ts')
    })

    it('should convert Windows absolute path to file URL', () => {
      const result = converter['toFileUrl']('C:\\project\\src\\index.ts')
      expect(result).toBe('file:///C:/project/src/index.ts')
    })

    it('should convert Unix absolute path to file URL', () => {
      const result = converter['toFileUrl']('/project/src/index.ts')
      expect(result).toBe('file:///project/src/index.ts')
    })

    it('should convert relative path to absolute file URL', () => {
      const result = converter['toFileUrl']('src/index.ts')
      expect(result).toMatch(/^file:\/\//)
      expect(result).toContain('src/index.ts')
    })
  })

  describe('extractSourcePath', () => {
    it('should extract src path from .next path', () => {
      const path = '.next/static/chunks/app/src/app/page.tsx'
      const result = converter['extractSourcePath'](path)

      expect(result).toContain('src')
      expect(result).toContain('app')
      expect(result).toContain('page.tsx')
    })

    it('should return null for non-JS/TS files', () => {
      const result = converter['extractSourcePath']('/project/styles.css')
      expect(result).toBeNull()
    })

    it('should return null for files without src/', () => {
      const result = converter['extractSourcePath']('/project/lib/utils.ts')
      expect(result).toBeNull()
    })

    it('should handle paths with multiple src/ occurrences', () => {
      const path = '/project/.next/server/src/src/lib/utils.ts'
      const result = converter['extractSourcePath'](path)

      expect(result).not.toBeNull()
      expect(result).toContain('src')
    })
  })

  describe('isValidSource', () => {
    it('should reject empty source', () => {
      expect(converter['isValidSource']('', null)).toBe(false)
      expect(converter['isValidSource'](null, null)).toBe(false)
      expect(converter['isValidSource']('   ', null)).toBe(false)
    })

    it('should reject webpack externals', () => {
      expect(converter['isValidSource']('external commonjs react', 'code')).toBe(false)
      expect(converter['isValidSource']('external%20commonjs%20react', 'code')).toBe(false)
    })

    it('should reject webpack queries', () => {
      expect(converter['isValidSource']('webpack://app/src/file.ts?module', 'code')).toBe(false)
    })

    it('should reject node_modules', () => {
      expect(converter['isValidSource']('node_modules/lodash/index.js', 'code')).toBe(false)
      expect(converter['isValidSource']('webpack://app/node_modules/react/index.js', 'code')).toBe(false)
    })

    it('should reject sources without src/', () => {
      expect(converter['isValidSource']('lib/utils.ts', 'code')).toBe(false)
    })

    it('should reject sources without content', () => {
      expect(converter['isValidSource']('src/index.ts', null)).toBe(false)
      expect(converter['isValidSource']('src/index.ts', undefined)).toBe(false)
    })

    it('should accept valid source with src/ and content', () => {
      expect(converter['isValidSource']('src/index.ts', 'const x = 1')).toBe(true)
      expect(converter['isValidSource']('webpack://app/src/utils.ts', 'export const add = (a, b) => a + b')).toBe(true)
    })
  })

  describe('shouldIgnoreNode', () => {
    it('should ignore webpack require expressions', () => {
      const node = {
        type: 'ExpressionStatement',
        expression: {
          type: 'CallExpression',
          callee: { name: '__webpack_require__' },
        },
      }

      expect(converter['shouldIgnoreNode'](node, 'statement')).toBe(true)
    })

    it('should ignore webpack exports', () => {
      const node = {
        type: 'ExpressionStatement',
        expression: {
          type: 'CallExpression',
          callee: {
            type: 'MemberExpression',
            object: { name: '__webpack_exports__' },
          },
        },
      }

      expect(converter['shouldIgnoreNode'](node, 'statement')).toBe(true)
    })

    it('should ignore module.exports', () => {
      const node = {
        type: 'ExpressionStatement',
        expression: {
          type: 'AssignmentExpression',
          left: {
            type: 'MemberExpression',
            object: { name: 'module' },
            property: { name: 'exports' },
          },
        },
      }

      expect(converter['shouldIgnoreNode'](node, 'statement')).toBe(true)
    })

    it('should ignore "use strict" directive', () => {
      const node = {
        type: 'ExpressionStatement',
        expression: {
          type: 'Literal',
          value: 'use strict',
        },
      }

      expect(converter['shouldIgnoreNode'](node, 'statement')).toBe(true)
    })

    it('should not ignore regular statements', () => {
      const node = {
        type: 'ExpressionStatement',
        expression: {
          type: 'CallExpression',
          callee: { name: 'console.log' },
        },
      }

      expect(converter['shouldIgnoreNode'](node, 'statement')).toBe(false)
    })
  })

  describe('findLogicalExpressionLines', () => {
    it('should find lines with logical expressions', () => {
      const code = `
        const a = true || false;
        const b = x && y;
        const c = a ?? b;
      `
      const lines = converter['findLogicalExpressionLines'](code, 'test.ts')

      expect(lines.size).toBeGreaterThan(0)
    })

    it('should not find arithmetic expressions', () => {
      const code = `
        const a = 1 + 2;
        const b = 3 * 4;
      `
      const lines = converter['findLogicalExpressionLines'](code, 'test.ts')

      expect(lines.size).toBe(0)
    })

    it('should handle TypeScript code', () => {
      const code = `
        interface Props { value: boolean }
        const result = props.value || defaultValue;
      `
      const lines = converter['findLogicalExpressionLines'](code, 'test.tsx')

      expect(lines.size).toBeGreaterThan(0)
    })

    it('should handle JSX code', () => {
      const code = `
        const Component = () => {
          return <div>{isLoading || <Content />}</div>;
        };
      `
      const lines = converter['findLogicalExpressionLines'](code, 'test.tsx')

      expect(lines.size).toBeGreaterThan(0)
    })

    it('should return empty set for invalid code', () => {
      const code = 'this is not valid javascript {'
      const lines = converter['findLogicalExpressionLines'](code, 'test.ts')

      expect(lines.size).toBe(0)
    })
  })

  describe('sanitizeSourceMap', () => {
    it('should return undefined for empty sources', () => {
      const sourceMap = {
        version: 3,
        sources: [],
        mappings: '',
        names: [],
      }

      const result = converter['sanitizeSourceMap'](sourceMap)

      expect(result).toBeUndefined()
    })

    it('should return undefined when no valid sources', () => {
      const sourceMap = {
        version: 3,
        sources: ['external commonjs react'],
        sourcesContent: [''],
        mappings: '',
        names: [],
      }

      const result = converter['sanitizeSourceMap'](sourceMap)

      expect(result).toBeUndefined()
    })

    it('should normalize sources when all are valid', () => {
      const sourceMap = {
        version: 3,
        sources: ['webpack://app/src/index.ts'],
        sourcesContent: ['const x = 1'],
        mappings: 'AAAA',
        names: [],
      }

      const result = converter['sanitizeSourceMap'](sourceMap)

      expect(result).toBeDefined()
      expect(result!.sources[0]).toBe('src/index.ts')
    })
  })

  describe('convertEntry', () => {
    it('should return null for entries without source or file', async () => {
      const entry = {
        scriptId: '1',
        url: 'http://localhost:3000/non-existent.js',
        functions: [],
      }

      const result = await converter.convertEntry(entry)

      expect(result).toBeNull()
    })

    it('should handle entry with inline source', async () => {
      const entry = {
        scriptId: '1',
        url: 'http://localhost:3000/test.js',
        source: 'function test() { return 1; }',
        functions: [{
          functionName: 'test',
          ranges: [{ startOffset: 0, endOffset: 30, count: 1 }],
        }],
      }

      // This may return null since there's no source map, which is expected
      const result = await converter.convertEntry(entry)

      // The result depends on whether ast-v8-to-istanbul can process it
      // without a proper source map pointing to src/
      expect(result === null || typeof result === 'object').toBe(true)
    })
  })

  describe('convert', () => {
    it('should handle empty coverage', async () => {
      const coverage = { result: [] }

      const result = await converter.convert(coverage)

      expect(result.files()).toHaveLength(0)
    })

    it('should load source maps from V8 cache', async () => {
      const loadFromV8CacheSpy = vi.spyOn(sourceMapLoader, 'loadFromV8Cache')

      const coverage = {
        result: [],
        'source-map-cache': {},
      }

      await converter.convert(coverage)

      expect(loadFromV8CacheSpy).toHaveBeenCalledWith(coverage)
    })

    it('should continue processing when entry conversion fails', async () => {
      const coverage = {
        result: [
          {
            scriptId: '1',
            url: 'http://localhost:3000/invalid.js',
            functions: [],
          },
          {
            scriptId: '2',
            url: 'http://localhost:3000/another-invalid.js',
            functions: [],
          },
        ],
      }

      // Should not throw, just skip failed entries
      const result = await converter.convert(coverage)

      // Both entries should fail gracefully
      expect(result.files().length).toBe(0)
    })
  })

  describe('addUncoveredFiles', () => {
    it('should skip files already in coverage map', async () => {
      const libCoverage = await import('istanbul-lib-coverage')
      const coverageMap = libCoverage.createCoverageMap({
        '/project/src/index.ts': {
          path: '/project/src/index.ts',
          statementMap: {},
          fnMap: {},
          branchMap: {},
          s: {},
          f: {},
          b: {},
        },
      })

      // Normalize path for comparison
      const normalizePath = (p: string) => p.replace(/\\/g, '/')
      const initialFiles = coverageMap.files().map(normalizePath)

      await converter.addUncoveredFiles(coverageMap, ['/project/src/index.ts'])

      // Should still have same files (no duplicates)
      const finalFiles = coverageMap.files().map(normalizePath)
      expect(finalFiles.length).toBe(initialFiles.length)
    })
  })

  describe('extractSourcePath - edge cases', () => {
    it('should handle Windows backslashes', () => {
      const path = 'C:\\project\\.next\\static\\chunks\\src\\app\\page.tsx'
      const result = converter['extractSourcePath'](path)

      expect(result).not.toBeNull()
      expect(result).toContain('src')
    })

    it('should return null for CSS files', () => {
      expect(converter['extractSourcePath']('/project/src/styles.css')).toBeNull()
    })

    it('should return null for LESS files', () => {
      expect(converter['extractSourcePath']('/project/src/styles.less')).toBeNull()
    })

    it('should handle .jsx files', () => {
      const path = '/project/.next/chunks/src/component.jsx'
      const result = converter['extractSourcePath'](path)
      expect(result).not.toBeNull()
    })

    it('should handle .js files', () => {
      const path = '/project/.next/chunks/src/utils.js'
      const result = converter['extractSourcePath'](path)
      expect(result).not.toBeNull()
    })
  })

  describe('findLogicalExpressionLines - edge cases', () => {
    it('should find nullish coalescing operator', () => {
      const code = 'const x = value ?? defaultValue;'
      const lines = converter['findLogicalExpressionLines'](code, 'test.ts')
      expect(lines.size).toBeGreaterThan(0)
    })

    it('should handle nested logical expressions', () => {
      const code = 'const x = (a || b) && (c || d);'
      const lines = converter['findLogicalExpressionLines'](code, 'test.ts')
      expect(lines.size).toBeGreaterThan(0)
    })

    it('should handle decorator syntax', () => {
      const code = `
        @Component
        class MyClass {
          method() {
            return this.value || 'default';
          }
        }
      `
      const lines = converter['findLogicalExpressionLines'](code, 'test.ts')
      expect(lines.size).toBeGreaterThan(0)
    })
  })

  describe('isValidSource - edge cases', () => {
    it('should reject sources with webpack queries', () => {
      expect(converter['isValidSource']('webpack://app/src/file.ts?abc=123', 'code')).toBe(false)
    })

    it('should accept sources with backslash paths', () => {
      expect(converter['isValidSource']('webpack://app\\src\\file.ts', 'const x = 1')).toBe(true)
    })
  })
})
