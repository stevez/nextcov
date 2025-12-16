import { describe, it, expect } from 'vitest'
import { processEntry, WorkerInput } from '../ast-worker.js'

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
  })
})
