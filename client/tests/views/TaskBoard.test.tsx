import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskBoard } from '../../src/views/TaskBoard';
import { TaskEntity, DecryptedTaskPayload } from '../../src/types/contracts';

describe('TaskBoard View', () => {
  const mockTasks: TaskEntity[] = [
    {
      id: 'task_001_mock_id_1234567',
      memoId: 'memo_001_mock_id_1234567',
      userId: 'usr_001_mock_id_1234567',
      encryptedPayload: {
        ciphertext: 'AAAA',
        iv: 'AAAAAAAAAAAAAAAA',
        authTag: 'AAAAAAAAAAAAAAAAAAAAAA==',
        keyId: 'v1',
      },
      category: 'WORK',
      priority: 'HIGH',
      status: 'DRAFT',
      scheduledDate: null,
      tags: ['sprint'],
      provenance: 'GEMINI_FLASH',
      modelVersion: 'gemini-2.5',
      createdAt: '2026-11-08T00:00:00.000Z',
      updatedAt: '2026-11-08T00:00:00.000Z',
    },
    {
      id: 'task_002_mock_id_1234567',
      memoId: 'memo_002_mock_id_1234567',
      userId: 'usr_001_mock_id_1234567',
      encryptedPayload: {
        ciphertext: 'AAAA',
        iv: 'AAAAAAAAAAAAAAAA',
        authTag: 'AAAAAAAAAAAAAAAAAAAAAA==',
        keyId: 'v1',
      },
      category: 'FINANCE',
      priority: 'MEDIUM',
      status: 'PENDING',
      scheduledDate: null,
      tags: ['tax'],
      provenance: 'GEMINI_FLASH',
      modelVersion: 'gemini-2.5',
      createdAt: '2026-11-08T00:00:00.000Z',
      updatedAt: '2026-11-08T00:00:00.000Z',
    },
  ];

  const mockDecrypted: Record<string, DecryptedTaskPayload> = {
    task_001_mock_id_1234567: {
      title: 'Sprint Planning Refinement',
      summary: 'Review user stories and backlog',
      subtasks: [{ title: 'Estimate story points', completed: false }],
    },
    task_002_mock_id_1234567: {
      title: 'Q4 Tax Filing Submission',
      summary: 'Transmit documents to CPA',
      subtasks: [{ title: 'Sign forms', completed: true }],
    },
  };

  it('distributes tasks into columns based on status', () => {
    render(
      <TaskBoard
        tasks={mockTasks}
        decryptedPayloads={mockDecrypted}
        isDecrypted={true}
      />
    );

    const reviewCol = screen.getByTestId('taskboard-column-draft');
    const backlogCol = screen.getByTestId('taskboard-column-pending');
    const inProgressCol = screen.getByTestId('taskboard-column-in_progress');
    const completedCol = screen.getByTestId('taskboard-column-completed');

    expect(reviewCol).toHaveTextContent('Sprint Planning Refinement');
    expect(backlogCol).toHaveTextContent('Q4 Tax Filing Submission');
    expect(inProgressCol).toHaveTextContent('No tasks');
    expect(completedCol).toHaveTextContent('No tasks');
  });

  it('relays callbacks for status change, priority change, and subtask toggle', () => {
    const handleStatusChange = vi.fn();
    const handlePriorityChange = vi.fn();
    const handleSubtaskToggle = vi.fn();

    render(
      <TaskBoard
        tasks={mockTasks}
        decryptedPayloads={mockDecrypted}
        isDecrypted={true}
        onStatusChange={handleStatusChange}
        onPriorityChange={handlePriorityChange}
        onSubtaskToggle={handleSubtaskToggle}
      />
    );

    const confirmBtn = screen.getByRole('button', { name: /confirm task/i });
    fireEvent.click(confirmBtn);
    expect(handleStatusChange).toHaveBeenCalledWith('task_001_mock_id_1234567', 'PENDING');

    const checkbox = screen.getByLabelText('Estimate story points');
    fireEvent.click(checkbox);
    expect(handleSubtaskToggle).toHaveBeenCalledWith('task_001_mock_id_1234567', 0, true);
  });
});
