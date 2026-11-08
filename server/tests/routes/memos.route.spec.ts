import { describe, it, expect, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { createApp, DEFAULT_CORS_ORIGIN } from '../../src/app.js';
import { TaskStore } from '../../src/store/TaskStore.js';
import { EncryptionService } from '../../src/security/EncryptionService.js';
import { DecryptedTaskPayload } from '../../src/types/contracts.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { GeminiOrchestrator } from '../../src/agent/GeminiOrchestrator.js';
import { inProcessApp } from '../helpers/inProcessApp.js';

describe('Memos Route Integration', () => {
  let taskStore: TaskStore;
  let app: ReturnType<typeof createApp>;
  let testKey: Uint8Array;
  let testKeyBase64: string;

  beforeEach(() => {
    taskStore = new TaskStore();
    app = createApp({ taskStore });
    testKey = EncryptionService.generateKey();
    testKeyBase64 = Buffer.from(testKey).toString('base64');
  });

  describe('POST /api/memos', () => {
    it('processes valid memo, sanitizes PII, extracts task, encrypts payload, and returns 200 with metrics', async () => {
      const memoContent =
        'Schedule strategy review with Alice Newman (alice@example.com, +49 170 1234567) to approve 15000 EUR project budget tomorrow.';

      const res = await inProcessApp(app)
        .post('/api/memos')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          content: memoContent,
          title: 'Review Project Budget',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('task');
      expect(res.body).toHaveProperty('tasks');
      expect(res.body).toHaveProperty('memo');
      expect(res.body).toHaveProperty('piiStats');

      // Verify task structure and default draft status per EU AI Act Human-in-the-Loop mandate
      const createdTask = res.body.task;
      expect(createdTask.status).toBe('DRAFT');
      expect(createdTask.id).toMatch(/^task_/);
      expect(createdTask.encryptedPayload).toBeDefined();
      expect(createdTask.encryptedPayload.ciphertext).toBeDefined();
      expect(createdTask.encryptedPayload.iv).toBeDefined();
      expect(createdTask.encryptedPayload.authTag).toBeDefined();

      // Verify smart metadata threading
      expect(createdTask).toHaveProperty('location');
      expect(createdTask).toHaveProperty('contactPerson');
      expect(createdTask).toHaveProperty('amount');
      expect(createdTask).toHaveProperty('scheduledTime');

      // Verify PII telemetry
      const piiStats = res.body.piiStats;
      expect(piiStats.detectedEntityCount).toBeGreaterThanOrEqual(2);
      expect(piiStats.maskedTokens.length).toBe(piiStats.detectedEntityCount);
      expect(Array.isArray(piiStats.maskedTokens)).toBe(true);

      // Verify the task can be decrypted locally with the session key
      const decrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        createdTask.encryptedPayload,
        testKey,
      );
      expect(decrypted.title).toContain('Budget');
      expect(decrypted.summary.length).toBeGreaterThanOrEqual(5);
      expect(decrypted.subtasks.length).toBeGreaterThanOrEqual(1);

      // Verify smart metadata in decrypted payload
      expect(decrypted).toHaveProperty('location');
      expect(decrypted).toHaveProperty('contactPerson');
      expect(decrypted).toHaveProperty('amount');
      expect(decrypted).toHaveProperty('scheduledTime');

      // Verify task was saved in the store
      const allTasks = taskStore.getTasks();
      expect(allTasks.length).toBe(1);
      expect(allTasks[0].id).toBe(createdTask.id);
      expect(allTasks[0].amount).toBe(createdTask.amount);
    });

    it('rejects invalid memo input with empty content returning 400 Zod error response', async () => {
      const res = await inProcessApp(app).post('/api/memos').send({
        content: '',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(Array.isArray(res.body.issues)).toBe(true);
      expect(res.body.issues.length).toBeGreaterThanOrEqual(1);
      expect(res.body.issues[0].path).toBe('content');
    });

    it('rejects request with missing content property returning 400 Zod error response', async () => {
      const res = await inProcessApp(app).post('/api/memos').send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.issues[0].path).toBe('content');
    });
  });

  describe('Memo Error Handling and Middleware', () => {
    it('handles malformed JSON body payloads returning 400 Bad Request', async () => {
      const res = await inProcessApp(app)
        .post('/api/memos')
        .set('Content-Type', 'application/json')
        .send('{ invalid json payload');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid JSON payload');
    });

    it('returns 500 without leaking stack traces or PII when an unexpected error occurs', async () => {
      const mockFaultyOrchestrator = {
        extractTasks: () =>
          Promise.reject(new Error('Fatal database connection error with PII user@secret.com')),
        extractTask: () =>
          Promise.reject(new Error('Fatal database connection error with PII user@secret.com')),
      };

      const brokenApp = createApp({
        orchestrator: mockFaultyOrchestrator as unknown as GeminiOrchestrator,
        taskStore,
      });

      const res = await inProcessApp(brokenApp)
        .post('/api/memos')
        .send({ content: 'Valid memo content here' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
      expect(res.body.message).toBe(
        'An unexpected internal error occurred while processing the request',
      );
      expect(JSON.stringify(res.body)).not.toContain('user@secret.com');
      expect(JSON.stringify(res.body)).not.toContain('Fatal database');
    });

    it('delegates to next when response headers have already been sent', () => {
      const mockReq = {} as unknown as Request;
      const mockRes = { headersSent: true } as unknown as Response;
      let nextCalledWith: unknown = null;
      const fakeNext: NextFunction = (err?: unknown) => {
        nextCalledWith = err;
      };
      const testErr = new Error('After headers error');
      errorHandler(testErr, mockReq, mockRes, fakeNext);
      expect(nextCalledWith).toBe(testErr);
    });
  });

  describe('Memo Persistence Operations', () => {
    it('retrieves memos sorted by date and clears store successfully', () => {
      taskStore.addMemo({
        id: 'memo_test_001_id_12345',
        userId: 'usr_test_user_001_id',
        encryptedPayload: {
          ciphertext: 'AAAA',
          iv: 'AAAAAAAAAAAAAAAA',
          authTag: 'AAAAAAAAAAAAAAAAAAAAAA==',
          keyId: 'v1',
        },
        sanitizedContentPreview: 'preview content',
        hasPII: false,
        maskedFieldsCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const memos = taskStore.getMemos();
      expect(memos.length).toBe(1);

      taskStore.clear();
      expect(taskStore.getMemos().length).toBe(0);
      expect(taskStore.getTasks().length).toBe(0);
    });
  });
});
