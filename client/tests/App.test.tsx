import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { App } from '../src/App';
import { ClientCryptoService } from '../src/services/ClientCryptoService';
import { gatewayClient } from '../src/services/GatewayClient';
import { TaskEntity } from '../src/types/contracts';

describe('App Root Component', () => {
  beforeEach(() => {
    ClientCryptoService.logout();
    vi.spyOn(gatewayClient, 'fetchTasks').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ClientCryptoService.logout();
  });

  it('renders application header, tabs, and automatically initializes session key', async () => {
    render(<App />);

    await waitFor(() => {
      expect(gatewayClient.fetchTasks).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText(/🎙️ oscar/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /task board/i })).toBeInTheDocument();

    // Verify session key initialized automatically and initial task hydration triggered
    expect(ClientCryptoService.hasSessionKey()).toBe(true);
    expect(screen.getByRole('button', { name: /logout and zero key/i })).toBeInTheDocument();
  });

  it('automatically hydrates and decrypts existing persisted tasks from backend on mount', async () => {
    ClientCryptoService.initializeSessionKey();
    const encryptedPayload = await ClientCryptoService.encrypt({
      title: 'Hydrated Firestore Review Task',
      summary: 'Persisted across page reload (F5)',
      subtasks: [{ title: 'Verify Firestore hydration', completed: false }],
    });

    const persistedTask: TaskEntity = {
      id: 'task_hydrated_mount_001',
      memoId: 'memo_hydrated_mount_001',
      userId: 'usr_default_session_01',
      encryptedPayload,
      category: 'WORK',
      priority: 'HIGH',
      status: 'PENDING',
      scheduledDate: null,
      tags: ['hydrated-tag'],
      provenance: 'GEMINI_FLASH',
      modelVersion: 'gemini-2.5-flash-001',
      createdAt: '2026-11-09T10:00:00.000Z',
      updatedAt: '2026-11-09T10:00:00.000Z',
    };

    vi.spyOn(gatewayClient, 'fetchTasks').mockResolvedValueOnce([persistedTask]);

    render(<App />);

    expect(gatewayClient.fetchTasks).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByText('Hydrated Firestore Review Task')).toBeInTheDocument();
    });
    expect(screen.getByText('#hydrated-tag')).toBeInTheDocument();
  });

  it('switches between Dashboard and Task Board tabs', async () => {
    render(<App />);
    await waitFor(() => {
      expect(gatewayClient.fetchTasks).toHaveBeenCalledTimes(1);
    });

    const boardTab = screen.getByRole('tab', { name: /task board/i });
    fireEvent.click(boardTab);

    expect(screen.getByTestId('taskboard-column-draft')).toBeInTheDocument();

    const dashTab = screen.getByRole('tab', { name: /dashboard/i });
    fireEvent.click(dashTab);

    expect(screen.getByText(/new confidential voice\/text memo/i)).toBeInTheDocument();
  });

  it('locks session and zeroes key when lock button is clicked in header', async () => {
    render(<App />);
    await waitFor(() => {
      expect(gatewayClient.fetchTasks).toHaveBeenCalledTimes(1);
    });

    const lockBtn = screen.getByRole('button', { name: /logout and zero key/i });
    fireEvent.click(lockBtn);

    expect(ClientCryptoService.hasSessionKey()).toBe(false);
    const initBtn = screen.getByRole('button', { name: /init session key/i });
    expect(initBtn).toBeInTheDocument();
    fireEvent.click(initBtn);
    expect(ClientCryptoService.hasSessionKey()).toBe(true);
  });

  it('persists created tasks across tabs and displays them in Task Board', async () => {
    render(<App />);
    await waitFor(() => {
      expect(gatewayClient.fetchTasks).toHaveBeenCalledTimes(1);
    });

    // In Dashboard, submit a new memo
    const textarea = screen.getByLabelText(/confidential memo input/i);
    fireEvent.change(textarea, {
      target: { value: 'Launch project kickoff meeting with team' },
    });

    const submitBtn = screen.getByRole('button', { name: /encrypt & process/i });
    fireEvent.click(submitBtn);

    // Wait for task creation to complete and render on Dashboard
    await waitFor(() => {
      expect(screen.getByText('#voice-memo')).toBeInTheDocument();
    });

    // Switch to Task Board tab
    const boardTab = screen.getByRole('tab', { name: /task board/i });
    fireEvent.click(boardTab);

    // Verify task is present on the Task Board immediately without re-fetching
    expect(screen.getAllByText('Launch project kickoff meeting with team').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('#voice-memo')).toBeInTheDocument();

    // Now lock & zero key
    const lockBtn = screen.getByRole('button', { name: /logout and zero key/i });
    fireEvent.click(lockBtn);

    // Once locked and zeroed, cleartext payload is cleared
    expect(ClientCryptoService.hasSessionKey()).toBe(false);
    expect(screen.queryAllByText('Launch project kickoff meeting with team').length).toBe(0);
    expect(screen.getByText('🔒 Encrypted Task Content')).toBeInTheDocument();
  });

  it('renders install app button in header when beforeinstallprompt event is dispatched', async () => {
    render(<App />);
    await waitFor(() => {
      expect(gatewayClient.fetchTasks).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByRole('button', { name: /install oscar app/i })).not.toBeInTheDocument();

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const event = new Event('beforeinstallprompt', {
      bubbles: true,
      cancelable: true,
    });
    Object.assign(event, {
      platforms: ['web'],
      prompt: promptMock,
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    });

    act(() => {
      window.dispatchEvent(event);
    });

    const installBtn = screen.getByRole('button', { name: /install oscar app/i });
    expect(installBtn).toBeInTheDocument();
  });
});
