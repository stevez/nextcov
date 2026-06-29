import { describe, it, expect } from 'vitest'
import libCoverage from 'istanbul-lib-coverage'
import type { CoverageMapData } from 'istanbul-lib-coverage'
import { rebaseCoarserMaps, countRebasedFiles } from '../rebase.js'

// ─── helpers ────────────────────────────────────────────────────────────────

function makeMap(files: Record<string, {
  stmts: Array<{ line: number; col: number; hit: number }>
  fns?: Array<{ line: number; col: number; hit: number }>
  branches?: Array<{ line: number; col: number; hits: number[] }>
}>): ReturnType<typeof libCoverage.createCoverageMap> {
  const data: CoverageMapData = {}

  for (const [file, { stmts, fns = [], branches = [] }] of Object.entries(files)) {
    const statementMap: Record<string, unknown> = {}
    const s: Record<string, number> = {}
    stmts.forEach(({ line, col, hit }, i) => {
      statementMap[String(i)] = { start: { line, column: col }, end: { line, column: col + 1 } }
      s[String(i)] = hit
    })

    const fnMap: Record<string, unknown> = {}
    const f: Record<string, number> = {}
    fns.forEach(({ line, col, hit }, i) => {
      fnMap[String(i)] = {
        name: `fn${i}`,
        decl: { start: { line, column: col }, end: { line, column: col + 1 } },
        loc: { start: { line, column: col }, end: { line, column: col + 1 } },
        line,
      }
      f[String(i)] = hit
    })

    const branchMap: Record<string, unknown> = {}
    const b: Record<string, number[]> = {}
    branches.forEach(({ line, col, hits }, i) => {
      branchMap[String(i)] = {
        type: 'if',
        loc: { start: { line, column: col }, end: { line, column: col + 1 } },
        locations: hits.map(() => ({ start: { line, column: col }, end: { line, column: col + 1 } })),
        line,
      }
      b[String(i)] = hits
    })

    data[file] = { path: file, statementMap, fnMap, branchMap, s, f, b } as unknown as CoverageMapData[string]
  }

  return libCoverage.createCoverageMap(data)
}

function stmtCount(map: ReturnType<typeof libCoverage.createCoverageMap>, file: string): number {
  return Object.keys((map.fileCoverageFor(file).toJSON() as { statementMap: Record<string, unknown> }).statementMap).length
}

