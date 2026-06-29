/**
 * Coverage merge regression diagnostic
 *
 * Usage:
 *   node scripts/diagnose-merge.mjs \
 *     --unit    <unit-coverage-final.json> \
 *     --comp    <component-coverage-final.json> \
 *     --e2e     <e2e-coverage-final.json> \
 *     --merged  <merged-coverage-final.json>
 *
 * Finds statements/functions/branches that are covered in ANY of the
 * source coverages (unit/comp/e2e) but are lost in the merged output.
 */

import { readFileSync } from 'node:fs'

// Parse named args: --unit foo.json --comp bar.json etc.
const args = process.argv.slice(2)
const flags = {}
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    flags[args[i].slice(2)] = args[i + 1]
    i++
  }
}

const { unit: unitPath, comp: compPath, e2e: e2ePath, merged: mergedPath } = flags

if (!mergedPath) {
  console.error([
    'Usage: node diagnose-merge.mjs \\',
    '  --unit   <unit-coverage-final.json> \\',
    '  --comp   <component-coverage-final.json> \\',
    '  --e2e    <e2e-coverage-final.json> \\',
    '  --merged <merged-coverage-final.json>',
    '',
    'At least --e2e and --merged are required. --unit and --comp are optional.',
  ].join('\n'))
  process.exit(1)
}

const load = (path, label) => {
  if (!path) return null
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    console.log(`  Loaded ${label}: ${Object.keys(data).length} files`)
    return data
  } catch (e) {
    console.error(`Failed to load ${label} at ${path}: ${e.message}`)
    process.exit(1)
  }
}

console.log('\nLoading coverage files...')
const unit   = load(unitPath,   'unit')
const comp   = load(compPath,   'component')
const e2e    = load(e2ePath,    'e2e')
const merged = load(mergedPath, 'merged')

// All source coverages (non-null), in order. "covered" means covered in ANY of them.
const sources = [unit, comp, e2e].filter(Boolean)
const sourceLabels = [unit && 'unit', comp && 'comp', e2e && 'e2e'].filter(Boolean)

if (sources.length === 0) {
  console.error('Need at least one of --unit / --comp / --e2e')
  process.exit(1)
}

// All files across all sources
const allSourceFiles = new Set(sources.flatMap(s => Object.keys(s)))

const issues = []

