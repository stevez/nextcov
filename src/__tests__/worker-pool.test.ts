import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorkerPool, getWorkerPool, terminateWorkerPool } from '../worker/pool.js'

describe('worker-pool', () => {
  describe('WorkerPool', () => {
    describe('single-threaded mode (maxWorkers=0)', () => {
      let pool: WorkerPool

      beforeEach(() => {
        pool = new WorkerPool(0)
      })

      afterEach(async () => {
        await pool.terminate()
      })

      it('should be in single-threaded mode when maxWorkers is 0', () => {
        expect(pool.isSingleThreaded).toBe(true)
        expect(pool.poolSize).toBe(0)
      })

      it('should run tasks directly in main thread', async () => {
        const task = {
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
          srcCodeRanges: undefined,
        }

        const result = await pool.runTask(task)

        // Result should have timings regardless of success/failure
        expect(result.timings).toBeDefined()
        expect(typeof result.timings?.total).toBe('number')
      })

      it('should not create any workers', async () => {
        expect(pool.activeWorkers).toBe(0)

        // Run a task
        const task = {
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

        await pool.runTask(task)

        // Still no workers created
        expect(pool.activeWorkers).toBe(0)
      })

      it('should process multiple tasks sequentially', async () => {
        const tasks = Array.from({ length: 3 }, (_, i) => ({
          code: `const x${i} = ${i};`,
          sourceMap: null,
          coverageUrl: `file:///test${i}.js`,
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: 15, count: 1 }],
            },
          ],
          srcCodeRange: null,
        }))

        const results = await Promise.all(tasks.map(task => pool.runTask(task)))

        expect(results).toHaveLength(3)
        // All results should have timings, regardless of success
        results.forEach(result => {
          expect(result.timings).toBeDefined()
        })
      })

      it('should handle errors gracefully in single-threaded mode', async () => {
        const task = {
          code: '???invalid syntax!!!',
          sourceMap: null,
          coverageUrl: 'file:///test.js',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: 20, count: 1 }],
            },
          ],
          srcCodeRange: null,
        }

        const result = await pool.runTask(task)

        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()
      })
    })

    describe('multi-threaded mode', () => {
      let pool: WorkerPool

      beforeEach(() => {
        pool = new WorkerPool(2)
      })

      afterEach(async () => {
        await pool.terminate()
      })

      it('should not be in single-threaded mode when maxWorkers > 0', () => {
        expect(pool.isSingleThreaded).toBe(false)
        expect(pool.poolSize).toBe(2)
      })

      // Skip this test - it requires dist/ast-worker.js which doesn't exist during CI test runs
      // The worker functionality is tested via integration/E2E tests
      it.skip('should create workers when processing tasks', async () => {
        const task = {
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

        await pool.runTask(task)

        // Worker should be created but returned to available pool
        expect(pool.activeWorkers).toBe(0)
      })
    })

    describe('terminate', () => {
      it('should reject tasks after termination', async () => {
        const pool = new WorkerPool(0)
        await pool.terminate()

        const task = {
          code: 'const x = 1;',
          sourceMap: null,
          coverageUrl: 'file:///test.js',
          functions: [],
          srcCodeRange: null,
        }

        await expect(pool.runTask(task)).rejects.toThrow('WorkerPool has been terminated')
      })
    })
  })

  describe('getWorkerPool / terminateWorkerPool', () => {
    afterEach(async () => {
      await terminateWorkerPool()
    })

    it('should return a singleton pool', () => {
      const pool1 = getWorkerPool()
      const pool2 = getWorkerPool()

      expect(pool1).toBe(pool2)
    })

    it('should terminate the global pool', async () => {
      const pool = getWorkerPool()
      expect(pool).toBeDefined()

      await terminateWorkerPool()

      // Getting pool again should create a new instance
      const newPool = getWorkerPool()
      expect(newPool).not.toBe(pool)
    })
  })

  describe('NEXTCOV_WORKERS environment variable', () => {
    const originalEnv = process.env.NEXTCOV_WORKERS

    afterEach(async () => {
      if (originalEnv === undefined) {
        delete process.env.NEXTCOV_WORKERS
      } else {
        process.env.NEXTCOV_WORKERS = originalEnv
      }
      await terminateWorkerPool()
    })

    it('should use NEXTCOV_WORKERS=0 for single-threaded mode', async () => {
      process.env.NEXTCOV_WORKERS = '0'
      await terminateWorkerPool() // Reset global pool

      const pool = getWorkerPool()
      expect(pool.isSingleThreaded).toBe(true)
      expect(pool.poolSize).toBe(0)
    })

    it('should use NEXTCOV_WORKERS=4 for 4 workers', async () => {
      process.env.NEXTCOV_WORKERS = '4'
      await terminateWorkerPool() // Reset global pool

      const pool = getWorkerPool()
      expect(pool.isSingleThreaded).toBe(false)
      expect(pool.poolSize).toBe(4)
    })

    it('should ignore invalid NEXTCOV_WORKERS values', async () => {
      process.env.NEXTCOV_WORKERS = 'invalid'
      await terminateWorkerPool() // Reset global pool

      const pool = getWorkerPool()
      // Should fall back to auto-detection (min 2, max 8)
      expect(pool.poolSize).toBeGreaterThanOrEqual(2)
      expect(pool.poolSize).toBeLessThanOrEqual(8)
    })

    it('should ignore negative NEXTCOV_WORKERS values', async () => {
      process.env.NEXTCOV_WORKERS = '-1'
      await terminateWorkerPool() // Reset global pool

      const pool = getWorkerPool()
      // Should fall back to auto-detection
      expect(pool.poolSize).toBeGreaterThanOrEqual(2)
    })
  })
})
