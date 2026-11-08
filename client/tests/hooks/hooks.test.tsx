import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePrivacyShield } from '../../src/hooks/usePrivacyShield';
import { useTasks } from '../../src/hooks/useTasks';
import { useMemos } from '../../src/hooks/useMemos';
import { ClientCryptoService } from '../../src/services/ClientCryptoService';
import { gatewayClient } from '../../src/services/GatewayClient';
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

      // Test updateTaskPayload
      act(() => {
        result.current.updateTaskPayload('task_001_mock_id_1234567', {
          title: 'Modified Title',
          summary: 'Modified Summary',
          subtasks: [{ title: 'Updated subtask', completed: true }],
          location: 'Office 301',
          contactPerson: 'Jane Doe',
          amount: '1000 EUR',
          scheduledTime: '2026-11-20',
        });
      });
      expect(result.current.decryptedPayloads['task_001_mock_id_1234567'].title).toBe('Modified Title');
      const updatedTask1 = result.current.tasks.find(
        (t) => t.id === 'task_001_mock_id_1234567',
      );
      expect(updatedTask1?.location).toBe('Office 301');
      expect(updatedTask1?.contactPerson).toBe('Jane Doe');

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

      // Verify task creation callback and deterministic fallback transparency
      expect(createdTask).not.toBeNull();
      expect(createdTask!.status).toBe('DRAFT');
      expect(createdTask!.provenance).toBe('DETERMINISTIC_FALLBACK');
      expect(createdTask!.modelVersion).toBe('rule-based-v1');
      expect(result.current.isOfflineFallback).toBe(true);
      expect(result.current.warning).toContain('Deterministic rule-based fallback');
    });

    it('submits memo successfully through gatewayClient when online', async () => {
      let createdTask: TaskEntity | null = null;
      let detectedTokensCount = 0;
      const { result } = renderHook(() =>
        useMemos({
          onTaskCreated: (task) => {
            createdTask = task;
          },
          onTokensDetected: (tokens) => {
            detectedTokensCount = tokens.length;
          },
        })
      );

      const encPayload = await ClientCryptoService.encrypt({
        title: 'Online Gemini Task',
        summary: 'Processed successfully by backend',
        subtasks: [{ title: 'Verify gateway response', completed: false }],
      });

      const mockOnlineTask: TaskEntity = {
        id: 'task_gateway_online_123',
        memoId: 'memo_gateway_online_123',
        userId: 'usr_mock_session_active',
        encryptedPayload: encPayload,
        category: 'WORK',
        priority: 'MEDIUM',
        status: 'DRAFT',
        scheduledDate: null,
        tags: ['online'],
        provenance: 'GEMINI_FLASH',
        modelVersion: 'gemini-2.5-flash-001',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockOnlineMemo = {
        id: 'memo_gateway_online_123',
        userId: 'usr_mock_session_active',
        encryptedPayload: encPayload,
        sanitizedContentPreview: 'Online memo content',
        hasPII: false,
        maskedFieldsCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const spy = vi.spyOn(gatewayClient, 'submitMemo').mockResolvedValueOnce({
        task: mockOnlineTask,
        tasks: [mockOnlineTask],
        memo: mockOnlineMemo,
        piiStats: {
          detectedEntityCount: 0,
          maskedTokens: [],
          riskLevel: 'NONE',
        },
      });

      await act(async () => {
        await result.current.submitMemo('Submit online memo');
      });

      expect(spy).toHaveBeenCalled();
      expect(result.current.isOfflineFallback).toBe(false);
      expect(result.current.warning).toBeNull();
      expect(result.current.memos.length).toBe(1);
      expect(createdTask).not.toBeNull();
      expect(detectedTokensCount).toBe(0);
    });
  });
});