for (const file of allSourceFiles) {
  const mergedCov = merged[file]
  if (!mergedCov) {
    // Which sources had this file?
    const inSources = sourceLabels.filter((_, i) => sources[i][file])
    issues.push({
      file,
      type: 'FILE_MISSING_IN_MERGED',
      detail: `Present in [${inSources.join(', ')}] but missing from merged`,
    })
    continue
  }

  // For each metric, find the "best" count from any source
  // and check it made it into merged

  // ── Statements ───────────────────────────────────────────────────────────
  // Collect all statements covered across sources, keyed by exact location
  const coveredStmts = new Map() // "line:col" -> { maxCount, label, unitLoc }
  for (let si = 0; si < sources.length; si++) {
    const srcCov = sources[si][file]
    if (!srcCov) continue
    for (const [key, loc] of Object.entries(srcCov.statementMap || {})) {
      const count = srcCov.s[key] ?? 0
      if (count === 0) continue
      const locKey = `${loc.start.line}:${loc.start.column}`
      const existing = coveredStmts.get(locKey)
      if (!existing || count > existing.maxCount) {
        coveredStmts.set(locKey, { maxCount: count, label: sourceLabels[si], loc })
      }
    }
  }

  for (const [locKey, { maxCount, label, loc }] of coveredStmts) {
    // Find in merged by exact location
    const mergedKey = Object.entries(mergedCov.statementMap || {}).find(([, mloc]) =>
      mloc.start.line === loc.start.line && mloc.start.column === loc.start.column
    )?.[0]

    if (mergedKey === undefined) {
      // Try line-only
      const lineMatch = Object.entries(mergedCov.statementMap || {}).find(([, mloc]) =>
        mloc.start.line === loc.start.line
      )
      issues.push({
        file,
        type: 'STMT_MISSING_IN_MERGED',
        detail: `@ ${locKey} covered in ${label} (${maxCount}x) — not in merged statementMap${lineMatch ? ` (line ${loc.start.line} exists at different col ${lineMatch[1].start.column}, merged count=${mergedCov.s[lineMatch[0]] ?? 0})` : ''}`,
      })
      continue
    }

    const mergedCount = mergedCov.s[mergedKey] ?? 0
    if (mergedCount === 0) {
      issues.push({
        file,
        type: 'STMT_COUNT_LOST',
        detail: `@ ${locKey}: best-source=${label}(${maxCount}) merged=0`,
      })
    }
  }

  // ── Functions ────────────────────────────────────────────────────────────
  const coveredFns = new Map() // "line:col" -> { maxCount, label, fn }
  for (let si = 0; si < sources.length; si++) {
    const srcCov = sources[si][file]
    if (!srcCov) continue
    for (const [key, fn] of Object.entries(srcCov.fnMap || {})) {
      const count = srcCov.f[key] ?? 0
      if (count === 0) continue
      const locKey = `${fn.loc.start.line}:${fn.loc.start.column}`
      const existing = coveredFns.get(locKey)
      if (!existing || count > existing.maxCount) {
        coveredFns.set(locKey, { maxCount: count, label: sourceLabels[si], fn })
      }
    }
  }

  for (const [locKey, { maxCount, label, fn }] of coveredFns) {
    const mergedKey = Object.entries(mergedCov.fnMap || {}).find(([, mfn]) =>
      mfn.loc.start.line === fn.loc.start.line && mfn.loc.start.column === fn.loc.start.column
    )?.[0]

    if (mergedKey === undefined) {
      const lineMatch = Object.entries(mergedCov.fnMap || {}).find(([, mfn]) =>
        mfn.loc.start.line === fn.loc.start.line
      )
      issues.push({
        file,
        type: 'FN_MISSING_IN_MERGED',
        detail: `"${fn.name}" @ ${locKey} covered in ${label} (${maxCount}x) — not in merged fnMap${lineMatch ? ` (line exists at col ${lineMatch[1].loc.start.column}, merged count=${mergedCov.f[lineMatch[0]] ?? 0})` : ''}`,
      })
      continue
    }

    const mergedCount = mergedCov.f[mergedKey] ?? 0
    if (mergedCount === 0) {
      issues.push({
        file,
        type: 'FN_COUNT_LOST',
        detail: `"${fn.name}" @ ${locKey}: best-source=${label}(${maxCount}) merged=0`,
      })
    }
  }

  // ── Branches ─────────────────────────────────────────────────────────────
  const coveredBranches = new Map() // "line:col" -> { bestCounts, label, branch }
  for (let si = 0; si < sources.length; si++) {
    const srcCov = sources[si][file]
    if (!srcCov) continue
    for (const [key, branch] of Object.entries(srcCov.branchMap || {})) {
      const counts = srcCov.b[key] ?? []
      if (!counts.some(c => c > 0)) continue
      const locKey = `${branch.loc.start.line}:${branch.loc.start.column}`
      const existing = coveredBranches.get(locKey)
      if (!existing) {
        coveredBranches.set(locKey, { bestCounts: counts, label: sourceLabels[si], branch })
      } else {
        // Merge: take max per arm
        const merged2 = existing.bestCounts.map((c, i) => Math.max(c, counts[i] ?? 0))
        coveredBranches.set(locKey, { bestCounts: merged2, label: sourceLabels[si], branch })
      }
    }
  }

  for (const [locKey, { bestCounts, label, branch }] of coveredBranches) {
    const mergedKey = Object.entries(mergedCov.branchMap || {}).find(([, mb]) =>
      mb.loc.start.line === branch.loc.start.line && mb.loc.start.column === branch.loc.start.column
    )?.[0]

    if (mergedKey === undefined) {
      issues.push({
        file,
        type: 'BRANCH_MISSING_IN_MERGED',
        detail: `"${branch.type}" @ ${locKey} covered in ${label} ${JSON.stringify(bestCounts)} — not in merged`,
      })
      continue
    }

    const mergedCounts = mergedCov.b[mergedKey] ?? []
    const lost = bestCounts.some((c, i) => c > 0 && (mergedCounts[i] ?? 0) === 0)
    if (lost) {
      issues.push({
        file,
        type: 'BRANCH_COUNT_LOST',
        detail: `"${branch.type}" @ ${locKey}: best=${JSON.stringify(bestCounts)} merged=${JSON.stringify(mergedCounts)}`,
      })
    }
  }
}

