import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenPreviewBadge } from '../../../src/components/molecules/TokenPreviewBadge';
import { PIIType } from '../../../src/types/contracts';

describe('TokenPreviewBadge', () => {
  it('renders masked token representation without leaking cleartext', () => {
    render(<TokenPreviewBadge token="[EMAIL_1]" type="EMAIL" />);
    const badge = screen.getByTestId('token-badge-EMAIL_1');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('[EMAIL_1]');
    expect(badge).toHaveTextContent('[Email]');
    // Guarantee cleartext was not passed or rendered
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it('renders all PII token types cleanly', () => {
    const types: PIIType[] = [
      'SECRET_KEY',
      'IBAN',
      'EMAIL',
      'PHONE',
      'AMOUNT_MONEY',
      'PERSON',
    ];

    types.forEach((t, i) => {
      const token = `[${t}_${i + 1}]`;
      const { unmount } = render(<TokenPreviewBadge token={token} type={t} />);
      expect(screen.getByRole('note')).toHaveAttribute('aria-label', expect.stringContaining(token));
      unmount();
    });

    // Fallback token type
    render(<TokenPreviewBadge token="[CUSTOM_1]" type={'CUSTOM' as unknown as PIIType} />);
    expect(screen.getByRole('note')).toHaveAttribute('aria-label', expect.stringContaining('[CUSTOM_1]'));
  });
});
