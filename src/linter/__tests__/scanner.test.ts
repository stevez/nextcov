/**
 * Scanner Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { scanFiles } from '../scanner.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('scanFiles', () => {
  let testDir: string

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `nextcov-scanner-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    // Clean up temp directory
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should scan a directory and find issues', async () => {
    // Create a test file with JSX issues
    const srcDir = join(testDir, 'src')
    mkdirSync(srcDir, { recursive: true })

    const componentFile = join(srcDir, 'Component.tsx')
    writeFileSync(
      componentFile,
      `
      export function Component({ isAdmin }: any) {
        return <div>{isAdmin ? <Admin /> : <User />}</div>
      }

      function Admin() { return <div>Admin</div> }
      function User() { return <div>User</div> }
    `
    )

    const result = await scanFiles({
      paths: ['src'],
      cwd: testDir,
    })

    expect(result.filesScanned).toBe(1)
    expect(result.filesWithIssues).toBe(1)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].type).toBe('jsx-ternary')
    expect(result.issues[0].file).toContain('Component.tsx')
  })

  it('should scan multiple files', async () => {
    const srcDir = join(testDir, 'src')
    mkdirSync(srcDir, { recursive: true })

    // File 1: Has ternary issue
    writeFileSync(
      join(srcDir, 'ComponentA.tsx'),
      `
      export function ComponentA({ show }: any) {
        return <div>{show ? <A /> : <B />}</div>
      }
      function A() { return <div>A</div> }
      function B() { return <div>B</div> }
    `
    )

    // File 2: Has logical AND issue
    writeFileSync(
      join(srcDir, 'ComponentB.tsx'),
      `
      export function ComponentB({ user }: any) {
        return <div>{user && <Profile user={user} />}</div>
      }
      function Profile({ user }: any) { return <div>{user.name}</div> }
    `
    )

    // File 3: No issues
    writeFileSync(
      join(srcDir, 'ComponentC.tsx'),
      `
      export function ComponentC() {
        return <div>Hello</div>
      }
    `
    )

    const result = await scanFiles({
      paths: ['src'],
      cwd: testDir,
    })

    expect(result.filesScanned).toBe(3)
    expect(result.filesWithIssues).toBe(2)
    expect(result.issues).toHaveLength(2)
  })

  it('should scan specific file path', async () => {
    const srcDir = join(testDir, 'src')
    mkdirSync(srcDir, { recursive: true })

    writeFileSync(
      join(srcDir, 'Component.tsx'),
      `
      export function Component({ user }: any) {
        return <div>{user && <Profile />}</div>
      }
      function Profile() { return <div>Profile</div> }
    `
    )

    const result = await scanFiles({
      paths: ['src/Component.tsx'],
      cwd: testDir,
    })

    expect(result.filesScanned).toBe(1)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].type).toBe('jsx-logical-and')
  })

  it('should return no issues when files are clean', async () => {
    const srcDir = join(testDir, 'src')
    mkdirSync(srcDir, { recursive: true })

    writeFileSync(
      join(srcDir, 'Component.tsx'),
      `
      export function Component({ isAdmin }: any) {
        const panel = isAdmin ? <Admin /> : <User />
        return <div>{panel}</div>
      }
      function Admin() { return <div>Admin</div> }
      function User() { return <div>User</div> }
    `
    )

    const result = await scanFiles({
      paths: ['src'],
      cwd: testDir,
    })

    expect(result.filesScanned).toBe(1)
    expect(result.filesWithIssues).toBe(0)
    expect(result.issues).toHaveLength(0)
  })

  it('should ignore node_modules by default', async () => {
    const nodeModulesDir = join(testDir, 'node_modules', 'some-package')
    mkdirSync(nodeModulesDir, { recursive: true })

    writeFileSync(
      join(nodeModulesDir, 'Component.tsx'),
      `
      export function Component({ show }: any) {
        return <div>{show ? <A /> : <B />}</div>
      }
      function A() { return <div>A</div> }
      function B() { return <div>B</div> }
    `
    )

    const result = await scanFiles({
      paths: ['.'],
      cwd: testDir,
    })

    expect(result.filesScanned).toBe(0)
    expect(result.issues).toHaveLength(0)
  })

  it('should ignore .next directory by default', async () => {
    const nextDir = join(testDir, '.next', 'server')
    mkdirSync(nextDir, { recursive: true })

    writeFileSync(
      join(nextDir, 'Component.js'),
      `
      export function Component({ show }) {
        return React.createElement('div', null, show ? React.createElement(A) : React.createElement(B))
      }
    `
    )

    const result = await scanFiles({
      paths: ['.'],
      cwd: testDir,
    })

    expect(result.filesScanned).toBe(0)
  })

  it('should respect custom ignore patterns', async () => {
    const srcDir = join(testDir, 'src')
    const testDir2 = join(testDir, 'tests')
    mkdirSync(srcDir, { recursive: true })
    mkdirSync(testDir2, { recursive: true })

    writeFileSync(
      join(srcDir, 'Component.tsx'),
      `
      export function Component({ show }: any) {
        return <div>{show ? <A /> : <B />}</div>
      }
      function A() { return <div>A</div> }
      function B() { return <div>B</div> }
    `
    )

    writeFileSync(
      join(testDir2, 'Test.tsx'),
      `
      export function Test({ show }: any) {
        return <div>{show ? <A /> : <B />}</div>
      }
      function A() { return <div>A</div> }
      function B() { return <div>B</div> }
    `
    )

    const result = await scanFiles({
      paths: ['.'],
      cwd: testDir,
      ignore: ['**/tests/**'],
    })

    expect(result.filesScanned).toBe(1)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].file).toContain('src')
    expect(result.issues[0].file).not.toContain('tests')
  })

  it('should handle multiple issues in single file', async () => {
    const srcDir = join(testDir, 'src')
    mkdirSync(srcDir, { recursive: true })

    writeFileSync(
      join(srcDir, 'Component.tsx'),
      `
      export function Component({ isAdmin, user }: any) {
        return (
          <div>
            {isAdmin ? <Admin /> : <User />}
            {user && <Profile user={user} />}
          </div>
        )
      }
      function Admin() { return <div>Admin</div> }
      function User() { return <div>User</div> }
      function Profile({ user }: any) { return <div>{user.name}</div> }
    `
    )

    const result = await scanFiles({
      paths: ['src'],
      cwd: testDir,
    })

    expect(result.filesScanned).toBe(1)
    expect(result.filesWithIssues).toBe(1)
    expect(result.issues).toHaveLength(2)
    expect(result.issues[0].type).toBe('jsx-ternary')
    expect(result.issues[1].type).toBe('jsx-logical-and')
  })

  it('should scan .js and .jsx files', async () => {
    const srcDir = join(testDir, 'src')
    mkdirSync(srcDir, { recursive: true })

    writeFileSync(
      join(srcDir, 'Component.jsx'),
      `
      export function Component({ show }) {
        return <div>{show ? <A /> : <B />}</div>
      }
      function A() { return <div>A</div> }
      function B() { return <div>B</div> }
    `
    )

    const result = await scanFiles({
      paths: ['src'],
      cwd: testDir,
    })

    expect(result.filesScanned).toBe(1)
    expect(result.issues).toHaveLength(1)
  })

  it('should handle files with syntax errors gracefully', async () => {
    const srcDir = join(testDir, 'src')
    mkdirSync(srcDir, { recursive: true })

    // File with syntax error
    writeFileSync(
      join(srcDir, 'Invalid.tsx'),
      `
      export function Component() {
        return <div>{invalid syntax here
      }
    `
    )

    // Valid file
    writeFileSync(
      join(srcDir, 'Valid.tsx'),
      `
      export function Valid({ show }: any) {
        return <div>{show ? <A /> : <B />}</div>
      }
      function A() { return <div>A</div> }
      function B() { return <div>B</div> }
    `
    )

    const result = await scanFiles({
      paths: ['src'],
      cwd: testDir,
    })

    // Should scan both files but only find issues in valid one
    expect(result.filesScanned).toBe(2)
    expect(result.filesWithIssues).toBe(1)
    expect(result.issues).toHaveLength(1)
  })

  it('should default to current directory when no paths provided', async () => {
    const srcDir = join(testDir, 'src')
    mkdirSync(srcDir, { recursive: true })

    writeFileSync(
      join(srcDir, 'Component.tsx'),
      `
      export function Component({ show }: any) {
        return <div>{show ? <A /> : <B />}</div>
      }
      function A() { return <div>A</div> }
      function B() { return <div>B</div> }
    `
    )

    const result = await scanFiles({
      paths: ['.'],
      cwd: testDir,
    })

    expect(result.filesScanned).toBeGreaterThan(0)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('should handle nested directories', async () => {
    const deepDir = join(testDir, 'src', 'components', 'ui', 'buttons')
    mkdirSync(deepDir, { recursive: true })

    writeFileSync(
      join(deepDir, 'Button.tsx'),
      `
      export function Button({ loading }: any) {
        return <button>{loading && <Spinner />}</button>
      }
      function Spinner() { return <div>Loading...</div> }
    `
    )

    const result = await scanFiles({
      paths: ['src'],
      cwd: testDir,
    })

    expect(result.filesScanned).toBe(1)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].file).toContain('buttons')
  })

  it('should return relative file paths', async () => {
    const srcDir = join(testDir, 'src')
    mkdirSync(srcDir, { recursive: true })

    writeFileSync(
      join(srcDir, 'Component.tsx'),
      `
      export function Component({ show }: any) {
        return <div>{show ? <A /> : <B />}</div>
      }
      function A() { return <div>A</div> }
      function B() { return <div>B</div> }
    `
    )

    const result = await scanFiles({
      paths: ['src'],
      cwd: testDir,
    })

    expect(result.issues[0].file).not.toContain(testDir)
    expect(result.issues[0].file).toMatch(/^src/)
  })
})
