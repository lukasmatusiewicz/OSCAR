/**
 * Authoritative Server Structured Multi-Level Logger
 *
 * Implements structured logging adhering to Principle of Least Privilege (PoLP),
 * GDPR Article 25 (Privacy by Design), and the 7 Pillars of Engineering Craftsmanship.
 *
 * Log format:
 * [<ISO_TIMESTAMP>] [<LEVEL>] [<MODULE>] <MESSAGE> <OPTIONAL_JSON_METADATA>\n
 *
 * Levels:
 * DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export const DEFAULT_LOG_LEVEL_TEST: LogLevel = 'error';
export const DEFAULT_LOG_LEVEL_PROD: LogLevel = 'info';

/**
 * Validates whether a candidate string is a recognized LogLevel.
 *
 * @param candidate String value to test.
 * @returns True if candidate is a valid LogLevel.
 */
export function isValidLogLevel(candidate: string): candidate is LogLevel {
  return candidate === 'debug' || candidate === 'info' || candidate === 'warn' || candidate === 'error';
}

/**
 * Enterprise Structured Logger class for Node.js Express runtime.
 */
export class ServerLogger {
  private explicitLevel: LogLevel | null = null;

  /**
   * Sets the explicit log level override.
   *
   * @param level Target LogLevel.
   */
  public setLevel(level: LogLevel): void {
    const normalized = level.toLowerCase();
    if (isValidLogLevel(normalized)) {
      this.explicitLevel = normalized;
    }
  }

  /**
   * Clears any explicit log level override, returning to dynamic resolution.
   */
  public resetLevel(): void {
    this.explicitLevel = null;
  }

  /**
   * Resolves the active LogLevel dynamically.
   * Priority:
   * 1. Explicit level set via setLevel()
   * 2. process.env.LOG_LEVEL (case-insensitive)
   * 3. process.env.NODE_ENV === 'test' -> 'error'
   * 4. Fallback -> 'info'
   *
   * @returns Active LogLevel.
   */
  public getLevel(): LogLevel {
    if (this.explicitLevel !== null) {
      return this.explicitLevel;
    }

    const envLevel = process.env.LOG_LEVEL?.trim().toLowerCase();
    if (envLevel && isValidLogLevel(envLevel)) {
      return envLevel;
    }

    if (process.env.NODE_ENV === 'test') {
      return DEFAULT_LOG_LEVEL_TEST;
    }

    return DEFAULT_LOG_LEVEL_PROD;
  }

  /**
   * Evaluates if a given log level is enabled under the current active level.
   *
   * @param level Level to evaluate.
   * @returns True if the message should be emitted.
   */
  public shouldLog(level: LogLevel): boolean {
    const activeLevel = this.getLevel();
    return LOG_LEVELS[level] >= LOG_LEVELS[activeLevel];
  }

  /**
   * Formats a structured log message.
   * Format: [<ISO_TIMESTAMP>] [<LEVEL>] [<MODULE>] <MESSAGE> <OPTIONAL_JSON_METADATA>\n
   *
   * @param timestamp ISO 8601 timestamp string.
   * @param level Severity level.
   * @param module Originating module name.
   * @param message Textual log message.
   * @param errorOrMeta Optional metadata object or Error instance.
   * @returns Formatted log line with trailing newline.
   */
  public format(
    timestamp: string,
    level: LogLevel,
    module: string,
    message: string,
    errorOrMeta?: Error | Record<string, unknown>,
  ): string {
    const levelStr = level.toUpperCase();
    let metaStr = '';

    if (errorOrMeta instanceof Error) {
      const errorObj: Record<string, unknown> = {
        name: errorOrMeta.name,
        message: errorOrMeta.message,
        ...(errorOrMeta.stack ? { stack: errorOrMeta.stack } : {}),
      };
      for (const [key, value] of Object.entries(errorOrMeta)) {
        if (key !== 'name' && key !== 'message' && key !== 'stack') {
          errorObj[key] = value;
        }
      }
      metaStr = ` ${JSON.stringify(errorObj)}`;
    } else if (errorOrMeta && typeof errorOrMeta === 'object') {
      const keys = Object.keys(errorOrMeta);
      if (keys.length > 0) {
        try {
          metaStr = ` ${JSON.stringify(errorOrMeta)}`;
        } catch {
          metaStr = ` ${JSON.stringify({ error: '[Unserializable Metadata]' })}`;
        }
      }
    }

    return `[${timestamp}] [${levelStr}] [${module}] ${message}${metaStr}\n`;
  }

  /**
   * Internal output dispatcher routing messages to stdout or stderr based on severity.
   */
  private emit(
    level: LogLevel,
    module: string,
    message: string,
    errorOrMeta?: Error | Record<string, unknown>,
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const formatted = this.format(timestamp, level, module, message, errorOrMeta);

    if (level === 'error') {
      process.stderr.write(formatted);
    } else {
      process.stdout.write(formatted);
    }
  }

  /**
   * Emits a DEBUG level log entry (severity 0).
   *
   * @param module Originating module name.
   * @param message Descriptive message.
   * @param metadata Optional metadata object.
   */
  public debug(module: string, message: string, metadata?: Record<string, unknown>): void {
    this.emit('debug', module, message, metadata);
  }

  /**
   * Emits an INFO level log entry (severity 1).
   *
   * @param module Originating module name.
   * @param message Descriptive message.
   * @param metadata Optional metadata object.
   */
  public info(module: string, message: string, metadata?: Record<string, unknown>): void {
    this.emit('info', module, message, metadata);
  }

  /**
   * Emits a WARN level log entry (severity 2).
   *
   * @param module Originating module name.
   * @param message Descriptive message.
   * @param metadata Optional metadata object.
   */
  public warn(module: string, message: string, metadata?: Record<string, unknown>): void {
    this.emit('warn', module, message, metadata);
  }

  /**
   * Emits an ERROR level log entry (severity 3).
   *
   * @param module Originating module name.
   * @param message Descriptive message.
   * @param errorOrMeta Optional Error instance or metadata object.
   */
  public error(
    module: string,
    message: string,
    errorOrMeta?: Error | Record<string, unknown>,
  ): void {
    this.emit('error', module, message, errorOrMeta);
  }
}

export const logger = new ServerLogger();
