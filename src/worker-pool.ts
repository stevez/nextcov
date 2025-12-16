/**
 * Worker Pool for parallel AST processing
 *
 * Manages a pool of worker threads for CPU-intensive astV8ToIstanbul operations.
 * Workers are reused across multiple tasks for efficiency.
 */
import { Worker } from 'node:worker_threads'
import { cpus } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Find the worker file path.
 * When running from dist/, __dirname is dist/ and ast-worker.js is there.
 * When running tests with vitest, __dirname is src/ but we need dist/ast-worker.js.
 */
function findWorkerPath(): string {
  // First try the same directory (works when running from dist/)
  const sameDirPath = join(__dirname, 'ast-worker.js')
  if (existsSync(sameDirPath)) {
    return sameDirPath
  }

  // Try dist/ folder (for vitest running from src/)
  const distPath = join(__dirname, '..', 'dist', 'ast-worker.js')
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
}

interface QueuedTask {
  task: WorkerTask
  resolve: (result: WorkerResult) => void
  reject: (error: Error) => void
}

export class WorkerPool {
  private workers: Worker[] = []
  private availableWorkers: Worker[] = []
  private taskQueue: QueuedTask[] = []
  private workerPath: string
  private maxWorkers: number
  private isTerminated = false

  constructor(maxWorkers?: number) {
    // Use half of available CPUs, minimum 2, maximum 8
    this.maxWorkers = maxWorkers ?? Math.min(8, Math.max(2, Math.floor(cpus().length / 2)))
    // Worker path is the compiled JS file (handles both dist/ and test environments)
    this.workerPath = findWorkerPath()
  }

  private createWorker(): Worker {
    const worker = new Worker(this.workerPath)

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

    const { task, resolve, reject } = this.taskQueue.shift()!

    const handleMessage = (result: WorkerResult) => {
      worker.off('message', handleMessage)
      worker.off('error', handleError)

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

    return new Promise((resolve, reject) => {
      this.taskQueue.push({ task, resolve, reject })
      this.processNextTask()
    })
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
