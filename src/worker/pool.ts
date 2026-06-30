/**
 * Worker Pool for parallel AST processing
 *
 * Manages a pool of worker threads for CPU-intensive astV8ToIstanbul operations.
 * Workers are reused across multiple tasks for efficiency.
 *
 * Set NEXTCOV_WORKERS=0 to disable worker threads and run in single-threaded mode.
 * This can be faster in environments with high worker thread overhead (e.g., some CI).
 */
import { Worker } from 'node:worker_threads'
import { cpus } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import type { WorkerInput } from './ast-worker.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Determine the number of workers to use.
 * - NEXTCOV_WORKERS env var overrides auto-detection (0 = single-threaded)
 * - Otherwise use half of CPUs, min 2, max 8
 */
function getWorkerCount(): number {
  const envWorkers = process.env.NEXTCOV_WORKERS
  if (envWorkers !== undefined) {
    const count = parseInt(envWorkers, 10)
    if (!isNaN(count) && count >= 0) {
      return count
    }
  }

  const coreCount = cpus().length
  return Math.min(8, Math.max(2, Math.floor(coreCount / 2)))
}


/**
 * Find the worker file path.
 * When running from dist/, __dirname is dist/ and ast-worker.js is there.
 * When running tests with vitest, __dirname is src/ but we need dist/ast-worker.js.
 * When bundled with tsup into dist/playwright/, need to check parent dir.
 */
function findWorkerPath(): string {
  // First try the same directory (works when running from dist/)
  const sameDirPath = join(__dirname, 'ast-worker.js')
  if (existsSync(sameDirPath)) {
    return sameDirPath
  }

  // Try worker directory in parent (for bundled code in dist/playwright/)
  const parentWorkerPath = join(__dirname, '..', 'worker', 'ast-worker.js')
  if (existsSync(parentWorkerPath)) {
    return parentWorkerPath
  }

  // Try dist/worker/ folder (for vitest running from src/)
  const distPath = join(__dirname, '..', 'dist', 'worker', 'ast-worker.js')
  if (existsSync(distPath)) {
    return distPath
  }

  // Fallback to same directory (will fail at runtime with clearer error)
  return sameDirPath
}

interface WorkerTask {
  code: string
  sourceMap: {
    sources: string[]
    sourcesContent: (string | null)[]
    mappings: string
    names?: string[]
    version?: number
    file?: string
    sourceRoot?: string
  } | null
  coverageUrl: string
  functions: Array<{
    functionName: string
    isBlockCoverage: boolean
    ranges: Array<{
      startOffset: number
      endOffset: number
      count: number
    }>
  }>
  srcCodeRange: { minOffset: number; maxOffset: number } | null
  srcCodeRanges?: Array<{ minOffset: number; maxOffset: number }>
}

interface WorkerResult {
  success: boolean
  coverage?: Record<string, unknown>
  error?: string
  timings?: {
    parse: number
    convert: number
    total: number
  }
  filterStats?: {
    original: number
    filtered: number
  }
}

interface QueuedTask {
  task: WorkerTask
  resolve: (result: WorkerResult) => void
  reject: (error: Error) => void
  retries: number
}

const MAX_TASK_RETRIES = 2

export class WorkerPool {
  private workers: Worker[] = []
  private availableWorkers: Worker[] = []
  private taskQueue: QueuedTask[] = []
  private activeTask: Map<Worker, QueuedTask> = new Map()
  private workerPath: string
  private maxWorkers: number
  private isTerminated = false
  private _isSingleThreaded: boolean

  constructor(maxWorkers?: number) {
    // Use getWorkerCount() for auto-detection, or explicit value if provided
    this.maxWorkers = maxWorkers ?? getWorkerCount()
    this._isSingleThreaded = this.maxWorkers === 0
    // Worker path is the compiled JS file (handles both dist/ and test environments)
    this.workerPath = findWorkerPath()
  }

