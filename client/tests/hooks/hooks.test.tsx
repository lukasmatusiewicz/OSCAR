import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePrivacyShield } from '../../src/hooks/usePrivacyShield';
import { useTasks } from '../../src/hooks/useTasks';
import { useMemos } from '../../src/hooks/useMemos';
import { ClientCryptoService } from '../../src/services/ClientCryptoService';
import { gatewayClient } from '../../src/services/GatewayClient';
import { TaskEntity, MemoEntitySchema, DecryptedTaskPayload, PIITokenMap } from '../../src/types/contracts';

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

    it('synthesizes clean clause title and logs gateway error on offline fallback', async () => {
      let createdDecryptedPayload: DecryptedTaskPayload | null = null;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() =>
        useMemos({
          onTaskCreated: (_task, decrypted) => {
            createdDecryptedPayload = decrypted;
          },
        })
      );

      const rawMemo =
        'spotkanie z kazikiem bąkiem. za tydzień o 15. berlinerstr. 123. note: 15 tys euro.';

      await act(async () => {
        await result.current.submitMemo(rawMemo);
      });

      expect(createdDecryptedPayload).not.toBeNull();
      expect(createdDecryptedPayload!.title).toBe('Spotkanie z kazikiem bąkiem');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '%cERROR',
        expect.any(String),
        '[useMemos]',
        'Gateway submission error:',
        expect.anything()
      );

      consoleErrorSpy.mockRestore();
    });

    it('strips card metadata markers from title during offline fallback extraction', async () => {
      let createdDecryptedPayload: DecryptedTaskPayload | null = null;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() =>
        useMemos({
          onTaskCreated: (_task, decrypted) => {
            createdDecryptedPayload = decrypted;
          },
        })
      );

      const rawMemo =
        'Spotkanie z Beatą Kozidrak\n• 👤 Contact: Beata Kozidrak\n• 📍 Location: Hamburgerstr. 123';

      await act(async () => {
        await result.current.submitMemo(rawMemo);
      });

      expect(createdDecryptedPayload).not.toBeNull();
      expect(createdDecryptedPayload!.title).toBe('Spotkanie z Beatą Kozidrak');
      expect(createdDecryptedPayload!.contactPerson).toBe('Beata Kozidrak');
      expect(createdDecryptedPayload!.location).toBe('Hamburgerstr. 123');

      consoleErrorSpy.mockRestore();
    });

    it('synthesizes Google Calendar-style structured summary with tokens in offline fallback', async () => {
      let createdDecrypted: DecryptedTaskPayload | null = null;
      let createdTask: TaskEntity | null = null;
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() =>
        useMemos({
          onTaskCreated: (task, decrypted) => {
            createdTask = task;
            createdDecrypted = decrypted;
          },
        })
      );

      const rawMemo =
        'Project sync with [PERSON_1] at [ADDRESS_1] regarding budget [AMOUNT_MONEY_1] tomorrow at 14:00';
      const tokens: PIITokenMap[] = [
        {
          token: '[PERSON_1]',
          type: 'PERSON',
          originalValue: 'Dr. Alice',
          startIndex: 18,
          endIndex: 28,
        },
        {
          token: '[ADDRESS_1]',
          type: 'ADDRESS',
          originalValue: 'Berlin Office',
          startIndex: 32,
          endIndex: 43,
        },
        {
          token: '[AMOUNT_MONEY_1]',
          type: 'AMOUNT_MONEY',
          originalValue: '1000 EUR',
          startIndex: 61,
          endIndex: 77,
        },
        {
          token: '[SECRET_KEY_1]',
          type: 'SECRET_KEY',
          originalValue: 'sk-12345678901234567890',
          startIndex: 0,
          endIndex: 0,
        },
      ];

      await act(async () => {
        await result.current.submitMemo(rawMemo, tokens);
      });

      expect(createdTask).not.toBeNull();
      expect(createdTask!.priority).toBe('URGENT'); // SECRET_KEY token triggers URGENT
      expect(createdDecrypted).not.toBeNull();
      expect(createdDecrypted!.contactPerson).toBe('Dr. Alice');
      expect(createdDecrypted!.location).toBe('Berlin Office');
      expect(createdDecrypted!.amount).toBe('1000 EUR');
      expect(createdDecrypted!.scheduledTime).toBe('tomorrow at 14:00');
      expect(createdDecrypted!.summary).toContain('👤 Contact: Dr. Alice');
      expect(createdDecrypted!.summary).toContain('📍 Location: Berlin Office');
      expect(createdDecrypted!.summary).toContain('💰 Amount: 1000 EUR');
      expect(createdDecrypted!.summary).toContain('⏰ Time: tomorrow at 14:00');
      expect(createdDecrypted!.summary).toContain('📝 Notes: sk-12345678901234567890');
    });

    it('extracts metadata via regex and pads short summary in offline fallback', async () => {
      let createdDecrypted: DecryptedTaskPayload | null = null;
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() =>
        useMemos({
          onTaskCreated: (_task, decrypted) => {
            createdDecrypted = decrypted;
          },
        })
      );

      const rawMemo = 'Call Mr. Smith in Paris about 500 EUR today at 10:00. note: follow up';

      await act(async () => {
        await result.current.submitMemo(rawMemo);
      });

      expect(createdDecrypted).not.toBeNull();
      expect(createdDecrypted!.contactPerson).toBe('Mr. Smith');
      expect(createdDecrypted!.location).toBe('Paris');
      expect(createdDecrypted!.amount).toBe('500 EUR');
      expect(createdDecrypted!.summary).toContain('👤 Contact: Mr. Smith');
      expect(createdDecrypted!.summary).toContain('📍 Location: Paris');
      expect(createdDecrypted!.summary).toContain('💰 Amount: 500 EUR');
      expect(createdDecrypted!.summary).toContain('📝 Notes: follow up');
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

    it('extracts metadata from card markers, streets, and tests bounds in offline fallback', async () => {
      let createdDecrypted: DecryptedTaskPayload | null = null;
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() =>
        useMemos({
          onTaskCreated: (_task, decrypted) => {
            createdDecrypted = decrypted;
          },
        })
      );

      // Card markers for contact, location, amount, time, and street regex
      const rawMemo =
        'Quarterly Strategy Review in ul. Marszałkowska 10\n• 👤 Contact: Dr. Klaus Schmidt\n• 📍 Location: Kassel Office\n• 💰 Amount: 50,000 EUR\n• ⏰ Time: End of Day Q3 Sprint';

      await act(async () => {
        await result.current.submitMemo(rawMemo);
      });

      expect(createdDecrypted).not.toBeNull();
      expect(createdDecrypted!.contactPerson).toBe('Dr. Klaus Schmidt');
      expect(createdDecrypted!.amount).toBe('50,000 EUR');
      expect(createdDecrypted!.scheduledTime).toBe('End of Day Q3 Sprint');
      expect(createdDecrypted!.location).toBeDefined();
    });

    it('handles short titles, long titles, long summaries, and tokens without originalValue in offline fallback', async () => {
      let createdDecrypted: DecryptedTaskPayload | null = null;
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() =>
        useMemos({
          onTaskCreated: (_task, decrypted) => {
            createdDecrypted = decrypted;
          },
        })
      );

      // 1. Short title fallback (< 3 chars)
      await act(async () => {
        await result.current.submitMemo('Do');
      });
      expect(createdDecrypted!.title).toBe('Voice Memo Action Items');

      // 2. Long title truncation (> 80 chars) and long summary truncation (> 500 chars)
      const longTitleMemo = 'A'.repeat(90) + '. ' + 'Detailed notes '.repeat(40);
      await act(async () => {
        await result.current.submitMemo(longTitleMemo);
      });
      expect(createdDecrypted!.title.length).toBeLessThanOrEqual(80);
      expect(createdDecrypted!.title.endsWith('...')).toBe(true);
      expect(createdDecrypted!.summary.length).toBeLessThanOrEqual(500);

      // 3. Tokens with undefined originalValue
      const tokenWithoutVal = [
        {
          token: '[ADDRESS_1]',
          type: 'ADDRESS' as const,
          originalValue: '',
          startIndex: 0,
          endIndex: 11,
        },
        {
          token: '[AMOUNT_MONEY_1]',
          type: 'AMOUNT_MONEY' as const,
          originalValue: '',
          startIndex: 12,
          endIndex: 28,
        },
      ];
      await act(async () => {
        await result.current.submitMemo('[ADDRESS_1] [AMOUNT_MONEY_1]', tokenWithoutVal);
      });
      expect(createdDecrypted!.location).toBe('[ADDRESS_1]');
      expect(createdDecrypted!.amount).toBe('[AMOUNT_MONEY_1]');
    });

    it('handles submission errors and sets error state in useMemos', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const encryptSpy = vi.spyOn(ClientCryptoService, 'encrypt').mockRejectedValueOnce(new Error('Fatal crypto failure'));

      const { result } = renderHook(() => useMemos());

      let submitError: unknown = null;
      await act(async () => {
        try {
          await result.current.submitMemo('Trigger crypto failure');
        } catch (err) {
          submitError = err;
        }
      });

      expect(submitError).toBeDefined();
      expect((submitError as Error).message).toBe('Fatal crypto failure');
      expect(result.current.error).toBe('Fatal crypto failure');
      encryptSpy.mockRestore();
    });
  });

  describe('useTasks extended branch coverage', () => {
    it('decrypts task asynchronously when added without decrypted payload', async () => {
      const { result } = renderHook(() => useTasks());

      const encPayload = await ClientCryptoService.encrypt({
        title: 'Auto Decrypted Task',
        summary: 'Decrypted automatically on add',
        subtasks: [{ title: 'Subtask auto', completed: false }],
      });

      const task: TaskEntity = {
        id: 'task_auto_dec_123',
        memoId: 'memo_auto_dec_123',
        userId: 'usr_mock_session_active',
        encryptedPayload: encPayload,
        category: 'WORK',
        priority: 'MEDIUM',
        status: 'DRAFT',
        scheduledDate: null,
        tags: [],
        provenance: 'GEMINI_FLASH',
        modelVersion: 'gemini-2.5-flash-001',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await act(async () => {
        result.current.addTask(task);
      });

      await waitFor(() => {
        expect(result.current.decryptedPayloads['task_auto_dec_123']).toBeDefined();
        expect(result.current.decryptedPayloads['task_auto_dec_123']?.title).toBe('Auto Decrypted Task');
      });
    });

    it('deletes task from state and invokes gatewayClient.deleteTask', async () => {
      const deleteSpy = vi.spyOn(gatewayClient, 'deleteTask').mockResolvedValueOnce({ success: true } as any);
      const { result } = renderHook(() => useTasks());

      const encPayload = await ClientCryptoService.encrypt({
        title: 'Task To Delete',
        summary: 'To be removed',
        subtasks: [],
      });

      const task: TaskEntity = {
        id: 'task_delete_target_123',
        memoId: 'memo_del',
        userId: 'usr_mock',
        encryptedPayload: encPayload,
        category: 'WORK',
        priority: 'LOW',
        status: 'PENDING',
        scheduledDate: null,
        tags: [],
        provenance: 'DETERMINISTIC_FALLBACK',
        modelVersion: 'rule-based-v1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      act(() => {
        result.current.addTask(task, { title: 'Task To Delete', summary: 'To be removed', subtasks: [] });
      });

      expect(result.current.tasks.some((t) => t.id === 'task_delete_target_123')).toBe(true);

      act(() => {
        result.current.deleteTask('task_delete_target_123');
      });

      expect(result.current.tasks.some((t) => t.id === 'task_delete_target_123')).toBe(false);
      expect(result.current.decryptedPayloads['task_delete_target_123']).toBeUndefined();
      expect(deleteSpy).toHaveBeenCalledWith('task_delete_target_123');
      deleteSpy.mockRestore();
    });
  });
});
