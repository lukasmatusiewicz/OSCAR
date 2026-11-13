import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook, act, within } from '@testing-library/react';
import { TaskCard } from '../../src/components/organisms/TaskCard';
import { useTasks } from '../../src/hooks/useTasks';
import { useMemos } from '../../src/hooks/useMemos';
import { GatewayClient } from '../../src/services/GatewayClient';
import { ClientCryptoService } from '../../src/services/ClientCryptoService';
import { gatewayClient } from '../../src/services/GatewayClient';
import { App } from '../../src/App';
import { TaskEntity } from '../../src/types/contracts';

const makeTask = (id: string, overrides: Partial<TaskEntity> = {}): TaskEntity => ({
  id,
  memoId: `memo_${id}`,
  userId: 'usr_001',
  encryptedPayload: {
    ciphertext: 'AAAA',
    iv: 'AAAAAAAAAAAAAAAA',
    authTag: 'AAAAAAAAAAAAAAAAAAAAAA==',
    keyId: 'v1',
  },
  category: 'WORK',
  priority: 'MEDIUM',
  status: 'PENDING',
  scheduledDate: null,
  tags: ['test'],
  provenance: 'GEMINI_FLASH',
  modelVersion: 'gemini-2.5-flash-001',
  createdAt: '2026-11-13T00:00:00.000Z',
  updatedAt: '2026-11-13T00:00:00.000Z',
  ...overrides,
});

