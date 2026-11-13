import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Server } from 'node:http';
import type { Express } from 'express';
import {
  PORT,
  startServer,
  handleShutdown,
  handleUnhandledRejection,
  handleUncaughtException,
} from '../src/index.js';
import { InvalidKeyError } from '../src/security/EncryptionService.js';
import { logger } from '../src/utils/logger.js';

describe('Server Entrypoint & Lifecycle', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalMasterKey = process.env.OSCAR_MASTER_KEY;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    if (originalMasterKey !== undefined) {
      process.env.OSCAR_MASTER_KEY = originalMasterKey;
    } else {
      delete process.env.OSCAR_MASTER_KEY;
    }
    vi.restoreAllMocks();
  });

  it('exports PORT as a valid number', () => {
    expect(typeof PORT).toBe('number');
    expect(PORT).toBeGreaterThan(0);
  });

  it('fails fast before listen() in production when OSCAR_MASTER_KEY is missing or invalid', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.OSCAR_MASTER_KEY;

    const listenMock = vi.fn();
    const mockApp = {
      locals: {},
      listen: listenMock,
    } as unknown as Express;

    await expect(startServer(mockApp)).rejects.toThrow(InvalidKeyError);
    expect(listenMock).not.toHaveBeenCalled();

    process.env.OSCAR_MASTER_KEY = 'invalid_short_key';
    await expect(startServer(mockApp)).rejects.toThrow(InvalidKeyError);
    expect(listenMock).not.toHaveBeenCalled();
  });

  it('awaits store.verifyConnection() before calling listen() and aborts if verification fails', async () => {
    const verifyConnectionMock = vi
      .fn()
      .mockRejectedValue(new Error('Firestore connection verification failed'));
    const listenMock = vi.fn();
    const mockApp = {
      locals: {
        taskStore: { verifyConnection: verifyConnectionMock },
      },
      listen: listenMock,
    } as unknown as Express;

    await expect(startServer(mockApp)).rejects.toThrow('Firestore connection verification failed');
    expect(verifyConnectionMock).toHaveBeenCalledTimes(1);
    expect(listenMock).not.toHaveBeenCalled();
  });

  it('starts an active Server instance and handles graceful shutdown cleanly and idempotently', async () => {
    const startedServer = await startServer();
    expect(startedServer).toBeInstanceOf(Server);

    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

    // Initial shutdown signal invocation
    expect(() => handleShutdown('SIGINT')).not.toThrow();

    // Subsequent idempotent invocation ignores repeated shutdown signals
    expect(() => handleShutdown('SIGTERM')).not.toThrow();

    expect(infoSpy).toHaveBeenCalledWith('Server', 'Shutdown signal received', { signal: 'SIGINT' });
  });

  it('logs cleanly and exits with code 1 on unhandledRejection and uncaughtException', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    handleUnhandledRejection(new Error('Async boom'));
    expect(errorSpy).toHaveBeenCalledWith(
      'Process',
      'Unhandled promise rejection; terminating process',
      { name: 'Error', message: 'Async boom' },
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    errorSpy.mockClear();
    exitSpy.mockClear();

    handleUncaughtException(new Error('Sync boom'));
    expect(errorSpy).toHaveBeenCalledWith(
      'Process',
      'Uncaught exception; terminating process',
      { name: 'Error', message: 'Sync boom' },
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
