import { describe, it, expect } from 'vitest';
import {
  validateContract,
  MemoInputSchema,
  TaskEntitySchema,
  CreateTaskInputSchema,
  UpdateTaskInputSchema,
  FirestoreTimestampSchema,
  HealthResponseSchema,
} from '@oscar/shared';

describe('Shared Domain Contracts Suite', () => {
  const validId = 'task_001_valid_entity_id_1234';
  const validMemoId = 'memo_001_valid_entity_id_1234';
  const validUserId = 'usr_001_valid_entity_id_12345';

  describe('validateContract', () => {
    it('returns success with parsed data for valid MemoInput', () => {
      const result = validateContract(MemoInputSchema, {
        content: 'Prepare quarterly financial summary',
        title: 'Q4 Summary',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe('Prepare quarterly financial summary');
        expect(result.data.title).toBe('Q4 Summary');
      }
    });

    it('returns structured ZodError on validation failure', () => {
      const result = validateContract(MemoInputSchema, { content: '' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe('TaskEntitySchema', () => {
    it('validates complete encrypted task entities and rejects plaintext leakage in IDs', () => {
      const validEntity = {
        id: validId,
        memoId: validMemoId,
        userId: validUserId,
        encryptedPayload: {
          ciphertext: 'base64Ciphertext==',
          iv: 'base64Iv==',
          authTag: 'base64AuthTag==',
          keyId: 'v1',
        },
        category: 'WORK',
        priority: 'HIGH',
        status: 'DRAFT',
        scheduledDate: '2026-11-15',
        tags: ['operations'],
        provenance: 'GEMINI_FLASH',
        modelVersion: 'gemini-2.5-flash-001',
        createdAt: '2026-11-15T12:00:00.000Z',
        updatedAt: new Date('2026-11-15T12:00:00.000Z'),
      };

      const parsed = TaskEntitySchema.safeParse(validEntity);
      expect(parsed.success).toBe(true);

      const invalidId = TaskEntitySchema.safeParse({ ...validEntity, id: 'short' });
      expect(invalidId.success).toBe(false);
    });
  });

  describe('FirestoreTimestampSchema', () => {
    it('normalizes ISO strings, Date instances, and Firestore {seconds, nanoseconds} objects', () => {
      const fromIso = FirestoreTimestampSchema.parse('2026-11-15T12:00:00.000Z');
      expect(fromIso).toBe('2026-11-15T12:00:00.000Z');

      const fromDate = FirestoreTimestampSchema.parse(new Date('2026-11-15T12:00:00.000Z'));
      expect(fromDate).toBe('2026-11-15T12:00:00.000Z');

      const fromFirestore = FirestoreTimestampSchema.parse({ seconds: 1700000000, nanoseconds: 0 });
      expect(fromFirestore).toBe(new Date(1700000000 * 1000).toISOString());
    });
  });

  describe('API Input & Health Contracts', () => {
    it('applies defaults on CreateTaskInputSchema and validates partial UpdateTaskInputSchema', () => {
      const created = CreateTaskInputSchema.parse({ title: 'Review security audit' });
      expect(created.category).toBe('OTHER');
      expect(created.priority).toBe('MEDIUM');
      expect(created.status).toBe('DRAFT');
      expect(created.scheduledDate).toBeNull();
      expect(created.tags).toEqual([]);

      const updated = UpdateTaskInputSchema.parse({ status: 'COMPLETED' });
      expect(updated.status).toBe('COMPLETED');
    });

    it('validates HealthResponseSchema', () => {
      expect(
        HealthResponseSchema.safeParse({ status: 'ok', timestamp: '2026-11-15T12:00:00.000Z' })
          .success,
      ).toBe(true);
      expect(
        HealthResponseSchema.safeParse({ status: 'error', timestamp: '2026-11-15T12:00:00.000Z' })
          .success,
      ).toBe(false);
    });
  });
});
