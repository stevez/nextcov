/**
 * Merger Utility Functions
 *
 * Helper functions for coverage merging operations
 */

import type { FileCoverageData } from 'istanbul-lib-coverage'
import type { MergerConfig } from '@/types.js'

// Default configuration
export const DEFAULT_MERGER_CONFIG: MergerConfig = {
  strategy: 'max',
  structurePreference: 'more-items',
  applyFixes: true,
}

// Types for coverage lookup operations
export type Location = { start: { line: number; column: number | null } }
export type FnEntry = { loc: Location }
export type BranchEntry = { loc: Location }

export interface CoverageLookups {
  stmts: Map<string, number>
  stmtsByLine: Map<number, number>
  fns: Map<string, number>
  fnsByLine: Map<number, number>
  branches: Map<string, number[]>
  branchesByLine: Map<number, number[]>
}

/**
 * Create a unique key for a location (exact match)
 */
export function locationKey(loc: Location): string {
  return `${loc.start.line}:${loc.start.column}`
}

/**
 * Get the line number from a location (for line-based fallback matching)
 */
export function lineKey(loc: Location): number {
  return loc.start.line
}

/**
 * Build lookup maps from file coverage data for efficient merging.
 * Creates maps keyed by exact location and by line number for fallback matching.
 */
export function buildLookups(data: FileCoverageData): CoverageLookups {
  const stmts = new Map<string, number>()
  const stmtsByLine = new Map<number, number>()
  for (const [key, loc] of Object.entries(data.statementMap || {}) as [string, Location][]) {
    const count = data.s[key] || 0
    if (count > 0) {
      stmts.set(locationKey(loc), count)
      const line = lineKey(loc)
      stmtsByLine.set(line, Math.max(stmtsByLine.get(line) || 0, count))
    }
  }

  const fns = new Map<string, number>()
  const fnsByLine = new Map<number, number>()
  for (const [key, fn] of Object.entries(data.fnMap || {}) as [string, FnEntry][]) {
    const count = data.f[key] || 0
    if (count > 0) {
      fns.set(locationKey(fn.loc), count)
      const line = lineKey(fn.loc)
      fnsByLine.set(line, Math.max(fnsByLine.get(line) || 0, count))
    }
  }

  const branches = new Map<string, number[]>()
  const branchesByLine = new Map<number, number[]>()
  for (const [key, branch] of Object.entries(data.branchMap || {}) as [string, BranchEntry][]) {
    const counts = data.b[key] || []
    if (counts.some((c: number) => c > 0)) {
      branches.set(locationKey(branch.loc), counts)
      const line = lineKey(branch.loc)
      if (!branchesByLine.has(line)) {
        branchesByLine.set(line, counts)
      }
    }
  }

  return { stmts, stmtsByLine, fns, fnsByLine, branches, branchesByLine }
}
