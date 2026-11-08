import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { getApps, deleteApp } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import {
  FirestoreTaskStore,
  COLLECTION_MEMOS,
  COLLECTION_TASKS,
  COLLECTION_PRIVACY_AUDIT_LOGS,
} from '../../src/store/FirestoreTaskStore.js';
import {
  TaskEntity,
  MemoEntity,
  PrivacyAuditLog,
  EncryptedPayload,
} from '../../src/types/contracts.js';
import { createApp } from '../../src/app.js';
import { inProcessApp } from '../helpers/inProcessApp.js';
import { EncryptionService } from '../../src/security/EncryptionService.js';
import { GeminiOrchestrator } from '../../src/agent/GeminiOrchestrator.js';

interface MockDocSnapshot<T = unknown> {
  id: string;
  exists: boolean;
  data: () => T | undefined;
  ref: MockDocRef<T>;
}

interface MockDocRef<T = unknown> {
  id: string;
  get: () => Promise<MockDocSnapshot<T>>;
  set: (data: T) => Promise<void>;
  delete: () => Promise<void>;
}

interface MockQuerySnapshot<T = unknown> {
  empty: boolean;
  docs: Array<{ ref: MockDocRef<T>; data: () => T }>;
  forEach: (fn: (doc: { ref: MockDocRef<T>; data: () => T }) => void) => void;
}

function createMockFirestore() {
  const store: Record<string, Map<string, unknown>> = {
    [COLLECTION_MEMOS]: new Map(),
    [COLLECTION_TASKS]: new Map(),
    [COLLECTION_PRIVACY_AUDIT_LOGS]: new Map(),
  };

  const getOrCreateCollection = (name: string) => {
    if (!store[name]) {
      store[name] = new Map();
    }
    return store[name];
  };

  const createDocRef = <T = unknown>(colName: string, docId: string): MockDocRef<T> => ({
    id: docId,
    get: async (): Promise<MockDocSnapshot<T>> => {
      const col = getOrCreateCollection(colName);
      const data = col.get(docId) as T | undefined;
      return {
        id: docId,
        exists: data !== undefined,
        data: () => (data !== undefined ? (JSON.parse(JSON.stringify(data)) as T) : undefined),
        ref: createDocRef<T>(colName, docId),
      };
    },
    set: async (data: T): Promise<void> => {
      const col = getOrCreateCollection(colName);
      col.set(docId, JSON.parse(JSON.stringify(data)));
    },
    delete: async (): Promise<void> => {
      const col = getOrCreateCollection(colName);
      col.delete(docId);
    },
  });

  const batchOps: Array<() => Promise<void>> = [];

  return {
    _store: store,
    collection: (name: string) => ({
      doc: (id: string) => createDocRef(name, id),
      get: async (): Promise<MockQuerySnapshot> => {
        const col = getOrCreateCollection(name);
        const docs = Array.from(col.entries()).map(([id, data]) => ({
          ref: createDocRef(name, id),
          data: () => JSON.parse(JSON.stringify(data)),
        }));
        return {
          empty: docs.length === 0,
          docs,
          forEach: (fn: (doc: { ref: MockDocRef; data: () => unknown }) => void) => {
            docs.forEach(fn);
          },
        };
      },
    }),
    batch: () => ({
      set: (docRef: MockDocRef, data: unknown) => {
        batchOps.push(async () => {
          await docRef.set(data);
        });
      },
      delete: (docRef: MockDocRef) => {
        batchOps.push(async () => {
          await docRef.delete();
        });
      },
      commit: async (): Promise<void> => {
        while (batchOps.length > 0) {
          const op = batchOps.shift();
          if (op) await op();
        }
      },
    }),
  };
}

