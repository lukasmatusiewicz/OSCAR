import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../src/app.js';
import { resolveSpecPath } from '../../src/routes/docs.js';
import { inProcessApp } from '../helpers/inProcessApp.js';

describe('Documentation Route Integration (/api/docs)', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  describe('GET /api/docs/openapi.yaml', () => {
    it('returns 200, text/yaml content-type, and contains openapi: 3.1.0 specification header', async () => {
      const res = await inProcessApp(app).get('/api/docs/openapi.yaml');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/yaml/);
      expect(res.text).toContain('openapi: 3.1.0');
      expect(res.text).toContain('title: OSCAR Gateway API');
      expect(res.text).toContain('/api/memos:');
      expect(res.text).toContain('/api/tasks:');
      expect(res.text).toContain('/api/health:');
    });

    it('returns structured 500 JSON error when openapi specification path cannot be resolved', async () => {
      const isolatedApp = createApp({ specPath: '/invalid/nonexistent/openapi.yaml' });
      const res = await inProcessApp(isolatedApp).get('/api/docs/openapi.yaml');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('OpenAPI specification not found');
      expect(res.body.message).toBe(
        'The authoritative openapi.yaml specification could not be located on the server',
      );
    });
  });

  describe('GET /api/docs', () => {
    it('returns 200, text/html content-type, and contains interactive documentation viewer container', async () => {
      const res = await inProcessApp(app).get('/api/docs');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.text).toContain('id="api-reference"');
      expect(res.text).toContain('data-url="/api/docs/openapi.yaml"');
      expect(res.text).toContain('@scalar/api-reference');
    });

    it('serves interactive documentation viewer on root trailing slash as well', async () => {
      const res = await inProcessApp(app).get('/api/docs/');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.text).toContain('id="api-reference"');
    });
  });

  describe('resolveSpecPath utility', () => {
    it('resolves the authoritative openapi.yaml specification path successfully', () => {
      const resolved = resolveSpecPath();
      expect(resolved).not.toBeNull();
      expect(resolved).toMatch(/openapi\.yaml$/);
    });

    it('returns custom path when valid custom path is provided', () => {
      const standardPath = resolveSpecPath();
      if (standardPath) {
        const customResolved = resolveSpecPath(standardPath);
        expect(customResolved).toBe(standardPath);
      }
    });
  });
});
