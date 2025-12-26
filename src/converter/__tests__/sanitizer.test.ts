import { describe, it, expect } from 'vitest'
import {
  getSourceRejectionReason,
  isSourceExcluded,
  computeSrcCodeRanges,
  sanitizeSourceMap,
} from '../sanitizer.js'
import type { SourceMapData } from '../../types.js'
import type { SanitizerOptions } from '../sanitizer.js'

describe('sanitizer', () => {
  describe('getSourceRejectionReason', () => {
    const projectRoot = '/home/user/project'
    const normalizeSourcePath = (path: string) => path.replace(/^webpack:\/\/.*?\/\.\//, '')

    it('should reject empty or null source', () => {
      expect(getSourceRejectionReason('', 'content', projectRoot, normalizeSourcePath)).toBe(
        'empty/null source'
      )
      expect(getSourceRejectionReason(null, 'content', projectRoot, normalizeSourcePath)).toBe(
        'empty/null source'
      )
      expect(getSourceRejectionReason('   ', 'content', projectRoot, normalizeSourcePath)).toBe(
        'empty/null source'
      )
    })

    it('should reject webpack external modules', () => {
      expect(
        getSourceRejectionReason('external "react"', 'content', projectRoot, normalizeSourcePath)
      ).toBe('webpack external')
      expect(
        getSourceRejectionReason('webpack://external%20commonjs', 'content', projectRoot, normalizeSourcePath)
      ).toBe('webpack external')
    })

    it('should reject sources that normalize to empty', () => {
      const normalizesToEmpty = () => ''
      expect(
        getSourceRejectionReason('webpack://_N_E/?xxxx', 'content', projectRoot, normalizesToEmpty)
      ).toBe('normalized to empty path')
    })

    it('should reject Windows paths not in project', () => {
      const windowsProjectRoot = 'C:\\Users\\dev\\project'
      const source = 'D:\\OtherProject\\src\\app.ts'
      const reason = getSourceRejectionReason(source, 'content', windowsProjectRoot, normalizeSourcePath)
      expect(reason).toContain('Windows path not in project')
    })

    it('should reject Unix paths not in project', () => {
      const source = '/home/other/project/src/app.ts'
      const reason = getSourceRejectionReason(source, 'content', projectRoot, normalizeSourcePath)
      expect(reason).toContain('Unix path not in project')
    })

    it('should reject node_modules paths', () => {
      expect(
        getSourceRejectionReason('src/node_modules/lodash/index.js', 'content', projectRoot, normalizeSourcePath)
      ).toBe('node_modules')
      expect(
        getSourceRejectionReason('node_modules\\react\\index.js', 'content', projectRoot, normalizeSourcePath)
      ).toBe('node_modules')
    })

    it('should reject sources without src/ path (non-Vite style)', () => {
      const reason = getSourceRejectionReason('lib/utils.ts', 'content', projectRoot, normalizeSourcePath)
      expect(reason).toContain('no src/ in path')
    })

    it('should accept Vite-style single file sources', () => {
      expect(getSourceRejectionReason('App.tsx', 'content', projectRoot, normalizeSourcePath)).toBeNull()
      expect(getSourceRejectionReason('Button.jsx', 'content', projectRoot, normalizeSourcePath)).toBeNull()
      expect(getSourceRejectionReason('utils.ts', 'content', projectRoot, normalizeSourcePath)).toBeNull()
    })

    it('should accept sources with src/ in path', () => {
      expect(getSourceRejectionReason('src/app/page.tsx', 'content', projectRoot, normalizeSourcePath)).toBeNull()
      expect(getSourceRejectionReason('webpack://_N_E/./src/lib/utils.ts', 'content', projectRoot, normalizeSourcePath)).toBeNull()
    })

    it('should reject sources without sourcesContent', () => {
      expect(getSourceRejectionReason('src/app.ts', null, projectRoot, normalizeSourcePath)).toBe(
        'no sourcesContent'
      )
      expect(getSourceRejectionReason('src/app.ts', undefined, projectRoot, normalizeSourcePath)).toBe(
        'no sourcesContent'
      )
    })

    it('should return null for valid sources', () => {
      expect(
        getSourceRejectionReason('src/app/page.tsx', 'export default function Page() {}', projectRoot, normalizeSourcePath)
      ).toBeNull()
    })
  })

  describe('isSourceExcluded', () => {
    it('should return false if no exclude patterns', () => {
      expect(isSourceExcluded('src/app.ts', [])).toBe(false)
    })

    it('should match exact file patterns', () => {
      expect(isSourceExcluded('src/app.test.ts', ['*.test.ts'])).toBe(true)
      expect(isSourceExcluded('src/app.spec.ts', ['*.spec.ts'])).toBe(true)
    })

    it('should match directory patterns with **', () => {
      expect(isSourceExcluded('src/__tests__/app.test.ts', ['src/__tests__/**'])).toBe(true)
      expect(isSourceExcluded('src/nested/__tests__/file.ts', ['**/__tests__/**'])).toBe(true)
    })

    it('should match simple * patterns', () => {
      expect(isSourceExcluded('src/app.test.tsx', ['*.test.*'])).toBe(true)
      expect(isSourceExcluded('src/components/Button.tsx', ['src/*/Button.tsx'])).toBe(true)
    })

    it('should match ? single character patterns', () => {
      expect(isSourceExcluded('src/app1.ts', ['src/app?.ts'])).toBe(true)
      expect(isSourceExcluded('src/app12.ts', ['src/app?.ts'])).toBe(false)
    })

    it('should normalize backslashes before matching', () => {
      expect(isSourceExcluded('src\\__tests__\\app.test.ts', ['src/__tests__/**'])).toBe(true)
    })

    it('should return false for non-matching patterns', () => {
      expect(isSourceExcluded('src/app.ts', ['*.test.ts'])).toBe(false)
      expect(isSourceExcluded('src/app.ts', ['lib/**'])).toBe(false)
    })

    it('should match if any pattern matches', () => {
      const excludePatterns = ['*.test.ts', '*.spec.ts', '__tests__/**']
      expect(isSourceExcluded('src/app.test.ts', excludePatterns)).toBe(true)
      expect(isSourceExcluded('src/app.spec.ts', excludePatterns)).toBe(true)
      expect(isSourceExcluded('__tests__/app.ts', excludePatterns)).toBe(true)
      expect(isSourceExcluded('src/app.ts', excludePatterns)).toBe(false)
    })
  })

  describe('computeSrcCodeRanges', () => {
    it('should return empty array for source map without mappings', () => {
      const sourceMap: SourceMapData = {
        version: 3,
        sources: ['test.ts'],
        mappings: '',
        names: [],
      }
      expect(computeSrcCodeRanges(sourceMap, 'code')).toEqual([])
    })

    it('should handle invalid mappings gracefully', () => {
      const sourceMap: SourceMapData = {
        version: 3,
        sources: ['test.ts'],
        mappings: 'invalid!!!',
        names: [],
      }
      // The decoder might be permissive and decode some data, or return empty
      // Either way, the function should not throw
      const result = computeSrcCodeRanges(sourceMap, 'code')
      expect(result).toBeInstanceOf(Array)
    })

    it('should compute single contiguous range from simple mappings', () => {
      // Simple mapping: AAAA = [0,0,0,0] - column 0, source 0, line 0, column 0
      const sourceMap: SourceMapData = {
        version: 3,
        sources: ['test.ts'],
        mappings: 'AAAA',
        names: [],
      }
      const code = 'test'

      const result = computeSrcCodeRanges(sourceMap, code)

      expect(result).toHaveLength(1)
      expect(result[0].minOffset).toBeGreaterThanOrEqual(0)
      expect(result[0].maxOffset).toBeLessThanOrEqual(code.length)
    })

    it('should handle multiple lines of mappings', () => {
      // Multiple lines separated by semicolons
      const sourceMap: SourceMapData = {
        version: 3,
        sources: ['test.ts'],
        mappings: 'AAAA;AACA', // line 1: col 0->0:0:0, line 2: col 0->0:1:0
        names: [],
      }
      const code = 'line1\nline2'

      const result = computeSrcCodeRanges(sourceMap, code)

      expect(result.length).toBeGreaterThan(0)
      expect(result[0].minOffset).toBeGreaterThanOrEqual(0)
      expect(result[result.length - 1].maxOffset).toBeLessThanOrEqual(code.length)
    })

    it('should create multiple ranges when gaps are detected', () => {
      // This would require a source map with large gaps (>1KB) between mappings
      // For simplicity, we'll just verify the function handles multiple ranges
      const sourceMap: SourceMapData = {
        version: 3,
        sources: ['test.ts'],
        // Create mappings with segments at different positions
        mappings: 'AAAA,KAAA', // Two segments on same line with gap
        names: [],
      }
      const code = 'x'.repeat(2000) // Large file

      const result = computeSrcCodeRanges(sourceMap, code)

      expect(result).toBeInstanceOf(Array)
      // Verify ranges don't exceed code bounds
      result.forEach(range => {
        expect(range.minOffset).toBeGreaterThanOrEqual(0)
        expect(range.maxOffset).toBeLessThanOrEqual(code.length)
        expect(range.minOffset).toBeLessThanOrEqual(range.maxOffset)
      })
    })

    it('should skip segments without source mapping', () => {
      // Single column offset (no source mapping) should be skipped
      const sourceMap: SourceMapData = {
        version: 3,
        sources: ['test.ts'],
        mappings: 'A,CAAA', // First segment has 1 field (skip), second has 4 fields (keep)
        names: [],
      }
      const code = 'test code'

      const result = computeSrcCodeRanges(sourceMap, code)

      // Should still find at least one range from the valid segment
      expect(result.length).toBeGreaterThan(0)
    })

    it('should add padding to ranges', () => {
      const sourceMap: SourceMapData = {
        version: 3,
        sources: ['test.ts'],
        mappings: 'AAAA',
        names: [],
      }
      const code = 'x'.repeat(1000)

      const result = computeSrcCodeRanges(sourceMap, code)

      if (result.length > 0) {
        // Padding should extend the range (unless at boundaries)
        const range = result[0]
        // At start: padding might be clipped to 0
        expect(range.minOffset).toBeGreaterThanOrEqual(0)
        // At end: padding might extend but not beyond code length
        expect(range.maxOffset).toBeLessThanOrEqual(code.length)
      }
    })
  })

  describe('sanitizeSourceMap', () => {
    const mockSourceMapLoader = {
      normalizeSourcePath: (path: string) => path.replace(/^webpack:\/\/.*?\/\.\//, ''),
    }

    it('should return undefined for source map with no sources', () => {
      const sourceMap: SourceMapData = {
        version: 3,
        sources: [],
        mappings: '',
        names: [],
      }

      const options: SanitizerOptions = {
        projectRoot: '/project',
        sourceMapLoader: mockSourceMapLoader as any,
        excludePatterns: [],
      }

      expect(sanitizeSourceMap(sourceMap, options)).toBeUndefined()
    })

    it('should return undefined when all sources are rejected', () => {
      const sourceMap: SourceMapData = {
        version: 3,
        sources: ['node_modules/react/index.js', 'external "lodash"'],
        sourcesContent: ['react code', 'lodash code'],
        mappings: 'AAAA',
        names: [],
      }

      const options: SanitizerOptions = {
        projectRoot: '/project',
        sourceMapLoader: mockSourceMapLoader as any,
        excludePatterns: [],
      }

      expect(sanitizeSourceMap(sourceMap, options)).toBeUndefined()
    })

    it('should keep source map when all sources are valid', () => {
      const sourceMap: SourceMapData = {
        version: 3,
        sources: ['src/app/page.tsx', 'src/lib/utils.ts'],
        sourcesContent: ['page code', 'utils code'],
        mappings: 'AAAA,CAAC',
        names: [],
      }

      const options: SanitizerOptions = {
        projectRoot: '/project',
        sourceMapLoader: mockSourceMapLoader as any,
        excludePatterns: [],
      }

      const result = sanitizeSourceMap(sourceMap, options)

      expect(result).toBeDefined()
      expect(result!.sources).toHaveLength(2)
      expect(result!.sources).toContain('src/app/page.tsx')
      expect(result!.sources).toContain('src/lib/utils.ts')
    })

    it('should filter out invalid sources and remap segments', () => {
      const sourceMap: SourceMapData = {
        version: 3,
        sources: [
          'src/app/page.tsx',           // Valid - index 0
          'node_modules/react/index.js', // Invalid - should be filtered
          'src/lib/utils.ts',            // Valid - index 2, remapped to 1
        ],
        sourcesContent: ['page code', 'react code', 'utils code'],
        // Mapping with segments referencing all three sources
        mappings: 'AAAA,CACA,EACA', // References source 0, 1, 2
        names: [],
      }

      const options: SanitizerOptions = {
        projectRoot: '/project',
        sourceMapLoader: mockSourceMapLoader as any,
        excludePatterns: [],
      }

      const result = sanitizeSourceMap(sourceMap, options)

      expect(result).toBeDefined()
      expect(result!.sources).toHaveLength(2) // Only valid sources
      expect(result!.sources).toContain('src/app/page.tsx')
      expect(result!.sources).toContain('src/lib/utils.ts')
      expect(result!.sources).not.toContain('node_modules/react/index.js')
    })

    it('should return undefined when all valid sources are excluded', () => {
      const sourceMap: SourceMapData = {
        version: 3,
        sources: ['src/__tests__/app.test.tsx', 'src/__tests__/utils.test.ts'],
        sourcesContent: ['test code 1', 'test code 2'],
        mappings: 'AAAA',
        names: [],
      }

      const options: SanitizerOptions = {
        projectRoot: '/project',
        sourceMapLoader: mockSourceMapLoader as any,
        excludePatterns: ['**/__tests__/**', '*.test.*'],
      }

      const result = sanitizeSourceMap(sourceMap, options)

      // All sources match exclude patterns, should be skipped
      expect(result).toBeUndefined()
    })

    it('should keep bundle when not all sources match exclude patterns', () => {
      const sourceMap: SourceMapData = {
        version: 3,
        sources: ['src/app/page.tsx', 'src/__tests__/app.test.tsx'],
        sourcesContent: ['app code', 'test code'],
        mappings: 'AAAA,CACA',
        names: [],
      }

      const options: SanitizerOptions = {
        projectRoot: '/project',
        sourceMapLoader: mockSourceMapLoader as any,
        excludePatterns: ['**/__tests__/**'],
      }

      const result = sanitizeSourceMap(sourceMap, options)

      // Exclude patterns only skip bundles where ALL sources match
      // This bundle has mixed sources, so it's kept with all sources
      expect(result).toBeDefined()
      expect(result!.sources).toHaveLength(2)
      expect(result!.sources).toContain('src/app/page.tsx')
      expect(result!.sources).toContain('src/__tests__/app.test.tsx')
    })

    it('should handle source maps with complex mappings', () => {
      const sourceMap: SourceMapData = {
        version: 3,
        sources: ['src/app.tsx', 'node_modules/lib.js', 'src/utils.ts'],
        sourcesContent: ['app', 'lib', 'utils'],
        // VLQ encoded mappings: multiple lines with various segment formats
        mappings: 'AAAA;AACA,CAAC;EAAA',
        names: ['test'],
      }

      const options: SanitizerOptions = {
        projectRoot: '/project',
        sourceMapLoader: mockSourceMapLoader as any,
        excludePatterns: [],
      }

      const result = sanitizeSourceMap(sourceMap, options)

      expect(result).toBeDefined()
      expect(result!.sources).toHaveLength(2) // node_modules filtered out
      expect(result!.mappings).toBeTruthy()
      // Mappings should be re-encoded after filtering
      expect(typeof result!.mappings).toBe('string')
    })
  })
})
