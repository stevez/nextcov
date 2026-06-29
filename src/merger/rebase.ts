/**
 * Coverage Structure Rebasing
 *
 * When merging Vitest (unit/component) coverage with E2E (Playwright/Next.js)
 * coverage, the two sets may have different Istanbul structures for the same
 * source file. This happens because:
 *
 *   - Vitest uses Vite/esbuild, which preserves full source AST granularity
 *   - Next.js 16+ Turbopack production builds scope-hoist and minify, collapsing
 *     multiple AST nodes into single compiled nodes. V8 coverage only sees one
 *     byte-offset range per compiled node, so `ast-v8-to-istanbul` produces
 *     fewer Istanbul statements for the same source file.
 *
 * Result: Turbopack E2E coverage appears inflated (e.g. 55%) because its
 * denominator is smaller (1315 statements) vs the source-accurate count (1771).
 *
 * Fix: Before merging, rebase every coverage map whose per-file statement count
 * is lower than the richest available map for that file. "Rebase" means:
 *   1. Take the richest map's statementMap/fnMap/branchMap as the structure
 *   2. Look up hit counts from the coarser map by line:col (exact) or line (fallback)
 *   3. Overwrite the coarser map's entries with the rebased data
 *
 * This is a no-op for webpack/Next.js 14-15 projects where all inputs already
 * share the same Vite/esbuild structure.
 */

import libCoverage from 'istanbul-lib-coverage'
import type { CoverageMap, FileCoverageData } from 'istanbul-lib-coverage'
import { locationKey, lineKey, buildLookups } from './utils.js'
import type { Location, FnEntry, BranchEntry } from './utils.js'

/**
 * Rebase coarser-structured coverage maps onto the richest available structure.
 *
 * For each file present in multiple maps, the map with the most statements is
 * used as the structure skeleton. All other maps for that file are rebased: their
 * hit counts are remapped by line:col position onto the richer skeleton.
 *
 * Maps that only contain files not present in any other map are returned unchanged.
 *
 * @param maps - Array of CoverageMap instances (unit, component, e2e, ...)
 * @returns New array of CoverageMap instances with rebased structures
 */
export function rebaseCoarserMaps(maps: CoverageMap[]): CoverageMap[] {
  if (maps.length < 2) return maps

  // Collect all file paths across all maps
  const allFiles = new Set<string>()
  for (const map of maps) {
    for (const file of map.files()) {
      allFiles.add(file)
    }
  }

  // For each file, find the richest structure (most statements)
  const richestByFile = new Map<string, { stmtCount: number; mapIdx: number; data: FileCoverageData }>()

  for (let i = 0; i < maps.length; i++) {
    for (const file of maps[i].files()) {
      const data = maps[i].fileCoverageFor(file).toJSON() as FileCoverageData
      const stmtCount = Object.keys(data.statementMap || {}).length
      const current = richestByFile.get(file)
      if (!current || stmtCount > current.stmtCount) {
        richestByFile.set(file, { stmtCount, mapIdx: i, data })
      }
    }
  }

  // Rebase each map: for files where a richer structure exists in another map,
  // remap this map's hit counts onto the richer skeleton
  return maps.map((map, mapIdx) => {
    const newMapData: Record<string, FileCoverageData> = {}
    let rebased = 0

    for (const file of map.files()) {
      const richest = richestByFile.get(file)!
      const thisData = map.fileCoverageFor(file).toJSON() as FileCoverageData
      const thisStmtCount = Object.keys(thisData.statementMap || {}).length

      // If this map already has the richest structure for this file, keep as-is
      if (richest.mapIdx === mapIdx || thisStmtCount >= richest.stmtCount) {
        newMapData[file] = thisData
        continue
      }

      // Build position→hits lookups from this map's (coarser) data
      const lookups = buildLookups(thisData)

      // Build a new coverage entry using the richest statementMap/fnMap/branchMap
      // but with hit counts resolved from this map's positions
      const rebased_s: Record<string, number> = {}
      for (const [key, loc] of Object.entries(richest.data.statementMap || {}) as [string, Location][]) {
        const exact = lookups.stmts.get(locationKey(loc))
        if (exact !== undefined) {
          rebased_s[key] = exact
        } else {
          rebased_s[key] = lookups.stmtsByLine.get(lineKey(loc)) ?? 0
        }
      }

      const rebased_f: Record<string, number> = {}
      for (const [key, fn] of Object.entries(richest.data.fnMap || {}) as [string, FnEntry][]) {
        const exact = lookups.fns.get(locationKey(fn.loc))
        if (exact !== undefined) {
          rebased_f[key] = exact
        } else {
          rebased_f[key] = lookups.fnsByLine.get(lineKey(fn.loc)) ?? 0
        }
      }

      const rebased_b: Record<string, number[]> = {}
      for (const [key, branch] of Object.entries(richest.data.branchMap || {}) as [string, BranchEntry][]) {
        const exact = lookups.branches.get(locationKey(branch.loc))
        if (exact !== undefined) {
          rebased_b[key] = exact
        } else {
          const byLine = lookups.branchesByLine.get(lineKey(branch.loc))
          rebased_b[key] = byLine ?? new Array((branch as unknown as { locations: unknown[] }).locations?.length ?? 2).fill(0)
        }
      }

      newMapData[file] = {
        ...thisData,
        statementMap: richest.data.statementMap,
        fnMap: richest.data.fnMap,
        branchMap: richest.data.branchMap,
        s: rebased_s,
        f: rebased_f,
        b: rebased_b,
      }
      rebased++
    }

    if (rebased === 0) return map

    return libCoverage.createCoverageMap(newMapData as unknown as Parameters<typeof libCoverage.createCoverageMap>[0])
  })
}

/**
 * Count how many files were rebased across all maps (for diagnostics).
 */
export function countRebasedFiles(original: CoverageMap[], rebased: CoverageMap[]): number {
  let count = 0
  for (let i = 0; i < original.length; i++) {
    for (const file of original[i].files()) {
      const origStmts = Object.keys(
        (original[i].fileCoverageFor(file).toJSON() as FileCoverageData).statementMap || {}
      ).length
      const newStmts = Object.keys(
        (rebased[i].fileCoverageFor(file).toJSON() as FileCoverageData).statementMap || {}
      ).length
      if (newStmts > origStmts) count++
    }
  }
  return count
}
