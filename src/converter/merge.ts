/**
 * V8 Coverage Merging
 *
 * Functions for merging V8 coverage entries from multiple test runs.
 * When the same chunk is visited by multiple tests, we merge execution counts.
 */

import type { V8ScriptCoverage } from '@/types.js'
import { log, createTimer } from '@/utils/logger.js'

/**
 * Normalize URL for merging by stripping query parameters.
 *
 * In dev mode, Next.js appends version timestamps like `?v=1765765839055`
 * to chunk URLs. These are the same file content, just different cache busters.
 * We strip these to merge coverage from the same underlying file.
 */
export function normalizeUrlForMerge(url: string): string {
  // Strip query parameters (e.g., ?v=1765765839055)
  const queryIndex = url.indexOf('?')
  return queryIndex === -1 ? url : url.substring(0, queryIndex)
}

/**
 * Merge V8 coverage entries by URL using SUM strategy.
 *
 * When the same chunk is visited by multiple tests, we SUM execution counts
 * to get total coverage across all tests. This matches how Vitest merges
 * coverage (though Vitest uses @bcoe/v8-coverage which we can't use due to
 * its normalization changing function structures).
 *
 * For coverage reporting (covered vs uncovered), SUM and MAX produce identical
 * results since both preserve non-zero counts. SUM gives more accurate execution
 * counts if you need them for profiling.
 *
 * URLs are normalized by stripping query parameters (e.g., ?v=xxxxx) so that
 * dev mode cache-busted URLs are merged correctly.
 *
 * This significantly reduces processing time by converting 400 entries → ~30 unique entries.
 */
export function mergeV8CoverageByUrl(entries: V8ScriptCoverage[]): V8ScriptCoverage[] {
  const endTimer = createTimer(`mergeV8CoverageByUrl (${entries.length} entries)`)
  const merged = new Map<string, V8ScriptCoverage>()

  for (const entry of entries) {
    const normalizedUrl = normalizeUrlForMerge(entry.url)
    const existing = merged.get(normalizedUrl)

    if (!existing) {
      // First time seeing this URL - deep clone it
      // Use normalized URL as both the key and the stored URL
      merged.set(normalizedUrl, {
        scriptId: entry.scriptId,
        url: normalizedUrl,
        source: entry.source,
        functions: entry.functions.map(fn => ({
          functionName: fn.functionName,
          isBlockCoverage: fn.isBlockCoverage,
          ranges: fn.ranges.map(r => ({ ...r })),
        })),
      })
      continue
    }

    // Same URL - merge coverage counts using SUM
    // The source and function structure are identical (same webpack bundle)
    for (let i = 0; i < entry.functions.length && i < existing.functions.length; i++) {
      const existingFn = existing.functions[i]
      const newFn = entry.functions[i]

      // Sum counts for each range
      for (let j = 0; j < newFn.ranges.length && j < existingFn.ranges.length; j++) {
        existingFn.ranges[j].count += newFn.ranges[j].count
      }
    }
  }

  const result = Array.from(merged.values())
  log(`  ✓ Merged ${entries.length} entries → ${result.length} unique URLs`)
  endTimer()
  return result
}
