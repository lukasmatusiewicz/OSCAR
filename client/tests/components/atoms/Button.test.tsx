import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../../../src/components/atoms/Button';

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
