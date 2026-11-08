import { describe, it, expect, beforeEach } from 'vitest';
import { createApp, DEFAULT_CORS_ORIGIN } from '../../src/app.js';
import { TaskStore } from '../../src/store/TaskStore.js';
import { inProcessApp } from '../helpers/inProcessApp.js';

describe('Health and CORS Route Integration', () => {
  let taskStore: TaskStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    taskStore = new TaskStore();
    app = createApp({ taskStore });
  });

  describe('GET /api/health', () => {
    it('returns 200 with health status and ISO timestamp', async () => {
      const res = await inProcessApp(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(typeof res.body.timestamp).toBe('string');
      expect(new Date(res.body.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('CORS Configuration', () => {
    it('returns access-control-allow-origin header matching the client origin', async () => {
      const res = await inProcessApp(app)
        .options('/api/health')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set('Access-Control-Request-Method', 'GET');

      expect(res.headers['access-control-allow-origin']).toBe(DEFAULT_CORS_ORIGIN);
    });

    it('returns CORS headers for regular GET requests with client origin', async () => {
      const res = await inProcessApp(app).get('/api/health').set('Origin', DEFAULT_CORS_ORIGIN);

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(DEFAULT_CORS_ORIGIN);
    });
  });
});
