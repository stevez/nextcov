import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { main } from '../index.js'

describe('CLI index', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let originalArgv: string[]

  beforeEach(() => {
    // Save original argv
    originalArgv = [...process.argv]

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    // Restore original argv
    process.argv = originalArgv

    // Restore console methods
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  describe('help command', () => {
    it('should show help when no arguments provided', async () => {
      process.argv = ['node', 'cli.js']

      const exitCode = await main()

      expect(exitCode).toBe(0)
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('nextcov'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Commands:'))
    })

    it('should show help with --help flag', async () => {
      process.argv = ['node', 'cli.js', '--help']

      const exitCode = await main()

      expect(exitCode).toBe(0)
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('nextcov'))
    })

    it('should show help with -h flag', async () => {
      process.argv = ['node', 'cli.js', '-h']

      const exitCode = await main()

      expect(exitCode).toBe(0)
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('nextcov'))
    })
  })

  describe('unknown command', () => {
    it('should show error and help for unknown command', async () => {
      process.argv = ['node', 'cli.js', 'unknown-command']

      const exitCode = await main()

      expect(exitCode).toBe(1)
      expect(consoleErrorSpy).toHaveBeenCalledWith('Unknown command: unknown-command')
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'))
    })
  })

  describe('init command', () => {
    it('should delegate to init command with --help', async () => {
      process.argv = ['node', 'cli.js', 'init', '--help']

      const exitCode = await main()

      expect(exitCode).toBe(0)
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('npx nextcov init'))
    })

    it('should show error for invalid init args', async () => {
      process.argv = ['node', 'cli.js', 'init', '--invalid-flag']

      const exitCode = await main()

      expect(exitCode).toBe(1)
      expect(consoleErrorSpy).toHaveBeenCalled()
    })
  })

  describe('merge command', () => {
    it('should delegate to merge command with --help', async () => {
      process.argv = ['node', 'cli.js', 'merge', '--help']

      const exitCode = await main()

      expect(exitCode).toBe(0)
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('npx nextcov merge'))
    })

    it('should show error for invalid merge args', async () => {
      process.argv = ['node', 'cli.js', 'merge']

      const exitCode = await main()

      expect(exitCode).toBe(1)
      expect(consoleErrorSpy).toHaveBeenCalledWith('No coverage directories specified')
    })
  })
})
