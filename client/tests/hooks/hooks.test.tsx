import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePrivacyShield } from '../../src/hooks/usePrivacyShield';
import { useTasks } from '../../src/hooks/useTasks';
import { useMemos } from '../../src/hooks/useMemos';
import { ClientCryptoService } from '../../src/services/ClientCryptoService';
import { TaskEntity, MemoEntitySchema } from '../../src/types/contracts';

describe('Reactive State Hooks', () => {
  beforeEach(() => {
    ClientCryptoService.initializeSessionKey();
  });

  afterEach(() => {
    ClientCryptoService.logout();
  });

  describe('usePrivacyShield', () => {
    it('manages key state, telemetry aggregation, and risk escalation', () => {
      const { result } = renderHook(() => usePrivacyShield());

      expect(result.current.hasActiveKey).toBe(true);
      expect(result.current.totalTokensMasked).toBe(0);
      expect(result.current.sessionRiskLevel).toBe('NONE');

      act(() => {
        result.current.recordMaskedTokens([
          { type: 'EMAIL' },
          { type: 'PHONE' }
        ]);
      });

      expect(result.current.totalTokensMasked).toBe(2);
      expect(result.current.tokensByType.EMAIL).toBe(1);
      expect(result.current.tokensByType.PHONE).toBe(1);

      // Record high sensitivity token
      act(() => {
        result.current.recordMaskedTokens([{ type: 'SECRET_KEY' }]);
      });

      expect(result.current.totalTokensMasked).toBe(3);
      expect(result.current.sessionRiskLevel).toBe('HIGH');

      // Logout and zero
      act(() => {
        result.current.logoutAndZeroKey();
      });

      expect(result.current.hasActiveKey).toBe(false);
      expect(ClientCryptoService.hasSessionKey()).toBe(false);

      // Test zero-tokens early return
      act(() => {
        result.current.recordMaskedTokens([]);
      });
      expect(result.current.totalTokensMasked).toBe(3);
    });

    it('calculates MEDIUM risk level when financial tokens are present without secret keys', () => {
      const { result } = renderHook(() => usePrivacyShield());

      act(() => {
        result.current.recordMaskedTokens([
          { type: 'IBAN' },
          { type: 'AMOUNT_MONEY' }
        ]);
      });

      expect(result.current.sessionRiskLevel).toBe('MEDIUM');
      expect(result.current.totalTokensMasked).toBe(2);
    });
  });

  describe('useTasks', () => {
    it('stores tasks, updates statuses, updates priorities, and toggles subtasks', async () => {
      const { result } = renderHook(() => useTasks());

      const sampleTask: TaskEntity = {
        id: 'task_001_mock_id_1234567',
        memoId: 'memo_001_mock_id_1234567',
        userId: 'usr_001_mock_id_1234567',
        encryptedPayload: {
          ciphertext: 'AAAA',
          iv: 'AAAAAAAAAAAAAAAA',
          authTag: 'AAAAAAAAAAAAAAAAAAAAAA==',
          keyId: 'v1'
        },
        category: 'WORK',
        priority: 'MEDIUM',
        status: 'DRAFT',
        scheduledDate: null,
        tags: ['test'],
        provenance: 'GEMINI_FLASH',
        modelVersion: 'gemini-2.5',
        createdAt: '2026-11-08T00:00:00.000Z',
        updatedAt: '2026-11-08T00:00:00.000Z'
      };

      act(() => {
        result.current.addTask(sampleTask, {
          title: 'Decrypted Title',
          summary: 'Decrypted Summary',
          subtasks: [{ title: 'Subtask 1', completed: false }]
        });
      });

      expect(result.current.tasks.length).toBe(1);
      expect(result.current.decryptedPayloads['task_001_mock_id_1234567'].title).toBe('Decrypted Title');
      expect(result.current.draftsCount).toBe(1);

      act(() => {
        result.current.updateTaskStatus('task_001_mock_id_1234567', 'COMPLETED');
      });
      expect(result.current.tasks[0].status).toBe('COMPLETED');
      expect(result.current.draftsCount).toBe(0);

      act(() => {
        result.current.updateTaskPriority('task_001_mock_id_1234567', 'URGENT');
      });
      expect(result.current.tasks[0].priority).toBe('URGENT');

      act(() => {
        result.current.toggleSubtask('task_001_mock_id_1234567', 0, true);
        result.current.toggleSubtask('non_existent_task', 0, true);
        result.current.toggleSubtask('task_001_mock_id_1234567', 99, true);
        result.current.updateTaskStatus('non_existent_task', 'COMPLETED');
        result.current.updateTaskPriority('non_existent_task', 'URGENT');
      });
      expect(result.current.decryptedPayloads['task_001_mock_id_1234567'].subtasks[0].completed).toBe(true);

      // Add task with encrypted payload directly and auto-decrypt
      const autoEncrypted = await ClientCryptoService.encrypt({
        title: 'Auto Decrypted Task',
        summary: 'Decrypted automatically on arrival',
        subtasks: [{ title: 'Verify auto decryption', completed: false }]
      });

      const autoTask: TaskEntity = {
        ...sampleTask,
        id: 'task_002_auto_decrypt',
        encryptedPayload: autoEncrypted
      };

      await act(async () => {
        result.current.addTask(autoTask);
      });

      expect(result.current.tasks.length).toBe(2);

      act(() => {
        result.current.clearDecryptedPayloads();
      });
      expect(result.current.decryptedPayloads['task_001_mock_id_1234567']).toBeUndefined();
    });
  });

  describe('useMemos', () => {
    it('submits raw memo, creates valid MemoEntity conforming to schema, and invokes callbacks', async () => {
      let createdTask: TaskEntity | null = null;
      const { result } = renderHook(() =>
        useMemos({
          onTaskCreated: (task) => {
            createdTask = task;
          }
        })
      );

      const rawMemo = 'Send payment to client@partner.com before tomorrow morning';
      const tokens = [
        {
          token: '[EMAIL_1]',
          type: 'EMAIL' as const,
          originalValue: 'client@partner.com',
          startIndex: 16,
          endIndex: 34
        }
      ];

      let memoEntity;
      await act(async () => {
        memoEntity = await result.current.submitMemo(rawMemo, tokens);
      });

      // Verify MemoEntity conforms to MemoEntitySchema
      expect(MemoEntitySchema.safeParse(memoEntity).success).toBe(true);
      expect(memoEntity!.sanitizedContentPreview).toContain('[EMAIL_1]');
      expect(memoEntity!.sanitizedContentPreview).not.toContain('client@partner.com');
      expect(memoEntity!.hasPII).toBe(true);
      expect(memoEntity!.maskedFieldsCount).toBe(1);
      expect(result.current.memos.length).toBe(1);

      // Verify task creation callback
      expect(createdTask).not.toBeNull();
      expect(createdTask!.status).toBe('DRAFT');
    });
  });
});
