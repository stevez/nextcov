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

  // For each file, find the richest structure (most statements) to use as the
  // rebase skeleton. More statements = finer AST granularity = better skeleton.
  //
  // Note: isBabelQuality (end.column !== null) was previously used here to prefer
  // esbuild/Vitest maps over Turbopack maps, but esbuild produces end.column: Infinity
  // which JSON.stringify serializes to null — indistinguishable from Turbopack's null
  // after a coverage-final.json round-trip. So statement count is the only reliable
  // signal. When E2E coverage has been pre-rebased via rebaseOntoSourceStructure, both
  // unit and E2E maps already share esbuild structure, so counts are similar and
  // "most statements wins" produces correct results.
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
        const expectedLen = (branch as unknown as { locations: unknown[] }).locations?.length ?? 2
        const exact = lookups.branches.get(locationKey(branch.loc))
        if (exact !== undefined) {
          rebased_b[key] = exact.length === expectedLen
            ? exact
            : Array.from({ length: expectedLen }, (_, i) => exact[i] ?? 0)
        } else {
          const byLine = lookups.branchesByLine.get(lineKey(branch.loc))
          rebased_b[key] = byLine
            ? Array.from({ length: expectedLen }, (_, i) => byLine[i] ?? 0)
            : new Array(expectedLen).fill(0)
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
 * Rebase `source` coverage hits onto `structure`'s statement/fn/branch maps.
 *
 * Unlike rebaseCoarserMaps, the structure map is ALWAYS authoritative —
 * its statementMap/fnMap/branchMap is used regardless of statement counts or
 * quality tier. Use this when the caller knows which map is the correct
 * skeleton (e.g. the esbuild zero-map in rebaseOntoSourceStructure).
 *
 * Files only in `source` (not in `structure`) are excluded — they fall
 * outside the known source structure (include patterns).
 *
 * @param structure - Authoritative coverage map (esbuild zero-map)
 * @param source    - Coverage to rebase hits from (E2E / Turbopack)
 */
export function rebaseOntoMap(structure: CoverageMap, source: CoverageMap): CoverageMap {
  const newMapData: Record<string, FileCoverageData> = {}
  const sourceFiles = new Set(source.files())

  for (const file of structure.files()) {
    const structureData = structure.fileCoverageFor(file).toJSON() as FileCoverageData

    if (!sourceFiles.has(file)) {
      // File not hit by E2E — keep zero counts from structure
      newMapData[file] = structureData
      continue
    }

    const sourceData = source.fileCoverageFor(file).toJSON() as FileCoverageData
    const lookups = buildLookups(sourceData)

    const rebased_s: Record<string, number> = {}
    for (const [key, loc] of Object.entries(structureData.statementMap || {}) as [string, Location][]) {
      const exact = lookups.stmts.get(locationKey(loc))
      rebased_s[key] = exact !== undefined ? exact : (lookups.stmtsByLine.get(lineKey(loc)) ?? 0)
    }

    const rebased_f: Record<string, number> = {}
    for (const [key, fn] of Object.entries(structureData.fnMap || {}) as [string, FnEntry][]) {
      const exact = lookups.fns.get(locationKey(fn.loc))
      rebased_f[key] = exact !== undefined ? exact : (lookups.fnsByLine.get(lineKey(fn.loc)) ?? 0)
    }

    const rebased_b: Record<string, number[]> = {}
    for (const [key, branch] of Object.entries(structureData.branchMap || {}) as [string, BranchEntry][]) {
      const expectedLen = (branch as unknown as { locations: unknown[] }).locations?.length ?? 2
      const exact = lookups.branches.get(locationKey(branch.loc))
      if (exact !== undefined) {
        // Exact match: truncate/pad to the zero-map arm count so Turbopack
        // branches with different arm counts don't inflate the denominator.
        rebased_b[key] = exact.length === expectedLen
          ? exact
          : Array.from({ length: expectedLen }, (_, i) => exact[i] ?? 0)
      } else {
        const byLine = lookups.branchesByLine.get(lineKey(branch.loc))
        // byLine comes from E2E source and may have more or fewer arms than the
        // zero map branch. Always normalise to the zero map's expected arm count.
        rebased_b[key] = byLine
          ? Array.from({ length: expectedLen }, (_, i) => byLine[i] ?? 0)
          : new Array(expectedLen).fill(0)
      }
    }

    newMapData[file] = {
      ...structureData,
      s: rebased_s,
      f: rebased_f,
      b: rebased_b,
    }
  }

  return libCoverage.createCoverageMap(newMapData as unknown as Parameters<typeof libCoverage.createCoverageMap>[0])
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
