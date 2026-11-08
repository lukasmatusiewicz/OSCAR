import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../../src/components/atoms/Button';
import { Input } from '../../src/components/atoms/Input';
import { Badge } from '../../src/components/atoms/Badge';
import { PrivacyShieldBadge } from '../../src/components/atoms/PrivacyShieldBadge';

describe('Atoms Components', () => {
  describe('Button', () => {
    it('renders with children and handles click events', () => {
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>Click Me</Button>);
      const button = screen.getByRole('button', { name: /click me/i });
      expect(button).toBeInTheDocument();
      fireEvent.click(button);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('renders loading spinner and sets aria-busy when isLoading is true', () => {
      render(<Button isLoading>Saving</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByTestId('button-spinner')).toBeInTheDocument();
      expect(button).toBeDisabled();
    });

    it('renders left and right icons correctly', () => {
      render(
        <Button leftIcon={<span data-testid="left-icon">←</span>} rightIcon={<span data-testid="right-icon">→</span>}>
          Next
        </Button>
      );
      expect(screen.getByTestId('left-icon')).toBeInTheDocument();
      expect(screen.getByTestId('right-icon')).toBeInTheDocument();
    });

    it('renders all variant styles without crashing', () => {
      const variants = ['primary', 'secondary', 'danger', 'ghost', 'icon'] as const;
      variants.forEach((v) => {
        const { unmount } = render(<Button variant={v}>{v}</Button>);
        expect(screen.getByRole('button', { name: v })).toBeInTheDocument();
        unmount();
      });
    });
  });

  describe('Input', () => {
    it('renders text input with label and helper text', () => {
      render(<Input label="Username" helperText="Enter your handle" placeholder="johndoe" />);
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
      expect(screen.getByText(/enter your handle/i)).toBeInTheDocument();
    });

    it('renders error message and aria-invalid on error', () => {
      render(<Input label="Email" error="Invalid email address" />);
      const input = screen.getByLabelText(/email/i);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid email address');
    });

    it('renders textarea when isTextArea is true', () => {
      render(<Input label="Memo" isTextArea rows={5} placeholder="Speak or type..." />);
      const textarea = screen.getByPlaceholderText(/speak or type/i);
      expect(textarea.tagName).toBe('TEXTAREA');
      expect(textarea).toHaveAttribute('rows', '5');
    });

    it('renders clear button and triggers onClear callback', () => {
      const handleClear = vi.fn();
      const { unmount } = render(<Input value="Test text" onChange={() => {}} onClear={handleClear} />);
      const clearBtn = screen.getByRole('button', { name: /clear input/i });
      expect(clearBtn).toBeInTheDocument();
      fireEvent.click(clearBtn);
      expect(handleClear).toHaveBeenCalledTimes(1);
      unmount();

      // Test onClear on textarea
      render(<Input isTextArea value="Long text" onChange={() => {}} onClear={handleClear} />);
      const clearAreaBtn = screen.getByRole('button', { name: /clear input/i });
      expect(clearAreaBtn).toBeInTheDocument();
      fireEvent.click(clearAreaBtn);
      expect(handleClear).toHaveBeenCalledTimes(2);
    });
  });

  describe('Badge', () => {
    it('renders badge with children and supports various variants', () => {
      const variants = ['default', 'info', 'success', 'warning', 'danger', 'outline'] as const;
      variants.forEach((v) => {
        const { unmount } = render(<Badge variant={v}>{v}</Badge>);
        expect(screen.getByText(v)).toBeInTheDocument();
        unmount();
      });
    });
  });

  describe('PrivacyShieldBadge', () => {
    it('renders shield with risk level label and token count', () => {
      render(<PrivacyShieldBadge riskLevel="MEDIUM" isSecured={true} tokenCount={3} />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-label', expect.stringContaining('Sanitized'));
      expect(screen.getByTestId('privacy-shield-token-count')).toHaveTextContent('3');
    });

    it('renders high risk warning styling and zero risk correctly', () => {
      const { unmount } = render(<PrivacyShieldBadge riskLevel="HIGH" isSecured={true} tokenCount={8} />);
      expect(screen.getByText(/high privacy sensitivity/i)).toBeInTheDocument();
      unmount();

      render(<PrivacyShieldBadge riskLevel="NONE" isSecured={true} tokenCount={0} />);
      expect(screen.getByText(/zero risk/i)).toBeInTheDocument();
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
  });
});
