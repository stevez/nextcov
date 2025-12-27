/**
 * JSX Pattern Detector
 *
 * Detects JSX patterns that V8 coverage cannot track:
 * - JSX ternary operators: {cond ? <A /> : <B />}
 * - JSX logical AND: {cond && <Component />}
 */

import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
import type { Node } from '@babel/types'

// @babel/traverse has a default export that itself is the default
const traverse = (_traverse as any).default || _traverse

export interface JsxIssue {
  type: 'jsx-ternary' | 'jsx-logical-and'
  file: string
  line: number
  column: number
  code: string
}

interface DetectorOptions {
  file: string
  code: string
}

/**
 * Check if a node is a JSX element or fragment
 */
function isJsxNode(node: Node | null | undefined): boolean {
  if (!node) return false
  return (
    node.type === 'JSXElement' ||
    node.type === 'JSXFragment' ||
    node.type === 'JSXText'
  )
}

/**
 * Check if node is inside a JSX expression container
 */
function isInsideJsxExpressionContainer(path: any): boolean {
  let current = path.parentPath
  while (current) {
    if (current.node.type === 'JSXExpressionContainer') {
      return true
    }
    // Stop if we hit a function boundary
    if (
      current.node.type === 'FunctionDeclaration' ||
      current.node.type === 'FunctionExpression' ||
      current.node.type === 'ArrowFunctionExpression'
    ) {
      return false
    }
    current = current.parentPath
  }
  return false
}

/**
 * Extract code snippet from source
 */
function getCodeSnippet(code: string, line: number, column: number): string {
  const lines = code.split('\n')
  const targetLine = lines[line - 1]
  if (!targetLine) return ''

  // Find the expression - look for the pattern within the line
  // Simple approach: get the relevant portion around the column
  const start = Math.max(0, column - 10)
  const end = Math.min(targetLine.length, column + 50)
  let snippet = targetLine.slice(start, end).trim()

  // Try to get the full expression by finding balanced braces
  const fullLine = targetLine.trim()
  if (fullLine.length < 80) {
    snippet = fullLine
  }

  return snippet
}

/**
 * Detect JSX patterns that V8 cannot track
 */
export function detectJsxPatterns(options: DetectorOptions): JsxIssue[] {
  const { file, code } = options
  const issues: JsxIssue[] = []

  try {
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'decorators-legacy'],
      errorRecovery: true,
    })

    traverse(ast, {
      // Detect JSX ternary: {cond ? <A /> : <B />}
      ConditionalExpression(path: any) {
        const { node } = path
        const hasJsxConsequent = isJsxNode(node.consequent)
        const hasJsxAlternate = isJsxNode(node.alternate)

        if ((hasJsxConsequent || hasJsxAlternate) && isInsideJsxExpressionContainer(path)) {
          const loc = node.loc
          if (loc) {
            issues.push({
              type: 'jsx-ternary',
              file,
              line: loc.start.line,
              column: loc.start.column,
              code: getCodeSnippet(code, loc.start.line, loc.start.column),
            })
          }
        }
      },

      // Detect JSX logical AND: {cond && <Component />}
      LogicalExpression(path: any) {
        const { node } = path

        if (node.operator === '&&' && isJsxNode(node.right) && isInsideJsxExpressionContainer(path)) {
          const loc = node.loc
          if (loc) {
            issues.push({
              type: 'jsx-logical-and',
              file,
              line: loc.start.line,
              column: loc.start.column,
              code: getCodeSnippet(code, loc.start.line, loc.start.column),
            })
          }
        }
      },
    })
  } catch (error) {
    // Silently skip files that can't be parsed
    // This is expected for non-JS/TS files or files with syntax errors
  }

  return issues
}
