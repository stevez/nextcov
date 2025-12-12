import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { log, warn, error, setLogging, isLoggingEnabled } from '../logger.js'

describe('logger', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Reset logging state before each test
    setLogging(false)
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  describe('setLogging', () => {
    it('should enable logging when set to true', () => {
      setLogging(true)
      expect(isLoggingEnabled()).toBe(true)
    })

    it('should disable logging when set to false', () => {
      setLogging(true)
      setLogging(false)
      expect(isLoggingEnabled()).toBe(false)
    })
  })

  describe('isLoggingEnabled', () => {
    it('should return false by default', () => {
      // Reset by setting false
      setLogging(false)
      expect(isLoggingEnabled()).toBe(false)
    })

    it('should return true after enabling', () => {
      setLogging(true)
      expect(isLoggingEnabled()).toBe(true)
    })
  })

  describe('log', () => {
    it('should not log when logging is disabled', () => {
      setLogging(false)
      log('test message')
      expect(consoleLogSpy).not.toHaveBeenCalled()
    })

    it('should log when logging is enabled', () => {
      setLogging(true)
      log('test message')
      expect(consoleLogSpy).toHaveBeenCalledWith('test message')
    })

    it('should pass multiple arguments to console.log', () => {
      setLogging(true)
      log('message', 123, { key: 'value' })
      expect(consoleLogSpy).toHaveBeenCalledWith('message', 123, { key: 'value' })
    })

    it('should handle empty arguments', () => {
      setLogging(true)
      log()
      expect(consoleLogSpy).toHaveBeenCalledWith()
    })
  })

  describe('warn', () => {
    it('should always log warnings even when logging is disabled', () => {
      setLogging(false)
      warn('warning message')
      expect(consoleLogSpy).toHaveBeenCalledWith('warning message')
    })

    it('should log warnings when logging is enabled', () => {
      setLogging(true)
      warn('warning message')
      expect(consoleLogSpy).toHaveBeenCalledWith('warning message')
    })

    it('should pass multiple arguments to console.log', () => {
      warn('warning', 'details', 42)
      expect(consoleLogSpy).toHaveBeenCalledWith('warning', 'details', 42)
    })
  })

  describe('error', () => {
    it('should always log errors even when logging is disabled', () => {
      setLogging(false)
      error('error message')
      expect(consoleErrorSpy).toHaveBeenCalledWith('error message')
    })

    it('should log errors when logging is enabled', () => {
      setLogging(true)
      error('error message')
      expect(consoleErrorSpy).toHaveBeenCalledWith('error message')
    })

    it('should pass multiple arguments to console.error', () => {
      error('error', new Error('test'), { context: 'info' })
      expect(consoleErrorSpy).toHaveBeenCalledWith('error', expect.any(Error), { context: 'info' })
    })
  })
})
