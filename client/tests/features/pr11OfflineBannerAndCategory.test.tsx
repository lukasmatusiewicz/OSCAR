import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, renderHook, act } from '@testing-library/react';
import App from '../../src/App';
import { MemoEditor } from '../../src/components/organisms/MemoEditor';
import { TaskCard } from '../../src/components/organisms/TaskCard';
import { useTasks } from '../../src/hooks/useTasks';
import { gatewayClient } from '../../src/services/GatewayClient';
import { ClientCryptoService } from '../../src/services/ClientCryptoService';
import { DecryptedTaskPayload, TaskEntity } from '../../src/types/contracts';

const makeTask = (id: string, overrides: Partial<TaskEntity> = {}): TaskEntity => ({
  id,
  memoId: 'memo_pr11_test_1',
  userId: 'usr_pr11_test_1',
  encryptedPayload: {
    ciphertext: 'cipher',
    iv: 'iv',
    authTag: 'tag',
    keyId: 'v1',
  },
  category: 'WORK',
  priority: 'MEDIUM',
  status: 'PENDING',
  scheduledDate: null,
  tags: ['test'],
  provenance: 'GEMINI_FLASH',
  modelVersion: 'gemini-2.5-flash',
  createdAt: '2026-11-13T10:00:00.000Z',
  updatedAt: '2026-11-13T10:00:00.000Z',
  ...overrides,
});

const makePayload = (overrides: Partial<DecryptedTaskPayload> = {}): DecryptedTaskPayload => ({
  title: 'Review Q4 budget',
  summary: 'Verify Q4 budget allocations and vendor contracts.',
  subtasks: [{ title: 'Check line items', completed: false }],
  location: null,
  contactPerson: null,
  amount: null,
  scheduledTime: null,
  scheduledDate: null,
  ...overrides,
});