// ── Output ────────────────────────────────────────────────────────────────────

if (issues.length === 0) {
  console.log('\n✅ No regressions found — all source coverage is preserved in merged output.')
  process.exit(0)
}

const byType = {}
for (const issue of issues) {
  byType[issue.type] = byType[issue.type] ?? []
  byType[issue.type].push(issue)
}

const typeOrder = [
  'FILE_MISSING_IN_MERGED',
  'FN_MISSING_IN_MERGED', 'FN_COUNT_LOST',
  'STMT_MISSING_IN_MERGED', 'STMT_COUNT_LOST',
  'BRANCH_MISSING_IN_MERGED', 'BRANCH_COUNT_LOST',
]

console.log(`\n❌ Found ${issues.length} coverage regressions:\n`)
for (const type of typeOrder) {
  const items = byType[type]
  if (!items) continue
  console.log(`── ${type} (${items.length}) ${'─'.repeat(Math.max(0, 50 - type.length))}`)
  const byFile = {}
  for (const item of items) {
    const short = item.file.replace(/.*[/\\]src[/\\]/, 'src/')
    byFile[short] = byFile[short] ?? []
    byFile[short].push(item.detail)
  }
  for (const [file, details] of Object.entries(byFile)) {
    console.log(`  ${file}`)
    for (const d of details.slice(0, 5)) console.log(`    ${d}`)
    if (details.length > 5) console.log(`    ... and ${details.length - 5} more`)
  }
  console.log()
}

const stmtLost = (byType['STMT_COUNT_LOST']?.length ?? 0) + (byType['STMT_MISSING_IN_MERGED']?.length ?? 0)
const fnLost   = (byType['FN_COUNT_LOST']?.length ?? 0)   + (byType['FN_MISSING_IN_MERGED']?.length ?? 0)
const brLost   = (byType['BRANCH_COUNT_LOST']?.length ?? 0) + (byType['BRANCH_MISSING_IN_MERGED']?.length ?? 0)
console.log(`Impact estimate: ~${stmtLost} statements, ~${fnLost} functions, ~${brLost} branch arms lost`)

// ── Structure diff ────────────────────────────────────────────────────────────
// Also show files where e2e has MORE statements than unit/comp (triggers structure switch)
console.log('\n── STRUCTURE MISMATCH (e2e has more items than unit+comp, causes structure switch) ──')
if (e2e) {
  let found = 0
  for (const file of Object.keys(e2e)) {
    const e2eCov = e2e[file]
    const mergedCov = merged[file]
    if (!mergedCov) continue

    const e2eStmts = Object.keys(e2eCov.statementMap || {}).length
    const unitStmts = unit?.[file] ? Object.keys(unit[file].statementMap || {}).length : 0
    const compStmts = comp?.[file] ? Object.keys(comp[file].statementMap || {}).length : 0
    const maxSourceStmts = Math.max(unitStmts, compStmts)

    if (e2eStmts > maxSourceStmts && maxSourceStmts > 0) {
      found++
      console.log(`  ${file.replace(/.*[/\\]src[/\\]/, 'src/')}`)
      console.log(`    statements: unit=${unitStmts} comp=${compStmts} e2e=${e2eStmts} merged=${Object.keys(mergedCov.statementMap || {}).length}`)
    }
  }
  if (found === 0) console.log('  None — e2e never has more items than unit/comp.')
}