  private createWorker(): Worker {
    // Strip --input-type from execArgv — it is only valid for stdin/eval input
    // and causes ERR_INPUT_TYPE_NOT_ALLOWED when worker threads inherit it from
    // a parent process started with `node --input-type=module`.
    const execArgv = process.execArgv.filter(
      (arg) => !arg.startsWith('--input-type')
    )
    const worker = new Worker(this.workerPath, { execArgv })

    worker.on('error', (err) => {
      console.error('[WorkerPool] Worker error:', err)
      // Remove failed worker from pool
      const idx = this.workers.indexOf(worker)
      if (idx !== -1) {
        this.workers.splice(idx, 1)
      }
      const availIdx = this.availableWorkers.indexOf(worker)
      if (availIdx !== -1) {
        this.availableWorkers.splice(availIdx, 1)
      }
    })

    worker.on('exit', (code) => {
      if (code !== 0 && !this.isTerminated) {
        console.error(`[WorkerPool] Worker exited with code ${code}`)
      }
      // Remove exited worker from pool
      const idx = this.workers.indexOf(worker)
      if (idx !== -1) {
        this.workers.splice(idx, 1)
      }
      const availIdx = this.availableWorkers.indexOf(worker)
      if (availIdx !== -1) {
        this.availableWorkers.splice(availIdx, 1)
      }
      // Reject the in-flight task for this worker (if any) so its promise
      // doesn't hang forever. Re-queue it so it gets retried on a new worker.
      const active = this.activeTask.get(worker)
      this.activeTask.delete(worker)
      if (active && !this.isTerminated) {
        if (active.retries < MAX_TASK_RETRIES) {
          // Re-queue with incremented retry count
          active.retries++
          this.taskQueue.unshift(active)
          this.processNextTask()
        } else {
          // Max retries exceeded — fall back to single-threaded execution
          console.warn('[WorkerPool] Worker repeatedly crashed, falling back to single-threaded mode for this task')
          this.runTaskDirect(active.task).then(active.resolve).catch(active.reject)
        }
      } else if (active) {
        active.reject(new Error(`Worker exited with code ${code ?? 'null'}`))
      }
    })

    this.workers.push(worker)
    return worker
  }

  private getWorker(): Worker | null {
    // Return an available worker or create a new one if under limit
    if (this.availableWorkers.length > 0) {
      return this.availableWorkers.pop()!
    }
    if (this.workers.length < this.maxWorkers) {
      return this.createWorker()
    }
    return null
  }

  private processNextTask(): void {
    if (this.taskQueue.length === 0) return

    const worker = this.getWorker()
    if (!worker) return

    const queued = this.taskQueue.shift()!
    const { task, resolve, reject } = queued
    this.activeTask.set(worker, queued)

    const handleMessage = (result: WorkerResult) => {
      worker.off('message', handleMessage)
      worker.off('error', handleError)
      this.activeTask.delete(worker)

      // Return worker to available pool
      if (!this.isTerminated) {
        this.availableWorkers.push(worker)
        // Process next task if any
        this.processNextTask()
      }

      resolve(result)
    }

    const handleError = (err: Error) => {
      worker.off('message', handleMessage)
      worker.off('error', handleError)
      this.activeTask.delete(worker)

      reject(err)
    }

    worker.on('message', handleMessage)
    worker.on('error', handleError)

    // Send task to worker
    worker.postMessage(task)
  }

  async runTask(task: WorkerTask): Promise<WorkerResult> {
    if (this.isTerminated) {
      throw new Error('WorkerPool has been terminated')
    }

    // Single-threaded mode: run directly in main thread
    if (this._isSingleThreaded) {
      return this.runTaskDirect(task)
    }

    return new Promise((resolve, reject) => {
      this.taskQueue.push({ task, resolve, reject, retries: 0 })
      this.processNextTask()
    })
  }

  /**
   * Run task directly in main thread (single-threaded mode).
   * Avoids worker thread overhead which can be significant in some environments.
   * Uses dynamic import to avoid ESM/CJS issues when module is loaded but not used.
   */
  private async runTaskDirect(task: WorkerTask): Promise<WorkerResult> {
    // Dynamic import to avoid loading ast-worker.ts at module load time
    const { processEntry } = await import('./ast-worker.js')
    const input: WorkerInput = {
      code: task.code,
      sourceMap: task.sourceMap,
      coverageUrl: task.coverageUrl,
      functions: task.functions,
      srcCodeRange: task.srcCodeRange,
      srcCodeRanges: task.srcCodeRanges,
    }
    return processEntry(input) as Promise<WorkerResult>
  }

  async terminate(): Promise<void> {
    this.isTerminated = true
    await Promise.all(
      this.workers.map((worker) => worker.terminate())
    )
    this.workers = []
    this.availableWorkers = []
    this.taskQueue = []
  }

  get poolSize(): number {
    return this.maxWorkers
  }

  get activeWorkers(): number {
    return this.workers.length - this.availableWorkers.length
  }

  get queuedTasks(): number {
    return this.taskQueue.length
  }

  /** Returns true if running in single-threaded mode (no worker threads) */
  get isSingleThreaded(): boolean {
    return this._isSingleThreaded
  }
}

// Singleton instance for reuse
let globalPool: WorkerPool | null = null

export function getWorkerPool(): WorkerPool {
  if (!globalPool) {
    globalPool = new WorkerPool()
  }
  return globalPool
}

export async function terminateWorkerPool(): Promise<void> {
  if (globalPool) {
    await globalPool.terminate()
    globalPool = null
  }
}
