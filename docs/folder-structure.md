# Nextcov Folder Structure

This document describes the proposed folder structure for the nextcov codebase.

## Current Status

**Phase 1 Completed:**
- ✅ Created `src/parsers/` folder (bundler-specific parsers)
- ✅ Created `src/converter/` folder (V8 to Istanbul conversion)

**Remaining Phases:**
- Phase 2: Create `src/cli/` folder
- Phase 3: Create `src/utils/` folder
- Phase 4: Create `src/core/` folder
- Phase 5: Create `src/worker/` folder
- Phase 6: Split `src/merger.ts` into `src/merger/` folder

---

## Target Folder Structure

```
src/
├── index.ts (104 L)                    # Main public API - exports everything
│
├── cli/                                 # CLI commands (2,523 L total)
│   ├── index.ts                         # CLI entry point (from cli.ts - 411 L)
│   ├── commands/
│   │   ├── init.ts                      # Init command (from init.ts - 1,144 L)
│   │   └── merge.ts                     # Merge command logic (extracted from cli.ts)
│   └── templates/                       # Template files for init command
│       ├── global-setup.ts.template
│       ├── global-teardown.ts.template
│       └── test-fixtures.ts.template
│
├── core/                                # Core pipeline components
│   ├── processor.ts                     # Main orchestrator (159 L)
│   ├── converter.ts                     # Re-export from converter/ (12 L)
│   ├── reporter.ts                      # Report generator (204 L)
│   ├── v8-reader.ts                     # V8 coverage reader (162 L)
│   └── sourcemap-loader.ts              # Source map loader (350 L)
│
├── converter/                           # ✅ V8 → Istanbul conversion
│   ├── index.ts                         # Main converter class (1,007 L)
│   ├── merge.ts                         # V8 coverage merging (82 L)
│   ├── sanitizer.ts                     # Source map sanitization (340 L)
│   └── coverage-fixes.ts                # Istanbul fixes (754 L)
│
├── merger/                              # Istanbul coverage merging
│   ├── index.ts                         # Main merger (from merger.ts - 968 L)
│   ├── strategies.ts                    # Merge strategies (add, max, prefer-first, etc.)
│   ├── lookups.ts                       # Location-based lookup helpers
│   └── fixes.ts                         # Post-merge fixes
│
├── parsers/                             # ✅ Bundler-specific parsers
│   ├── index.ts                         # Re-exports (105 L)
│   ├── nextjs.ts                        # Next.js patterns (101 L)
│   ├── vite.ts                          # Vite patterns (93 L)
│   ├── webpack.ts                       # Webpack patterns (94 L)
│   ├── sourcemap.ts                     # Source map patterns (92 L)
│   └── url-utils.ts                     # URL utilities (68 L)
│
├── collector/                           # Coverage collectors
│   ├── index.ts                         # Re-exports
│   ├── client.ts                        # Client-side collector (Playwright)
│   ├── dev-server.ts                    # Dev mode server collector
│   ├── v8-server.ts                     # V8 server collector (CDP)
│   └── cdp-utils.ts                     # CDP utilities
│
├── playwright/                          # Playwright integration
│   ├── index.ts                         # Re-exports
│   └── fixture.ts                       # Test fixture
│
├── worker/                              # Worker thread management
│   ├── pool.ts                          # Worker pool (from worker-pool.ts - 291 L)
│   └── ast-worker.ts                    # AST worker (151 L)
│
├── utils/                               # Shared utilities
│   ├── config.ts                        # Configuration (386 L)
│   ├── logger.ts                        # Logging (117 L)
│   ├── constants.ts                     # Constants (92 L)
│   └── dev-mode-extractor.ts            # Dev mode extractor (339 L)
│
├── types/                               # Type definitions
│   ├── index.ts                         # Main types (from types.ts - 169 L)
│   └── bcoe-v8-coverage.d.ts            # External type definitions
│
└── __tests__/                           # Tests (mirror structure)
    ├── cli/
    ├── core/
    ├── converter/                       # ✅ Already created
    ├── merger/
    ├── parsers/                         # ✅ Already created
    └── ...
```

---

## File Migration Mapping

### Phase 1: ✅ Completed

| Current File | New Location | Status |
|--------------|--------------|--------|
| Bundler patterns in `constants.ts` | `parsers/*.ts` | ✅ Done |
| `converter.ts` (2,117 L) | Split into `converter/` | ✅ Done |

### Phase 2: CLI Folder (Priority 1)

| Current File | New Location | Size |
|--------------|--------------|------|
| `cli.ts` | `cli/index.ts` | 411 L |
| `init.ts` | `cli/commands/init.ts` | 1,144 L |
| Templates in `init.ts` (strings) | `cli/templates/*.template` | ~200 L |
| Merge logic in `cli.ts` | `cli/commands/merge.ts` | ~150 L |

### Phase 3: Utils Folder

| Current File | New Location | Size |
|--------------|--------------|------|
| `config.ts` | `utils/config.ts` | 386 L |
| `logger.ts` | `utils/logger.ts` | 117 L |
| `constants.ts` | `utils/constants.ts` | 92 L |
| `dev-mode-extractor.ts` | `utils/dev-mode-extractor.ts` | 339 L |

### Phase 4: Core Folder

| Current File | New Location | Size |
|--------------|--------------|------|
| `processor.ts` | `core/processor.ts` | 159 L |
| `v8-reader.ts` | `core/v8-reader.ts` | 162 L |
| `reporter.ts` | `core/reporter.ts` | 204 L |
| `sourcemap-loader.ts` | `core/sourcemap-loader.ts` | 350 L |
| `converter.ts` (re-export) | `core/converter.ts` | 12 L |

