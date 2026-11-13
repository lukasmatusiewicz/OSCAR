import type { Server } from 'node:http';
import type { Express } from 'express';
import { app, DEFAULT_PORT } from './app.js';
import { parseMasterKey } from './security/requestKey.js';
import { EncryptionService } from './security/EncryptionService.js';
import type { ITaskRepository } from './store/ITaskRepository.js';
import { logger } from './utils/logger.js';

export const PORT = Number(process.env.PORT) || DEFAULT_PORT;

export let server: Server | undefined;

interface VerifiableTaskStore extends ITaskRepository {
  verifyConnection?: () => Promise<void>;
}

/**
 * Validates production security configuration and store connectivity
 * before binding the HTTP listener.
 *
 * @param targetApp Optional Express application instance (defaults to singleton app).
 * @returns Active Node HTTP Server instance.
 */
export async function startServer(targetApp: Express = app): Promise<Server> {
  if (process.env.NODE_ENV === 'production') {
    const masterKey = parseMasterKey(process.env.OSCAR_MASTER_KEY);
    EncryptionService.zeroKey(masterKey);
  }

  const store = targetApp.locals.taskStore as VerifiableTaskStore | undefined;
  if (store && typeof store.verifyConnection === 'function') {
    await store.verifyConnection();
  }

  const httpServer = targetApp.listen(PORT, '0.0.0.0', () => {
    logger.info('Server', 'OSCAR server started', {
      port: PORT,
      environment: process.env.NODE_ENV ?? 'development',
    });
  });

  server = httpServer;
  return httpServer;
}

let isShuttingDown = false;

export const handleShutdown = (signal: string): void => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info('Server', 'Shutdown signal received', { signal });

  if (!server) {
    if (process.env.NODE_ENV !== 'test') {
      process.exit(0);
    }
    return;
  }

  server.close((err?: Error) => {
    if (err) {
      logger.error('Server', 'Error during server shutdown', {
        signal,
        name: err.name,
        message: err.message,
      });
      if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
      }
      return;
    }

    logger.info('Server', 'Server shutdown completed', { signal });
    if (process.env.NODE_ENV !== 'test') {
      process.exit(0);
    }
  });

  // Fallback force termination if active connections do not drain within 10 seconds
  setTimeout(() => {
    logger.error('Server', 'Forced shutdown timeout exceeded', { signal });
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
  }, 10000).unref();
};

export const handleUnhandledRejection = (reason: unknown): void => {
  const meta =
    reason instanceof Error
      ? { name: reason.name, message: reason.message }
      : { reasonType: typeof reason };
  logger.error('Process', 'Unhandled promise rejection; terminating process', meta);
  process.exit(1);
};

export const handleUncaughtException = (error: Error): void => {
  logger.error('Process', 'Uncaught exception; terminating process', {
    name: error.name,
    message: error.message,
  });
  process.exit(1);
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('unhandledRejection', handleUnhandledRejection);
process.on('uncaughtException', handleUncaughtException);

if (process.env.NODE_ENV !== 'test') {
  void startServer().catch((err: unknown) => {
    const meta =
      err instanceof Error
        ? { name: err.name, message: err.message }
        : { errorType: typeof err };
    logger.error('Server', 'Fatal startup failure; terminating process', meta);
    process.exit(1);
  });
}
