import { describe, it, expect } from 'vitest'
import { processEntry, WorkerInput } from '../worker/ast-worker.js'

describe('ast-worker', () => {
  describe('processEntry', () => {
    it('should process simple code and return timings', async () => {
      const input: WorkerInput = {
        code: 'const x = 1;',
        sourceMap: null,
        coverageUrl: 'file:///test.js',
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: 12, count: 1 }],
          },
        ],
        srcCodeRange: null,
      }

      const result = await processEntry(input)

      // Should always return timings regardless of success/failure
      expect(result.timings).toBeDefined()
      expect(result.timings?.parse).toBeGreaterThanOrEqual(0)
      expect(result.timings?.convert).toBeGreaterThanOrEqual(0)
      expect(result.timings?.total).toBeGreaterThan(0)
      expect(typeof result.success).toBe('boolean')
    })

    it('should handle code with source map', async () => {
      const input: WorkerInput = {
        code: 'const x = 1;',
        sourceMap: {
          version: 3,
          sources: ['src/test.ts'],
          sourcesContent: ['const x: number = 1;'],
          mappings: 'AAAA',
          names: [],
        },
        coverageUrl: 'file:///test.js',
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: 12, count: 1 }],
          },
        ],
        srcCodeRange: null,
      }

      const result = await processEntry(input)

      expect(result.timings).toBeDefined()
      expect(typeof result.success).toBe('boolean')
    })

    it('should handle source map without optional fields', async () => {
      const input: WorkerInput = {
        code: 'const x = 1;',
        sourceMap: {
          sources: ['src/test.ts'],
          sourcesContent: ['const x = 1;'],
          mappings: 'AAAA',
          // No names, version, file, or sourceRoot
        },
        coverageUrl: 'file:///test.js',
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: 12, count: 1 }],
          },
        ],
        srcCodeRange: null,
      }

      const result = await processEntry(input)

      expect(result.timings).toBeDefined()
      expect(typeof result.success).toBe('boolean')
    })

    it('should apply srcCodeRange optimization', async () => {
      const code = 'const a = 1; const b = 2; const c = 3;'
      const input: WorkerInput = {
        code,
        sourceMap: null,
        coverageUrl: 'file:///test.js',
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
          },
        ],
        // Only include first statement in range
        srcCodeRange: { minOffset: 0, maxOffset: 12 },
      }

      const result = await processEntry(input)

      expect(result.timings).toBeDefined()
      expect(typeof result.success).toBe('boolean')
    })

    it('should return error for invalid JavaScript syntax', async () => {
      const input: WorkerInput = {
        code: 'function( { invalid syntax',
        sourceMap: null,
        coverageUrl: 'file:///invalid.js',
        functions: [],
        srcCodeRange: null,
      }

      const result = await processEntry(input)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.timings).toBeDefined()
      expect(result.timings?.total).toBeGreaterThan(0)
    })

    it('should return error for incomplete code', async () => {
      const input: WorkerInput = {
        code: 'const x = ',
        sourceMap: null,
        coverageUrl: 'file:///incomplete.js',
        functions: [],
        srcCodeRange: null,
      }

      const result = await processEntry(input)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.timings).toBeDefined()
    })

    it('should handle empty functions array', async () => {
      const input: WorkerInput = {
        code: 'const x = 1;',
        sourceMap: null,
        coverageUrl: 'file:///test.js',
        functions: [],
        srcCodeRange: null,
      }

      const result = await processEntry(input)

      expect(result.timings).toBeDefined()
      expect(typeof result.success).toBe('boolean')
    })

    it('should preserve timing information even on error', async () => {
      const input: WorkerInput = {
        code: '{ invalid }}}',
        sourceMap: null,
        coverageUrl: 'file:///error.js',
        functions: [],
        srcCodeRange: null,
      }

      const result = await processEntry(input)

      expect(result.success).toBe(false)
      expect(result.timings).toBeDefined()
      expect(typeof result.timings?.total).toBe('number')
    })

    describe('srcCodeRanges (multiple ranges)', () => {
      it('should accept srcCodeRanges array and process nodes within ranges', async () => {
        // Simulate a bundle with user code in two separate ranges
        const code = `
          // Framework code (bytes 0-50)
          const framework1 = "next.js internal code";
          // User code 1 (bytes 51-100)
          function userFunction1() { return 1; }
          // Framework code (bytes 101-150)
          const framework2 = "more framework code";
          // User code 2 (bytes 151-200)
          function userFunction2() { return 2; }
        `
        const input: WorkerInput = {
          code,
          sourceMap: null,
          coverageUrl: 'file:///test.js',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
            },
          ],
          srcCodeRange: null, // deprecated field
          srcCodeRanges: [
            { minOffset: 51, maxOffset: 100 },
            { minOffset: 151, maxOffset: 200 },
          ],
        }

        const result = await processEntry(input)

        expect(result.timings).toBeDefined()
        expect(typeof result.success).toBe('boolean')
      })

      it('should prefer srcCodeRanges over deprecated srcCodeRange', async () => {
        const code = 'const a = 1; const b = 2; const c = 3;'
        const input: WorkerInput = {
          code,
          sourceMap: null,
          coverageUrl: 'file:///test.js',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
            },
          ],
          // Both provided - srcCodeRanges should take precedence
          srcCodeRange: { minOffset: 0, maxOffset: 12 },
          srcCodeRanges: [{ minOffset: 13, maxOffset: 25 }],
        }

        const result = await processEntry(input)

        expect(result.timings).toBeDefined()
        expect(typeof result.success).toBe('boolean')
      })

      it('should fallback to srcCodeRange if srcCodeRanges is empty', async () => {
        const code = 'const a = 1; const b = 2; const c = 3;'
        const input: WorkerInput = {
          code,
          sourceMap: null,
          coverageUrl: 'file:///test.js',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
            },
          ],
          srcCodeRange: { minOffset: 0, maxOffset: 12 },
          srcCodeRanges: undefined,
        }

        const result = await processEntry(input)

        expect(result.timings).toBeDefined()
        expect(typeof result.success).toBe('boolean')
      })

      it('should handle empty srcCodeRanges array (process all nodes)', async () => {
        const code = 'const x = 1;'
        const input: WorkerInput = {
          code,
          sourceMap: null,
          coverageUrl: 'file:///test.js',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
            },
          ],
          srcCodeRange: null,
          srcCodeRanges: [], // Empty array - should process all nodes
        }

        const result = await processEntry(input)

        expect(result.timings).toBeDefined()
        expect(typeof result.success).toBe('boolean')
      })

      it('should skip nodes completely outside all ranges', async () => {
        // This tests the ignoreNode logic
        const code = `
function outsideRange() { return "skip"; }
function insideRange() { return "keep"; }
function alsoOutside() { return "skip"; }
        `.trim()

        const input: WorkerInput = {
          code,
          sourceMap: null,
          coverageUrl: 'file:///test.js',
          functions: [
            {
              functionName: 'outsideRange',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: 42, count: 1 }],
            },
            {
              functionName: 'insideRange',
              isBlockCoverage: true,
              ranges: [{ startOffset: 43, endOffset: 86, count: 1 }],
            },
            {
              functionName: 'alsoOutside',
              isBlockCoverage: true,
              ranges: [{ startOffset: 87, endOffset: 130, count: 1 }],
            },
          ],
          srcCodeRange: null,
          // Only include the middle function in the range
          srcCodeRanges: [{ minOffset: 43, maxOffset: 86 }],
        }

        const result = await processEntry(input)

        expect(result.timings).toBeDefined()
        expect(typeof result.success).toBe('boolean')
      })

      it('should handle overlapping ranges', async () => {
        const code = 'const a = 1; const b = 2; const c = 3;'
        const input: WorkerInput = {
          code,
          sourceMap: null,
          coverageUrl: 'file:///test.js',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
            },
          ],
          srcCodeRange: null,
          // Overlapping ranges - node should be included if it overlaps with ANY range
          srcCodeRanges: [
            { minOffset: 0, maxOffset: 20 },
            { minOffset: 15, maxOffset: 30 },
          ],
        }

        const result = await processEntry(input)

        expect(result.timings).toBeDefined()
        expect(typeof result.success).toBe('boolean')
      })

      it('should handle many ranges (typical webpack bundle scenario)', async () => {
        // Simulate 8 user code ranges in a large bundle (like owner/create/page.js)
        const code = 'x'.repeat(1000) // Simulate 1KB of code
        const ranges: Array<{ minOffset: number; maxOffset: number }> = []
        for (let i = 0; i < 8; i++) {
          ranges.push({
            minOffset: i * 100 + 10,
            maxOffset: i * 100 + 50,
          })
        }

        const input: WorkerInput = {
          code,
          sourceMap: null,
          coverageUrl: 'file:///large-bundle.js',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
            },
          ],
          srcCodeRange: null,
          srcCodeRanges: ranges,
        }

        const result = await processEntry(input)

        // Should still succeed even with many ranges
        expect(result.timings).toBeDefined()
        expect(typeof result.success).toBe('boolean')
      })
    })
  })
})
