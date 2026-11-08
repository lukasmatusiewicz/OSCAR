import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrioritySelector } from '../../../src/components/molecules/PrioritySelector';
import { TaskPriority } from '../../../src/types/contracts';

describe('PrioritySelector', () => {
  it('renders radio options in interactive mode and updates selection', () => {
    const handleChange = vi.fn();
    render(<PrioritySelector value="MEDIUM" onChange={handleChange} />);
    const highBtn = screen.getByRole('radio', { name: /high/i });
    expect(highBtn).toBeInTheDocument();
    fireEvent.click(highBtn);
    expect(handleChange).toHaveBeenCalledWith('HIGH');
  });

  it('renders read-only badge when readOnly is true', () => {
    render(<PrioritySelector value="URGENT" readOnly={true} />);
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.getByText(/● urgent/i)).toBeInTheDocument();
  });

  it('supports all priority values', () => {
    const priorities: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
    priorities.forEach((p) => {
      const { unmount } = render(<PrioritySelector value={p} readOnly={true} />);
      expect(screen.getByText(new RegExp(p, 'i'))).toBeInTheDocument();
      unmount();
    });
  });

  it('falls back to medium configuration for unknown priority in readOnly mode', () => {
    render(<PrioritySelector value={'UNKNOWN' as unknown as TaskPriority} readOnly={true} />);
    expect(screen.getByText(/● medium/i)).toBeInTheDocument();
  });
});
