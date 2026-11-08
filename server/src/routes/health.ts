import { Router, Request, Response } from 'express';
import { HealthResponse } from '../types/contracts.js';

/**
 * Creates the health check router.
 *
 * @returns Express Router mounted with /health endpoints.
 */
export function createHealthRouter(): Router {
  const router = Router();

  /**
   * GET /api/health
   * System health and readiness probe.
   */
  router.get('/health', (_req: Request, res: Response) => {
    const response: HealthResponse = {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
    res.status(200).json(response);
  });

  return router;
}

