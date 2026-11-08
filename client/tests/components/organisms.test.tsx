import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoEditor, detectClientTokens } from '../../src/components/organisms/MemoEditor';
import { TaskCard } from '../../src/components/organisms/TaskCard';
import { TaskList } from '../../src/components/organisms/TaskList';
import { PrivacyAuditPanel } from '../../src/components/organisms/PrivacyAuditPanel';
import { TaskEntity, DecryptedTaskPayload } from '../../src/types/contracts';

describe('Organisms Components', () => {
  describe('MemoEditor & detectClientTokens', () => {
    it('detectClientTokens identifies multiple PII types and assigns correct risk levels', () => {
      const text = 'Transfer $5,000 to user@company.com with key sk-abcdef12345678901234567890 for Dr. Smith';
      const result = detectClientTokens(text);
      expect(result.tokens.length).toBeGreaterThanOrEqual(4);
      expect(result.riskLevel).toBe('HIGH'); // contains SECRET_KEY

      const lowRiskText = 'Call +1 555-123-4567 later';
      const lowResult = detectClientTokens(lowRiskText);
      expect(lowResult.tokens.length).toBe(1);
      expect(lowResult.riskLevel).toBe('LOW');

      const zeroRiskText = 'Review quarterly release roadmap';
      const zeroResult = detectClientTokens(zeroRiskText);
      expect(zeroResult.tokens.length).toBe(0);
      expect(zeroResult.riskLevel).toBe('NONE');
    });

    it('renders editor, detects tokens in real time, and triggers onSubmit', async () => {
      const handleSubmit = vi.fn();
      render(<MemoEditor onSubmit={handleSubmit} />);

      const textarea = screen.getByLabelText(/confidential memo input/i);
      fireEvent.change(textarea, { target: { value: 'Send funds to test@example.com' } });

      // Token preview list should appear
      expect(await screen.findByTestId('memo-token-preview-list')).toBeInTheDocument();
      expect(screen.getByTestId('token-badge-EMAIL_1')).toBeInTheDocument();

      const submitBtn = screen.getByRole('button', { name: /encrypt & process/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(handleSubmit).toHaveBeenCalledTimes(1);
        expect(handleSubmit).toHaveBeenCalledWith(
          'Send funds to test@example.com',
          expect.arrayContaining([expect.objectContaining({ type: 'EMAIL' })])
        );
      });
    });

    it('displays error message when submitted with empty content', async () => {
      const handleSubmit = vi.fn();
      render(<MemoEditor onSubmit={handleSubmit} />);

      const submitBtn = screen.getByRole('button', { name: /encrypt & process/i });
      // Clear input and submit
      fireEvent.click(submitBtn);

      expect(screen.getByRole('alert')).toHaveTextContent(/please enter a memo/i);
      expect(handleSubmit).not.toHaveBeenCalled();
    });
  });

  describe('TaskCard', () => {
    const mockTask: TaskEntity = {
      id: 'task_001_mock_id_1234567',
      memoId: 'memo_001_mock_id_1234567',
      userId: 'usr_001_mock_id_1234567',
      encryptedPayload: {
        ciphertext: 'base64ct',
        iv: 'base64iv',
        authTag: 'base64tag',
        keyId: 'v1'
      },
      category: 'WORK',
      priority: 'HIGH',
      status: 'DRAFT',
      scheduledDate: '2026-11-15T10:00:00.000Z',
      tags: ['audit', 'compliance'],
      provenance: 'GEMINI_FLASH',
      modelVersion: 'gemini-2.5-flash-001',
      createdAt: '2026-11-08T00:00:00.000Z',
      updatedAt: '2026-11-08T00:00:00.000Z'
    };

    const mockDecrypted: DecryptedTaskPayload = {
      title: 'Prepare Audit Report',
      summary: 'Reconcile compliance records and secure logs',
      subtasks: [
        { title: 'Check access tokens', completed: false },
        { title: 'Confirm encryption at rest', completed: true }
      ]
    };

    it('renders decrypted task details, category, and subtask checklist', () => {
      render(<TaskCard task={mockTask} decryptedPayload={mockDecrypted} isDecrypted={true} />);

      expect(screen.getByText('Prepare Audit Report')).toBeInTheDocument();
      expect(screen.getByText('Reconcile compliance records and secure logs')).toBeInTheDocument();
      expect(screen.getByText('Check access tokens')).toBeInTheDocument();
      expect(screen.getByText('#audit')).toBeInTheDocument();
      expect(screen.getByText(/gemini 2.5/i)).toBeInTheDocument();
    });

    it('renders human oversight alert and confirm/dismiss actions when status is DRAFT', () => {
      const handleStatusChange = vi.fn();
      render(
        <TaskCard
          task={mockTask}
          decryptedPayload={mockDecrypted}
          onStatusChange={handleStatusChange}
        />
      );

      expect(screen.getByRole('alert')).toHaveTextContent(/human oversight required/i);

      const confirmBtn = screen.getByRole('button', { name: /confirm task/i });
      fireEvent.click(confirmBtn);
      expect(handleStatusChange).toHaveBeenCalledWith(mockTask.id, 'PENDING');

      const dismissBtn = screen.getByRole('button', { name: /dismiss task/i });
      fireEvent.click(dismissBtn);
      expect(handleStatusChange).toHaveBeenCalledWith(mockTask.id, 'CANCELLED');
    });

    it('handles subtask checklist toggle callback', () => {
      const handleToggle = vi.fn();
      render(
        <TaskCard
          task={mockTask}
          decryptedPayload={mockDecrypted}
          onSubtaskToggle={handleToggle}
        />
      );

      const checkbox = screen.getByLabelText('Check access tokens');
      fireEvent.click(checkbox);
      expect(handleToggle).toHaveBeenCalledWith(mockTask.id, 0, true);
    });

    it('handles mark done and reopen status buttons for active and completed tasks', () => {
      const handleStatusChange = vi.fn();
      const handlePriorityChange = vi.fn();

      const activeTask: TaskEntity = {
        ...mockTask,
        status: 'PENDING'
      };

      const { unmount } = render(
        <TaskCard
          task={activeTask}
          decryptedPayload={mockDecrypted}
          onStatusChange={handleStatusChange}
          onPriorityChange={handlePriorityChange}
        />
      );

      const markDoneBtn = screen.getByRole('button', { name: /✓ mark done/i });
      fireEvent.click(markDoneBtn);
      expect(handleStatusChange).toHaveBeenCalledWith(activeTask.id, 'COMPLETED');

      const priorityBtn = screen.getByRole('radio', { name: /low/i });
      fireEvent.click(priorityBtn);
      expect(handlePriorityChange).toHaveBeenCalledWith(activeTask.id, 'LOW');

      unmount();

      const completedTask: TaskEntity = {
        ...mockTask,
        status: 'COMPLETED'
      };

      render(
        <TaskCard
          task={completedTask}
          decryptedPayload={mockDecrypted}
          onStatusChange={handleStatusChange}
        />
      );

      const reopenBtn = screen.getByRole('button', { name: /↺ reopen/i });
      fireEvent.click(reopenBtn);
      expect(handleStatusChange).toHaveBeenCalledWith(completedTask.id, 'PENDING');
    });

    it('hides cleartext when isDecrypted is false or decryptedPayload is missing', () => {
      render(<TaskCard task={mockTask} isDecrypted={false} />);
      expect(screen.getByText(/🔒 encrypted task content/i)).toBeInTheDocument();
      expect(screen.queryByText('Prepare Audit Report')).not.toBeInTheDocument();
    });
  });

  describe('TaskList', () => {
    const tasks: TaskEntity[] = [
      {
        id: 'task_001_mock_id_1234567',
        memoId: 'memo_001_mock_id_1234567',
        userId: 'usr_001_mock_id_1234567',
        encryptedPayload: { ciphertext: 'ct1', iv: 'iv1', authTag: 'tag1', keyId: 'v1' },
        category: 'FINANCE',
        priority: 'HIGH',
        status: 'PENDING',
        scheduledDate: null,
        tags: ['billing'],
        provenance: 'GEMINI_FLASH',
        modelVersion: 'gemini-2.5',
        createdAt: '2026-11-08T00:00:00.000Z',
        updatedAt: '2026-11-08T00:00:00.000Z'
      },
      {
        id: 'task_002_mock_id_1234567',
        memoId: 'memo_002_mock_id_1234567',
        userId: 'usr_001_mock_id_1234567',
        encryptedPayload: { ciphertext: 'ct2', iv: 'iv2', authTag: 'tag2', keyId: 'v1' },
        category: 'HEALTH',
        priority: 'LOW',
        status: 'COMPLETED',
        scheduledDate: null,
        tags: ['wellness'],
        provenance: 'DETERMINISTIC_FALLBACK',
        modelVersion: 'fallback-v1',
        createdAt: '2026-11-08T00:00:00.000Z',
        updatedAt: '2026-11-08T00:00:00.000Z'
      }
    ];

    const decryptedMap: Record<string, DecryptedTaskPayload> = {
      task_001_mock_id_1234567: {
        title: 'Review invoice ledger',
        summary: 'Detailed financial reconciliation',
        subtasks: [{ title: 'Check amounts', completed: true }]
      },
      task_002_mock_id_1234567: {
        title: 'Annual health checkup',
        summary: 'Schedule medical appointments',
        subtasks: [{ title: 'Book slot', completed: true }]
      }
    };

    it('renders list of tasks and filters by search query', () => {
      render(<TaskList tasks={tasks} decryptedPayloads={decryptedMap} isDecrypted={true} />);

      expect(screen.getByText('Review invoice ledger')).toBeInTheDocument();
      expect(screen.getByText('Annual health checkup')).toBeInTheDocument();

      const searchInput = screen.getByPlaceholderText(/search decrypted tasks/i);
      fireEvent.change(searchInput, { target: { value: 'invoice' } });

      expect(screen.getByText('Review invoice ledger')).toBeInTheDocument();
      expect(screen.queryByText('Annual health checkup')).not.toBeInTheDocument();
    });

    it('filters by status and category', () => {
      render(<TaskList tasks={tasks} decryptedPayloads={decryptedMap} isDecrypted={true} />);

      const completedStatusBtn = screen.getByRole('button', { name: 'COMPLETED' });
      fireEvent.click(completedStatusBtn);

      expect(screen.queryByText('Review invoice ledger')).not.toBeInTheDocument();
      expect(screen.getByText('Annual health checkup')).toBeInTheDocument();

      // Test category select change
      const categorySelect = screen.getByRole('combobox', { name: /^Category:$/i });
      fireEvent.change(categorySelect, { target: { value: 'FINANCE' } });
      // Neither should match completed + FINANCE
      expect(screen.queryByText('Annual health checkup')).not.toBeInTheDocument();

      // Test priority select change
      const prioritySelect = screen.getByRole('combobox', { name: /^Priority:$/i });
      fireEvent.change(prioritySelect, { target: { value: 'HIGH' } });
    });

    it('searches across tags and summary fields', () => {
      render(<TaskList tasks={tasks} decryptedPayloads={decryptedMap} isDecrypted={true} />);

      // Search by tag
      const searchInput = screen.getByPlaceholderText(/search decrypted tasks/i);
      fireEvent.change(searchInput, { target: { value: 'wellness' } });
      expect(screen.getByText('Annual health checkup')).toBeInTheDocument();
      expect(screen.queryByText('Review invoice ledger')).not.toBeInTheDocument();

      // Search by summary
      fireEvent.change(searchInput, { target: { value: 'reconciliation' } });
      expect(screen.getByText('Review invoice ledger')).toBeInTheDocument();
      expect(screen.queryByText('Annual health checkup')).not.toBeInTheDocument();
    });

    it('renders empty state when no task matches filters', () => {
      render(<TaskList tasks={tasks} decryptedPayloads={decryptedMap} isDecrypted={true} />);

      const searchInput = screen.getByPlaceholderText(/search decrypted tasks/i);
      fireEvent.change(searchInput, { target: { value: 'nonexistent keyword XYZ' } });

      expect(screen.getByTestId('task-list-empty')).toBeInTheDocument();
      expect(screen.getByText(/no tasks found matching your criteria/i)).toBeInTheDocument();

      const resetBtn = screen.getByRole('button', { name: /reset filters/i });
      fireEvent.click(resetBtn);
      expect(screen.getByText('Review invoice ledger')).toBeInTheDocument();
    });
  });

  describe('PrivacyAuditPanel', () => {
    it('displays privacy metrics and token counts accurately', () => {
      const handleLogout = vi.fn();
      render(
        <PrivacyAuditPanel
          metrics={{
            totalTokensMasked: 5,
            tokensByType: {
              EMAIL: 2,
              SECRET_KEY: 1,
              PHONE: 2
            },
            sessionRiskLevel: 'HIGH',
            hasActiveKey: true,
            draftsAwaitingReviewCount: 2
          }}
          onLogoutAndZeroKey={handleLogout}
        />
      );

      expect(screen.getByTestId('metric-email')).toHaveTextContent('2');
      expect(screen.getByTestId('metric-secret_key')).toHaveTextContent('1');
      expect(screen.getByTestId('drafts-review-alert')).toHaveTextContent('2');
      expect(screen.getByTestId('security-status-box')).toHaveTextContent(/webcrypto aes-256-gcm active/i);

      const logoutBtn = screen.getByRole('button', { name: /zero session key & logout/i });
      fireEvent.click(logoutBtn);
      expect(handleLogout).toHaveBeenCalledTimes(1);
    });
  });
});