describe('PR 5: Key-Loss UX, Timeouts/Errors, Offline Simulation & F-12', () => {
  beforeEach(() => {
    ClientCryptoService.initializeSessionKey();
  });

  afterEach(() => {
    ClientCryptoService.logout();
    vi.restoreAllMocks();
  });

  describe('TaskCard undecryptable & unsynced states', () => {
    it('shows previous-session-key message and keeps Delete accessible when isUndecryptable is true', () => {
      const handleDelete = vi.fn();
      const task = makeTask('task_undecryptable_1');

      render(
        <TaskCard
          task={task}
          isDecrypted={true}
          isUndecryptable={true}
          onDelete={handleDelete}
        />,
      );

      expect(
        screen.getByText(/cannot decrypt: encrypted with a previous session key \(lost on page reload\)\./i),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/active session key required to view cleartext/i),
      ).not.toBeInTheDocument();

      const deleteBtn = screen.getByRole('button', { name: /delete task/i });
      expect(deleteBtn).toBeEnabled();
      fireEvent.click(deleteBtn);
      expect(handleDelete).toHaveBeenCalledWith('task_undecryptable_1');
    });

    it('renders Not synced badge when isUnsynced is true', () => {
      const task = makeTask('task_unsynced_1');
      render(
        <TaskCard
          task={task}
          isDecrypted={true}
          isUnsynced={true}
          decryptedPayload={{
            title: 'Local Edit',
            summary: 'Not yet synced',
            subtasks: [{ title: 'Item', completed: false }],
          }}
        />,
      );

      expect(screen.getByTestId('task-unsynced-badge-task_unsynced_1')).toHaveTextContent(
        /not synced/i,
      );
    });
  });

  describe('useTasks undecryptableIds, fetchError, and unsyncedIds', () => {
    it('tracks undecryptableIds on key mismatch and clears on logout/re-evaluation', async () => {
      const encryptedWithOldKey = await ClientCryptoService.encrypt({
        title: 'Old Session Secret',
        summary: 'Encrypted with key 1',
        subtasks: [{ title: 'Step 1', completed: false }],
      });
      ClientCryptoService.logout();
      ClientCryptoService.initializeSessionKey(); // New different key

      const staleTask = makeTask('task_stale_key', { encryptedPayload: encryptedWithOldKey });
      const { result } = renderHook(() => useTasks([staleTask]));

      await waitFor(() => {
        expect(result.current.undecryptableIds['task_stale_key']).toBe(true);
      });

      act(() => {
        result.current.clearDecryptedPayloads();
      });

      expect(result.current.undecryptableIds).toEqual({});
    });

    it('surfaces fetchError on fetchTasks failure and clears on successful retry', async () => {
      const fetchSpy = vi
        .spyOn(gatewayClient, 'fetchTasks')
        .mockRejectedValueOnce(new Error('Gateway timeout (8000ms)'))
        .mockResolvedValueOnce([]);

      const { result } = renderHook(() => useTasks());

      await act(async () => {
        await result.current.fetchTasks();
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.fetchError).toBe('Gateway timeout (8000ms)');

      await act(async () => {
        await result.current.fetchTasks();
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.current.fetchError).toBeNull();
    });

    it('marks task in unsyncedIds and sets syncError when mutation fails, then clears on success', async () => {
      const updateSpy = vi
        .spyOn(gatewayClient, 'updateTask')
        .mockRejectedValueOnce(new Error('Network offline'))
        .mockResolvedValueOnce(makeTask('task_sync_1', { status: 'COMPLETED' }));

      const task = makeTask('task_sync_1');
      const { result } = renderHook(() => useTasks());

      act(() => {
        result.current.addTask(task, {
          title: 'Sync Test',
          summary: 'Summary',
          subtasks: [{ title: 'Sub', completed: false }],
        });
      });

      act(() => {
        result.current.updateTaskStatus('task_sync_1', 'IN_PROGRESS');
      });

      await waitFor(() => {
        expect(result.current.unsyncedIds['task_sync_1']).toBe(true);
        expect(result.current.syncError).toBe('Network offline');
      });

      act(() => {
        result.current.updateTaskStatus('task_sync_1', 'COMPLETED');
      });

      await waitFor(() => {
        expect(result.current.unsyncedIds['task_sync_1']).toBeUndefined();
      });
      expect(updateSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('GatewayClient AbortSignal.timeout(8000)', () => {
    it('attaches an AbortSignal with timeout(8000) to fetch requests', async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
      });

      const client = new GatewayClient({ baseUrl: 'http://localhost:3000', fetchFn: mockFetch });
      await client.fetchTasks();

      expect(timeoutSpy).toHaveBeenCalledWith(8000);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, init] = mockFetch.mock.calls[0];
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('useMemos & App Simulate Offline toggle', () => {
    it('useMemos skips gatewayClient.submitMemo when simulateOffline is true', async () => {
      const submitSpy = vi.spyOn(gatewayClient, 'submitMemo');
      const onTaskCreated = vi.fn();

      const { result } = renderHook(() =>
        useMemos({
          simulateOffline: true,
          onTaskCreated,
        }),
      );

      await act(async () => {
        await result.current.submitMemo('Call Dr. Schmidt tomorrow at 14:00', []);
      });

      expect(submitSpy).not.toHaveBeenCalled();
      expect(result.current.isOfflineFallback).toBe(true);
      expect(result.current.warning).toMatch(/simulated offline/i);
      expect(onTaskCreated).toHaveBeenCalledTimes(1);
    });

    it('App toggles Simulate Offline, routes memo to Art. 13 fallback, and surfaces fetchError with Retry', async () => {
      const fetchSpy = vi
        .spyOn(gatewayClient, 'fetchTasks')
        .mockRejectedValueOnce(new Error('503 Service Unavailable'))
        .mockResolvedValueOnce([]);
      const submitSpy = vi.spyOn(gatewayClient, 'submitMemo');

      render(<App />);

      // F-12: PrivacyAuditPanel PrivacyShieldBadge only (not duplicated in Header or MemoEditor), with "No PII Detected" (no "Zero Risk")
      expect(screen.queryByText(/zero risk/i)).not.toBeInTheDocument();
      expect(screen.getAllByText(/no pii detected/i)).toHaveLength(1);
      const auditPanel = screen.getByRole('complementary', {
        name: /privacy and security audit panel/i,
      });
      expect(within(auditPanel).getByText(/no pii detected/i)).toBeInTheDocument();
      expect(within(auditPanel).getByTestId('simulate-offline-toggle')).toBeInTheDocument();

      // R-34: fetchError alert + Retry button
      await waitFor(() => {
        expect(screen.getByTestId('fetch-error-banner')).toHaveTextContent(
          /503 service unavailable/i,
        );
      });

      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(screen.queryByTestId('fetch-error-banner')).not.toBeInTheDocument();
      });

      // Demo feature: Simulate Offline toggle
      const toggle = screen.getByRole('switch', { name: /simulate offline/i });
      expect(toggle).toHaveAttribute('aria-checked', 'false');
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-checked', 'true');

      const textarea = screen.getByLabelText(/confidential memo input/i);
      fireEvent.change(textarea, {
        target: { value: 'Prepare quarterly audit report for Berlin office' },
      });
      fireEvent.click(screen.getByRole('button', { name: /encrypt & process/i }));

      await waitFor(() => {
        expect(screen.getByTestId('memo-offline-warning')).toHaveTextContent(
          /offline fallback mode \(eu ai act art\. 13\): simulated offline/i,
        );
      });
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('masks raw PII in offline fallback sanitizedContentPreview and sets hasPII accurately when tokens are omitted', async () => {
      const onTaskCreated = vi.fn();
      const { result } = renderHook(() =>
        useMemos({
          simulateOffline: true,
          onTaskCreated,
        }),
      );

      let memoEntity: Awaited<ReturnType<typeof result.current.submitMemo>> | undefined;
      await act(async () => {
        memoEntity = await result.current.submitMemo(
          'Pay 5000 EUR to alice@corp.com, phone +48 501 234 567, IBAN DE89370400440532013000, PESEL 90010112345, key sk-proj-abc1234567890, with Anna Nowak',
        );
      });

      expect(memoEntity).toBeDefined();
      expect(memoEntity!.hasPII).toBe(true);
      expect(memoEntity!.maskedFieldsCount).toBeGreaterThanOrEqual(6);
      expect(memoEntity!.sanitizedContentPreview).not.toContain('alice@corp.com');
      expect(memoEntity!.sanitizedContentPreview).not.toContain('5000 EUR');
      expect(memoEntity!.sanitizedContentPreview).not.toContain('+48 501 234 567');
      expect(memoEntity!.sanitizedContentPreview).not.toContain('DE89370400440532013000');
      expect(memoEntity!.sanitizedContentPreview).not.toContain('90010112345');
      expect(memoEntity!.sanitizedContentPreview).not.toContain('sk-proj-abc1234567890');
      expect(memoEntity!.sanitizedContentPreview).not.toContain('Anna Nowak');

      const [createdTask] = onTaskCreated.mock.calls[0];
      expect(createdTask).not.toHaveProperty('location');
      expect(createdTask).not.toHaveProperty('contactPerson');
      expect(createdTask).not.toHaveProperty('amount');
    });

    it('TaskCard renders location, contactPerson, and amount from decryptedPayload without outer TaskEntity fields', () => {
      const task = makeTask('task_dec_meta_1');
      render(
        <TaskCard
          task={task}
          decryptedPayload={{
            title: 'Client Audit',
            summary: 'Audit details',
            subtasks: [{ title: 'Verify', completed: false }],
            location: 'Berlin Tech Hub',
            contactPerson: 'Dr. Klaus Schmidt',
            amount: '5000 EUR',
          }}
        />,
      );

      expect(screen.getByTestId('metadata-chip-location')).toHaveTextContent('Berlin Tech Hub');
      expect(screen.getByText(/Dr\. Klaus Schmidt/)).toBeInTheDocument();
      expect(screen.getByTestId('metadata-chip-amount')).toHaveTextContent('5000 EUR');
    });
  });
});
