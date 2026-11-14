import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrivacyAuditPanel } from '../../../src/components/organisms/PrivacyAuditPanel';

describe('PrivacyAuditPanel', () => {
  it('displays privacy metrics and triggers logout only after confirmation', () => {
    const handleLogout = vi.fn();
    render(
      <PrivacyAuditPanel
        metrics={{
          totalTokensMasked: 5,
          tokensByType: {
            EMAIL: 2,
            SECRET_KEY: 1,
            PHONE: 2,
          },
          sessionRiskLevel: 'HIGH',
          hasActiveKey: true,
          draftsAwaitingReviewCount: 2,
        }}
        onLogoutAndZeroKey={handleLogout}
      />
    );

    expect(screen.getByTestId('metric-email')).toHaveTextContent('2');
    expect(screen.getByTestId('metric-secret_key')).toHaveTextContent('1');
    expect(screen.getByTestId('drafts-review-alert')).toHaveTextContent('2');
    expect(screen.getByTestId('security-status-box')).toHaveTextContent(/webcrypto aes-256-gcm active/i);
    expect(screen.getByRole('status')).toHaveTextContent(/high privacy sensitivity/i);

    const logoutBtn = screen.getByTestId('logout-zero-key-btn');
    fireEvent.click(logoutBtn);

    // Must not zero immediately; opens accessible confirmation dialog first
    expect(handleLogout).not.toHaveBeenCalled();
    const dialog = screen.getByTestId('lock-confirm-dialog');
    expect(dialog).toHaveAttribute('role', 'alertdialog');
    expect(dialog).toHaveAttribute('aria-label', 'Confirm session key lock');
    expect(dialog).toHaveTextContent(/irreversible/i);
    expect(dialog).toHaveTextContent(/undecryptable/i);

    fireEvent.click(screen.getByTestId('confirm-lock-key-btn'));
    expect(handleLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('lock-confirm-dialog')).not.toBeInTheDocument();
  });

  it('dismisses lock confirmation dialog on Cancel or Escape without calling onLogoutAndZeroKey', () => {
    const handleLogout = vi.fn();
    render(
      <PrivacyAuditPanel
        metrics={{
          totalTokensMasked: 0,
          tokensByType: {},
          sessionRiskLevel: 'NONE',
          hasActiveKey: true,
        }}
        onLogoutAndZeroKey={handleLogout}
      />
    );

    fireEvent.click(screen.getByTestId('logout-zero-key-btn'));
    const dialog = screen.getByTestId('lock-confirm-dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId('cancel-lock-key-btn')).toHaveFocus();

    fireEvent.click(screen.getByTestId('cancel-lock-key-btn'));
    expect(handleLogout).not.toHaveBeenCalled();
    expect(screen.queryByTestId('lock-confirm-dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('logout-zero-key-btn')).toHaveFocus();

    // Also verify Escape key dismissal
    fireEvent.click(screen.getByTestId('logout-zero-key-btn'));
    fireEvent.keyDown(screen.getByTestId('lock-confirm-dialog'), { key: 'Escape' });
    expect(handleLogout).not.toHaveBeenCalled();
    expect(screen.queryByTestId('lock-confirm-dialog')).not.toBeInTheDocument();
  });

  it('renders Init Session Key button when hasActiveKey is false and toggles Simulate Offline', () => {
    const handleLogout = vi.fn();
    const handleInitKey = vi.fn();
    const handleToggleOffline = vi.fn();

    render(
      <PrivacyAuditPanel
        metrics={{
          totalTokensMasked: 0,
          tokensByType: {},
          sessionRiskLevel: 'NONE',
          hasActiveKey: false,
        }}
        onLogoutAndZeroKey={handleLogout}
        onInitializeKey={handleInitKey}
        simulateOffline={true}
        onToggleSimulateOffline={handleToggleOffline}
      />
    );

    const initBtn = screen.getByRole('button', { name: /init session key/i });
    fireEvent.click(initBtn);
    expect(handleInitKey).toHaveBeenCalledTimes(1);

    const offlineSwitch = screen.getByRole('switch', { name: /simulate offline/i });
    expect(offlineSwitch).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(offlineSwitch);
    expect(handleToggleOffline).toHaveBeenCalledTimes(1);
  });
});
