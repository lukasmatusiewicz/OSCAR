import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskList } from '../../../src/components/organisms/TaskList';
import { TaskEntity, DecryptedTaskPayload } from '../../../src/types/contracts';

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
      updatedAt: '2026-11-08T00:00:00.000Z',
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
      updatedAt: '2026-11-08T00:00:00.000Z',
    },
  ];

  const decryptedMap: Record<string, DecryptedTaskPayload> = {
    task_001_mock_id_1234567: {
      title: 'Review invoice ledger',
      summary: 'Detailed financial reconciliation',
      subtasks: [{ title: 'Check amounts', completed: true }],
    },
    task_002_mock_id_1234567: {
      title: 'Annual health checkup',
      summary: 'Schedule medical appointments',
      subtasks: [{ title: 'Book slot', completed: true }],
    },
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
  });

  it('filters by priority and handles tasks with missing payloads or tags', () => {
    const rawTask: TaskEntity = {
      ...tasks[0],
      id: 'task_raw_no_payload',
      priority: 'LOW',
      tags: [],
    };
    render(<TaskList tasks={[...tasks, rawTask]} decryptedPayloads={decryptedMap} isDecrypted={true} />);

    const prioritySelect = screen.getByRole('combobox', { name: /^Priority:$/i });
    fireEvent.change(prioritySelect, { target: { value: 'LOW' } });

    expect(screen.getByText('Annual health checkup')).toBeInTheDocument();
    expect(screen.queryByText('Review invoice ledger')).not.toBeInTheDocument();

    // Search query that checks payload?.title / summary ?? false and tags?.some ?? false
    const searchInput = screen.getByPlaceholderText(/search decrypted tasks/i);
    fireEvent.change(searchInput, { target: { value: 'checkup' } });
    expect(screen.getByText('Annual health checkup')).toBeInTheDocument();
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