describe('FirestoreTaskStore Enterprise Persistence Suite', () => {
  const dummyEncryptedPayload: EncryptedPayload = {
    ciphertext: 'dGVzdC1jaXBoZXJ0ZXh0',
    iv: 'dGVzdC1pdi0xMg==',
    authTag: 'dGVzdC1hdXRoLXRhZw==',
    keyId: 'v1',
  };

  const sampleTask: TaskEntity = {
    id: 'task_00000000000000000001',
    memoId: 'memo_00000000000000000001',
    userId: 'usr_session_default_01',
    encryptedPayload: dummyEncryptedPayload,
    category: 'WORK',
    priority: 'HIGH',
    status: 'DRAFT',
    scheduledDate: '2026-11-10T10:00:00.000Z',
    tags: ['audit', 'compliance'],
    provenance: 'DETERMINISTIC_FALLBACK',
    modelVersion: 'manual-entry-v1',
    createdAt: '2026-11-08T10:00:00.000Z',
    updatedAt: '2026-11-08T10:00:00.000Z',
  };

  const sampleMemo: MemoEntity = {
    id: 'memo_00000000000000000001',
    userId: 'usr_session_default_01',
    encryptedPayload: dummyEncryptedPayload,
    sanitizedContentPreview: 'Confidential brief review',
    hasPII: false,
    maskedFieldsCount: 0,
    createdAt: '2026-11-08T10:00:00.000Z',
    updatedAt: '2026-11-08T10:00:00.000Z',
  };

  const sampleAuditLog: PrivacyAuditLog = {
    id: 'audit_00000000000000000001',
    userId: 'usr_session_default_01',
    action: 'MASK_SUCCESS',
    detectedTypes: ['EMAIL'],
    tokenCount: 1,
    riskLevel: 'LOW',
    durationMs: 4,
    timestamp: '2026-11-08T10:00:00.000Z',
  };

  let mockFirestore: ReturnType<typeof createMockFirestore>;
  let store: FirestoreTaskStore;

  beforeEach(() => {
    mockFirestore = createMockFirestore();
    store = new FirestoreTaskStore({ firestore: mockFirestore as unknown as Firestore });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const apps = getApps();
    for (const app of apps) {
      await deleteApp(app);
    }
  });

  describe('CRUD & Document Lifecycle Operations', () => {
    it('persists and retrieves a single task by ID', async () => {
      await store.addTask(sampleTask);
      const fetched = await store.getTaskById(sampleTask.id);

      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(sampleTask.id);
      expect(fetched?.category).toBe('WORK');
      expect(fetched?.encryptedPayload.ciphertext).toBe(sampleTask.encryptedPayload.ciphertext);
    });

    it('returns undefined when querying a non-existent task ID', async () => {
      const fetched = await store.getTaskById('task_non_existent_999999');
      expect(fetched).toBeUndefined();
    });

    it('retrieves all tasks sorted by createdAt descending', async () => {
      const olderTask: TaskEntity = {
        ...sampleTask,
        id: 'task_00000000000000000002',
        createdAt: '2026-11-07T08:00:00.000Z',
      };
      const newerTask: TaskEntity = {
        ...sampleTask,
        id: 'task_00000000000000000003',
        createdAt: '2026-11-09T12:00:00.000Z',
      };

      await store.addTask(olderTask);
      await store.addTask(newerTask);
      await store.addTask(sampleTask);

      const tasks = await store.getTasks();
      expect(tasks).toHaveLength(3);
      expect(tasks[0].id).toBe(newerTask.id);
      expect(tasks[1].id).toBe(sampleTask.id);
      expect(tasks[2].id).toBe(olderTask.id);
    });

    it('returns empty array when no tasks exist', async () => {
      const tasks = await store.getTasks();
      expect(tasks).toEqual([]);
    });

    it('updates an existing task with partial properties and sets updatedAt', async () => {
      await store.addTask(sampleTask);

      const updated = await store.updateTask(sampleTask.id, {
        status: 'COMPLETED',
        priority: 'URGENT',
      });

      expect(updated).toBeDefined();
      expect(updated?.status).toBe('COMPLETED');
      expect(updated?.priority).toBe('URGENT');
      expect(updated?.category).toBe('WORK');
      expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(sampleTask.updatedAt).getTime(),
      );

      const refreshed = await store.getTaskById(sampleTask.id);
      expect(refreshed?.status).toBe('COMPLETED');
    });

    it('returns undefined when attempting to update a non-existent task', async () => {
      const updated = await store.updateTask('task_non_existent_000000', { status: 'COMPLETED' });
      expect(updated).toBeUndefined();
    });

    it('deletes an existing task and returns true', async () => {
      await store.addTask(sampleTask);

      const deleted = await store.deleteTask(sampleTask.id);
      expect(deleted).toBe(true);

      const checked = await store.getTaskById(sampleTask.id);
      expect(checked).toBeUndefined();
    });

    it('returns false when deleting a non-existent task', async () => {
      const deleted = await store.deleteTask('task_non_existent_111111');
      expect(deleted).toBe(false);
    });

    it('persists and retrieves memos sorted by createdAt descending', async () => {
      const olderMemo: MemoEntity = {
        ...sampleMemo,
        id: 'memo_00000000000000000002',
        createdAt: '2026-11-06T10:00:00.000Z',
      };
      const newerMemo: MemoEntity = {
        ...sampleMemo,
        id: 'memo_00000000000000000003',
        createdAt: '2026-11-09T15:00:00.000Z',
      };

      await store.addMemo(olderMemo);
      await store.addMemo(newerMemo);
      await store.addMemo(sampleMemo);

      const memos = await store.getMemos();
      expect(memos).toHaveLength(3);
      expect(memos[0].id).toBe(newerMemo.id);
      expect(memos[1].id).toBe(sampleMemo.id);
      expect(memos[2].id).toBe(olderMemo.id);
    });

    it('returns empty array when no memos exist', async () => {
      const memos = await store.getMemos();
      expect(memos).toEqual([]);
    });

    it('commits memo, task, and audit log atomically via commitBatch', async () => {
      await store.commitBatch(sampleMemo, sampleTask, sampleAuditLog);

      const memos = await store.getMemos();
      const tasks = await store.getTasks();
      const auditLogMap = mockFirestore._store[COLLECTION_PRIVACY_AUDIT_LOGS];

      expect(memos).toHaveLength(1);
      expect(memos[0].id).toBe(sampleMemo.id);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe(sampleTask.id);
      expect(auditLogMap.get(sampleAuditLog.id)).toBeDefined();
    });

    it('commits memo and task without auditLog when auditLog is omitted', async () => {
      await store.commitBatch(sampleMemo, sampleTask);

      const memos = await store.getMemos();
      const tasks = await store.getTasks();
      const auditLogMap = mockFirestore._store[COLLECTION_PRIVACY_AUDIT_LOGS];

      expect(memos).toHaveLength(1);
      expect(tasks).toHaveLength(1);
      expect(auditLogMap.size).toBe(0);
    });

    it('purges all documents across memos, tasks, and audit logs with clear()', async () => {
      await store.commitBatch(sampleMemo, sampleTask, sampleAuditLog);
      expect((await store.getTasks()).length).toBe(1);
      expect((await store.getMemos()).length).toBe(1);

      await store.clear();

      expect((await store.getTasks()).length).toBe(0);
      expect((await store.getMemos()).length).toBe(0);
      expect(mockFirestore._store[COLLECTION_PRIVACY_AUDIT_LOGS].size).toBe(0);
    });

    it('handles clear() gracefully when collections are already empty', async () => {
      await expect(store.clear()).resolves.toBeUndefined();
    });
  });

  describe('Constructor & Credentials Fallback Suite', () => {
    it('initializes with clientEmail and privateKey containing escaped newlines (\\n)', () => {
      const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const rawPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
      const escapedPem = rawPem.replace(/\n/g, '\\n');

      const certStore = new FirestoreTaskStore({
        projectId: 'oscar-cert-test-1',
        clientEmail: 'service@oscar-cert-test-1.iam.gserviceaccount.com',
        privateKey: escapedPem,
      });

      expect(certStore).toBeInstanceOf(FirestoreTaskStore);
    });

    it('initializes with clientEmail and privateKey containing literal newlines (\n)', () => {
      const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const rawPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

      const certStore = new FirestoreTaskStore({
        projectId: 'oscar-cert-test-2',
        clientEmail: 'service@oscar-cert-test-2.iam.gserviceaccount.com',
        privateKey: rawPem,
      });

      expect(certStore).toBeInstanceOf(FirestoreTaskStore);
    });

    it('initializes using FIRESTORE_EMULATOR_HOST environment configuration', () => {
      const originalEmu = process.env.FIRESTORE_EMULATOR_HOST;
      try {
        process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
        const emuStore = new FirestoreTaskStore({ projectId: 'oscar-emulator-test' });
        expect(emuStore).toBeInstanceOf(FirestoreTaskStore);
      } finally {
        if (originalEmu !== undefined) {
          process.env.FIRESTORE_EMULATOR_HOST = originalEmu;
        } else {
          delete process.env.FIRESTORE_EMULATOR_HOST;
        }
      }
    });

    it('initializes fallback projectId when neither cert nor emulator are configured', () => {
      const originalEmu = process.env.FIRESTORE_EMULATOR_HOST;
      const originalProjectId = process.env.FIREBASE_PROJECT_ID;
      try {
        delete process.env.FIRESTORE_EMULATOR_HOST;
        process.env.FIREBASE_PROJECT_ID = 'oscar-env-project';

        const fallbackStore = new FirestoreTaskStore();
        expect(fallbackStore).toBeInstanceOf(FirestoreTaskStore);
      } finally {
        if (originalEmu !== undefined) {
          process.env.FIRESTORE_EMULATOR_HOST = originalEmu;
        } else {
          delete process.env.FIRESTORE_EMULATOR_HOST;
        }
        if (originalProjectId !== undefined) {
          process.env.FIREBASE_PROJECT_ID = originalProjectId;
        } else {
          delete process.env.FIREBASE_PROJECT_ID;
        }
      }
    });

    it('reuses existing Firebase app when getApps() already has registered apps', () => {
      new FirestoreTaskStore({ projectId: 'oscar-existing-app-test' });
      expect(getApps().length).toBeGreaterThan(0);

      const reusedStore = new FirestoreTaskStore();
      expect(reusedStore).toBeInstanceOf(FirestoreTaskStore);
    });

    it('creates named app with cert credentials when an existing app already exists', () => {
      new FirestoreTaskStore({ projectId: 'oscar-first-app' });
      expect(getApps().length).toBeGreaterThan(0);

      const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const rawPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

      const certStore = new FirestoreTaskStore({
        projectId: 'oscar-second-cert-app',
        clientEmail: 'service@oscar-second-app.iam.gserviceaccount.com',
        privateKey: rawPem,
      });

      expect(certStore).toBeInstanceOf(FirestoreTaskStore);
    });

    it('creates named app with emulator when an existing app already exists', () => {
      new FirestoreTaskStore({ projectId: 'oscar-first-app-emu' });
      expect(getApps().length).toBeGreaterThan(0);

      const originalEmu = process.env.FIRESTORE_EMULATOR_HOST;
      try {
        process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
        const emuStore = new FirestoreTaskStore({ projectId: 'oscar-second-emu-app' });
        expect(emuStore).toBeInstanceOf(FirestoreTaskStore);
      } finally {
        if (originalEmu !== undefined) {
          process.env.FIRESTORE_EMULATOR_HOST = originalEmu;
        } else {
          delete process.env.FIRESTORE_EMULATOR_HOST;
        }
      }
    });

    it('creates named app with fallback projectId when an existing app already exists', () => {
      new FirestoreTaskStore({ projectId: 'oscar-first-app-fallback' });
      expect(getApps().length).toBeGreaterThan(0);

      const storeWithCustomProject = new FirestoreTaskStore({ projectId: 'oscar-second-custom-app' });
      expect(storeWithCustomProject).toBeInstanceOf(FirestoreTaskStore);
    });

    it('defaults projectId to oscar-local when neither options nor env are set', () => {
      const originalProjectId = process.env.FIREBASE_PROJECT_ID;
      try {
        delete process.env.FIREBASE_PROJECT_ID;
        const defaultLocalStore = new FirestoreTaskStore({ projectId: undefined });
        expect(defaultLocalStore).toBeInstanceOf(FirestoreTaskStore);
      } finally {
        if (originalProjectId !== undefined) {
          process.env.FIREBASE_PROJECT_ID = originalProjectId;
        } else {
          delete process.env.FIREBASE_PROJECT_ID;
        }
      }
    });
  });

  describe('Full Express HTTP Integration with FirestoreTaskStore', () => {
    const rawKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
      const orchestrator = new GeminiOrchestrator();
      app = createApp({
        taskStore: store,
        orchestrator,
      });
    });

    it('creates, lists, patches, and deletes a task via HTTP endpoints with Firestore persistence', async () => {
      // 1. POST /api/tasks
      const createRes = await inProcessApp(app)
        .post('/api/tasks')
        .set('X-Oscar-Encryption-Key', rawKeyHex)
        .send({
          title: 'Secure Firestore Task Execution',
          summary: 'Persist encrypted task entity in Google Cloud Firestore.',
          priority: 'URGENT',
          category: 'WORK',
          subtasks: [{ title: 'Implement writeBatch', completed: false }],
        });

      expect(createRes.status).toBe(201);
      const createdTask = createRes.body as TaskEntity;
      expect(createdTask.id).toBeDefined();

      // Verify Firestore stored document has encrypted payload
      const inFirestore = await store.getTaskById(createdTask.id);
      expect(inFirestore).toBeDefined();
      expect(inFirestore?.encryptedPayload.ciphertext).toBe(createdTask.encryptedPayload.ciphertext);

      // 2. GET /api/tasks
      const listRes = await inProcessApp(app).get('/api/tasks');
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(1);
      expect((listRes.body as TaskEntity[])[0].id).toBe(createdTask.id);

      // 3. PATCH /api/tasks/:id
      const patchRes = await inProcessApp(app)
        .patch(`/api/tasks/${createdTask.id}`)
        .set('X-Oscar-Encryption-Key', rawKeyHex)
        .send({
          status: 'COMPLETED',
          title: 'Updated Firestore Task Title',
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.status).toBe('COMPLETED');

      // Decrypt to verify updated title
      const keyBuffer = Buffer.from(rawKeyHex, 'hex');
      const decrypted = await EncryptionService.decrypt<{ title: string }>(
        patchRes.body.encryptedPayload,
        keyBuffer,
      );
      EncryptionService.zeroKey(keyBuffer);
      expect(decrypted.title).toBe('Updated Firestore Task Title');

      // 4. DELETE /api/tasks/:id
      const deleteRes = await inProcessApp(app).delete(`/api/tasks/${createdTask.id}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      // Verify removal from Firestore
      const afterDelete = await store.getTaskById(createdTask.id);
      expect(afterDelete).toBeUndefined();
    });

    it('submits a confidential memo and commits memo, task, and audit log atomically to Firestore', async () => {
      const memoContent = 'Urgent meeting with John Doe at john.doe@example.com regarding budget.';

      const memoRes = await inProcessApp(app)
        .post('/api/memos')
        .set('X-Oscar-Encryption-Key', rawKeyHex)
        .send({ content: memoContent });

      expect(memoRes.status).toBe(200);
      const { task, memo, piiStats } = memoRes.body;

      expect(task.id).toBeDefined();
      expect(memo.id).toBeDefined();
      expect(piiStats.detectedEntityCount).toBeGreaterThanOrEqual(1);

      // Verify persistence in Firestore
      const persistedTask = await store.getTaskById(task.id);
      const persistedMemos = await store.getMemos();
      const auditLogMap = mockFirestore._store[COLLECTION_PRIVACY_AUDIT_LOGS];

      expect(persistedTask).toBeDefined();
      expect(persistedMemos.some((m) => m.id === memo.id)).toBe(true);
      expect(auditLogMap.size).toBe(1);

      const auditLogEntry = Array.from(auditLogMap.values())[0] as PrivacyAuditLog;
      expect(auditLogEntry.action).toBe('MASK_SUCCESS');
      expect(auditLogEntry.detectedTypes).toContain('EMAIL');
    });

    it('initializes FirestoreTaskStore when FIREBASE_PROJECT_ID environment variable is set in createApp', () => {
      const originalProjectId = process.env.FIREBASE_PROJECT_ID;
      try {
        process.env.FIREBASE_PROJECT_ID = 'oscar-auto-firestore';
        const dynamicApp = createApp();
        expect(dynamicApp).toBeDefined();
      } finally {
        if (originalProjectId !== undefined) {
          process.env.FIREBASE_PROJECT_ID = originalProjectId;
        } else {
          delete process.env.FIREBASE_PROJECT_ID;
        }
      }
    });
  });
});
