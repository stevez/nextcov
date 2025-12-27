/**
 * JSX Pattern Detector Tests
 */

import { describe, it, expect } from 'vitest'
import { detectJsxPatterns } from '../jsx-patterns.js'

describe('detectJsxPatterns', () => {
  describe('JSX ternary operators', () => {
    it('should detect JSX ternary in expression container', () => {
      const code = `
        export function Component({ isAdmin }) {
          return <div>{isAdmin ? <AdminPanel /> : <UserPanel />}</div>
        }
      `
      const issues = detectJsxPatterns({ file: 'test.tsx', code })

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('jsx-ternary')
      expect(issues[0].line).toBe(3)
    })

    it('should detect ternary with only consequent as JSX', () => {
      const code = `
        export function Component({ show }) {
          return <div>{show ? <Content /> : null}</div>
        }
      `
      const issues = detectJsxPatterns({ file: 'test.tsx', code })

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('jsx-ternary')
    })

    it('should detect ternary with only alternate as JSX', () => {
      const code = `
        export function Component({ show }) {
          return <div>{show ? null : <Fallback />}</div>
        }
      `
      const issues = detectJsxPatterns({ file: 'test.tsx', code })

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('jsx-ternary')
    })

    it('should NOT detect ternary outside JSX expression container', () => {
      const code = `
        export function Component({ isAdmin }) {
          const panel = isAdmin ? <AdminPanel /> : <UserPanel />
          return <div>{panel}</div>
        }
      `
      const issues = detectJsxPatterns({ file: 'test.tsx', code })

      expect(issues).toHaveLength(0)
    })

    it('should NOT detect ternary with non-JSX values', () => {
      const code = `
        export function Component({ isAdmin }) {
          return <div>{isAdmin ? 'admin' : 'user'}</div>
        }
      `
      const issues = detectJsxPatterns({ file: 'test.tsx', code })

      expect(issues).toHaveLength(0)
    })

    it('should NOT detect ternary in onClick handler', () => {
      const code = `
        export function Component({ isAdmin }) {
          return (
            <button onClick={() => isAdmin ? doAdmin() : doUser()}>
              Click
            </button>
          )
        }
      `
      const issues = detectJsxPatterns({ file: 'test.tsx', code })

      expect(issues).toHaveLength(0)
    })
  })

  describe('JSX logical AND (&&)', () => {
    it('should detect JSX logical AND in expression container', () => {
      const code = `
        export function Component({ user }) {
          return <div>{user && <Profile user={user} />}</div>
        }
      `
      const issues = detectJsxPatterns({ file: 'test.tsx', code })

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('jsx-logical-and')
      expect(issues[0].line).toBe(3)
    })

    it('should detect multiple && operators with JSX', () => {
      const code = `
        export function Component({ user, data }) {
          return (
            <div>
              {user && <Profile user={user} />}
              {data && <DataView data={data} />}
            </div>
          )
        }
      `
      const issues = detectJsxPatterns({ file: 'test.tsx', code })

      expect(issues).toHaveLength(2)
      expect(issues[0].type).toBe('jsx-logical-and')
      expect(issues[1].type).toBe('jsx-logical-and')
    })

    it('should NOT detect && outside JSX expression container', () => {
      const code = `
        export function Component({ user }) {
          const profile = user && <Profile user={user} />
          return <div>{profile}</div>
        }
      `
      const issues = detectJsxPatterns({ file: 'test.tsx', code })

      expect(issues).toHaveLength(0)
    })

    it('should NOT detect && with non-JSX right operand', () => {
      const code = `
        export function Component({ user }) {
          return <div>{user && user.name}</div>
        }
      `
      const issues = detectJsxPatterns({ file: 'test.tsx', code })

      expect(issues).toHaveLength(0)
    })

    it('should NOT detect && in event handler', () => {
      const code = `
        export function Component({ isValid }) {
          return (
            <button onClick={() => isValid && doSomething()}>
              Click
            </button>
          )
        }
      `
      const issues = detectJsxPatterns({ file: 'test.tsx', code })

      expect(issues).toHaveLength(0)
    })
  })

  describe('JSX nullish coalescing (??)', () => {
    it('should NOT detect nullish coalescing (removed from detection)', () => {
      const code = `
        export function Component({ value }) {
          return <div>{value ?? <Default />}</div>
        }
      `
      const issues = detectJsxPatterns({ file: 'test.tsx', code })

      // Nullish coalescing should NOT be detected
      expect(issues).toHaveLength(0)
    })
  })

  describe('Mixed patterns', () => {
    it('should detect both ternary and && in same component', () => {
      const code = `
        export function Component({ isAdmin, user }) {
          return (
            <div>
              {isAdmin ? <AdminPanel /> : <UserPanel />}
              {user && <Profile user={user} />}
            </div>
          )
        }
      `
      const issues = detectJsxPatterns({ file: 'test.tsx', code })

      expect(issues).toHaveLength(2)
      expect(issues[0].type).toBe('jsx-ternary')
      expect(issues[1].type).toBe('jsx-logical-and')
    })

    it('should detect nested patterns', () => {
      const code = `
        export function Component({ level1, level2 }) {
          return (
            <div>
              {level1 && (level2 ? <Deep /> : <Shallow />)}
            </div>
          )
        }
      `
      const issues = detectJsxPatterns({ file: 'test.tsx', code })

      // Should detect the ternary (the && has a ternary as right operand, not JSX)
      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('jsx-ternary')
    })
  })

  describe('Error handling', () => {
    it('should handle files with syntax errors gracefully', () => {
      const code = `
        export function Component() {
          return <div>{invalid syntax here
        }
      `
      const issues = detectJsxPatterns({ file: 'test.tsx', code })

      // Should not throw, just return empty array
      expect(issues).toEqual([])
    })

    it('should handle non-JSX files gracefully', () => {
      const code = `
        export function normalFunction() {
          const x = true ? 1 : 2
          return x && 3
        }
      `
      const issues = detectJsxPatterns({ file: 'test.ts', code })

      // Should not detect anything in non-JSX code
      expect(issues).toHaveLength(0)
    })
  })

  describe('Code snippets', () => {
    it('should include code snippet in issue', () => {
      const code = `
        export function Component({ show }) {
          return <div>{show ? <A /> : <B />}</div>
        }
      `
      const issues = detectJsxPatterns({ file: 'test.tsx', code })

      expect(issues).toHaveLength(1)
      expect(issues[0].code).toContain('show ? <A /> : <B />')
    })

    it('should include code snippet for && operator', () => {
      const code = `
        export function Component({ user }) {
          return <div>{user && <Profile />}</div>
        }
      `
      const issues = detectJsxPatterns({ file: 'test.tsx', code })

      expect(issues).toHaveLength(1)
      expect(issues[0].code).toContain('user && <Profile />')
    })
  })
})