describe('PR 11: Badge Deduplication, Offline Banner Reset, Local-Only Guard & Category Edit', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    ClientCryptoService.initializeSessionKey();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ClientCryptoService.logout();
    window.sessionStorage.clear();
  });

  it('renders PrivacyShieldBadge ("No PII Detected") only inside PrivacyAuditPanel and not in MemoEditor', async () => {
    vi.spyOn(gatewayClient, 'fetchTasks').mockResolvedValueOnce([]);

    const { unmount } = render(<MemoEditor onSubmit={vi.fn()} />);
    expect(screen.queryByText(/no pii detected/i)).not.toBeInTheDocument();
    unmount();

    render(<App />);
    await waitFor(() => {
      expect(screen.getAllByText(/no pii detected/i)).toHaveLength(1);
    });

    const auditPanel = screen.getByRole('complementary', {
      name: /privacy and security audit panel/i,
    });
    expect(within(auditPanel).getByText(/no pii detected/i)).toBeInTheDocument();
  });

  it('clears Offline Fallback Mode banner on Simulate Offline toggle-off and skips server sync for local-only tasks', async () => {
    vi.spyOn(gatewayClient, 'fetchTasks').mockResolvedValueOnce([]);
    const updateSpy = vi.spyOn(gatewayClient, 'updateTask');
    const patchSpy = vi.spyOn(gatewayClient, 'patchTask');
    const deleteSpy = vi.spyOn(gatewayClient, 'deleteTask');

    render(<App />);
    await waitFor(() => {
      expect(screen.queryByTestId('tasks-loading-indicator')).not.toBeInTheDocument();
    });

    // Enable Simulate Offline and submit a memo
    const toggle = screen.getByRole('switch', { name: /simulate offline/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.change(screen.getByLabelText(/confidential memo input/i), {
      target: { value: 'Schedule quarterly review meeting tomorrow' },
    });
    fireEvent.click(screen.getByRole('button', { name: /encrypt & process/i }));

    await waitFor(() => {
      expect(screen.getByTestId('memo-offline-warning')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('heading', { name: /schedule quarterly review meeting tomorrow/i }),
    ).toBeInTheDocument();

    // Toggle Simulate Offline OFF -> banner clears immediately
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await waitFor(() => {
      expect(screen.queryByTestId('memo-offline-warning')).not.toBeInTheDocument();
    });

    // Edit the local-only task (title + category) -> no PATCH/sync warning
    const editDraftBtn = await screen.findByRole('button', { name: /edit draft/i });
    fireEvent.click(editDraftBtn);
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: 'Updated offline review' },
    });
    fireEvent.change(screen.getByLabelText(/^category$/i), {
      target: { value: 'FINANCE' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm & save task/i }));

    await waitFor(() => {
      expect(screen.getByText('Updated offline review')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Category: FINANCE')).toBeInTheDocument();

    // Toggle priority & status locally -> no PATCH/sync warning
    fireEvent.click(screen.getByRole('radio', { name: /high/i }));
    fireEvent.click(screen.getByRole('button', { name: /mark done/i }));

    // Delete local-only task -> no DELETE/sync warning
    fireEvent.click(screen.getByRole('button', { name: /delete task/i }));

    await waitFor(() => {
      expect(screen.queryByText('Updated offline review')).not.toBeInTheDocument();
    });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(patchSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sync-error-banner')).not.toBeInTheDocument();
  });

  it('useTasks skips gateway PATCH for local-only tasks and sends category in PATCH for server-backed tasks', async () => {
    const serverTask = makeTask('task_server_1234567890');
    const localTask = makeTask('task_local_12345678901');
    const patchSpy = vi
      .spyOn(gatewayClient, 'patchTask')
      .mockResolvedValue({ ...serverTask, category: 'HEALTH' });

    const { result } = renderHook(() => useTasks([], true));

    act(() => {
      result.current.addTask(serverTask, makePayload(), { isLocalOnly: false });
      result.current.addTask(localTask, makePayload(), { isLocalOnly: true });
    });

    expect(result.current.localOnlyIds[localTask.id]).toBe(true);
    expect(result.current.localOnlyIds[serverTask.id]).toBeUndefined();

    // Update local-only task -> no gateway call
    await act(async () => {
      result.current.updateTaskPayload(localTask.id, makePayload({ title: 'Local Edit' }), {
        category: 'PERSONAL',
      });
    });
    expect(patchSpy).not.toHaveBeenCalled();
    expect(result.current.tasks.find((t) => t.id === localTask.id)?.category).toBe('PERSONAL');

    // Update server-backed task -> PATCH includes category
    await act(async () => {
      result.current.updateTaskPayload(serverTask.id, makePayload({ title: 'Server Edit' }), {
        category: 'HEALTH',
      });
    });
    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith(
        serverTask.id,
        expect.objectContaining({
          title: 'Server Edit',
          category: 'HEALTH',
        }),
      );
    });
    expect(result.current.tasks.find((t) => t.id === serverTask.id)?.category).toBe('HEALTH');
  });

  it('TaskCard edit mode renders category selector with all categories and passes updated category on save', () => {
    const task = makeTask('task_cat_edit_12345678');
    const payload = makePayload();
    const onTaskUpdate = vi.fn();

    render(
      <TaskCard
        task={task}
        decryptedPayload={payload}
        isDecrypted={true}
        onTaskUpdate={onTaskUpdate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /edit task/i }));

    const categorySelect = screen.getByLabelText(/^category$/i) as HTMLSelectElement;
    expect(categorySelect.value).toBe('WORK');

    const optionValues = Array.from(categorySelect.options).map((o) => o.value);
    expect(optionValues).toEqual(
      expect.arrayContaining(['WORK', 'FINANCE', 'HEALTH', 'PERSONAL', 'OTHER']),
    );

    fireEvent.change(categorySelect, { target: { value: 'HEALTH' } });
    expect(categorySelect.value).toBe('HEALTH');

    fireEvent.click(screen.getByRole('button', { name: /confirm & save task/i }));

    expect(onTaskUpdate).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ title: payload.title }),
      { category: 'HEALTH' },
    );
  });
});
