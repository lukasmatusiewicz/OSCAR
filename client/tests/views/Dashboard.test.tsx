import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Dashboard } from '../../src/views/Dashboard';
import { ClientCryptoService } from '../../src/services/ClientCryptoService';
import { TaskEntity, DecryptedTaskPayload } from '../../src/types/contracts';

describe('Dashboard View', () => {
  beforeEach(() => {
    ClientCryptoService.initializeSessionKey();
  });

  afterEach(() => {
    ClientCryptoService.logout();
  });

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

  it('renders combined layout with MemoEditor, TaskList, and PrivacyAuditPanel', () => {
    render(<Dashboard initialTasks={mockTasks} initialDecrypted={mockDecrypted} />);

    expect(screen.getByText(/new confidential voice\/text memo/i)).toBeInTheDocument();
    expect(screen.getByText(/privacy shield & audit/i)).toBeInTheDocument();
    expect(screen.getByText('Sprint Planning Refinement')).toBeInTheDocument();
    expect(screen.getByText('Q4 Tax Filing Submission')).toBeInTheDocument();

    // Test task interaction within Dashboard view
    const confirmBtn = screen.getByRole('button', { name: /confirm task/i });
    fireEvent.click(confirmBtn);

    const checkbox = screen.getByLabelText('Estimate story points');
    fireEvent.click(checkbox);
  });

  it('submits a new memo and extracts task reactively', async () => {
    render(<Dashboard initialTasks={mockTasks} initialDecrypted={mockDecrypted} />);

    const textarea = screen.getByLabelText(/confidential memo input/i);
    fireEvent.change(textarea, {
      target: { value: 'Schedule meeting with engineer@oscar.dev regarding sk-12345678901234567890' },
    });

    const submitBtn = screen.getByRole('button', { name: /encrypt & process/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('#voice-memo')).toBeInTheDocument();
    });
  });

  it('zeroes key memory and shows alert when logout button is pressed', async () => {
    render(<Dashboard initialTasks={mockTasks} initialDecrypted={mockDecrypted} />);

    const logoutBtn = screen.getByRole('button', { name: /zero session key & logout/i });
    fireEvent.click(logoutBtn);

    expect(screen.getByText(/ephemeral key memory cleared/i)).toBeInTheDocument();
    expect(ClientCryptoService.hasSessionKey()).toBe(false);

    // Re-initialize key
    const reinitBtn = screen.getByRole('button', { name: /generate session key/i });
    fireEvent.click(reinitBtn);

    expect(ClientCryptoService.hasSessionKey()).toBe(true);
    expect(screen.queryByText(/ephemeral key memory cleared/i)).not.toBeInTheDocument();
  });

  it('applies responsive layout classes and container properties for desktop and mobile viewports', () => {
    const { container } = render(<Dashboard initialTasks={mockTasks} initialDecrypted={mockDecrypted} />);

    const dashboardEl = container.querySelector('.oscar-dashboard-view');
    expect(dashboardEl).toBeInTheDocument();
    expect(dashboardEl).toHaveStyle({
      maxWidth: '1280px',
      boxSizing: 'border-box',
      width: '100%',
    });

    const asideEl = container.querySelector('.oscar-dashboard-aside');
    expect(asideEl).toBeInTheDocument();
    expect(asideEl).toHaveClass('oscar-dashboard-aside');
    expect(asideEl).toHaveStyle({ width: '100%' });
    expect(asideEl?.getAttribute('style')).toContain('min-width: 0');

    const mainEl = container.querySelector('main');
    expect(mainEl).toBeInTheDocument();
    expect(mainEl).toHaveStyle({ width: '100%' });
    expect(mainEl?.getAttribute('style')).toContain('min-width: 0');
  });
});
