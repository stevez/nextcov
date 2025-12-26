import { describe, it, expect } from 'vitest'
import {
  normalizeUrlForMerge,
  mergeV8CoverageByUrl,
} from '../merge.js'
import type { V8ScriptCoverage } from '../../types.js'

describe('merge', () => {
  describe('normalizeUrlForMerge', () => {
    it('should strip query parameters from URL', () => {
      expect(normalizeUrlForMerge('http://localhost:3000/chunk.js?v=1765765839055')).toBe(
        'http://localhost:3000/chunk.js'
      )
    })

    it('should return URL unchanged if no query parameters', () => {
      expect(normalizeUrlForMerge('http://localhost:3000/chunk.js')).toBe(
        'http://localhost:3000/chunk.js'
      )
    })

    it('should handle multiple query parameters', () => {
      expect(normalizeUrlForMerge('http://localhost:3000/chunk.js?v=123&t=456')).toBe(
        'http://localhost:3000/chunk.js'
      )
    })

    it('should handle file:// URLs with query params', () => {
      expect(normalizeUrlForMerge('file:///C:/project/src/app.ts?v=789')).toBe(
        'file:///C:/project/src/app.ts'
      )
    })

    it('should handle webpack-internal URLs', () => {
      expect(normalizeUrlForMerge('webpack-internal:///(rsc)/./src/app.tsx?hash=abc')).toBe(
        'webpack-internal:///(rsc)/./src/app.tsx'
      )
    })
  })

  describe('mergeV8CoverageByUrl', () => {
    it('should merge entries with same URL by summing counts', () => {
      const entries: V8ScriptCoverage[] = [
        {
          scriptId: '1',
          url: 'http://localhost:3000/chunk.js',
          source: 'function a() {}',
          functions: [
            {
              functionName: 'a',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: 15, count: 1 }],
            },
          ],
        },
        {
          scriptId: '2',
          url: 'http://localhost:3000/chunk.js',
          source: 'function a() {}',
          functions: [
            {
              functionName: 'a',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: 15, count: 2 }],
            },
          ],
        },
      ]

      const result = mergeV8CoverageByUrl(entries)

      expect(result).toHaveLength(1)
      expect(result[0].url).toBe('http://localhost:3000/chunk.js')
      expect(result[0].functions[0].ranges[0].count).toBe(3) // 1 + 2 = 3
    })

    it('should normalize URLs before merging', () => {
      const entries: V8ScriptCoverage[] = [
        {
          scriptId: '1',
          url: 'http://localhost:3000/chunk.js?v=123',
          source: 'code',
          functions: [
            {
              functionName: 'test',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: 4, count: 1 }],
            },
          ],
        },
        {
          scriptId: '2',
          url: 'http://localhost:3000/chunk.js?v=456',
          source: 'code',
          functions: [
            {
              functionName: 'test',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: 4, count: 2 }],
            },
          ],
        },
      ]

      const result = mergeV8CoverageByUrl(entries)

      expect(result).toHaveLength(1)
      expect(result[0].url).toBe('http://localhost:3000/chunk.js') // Normalized URL
      expect(result[0].functions[0].ranges[0].count).toBe(3)
    })

    it('should handle multiple functions and ranges', () => {
      const entries: V8ScriptCoverage[] = [
        {
          scriptId: '1',
          url: 'test.js',
          source: 'code',
          functions: [
            {
              functionName: 'fn1',
              isBlockCoverage: true,
              ranges: [
                { startOffset: 0, endOffset: 10, count: 1 },
                { startOffset: 10, endOffset: 20, count: 2 },
              ],
            },
            {
              functionName: 'fn2',
              isBlockCoverage: true,
              ranges: [{ startOffset: 20, endOffset: 30, count: 3 }],
            },
          ],
        },
        {
          scriptId: '2',
          url: 'test.js',
          source: 'code',
          functions: [
            {
              functionName: 'fn1',
              isBlockCoverage: true,
              ranges: [
                { startOffset: 0, endOffset: 10, count: 4 },
                { startOffset: 10, endOffset: 20, count: 5 },
              ],
            },
            {
              functionName: 'fn2',
              isBlockCoverage: true,
              ranges: [{ startOffset: 20, endOffset: 30, count: 6 }],
            },
          ],
        },
      ]

      const result = mergeV8CoverageByUrl(entries)

      expect(result).toHaveLength(1)
      expect(result[0].functions).toHaveLength(2)
      expect(result[0].functions[0].ranges[0].count).toBe(5) // 1 + 4
      expect(result[0].functions[0].ranges[1].count).toBe(7) // 2 + 5
      expect(result[0].functions[1].ranges[0].count).toBe(9) // 3 + 6
    })

    it('should keep separate entries for different URLs', () => {
      const entries: V8ScriptCoverage[] = [
        {
          scriptId: '1',
          url: 'file1.js',
          source: 'code1',
          functions: [
            {
              functionName: 'fn',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: 5, count: 1 }],
            },
          ],
        },
        {
          scriptId: '2',
          url: 'file2.js',
          source: 'code2',
          functions: [
            {
              functionName: 'fn',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: 5, count: 2 }],
            },
          ],
        },
      ]

      const result = mergeV8CoverageByUrl(entries)

      expect(result).toHaveLength(2)
      expect(result.map(r => r.url)).toContain('file1.js')
      expect(result.map(r => r.url)).toContain('file2.js')
    })

    it('should return empty array for empty input', () => {
      const result = mergeV8CoverageByUrl([])
      expect(result).toEqual([])
    })

    it('should deep clone entries to avoid mutation', () => {
      const original: V8ScriptCoverage = {
        scriptId: '1',
        url: 'test.js',
        source: 'code',
        functions: [
          {
            functionName: 'fn',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: 5, count: 1 }],
          },
        ],
      }

      const result = mergeV8CoverageByUrl([original])

      // Modify the result
      result[0].functions[0].ranges[0].count = 999

      // Original should be unchanged
      expect(original.functions[0].ranges[0].count).toBe(1)
    })
  })
})
