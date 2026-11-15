import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  DecryptionError,
  EncryptionService,
  InvalidKeyError,
} from '../server/src/security/EncryptionService.js';
import {
  COLLECTION_MEMOS,
  COLLECTION_PRIVACY_AUDIT_LOGS,
  COLLECTION_TASKS,
  FirestoreTaskStore,
} from '../server/src/store/FirestoreTaskStore.js';
import {
  EncryptedPayload,
  MemoEntity,
  PrivacyAuditLog,
  TaskEntity,
  TaskEntitySchema,
} from '@oscar/shared';

interface CapturingMockDocRef {
  id: string;
  get: () => Promise<{ id: string; exists: boolean; data: () => unknown }>;
  set: (data: unknown) => Promise<void>;
  delete: () => Promise<void>;
}

function createCapturingMockFirestore() {
  const collections = new Map<string, Map<string, unknown>>([
    [COLLECTION_MEMOS, new Map()],
    [COLLECTION_TASKS, new Map()],
    [COLLECTION_PRIVACY_AUDIT_LOGS, new Map()],
  ]);

  const getCol = (name: string) => {
    let col = collections.get(name);
    if (!col) {
      col = new Map();
      collections.set(name, col);
    }
    return col;
  };

  const docRef = (colName: string, docId: string): CapturingMockDocRef => ({
    id: docId,
    get: async () => {
      const val = getCol(colName).get(docId);
      return {
        id: docId,
        exists: val !== undefined,
        data: () => (val !== undefined ? JSON.parse(JSON.stringify(val)) : undefined),
      };
    },
    set: async (data: unknown) => {
      getCol(colName).set(docId, JSON.parse(JSON.stringify(data)));
    },
    delete: async () => {
      getCol(colName).delete(docId);
    },
  });

  const batchOps: Array<() => Promise<void>> = [];

  const firestore = {
    collection: (name: string) => ({
      doc: (id: string) => docRef(name, id),
      get: async () => {
        const docs = Array.from(getCol(name).entries()).map(([id, data]) => ({
          ref: docRef(name, id),
          data: () => JSON.parse(JSON.stringify(data)),
        }));
        return {
          empty: docs.length === 0,
          docs,
          forEach: (fn: (doc: { ref: CapturingMockDocRef; data: () => unknown }) => void) => {
            docs.forEach(fn);
          },
        };
      },
    }),
    batch: () => ({
      set: (ref: CapturingMockDocRef, data: unknown) => {
        batchOps.push(() => ref.set(data));
      },
      delete: (ref: CapturingMockDocRef) => {
        batchOps.push(() => ref.delete());
      },
      commit: async () => {
        while (batchOps.length > 0) {
          const op = batchOps.shift();
          if (op) await op();
        }
      },
    }),
  };

  return { collections, firestore: firestore as unknown as Firestore };
}

function flipFirstBitBase64(b64: string): string {
  const bytes = Buffer.from(b64, 'base64');
  bytes[0] = bytes[0] ^ 0x01;
  return bytes.toString('base64');
}

