import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { ClientCryptoService } from '../src/services/ClientCryptoService';

describe('App Root Component', () => {
  beforeEach(() => {
    ClientCryptoService.logout();
  });

  afterEach(() => {
    ClientCryptoService.logout();
  });

  it('renders application header, tabs, and automatically initializes session key', () => {
    render(<App />);

    expect(screen.getByText(/🎙️ oscar/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /task board/i })).toBeInTheDocument();

    // Verify session key initialized automatically
    expect(ClientCryptoService.hasSessionKey()).toBe(true);
    expect(screen.getByRole('button', { name: /logout and zero key/i })).toBeInTheDocument();
  });

  it('switches between Dashboard and Task Board tabs', () => {
    render(<App />);

    const boardTab = screen.getByRole('tab', { name: /task board/i });
    fireEvent.click(boardTab);

    expect(screen.getByTestId('taskboard-column-draft')).toBeInTheDocument();

    const dashTab = screen.getByRole('tab', { name: /dashboard/i });
    fireEvent.click(dashTab);

    expect(screen.getByText(/new confidential voice\/text memo/i)).toBeInTheDocument();
  });

  it('locks session and zeroes key when lock button is clicked in header', () => {
    render(<App />);

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
});
