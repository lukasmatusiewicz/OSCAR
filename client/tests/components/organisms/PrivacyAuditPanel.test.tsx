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
  });
});
