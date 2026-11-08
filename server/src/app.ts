import express, { Express } from 'express';
import cors from 'cors';
import { createHealthRouter } from './routes/health.js';
import { createMemoRouter } from './routes/memos.js';
import { createTaskRouter } from './routes/tasks.js';
import { createDocsRouter } from './routes/docs.js';
import { errorHandler } from './middleware/errorHandler.js';
import { GeminiOrchestrator } from './agent/GeminiOrchestrator.js';
import { TaskStore, taskStore as defaultTaskStore } from './store/TaskStore.js';

export const DEFAULT_CORS_ORIGIN = 'http://localhost:5173';
export const DEFAULT_PORT = 3000;

export interface AppOptions {
  corsOrigin?: string | string[];
  orchestrator?: GeminiOrchestrator;
  taskStore?: TaskStore;
  specPath?: string;
}

/**
 * Creates and configures an Express application instance with CORS,
 * JSON body parsing, structured domain routers, and centralized error handling.
 *
 * @param options Configuration options for dependency injection and environment tuning.
 * @returns Configured Express application.
 */
export function createApp(options: AppOptions = {}): Express {
  const app = express();

  const corsOrigin = options.corsOrigin ?? process.env.CORS_ORIGIN ?? DEFAULT_CORS_ORIGIN;

  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Oscar-Encryption-Key'],
    }),
  );

  app.use(express.json());

  // Live request logging middleware
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      process.stdout.write(
        `[${new Date().toISOString()}] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)\n`,
      );
    });
    next();
  });

  const orchestrator = options.orchestrator ?? new GeminiOrchestrator();
  const store = options.taskStore ?? defaultTaskStore;

  // Mount API routers under /api
  app.use('/api', createHealthRouter());
  app.use('/api', createMemoRouter({ orchestrator, taskStore: store }));
  app.use('/api', createTaskRouter({ taskStore: store }));
  app.use('/api/docs', createDocsRouter({ specPath: options.specPath }));

  // Centralized structured error handling middleware (must be registered after routes)
  app.use(errorHandler);

  return app;
}

export const app = createApp();
