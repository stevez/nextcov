import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createCoverageMap } from 'istanbul-lib-coverage'
import type { CoverageMapData, FileCoverageData } from 'istanbul-lib-coverage'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  removePhantomBranches,
  fixFunctionDeclarationStatements,
  removeDuplicateFunctionEntries,
  fixEmptyStatementMaps,
  filterJsxArrayMethodCallbacks,
  fixSpuriousBranches,
} from '../coverage-fixes.js'

describe('coverage-fixes', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'coverage-fixes-test-'))
  })

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('removePhantomBranches', () => {
    it('should remove phantom branches at line 1, column 0', () => {
      const coverageMap = createCoverageMap({})
      const filePath = '/test/file.ts'

      const fileCoverage: CoverageMapData[string] = {
        path: filePath,
        statementMap: {},
        fnMap: {},
        branchMap: {
          '0': {
            type: 'if',
            line: 1,
            loc: {
              start: { line: 1, column: 0 },
              end: { line: 1, column: 0 },
            },
            locations: [
              { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
            ],
          },
          '1': {
            type: 'if',
            line: 5,
            loc: {
              start: { line: 5, column: 10 },
              end: { line: 5, column: 20 },
            },
            locations: [
              { start: { line: 5, column: 10 }, end: { line: 5, column: 20 } },
            ],
          },
        },
        s: {},
        f: {},
        b: {
          '0': [1, 0],
          '1': [5, 2],
        },
      }

      coverageMap.addFileCoverage(fileCoverage)
      removePhantomBranches(coverageMap)

      const result = coverageMap.fileCoverageFor(filePath).toJSON() as FileCoverageData
      // Phantom branch should be removed, only real branch remains
      expect(Object.keys(result.branchMap)).toHaveLength(1)
      expect(result.branchMap['1']).toBeDefined()
      expect(result.branchMap['0']).toBeUndefined()
    })

    it('should not remove real branches at line 1', () => {
      const coverageMap = createCoverageMap({})
      const filePath = '/test/file.ts'

      const fileCoverage: CoverageMapData[string] = {
        path: filePath,
        statementMap: {},
        fnMap: {},
        branchMap: {
          '0': {
            type: 'if',
            line: 1,
            loc: {
              start: { line: 1, column: 5 }, // Not at column 0
              end: { line: 1, column: 10 },
            },
            locations: [
              { start: { line: 1, column: 5 }, end: { line: 1, column: 10 } },
            ],
          },
        },
        s: {},
        f: {},
        b: { '0': [1, 0] },
      }

      coverageMap.addFileCoverage(fileCoverage)
      removePhantomBranches(coverageMap)

      const result = coverageMap.fileCoverageFor(filePath).toJSON() as FileCoverageData
      expect(Object.keys(result.branchMap)).toHaveLength(1)
      expect(result.branchMap['0']).toBeDefined()
    })

    it('should not remove branches of other types at 1:0', () => {
      const coverageMap = createCoverageMap({})
      const filePath = '/test/file.ts'

      const fileCoverage: CoverageMapData[string] = {
        path: filePath,
        statementMap: {},
        fnMap: {},
        branchMap: {
          '0': {
            type: 'switch', // Not 'if' type
            line: 1,
            loc: {
              start: { line: 1, column: 0 },
              end: { line: 1, column: 0 },
            },
            locations: [
              { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
            ],
          },
        },
        s: {},
        f: {},
        b: { '0': [1, 0] },
      }

      coverageMap.addFileCoverage(fileCoverage)
      removePhantomBranches(coverageMap)

      const result = coverageMap.fileCoverageFor(filePath).toJSON() as FileCoverageData
      expect(Object.keys(result.branchMap)).toHaveLength(1)
    })
  })

  describe('fixFunctionDeclarationStatements', () => {
    it('should fix statement coverage when function is called', () => {
      const coverageMap = createCoverageMap({})
      const filePath = '/test/file.ts'

      const fileCoverage: CoverageMapData[string] = {
        path: filePath,
        statementMap: {
          '0': {
            start: { line: 10, column: 0 },
            end: { line: 10, column: 30 },
          },
        },
        fnMap: {
          '0': {
            name: 'myFunction',
            decl: {
              start: { line: 10, column: 0 },
              end: { line: 10, column: 30 },
            },
            loc: {
              start: { line: 10, column: 0 },
              end: { line: 12, column: 1 },
            },
            line: 10,
          },
        },
        branchMap: {},
        s: { '0': 0 }, // Statement not hit
        f: { '0': 5 }, // But function was called 5 times
        b: {},
      }

      coverageMap.addFileCoverage(fileCoverage)
      fixFunctionDeclarationStatements(coverageMap)

      const result = coverageMap.fileCoverageFor(filePath).toJSON() as FileCoverageData
      // Statement should now have same count as function
      expect(result.s['0']).toBe(5)
    })

    it('should not modify statements when function is not called', () => {
      const coverageMap = createCoverageMap({})
      const filePath = '/test/file.ts'

      const fileCoverage: CoverageMapData[string] = {
        path: filePath,
        statementMap: {
          '0': {
            start: { line: 10, column: 0 },
            end: { line: 10, column: 30 },
          },
        },
        fnMap: {
          '0': {
            name: 'myFunction',
            decl: {
              start: { line: 10, column: 0 },
              end: { line: 10, column: 30 },
            },
            loc: {
              start: { line: 10, column: 0 },
              end: { line: 12, column: 1 },
            },
            line: 10,
          },
        },
        branchMap: {},
        s: { '0': 0 },
        f: { '0': 0 }, // Function not called
        b: {},
      }

      coverageMap.addFileCoverage(fileCoverage)
      fixFunctionDeclarationStatements(coverageMap)

      const result = coverageMap.fileCoverageFor(filePath).toJSON() as FileCoverageData
      expect(result.s['0']).toBe(0)
    })

    it('should not modify statements that already have hits', () => {
      const coverageMap = createCoverageMap({})
      const filePath = '/test/file.ts'

      const fileCoverage: CoverageMapData[string] = {
        path: filePath,
        statementMap: {
          '0': {
            start: { line: 10, column: 0 },
            end: { line: 10, column: 30 },
          },
        },
        fnMap: {
          '0': {
            name: 'myFunction',
            decl: {
              start: { line: 10, column: 0 },
              end: { line: 10, column: 30 },
            },
            loc: {
              start: { line: 10, column: 0 },
              end: { line: 12, column: 1 },
            },
            line: 10,
          },
        },
        branchMap: {},
        s: { '0': 3 }, // Already has hits
        f: { '0': 5 },
        b: {},
      }

      coverageMap.addFileCoverage(fileCoverage)
      fixFunctionDeclarationStatements(coverageMap)

      const result = coverageMap.fileCoverageFor(filePath).toJSON() as FileCoverageData
      expect(result.s['0']).toBe(3) // Should remain unchanged
    })
  })

  describe('removeDuplicateFunctionEntries', () => {
    it('should remove duplicate function with lower count', () => {
      const coverageMap = createCoverageMap({})
      const filePath = '/test/file.ts'

      const fileCoverage: CoverageMapData[string] = {
        path: filePath,
        statementMap: {},
        fnMap: {
          '0': {
            name: 'myArrowFn',
            decl: {
              start: { line: 27, column: 13 },
              end: { line: 27, column: 22 },
            },
            loc: {
              start: { line: 27, column: 13 },
              end: { line: 42, column: 1 },
            },
            line: 27,
          },
          '1': {
            name: '(arrow function)',
            decl: {
              start: { line: 27, column: 13 }, // Same position
              end: { line: 27, column: 22 },
            },
            loc: {
              start: { line: 28, column: 0 }, // Body starts on next line
              end: { line: 42, column: 1 },
            },
            line: 28,
          },
        },
        branchMap: {},
        s: {},
        f: {
          '0': 0, // Export binding, not executed
          '1': 5, // Actual function, executed 5 times
        },
        b: {},
      }

      coverageMap.addFileCoverage(fileCoverage)
      removeDuplicateFunctionEntries(coverageMap)

      const result = coverageMap.fileCoverageFor(filePath).toJSON() as FileCoverageData
      // Should only have one function remaining (the one with higher count)
      expect(Object.keys(result.fnMap)).toHaveLength(1)
      expect(result.fnMap['1']).toBeDefined()
      expect(result.f['1']).toBe(5)
    })

    it('should prefer function body on different line when counts are equal', () => {
      const coverageMap = createCoverageMap({})
      const filePath = '/test/file.ts'

      const fileCoverage: CoverageMapData[string] = {
        path: filePath,
        statementMap: {},
        fnMap: {
          '0': {
            name: 'fn',
            decl: {
              start: { line: 10, column: 0 },
              end: { line: 10, column: 5 },
            },
            loc: {
              start: { line: 10, column: 0 }, // Body on same line as decl
              end: { line: 10, column: 20 },
            },
            line: 10,
          },
          '1': {
            name: 'fn',
            decl: {
              start: { line: 10, column: 0 },
              end: { line: 10, column: 5 },
            },
            loc: {
              start: { line: 11, column: 0 }, // Body on different line
              end: { line: 15, column: 1 },
            },
            line: 11,
          },
        },
        branchMap: {},
        s: {},
        f: {
          '0': 3, // Same count
          '1': 3, // Same count
        },
        b: {},
      }

      coverageMap.addFileCoverage(fileCoverage)
      removeDuplicateFunctionEntries(coverageMap)

      const result = coverageMap.fileCoverageFor(filePath).toJSON() as FileCoverageData
      expect(Object.keys(result.fnMap)).toHaveLength(1)
      // Should keep the one with body on different line (function '1')
      expect(result.fnMap['1']).toBeDefined()
    })

    it('should not remove functions with different declaration positions', () => {
      const coverageMap = createCoverageMap({})
      const filePath = '/test/file.ts'

      const fileCoverage: CoverageMapData[string] = {
        path: filePath,
        statementMap: {},
        fnMap: {
          '0': {
            name: 'fn1',
            decl: {
              start: { line: 10, column: 0 },
              end: { line: 10, column: 5 },
            },
            loc: {
              start: { line: 10, column: 0 },
              end: { line: 12, column: 1 },
            },
            line: 10,
          },
          '1': {
            name: 'fn2',
            decl: {
              start: { line: 20, column: 0 }, // Different line
              end: { line: 20, column: 5 },
            },
            loc: {
              start: { line: 20, column: 0 },
              end: { line: 22, column: 1 },
            },
            line: 20,
          },
        },
        branchMap: {},
        s: {},
        f: { '0': 1, '1': 2 },
        b: {},
      }

      coverageMap.addFileCoverage(fileCoverage)
      removeDuplicateFunctionEntries(coverageMap)

      const result = coverageMap.fileCoverageFor(filePath).toJSON() as FileCoverageData
      // Both functions should remain (different positions)
      expect(Object.keys(result.fnMap)).toHaveLength(2)
    })
  })

  describe('fixEmptyStatementMaps', () => {
    it('should add statement maps when functions exist but statements missing', async () => {
      const filePath = join(tempDir, 'test.ts')
      const sourceCode = 'export function test() { return 42; }'
      writeFileSync(filePath, sourceCode)

      const coverageMap = createCoverageMap({})
      const fileCoverage: CoverageMapData[string] = {
        path: filePath,
        statementMap: {}, // Empty
        fnMap: {
          '0': {
            name: 'test',
            decl: { start: { line: 1, column: 7 }, end: { line: 1, column: 11 } },
            loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 37 } },
            line: 1,
          },
        },
        branchMap: {},
        s: {},
        f: { '0': 1 },
        b: {},
      }

      coverageMap.addFileCoverage(fileCoverage)

      const createEmptyCoverage = vi.fn().mockResolvedValue({
        [filePath]: {
          statementMap: {
            '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 37 } },
          },
          branchMap: {},
          s: { '0': 0 },
          b: {},
        },
      })

      await fixEmptyStatementMaps(coverageMap, { createEmptyCoverage })

      const result = coverageMap.fileCoverageFor(filePath).toJSON() as FileCoverageData
      expect(Object.keys(result.statementMap)).toHaveLength(1)
      expect(result.s['0']).toBe(1) // Function was executed
    })

    it('should add implicit branch for files without branches', async () => {
      const filePath = join(tempDir, 'simple.ts')
      const sourceCode = 'export const value = 42'
      writeFileSync(filePath, sourceCode)

      const coverageMap = createCoverageMap({})
      const fileCoverage: CoverageMapData[string] = {
        path: filePath,
        statementMap: {},
        fnMap: {
          '0': {
            name: 'test',
            decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
            loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 24 } },
            line: 1,
          },
        },
        branchMap: {}, // No branches
        s: {},
        f: { '0': 1 },
        b: {},
      }

      coverageMap.addFileCoverage(fileCoverage)

      const createEmptyCoverage = vi.fn().mockResolvedValue({
        [filePath]: {
          statementMap: {},
          branchMap: {}, // Also no branches in parsed source
          s: {},
          b: {},
        },
      })

      await fixEmptyStatementMaps(coverageMap, { createEmptyCoverage })

      const result = coverageMap.fileCoverageFor(filePath).toJSON() as FileCoverageData
      // Should have implicit branch
      expect(Object.keys(result.branchMap)).toHaveLength(1)
      expect(result.b['0']).toEqual([1]) // Executed
    })
  })

  describe('filterJsxArrayMethodCallbacks', () => {
    it('should remove JSX array method callbacks', async () => {
      const filePath = join(tempDir, 'component.tsx')
      const sourceCode = `
export function List({ items }) {
  return items.map((item) => <div>{item}</div>)
}
`
      writeFileSync(filePath, sourceCode)

      const coverageMap = createCoverageMap({})
      const fileCoverage: CoverageMapData[string] = {
        path: filePath,
        statementMap: {
          '0': { start: { line: 3, column: 2 }, end: { line: 3, column: 47 } },
          '1': { start: { line: 3, column: 29 }, end: { line: 3, column: 45 } },
        },
        fnMap: {
          '0': {
            name: 'List',
            decl: { start: { line: 2, column: 16 }, end: { line: 2, column: 20 } },
            loc: { start: { line: 2, column: 0 }, end: { line: 4, column: 1 } },
            line: 2,
          },
          '1': {
            name: '(anonymous_1)',
            decl: { start: { line: 3, column: 15 }, end: { line: 3, column: 20 } },
            loc: { start: { line: 3, column: 28 }, end: { line: 3, column: 46 } },
            line: 3,
          },
        },
        branchMap: {},
        s: { '0': 1, '1': 5 },
        f: { '0': 1, '1': 5 },
        b: {},
      }

      coverageMap.addFileCoverage(fileCoverage)
      await filterJsxArrayMethodCallbacks(coverageMap)

      const result = coverageMap.fileCoverageFor(filePath).toJSON() as FileCoverageData
      // Anonymous function for .map callback should be removed
      expect(result.fnMap['0']).toBeDefined() // List function remains
      expect(result.fnMap['1']).toBeUndefined() // Callback removed
    })

    it('should not remove non-JSX array callbacks', async () => {
      const filePath = join(tempDir, 'utils.ts')
      const sourceCode = `
export function filterItems(items, cuisine) {
  return items.filter((item) => item.cuisine !== cuisine)
}
`
      writeFileSync(filePath, sourceCode)

      const coverageMap = createCoverageMap({})
      const fileCoverage: CoverageMapData[string] = {
        path: filePath,
        statementMap: {
          '0': { start: { line: 3, column: 2 }, end: { line: 3, column: 60 } },
        },
        fnMap: {
          '0': {
            name: 'filterItems',
            decl: { start: { line: 2, column: 16 }, end: { line: 2, column: 27 } },
            loc: { start: { line: 2, column: 0 }, end: { line: 4, column: 1 } },
            line: 2,
          },
          '1': {
            name: '(anonymous_1)',
            decl: { start: { line: 3, column: 22 }, end: { line: 3, column: 27 } },
            loc: { start: { line: 3, column: 35 }, end: { line: 3, column: 60 } },
            line: 3,
          },
        },
        branchMap: {},
        s: { '0': 1 },
        f: { '0': 1, '1': 10 },
        b: {},
      }

      coverageMap.addFileCoverage(fileCoverage)
      await filterJsxArrayMethodCallbacks(coverageMap)

      const result = coverageMap.fileCoverageFor(filePath).toJSON() as FileCoverageData
      // Both functions should remain (not JSX)
      expect(Object.keys(result.fnMap)).toHaveLength(2)
    })
  })

  describe('fixSpuriousBranches', () => {
    it('should remove branches that don\'t exist in source', async () => {
      const filePath = join(tempDir, 'math.ts')
      const sourceCode = `
export function calculate(a, b) {
  return a * b + 10
}
`
      writeFileSync(filePath, sourceCode)

      const coverageMap = createCoverageMap({})
      const fileCoverage: CoverageMapData[string] = {
        path: filePath,
        statementMap: {
          '0': { start: { line: 3, column: 2 }, end: { line: 3, column: 20 } },
        },
        fnMap: {
          '0': {
            name: 'calculate',
            decl: { start: { line: 2, column: 16 }, end: { line: 2, column: 25 } },
            loc: { start: { line: 2, column: 0 }, end: { line: 4, column: 1 } },
            line: 2,
          },
        },
        branchMap: {
          // Spurious branch mapped to arithmetic operation
          '0': {
            type: 'binary-expr',
            line: 3,
            loc: { start: { line: 3, column: 9 }, end: { line: 3, column: 20 } },
            locations: [
              { start: { line: 3, column: 9 }, end: { line: 3, column: 14 } },
              { start: { line: 3, column: 17 }, end: { line: 3, column: 20 } },
            ],
          },
        },
        s: { '0': 1 },
        f: { '0': 1 },
        b: { '0': [1, 1] },
      }

      coverageMap.addFileCoverage(fileCoverage)
      await fixSpuriousBranches(coverageMap)

      const result = coverageMap.fileCoverageFor(filePath).toJSON() as FileCoverageData
      // Spurious branch should be removed (no logical expression in source)
      expect(Object.keys(result.branchMap)).toHaveLength(0)
    })

    it('should keep real logical expression branches', async () => {
      const filePath = join(tempDir, 'logic.ts')
      const sourceCode = `
export function check(a, b) {
  return a && b || false
}
`
      writeFileSync(filePath, sourceCode)

      const coverageMap = createCoverageMap({})
      const fileCoverage: CoverageMapData[string] = {
        path: filePath,
        statementMap: {
          '0': { start: { line: 3, column: 2 }, end: { line: 3, column: 25 } },
        },
        fnMap: {
          '0': {
            name: 'check',
            decl: { start: { line: 2, column: 16 }, end: { line: 2, column: 21 } },
            loc: { start: { line: 2, column: 0 }, end: { line: 4, column: 1 } },
            line: 2,
          },
        },
        branchMap: {
          '0': {
            type: 'binary-expr',
            line: 3,
            loc: { start: { line: 3, column: 9 }, end: { line: 3, column: 25 } },
            locations: [
              { start: { line: 3, column: 9 }, end: { line: 3, column: 15 } },
              { start: { line: 3, column: 19 }, end: { line: 3, column: 25 } },
            ],
          },
        },
        s: { '0': 1 },
        f: { '0': 1 },
        b: { '0': [1, 0] },
      }

      coverageMap.addFileCoverage(fileCoverage)
      await fixSpuriousBranches(coverageMap)

      const result = coverageMap.fileCoverageFor(filePath).toJSON() as FileCoverageData
      // Real branch should remain
      expect(Object.keys(result.branchMap)).toHaveLength(1)
    })
  })
})