describe('Adversarial Holdout — EncryptionService & Zero-Plaintext-at-Rest Storage', () => {
  describe('AES-256-GCM integrity & tampering rejection', () => {
    it('rejects single-bit ciphertext tampering with DecryptionError', async () => {
      const key = EncryptionService.generateKey();
      const payload = await EncryptionService.encrypt({ secret: 'Anna Nowak-Kowalska' }, key);

      const tampered: EncryptedPayload = {
        ...payload,
        ciphertext: flipFirstBitBase64(payload.ciphertext),
      };

      await expect(EncryptionService.decrypt(tampered, key)).rejects.toThrow(DecryptionError);
    });

    it('rejects authTag tampering with DecryptionError', async () => {
      const key = EncryptionService.generateKey();
      const payload = await EncryptionService.encrypt({ amount: '15000 EUR' }, key);

      const tampered: EncryptedPayload = {
        ...payload,
        authTag: flipFirstBitBase64(payload.authTag),
      };

      await expect(EncryptionService.decrypt(tampered, key)).rejects.toThrow(DecryptionError);
    });

    it('rejects IV tampering with DecryptionError', async () => {
      const key = EncryptionService.generateKey();
      const payload = await EncryptionService.encrypt({ location: 'Berlin' }, key);

      const tampered: EncryptedPayload = {
        ...payload,
        iv: flipFirstBitBase64(payload.iv),
      };

      await expect(EncryptionService.decrypt(tampered, key)).rejects.toThrow(DecryptionError);
    });

    it('rejects wrong-key decryption with DecryptionError', async () => {
      const keyA = EncryptionService.generateKey();
      const keyB = EncryptionService.generateKey();
      const payload = await EncryptionService.encrypt({ note: 'Confidential memo' }, keyA);

      await expect(EncryptionService.decrypt(payload, keyB)).rejects.toThrow(DecryptionError);
    });

    it('rejects invalid key byte lengths and malformed string keys with InvalidKeyError', async () => {
      const invalidByteLengths = [0, 16, 31, 33];
      for (const len of invalidByteLengths) {
        await expect(
          EncryptionService.encrypt({ ok: true }, new Uint8Array(len)),
        ).rejects.toThrow(InvalidKeyError);
      }

      const invalidStringKeys = [
        '',
        'not-valid-key',
        'a'.repeat(63),
        'g'.repeat(64),
        Buffer.alloc(16, 0xaa).toString('base64'),
      ];
      for (const badKey of invalidStringKeys) {
        await expect(EncryptionService.encrypt({ ok: true }, badKey)).rejects.toThrow(
          InvalidKeyError,
        );
      }
    });

    it('zeroes key buffers via zeroKey and withSessionKey even when inner callback throws', async () => {
      const key = EncryptionService.generateKey();
      key.fill(0xab);
      EncryptionService.zeroKey(key);
      expect(Array.from(key).every((b) => b === 0)).toBe(true);

      const sessionKey = EncryptionService.generateKey();
      sessionKey.fill(0xcd);

      await expect(
        EncryptionService.withSessionKey(sessionKey, async (k) => {
          expect(k.some((b) => b !== 0)).toBe(true);
          throw new Error('Simulated failure during session operation');
        }),
      ).rejects.toThrow('Simulated failure during session operation');

      expect(Array.from(sessionKey).every((b) => b === 0)).toBe(true);
    });
  });

  describe('Zero-Plaintext-at-Rest schema & Firestore persistence enforcement', () => {
    it('TaskEntitySchema strips outer plaintext PII and task content fields', async () => {
      const key = EncryptionService.generateKey();
      const encryptedPayload = await EncryptionService.encrypt(
        {
          title: 'Meet Anna Nowak-Kowalska',
          summary: 'Discuss contract in Berlin for 5000 EUR',
          subtasks: [{ title: 'Prepare contract', completed: false }],
          location: 'Berlin',
          contactPerson: 'Anna Nowak-Kowalska',
          amount: '5000 EUR',
        },
        key,
      );

      const dirtyCandidate = {
        id: 'task_00000000000000000001',
        memoId: 'memo_00000000000000000001',
        userId: 'usr_session_default_01',
        encryptedPayload,
        category: 'WORK',
        priority: 'HIGH',
        status: 'DRAFT',
        scheduledDate: null,
        tags: ['contract'],
        provenance: 'DETERMINISTIC_FALLBACK',
        modelVersion: 'rule-based-v1',
        createdAt: '2026-11-15T10:00:00.000Z',
        updatedAt: '2026-11-15T10:00:00.000Z',
        location: 'Berlin',
        contactPerson: 'Anna Nowak-Kowalska',
        amount: '5000 EUR',
        title: 'Meet Anna Nowak-Kowalska',
        summary: 'Discuss contract in Berlin',
        subtasks: [{ title: 'Prepare contract', completed: false }],
      };

      const parsed = TaskEntitySchema.parse(dirtyCandidate) as Record<string, unknown>;

      expect('location' in parsed).toBe(false);
      expect('contactPerson' in parsed).toBe(false);
      expect('amount' in parsed).toBe(false);
      expect('title' in parsed).toBe(false);
      expect('summary' in parsed).toBe(false);
      expect('subtasks' in parsed).toBe(false);
      expect(parsed.encryptedPayload).toEqual(encryptedPayload);
    });

    it('FirestoreTaskStore addTask, updateTask, and commitBatch strip outer PII and sanitizedContentPreview at rest', async () => {
      const key = EncryptionService.generateKey();
      const taskCipher = await EncryptionService.encrypt(
        {
          title: 'Wire 2500 EUR to Hans-Jürgen Müller-Lüdenscheidt',
          summary: 'Meeting in München',
          subtasks: [{ title: 'Verify IBAN', completed: false }],
          location: 'München',
          contactPerson: 'Hans-Jürgen Müller-Lüdenscheidt',
          amount: '2500 EUR',
        },
        key,
      );
      const memoCipher = await EncryptionService.encrypt(
        { rawContent: 'Raw confidential memo content', timestamp: '2026-11-15T10:00:00.000Z' },
        key,
      );

      const { collections, firestore } = createCapturingMockFirestore();
      const store = new FirestoreTaskStore({ firestore });

      const leakyTask = {
        id: 'task_00000000000000000010',
        memoId: 'memo_00000000000000000010',
        userId: 'usr_session_default_01',
        encryptedPayload: taskCipher,
        category: 'FINANCE',
        priority: 'HIGH',
        status: 'DRAFT',
        scheduledDate: null,
        tags: ['finance'],
        provenance: 'DETERMINISTIC_FALLBACK',
        modelVersion: 'rule-based-v1',
        createdAt: '2026-11-15T10:00:00.000Z',
        updatedAt: '2026-11-15T10:00:00.000Z',
        location: 'München',
        contactPerson: 'Hans-Jürgen Müller-Lüdenscheidt',
        amount: '2500 EUR',
      } as TaskEntity & Record<string, unknown>;

      const leakyMemo: MemoEntity = {
        id: 'memo_00000000000000000010',
        userId: 'usr_session_default_01',
        encryptedPayload: memoCipher,
        sanitizedContentPreview: 'Should be stripped before persistence',
        hasPII: true,
        maskedFieldsCount: 3,
        createdAt: '2026-11-15T10:00:00.000Z',
        updatedAt: '2026-11-15T10:00:00.000Z',
      };

      const auditLog: PrivacyAuditLog = {
        id: 'audit_00000000000000000010',
        userId: 'usr_session_default_01',
        action: 'MASK_SUCCESS',
        detectedTypes: ['PERSON', 'ADDRESS', 'AMOUNT_MONEY'],
        tokenCount: 3,
        riskLevel: 'HIGH',
        durationMs: 3,
        timestamp: '2026-11-15T10:00:00.000Z',
      };

      await store.commitBatch(leakyMemo, leakyTask, auditLog);

      const storedMemo = collections.get(COLLECTION_MEMOS)?.get(leakyMemo.id) as Record<
        string,
        unknown
      >;
      const storedTask = collections.get(COLLECTION_TASKS)?.get(leakyTask.id) as Record<
        string,
        unknown
      >;

      expect(storedMemo).toBeDefined();
      expect('sanitizedContentPreview' in storedMemo).toBe(false);
      expect(storedMemo.encryptedPayload).toEqual(memoCipher);

      expect(storedTask).toBeDefined();
      expect('location' in storedTask).toBe(false);
      expect('contactPerson' in storedTask).toBe(false);
      expect('amount' in storedTask).toBe(false);
      expect(storedTask.encryptedPayload).toEqual(taskCipher);

      const createdTask = {
        ...leakyTask,
        id: 'task_00000000000000000011',
      } as TaskEntity & Record<string, unknown>;
      await store.addTask(createdTask);

      const storedCreatedTask = collections.get(COLLECTION_TASKS)?.get(createdTask.id) as Record<
        string,
        unknown
      >;
      expect('location' in storedCreatedTask).toBe(false);
      expect('contactPerson' in storedCreatedTask).toBe(false);
      expect('amount' in storedCreatedTask).toBe(false);
      expect(storedCreatedTask.encryptedPayload).toEqual(taskCipher);

      await store.updateTask(createdTask.id, {
        status: 'PENDING',
        location: 'Warsaw',
        contactPerson: 'Alice-Marie St. Clair',
        amount: '999 EUR',
      } as Partial<TaskEntity>);

      const storedUpdatedTask = collections.get(COLLECTION_TASKS)?.get(createdTask.id) as Record<
        string,
        unknown
      >;
      expect(storedUpdatedTask.status).toBe('PENDING');
      expect('location' in storedUpdatedTask).toBe(false);
      expect('contactPerson' in storedUpdatedTask).toBe(false);
      expect('amount' in storedUpdatedTask).toBe(false);
      expect(storedUpdatedTask.encryptedPayload).toEqual(taskCipher);
    });
  });
});
