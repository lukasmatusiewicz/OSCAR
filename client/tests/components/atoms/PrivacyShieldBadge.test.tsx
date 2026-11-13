import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrivacyShieldBadge } from '../../../src/components/atoms/PrivacyShieldBadge';
import { RiskLevel } from '../../../src/types/contracts';

describe('PrivacyShieldBadge', () => {
  it('renders shield with risk level label and token count', () => {
    render(<PrivacyShieldBadge riskLevel="MEDIUM" isSecured={true} tokenCount={3} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', expect.stringContaining('Sanitized'));
    expect(screen.getByTestId('privacy-shield-token-count')).toHaveTextContent('3');
  });

  it('renders high risk warning styling and NONE risk correctly', () => {
    const { unmount } = render(<PrivacyShieldBadge riskLevel="HIGH" isSecured={true} tokenCount={8} />);
    expect(screen.getByText(/high privacy sensitivity/i)).toBeInTheDocument();
    unmount();

    render(<PrivacyShieldBadge riskLevel="NONE" isSecured={true} tokenCount={0} />);
    expect(screen.getByText(/no pii detected/i)).toBeInTheDocument();
  });

  it('renders offline indicator when isSecured is false', () => {
    render(<PrivacyShieldBadge isSecured={false} />);
    expect(screen.getByText(/shield offline/i)).toBeInTheDocument();
  });

  it('triggers onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<PrivacyShieldBadge onClick={handleClick} />);
    fireEvent.click(screen.getByRole('status'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('renders default fallback styling for unknown risk level', () => {
    render(<PrivacyShieldBadge riskLevel={'CUSTOM' as unknown as RiskLevel} isSecured={true} />);
    expect(screen.getByText('Shield Active')).toBeInTheDocument();
  });
});