function hits(map: ReturnType<typeof libCoverage.createCoverageMap>, file: string): number[] {
  return Object.values((map.fileCoverageFor(file).toJSON() as { s: Record<string, number> }).s)
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('rebaseCoarserMaps', () => {
  it('is a no-op when all maps have identical structures', () => {
    const unit = makeMap({ '/src/a.ts': { stmts: [{ line: 2, col: 0, hit: 1 }, { line: 3, col: 0, hit: 1 }] } })
    const e2e  = makeMap({ '/src/a.ts': { stmts: [{ line: 2, col: 0, hit: 1 }, { line: 3, col: 0, hit: 0 }] } })

    const [r0, r1] = rebaseCoarserMaps([unit, e2e])

    // Same object references when no rebase needed
    expect(stmtCount(r0, '/src/a.ts')).toBe(2)
    expect(stmtCount(r1, '/src/a.ts')).toBe(2)
    // hits unchanged
    expect(hits(r1, '/src/a.ts')).toEqual([1, 0])
  })

  it('rebases a coarser E2E map onto a richer unit map', () => {
    // unit: 3 statements at lines 2, 3, 4 — Vite granularity
    const unit = makeMap({
      '/src/a.ts': {
        stmts: [
          { line: 2, col: 0, hit: 1 },
          { line: 3, col: 0, hit: 1 },
          { line: 4, col: 0, hit: 1 },
        ],
      },
    })
    // e2e: only 2 statements — Turbopack merged lines 3+4 into one node at line 3
    const e2e = makeMap({
      '/src/a.ts': {
        stmts: [
          { line: 2, col: 0, hit: 5 },  // exact match with unit stmt 0
          { line: 3, col: 0, hit: 3 },  // exact match with unit stmt 1; unit stmt 2 (line 4) has no e2e counterpart
        ],
      },
    })

    const [rUnit, rE2e] = rebaseCoarserMaps([unit, e2e])

    // unit unchanged (already richest)
    expect(stmtCount(rUnit, '/src/a.ts')).toBe(3)

    // e2e rebased onto unit's 3-statement structure
    expect(stmtCount(rE2e, '/src/a.ts')).toBe(3)

    const e2eHits = hits(rE2e, '/src/a.ts')
    expect(e2eHits[0]).toBe(5)  // line 2: exact match
    expect(e2eHits[1]).toBe(3)  // line 3: exact match
    expect(e2eHits[2]).toBe(0)  // line 4: no e2e counterpart → 0
  })

  it('uses line-number fallback when col differs', () => {
    const unit = makeMap({
      '/src/b.ts': {
        stmts: [
          { line: 5, col: 2, hit: 0 },  // Vite: col=2
        ],
      },
    })
    const e2e = makeMap({
      '/src/b.ts': {
        stmts: [
          { line: 5, col: 0, hit: 7 },  // Turbopack: same line, different col
        ],
      },
    })

    const [, rE2e] = rebaseCoarserMaps([unit, e2e])

    // e2e has same stmt count so unit is richer only by definition (mapIdx=0)
    // but col mismatch means exact lookup fails → falls back to line lookup
    const e2eHits = hits(rE2e, '/src/b.ts')
    expect(e2eHits[0]).toBe(7)
  })

  it('returns single-map array unchanged', () => {
    const unit = makeMap({ '/src/c.ts': { stmts: [{ line: 1, col: 0, hit: 2 }] } })
    const [r] = rebaseCoarserMaps([unit])
    expect(r).toBe(unit)
  })

  it('keeps e2e-only files (not in other maps) unchanged', () => {
    const unit = makeMap({ '/src/a.ts': { stmts: [{ line: 2, col: 0, hit: 1 }, { line: 3, col: 0, hit: 1 }] } })
    const e2e  = makeMap({
      '/src/a.ts': { stmts: [{ line: 2, col: 0, hit: 1 }] },          // coarser — will be rebased
      '/src/server.ts': { stmts: [{ line: 10, col: 0, hit: 4 }] },    // e2e-only — kept as-is
    })

    const [, rE2e] = rebaseCoarserMaps([unit, e2e])

    expect(stmtCount(rE2e, '/src/a.ts')).toBe(2)          // rebased
    expect(stmtCount(rE2e, '/src/server.ts')).toBe(1)     // unchanged
    expect(hits(rE2e, '/src/server.ts')).toEqual([4])
  })

  it('rebases function and branch hit counts', () => {
    const unit = makeMap({
      '/src/d.ts': {
        stmts: [{ line: 2, col: 0, hit: 0 }],
        fns: [{ line: 2, col: 0, hit: 0 }],
        branches: [{ line: 2, col: 0, hits: [0, 0] }],
      },
    })
    const e2e = makeMap({
      '/src/d.ts': {
        stmts: [{ line: 2, col: 0, hit: 3 }],
        fns: [{ line: 2, col: 0, hit: 3 }],
        branches: [{ line: 2, col: 0, hits: [2, 1] }],
      },
    })

    const [, rE2e] = rebaseCoarserMaps([unit, e2e])
    const data = rE2e.fileCoverageFor('/src/d.ts').toJSON() as {
      s: Record<string, number>
      f: Record<string, number>
      b: Record<string, number[]>
    }

    expect(data.s['0']).toBe(3)
    expect(data.f['0']).toBe(3)
    expect(data.b['0']).toEqual([2, 1])
  })
})

describe('countRebasedFiles', () => {
  it('returns 0 when no files were rebased', () => {
    const unit = makeMap({ '/src/a.ts': { stmts: [{ line: 2, col: 0, hit: 1 }] } })
    const e2e  = makeMap({ '/src/a.ts': { stmts: [{ line: 2, col: 0, hit: 1 }] } })
    const rebased = rebaseCoarserMaps([unit, e2e])
    expect(countRebasedFiles([unit, e2e], rebased)).toBe(0)
  })

  it('counts files that gained statements after rebase', () => {
    const unit = makeMap({ '/src/a.ts': { stmts: [{ line: 2, col: 0, hit: 1 }, { line: 3, col: 0, hit: 1 }] } })
    const e2e  = makeMap({ '/src/a.ts': { stmts: [{ line: 2, col: 0, hit: 1 }] } })
    const rebased = rebaseCoarserMaps([unit, e2e])
    expect(countRebasedFiles([unit, e2e], rebased)).toBe(1)
  })
})
