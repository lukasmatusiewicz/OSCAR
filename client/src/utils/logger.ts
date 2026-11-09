/* eslint-disable no-console */
/**
 * Authoritative Client Structured Multi-Level Logger
 *
 * Implements high-visibility CSS-badged structured console logging for the OSCAR Web Client.
 * Adheres to Principle of Least Privilege (PoLP), Zero-PII Invariant, and the 7 Pillars.
 *
 * Badges:
 * - DEBUG: Slate (#64748b)
 * - INFO: Sky Blue (#0284c7)
 * - WARN: Amber (#d97706)
 * - ERROR: Crimson (#dc2626)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export const CLIENT_LOG_STYLES: Record<LogLevel, { badge: string; css: string }> = {
  debug: {
    badge: '%cDEBUG',
    css: 'background: #64748b; color: white; padding: 2px 4px; border-radius: 3px; font-weight: bold;',
  },
  info: {
    badge: '%cINFO',
    css: 'background: #0284c7; color: white; padding: 2px 4px; border-radius: 3px; font-weight: bold;',
  },
  warn: {
    badge: '%cWARN',
    css: 'background: #d97706; color: white; padding: 2px 4px; border-radius: 3px; font-weight: bold;',
  },
  error: {
    badge: '%cERROR',
    css: 'background: #dc2626; color: white; padding: 2px 4px; border-radius: 3px; font-weight: bold;',
  },
};

export const DEFAULT_CLIENT_LOG_LEVEL: LogLevel = 'info';

/**
 * Validates whether an arbitrary string matches a permitted LogLevel.
 *
 * @param candidate Value to validate.
 * @returns True if candidate is a LogLevel.
 */
export function isValidLogLevel(candidate: string): candidate is LogLevel {
  return candidate === 'debug' || candidate === 'info' || candidate === 'warn' || candidate === 'error';
}

/**
 * Client Structured Logger class for React browser environments.
 */
export class ClientLogger {
  private explicitLevel: LogLevel | null = null;

  /**
   * Overrides the current log level programmatically.
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
   * Resets any programmatic log level override.
   */
  public resetLevel(): void {
    this.explicitLevel = null;
  }

  /**
   * Resolves the active LogLevel dynamically.
   * Priority:
   * 1. Explicit level set via setLevel()
   * 2. localStorage.getItem('LOG_LEVEL')
   * 3. import.meta.env.VITE_LOG_LEVEL
   * 4. Fallback -> 'info'
   *
   * @returns Active LogLevel.
   */
  public getLevel(): LogLevel {
    if (this.explicitLevel !== null) {
      return this.explicitLevel;
    }

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem('LOG_LEVEL')?.trim().toLowerCase();
        if (stored && isValidLogLevel(stored)) {
          return stored;
        }
      }
    } catch {
      // Graceful fallback if localStorage is inaccessible (e.g. private mode or sandbox)
    }

    try {
      if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_LOG_LEVEL) {
        const viteLevel = String(import.meta.env.VITE_LOG_LEVEL).trim().toLowerCase();
        if (isValidLogLevel(viteLevel)) {
          return viteLevel;
        }
      }
    } catch {
      // Graceful fallback if import.meta is unavailable
    }

    return DEFAULT_CLIENT_LOG_LEVEL;
  }

  /**
   * Checks whether messages at the given level should be emitted.
   *
   * @param level Severity level to check.
   * @returns True if level is enabled.
   */
  public shouldLog(level: LogLevel): boolean {
    const activeLevel = this.getLevel();
    return LOG_LEVELS[level] >= LOG_LEVELS[activeLevel];
  }

  /**
   * Emits a formatted console log entry with styled badges.
   */
  private emit(level: LogLevel, module: string, message: string, ...args: unknown[]): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const { badge, css } = CLIENT_LOG_STYLES[level];
    const moduleTag = `[${module}]`;

    switch (level) {
      case 'debug':
        console.debug(badge, css, moduleTag, message, ...args);
        break;
      case 'info':
        console.info(badge, css, moduleTag, message, ...args);
        break;
      case 'warn':
        console.warn(badge, css, moduleTag, message, ...args);
        break;
      case 'error':
        console.error(badge, css, moduleTag, message, ...args);
        break;
    }
  }

  /**
   * Logs a debug message with a Slate badge.
   *
   * @param module Subsystem or component name.
   * @param message Textual message.
   * @param args Optional contextual objects or metadata.
   */
  public debug(module: string, message: string, ...args: unknown[]): void {
    this.emit('debug', module, message, ...args);
  }

  /**
   * Logs an informational message with a Sky Blue badge.
   *
   * @param module Subsystem or component name.
   * @param message Textual message.
   * @param args Optional contextual objects or metadata.
   */
  public info(module: string, message: string, ...args: unknown[]): void {
    this.emit('info', module, message, ...args);
  }

  /**
   * Logs a warning message with an Amber badge.
   *
   * @param module Subsystem or component name.
   * @param message Textual message.
   * @param args Optional contextual objects or metadata.
   */
  public warn(module: string, message: string, ...args: unknown[]): void {
    this.emit('warn', module, message, ...args);
  }

  /**
   * Logs an error message with a Crimson badge.
   *
   * @param module Subsystem or component name.
   * @param message Textual message.
   * @param args Optional contextual objects or metadata.
   */
  public error(module: string, message: string, ...args: unknown[]): void {
    this.emit('error', module, message, ...args);
  }
}

export const logger = new ClientLogger();