### Phase 5: Worker Folder

| Current File | New Location | Size |
|--------------|--------------|------|
| `worker-pool.ts` | `worker/pool.ts` | 291 L |
| `ast-worker.ts` | `worker/ast-worker.ts` | 151 L |

### Phase 6: Merger Folder

| Current File | New Location | Size |
|--------------|--------------|------|
| `merger.ts` | Split into `merger/` | 968 L |
| CoverageMerger class | `merger/index.ts` | ~300 L |
| Merge strategies | `merger/strategies.ts` | ~250 L |
| Lookup helpers | `merger/lookups.ts` | ~200 L |
| Post-merge fixes | `merger/fixes.ts` | ~200 L |

---

## Key Design Principles

### 1. **Separation of Concerns**

- **`cli/`** - CLI-specific code (argument parsing, file I/O, console output)
- **`core/`** - Main library pipeline (processor, reader, converter, reporter)
- **`converter/`** - V8 → Istanbul conversion logic
- **`merger/`** - Istanbul coverage merging logic
- **`parsers/`** - Bundler-specific URL/path parsing
- **`collector/`** - Coverage collection (Playwright, CDP, dev mode)
- **`utils/`** - Shared utilities (config, logger, constants)
- **`worker/`** - Worker thread management

### 2. **Two Different "Mergers"**

Important: There are **two separate merge concepts**:

| File | What It Merges | Format | When |
|------|----------------|--------|------|
| `converter/merge.ts` | V8 coverage entries | V8 format | Before conversion (deduplicates same URLs) |
| `merger/index.ts` | Istanbul coverage maps | Istanbul format | After conversion (combines test runs) |

These serve **completely different purposes** and should never be confused.

### 3. **Public API Stability**

The `src/index.ts` file re-exports everything, so **users never need to know about internal folder structure**.

External users always import from the package:
```typescript
import { CoverageProcessor, CoverageMerger } from 'nextcov'
```

Internal structure changes don't affect the public API.

### 4. **Folder Responsibilities**

```
┌─────────────────────────────────────────────────────────────┐
│                      Public API (index.ts)                   │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
    ┌───▼────┐          ┌────▼─────┐         ┌────▼─────┐
    │  CLI   │          │   Core   │         │  Utils   │
    │        │          │ Pipeline │         │          │
    │ - init │          │          │         │ - config │
    │ - merge│◄─────────┤processor │◄────────┤ - logger │
    └────────┘          │          │         │ - consts │
                        └──┬───┬───┘         └──────────┘
                           │   │
              ┌────────────┘   └────────────┐
              │                             │
         ┌────▼─────┐                  ┌───▼──────┐
         │Converter │                  │  Merger  │
         │          │                  │          │
         │ V8→Istan │                  │ Istanbul │
         │  - merge │                  │   merge  │
         │  - sanitize                 │   - strategies
         │  - fixes │                  │   - lookups
         └──────────┘                  └──────────┘
```

---

## Migration Strategy

### Recommended Order

1. **Phase 2: CLI Folder** (Highest priority)
   - Largest impact (cleans up root)
   - Most isolated (minimal dependencies)
   - Easy to validate (run CLI commands)

2. **Phase 3: Utils Folder**
   - Consolidates scattered utilities
   - Many files depend on these, so update imports once

3. **Phase 4: Core Folder**
   - Groups main pipeline components
   - Clear separation between library and CLI

4. **Phase 5: Worker Folder**
   - Small, isolated change
   - Only 2 files

5. **Phase 6: Merger Folder**
   - Optional (merger.ts works fine as-is)
   - Only do if we want consistency with converter/

### Testing Strategy

After each phase:
1. Run all tests: `npm test`
2. Run lint: `npm run lint`
3. Test CLI commands: `npx nextcov init`, `npx nextcov merge`
4. Build the package: `npm run build`
5. Test in example project

---

## Benefits of This Structure

### Current Pain Points
- 16 files in `src/` root directory (hard to navigate)
- CLI code mixed with library code
- Utilities scattered across root
- Large files (init.ts: 1,144 L, merger.ts: 968 L)

### After Refactoring
- ✅ Clean root directory (only `index.ts`)
- ✅ Clear separation: CLI vs Library
- ✅ Grouped by functionality
- ✅ Easier to find files
- ✅ Better for new contributors
- ✅ Consistent with converter/ and parsers/ structure

---

## File Count Summary

| Location | Current | After Refactoring |
|----------|---------|-------------------|
| `src/*.ts` (root) | 16 files | 1 file (index.ts) |
| `src/*/*.ts` (folders) | ~25 files | ~55 files |
| Total files | ~41 files | ~56 files |

**Net change:** +15 files, but much better organized

**Code size:** No change (just reorganization)

---

## Notes

- This structure follows the pattern we established with `converter/` and `parsers/`
- Each folder has an `index.ts` that re-exports for convenience
- Tests mirror the source folder structure
- Public API (`src/index.ts`) remains unchanged
- Users don't need to update their code

---

## References

- Original converter refactoring: Completed in previous session
- Parsers refactoring: Completed in previous session
- Related discussion: "Why merger didn't import from converter/merge"

---

**Last Updated:** 2025-12-26
**Status:** Planning document - Phases 2-6 not yet implemented
