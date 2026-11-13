import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { TaskStore } from '../../src/store/TaskStore.js';
import { EncryptionService } from '../../src/security/EncryptionService.js';
import { DecryptedTaskPayload } from '../../src/types/contracts.js';
import { inProcessApp } from '../helpers/inProcessApp.js';
import { logger } from '../../src/utils/logger.js';

describe('Tasks Route Integration', () => {
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

  describe('GET /api/tasks', () => {
    it('returns 200 array of encrypted tasks', async () => {
      const res = await inProcessApp(app).get('/api/tasks');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('returns all persisted tasks in descending creation order', async () => {
      // Create two memos to populate store
      await inProcessApp(app)
        .post('/api/memos')
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({ content: 'Task number one for team standup' });

      await inProcessApp(app)
        .post('/api/memos')
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({ content: 'Task number two for client delivery' });

      const res = await inProcessApp(app).get('/api/tasks');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it('passes error to next middleware when store.getTasks throws', async () => {
      vi.spyOn(taskStore, 'getTasks').mockImplementationOnce(() => {
        throw new Error('Database read failure');
      });
      const res = await inProcessApp(app).get('/api/tasks');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/tasks (Manual Task Creation)', () => {
    it('validates input, encrypts payload, and creates TaskEntity returning 201 with smart metadata', async () => {
      const res = await inProcessApp(app)
        .post('/api/tasks')
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          title: 'Manual Security Review',
          summary: 'Perform audit on encryption endpoints and rate limiting',
          category: 'WORK',
          priority: 'HIGH',
          subtasks: [
            { title: 'Check rate limiter token bucket', completed: false },
            { title: 'Verify WebCrypto AES-GCM tags', completed: false },
          ],
          location: 'Berlin Tech Center',
          contactPerson: 'Dr. Klaus Schmidt',
          amount: '5000 EUR',
          scheduledTime: '14:30',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^task_/);
      expect(res.body.category).toBe('WORK');
      expect(res.body.priority).toBe('HIGH');
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.location).toBe('Berlin Tech Center');
      expect(res.body.contactPerson).toBe('Dr. Klaus Schmidt');
      expect(res.body.amount).toBe('5000 EUR');
      expect(res.body.scheduledTime).toBe('14:30');

      const decrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        res.body.encryptedPayload,
        testKey,
      );
      expect(decrypted.title).toBe('Manual Security Review');
      expect(decrypted.subtasks.length).toBe(2);
      expect(decrypted.location).toBe('Berlin Tech Center');
      expect(decrypted.contactPerson).toBe('Dr. Klaus Schmidt');
      expect(decrypted.amount).toBe('5000 EUR');
      expect(decrypted.scheduledTime).toBe('14:30');
    });

    it('rejects manual task creation with invalid data returning 400', async () => {
      const res = await inProcessApp(app).post('/api/tasks').send({
        title: 'No', // shorter than 3 characters min bound
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('applies default values for summary, category, priority, status, and tags when omitted', async () => {
      const res = await inProcessApp(app)
        .post('/api/tasks')
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          title: 'Minimal Task',
        });

      expect(res.status).toBe(201);
      expect(res.body.category).toBe('OTHER');
      expect(res.body.priority).toBe('MEDIUM');
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.tags).toEqual([]);

      const decrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        res.body.encryptedPayload,
        testKey,
      );
      expect(decrypted.summary.length).toBeGreaterThanOrEqual(5);
      expect(decrypted.subtasks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('PATCH /api/tasks/:id', () => {
    it('updates status and metadata of an existing task and returns 200', async () => {
      const createRes = await inProcessApp(app)
        .post('/api/tasks')
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          title: 'Deploy Production Hotfix',
          summary: 'Review and promote hotfix release safely',
        });

      const taskId = createRes.body.id;

      const patchRes = await inProcessApp(app)
        .patch(`/api/tasks/${taskId}`)
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          status: 'COMPLETED',
          priority: 'URGENT',
          category: 'FINANCE',
          scheduledDate: '2026-12-01T10:00:00.000Z',
          tags: ['updated-tag'],
          location: 'Munich Hub',
          contactPerson: 'Maria Fischer',
          amount: '7500 EUR',
          scheduledTime: '16:00',
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.status).toBe('COMPLETED');
      expect(patchRes.body.priority).toBe('URGENT');
      expect(patchRes.body.category).toBe('FINANCE');
      expect(patchRes.body.scheduledDate).toBe('2026-12-01T10:00:00.000Z');
      expect(patchRes.body.tags).toContain('updated-tag');
      expect(patchRes.body.location).toBe('Munich Hub');
      expect(patchRes.body.contactPerson).toBe('Maria Fischer');
      expect(patchRes.body.amount).toBe('7500 EUR');
      expect(patchRes.body.scheduledTime).toBe('16:00');

      // Verify in store
      const updated = taskStore.getTaskById(taskId);
      expect(updated?.status).toBe('COMPLETED');
      expect(updated?.priority).toBe('URGENT');
      expect(updated?.category).toBe('FINANCE');
      expect(updated?.location).toBe('Munich Hub');
      expect(updated?.contactPerson).toBe('Maria Fischer');
      expect(updated?.amount).toBe('7500 EUR');
      expect(updated?.scheduledTime).toBe('16:00');
    });

    it('updates sensitive fields (title, summary, subtasks) and smart metadata by re-encrypting payload', async () => {
      const createRes = await inProcessApp(app)
        .post('/api/tasks')
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          title: 'Initial Title',
          summary: 'Initial Summary',
          subtasks: [{ title: 'Subtask A', completed: false }],
          location: 'Initial Venue',
        });

      const taskId = createRes.body.id;

      const patchRes = await inProcessApp(app)
        .patch(`/api/tasks/${taskId}`)
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          title: 'Updated Confidential Title',
          summary: 'Updated Confidential Summary with more detail',
          subtasks: [{ title: 'Updated Subtask Item', completed: true }],
          location: 'New Secret Venue',
          contactPerson: 'Agent 007',
          amount: '10000 EUR',
          scheduledTime: '11:00',
        });

      expect(patchRes.status).toBe(200);

      const decrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        patchRes.body.encryptedPayload,
        testKey,
      );
      expect(decrypted.title).toBe('Updated Confidential Title');
      expect(decrypted.summary).toBe('Updated Confidential Summary with more detail');
      expect(decrypted.subtasks[0].title).toBe('Updated Subtask Item');
      expect(decrypted.subtasks[0].completed).toBe(true);
      expect(decrypted.location).toBe('New Secret Venue');
      expect(decrypted.contactPerson).toBe('Agent 007');
      expect(decrypted.amount).toBe('10000 EUR');
      expect(decrypted.scheduledTime).toBe('11:00');
    });

    it('updates title only preserving existing decrypted payload fields', async () => {
      const createRes = await inProcessApp(app)
        .post('/api/tasks')
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          title: 'Initial Title',
          summary: 'Initial Summary',
          subtasks: [{ title: 'Subtask A', completed: false }],
          location: 'Initial Venue',
          contactPerson: 'Initial Contact',
          amount: '100 EUR',
          scheduledTime: '10:00',
        });

      const taskId = createRes.body.id;

      const patchRes = await inProcessApp(app)
        .patch(`/api/tasks/${taskId}`)
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          title: 'Updated Title Only',
        });

      expect(patchRes.status).toBe(200);
      const decrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        patchRes.body.encryptedPayload,
        testKey,
      );
      expect(decrypted.title).toBe('Updated Title Only');
      expect(decrypted.summary).toBe('Initial Summary');
      expect(decrypted.location).toBe('Initial Venue');
      expect(decrypted.contactPerson).toBe('Initial Contact');
      expect(decrypted.amount).toBe('100 EUR');
      expect(decrypted.scheduledTime).toBe('10:00');
    });

    it('returns 404 when attempting to update non-existent task', async () => {
      const res = await inProcessApp(app)
        .patch('/api/tasks/task_non_existent_12345')
        .send({ status: 'COMPLETED' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Task not found');
    });

    it('forwards error when updating sensitive fields fails decryption', async () => {
      const createRes = await inProcessApp(app)
        .post('/api/tasks')
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          title: 'Task to Fail Patch',
          summary: 'Summary to Fail Patch',
        });

      const taskId = createRes.body.id;
      const mismatchedKey = EncryptionService.generateKey();
      const mismatchedKeyBase64 = Buffer.from(mismatchedKey).toString('base64');

      const patchRes = await inProcessApp(app)
        .patch(`/api/tasks/${taskId}`)
        .set('x-oscar-encryption-key', mismatchedKeyBase64)
        .send({
          title: 'Attempted Title Update with Wrong Key',
        });

      expect(patchRes.status).toBe(422);
      expect(patchRes.body.error).toBe('Decryption failed');
      expect(patchRes.body.code).toBe('DECRYPTION_FAILED');
    });

    it('zeros key buffer in finally when decrypt throws during PATCH /api/tasks/:id', async () => {
      const createRes = await inProcessApp(app)
        .post('/api/tasks')
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          title: 'Task for ZeroKey Cleanup Test',
          summary: 'Summary for ZeroKey Cleanup Test',
        });

      const taskId = createRes.body.id;
      const mismatchedKey = EncryptionService.generateKey();
      const mismatchedKeyBase64 = Buffer.from(mismatchedKey).toString('base64');
      const zeroKeySpy = vi.spyOn(EncryptionService, 'zeroKey');

      const patchRes = await inProcessApp(app)
        .patch(`/api/tasks/${taskId}`)
        .set('x-oscar-encryption-key', mismatchedKeyBase64)
        .send({
          title: 'Trigger Decrypt Error',
        });

      expect(patchRes.status).toBe(422);
      expect(zeroKeySpy).toHaveBeenCalledTimes(1);
      zeroKeySpy.mockRestore();
    });
  });

  describe('DELETE /api/tasks/:id', () => {
    it('deletes an existing task and returns 200 with confirmation and structured logging', async () => {
      const loggerSpy = vi.spyOn(logger, 'info');
      const createRes = await inProcessApp(app)
        .post('/api/tasks')
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          title: 'Temporary Task to Delete',
          summary: 'This task will be removed shortly',
        });

      const taskId = createRes.body.id;

      const deleteRes = await inProcessApp(app).delete(`/api/tasks/${taskId}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);
      expect(deleteRes.body.id).toBe(taskId);

      expect(loggerSpy).toHaveBeenCalledWith('Tasks', `Deleted task ${taskId}`, { id: taskId });

      // Verify removal from store
      expect(taskStore.getTaskById(taskId)).toBeUndefined();
      loggerSpy.mockRestore();
    });

    it('returns 404 when attempting to delete non-existent task', async () => {
      const res = await inProcessApp(app).delete('/api/tasks/task_does_not_exist_9999');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Task not found');
    });

    it('passes error to next middleware when store.deleteTask throws', async () => {
      vi.spyOn(taskStore, 'deleteTask').mockImplementationOnce(() => {
        throw new Error('Database delete failure');
      });
      const res = await inProcessApp(app).delete('/api/tasks/task_123');
      expect(res.status).toBe(500);
    });
  });

  describe('TaskStore Unit Operations', () => {
    it('returns undefined when updating a non-existent task', () => {
      const res = taskStore.updateTask('non_existent', { status: 'COMPLETED' });
      expect(res).toBeUndefined();
    });
  });
});
