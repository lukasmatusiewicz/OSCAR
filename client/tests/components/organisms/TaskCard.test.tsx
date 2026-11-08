import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskCard } from '../../../src/components/organisms/TaskCard';
import { TaskEntity, DecryptedTaskPayload, TaskStatus } from '../../../src/types/contracts';

describe('TaskCard', () => {
  const mockTask: TaskEntity = {
    id: 'task_001_mock_id_1234567',
    memoId: 'memo_001_mock_id_1234567',
    userId: 'usr_001_mock_id_1234567',
    encryptedPayload: {
      ciphertext: 'base64ct',
      iv: 'base64iv',
      authTag: 'base64tag',
      keyId: 'v1',
    },
    category: 'WORK',
    priority: 'HIGH',
    status: 'DRAFT',
    scheduledDate: '2026-11-15T10:00:00.000Z',
    tags: ['audit', 'compliance'],
    provenance: 'GEMINI_FLASH',
    modelVersion: 'gemini-2.5-flash-001',
    createdAt: '2026-11-08T00:00:00.000Z',
    updatedAt: '2026-11-08T00:00:00.000Z',
  };

  const mockDecrypted: DecryptedTaskPayload = {
    title: 'Prepare Audit Report',
    summary: 'Reconcile compliance records and secure logs',
    subtasks: [
      { title: 'Check access tokens', completed: false },
      { title: 'Confirm encryption at rest', completed: true },
    ],
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
      status: 'PENDING',
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
      status: 'COMPLETED',
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

  it('falls back to pending style for unknown task status', () => {
    render(
      <TaskCard
        task={{ ...mockTask, status: 'CUSTOM' as unknown as TaskStatus }}
        decryptedPayload={mockDecrypted}
      />
    );
    expect(screen.getByText('Prepare Audit Report')).toBeInTheDocument();
  });
});
