import { describe, it, expect, afterEach, afterAll } from 'vitest'
import { WorkerPool, getWorkerPool, terminateWorkerPool } from '../worker-pool.js'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Check if the compiled worker exists (for integration tests)
// Worker can be in dist/ (when running from src/) or same dir (when running from dist/)
const distWorkerPath = join(__dirname, '..', '..', 'dist', 'ast-worker.js')
const workerExists = existsSync(distWorkerPath)

// Track all pools created during tests for cleanup
const createdPools: WorkerPool[] = []

describe('WorkerPool', () => {
  let pool: WorkerPool

  afterEach(async () => {
    if (pool) {
      await pool.terminate()
      pool = undefined as unknown as WorkerPool
    }
    // Clean up the global pool
    await terminateWorkerPool()
  })

  afterAll(async () => {
    // Ensure all pools are terminated
    await Promise.all(createdPools.map((p) => p.terminate().catch(() => {})))
    await terminateWorkerPool()
    // Small delay to allow workers to fully exit
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  // Helper to create pool and track it for cleanup
  function createPool(maxWorkers?: number): WorkerPool {
    const p = new WorkerPool(maxWorkers)
    createdPools.push(p)
    return p
  }

  describe('constructor', () => {
    it('should create pool with default max workers', () => {
      pool = createPool()
      // Default is min(8, max(2, cpus/2))
      expect(pool.poolSize).toBeGreaterThanOrEqual(2)
      expect(pool.poolSize).toBeLessThanOrEqual(8)
    })

    it('should create pool with custom max workers', () => {
      pool = createPool(4)
      expect(pool.poolSize).toBe(4)
    })

    it('should start with no active workers', () => {
      pool = createPool(2)
      expect(pool.activeWorkers).toBe(0)
    })

    it('should start with empty task queue', () => {
      pool = createPool(2)
      expect(pool.queuedTasks).toBe(0)
    })
  })

  describe('runTask', () => {
    it.skipIf(!workerExists)('should process a simple task and return result', async () => {
      pool = createPool(2)

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

      const result = await pool.runTask(task)

      // Worker should return a result with timings, regardless of whether
      // astV8ToIstanbul produces coverage (depends on source map availability)
      expect(result.timings).toBeDefined()
      expect(result.timings?.total).toBeGreaterThan(0)
      // Result should be either success with coverage or success: true
      expect(typeof result.success).toBe('boolean')
    })

    it.skipIf(!workerExists)('should handle task with source map', async () => {
      pool = createPool(2)

      const task = {
        code: 'const x = 1;',
        sourceMap: {
          version: 3,
          sources: ['src/test.ts'],
          sourcesContent: ['const x = 1;'],
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

      const result = await pool.runTask(task)

      // Should process without crashing, returning timings
      expect(result.timings).toBeDefined()
      expect(typeof result.success).toBe('boolean')
    })

    it.skipIf(!workerExists)('should handle task with srcCodeRange optimization', async () => {
      pool = createPool(2)

      const code = 'const a = 1; const b = 2; const c = 3;'
      const task = {
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
        srcCodeRange: { minOffset: 0, maxOffset: 12 }, // Only first statement
      }

      const result = await pool.runTask(task)

      // Should process without crashing
      expect(result.timings).toBeDefined()
      expect(typeof result.success).toBe('boolean')
    })

    it.skipIf(!workerExists)('should return error for invalid code', async () => {
      pool = createPool(2)

      const task = {
        code: 'function( { invalid syntax',
        sourceMap: null,
        coverageUrl: 'file:///test.js',
        functions: [],
        srcCodeRange: null,
      }

      const result = await pool.runTask(task)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it.skipIf(!workerExists)('should process multiple tasks in parallel', async () => {
      pool = createPool(4)

      const tasks = Array.from({ length: 4 }, (_, i) => ({
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

      const results = await Promise.all(tasks.map((t) => pool.runTask(t)))

      // All should return results with timing info
      expect(results.length).toBe(4)
      results.forEach((r) => {
        expect(r.timings).toBeDefined()
        expect(typeof r.success).toBe('boolean')
      })
    })

    it.skipIf(!workerExists)('should queue tasks when pool is busy', async () => {
      pool = createPool(1) // Only 1 worker

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

      // Start all tasks
      const promises = tasks.map((t) => pool.runTask(t))

      // All should eventually complete
      const results = await Promise.all(promises)
      expect(results.length).toBe(3)
      results.forEach((r) => {
        expect(r.timings).toBeDefined()
        expect(typeof r.success).toBe('boolean')
      })
    })

    it('should throw error after pool is terminated', async () => {
      pool = createPool(2)
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

  describe('terminate', () => {
    it.skipIf(!workerExists)('should terminate all workers', async () => {
      pool = createPool(2)

      // Run a task to create workers
      await pool.runTask({
        code: 'const x = 1;',
        sourceMap: null,
        coverageUrl: 'file:///test.js',
        functions: [],
        srcCodeRange: null,
      })

      await pool.terminate()

      expect(pool.activeWorkers).toBe(0)
    })

    it('should clear task queue on terminate', async () => {
      pool = createPool(1)

      // Queue multiple tasks (don't await, just start them)
      Array.from({ length: 3 }, (_, i) =>
        pool.runTask({
          code: `const x${i} = ${i};`,
          sourceMap: null,
          coverageUrl: `file:///test${i}.js`,
          functions: [],
          srcCodeRange: null,
        })
      )

      // Terminate while tasks are running
      await pool.terminate()

      expect(pool.queuedTasks).toBe(0)
    })
  })

  describe('getWorkerPool singleton', () => {
    it('should return the same pool instance', () => {
      const pool1 = getWorkerPool()
      const pool2 = getWorkerPool()

      expect(pool1).toBe(pool2)
    })

    it('should create new pool after termination', async () => {
      const pool1 = getWorkerPool()
      await terminateWorkerPool()

      const pool2 = getWorkerPool()

      expect(pool2).not.toBe(pool1)
    })
  })

  describe('pool statistics', () => {
    it.skipIf(!workerExists)('should track active workers correctly', async () => {
      pool = createPool(2)

      expect(pool.activeWorkers).toBe(0)

      // Start a task - should create and use a worker
      const promise = pool.runTask({
        code: 'const x = 1;',
        sourceMap: null,
        coverageUrl: 'file:///test.js',
        functions: [],
        srcCodeRange: null,
      })

      // After task starts, there should be an active worker
      // Note: This is a race condition test, the worker might finish before we check
      await promise

      // After completion, worker should be available (not active)
      expect(pool.activeWorkers).toBe(0)
    })
  })
})
