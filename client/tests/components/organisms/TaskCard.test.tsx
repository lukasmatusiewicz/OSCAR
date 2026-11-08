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

  it('renders Smart Metadata Chips in DRAFT mode', () => {
    const taskWithMetadata: TaskEntity = {
      ...mockTask,
      scheduledDate: '2026-11-20T14:00:00Z',
    };
    const decryptedWithMetadata: DecryptedTaskPayload = {
      ...mockDecrypted,
      location: 'Kassel, Room 4B',
      contactPerson: 'Dr. Schmidt',
      amount: '1,500 EUR',
      scheduledTime: '2026-11-20 at 14:00',
    };

    render(
      <TaskCard
        task={taskWithMetadata}
        decryptedPayload={decryptedWithMetadata}
      />
    );

    expect(screen.getByTestId('smart-metadata-chips')).toBeInTheDocument();
    expect(screen.getByTestId('metadata-chip-scheduled')).toHaveTextContent(/2026-11-20/);
    expect(screen.getByTestId('metadata-chip-location')).toHaveTextContent('Kassel, Room 4B');
    expect(screen.getByTestId('metadata-chip-contact')).toHaveTextContent('Dr. Schmidt');
    expect(screen.getByTestId('metadata-chip-amount')).toHaveTextContent('1,500 EUR');
  });

  it('toggles interactive draft edit mode, edits fields, and confirms & saves task', () => {
    const handleStatusChange = vi.fn();
    const handleTaskUpdate = vi.fn();

    render(
      <TaskCard
        task={mockTask}
        decryptedPayload={mockDecrypted}
        onStatusChange={handleStatusChange}
        onTaskUpdate={handleTaskUpdate}
      />
    );

    // Edit button should be present in DRAFT mode
    const editBtn = screen.getByRole('button', { name: /edit draft/i });
    fireEvent.click(editBtn);

    // Draft edit mode is active
    expect(screen.getByTestId('draft-edit-mode')).toBeInTheDocument();

    // Edit Title & Summary
    const titleInput = screen.getByRole('textbox', { name: /^title$/i });
    fireEvent.change(titleInput, { target: { value: 'Updated Audit Report Title' } });

    const summaryInput = screen.getByRole('textbox', { name: /^summary$/i });
    fireEvent.change(summaryInput, { target: { value: 'Updated Summary with details' } });

    // Edit Location, Contact Person, Amount, Scheduled Time
    const locationInput = screen.getByLabelText(/location/i);
    fireEvent.change(locationInput, { target: { value: 'Berlin Office' } });

    const contactInput = screen.getByLabelText(/contact person/i);
    fireEvent.change(contactInput, { target: { value: 'Anna Nowak' } });

    const amountInput = screen.getByLabelText(/amount/i);
    fireEvent.change(amountInput, { target: { value: '2500 PLN' } });

    const timeInput = screen.getByLabelText(/scheduled time/i);
    fireEvent.change(timeInput, { target: { value: 'Tomorrow at 10:00' } });

    // Subtasks editor: add an item
    const addItemBtn = screen.getByRole('button', { name: /\+ add item/i });
    fireEvent.click(addItemBtn);

    // Toggle subtask 2 completed checkbox in edit mode
    const subtask2Checkbox = screen.getByLabelText(/subtask 2 completed/i);
    fireEvent.click(subtask2Checkbox);

    // Edit new item title
    const subtaskInputs = screen.getAllByPlaceholderText(/subtask #/i);
    expect(subtaskInputs.length).toBe(3);
    fireEvent.change(subtaskInputs[2], { target: { value: 'New item to verify' } });

    // Remove first item
    const removeBtn = screen.getByRole('button', { name: /remove subtask 1/i });
    fireEvent.click(removeBtn);

    // Click Confirm & Save Task
    const saveBtn = screen.getByRole('button', { name: /confirm & save task/i });
    fireEvent.click(saveBtn);

    expect(handleTaskUpdate).toHaveBeenCalledWith(
      mockTask.id,
      expect.objectContaining({
        title: 'Updated Audit Report Title',
        summary: 'Updated Summary with details',
        location: 'Berlin Office',
        contactPerson: 'Anna Nowak',
        amount: '2500 PLN',
        scheduledTime: 'Tomorrow at 10:00',
        subtasks: expect.arrayContaining([
          expect.objectContaining({ title: 'Confirm encryption at rest' }),
          expect.objectContaining({ title: 'New item to verify' }),
        ]),
      })
    );
    expect(handleStatusChange).toHaveBeenCalledWith(mockTask.id, 'PENDING');
  });

  it('cancels draft edit mode when Cancel button is clicked', () => {
    const handleTaskUpdate = vi.fn();
    render(
      <TaskCard
        task={mockTask}
        decryptedPayload={mockDecrypted}
        onTaskUpdate={handleTaskUpdate}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit draft/i }));
    expect(screen.getByTestId('draft-edit-mode')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByTestId('draft-edit-mode')).not.toBeInTheDocument();
    expect(handleTaskUpdate).not.toHaveBeenCalled();
  });

  it('falls back to default action item when saving draft with empty subtasks', () => {
    const handleTaskUpdate = vi.fn();
    render(
      <TaskCard
        task={mockTask}
        decryptedPayload={{
          ...mockDecrypted,
          subtasks: [],
        }}
        onTaskUpdate={handleTaskUpdate}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit draft/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm & save task/i }));

    expect(handleTaskUpdate).toHaveBeenCalledWith(
      mockTask.id,
      expect.objectContaining({
        subtasks: [{ title: 'Action Item', completed: false }],
      })
    );
  });

  it('renders offline fallback provenance badge when provenance is DETERMINISTIC_FALLBACK', () => {
    const fallbackTask: TaskEntity = {
      ...mockTask,
      provenance: 'DETERMINISTIC_FALLBACK',
      modelVersion: 'rule-based-v1',
    };

    render(<TaskCard task={fallbackTask} decryptedPayload={mockDecrypted} />);
    expect(screen.getByText(/⚡ offline fallback/i)).toBeInTheDocument();
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
