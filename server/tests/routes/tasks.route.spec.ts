import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { TaskStore } from '../../src/store/TaskStore.js';
import { EncryptionService } from '../../src/security/EncryptionService.js';
import { DecryptedTaskPayload } from '../../src/types/contracts.js';

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
      const res = await request(app).get('/api/tasks');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('returns all persisted tasks in descending creation order', async () => {
      // Create two memos to populate store
      await request(app).post('/api/memos').send({ content: 'Task number one for team standup' });

      await request(app)
        .post('/api/memos')
        .send({ content: 'Task number two for client delivery' });

      const res = await request(app).get('/api/tasks');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });
  });

  describe('POST /api/tasks (Manual Task Creation)', () => {
    it('validates input, encrypts payload, and creates TaskEntity returning 201', async () => {
      const res = await request(app)
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
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^task_/);
      expect(res.body.category).toBe('WORK');
      expect(res.body.priority).toBe('HIGH');
      expect(res.body.status).toBe('DRAFT');

      const decrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        res.body.encryptedPayload,
        testKey,
      );
      expect(decrypted.title).toBe('Manual Security Review');
      expect(decrypted.subtasks.length).toBe(2);
    });

    it('rejects manual task creation with invalid data returning 400', async () => {
      const res = await request(app).post('/api/tasks').send({
        title: 'No', // shorter than 3 characters min bound
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });
  });

  describe('PATCH /api/tasks/:id', () => {
    it('updates status of an existing task and returns 200', async () => {
      const createRes = await request(app).post('/api/tasks').send({
        title: 'Deploy Production Hotfix',
        summary: 'Review and promote hotfix release safely',
      });

      const taskId = createRes.body.id;

      const patchRes = await request(app)
        .patch(`/api/tasks/${taskId}`)
        .send({
          status: 'COMPLETED',
          priority: 'URGENT',
          category: 'FINANCE',
          scheduledDate: '2026-12-01T10:00:00.000Z',
          tags: ['updated-tag'],
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.status).toBe('COMPLETED');
      expect(patchRes.body.priority).toBe('URGENT');
      expect(patchRes.body.category).toBe('FINANCE');
      expect(patchRes.body.scheduledDate).toBe('2026-12-01T10:00:00.000Z');
      expect(patchRes.body.tags).toContain('updated-tag');

      // Verify in store
      const updated = taskStore.getTaskById(taskId);
      expect(updated?.status).toBe('COMPLETED');
      expect(updated?.priority).toBe('URGENT');
      expect(updated?.category).toBe('FINANCE');
    });

    it('updates sensitive fields (title, summary, subtasks) by re-encrypting payload', async () => {
      const createRes = await request(app)
        .post('/api/tasks')
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          title: 'Initial Title',
          summary: 'Initial Summary',
          subtasks: [{ title: 'Subtask A', completed: false }],
        });

      const taskId = createRes.body.id;

      const patchRes = await request(app)
        .patch(`/api/tasks/${taskId}`)
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          title: 'Updated Confidential Title',
          summary: 'Updated Confidential Summary with more detail',
          subtasks: [{ title: 'Updated Subtask Item', completed: true }],
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
    });

    it('returns 404 when attempting to update non-existent task', async () => {
      const res = await request(app)
        .patch('/api/tasks/task_non_existent_12345')
        .send({ status: 'COMPLETED' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Task not found');
    });

    it('forwards error when updating sensitive fields fails decryption', async () => {
      const createRes = await request(app)
        .post('/api/tasks')
        .set('x-oscar-encryption-key', testKeyBase64)
        .send({
          title: 'Task to Fail Patch',
          summary: 'Summary to Fail Patch',
        });

      const taskId = createRes.body.id;
      const mismatchedKey = EncryptionService.generateKey();
      const mismatchedKeyBase64 = Buffer.from(mismatchedKey).toString('base64');

      const patchRes = await request(app)
        .patch(`/api/tasks/${taskId}`)
        .set('x-oscar-encryption-key', mismatchedKeyBase64)
        .send({
          title: 'Attempted Title Update with Wrong Key',
        });

      expect(patchRes.status).toBe(500);
      expect(patchRes.body.error).toBe('Internal server error');
    });
  });

  describe('DELETE /api/tasks/:id', () => {
    it('deletes an existing task and returns 200 with confirmation', async () => {
      const createRes = await request(app).post('/api/tasks').send({
        title: 'Temporary Task to Delete',
        summary: 'This task will be removed shortly',
      });

      const taskId = createRes.body.id;

      const deleteRes = await request(app).delete(`/api/tasks/${taskId}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);
      expect(deleteRes.body.id).toBe(taskId);

      // Verify removal from store
      expect(taskStore.getTaskById(taskId)).toBeUndefined();
    });

    it('returns 404 when attempting to delete non-existent task', async () => {
      const res = await request(app).delete('/api/tasks/task_does_not_exist_9999');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Task not found');
    });
  });

  describe('TaskStore Unit Operations', () => {
    it('returns undefined when updating a non-existent task', () => {
      const res = taskStore.updateTask('non_existent', { status: 'COMPLETED' });
      expect(res).toBeUndefined();
    });
  });
});
