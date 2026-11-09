import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ClientLogger,
  logger,
  LogLevel,
  LOG_LEVELS,
  isValidLogLevel,
  CLIENT_LOG_STYLES,
  DEFAULT_CLIENT_LOG_LEVEL,
} from '../../src/utils/logger';

describe('Client Structured Multi-Level Logger Suite', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logger.resetLevel();
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('LOG_LEVEL');
    }
  });

  afterEach(() => {
    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logger.resetLevel();
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('LOG_LEVEL');
    }
  });

  describe('Constants and Type Guards', () => {
    it('defines expected numerical severity levels', () => {
      expect(LOG_LEVELS.debug).toBe(0);
      expect(LOG_LEVELS.info).toBe(1);
      expect(LOG_LEVELS.warn).toBe(2);
      expect(LOG_LEVELS.error).toBe(3);
    });

    it('defines distinct CSS styling badges for each log level', () => {
      expect(CLIENT_LOG_STYLES.debug.badge).toBe('%cDEBUG');
      expect(CLIENT_LOG_STYLES.debug.css).toContain('#64748b');

      expect(CLIENT_LOG_STYLES.info.badge).toBe('%cINFO');
      expect(CLIENT_LOG_STYLES.info.css).toContain('#0284c7');

      expect(CLIENT_LOG_STYLES.warn.badge).toBe('%cWARN');
      expect(CLIENT_LOG_STYLES.warn.css).toContain('#d97706');

      expect(CLIENT_LOG_STYLES.error.badge).toBe('%cERROR');
      expect(CLIENT_LOG_STYLES.error.css).toContain('#dc2626');
    });

    it('correctly validates log level strings', () => {
      expect(isValidLogLevel('debug')).toBe(true);
      expect(isValidLogLevel('info')).toBe(true);
      expect(isValidLogLevel('warn')).toBe(true);
      expect(isValidLogLevel('error')).toBe(true);
      expect(isValidLogLevel('TRACE')).toBe(false);
      expect(isValidLogLevel('critical')).toBe(false);
      expect(isValidLogLevel('')).toBe(false);
    });
  });

  describe('Level Resolution Hierarchy', () => {
    it('defaults to "info" when no overrides are configured', () => {
      expect(logger.getLevel()).toBe(DEFAULT_CLIENT_LOG_LEVEL);
    });

    it('prioritizes programmatic setLevel() over localStorage and environment', () => {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('LOG_LEVEL', 'error');
      }

      logger.setLevel('debug');
      expect(logger.getLevel()).toBe('debug');

      logger.resetLevel();
      // Should fall back to localStorage
      expect(logger.getLevel()).toBe('error');
    });

    it('resolves case-insensitive localStorage override', () => {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('LOG_LEVEL', '  WARN  ');
        expect(logger.getLevel()).toBe('warn');

        window.localStorage.setItem('LOG_LEVEL', 'DEBUG');
        expect(logger.getLevel()).toBe('debug');
      }
    });

    it('ignores invalid values in localStorage and falls back safely', () => {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('LOG_LEVEL', 'unsupported_level');
        expect(logger.getLevel()).toBe('info');
      }
    });

    it('ignores invalid level strings passed to setLevel()', () => {
      logger.setLevel('warn');
      logger.setLevel('invalid' as LogLevel);
      expect(logger.getLevel()).toBe('warn');
    });

    it('respects import.meta.env.VITE_LOG_LEVEL when localStorage is empty', () => {
      const originalViteLogLevel = import.meta.env.VITE_LOG_LEVEL;
      try {
        (import.meta.env as Record<string, unknown>).VITE_LOG_LEVEL = 'warn';
        const isolated = new ClientLogger();
        expect(isolated.getLevel()).toBe('warn');

        (import.meta.env as Record<string, unknown>).VITE_LOG_LEVEL = 'invalid_val';
        expect(isolated.getLevel()).toBe('info');
      } finally {
        (import.meta.env as Record<string, unknown>).VITE_LOG_LEVEL = originalViteLogLevel;
      }
    });

    it('gracefully handles throwing localStorage in restricted environments', () => {
      const originalGetItem = window.localStorage.getItem;
      try {
        window.localStorage.getItem = () => {
          throw new DOMException('Access denied', 'SecurityError');
        };
        const isolated = new ClientLogger();
        expect(() => isolated.getLevel()).not.toThrow();
        expect(isolated.getLevel()).toBe('info');
      } finally {
        window.localStorage.getItem = originalGetItem;
      }
    });
  });

  describe('Console Method Invocations & CSS Badges', () => {
    it('invokes console.debug with badge, CSS, module tag, and message', () => {
      logger.setLevel('debug');
      logger.debug('ClientCrypto', 'Session key generated');

      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(debugSpy).toHaveBeenCalledWith(
        '%cDEBUG',
        CLIENT_LOG_STYLES.debug.css,
        '[ClientCrypto]',
        'Session key generated',
      );
    });

    it('invokes console.info with additional metadata arguments', () => {
      logger.setLevel('info');
      const meta = { latencyMs: 15, status: 200 };
      logger.info('GatewayClient', 'POST /api/memos succeeded', meta);

      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledWith(
        '%cINFO',
        CLIENT_LOG_STYLES.info.css,
        '[GatewayClient]',
        'POST /api/memos succeeded',
        meta,
      );
    });

    it('invokes console.warn with multiple metadata arguments', () => {
      logger.setLevel('warn');
      logger.warn('useMemos', 'Gateway timeout, fallback active', 'offline', { retry: false });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        '%cWARN',
        CLIENT_LOG_STYLES.warn.css,
        '[useMemos]',
        'Gateway timeout, fallback active',
        'offline',
        { retry: false },
      );
    });

    it('invokes console.error with Error instance', () => {
      logger.setLevel('error');
      const error = new Error('Decryption failed');
      logger.error('ClientCrypto', 'Failed to decrypt payload', error);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        '%cERROR',
        CLIENT_LOG_STYLES.error.css,
        '[ClientCrypto]',
        'Failed to decrypt payload',
        error,
      );
    });
  });

  describe('Severity Filtering', () => {
    it('suppresses debug logs when level is info', () => {
      logger.setLevel('info');

      logger.debug('Mod', 'Suppressed debug');
      expect(debugSpy).not.toHaveBeenCalled();

      logger.info('Mod', 'Visible info');
      expect(infoSpy).toHaveBeenCalledTimes(1);

      logger.warn('Mod', 'Visible warn');
      expect(warnSpy).toHaveBeenCalledTimes(1);

      logger.error('Mod', 'Visible error');
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('suppresses debug and info when level is warn', () => {
      logger.setLevel('warn');

      logger.debug('Mod', 'Suppressed');
      logger.info('Mod', 'Suppressed');
      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();

      logger.warn('Mod', 'Visible warn');
      expect(warnSpy).toHaveBeenCalledTimes(1);

      logger.error('Mod', 'Visible error');
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('suppresses debug, info, and warn when level is error', () => {
      logger.setLevel('error');

      logger.debug('Mod', 'Suppressed');
      logger.info('Mod', 'Suppressed');
      logger.warn('Mod', 'Suppressed');
      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();

      logger.error('Mod', 'Visible error');
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });
});
