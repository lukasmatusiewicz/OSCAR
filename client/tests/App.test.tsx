import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { App } from '../src/App';
import { ClientCryptoService } from '../src/services/ClientCryptoService';
import { gatewayClient } from '../src/services/GatewayClient';
import { TaskEntity } from '../src/types/contracts';

describe('App Root Component', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    ClientCryptoService.logout();
    vi.spyOn(gatewayClient, 'fetchTasks').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    ClientCryptoService.logout();
  });

  it('renders application header, tabs, and automatically initializes session key', async () => {
    render(<App />);

    await waitFor(() => {
      expect(gatewayClient.fetchTasks).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText(/🎙️ oscar/i)).toBeInTheDocument();
    const header = screen.getByRole('banner');
    const switcherBar = screen.getByTestId('view-switcher-bar');
    const nav = screen.getByRole('navigation', { name: /primary navigation/i });
    expect(nav).toBeInTheDocument();
    expect(nav).toHaveClass('oscar-nav-switcher');
    expect(switcherBar).toContainElement(nav);
    expect(header).not.toContainElement(nav);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();

    const dashBtn = screen.getByRole('button', { name: /^dashboard$/i });
    const boardBtn = screen.getByRole('button', { name: /^task board$/i });
    expect(dashBtn).toHaveClass('oscar-nav-pill', 'oscar-nav-pill--active');
    expect(boardBtn).toHaveClass('oscar-nav-pill');
    expect(boardBtn).not.toHaveClass('oscar-nav-pill--active');
    expect(dashBtn).toHaveAttribute('aria-current', 'page');
    expect(boardBtn).not.toHaveAttribute('aria-current');

    // Verify session key initialized automatically and initial task hydration triggered
    expect(ClientCryptoService.hasSessionKey()).toBe(true);
    expect(screen.getByRole('button', { name: /zero session key & logout/i })).toBeInTheDocument();

    // Verify top header is clean (privacy badge, offline toggle, and lock/key button moved to PrivacyAuditPanel)
    expect(within(header).queryByTestId('simulate-offline-toggle')).not.toBeInTheDocument();
    expect(within(header).queryByText(/no pii detected/i)).not.toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: /zero session key & logout/i })).not.toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: /init session key/i })).not.toBeInTheDocument();
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

    const boardBtn = screen.getByRole('button', { name: /^task board$/i });
    fireEvent.click(boardBtn);

    expect(boardBtn).toHaveAttribute('aria-current', 'page');
    expect(boardBtn).toHaveClass('oscar-nav-pill--active');
    const dashBtn = screen.getByRole('button', { name: /^dashboard$/i });
    expect(dashBtn).not.toHaveAttribute('aria-current');
    expect(dashBtn).not.toHaveClass('oscar-nav-pill--active');
    expect(screen.getByTestId('taskboard-column-draft')).toBeInTheDocument();

    fireEvent.click(dashBtn);

    expect(dashBtn).toHaveAttribute('aria-current', 'page');
    expect(dashBtn).toHaveClass('oscar-nav-pill--active');
    expect(boardBtn).not.toHaveAttribute('aria-current');
    expect(boardBtn).not.toHaveClass('oscar-nav-pill--active');
    expect(screen.getByText(/new confidential voice\/text memo/i)).toBeInTheDocument();
  });

  it('locks session and zeroes key only after lock confirmation in PrivacyAuditPanel', async () => {
    render(<App />);
    await waitFor(() => {
      expect(gatewayClient.fetchTasks).toHaveBeenCalledTimes(1);
    });

    const auditPanel = screen.getByRole('complementary', {
      name: /privacy and security audit panel/i,
    });
    const lockBtn = within(auditPanel).getByTestId('logout-zero-key-btn');
    fireEvent.click(lockBtn);

    // Confirmation dialog opens without zeroing key immediately
    const confirmDialog = within(auditPanel).getByTestId('lock-confirm-dialog');
    expect(confirmDialog).toHaveAttribute('role', 'alertdialog');
    expect(confirmDialog).toHaveTextContent(/irreversible/i);
    expect(ClientCryptoService.hasSessionKey()).toBe(true);

    // Cancelling preserves the key
    fireEvent.click(within(auditPanel).getByTestId('cancel-lock-key-btn'));
    expect(within(auditPanel).queryByTestId('lock-confirm-dialog')).not.toBeInTheDocument();
    expect(ClientCryptoService.hasSessionKey()).toBe(true);
    expect(window.sessionStorage.getItem('oscar_session_key')).toBeTruthy();

    // Confirming zeroes both RAM and sessionStorage
    fireEvent.click(within(auditPanel).getByTestId('logout-zero-key-btn'));
    fireEvent.click(within(auditPanel).getByTestId('confirm-lock-key-btn'));

    expect(ClientCryptoService.hasSessionKey()).toBe(false);
    expect(window.sessionStorage.getItem('oscar_session_key')).toBeNull();
    const initBtn = within(auditPanel).getByRole('button', { name: /init session key/i });
    expect(initBtn).toBeInTheDocument();
    fireEvent.click(initBtn);
    expect(ClientCryptoService.hasSessionKey()).toBe(true);
    expect(window.sessionStorage.getItem('oscar_session_key')).toBeTruthy();
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

    // Switch to Task Board view
    const boardBtn = screen.getByRole('button', { name: /^task board$/i });
    fireEvent.click(boardBtn);

    // Verify task is present on the Task Board immediately without re-fetching
    expect(screen.getAllByText('Launch project kickoff meeting with team').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('#voice-memo')).toBeInTheDocument();

    // Switch back to Dashboard to lock & zero key via PrivacyAuditPanel, then return to Task Board
    const dashBtn = screen.getByRole('button', { name: /^dashboard$/i });
    fireEvent.click(dashBtn);

    const lockBtn = screen.getByTestId('logout-zero-key-btn');
    fireEvent.click(lockBtn);
    fireEvent.click(screen.getByTestId('confirm-lock-key-btn'));

    fireEvent.click(screen.getByRole('button', { name: /^task board$/i }));

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

  it('initializes session key before fetchTasks on F5 reload so stale tasks enter undecryptable state', async () => {
    // Simulate a task encrypted with a previous session's key (lost on F5 reload)
    ClientCryptoService.initializeSessionKey();
    const staleEncryptedPayload = await ClientCryptoService.encrypt({
      title: 'Previous Session Secret Task',
      summary: 'Encrypted before F5 reload',
      subtasks: [{ title: 'Should not decrypt with new key', completed: false }],
    });
    ClientCryptoService.logout();

    const staleTask: TaskEntity = {
      id: 'task_stale_f5_001',
      memoId: 'memo_stale_f5_001',
      userId: 'usr_default_session_01',
      encryptedPayload: staleEncryptedPayload,
      category: 'WORK',
      priority: 'MEDIUM',
      status: 'PENDING',
      scheduledDate: null,
      tags: ['stale-key'],
      provenance: 'GEMINI_FLASH',
      modelVersion: 'gemini-2.5-flash-001',
      createdAt: '2026-11-13T10:00:00.000Z',
      updatedAt: '2026-11-13T10:00:00.000Z',
    };

    const callOrder: string[] = [];
    const origInit = ClientCryptoService.initializeSessionKey.bind(ClientCryptoService);
    vi.spyOn(ClientCryptoService, 'initializeSessionKey').mockImplementation((key) => {
      callOrder.push('initializeSessionKey');
      return origInit(key);
    });

    vi.spyOn(gatewayClient, 'fetchTasks').mockImplementation(async () => {
      callOrder.push('fetchTasks');
      expect(ClientCryptoService.hasSessionKey()).toBe(true);
      return [staleTask];
    });

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByText(/cannot decrypt: encrypted with a previous session key \(lost on page reload\)\./i),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/active session key required to view cleartext/i),
    ).not.toBeInTheDocument();
    expect(callOrder.indexOf('initializeSessionKey')).toBeLessThan(
      callOrder.indexOf('fetchTasks'),
    );
  });

  it('restores session key from sessionStorage across same-tab F5 reload and decrypts persisted tasks', async () => {
    ClientCryptoService.initializeSessionKey();
    const persistedKeyBase64 = window.sessionStorage.getItem('oscar_session_key');
    expect(persistedKeyBase64).toBeTruthy();

    const encryptedPayload = await ClientCryptoService.encrypt({
      title: 'Survived Tab Reload Task',
      summary: 'Decrypted automatically via sessionStorage key after F5',
      subtasks: [{ title: 'Verify seamless F5 decryption', completed: false }],
    });

    // Simulate same-tab F5 reload: RAM KEY_STORE wiped without calling logout(), sessionStorage preserved
    (ClientCryptoService as unknown as { KEY_STORE: Uint8Array | null }).KEY_STORE = null;
    expect(ClientCryptoService.hasSessionKey()).toBe(false);
    expect(window.sessionStorage.getItem('oscar_session_key')).toBe(persistedKeyBase64);

    const persistedTask: TaskEntity = {
      id: 'task_f5_restored_001',
      memoId: 'memo_f5_restored_001',
      userId: 'usr_default_session_01',
      encryptedPayload,
      category: 'WORK',
      priority: 'HIGH',
      status: 'PENDING',
      scheduledDate: null,
      tags: ['f5-restored'],
      provenance: 'GEMINI_FLASH',
      modelVersion: 'gemini-2.5-flash-001',
      createdAt: '2026-11-14T00:00:00.000Z',
      updatedAt: '2026-11-14T00:00:00.000Z',
    };

    vi.spyOn(gatewayClient, 'fetchTasks').mockImplementation(async () => {
      expect(ClientCryptoService.hasSessionKey()).toBe(true);
      expect(ClientCryptoService.exportKeyForHeader()).toBe(persistedKeyBase64);
      return [persistedTask];
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Survived Tab Reload Task')).toBeInTheDocument();
    });
    expect(screen.getByText('#f5-restored')).toBeInTheDocument();
    expect(
      screen.queryByText(/cannot decrypt: encrypted with a previous session key/i),
    ).not.toBeInTheDocument();
  });
});
