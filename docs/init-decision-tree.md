# `nextcov init` Decision Tree

This document explains the decision flow and options for the `nextcov init` command.

## Command Modes

```
npx nextcov init [options]
```

| Mode | Command | Description |
|------|---------|-------------|
| Interactive | `npx nextcov init` | Prompts for all options |
| Non-interactive | `npx nextcov init -y` | Uses defaults, no prompts |
| Client-only | `npx nextcov init --client-only` | Skips server coverage setup |

---

## Complete Flow Diagram

```mermaid
flowchart TB
    Start([npx nextcov init]) --> PreFlight

    subgraph PreFlight["Pre-flight Checks"]
        P1{playwright.config<br/>exists?}
        P2{Babel config<br/>found?}
        P3{next.config<br/>exists?}
        P4{Jest found?<br/>+ mergeCoverage}

        P1 -->|No| E1[/"❌ Playwright not set up<br/>Run: npm init playwright@latest"/]
        P1 -->|Yes| P2
        P2 -->|Yes| E2[/"❌ Babel not supported<br/>Use SWC instead"/]
        P2 -->|No| P3
        P3 -->|No| E3[/"❌ Next.js config not found"/]
        P3 -->|Yes| P4
        P4 -->|Yes| E4[/"❌ Jest not supported<br/>Use --no-merge or Vitest"/]
        P4 -->|No/Skip| Interactive
    end

    subgraph Interactive["Interactive Prompts (if -y not passed)"]
        Q1["📁 E2E directory?<br/>default: e2e"]
        Q2{"Language<br/>auto-detected?"}
        Q2a["🔤 TypeScript or JavaScript?"]
        Q3["🎯 Coverage mode?<br/>• Full (client + server)<br/>• Client-only"]
        Q4["🔀 Add merge script?<br/>default: Yes"]
        Q5["⚠️ Overwrite existing?<br/>default: No"]

        Q1 --> Q2
        Q2 -->|No| Q2a --> Q3
        Q2 -->|Yes, use detected| Q3
        Q3 --> Q4
        Q4 --> Q5
    end

    Q5 --> ModeCheck{Coverage<br/>Mode?}

    subgraph FullMode["Full Mode (collectServer: true)"]
        F1[/"✓ Create global-setup.ts"/]
        F2[/"✓ Create global-teardown.ts"/]
        F3[/"✓ Create test-fixtures.ts"/]
        F4[/"✓ Modify playwright.config<br/>+ globalSetup<br/>+ globalTeardown<br/>+ nextcov config"/]
        F5[/"✓ Modify package.json<br/>dev:e2e = NODE_OPTIONS=--inspect"/]
        F6[/"✓ Modify next.config<br/>+ E2E_MODE settings"/]

        F1 --> F2 --> F3 --> F4 --> F5 --> F6
    end

    subgraph ClientOnly["Client-Only Mode (collectServer: false)"]
        C1[/"⊘ Skip global-setup.ts"/]
        C2[/"✓ Create global-teardown.ts"/]
        C3[/"✓ Create test-fixtures.ts"/]
        C4[/"✓ Modify playwright.config<br/>+ globalTeardown only<br/>+ collectServer: false"/]
        C5[/"✓ Modify package.json<br/>dev:e2e = E2E_MODE=true"/]
        C6[/"✓ Modify next.config<br/>+ E2E_MODE settings"/]

        C1 --> C2 --> C3 --> C4 --> C5 --> C6
    end

    ModeCheck -->|Full| FullMode
    ModeCheck -->|Client-only| ClientOnly

    FullMode --> Summary
    ClientOnly --> Summary

    subgraph Summary["Summary Output"]
        S1["📋 Summary:<br/>Created: X file(s)<br/>Modified: X file(s)<br/>Skipped: X file(s)"]
        S2["📝 Next steps:<br/>1. Import test fixtures<br/>2. Start dev server<br/>3. Run playwright test<br/>4. View coverage report"]

        S1 --> S2
    end

    Summary --> Done([Done])
```

---

## Interactive Prompts Flow

```mermaid
flowchart LR
    subgraph Prompts
        direction TB
        A["1️⃣ E2E Directory<br/><i>default: e2e</i>"] --> B
        B{"2️⃣ Language<br/><i>auto-detect?</i>"} -->|Yes| C
        B -->|No| B2["Ask: TS or JS?"] --> C
        C["3️⃣ Coverage Mode<br/>○ Full<br/>○ Client-only"] --> D
        D["4️⃣ Merge Script?<br/><i>default: Yes</i>"] --> E
        E["5️⃣ Force Overwrite?<br/><i>default: No</i>"]
    end
```

