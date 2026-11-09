import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ServerLogger,
  logger,
  LogLevel,
  LOG_LEVELS,
  isValidLogLevel,
  DEFAULT_LOG_LEVEL_TEST,
  DEFAULT_LOG_LEVEL_PROD,
} from '../../src/utils/logger.js';

const createStdoutSpy = () => vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
const createStderrSpy = () => vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

describe('Server Structured Multi-Level Logger Suite', () => {
  let stdoutSpy: ReturnType<typeof createStdoutSpy>;
  let stderrSpy: ReturnType<typeof createStderrSpy>;
  const originalEnvLogLevel = process.env.LOG_LEVEL;
  const originalEnvNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.resetLevel();
    delete process.env.LOG_LEVEL;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logger.resetLevel();
    if (originalEnvLogLevel !== undefined) {
      process.env.LOG_LEVEL = originalEnvLogLevel;
    } else {
      delete process.env.LOG_LEVEL;
    }
    process.env.NODE_ENV = originalEnvNodeEnv;
  });

  describe('LogLevel Constants & Validation', () => {
    it('defines correct numerical severity hierarchy', () => {
      expect(LOG_LEVELS.debug).toBe(0);
      expect(LOG_LEVELS.info).toBe(1);
      expect(LOG_LEVELS.warn).toBe(2);
      expect(LOG_LEVELS.error).toBe(3);
    });

    it('validates log levels correctly with isValidLogLevel', () => {
      expect(isValidLogLevel('debug')).toBe(true);
      expect(isValidLogLevel('info')).toBe(true);
      expect(isValidLogLevel('warn')).toBe(true);
      expect(isValidLogLevel('error')).toBe(true);
      expect(isValidLogLevel('DEBUG')).toBe(false);
      expect(isValidLogLevel('trace')).toBe(false);
      expect(isValidLogLevel('')).toBe(false);
    });
  });

  describe('Dynamic Log Level Resolution', () => {
    it('defaults to "error" when NODE_ENV is "test" and LOG_LEVEL is not set', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.LOG_LEVEL;
      expect(logger.getLevel()).toBe(DEFAULT_LOG_LEVEL_TEST);
    });

    it('defaults to "info" when NODE_ENV is "production" and LOG_LEVEL is not set', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.LOG_LEVEL;
      expect(logger.getLevel()).toBe(DEFAULT_LOG_LEVEL_PROD);
    });

    it('respects case-insensitive process.env.LOG_LEVEL', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      expect(logger.getLevel()).toBe('debug');

      process.env.LOG_LEVEL = '  WARN  ';
      expect(logger.getLevel()).toBe('warn');

      process.env.LOG_LEVEL = 'InFo';
      expect(logger.getLevel()).toBe('info');
    });

    it('falls back to default if process.env.LOG_LEVEL has invalid value', () => {
      process.env.NODE_ENV = 'test';
      process.env.LOG_LEVEL = 'invalid_level';
      expect(logger.getLevel()).toBe('error');
    });

    it('allows explicit programmatic override via setLevel() and clearing via resetLevel()', () => {
      logger.setLevel('debug');
      expect(logger.getLevel()).toBe('debug');

      logger.setLevel('warn');
      expect(logger.getLevel()).toBe('warn');

      logger.resetLevel();
      expect(logger.getLevel()).toBe('error'); // back to test default
    });

    it('ignores invalid level strings passed to setLevel()', () => {
      logger.setLevel('info');
      logger.setLevel('unknown' as LogLevel);
      expect(logger.getLevel()).toBe('info');
    });
  });

  describe('Output Formatting & Timestamp Invariant', () => {
    it('formats log messages matching ISO-8601 timestamp and level structure', () => {
      const fixedTimestamp = '2026-11-09T10:00:00.000Z';
      const formatted = logger.format(fixedTimestamp, 'info', 'TestModule', 'Operation succeeded');

      expect(formatted).toBe(`[${fixedTimestamp}] [INFO] [TestModule] Operation succeeded\n`);
    });

    it('includes serialized JSON metadata separated by a single space when provided', () => {
      const fixedTimestamp = '2026-11-09T10:00:00.000Z';
      const metadata = { durationMs: 42, count: 5 };
      const formatted = logger.format(fixedTimestamp, 'debug', 'Metrics', 'Computation done', metadata);

      expect(formatted).toBe(
        `[${fixedTimestamp}] [DEBUG] [Metrics] Computation done {"durationMs":42,"count":5}\n`,
      );
    });

    it('omits metadata space and JSON block when metadata is empty object', () => {
      const fixedTimestamp = '2026-11-09T10:00:00.000Z';
      const formatted = logger.format(fixedTimestamp, 'warn', 'Security', 'Alert', {});

      expect(formatted).toBe(`[${fixedTimestamp}] [WARN] [Security] Alert\n`);
    });

    it('serializes Error instances with name, message, stack, and custom properties', () => {
      const fixedTimestamp = '2026-11-09T10:00:00.000Z';
      const error = new Error('Database connection failed');
      error.name = 'ConnectionError';
      (error as unknown as { code: string }).code = 'ECONNREFUSED';

      const formatted = logger.format(fixedTimestamp, 'error', 'Database', 'Failed to connect', error);

      expect(formatted).toContain('[2026-11-09T10:00:00.000Z] [ERROR] [Database] Failed to connect {');
      expect(formatted).toContain('"name":"ConnectionError"');
      expect(formatted).toContain('"message":"Database connection failed"');
      expect(formatted).toContain('"code":"ECONNREFUSED"');
      expect(formatted).toContain('"stack":');
    });

    it('handles Error instances without stack trace safely', () => {
      const fixedTimestamp = '2026-11-09T10:00:00.000Z';
      const error = new Error('No stack error');
      delete error.stack;

      const formatted = logger.format(fixedTimestamp, 'error', 'System', 'Fatal fault', error);
      expect(formatted).toContain('"name":"Error"');
      expect(formatted).toContain('"message":"No stack error"');
      expect(formatted).not.toContain('"stack":');
    });

    it('handles circular / unserializable metadata gracefully without throwing', () => {
      const fixedTimestamp = '2026-11-09T10:00:00.000Z';
      const circular: Record<string, unknown> = { key: 'value' };
      circular.self = circular;

      const formatted = logger.format(fixedTimestamp, 'warn', 'Telemetry', 'Circular test', circular);
      expect(formatted).toContain('[Unserializable Metadata]');
    });
  });

  describe('Level Filtering & Stream Routing (stdout vs stderr)', () => {
    it('suppresses DEBUG, INFO, WARN when active level is ERROR', () => {
      logger.setLevel('error');

      logger.debug('Mod', 'Debug msg');
      logger.info('Mod', 'Info msg');
      logger.warn('Mod', 'Warn msg');

      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();

      logger.error('Mod', 'Error msg');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stderrSpy.mock.calls[0][0]).toMatch(/\[ERROR\] \[Mod\] Error msg\n$/);
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('routes DEBUG, INFO, WARN to process.stdout.write when enabled', () => {
      logger.setLevel('debug');

      logger.debug('Mod', 'Debug line');
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      expect(stdoutSpy.mock.calls[0][0]).toMatch(/\[DEBUG\] \[Mod\] Debug line\n$/);

      logger.info('Mod', 'Info line');
      expect(stdoutSpy).toHaveBeenCalledTimes(2);
      expect(stdoutSpy.mock.calls[1][0]).toMatch(/\[INFO\] \[Mod\] Info line\n$/);

      logger.warn('Mod', 'Warn line');
      expect(stdoutSpy).toHaveBeenCalledTimes(3);
      expect(stdoutSpy.mock.calls[2][0]).toMatch(/\[WARN\] \[Mod\] Warn line\n$/);

      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('routes ERROR strictly to process.stderr.write', () => {
      logger.setLevel('debug');

      logger.error('Mod', 'Critical failure');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stderrSpy.mock.calls[0][0]).toMatch(/\[ERROR\] \[Mod\] Critical failure\n$/);
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('respects WARN threshold: emits WARN and ERROR, suppresses DEBUG and INFO', () => {
      logger.setLevel('warn');

      logger.debug('Mod', 'Suppressed debug');
      logger.info('Mod', 'Suppressed info');
      expect(stdoutSpy).not.toHaveBeenCalled();

      logger.warn('Mod', 'Visible warning');
      expect(stdoutSpy).toHaveBeenCalledTimes(1);

      logger.error('Mod', 'Visible error');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });

    it('respects INFO threshold: emits INFO, WARN, and ERROR, suppresses DEBUG', () => {
      logger.setLevel('info');

      logger.debug('Mod', 'Suppressed debug');
      expect(stdoutSpy).not.toHaveBeenCalled();

      logger.info('Mod', 'Visible info');
      expect(stdoutSpy).toHaveBeenCalledTimes(1);

      logger.warn('Mod', 'Visible warn');
      expect(stdoutSpy).toHaveBeenCalledTimes(2);

      logger.error('Mod', 'Visible error');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Isolated ServerLogger Instances & Invariants', () => {
    it('creates isolated ServerLogger instances without shared mutable state', () => {
      const customLogger = new ServerLogger();
      customLogger.setLevel('debug');

      expect(customLogger.getLevel()).toBe('debug');
      expect(logger.getLevel()).toBe('error'); // Global singleton remains unaffected

      customLogger.debug('Isolated', 'Test');
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
    });

    it('enforces Zero-PII invariant: logging anonymized token counts and categories', () => {
      logger.setLevel('info');

      const piiMetadata = {
        tokenCount: 3,
        detectedTypes: ['PERSON', 'EMAIL', 'PHONE'],
        riskLevel: 'MEDIUM',
      };

      logger.info('PrivacyGuard', 'PII Sanitization completed', piiMetadata);

      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const output = String(stdoutSpy.mock.calls[0][0]);
      expect(output).toContain('"tokenCount":3');
      expect(output).toContain('"detectedTypes":["PERSON","EMAIL","PHONE"]');
      expect(output).not.toContain('John Doe');
      expect(output).not.toContain('john@example.com');
    });
  });
});
