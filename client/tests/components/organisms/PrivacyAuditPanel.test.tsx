import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrivacyAuditPanel } from '../../../src/components/organisms/PrivacyAuditPanel';

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

    const logoutBtn = screen.getByRole('button', { name: /zero session key & logout/i });
    fireEvent.click(logoutBtn);
    expect(handleLogout).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(/high privacy sensitivity/i);
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
