import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { log, warn, error, setLogging, isLoggingEnabled, setTiming, isTimingEnabled, createTimer } from '../logger.js'

describe('logger', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Reset logging and timing state before each test
    setLogging(false)
    setTiming(false)
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

  describe('setTiming', () => {
    it('should enable timing when set to true', () => {
      setTiming(true)
      expect(isTimingEnabled()).toBe(true)
    })

    it('should disable timing when set to false', () => {
      setTiming(true)
      setTiming(false)
      expect(isTimingEnabled()).toBe(false)
    })
  })

  describe('isTimingEnabled', () => {
    it('should return false by default', () => {
      setTiming(false)
      expect(isTimingEnabled()).toBe(false)
    })

    it('should return true after enabling', () => {
      setTiming(true)
      expect(isTimingEnabled()).toBe(true)
    })
  })

  describe('createTimer', () => {
    it('should not log when both logging and timing are disabled', () => {
      setLogging(false)
      setTiming(false)
      const endTimer = createTimer('test')
      endTimer()
      expect(consoleLogSpy).not.toHaveBeenCalled()
    })

    it('should log when logging is enabled', () => {
      setLogging(true)
      setTiming(false)
      const endTimer = createTimer('test operation')
      endTimer()
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('⏱ test operation:'))
    })

    it('should log when timing is enabled but logging is disabled', () => {
      setLogging(false)
      setTiming(true)
      const endTimer = createTimer('test operation')
      endTimer()
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('⏱ test operation:'))
    })

    it('should log when both logging and timing are enabled', () => {
      setLogging(true)
      setTiming(true)
      const endTimer = createTimer('test operation')
      endTimer()
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('⏱ test operation:'))
    })

    it('should include duration in ms', () => {
      setTiming(true)
      const endTimer = createTimer('test')
      endTimer()
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/⏱ test: \d+ms/))
    })
  })
})
