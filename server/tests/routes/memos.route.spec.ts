import { describe, it, expect, beforeEach, vi } from 'vitest';
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

    it('correctly normalizes nominative contact name, title-cases address, and formats summary with bullets for beatą kozidrak', async () => {
      const res = await inProcessApp(app)
        .post('/api/memos')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          content: 'spotkanie z beatą kozidrak. hamburgerstr. 123',
        });

      expect(res.status).toBe(200);
      const createdTask = res.body.task;
      expect(createdTask.contactPerson).toBe('Beata Kozidrak');
      expect(createdTask.location).toBe('Hamburgerstr. 123');

      const decrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        createdTask.encryptedPayload,
        testKey,
      );
      expect(decrypted.title).toBe('Spotkanie z Beatą Kozidrak');
      expect(decrypted.contactPerson).toBe('Beata Kozidrak');
      expect(decrypted.location).toBe('Hamburgerstr. 123');
      expect(decrypted.summary).toContain('👤 Contact: Beata Kozidrak');
      expect(decrypted.summary).toContain('📍 Location: Hamburgerstr. 123');
      expect(decrypted.summary).toContain('• 👤 Contact: Beata Kozidrak');
      expect(decrypted.summary).toContain('• 📍 Location: Hamburgerstr. 123');
    });

    it('deduplicates contactPerson and location when input memo already contains card markers or rehydration occurs', async () => {
      const res = await inProcessApp(app)
        .post('/api/memos')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          content:
            'Spotkanie z Beatą Kozidrak\n• 👤 Contact: Beata Kozidrak\n• 👤 Contact: Beata Kozidrak\n• 📍 Location: Hamburgerstr. 123',
        });

      expect(res.status).toBe(200);
      const createdTask = res.body.task;
      const decrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        createdTask.encryptedPayload,
        testKey,
      );

      // Verify exactly one occurrence of • 👤 Contact: and • 📍 Location:
      const contactMatches = decrypted.summary.match(/• 👤 Contact:[^\r\n]*/g);
      expect(contactMatches).toHaveLength(1);
      expect(contactMatches?.[0]).toBe('• 👤 Contact: Beata Kozidrak');

      const locationMatches = decrypted.summary.match(/• 📍 Location:[^\r\n]*/g);
      expect(locationMatches).toHaveLength(1);
      expect(locationMatches?.[0]).toBe('• 📍 Location: Hamburgerstr. 123');

      // Verify title is cleanly extracted without metadata prefixes
      expect(decrypted.title).toBe('Spotkanie z Beatą Kozidrak');
    });

    it('inserts contactPerson and location when not initially present in summary, and enforces summary bounds', async () => {
      const mockCustomOrchestrator = {
        extractTasks: () =>
          Promise.resolve({
            task: {
              title: 'Brief Task',
              summary: 'Plan',
              category: 'WORK',
              priority: 'HIGH',
              scheduledDate: null,
              tags: ['work'],
              subtasks: [{ title: 'Subtask 1', completed: false }],
              location: 'Berlin',
              contactPerson: 'Alice',
              amount: null,
              scheduledTime: null,
            },
            provenance: 'GEMINI_FLASH',
            modelVersion: 'gemini-2.5-flash',
          }),
        extractTask: () => Promise.reject(new Error('Not used')),
      };

      const customApp = createApp({
        orchestrator: mockCustomOrchestrator as unknown as GeminiOrchestrator,
        taskStore,
      });

      const res = await inProcessApp(customApp)
        .post('/api/memos')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          content: 'Plan memo with Alice in Berlin',
        });

      expect(res.status).toBe(200);
      const createdTask = res.body.task;
      const decrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        createdTask.encryptedPayload,
        testKey,
      );
      expect(decrypted.summary).toContain('• 👤 Contact: Alice');
      expect(decrypted.summary).toContain('• 📍 Location: Berlin');
    });

    it('inserts location when contact is absent (contactIdx === -1) and deduplicates multiple duplicate location lines', async () => {
      const mockLocationOnlyOrchestrator = {
        extractTasks: () =>
          Promise.resolve({
            task: {
              title: 'Conference Room Booking',
              summary: 'Book meeting room.\n• 📍 Location: Kassel Office\n• 📍 Location: Kassel Office',
              category: 'WORK',
              priority: 'MEDIUM',
              scheduledDate: null,
              tags: ['work'],
              subtasks: [{ title: 'Check availability', completed: false }],
              location: 'Kassel Office',
              contactPerson: null,
              amount: null,
              scheduledTime: null,
            },
            provenance: 'GEMINI_FLASH',
            modelVersion: 'gemini-2.5-flash',
          }),
        extractTask: () => Promise.reject(new Error('Not used')),
      };

      const locationApp = createApp({
        orchestrator: mockLocationOnlyOrchestrator as unknown as GeminiOrchestrator,
        taskStore,
      });

      const res = await inProcessApp(locationApp)
        .post('/api/memos')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          content: 'Book meeting room in Kassel Office',
        });

      expect(res.status).toBe(200);
      const createdTask = res.body.task;
      const decrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        createdTask.encryptedPayload,
        testKey,
      );

      const locMatches = decrypted.summary.match(/• 📍 Location:[^\r\n]*/g);
      expect(locMatches).toHaveLength(1);
      expect(decrypted.location).toBe('Kassel Office');
      expect(decrypted.contactPerson).toBeNull();
    });

    it('inserts location at index 1 when contact is absent and no existing location lines', async () => {
      const mockNoMarkersOrchestrator = {
        extractTasks: () =>
          Promise.resolve({
            task: {
              title: 'Location Without Markers',
              summary: 'Core description of the event',
              category: 'WORK',
              priority: 'LOW',
              scheduledDate: null,
              tags: ['work'],
              subtasks: [{ title: 'Check venue', completed: false }],
              location: 'Hamburg Center',
              contactPerson: null,
              amount: null,
              scheduledTime: null,
            },
            provenance: 'GEMINI_FLASH',
            modelVersion: 'gemini-2.5-flash',
          }),
        extractTask: () => Promise.reject(new Error('Not used')),
      };

      const noMarkerApp = createApp({
        orchestrator: mockNoMarkersOrchestrator as unknown as GeminiOrchestrator,
        taskStore,
      });

      const res = await inProcessApp(noMarkerApp)
        .post('/api/memos')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          content: 'Visit Hamburg Center for site inspection',
        });

      expect(res.status).toBe(200);
      const decrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        res.body.task.encryptedPayload,
        testKey,
      );
      expect(decrypted.summary).toContain('• 📍 Location: Hamburg Center');
    });

    it('enforces summary boundaries truncating > 1000 characters and padding < 5 characters', async () => {
      const mockBoundaryOrchestrator = {
        extractTasks: () =>
          Promise.resolve({
            task: {
              title: 'Long Memo Summary',
              summary: 'X'.repeat(1050),
              category: 'WORK',
              priority: 'HIGH',
              scheduledDate: null,
              tags: ['work'],
              subtasks: [{ title: 'Process', completed: false }],
              location: null,
              contactPerson: null,
              amount: null,
              scheduledTime: null,
            },
            provenance: 'GEMINI_FLASH',
            modelVersion: 'gemini-2.5-flash',
          }),
        extractTask: () => Promise.reject(new Error('Not used')),
      };

      const boundaryApp = createApp({
        orchestrator: mockBoundaryOrchestrator as unknown as GeminiOrchestrator,
        taskStore,
      });

      const res = await inProcessApp(boundaryApp)
        .post('/api/memos')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          content: 'Long memo requiring bounds checking',
        });

      expect(res.status).toBe(200);
      const decrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        res.body.task.encryptedPayload,
        testKey,
      );
      expect(decrypted.summary.length).toBeLessThanOrEqual(1000);
      expect(decrypted.summary.endsWith('...')).toBe(true);
    });

    it('falls back to rehydratedTask.title when request title is empty whitespace or omitted', async () => {
      const res = await inProcessApp(app)
        .post('/api/memos')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          content: 'Schedule weekly planning meeting tomorrow',
          title: '   ',
        });

      expect(res.status).toBe(200);
      const decrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        res.body.task.encryptedPayload,
        testKey,
      );
      expect(decrypted.title.trim().length).toBeGreaterThan(0);
    });

    it('rehydrates scheduledTime and deduplicates multiple contact lines, padding short summaries', async () => {
      const mockMultiContactOrchestrator = {
        extractTasks: () =>
          Promise.resolve({
            task: {
              title: 'Short Summary Task',
              summary: '• 👤 Contact: Dr. Smith\n• 👤 Contact: Dr. Smith',
              category: 'WORK',
              priority: 'MEDIUM',
              scheduledDate: null,
              tags: ['work'],
              subtasks: [{ title: 'Sync with Dr. Smith', completed: false }],
              location: null,
              contactPerson: 'Dr. Smith',
              amount: null,
              scheduledTime: 'tomorrow at [PERSON_1]',
            },
            provenance: 'GEMINI_FLASH',
            modelVersion: 'gemini-2.5-flash',
          }),
        extractTask: () => Promise.reject(new Error('Not used')),
      };

      const multiContactApp = createApp({
        orchestrator: mockMultiContactOrchestrator as unknown as GeminiOrchestrator,
        taskStore,
      });

      const res = await inProcessApp(multiContactApp)
        .post('/api/memos')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          content: 'Short memo with Dr. Smith tomorrow at 10:00',
        });

      expect(res.status).toBe(200);
      const decrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        res.body.task.encryptedPayload,
        testKey,
      );

      const contactMatches = decrypted.summary.match(/• 👤 Contact:[^\r\n]*/g);
      expect(contactMatches).toHaveLength(1);
      expect(decrypted.scheduledTime).toBeDefined();
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
        .set('x-oscar-encryption-key', testKeyBase64)
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

    it('returns 400 when X-Oscar-Encryption-Key header is missing in non-development mode', async () => {
      const res = await inProcessApp(app)
        .post('/api/memos')
        .send({ content: 'Valid memo content without key' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid encryption key');
      expect(res.body.code).toBe('INVALID_ENCRYPTION_KEY');
    });

    it('returns 400 when X-Oscar-Encryption-Key header is malformed', async () => {
      const res = await inProcessApp(app)
        .post('/api/memos')
        .set('x-oscar-encryption-key', 'not-a-valid-32-byte-key')
        .send({ content: 'Valid memo content with bad key' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid encryption key');
      expect(res.body.code).toBe('INVALID_ENCRYPTION_KEY');
    });

    it('zeros key buffer in finally even when EncryptionService.encrypt throws', async () => {
      const encryptSpy = vi
        .spyOn(EncryptionService, 'encrypt')
        .mockRejectedValueOnce(new Error('Simulated WebCrypto failure'));
      const zeroKeySpy = vi.spyOn(EncryptionService, 'zeroKey');

      const res = await inProcessApp(app)
        .post('/api/memos')
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({ content: 'Valid memo content for zeroKey finally test' });

      expect(res.status).toBe(500);
      expect(zeroKeySpy).toHaveBeenCalledTimes(1);

      encryptSpy.mockRestore();
      zeroKeySpy.mockRestore();
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
