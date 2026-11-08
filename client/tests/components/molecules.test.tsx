import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchBox } from '../../src/components/molecules/SearchBox';
import { PrioritySelector } from '../../src/components/molecules/PrioritySelector';
import { CategoryBadge } from '../../src/components/molecules/CategoryBadge';
import { TokenPreviewBadge } from '../../src/components/molecules/TokenPreviewBadge';
import { TaskCategory, TaskPriority, PIIType } from '../../src/types/contracts';

describe('Molecules Components', () => {
  describe('SearchBox', () => {
    it('renders input with search placeholder and handles typing', () => {
      const handleChange = vi.fn();
      render(<SearchBox value="audit" onChange={handleChange} placeholder="Search tasks..." />);
      const input = screen.getByPlaceholderText(/search tasks/i);
      expect(input).toHaveValue('audit');
      fireEvent.change(input, { target: { value: 'budget' } });
      expect(handleChange).toHaveBeenCalledWith('budget');
    });

    it('clears query when clear button is clicked', () => {
      const handleChange = vi.fn();
      render(<SearchBox value="sensitive query" onChange={handleChange} />);
      const clearBtn = screen.getByRole('button', { name: /clear input/i });
      fireEvent.click(clearBtn);
      expect(handleChange).toHaveBeenCalledWith('');
    });
  });

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
  });

  describe('CategoryBadge', () => {
    it('renders correct label and styling for every taxonomy category', () => {
      const categories: TaskCategory[] = [
        'WORK',
        'INTERVIEW_PREP',
        'FINANCE',
        'PERSONAL',
        'HEALTH',
        'OTHER'
      ];

      categories.forEach((cat) => {
        const { unmount } = render(<CategoryBadge category={cat} />);
        expect(screen.getByLabelText(`Category: ${cat}`)).toBeInTheDocument();
        unmount();
      });

      // Test fallback category
      render(<CategoryBadge category={'CUSTOM' as unknown as TaskCategory} />);
      expect(screen.getByLabelText('Category: CUSTOM')).toBeInTheDocument();
    });
  });

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
        'PERSON'
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
});