---

## Mode Comparison

```mermaid
flowchart TB
    subgraph Full["Full Mode"]
        direction TB
        FA[/"global-setup.ts<br/>startServerCoverage()"/]
        FB[/"global-teardown.ts<br/>finalizeCoverage()"/]
        FC[/"test-fixtures.ts<br/>collectClientCoverage()"/]
        FD["dev:e2e script:<br/><code>NODE_OPTIONS=--inspect=9230</code>"]
        FE["Collects:<br/>✓ Server coverage<br/>✓ Client coverage"]
    end

    subgraph ClientOnly["Client-Only Mode"]
        direction TB
        CA[/"❌ No global-setup.ts"/]
        CB[/"global-teardown.ts<br/>finalizeCoverage()"/]
        CC[/"test-fixtures.ts<br/>collectClientCoverage()"/]
        CD["dev:e2e script:<br/><code>E2E_MODE=true</code>"]
        CE["Collects:<br/>✗ No server coverage<br/>✓ Client coverage"]
    end
```

---

## Which Mode to Choose?

```mermaid
flowchart TB
    Start{{"Need server-side<br/>code coverage?"}}

    Start -->|Yes| Full["Use Full Mode<br/><br/>Covers:<br/>• Server Components<br/>• API Routes<br/>• Middleware<br/>• Server Actions"]

    Start -->|No| Static{"Is your app..."}

    Static -->|"Static export<br/>(next export)"| ClientOnly
    Static -->|"SPA with<br/>external API"| ClientOnly
    Static -->|"Testing deployed<br/>environment"| ClientOnly
    Static -->|"Quick local<br/>testing"| ClientOnly
    Static -->|"None of these"| Consider["Consider Full Mode<br/>for complete coverage"]

    ClientOnly["Use Client-Only Mode<br/><br/>Simpler setup:<br/>• No --inspect flag<br/>• No global-setup.ts<br/>• Works with any URL"]

    style Full fill:#90EE90
    style ClientOnly fill:#87CEEB
```

---

## Coverage Mode Comparison

| Aspect | Full Mode | Client-only Mode |
|--------|-----------|------------------|
| **Files created** | global-setup.ts, global-teardown.ts, test-fixtures.ts | global-teardown.ts, test-fixtures.ts |
| **playwright.config** | `globalSetup` + `globalTeardown` | `globalTeardown` only |
| **nextcov config** | Default (collectServer: true) | `collectServer: false` |
| **dev:e2e script** | `NODE_OPTIONS=--inspect=9230` | `E2E_MODE=true` |
| **Server coverage** | ✓ Collected via CDP | ✗ Skipped |
| **Client coverage** | ✓ Collected via Playwright | ✓ Collected via Playwright |
| **Requirements** | Node.js inspector, CDP port | Just Next.js dev server |

---

## CLI Options Reference

| Option | Default | Description |
|--------|---------|-------------|
| `-y, --yes` | false | Skip prompts, use defaults |
| `--e2e-dir <dir>` | `e2e` | E2E test directory |
| `--js` | false | Use JavaScript (default: TypeScript) |
| `--client-only` | false | Client-only mode (no server coverage) |
| `--no-merge` | false | Skip coverage:merge script |
| `--force` | false | Overwrite existing files |

---

## Example Flows

### 1. Quick Start (defaults)

```bash
npx nextcov init -y
```

Creates Full mode setup with:
- `e2e/global-setup.ts`
- `e2e/global-teardown.ts`
- `e2e/fixtures/test-fixtures.ts`

### 2. Client-only for Static Site

```bash
npx nextcov init --client-only -y
```

Creates simplified setup with:
- `e2e/global-teardown.ts`
- `e2e/fixtures/test-fixtures.ts`
- No `--inspect` flag needed

### 3. Custom Directory

```bash
npx nextcov init --e2e-dir tests/e2e -y
```

Creates setup in `tests/e2e/` directory.

### 4. JavaScript Project

```bash
npx nextcov init --js -y
```

Creates `.js` files instead of `.ts`.

---

## Next Steps After Init

### Full Mode

```bash
# 1. Start Next.js with inspector
npm run dev:e2e

# 2. Run tests
npx playwright test

# 3. View report
open coverage/e2e/index.html
```

### Client-only Mode

```bash
# 1. Start Next.js (or use deployed URL)
npm run dev:e2e
# Or set baseURL in playwright.config for deployed environments

# 2. Run tests
npx playwright test

# 3. View report
open coverage/e2e/index.html
```
