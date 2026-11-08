import type { Server } from 'node:http';
import { app, DEFAULT_PORT } from './app.js';

export const PORT = Number(process.env.PORT) || DEFAULT_PORT;

export const server: Server = app.listen(PORT, () => {
  const startupLog = {
    event: 'SERVER_STARTUP',
    port: PORT,
    environment: process.env.NODE_ENV ?? 'development',
    timestamp: new Date().toISOString(),
  };
  process.stdout.write(`${JSON.stringify(startupLog)}\n`);
});

let isShuttingDown = false;

export const handleShutdown = (signal: string): void => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  const shutdownNotice = {
    event: 'SERVER_SHUTDOWN_SIGNAL_RECEIVED',
    signal,
    timestamp: new Date().toISOString(),
  };
  process.stdout.write(`${JSON.stringify(shutdownNotice)}\n`);

  server.close((err?: Error) => {
    if (err) {
      const errorLog = {
        event: 'SERVER_SHUTDOWN_ERROR',
        signal,
        errorMessage: err.message,
        timestamp: new Date().toISOString(),
      };
      process.stderr.write(`${JSON.stringify(errorLog)}\n`);
      if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
      }
      return;
    }

    const closedLog = {
      event: 'SERVER_SHUTDOWN_COMPLETED',
      signal,
      timestamp: new Date().toISOString(),
    };
    process.stdout.write(`${JSON.stringify(closedLog)}\n`);
    if (process.env.NODE_ENV !== 'test') {
      process.exit(0);
    }
  });

  // Fallback force termination if active connections do not drain within 10 seconds
  setTimeout(() => {
    const timeoutLog = {
      event: 'SERVER_FORCED_SHUTDOWN_TIMEOUT',
      signal,
      timestamp: new Date().toISOString(),
    };
    process.stderr.write(`${JSON.stringify(timeoutLog)}\n`);
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
  }, 10000).unref();
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
