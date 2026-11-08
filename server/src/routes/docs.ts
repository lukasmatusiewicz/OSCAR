import { Router, Request, Response } from 'express';
import { existsSync, promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Options for configuring the documentation router.
 */
export interface DocsRouterOptions {
  /**
   * Optional custom filesystem path to the OpenAPI specification YAML file.
   */
  specPath?: string;
}

/**
 * Default HTML template embedding the Scalar API Reference viewer.
 */
export const SCALAR_DOCUMENTATION_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OSCAR Gateway API Reference</title>
    <style>
      body {
        margin: 0;
        padding: 0;
      }
    </style>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/api/docs/openapi.yaml"
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;

/**
 * Resolves the authoritative filesystem path to the OpenAPI specification document.
 * Checks explicit paths and multiple environment-aware relative locations to support
 * development, production, and test runners seamlessly.
 *
 * @param customPath - Optional explicit path to openapi.yaml.
 * @returns Resolved absolute path if found, or null.
 */
export function resolveSpecPath(customPath?: string): string | null {
  if (customPath) {
    const resolvedCustom = path.resolve(customPath);
    return existsSync(resolvedCustom) ? resolvedCustom : null;
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));

  const candidatePaths: string[] = [
    path.resolve(process.cwd(), 'docs/spec/openapi.yaml'),
    path.resolve(process.cwd(), '../docs/spec/openapi.yaml'),
    path.resolve(currentDir, '../../../docs/spec/openapi.yaml'),
    path.resolve(currentDir, '../../docs/spec/openapi.yaml'),
    path.resolve(currentDir, '../docs/spec/openapi.yaml'),
  ];

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Creates the documentation router serving OpenAPI specifications and interactive docs.
 *
 * @param options - Configuration options for spec location.
 * @returns Express Router mounted with documentation endpoints.
 */
export function createDocsRouter(options: DocsRouterOptions = {}): Router {
  const router = Router();

  /**
   * GET /api/docs/openapi.yaml
   * Serves the raw OpenAPI 3.1 YAML specification.
   */
  router.get('/openapi.yaml', async (_req: Request, res: Response) => {
    const resolvedPath = resolveSpecPath(options.specPath);

    if (!resolvedPath) {
      res.status(500).json({
        error: 'OpenAPI specification not found',
        message: 'The authoritative openapi.yaml specification could not be located on the server',
      });
      return;
    }

    try {
      const content = await fsPromises.readFile(resolvedPath, 'utf-8');
      res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
      res.status(200).send(content);
    } catch {
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to read the OpenAPI specification file',
      });
    }
  });

  /**
   * GET /api/docs
   * Serves the interactive Scalar API Reference viewer.
   */
  router.get('/', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(SCALAR_DOCUMENTATION_HTML);
  });

  return router;
}
